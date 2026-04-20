// Mutable game state — single source of truth.
// Changes only through exported action functions.
import { emit } from "../util/events.js";
import { neighbors as hexNeighbors } from "../util/hex.js";

// 도시 지형 ID (terrains.json: TerrainID=13, Code="city").
const CITY_TERRAIN_ID = 13;

// 시작 헥스에서 연결된 모든 도시 타일 자동 점령 (7헥스 도시 등).
// 같은 TerrainID(=13) 연속 클러스터를 BFS로 수집.
function collectCityCluster(startHexId, worldHexTable) {
  const startHex = worldHexTable.get(startHexId);
  if (!startHex || startHex.TerrainID !== CITY_TERRAIN_ID) return [startHexId];
  const cluster = new Set([startHexId]);
  const queue = [{ q: startHex.HexQ, r: startHex.HexR }];
  while (queue.length) {
    const { q, r } = queue.shift();
    for (const n of hexNeighbors(q, r)) {
      const nid = n.q * 100 + n.r;
      if (cluster.has(nid)) continue;
      const nh = worldHexTable.get(nid);
      if (!nh || nh.TerrainID !== CITY_TERRAIN_ID) continue;
      cluster.add(nid);
      queue.push({ q: n.q, r: n.r });
    }
  }
  return [...cluster];
}

let state = null;
// HexLevel 조회용 tables 참조 (영지 슬롯 카운트 시 HL0 제외)
let _tablesRef = null;

// 실행 취소 스냅샷 스택 (최대 10단계)
const UNDO_LIMIT = 10;
const undoStack = [];

function snapshotForUndo() {
  if (!state) return null;
  return JSON.stringify({
    ...state,
    capturedStructures: [...(state.capturedStructures || [])],
    ownedHexes: [...(state.ownedHexes || [])],
    selectedPartyId: null,
  });
}

export function pushUndo(label) {
  const snap = snapshotForUndo();
  if (!snap) return;
  undoStack.push({ label: label || "", snap });
  while (undoStack.length > UNDO_LIMIT) undoStack.shift();
  emit("undo:changed", { count: undoStack.length });
}

export function canUndo() { return undoStack.length > 0; }
export function undoCount() { return undoStack.length; }
export function lastUndoLabel() {
  return undoStack.length > 0 ? undoStack[undoStack.length - 1].label : "";
}

export function performUndo() {
  if (undoStack.length === 0) return false;
  const { snap } = undoStack.pop();
  const parsed = JSON.parse(snap);
  state = parsed;
  // Set 복원
  state.capturedStructures = new Set(parsed.capturedStructures || []);
  state.ownedHexes = new Set(parsed.ownedHexes || []);
  emit("state:changed", { path: "*", action: "undo" });
  emit("undo:changed", { count: undoStack.length });
  return true;
}

export function clearUndoStack() {
  undoStack.length = 0;
  emit("undo:changed", { count: 0 });
}

export function getState() { return state; }

export function initState(tables) {
  _tablesRef = tables;
  const startHex = { q: 65, r: 45 };  // Reboldoeux city

  // 시작 캐릭터 Lv.1 (정상 진행). 적 스탯이 RegionTable.Strength × HexLevel로 스케일 →
  // 시작 권역(R1, Str=1) HexLv1는 Lv1 플레이어로 충분히 클리어 가능.
  const STARTER_LEVEL = 1;
  const startingExp = 0;

  // Pick starting characters: first 6 active Player units from FieldObjectTable
  const players = tables.fieldObjects.all()
    .filter(r => r.ObjectType === "Player" && r.IsActivate)
    .slice(0, 6);

  const characters = players.map((p, i) => {
    const lvUp = STARTER_LEVEL - 1;
    const maxHp = (p.BaseHP || 0) + (p.GrowthHP || 0) * lvUp;
    // PrefabPath에서 sprite 폴더명 추출 (예: "FieldObject/fighter_f/Prefab/fighter_f" → "fighter_f")
    const spriteName = p.PrefabPath
      ? p.PrefabPath.split("/")[1]
      : null;
    return {
      id: p.ID,
      name: p.Name || `Unit_${p.ID}`,
      jobClass: p.JobClass || "F",
      role: p.Role || "Dealer",
      spriteName,
      element: p.Element || "None",
      level: STARTER_LEVEL,
      hp: maxHp,
      maxHp: maxHp,
      fatigue: 100,
      maxFatigue: 100,
      xp: startingExp,
      stats: {
        atk: (p.BaseATK || 0) + (p.GrowthATK || 0) * lvUp,
        def: (p.BaseDEF || 0) + (p.GrowthDEF || 0) * lvUp,
        spd: (p.BaseSPD || 0) + (p.GrowthSPD || 0) * lvUp,
        cri: (p.BaseCRI || 5) + (p.GrowthCRI || 0) * lvUp,
        crd: (p.BaseCRD || 130) + (p.GrowthCRD || 0) * lvUp,
        acc: p.BaseACC || 95,
        evd: p.BaseEVD || 5,
        pen: p.BasePEN || 0,
      },
      status: "normal",
    };
  });

  // 시작 헥스 = 리볼도외 도시. 도시 클러스터(TerrainID=13 연결 7헥스) 자동 점령.
  const homeHexId = startHex.q * 100 + startHex.r;
  const homeHexRow = tables.worldHex.get(homeHexId);
  const ownedHexes = new Set();
  for (const hid of collectCityCluster(homeHexId, tables.worldHex)) {
    ownedHexes.add(hid);
  }
  const capturedStructures = new Set();
  if (homeHexRow?.StructureID) capturedStructures.add(homeHexRow.StructureID);

  state = {
    meta: { turn: 1, version: "0.1" },
    family: { name: "Player", level: 1, xp: 0, homeHex: startHex },
    resources: { grain: 0, iron: 0, wood: 0, stone: 0, herbs: 0, gold: 0, vis: 0, gem: 0, scroll: 0, rp: 0 },
    characters,
    parties: [
      {
        id: "party_1",
        name: "1분대",
        slots: [characters[0]?.id ?? null, characters[1]?.id ?? null, characters[2]?.id ?? null],
        location: { q: startHex.q, r: startHex.r },
        state: "idle",
      },
      {
        id: "party_2",
        name: "2분대",
        slots: [characters[3]?.id ?? null, characters[4]?.id ?? null, characters[5]?.id ?? null],
        location: { q: startHex.q, r: startHex.r },
        state: "idle",
      },
    ],
    selectedPartyId: null,
    capturedStructures,
    ownedHexes,
    territoryLv: 0,
    // 최대 분대 수 (기본 2, 배럭 확장으로 최대 6까지 증가 예정)
    maxParties: 2,
    // 공성 진행 상태: { [structureId]: { hp, defeatedDefenseIds: [DefenseID] } }
    siegeState: {},
    // 가문 성장 투자 레벨 (M5-A): { [trainingType]: currentLv }
    // training.json의 TrainingType 키별 0=미투자, N=다음 레벨 N+1을 살 수 있음
    training: {},
  };

  emit("state:init", state);
  return state;
}

// --- Actions ---

export function selectParty(partyId) {
  state.selectedPartyId = partyId;
  emit("state:changed", { path: "selectedPartyId" });
}

export function deselectParty() {
  state.selectedPartyId = null;
  emit("state:changed", { path: "selectedPartyId" });
}

export function getSelectedParty() {
  if (!state?.selectedPartyId) return null;
  return state.parties.find(p => p.id === state.selectedPartyId) || null;
}

export function moveParty(partyId, targetQ, targetR, fatigueCost) {
  const party = state.parties.find(p => p.id === partyId);
  if (!party) return;
  party.location = { q: targetQ, r: targetR };
  // Apply fatigue cost — fatigue DECREASES (GDD: 100=fresh)
  for (const cid of party.slots) {
    if (cid == null) continue;
    const ch = state.characters.find(c => c.id === cid);
    if (ch) {
      ch.fatigue = Math.max(0, ch.fatigue - fatigueCost);
      if (ch.fatigue <= 0) ch.status = "exhausted";
      else if (ch.fatigue <= 30) ch.status = "tired";
      else ch.status = "normal";
    }
  }
  // 홈 헥스 도착 시 자동 풀 회복 (HP/피로/상태 정상화)
  const home = state.family?.homeHex;
  if (home && targetQ === home.q && targetR === home.r) {
    for (const cid of party.slots) {
      if (cid == null) continue;
      const ch = state.characters.find(c => c.id === cid);
      if (ch) {
        ch.hp = ch.maxHp;
        ch.fatigue = ch.maxFatigue;
        ch.status = "normal";
      }
    }
  }
  emit("state:changed", { path: "parties", partyId, action: "move" });
}

// Restore from saved JSON (localStorage)
export function restoreState(saved, tables) {
  _tablesRef = tables;
  state = saved;
  if (Array.isArray(state.capturedStructures)) {
    state.capturedStructures = new Set(state.capturedStructures);
  } else if (!state.capturedStructures) {
    state.capturedStructures = new Set();
  }
  if (Array.isArray(state.ownedHexes)) {
    state.ownedHexes = new Set(state.ownedHexes);
  } else if (!state.ownedHexes) {
    state.ownedHexes = new Set();
  }
  if (state.territoryLv == null) state.territoryLv = 0;
  if (state.maxParties == null) state.maxParties = Math.max(2, state.parties?.length || 2);
  if (!state.siegeState) state.siegeState = {};
  if (!state.training) state.training = {};

  // Migration: 옛 세이브에 누적된 family.xp 즉시 레벨 반영 (M5-A 이전 세이브 호환)
  levelUpFamilyIfReady(tables);

  // Migration: 홈 도시 클러스터(7헥스) 자동 점령 — 옛 세이브에 누락된 6헥스 보강.
  const home = state.family?.homeHex;
  if (home) {
    const homeId = home.q * 100 + home.r;
    if (state.ownedHexes.has(homeId)) {
      for (const hid of collectCityCluster(homeId, tables.worldHex)) {
        state.ownedHexes.add(hid);
      }
    }
  }

  // Migration: 옛날 세이브 캐릭터에 spriteName / element 보강
  for (const ch of state.characters || []) {
    if (!ch.spriteName || !ch.element) {
      const tmpl = tables.fieldObjects.all().find(
        r => r.ID === ch.id && r.ObjectType === "Player"
      );
      if (tmpl?.PrefabPath && !ch.spriteName) {
        ch.spriteName = tmpl.PrefabPath.split("/")[1];
      }
      if (tmpl && !ch.element) ch.element = tmpl.Element || "None";
    }
  }

  // 홈 헥스에 있는 파티는 풀 회복 (저장 시점에 죽어있던 캐릭터도 거점에서 부활)
  if (home) {
    for (const p of state.parties || []) {
      if (p.location?.q === home.q && p.location?.r === home.r) {
        for (const cid of p.slots || []) {
          if (cid == null) continue;
          const ch = state.characters.find(c => c.id === cid);
          if (ch) {
            ch.hp = ch.maxHp;
            ch.fatigue = ch.maxFatigue;
            ch.status = "normal";
          }
        }
      }
    }
  }

  emit("state:init", state);
  return state;
}

export function getCharacter(id) {
  return state?.characters.find(c => c.id === id) || null;
}

/** Grant EXP to a character and auto-level up via CharacterExpTable. */
export function grantExp(charId, amount, expTable) {
  const ch = getCharacter(charId);
  if (!ch || amount <= 0) return null;
  ch.xp = (ch.xp || 0) + amount;
  const before = ch.level;
  // Loop up the table while xp >= cumulative threshold for next level.
  while (true) {
    const nextLv = ch.level + 1;
    const row = expTable.get(nextLv);
    if (!row) break;
    const need = row.CumulativeEXP ?? row.RequiredEXP ?? null;
    if (need == null || ch.xp < need) break;
    ch.level = nextLv;
  }
  return { gained: amount, before, after: ch.level, total: ch.xp };
}

/**
 * Apply level-based stat growth from FieldObjectTable Growth fields.
 * tables 인자가 주어지면 훈련 보정도 함께 적용 (M5-B).
 */
export function recomputeStatsFromLevel(charId, fieldObjectsTable, tables) {
  const ch = getCharacter(charId);
  if (!ch) return;
  // Find the original FieldObject row to get growth values
  const tmpl = fieldObjectsTable.all().find(
    r => r.ID === ch.id && r.ObjectType === "Player"
  );
  if (!tmpl) return;
  const lvUp = Math.max(0, ch.level - 1);
  ch.maxHp = (tmpl.BaseHP ?? 0) + (tmpl.GrowthHP ?? 0) * lvUp;
  ch.stats.atk = (tmpl.BaseATK ?? 0) + (tmpl.GrowthATK ?? 0) * lvUp;
  ch.stats.def = (tmpl.BaseDEF ?? 0) + (tmpl.GrowthDEF ?? 0) * lvUp;
  ch.stats.spd = (tmpl.BaseSPD ?? 0) + (tmpl.GrowthSPD ?? 0) * lvUp;
  ch.stats.cri = (tmpl.BaseCRI ?? 5) + (tmpl.GrowthCRI ?? 0) * lvUp;
  ch.stats.crd = (tmpl.BaseCRD ?? 130) + (tmpl.GrowthCRD ?? 0) * lvUp;

  // M5-B: 훈련 보정 적용 (tables가 주어진 경우만)
  if (tables) applyTrainingToCharacter(ch, tables);

  // HP cap clamping
  if (ch.hp > ch.maxHp) ch.hp = ch.maxHp;
}

/**
 * 모든 캐릭터의 stats 재계산 — 훈련 투자 직후 호출.
 * 모든 직업 캐릭터의 maxFatigue/% 보정을 새 누적치로 갱신.
 */
export function recomputeAllCharacters(tables) {
  if (!state?.characters || !tables?.fieldObjects) return;
  for (const ch of state.characters) {
    recomputeStatsFromLevel(ch.id, tables.fieldObjects, tables);
  }
}

/** Recover fatigue (heal toward max). */
export function recoverFatigue(charId, amount) {
  const ch = getCharacter(charId);
  if (!ch) return;
  ch.fatigue = Math.min(ch.maxFatigue, ch.fatigue + amount);
  if (ch.fatigue > 30) ch.status = "normal";
}

/** Restore HP. */
export function recoverHP(charId, amount) {
  const ch = getCharacter(charId);
  if (!ch) return;
  ch.hp = Math.min(ch.maxHp, ch.hp + amount);
}

/** Full rest (used at city or owned hex with structure). */
/** 현재 최대 파티 수 (M5-A 훈련/배럭 확장 후 늘어남). 기본 2, 최대 6. */
export function getMaxParties() {
  return state?.maxParties ?? 2;
}

/**
 * 배럭 확장 비용 (maxParties → maxParties + 1).
 * 2→3은 자원만, 3→4~는 가문 레벨 게이트 추가 예정 (D 단계 후속).
 */
export const BARRACKS_EXPAND_COST = {
  // 테스트 편의로 초기 자원(곡물/금화)로 바로 가능하게 낮춤. 추후 목재/석재 복원 예정.
  3: { grain: 100, gold: 500 },                // 2→3
  4: { grain: 300, gold: 1500, wood: 20 },     // 3→4
  5: { grain: 600, gold: 3000, wood: 50, stone: 30 },   // 4→5
  6: { grain: 1200, gold: 6000, wood: 120, stone: 80, herbs: 50 },  // 5→6
};

/** 배럭 확장 비용 조회 (다음 레벨). */
export function getBarracksExpandCost() {
  const next = (state?.maxParties ?? 2) + 1;
  if (next > 6) return null;
  return BARRACKS_EXPAND_COST[next];
}

/** 배럭 확장 가능 여부 체크. */
export function canExpandBarracks() {
  const cost = getBarracksExpandCost();
  if (!cost) return { ok: false, reason: "at_max" };
  if (!state?.resources) return { ok: false, reason: "no_state" };
  for (const [res, amt] of Object.entries(cost)) {
    if ((state.resources[res] || 0) < amt) {
      return { ok: false, reason: "insufficient", missing: res, need: amt, have: state.resources[res] || 0 };
    }
  }
  return { ok: true, cost };
}

/** 배럭 확장 실행 — 자원 차감 + maxParties +1. */
export function expandBarracks() {
  const check = canExpandBarracks();
  if (!check.ok) return check;
  for (const [res, amt] of Object.entries(check.cost)) {
    state.resources[res] = (state.resources[res] || 0) - amt;
  }
  state.maxParties = (state.maxParties || 2) + 1;
  emit("state:changed", { path: "maxParties", action: "expand" });
  return { ok: true, newMax: state.maxParties };
}

/** 파티 추가. 빈 슬롯 3개. 최대치 초과 시 실패. */
export function createParty() {
  if (!state) return { ok: false, reason: "no_state" };
  const max = getMaxParties();
  if (state.parties.length >= max) {
    return { ok: false, reason: "limit_reached", limit: max };
  }
  const n = state.parties.length + 1;
  const home = state.family.homeHex;
  const newParty = {
    id: `party_${n}`,
    name: `${n}분대`,
    slots: [null, null, null],
    location: { q: home.q, r: home.r },
    state: "idle",
  };
  state.parties.push(newParty);
  emit("state:changed", { path: "parties", action: "create", partyId: newParty.id });
  return { ok: true, party: newParty };
}

/** 파티 삭제. 편성된 캐릭 해제 (로스터로 복귀). */
export function deleteParty(partyId) {
  if (!state) return { ok: false };
  const idx = state.parties.findIndex(p => p.id === partyId);
  if (idx < 0) return { ok: false, reason: "not_found" };
  if (state.parties.length <= 1) return { ok: false, reason: "last_party" };
  state.parties.splice(idx, 1);
  if (state.selectedPartyId === partyId) state.selectedPartyId = null;
  emit("state:changed", { path: "parties", action: "delete", partyId });
  return { ok: true };
}

/**
 * 파티 슬롯에 캐릭터 배치/교체/비우기.
 * - characterId가 null이면 슬롯 비움
 * - 해당 캐릭터가 다른 슬롯에 있으면 자동 해제 후 이동
 * - 파티가 월드맵에서 이동/전투 중이면 배치 거부 (리더 교체 위험)
 */
export function assignPartySlot(partyId, slotIdx, characterId) {
  const party = state.parties.find(p => p.id === partyId);
  if (!party) return { ok: false, reason: "party_not_found" };
  if (slotIdx < 0 || slotIdx >= party.slots.length) {
    return { ok: false, reason: "invalid_slot" };
  }
  // 기존 해당 캐릭 다른 슬롯/파티에서 제거 (중복 방지)
  if (characterId != null) {
    for (const p of state.parties) {
      for (let i = 0; i < p.slots.length; i++) {
        if (p.slots[i] === characterId) p.slots[i] = null;
      }
    }
  }
  party.slots[slotIdx] = characterId;
  emit("state:changed", { path: "parties", partyId, action: "assign" });
  return { ok: true };
}

/** 로스터용: 모든 캐릭터 + 배치 상태 반환 */
export function getRosterWithStatus() {
  if (!state?.characters) return [];
  return state.characters.map(ch => {
    let assignedTo = null;
    let slotIdx = -1;
    for (const p of state.parties) {
      const idx = p.slots.indexOf(ch.id);
      if (idx >= 0) {
        assignedTo = p.id;
        slotIdx = idx;
        break;
      }
    }
    return { ...ch, assignedPartyId: assignedTo, assignedSlotIdx: slotIdx };
  });
}

export function fullRestParty(partyId) {
  const party = state.parties.find(p => p.id === partyId);
  if (!party) return;
  for (const cid of party.slots) {
    if (cid == null) continue;
    const ch = getCharacter(cid);
    if (ch) {
      ch.fatigue = ch.maxFatigue;
      ch.hp = ch.maxHp;
      ch.status = "normal";
    }
  }
  emit("state:changed", { path: "characters", action: "rest" });
}

export function isStructureCaptured(structureId) {
  return state?.capturedStructures.has(structureId) || false;
}

export function captureStructure(structureId) {
  state.capturedStructures.add(structureId);
  // 점령 시 공성 상태 정리
  if (state.siegeState) delete state.siegeState[structureId];
  emit("state:changed", { path: "capturedStructures", structureId });
}

// ─────── 구조물 공성 상태 헬퍼 ───────

// GDD §4-2: 공성 복원 타이머 (실시간 기준 — 데모용. 정식판은 턴 기반).
// 경비대/수비대는 격파 후 타이머 진행, 만료 시 부활. 주둔군은 영구 격파.
export const SIEGE_TIMER_MS = {
  Patrol: 3 * 60 * 1000,       // 3분
  Garrison: 5 * 60 * 1000,     // 5분
  Stationed: null,              // 영구 격파 (타이머 없음)
};

/** 구조물의 현재 공성 진행 상태 (없으면 새로 생성). */
export function getSiegeProgress(structureId, maxHp) {
  if (!state.siegeState) state.siegeState = {};
  if (!state.siegeState[structureId]) {
    state.siegeState[structureId] = {
      hp: maxHp,
      defeatedDefenseIds: [],     // 주둔군 영구 격파 저장 (과거 호환)
      defenderTimers: {},          // { [defenseId]: expireAtMs } — Patrol/Garrison용
    };
  }
  // 과거 세이브 호환
  const sp = state.siegeState[structureId];
  if (!sp.defenderTimers) sp.defenderTimers = {};
  if (!sp.defeatedDefenseIds) sp.defeatedDefenseIds = [];
  return sp;
}

export function getStructureCurrentHP(structureId) {
  return state?.siegeState?.[structureId]?.hp;
}

/**
 * 수비 웨이브 격파 마킹.
 * @param {string} layer  'Patrol' | 'Garrison' | 'Stationed'
 */
export function markDefenderDefeated(structureId, defenseId, maxHp, layer) {
  const sp = getSiegeProgress(structureId, maxHp);
  const timerMs = SIEGE_TIMER_MS[layer];
  if (timerMs == null) {
    // 주둔군 — 영구 격파
    if (!sp.defeatedDefenseIds.includes(defenseId)) {
      sp.defeatedDefenseIds.push(defenseId);
    }
  } else {
    // 경비대/수비대 — 타이머 기반
    sp.defenderTimers[defenseId] = Date.now() + timerMs;
  }
  emit("state:changed", { path: "siegeState", structureId, action: "defeat" });
}

/** 격파 여부 확인 (타이머 만료 시 false 반환). */
export function isDefenderDefeated(structureId, defenseId) {
  const sp = state?.siegeState?.[structureId];
  if (!sp) return false;
  // 주둔군: 영구 격파
  if (sp.defeatedDefenseIds?.includes(defenseId)) return true;
  // 경비대/수비대: 타이머 체크
  const expireAt = sp.defenderTimers?.[defenseId];
  if (expireAt && Date.now() < expireAt) return true;
  return false;
}

/** 특정 방어자의 복원까지 남은 ms (없으면 null). */
export function getDefenderTimerRemaining(structureId, defenseId) {
  const expireAt = state?.siegeState?.[structureId]?.defenderTimers?.[defenseId];
  if (!expireAt) return null;
  const rem = expireAt - Date.now();
  return rem > 0 ? rem : null;
}

/** 만료된 타이머 제거. 만료된 defenseId 배열 반환 (로그용). */
export function cleanupExpiredTimers(structureId) {
  const sp = state?.siegeState?.[structureId];
  if (!sp?.defenderTimers) return [];
  const now = Date.now();
  const expired = [];
  for (const [did, expireAt] of Object.entries(sp.defenderTimers)) {
    if (now >= expireAt) {
      expired.push(Number(did));
      delete sp.defenderTimers[did];
    }
  }
  return expired;
}

/** 구조물 HP 데미지 적용. HP <= 0이면 true 반환 (함락 가능). */
export function applyStructureDamage(structureId, damage, maxHp) {
  const sp = getSiegeProgress(structureId, maxHp);
  sp.hp = Math.max(0, sp.hp - damage);
  emit("state:changed", { path: "siegeState", structureId });
  return sp.hp <= 0;
}

export function abandonStructure(structureId) {
  state.capturedStructures.delete(structureId);
  emit("state:changed", { path: "capturedStructures", structureId, action: "abandon" });
}

export function ownHex(hexId) {
  state.ownedHexes.add(hexId);
  emit("state:changed", { path: "ownedHexes", hexId });
}

export function abandonHex(hexId) {
  state.ownedHexes.delete(hexId);
  emit("state:changed", { path: "ownedHexes", hexId, action: "abandon" });
}

export function isHexOwned(hexId) {
  return state?.ownedHexes.has(hexId) || false;
}

/** 영지 슬롯 룰 (project_territory_slots.md): 기본 15 + territoryLv*2, 최대 81. */
export function getTerritoryMaxSlots() {
  if (!state) return 15;
  return Math.min(81, 15 + (state.territoryLv || 0) * 2);
}

/**
 * 영지 슬롯 사용량 — HexLevel 0 (빈 필드 통로)는 카운트 제외.
 * HL 0 = 자원 없는 빈 필드 → 영토 확장용 무한 통로 취급.
 * HL ≥ 1 = 실제 생산 헥스 → 슬롯 소비.
 * 구조물 헥스(도시/거점/관문 등)도 카운트 제외 (별도 영토).
 */
export function getTerritoryUsedSlots() {
  if (!state?.ownedHexes) return 0;
  if (!_tablesRef) return state.ownedHexes.size;
  let count = 0;
  for (const hexId of state.ownedHexes) {
    const hx = _tablesRef.worldHex?.get(hexId);
    if (!hx) continue;
    if ((hx.HexLevel || 0) < 1) continue;      // HL0 = 무료 통로
    if (hx.StructureID) continue;               // 구조물 = 별도 영토
    count++;
  }
  return count;
}

export function canOccupyMore() {
  return getTerritoryUsedSlots() < getTerritoryMaxSlots();
}

// ─────── 가문 성장 투자 (M5-A) ───────

/** 해당 TrainingType의 현재 투자 레벨 (0 = 미투자). */
export function getTrainingLevel(trainingType) {
  return state?.training?.[trainingType] || 0;
}

/**
 * 누적 효과 값 — Lv 1부터 currentLv까지 EffectValue/EffectValue2 합산.
 * 각 Lv 행의 값을 "이 레벨이 추가하는 증가분"으로 해석 (delta).
 * @returns {number} 누적 효과량 (effectType 일치하는 행만)
 */
export function getTrainingEffectSum(trainingType, effectType, tables) {
  if (!tables?.training) return 0;
  const cur = getTrainingLevel(trainingType);
  if (cur === 0) return 0;
  let sum = 0;
  const rows = tables.training.all().filter(
    r => r.TrainingType === trainingType && r.Level <= cur
  );
  for (const r of rows) {
    if (r.EffectType === effectType) sum += (r.EffectValue || 0);
    if (r.EffectType2 === effectType) sum += (r.EffectValue2 || 0);
  }
  return sum;
}

/** JobClass(F/S/M/W/L) → 해당 class_X 훈련 키. */
const JOBCLASS_TO_TRAINING = {
  F: "class_F", S: "class_S", M: "class_M", W: "class_W", L: "class_L",
};

/**
 * 캐릭터 1명에게 훈련 효과 적용 (recomputeStatsFromLevel 직후 호출용).
 * - stamina: maxFatigue += 누적
 * - 병종 (class_F/S/M/W/L): EffectType이 ATK_PCT/DEF_PCT/SPD_PCT/CRI_PCT/INT_PCT/RES_PCT/PEN_PCT
 *   → 해당 ch.stats.* 에 (1 + sum/100) 곱
 *
 * INT/RES는 현재 ch.stats에 없으므로 스킵 (Wizard/Warlock 후속).
 */
function applyTrainingToCharacter(ch, tables) {
  if (!ch || !tables?.training) return;
  // stamina → maxFatigue
  const staminaBonus = getTrainingEffectSum("stamina", "maxFatigue", tables);
  ch.maxFatigue = 100 + staminaBonus;
  if (ch.fatigue > ch.maxFatigue) ch.fatigue = ch.maxFatigue;

  // 병종 % 보정
  const classKey = JOBCLASS_TO_TRAINING[ch.jobClass];
  if (!classKey) return;
  const PCT_FIELDS = {
    ATK_PCT: "atk", DEF_PCT: "def", SPD_PCT: "spd", CRI_PCT: "cri",
    PEN_PCT: "pen",
    // INT_PCT/RES_PCT는 현재 stats에 미존재 — Wizard/Warlock UI 시 추가
  };
  for (const [effectType, statKey] of Object.entries(PCT_FIELDS)) {
    const pct = getTrainingEffectSum(classKey, effectType, tables);
    if (pct === 0) continue;
    if (ch.stats[statKey] != null) {
      ch.stats[statKey] = Math.round(ch.stats[statKey] * (1 + pct / 100));
    }
  }
}

/**
 * 다음 Lv 훈련 행을 training.json에서 찾는다.
 * 현재 Lv=0이면 Level=1 행, Lv=5면 Level=6 행 반환.
 */
export function getNextTrainingRow(trainingType, tables) {
  const cur = getTrainingLevel(trainingType);
  const nextLv = cur + 1;
  return tables.training.all().find(
    r => r.TrainingType === trainingType && r.Level === nextLv
  ) || null;
}

/**
 * 자원 충분한지 + 가문 Lv 해금 조건 만족하는지 판정.
 * @returns {{ ok: boolean, reason?: string, missing?: object }}
 */
export function canAffordTraining(row) {
  if (!row) return { ok: false, reason: "max" };  // 최대 레벨 도달
  const familyLv = state.family?.level || 1;
  if ((row.UnlockFamilyLv || 1) > familyLv) {
    return { ok: false, reason: "locked", unlockLv: row.UnlockFamilyLv };
  }
  const missing = {};
  const check = (res, amt) => {
    if (!res || !amt) return;
    const have = state.resources[res] || 0;
    if (have < amt) missing[res] = amt - have;
  };
  check(row.CostRes1, row.CostAmt1);
  check(row.CostRes2, row.CostAmt2);
  check(row.CostRes3, row.CostAmt3);
  if (Object.keys(missing).length > 0) return { ok: false, reason: "cost", missing };
  return { ok: true };
}

/**
 * 가문 레벨 자동 진행 — family.xp가 다음 레벨 CumulativeXP 이상이면 레벨업.
 * 보상 자원 자동 가산. family_level.json 기반.
 * @returns {Array<{from, to, row}>} 발생한 모든 레벨업
 */
export function levelUpFamilyIfReady(tables) {
  if (!state?.family) return [];
  const events = [];
  while (true) {
    const cur = state.family.level || 1;
    const nextLv = cur + 1;
    const row = tables.familyLevel.get(nextLv);
    if (!row) break;
    if ((state.family.xp || 0) < (row.CumulativeXP || 0)) break;
    state.family.level = nextLv;
    // 레벨업 보상 지급
    if (row.RwdGrain) state.resources.grain = (state.resources.grain || 0) + row.RwdGrain;
    if (row.RwdGold)  state.resources.gold  = (state.resources.gold  || 0) + row.RwdGold;
    if (row.RwdVis)   state.resources.vis   = (state.resources.vis   || 0) + row.RwdVis;
    if (row.RwdGem)   state.resources.gem   = (state.resources.gem   || 0) + row.RwdGem;
    if (row.RwdScroll) state.resources.scroll = (state.resources.scroll || 0) + row.RwdScroll;
    events.push({ from: cur, to: nextLv, row });
  }
  if (events.length > 0) emit("state:changed", { path: "family.level", events });
  return events;
}

/**
 * 훈련 투자 실행 — 자원 차감 + 레벨 +1.
 * @returns {{ ok: boolean, row?: object, reason?: string }}
 */
export function investTraining(trainingType, tables) {
  const row = getNextTrainingRow(trainingType, tables);
  const check = canAffordTraining(row);
  if (!check.ok) return { ok: false, reason: check.reason };

  // 자원 차감
  if (row.CostRes1 && row.CostAmt1) {
    state.resources[row.CostRes1] = (state.resources[row.CostRes1] || 0) - row.CostAmt1;
  }
  if (row.CostRes2 && row.CostAmt2) {
    state.resources[row.CostRes2] = (state.resources[row.CostRes2] || 0) - row.CostAmt2;
  }
  if (row.CostRes3 && row.CostAmt3) {
    state.resources[row.CostRes3] = (state.resources[row.CostRes3] || 0) - row.CostAmt3;
  }
  // 레벨 +1
  state.training[trainingType] = (state.training[trainingType] || 0) + 1;
  emit("state:changed", { path: "training", trainingType, action: "invest" });
  return { ok: true, row };
}
