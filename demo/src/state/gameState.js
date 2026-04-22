// Mutable game state — single source of truth.
// Changes only through exported action functions.
import { emit } from "../util/events.js";
import { neighbors as hexNeighbors, distance as hexDistance } from "../util/hex.js";

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
        res: (p.BaseRES || 0) + (p.GrowthRES || 0) * lvUp,  // M5-B Wizard/Warlock 마법 저항
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
    resources: { grain: 0, iron: 0, wood: 0, stone: 0, herbs: 0, gold: 0, vis: 0, gem: 3000, scroll: 5, rp: 0 },
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
    // 가문 성장 투자 레벨 (M5-A/B): 카테고리별 { [type]: currentLv }
    training: {},
    research: {},      // weapon_SWD/.../exploration
    fortification: {}, // wall/gate/durability/barracks/territory
    // 가챠 중복 조각 누적: { [charId]: count }
    shards: {},
    // 우편함 (M6): 전투/이벤트 결과 아카이브
    // { id, type: "battle"|"levelup"|"system", turn, title, body, claimed, expiresTurn }
    mailbox: [],
    // 필드 조우형 적 (GDD §5-2): 맵 위 조우 인스턴스
    // { id, templateId, q, r, spawnedAt, nextMoveTurn, discovered, defeatCount }
    encounters: [],
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
  // GDD: 자동 풀회복 제거. 대신 탈진(피로≤0) 파티에 대해 "최소 10 보장"만 적용
  // → 쉼터에서 이동은 가능한 상태로. HP/피로 풀회복은 턴 자연 회복으로 누적.
  // 쉼터 = 홈(마을) + 점령된 Fort 모두 동일 룰 (사용자 요청: 마을과 Fort 동일).
  if (_isShelterHex(targetQ, targetR)) {
    ensureMinFatigue(partyId, 10);
  }
  emit("state:changed", { path: "parties", partyId, action: "move" });
}

/**
 * 쉼터 헥스 판정 — 홈(마을) 또는 점령된 Fort.
 * 쉼터에서는 도착 시 ensureMinFatigue + 머무는 동안 정기 회복이 빠름.
 */
function _isShelterHex(q, r) {
  if (!state) return false;
  const home = state.family?.homeHex;
  if (home && q === home.q && r === home.r) return true;
  // 점령된 Fort 헥스
  if (!_tablesRef?.worldHex || !_tablesRef?.structures) return false;
  const hex = _tablesRef.worldHex.get(q * 100 + r);
  if (!hex?.StructureID) return false;
  const struct = _tablesRef.structures.get(hex.StructureID);
  if (struct?.StructureType !== "Fort") return false;
  return state.capturedStructures?.has(hex.StructureID);
}

/**
 * 파티 전원 피로도가 최소값 미만이면 최소값까지 상승시킴.
 * 탈진 상태로 집에 도착한 파티가 최소한 밖으로 나갈 수 있게 보장.
 */
export function ensureMinFatigue(partyId, minVal = 10) {
  const party = state?.parties.find(p => p.id === partyId);
  if (!party) return;
  for (const cid of party.slots) {
    if (cid == null) continue;
    const ch = state.characters.find(c => c.id === cid);
    if (ch && ch.fatigue < minVal) {
      ch.fatigue = minVal;
      if (ch.fatigue > 30) ch.status = "normal";
      else if (ch.fatigue > 0) ch.status = "tired";
    }
  }
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
  if (!state.shards) state.shards = {};
  if (!state.encounters) state.encounters = [];  // 조우형 적 (GDD §5-2)
  // 구 세이브 호환: gem 부족 시 최소 2800(10연차) 보장
  if (!state.resources) state.resources = {};
  if ((state.resources.gem || 0) < 2800) state.resources.gem = 3000;
  if ((state.resources.scroll || 0) < 5) state.resources.scroll = 5;
  if (!state.training) state.training = {};
  if (!state.research) state.research = {};
  if (!state.fortification) state.fortification = {};
  if (!Array.isArray(state.mailbox)) state.mailbox = [];

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
  ch.stats.res = (tmpl.BaseRES ?? 0) + (tmpl.GrowthRES ?? 0) * lvUp;

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

// ─────── 우편함 (M6) ───────
const MAIL_EXPIRE_TURNS = 30;  // 자동 삭제까지 턴 수
let _mailIdCounter = 1;

/** 신규 우편 추가. */
export function addMail({ type = "battle", title, body, turn }) {
  if (!state) return null;
  if (!Array.isArray(state.mailbox)) state.mailbox = [];
  const t = turn ?? state.meta?.turn ?? 1;
  const mail = {
    id: `m_${Date.now()}_${_mailIdCounter++}`,
    type, title, body, turn: t,
    expiresTurn: t + MAIL_EXPIRE_TURNS,
    read: false,
  };
  state.mailbox.unshift(mail);  // 최신 위에
  emit("state:changed", { path: "mailbox", action: "add" });
  return mail;
}

/** 미읽음 우편 수. */
export function getUnreadMailCount() {
  if (!Array.isArray(state?.mailbox)) return 0;
  return state.mailbox.filter(m => !m.read).length;
}

/** 우편 읽음 처리. */
export function markMailRead(mailId) {
  const mail = state?.mailbox?.find(m => m.id === mailId);
  if (!mail) return false;
  mail.read = true;
  emit("state:changed", { path: "mailbox", action: "read" });
  return true;
}

/** 우편 삭제. */
export function deleteMail(mailId) {
  if (!Array.isArray(state?.mailbox)) return false;
  const before = state.mailbox.length;
  state.mailbox = state.mailbox.filter(m => m.id !== mailId);
  if (state.mailbox.length === before) return false;
  emit("state:changed", { path: "mailbox", action: "delete" });
  return true;
}

/** 우편 전체 읽음 처리. */
export function markAllMailRead() {
  if (!Array.isArray(state?.mailbox)) return 0;
  let n = 0;
  for (const m of state.mailbox) {
    if (!m.read) { m.read = true; n++; }
  }
  if (n > 0) emit("state:changed", { path: "mailbox", action: "read-all" });
  return n;
}

/** 만료된 우편 자동 삭제 (턴 종료 시 호출 권장). */
export function purgeExpiredMail() {
  if (!Array.isArray(state?.mailbox)) return 0;
  const curTurn = state.meta?.turn || 1;
  const before = state.mailbox.length;
  state.mailbox = state.mailbox.filter(m => (m.expiresTurn || Infinity) > curTurn);
  const purged = before - state.mailbox.length;
  if (purged > 0) emit("state:changed", { path: "mailbox", action: "purge" });
  return purged;
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

/**
 * 단일 파티 자동 배치 — 해당 파티만 초기화 후 미배치(다른 파티에 안 들어간) 캐릭 풀에서 채움.
 *
 * 룰:
 *   Slot 0 (리더, 사망=강제 퇴각): Tanker 우선 → Dealer fallback
 *   Slot 1 (DPS):                  Dealer 우선 → Support → Healer
 *   Slot 2 (유틸):                 Healer 우선 → Support → Dealer
 *
 * 다른 파티의 편성은 건드리지 않음.
 * @returns {{ ok, assigned, reason }}
 */
export function autoAssignParty(partyId) {
  if (!state?.parties || !state.characters) return { ok: false, reason: "no_state" };
  const party = state.parties.find(p => p.id === partyId);
  if (!party) return { ok: false, reason: "not_found" };

  // 1) 해당 파티만 슬롯 초기화 (다른 파티는 그대로)
  party.slots = [null, null, null];

  // 2) 다른 파티에 이미 배치된 캐릭 ID 모음 (제외 대상)
  const usedByOthers = new Set();
  for (const p of state.parties) {
    if (p.id === partyId) continue;
    for (const cid of p.slots || []) {
      if (cid != null) usedByOthers.add(cid);
    }
  }

  // 3) 미배치 캐릭만 Role별 풀 구성 (레벨 desc)
  const available = state.characters.filter(c => !usedByOthers.has(c.id));
  const byRole = (role) => available
    .filter(c => c.role === role)
    .sort((a, b) => (b.level || 1) - (a.level || 1));
  const pools = {
    Tanker: byRole("Tanker"),
    Dealer: byRole("Dealer"),
    Healer: byRole("Healer"),
    Support: byRole("Support"),
  };
  const pickedIds = new Set();

  const SLOT_PRIORITY = [
    ["Tanker", "Dealer", "Support", "Healer"],
    ["Dealer", "Support", "Healer", "Tanker"],
    ["Healer", "Support", "Dealer", "Tanker"],
  ];

  function pickNext(slotIdx) {
    for (const role of SLOT_PRIORITY[slotIdx]) {
      const pool = pools[role];
      while (pool.length > 0) {
        const c = pool.shift();
        if (!pickedIds.has(c.id)) {
          pickedIds.add(c.id);
          return c.id;
        }
      }
    }
    return null;
  }

  const assigned = [];
  for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
    const cid = pickNext(slotIdx);
    party.slots[slotIdx] = cid;
    if (cid != null) assigned.push(cid);
  }

  emit("state:changed", { path: "parties", partyId, action: "auto-assign-party" });
  return { ok: true, assigned };
}

/**
 * 거점(Fort)에 배치 가능한 최대 파티 수.
 * 현재: 1 고정. 미래: GarrisonLv/시설 업그레이드로 확장 (Lv5에서 2, Lv10에서 3 등).
 * @param {object} structure - StructureTable row
 * @returns {number}
 */
export function getFortMaxParties(structure) {
  if (!structure) return 0;
  if (structure.StructureType === "City") return Infinity;  // 도시는 모든 파티 공유
  if (structure.StructureType !== "Fort") return 0;
  // TODO(거점 운영 확장): structure.GarrisonLv 또는 별도 fortification 시설 레벨로 확장
  // 예시 룰 후보:
  //   - GarrisonLv 1~3: 1분대
  //   - GarrisonLv 4~6: 2분대
  //   - GarrisonLv 7~10: 3분대
  return 1;
}

/** 해당 헥스에 배치된 파티들 (homeHex 매칭). */
export function getFortDeployedParties(q, r) {
  if (!state?.parties) return [];
  return state.parties.filter(p => p.homeHex && p.homeHex.q === q && p.homeHex.r === r);
}

/**
 * 파티의 홈 헥스 — 등록되어 있으면 해당 좌표, 아니면 가문 홈(도시).
 * 귀환(자동/패배/리더사망) 시 이 위치로 이동.
 */
export function getPartyHome(party) {
  if (!party) return state?.family?.homeHex;
  return party.homeHex || state?.family?.homeHex;
}

/**
 * 파티의 홈 헥스 등록. 점령된 도시/Fort 헥스만 가능.
 * null/undefined로 호출 시 등록 해제 (기본 가문 홈으로 복귀).
 * @returns {{ ok, reason? }}
 */
export function setPartyHome(partyId, q, r) {
  const party = state?.parties.find(p => p.id === partyId);
  if (!party) return { ok: false, reason: "party_not_found" };
  // 해제
  if (q == null || r == null) {
    party.homeHex = null;
    emit("state:changed", { path: "parties", partyId, action: "set-home-clear" });
    return { ok: true };
  }
  // 검증: 점령된 City/Fort/도시(home) 헥스만 허용
  const hex = _tablesRef?.worldHex?.get(q * 100 + r);
  if (!hex) return { ok: false, reason: "no_hex" };
  const home = state.family?.homeHex;
  const isHomeCity = home && home.q === q && home.r === r;
  let validShelter = isHomeCity;
  if (!validShelter && hex.StructureID) {
    const struct = _tablesRef?.structures?.get(hex.StructureID);
    if ((struct?.StructureType === "Fort" || struct?.StructureType === "City")
        && state.capturedStructures?.has(hex.StructureID)) {
      validShelter = true;
    }
  }
  if (!validShelter) return { ok: false, reason: "not_shelter" };
  // 거점 캡 체크 — getFortMaxParties (현재 Fort=1, City=Infinity, 미래 GarrisonLv 확장 가능)
  if (!isHomeCity && hex.StructureID) {
    const struct = _tablesRef?.structures?.get(hex.StructureID);
    const cap = getFortMaxParties(struct);
    const others = state.parties.filter(p =>
      p.id !== partyId && p.homeHex && p.homeHex.q === q && p.homeHex.r === r
    );
    if (others.length >= cap) {
      return { ok: false, reason: "occupied", cap, deployed: others.length, occupantName: others[0]?.name };
    }
  }
  party.homeHex = { q, r };
  emit("state:changed", { path: "parties", partyId, action: "set-home" });
  return { ok: true };
}

/** 파티의 자동 귀환 옵션 토글 — 전투 후 자동으로 홈 헥스로 이동. */
export function togglePartyAutoReturn(partyId) {
  const party = state?.parties.find(p => p.id === partyId);
  if (!party) return { ok: false, reason: "not_found" };
  party.autoReturn = !party.autoReturn;
  emit("state:changed", { path: "parties", partyId, action: "auto-return-toggle" });
  return { ok: true, value: party.autoReturn };
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

/** 가챠로 획득한 캐릭터를 로스터에 추가 (신규 편성 슬롯으로). */
export function addCharacterToRoster(p, startingLevel = 1) {
  if (!state) return { ok: false };
  if (state.characters.some(c => c.id === p.ID)) {
    return { ok: false, reason: "duplicate" };
  }
  const lvUp = Math.max(0, startingLevel - 1);
  const maxHp = (p.BaseHP || 0) + (p.GrowthHP || 0) * lvUp;
  const spriteName = p.PrefabPath ? p.PrefabPath.split("/")[1] : null;
  const ch = {
    id: p.ID,
    name: p.Name || `Unit_${p.ID}`,
    jobClass: p.JobClass || "F",
    role: p.Role || "Dealer",
    spriteName,
    element: p.Element || "None",
    level: startingLevel,
    hp: maxHp,
    maxHp,
    fatigue: 100,
    maxFatigue: 100,
    xp: 0,
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
  state.characters.push(ch);
  return { ok: true, character: ch };
}

/** 중복 캐릭 획득 시 조각 누적. */
export function addCharacterShard(charId, count = 1) {
  if (!state) return;
  state.shards = state.shards || {};
  state.shards[charId] = (state.shards[charId] || 0) + count;
}

/** 보유 조각 조회. */
export function getCharacterShards(charId) {
  return state?.shards?.[charId] || 0;
}

/** 자원 차감 (음수 체크). */
export function spendResource(code, amount) {
  if (!state?.resources) return false;
  if ((state.resources[code] || 0) < amount) return false;
  state.resources[code] -= amount;
  emit("state:changed", { path: "resources", code });
  return true;
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

// ─────── 조우형 적 (GDD §5-2) ───────

let _encounterSerial = 1;

/** 조우 인스턴스 생성 → state.encounters에 push. */
export function spawnEncounter(templateId, q, r) {
  if (!state) return null;
  const tpl = _tablesRef?.encounters?.get(templateId);
  if (!tpl) return null;
  const enc = {
    id: `enc_${Date.now()}_${_encounterSerial++}`,
    templateId,
    q, r,
    spawnQ: q, spawnR: r,   // wander 반경 기준
    spawnedAt: state.meta?.turn || 1,
    nextMoveTurn: (state.meta?.turn || 1) + 1,
    discovered: tpl.MovementAI !== "hidden",
    defeatCount: 0,
  };
  state.encounters.push(enc);
  emit("state:changed", { path: "encounters", action: "spawn", id: enc.id });
  return enc;
}

/** 조우 제거 (격파/만료 등). */
export function removeEncounter(encounterId) {
  if (!state) return;
  const idx = state.encounters.findIndex(e => e.id === encounterId);
  if (idx < 0) return;
  state.encounters.splice(idx, 1);
  emit("state:changed", { path: "encounters", action: "remove", id: encounterId });
}

/** 특정 헥스의 조우 (있으면 반환). */
export function getEncounterAt(q, r) {
  return state?.encounters?.find(e => e.q === q && e.r === r) || null;
}

/** 헥스 좌표가 이동 가능한지 (지형·구조물 체크). */
function _canEncounterMoveTo(q, r) {
  if (!_tablesRef) return false;
  const hex = _tablesRef.worldHex?.get(q * 100 + r);
  if (!hex) return false;
  const terrain = _tablesRef.terrains?.get(hex.TerrainID);
  if (!terrain?.Movable) return false;
  // 구조물 헥스 회피 (조우가 도시/관문에 올라가지 않게)
  if (hex.StructureID) return false;
  return true;
}

/** 특정 위치 인접 파티 찾기. */
function _findAdjacentParty(q, r) {
  if (!state?.parties) return null;
  for (const n of hexNeighbors(q, r)) {
    const p = state.parties.find(pp => pp.location.q === n.q && pp.location.r === n.r);
    if (p) return p;
  }
  return null;
}

/** from→to 방향의 1칸 이동 delta (이웃 중 가장 가까운). */
function _stepTowards(fromQ, fromR, toQ, toR) {
  let best = null, bestDist = Infinity;
  for (const n of hexNeighbors(fromQ, fromR)) {
    const d = hexDistance(n.q, n.r, toQ, toR);
    if (d < bestDist && _canEncounterMoveTo(n.q, n.r)) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

/**
 * 턴 종료 시 모든 조우 AI 1 스텝 실행.
 * @returns {Array<{type, encId, partyId?}>} 이벤트 로그 (attack/approach/wander)
 */
export function applyEncounterAI() {
  if (!state?.encounters || !_tablesRef) return [];
  const events = [];
  for (const enc of state.encounters) {
    const tpl = _tablesRef.encounters?.get(enc.templateId);
    if (!tpl) continue;
    const ai = tpl.MovementAI;

    if (ai === "static" || ai === "hidden" || ai === "fixed_route" || ai === "patrol_route") continue;

    // 공격형(random_walk + bandit 타입 or 명시적) — 인접 파티 추적
    const isAggressive = tpl.EncounterType === "bandit" || tpl.EncounterType === "patrol";
    if (isAggressive) {
      const adjParty = _findAdjacentParty(enc.q, enc.r);
      if (adjParty) {
        const step = _stepTowards(enc.q, enc.r, adjParty.location.q, adjParty.location.r);
        if (step) {
          enc.q = step.q; enc.r = step.r;
          if (step.q === adjParty.location.q && step.r === adjParty.location.r) {
            events.push({ type: "attack", encId: enc.id, partyId: adjParty.id });
          } else {
            events.push({ type: "approach", encId: enc.id, partyId: adjParty.id });
          }
          continue;
        }
      }
    }

    // 배회 (wander/random_walk) — 스폰 지점 반경 제한
    if (ai === "wander" || ai === "random_walk") {
      const radius = tpl.EncounterType === "named" ? 3 : 6;
      const candidates = hexNeighbors(enc.q, enc.r).filter(n =>
        _canEncounterMoveTo(n.q, n.r) &&
        hexDistance(n.q, n.r, enc.spawnQ ?? enc.q, enc.spawnR ?? enc.r) <= radius
      );
      if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        enc.q = pick.q; enc.r = pick.r;
        events.push({ type: "wander", encId: enc.id });
      }
    }
  }
  if (events.length) emit("state:changed", { path: "encounters", action: "ai" });
  return events;
}

/**
 * 턴 종료 시 조우 재스폰 (Phase 4 lite).
 * 리전별 상한 + 타입별 카운트 체크. 부족하면 일정 확률로 생성.
 * @returns {Array<object>} 새로 스폰된 조우 인스턴스 배열 (이벤트 로깅용)
 */
export function respawnEncounters(regionTheme = "Ch1") {
  if (!state || !_tablesRef?.encounters) return [];
  const templates = _tablesRef.encounters.all().filter(t =>
    t.RegionTheme === regionTheme || t.RegionTheme === "All"
  );
  if (!templates.length) return [];
  const spawned = [];
  for (const tpl of templates) {
    // 타입별 리전 상한
    const cap = tpl.SpawnCapPerRegion || 1;
    const cur = state.encounters.filter(e => e.templateId === tpl.TemplateID).length;
    if (cur >= cap) continue;
    // 격파 후 대기 시간 체크 (RespawnHours == 0이면 항상 재스폰 시도, >0이면 확률 낮춤)
    // 데모는 턴 기반이라 단순 확률로 처리. 유형별 차이:
    //   static(야생/네임드/함정): 낮은 확률 0.15
    //   aggressive(도적): 중간 0.25
    const pct = tpl.EncounterType === "bandit" ? 0.25 : 0.15;
    if (Math.random() > pct) continue;

    // 스폰 위치 — 홈 반경 5칸 이내 유효 헥스 중 랜덤
    const home = state.family?.homeHex;
    if (!home) continue;
    const radius = 6;
    const candidates = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const q = home.q + dq, r = home.r + dr;
        if (q === home.q && r === home.r) continue;
        if (hexDistance(q, r, home.q, home.r) > radius) continue;
        if (!_canEncounterMoveTo(q, r)) continue;
        // 기존 조우 겹침 방지
        if (state.encounters.some(e => e.q === q && e.r === r)) continue;
        // 파티 위치 겹침 방지
        if (state.parties.some(p => p.location.q === q && p.location.r === r)) continue;
        // 아군 점령 헥스도 제외 (도시에 야수 나오면 이상)
        if (state.ownedHexes?.has(q * 100 + r)) continue;
        candidates.push({ q, r });
      }
    }
    if (!candidates.length) continue;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const enc = spawnEncounter(tpl.TemplateID, pick.q, pick.r);
    if (enc) spawned.push(enc);
  }
  return spawned;
}

/**
 * 신규 세이브에 초기 시드 배치 (리볼도외 주변).
 * 템플릿 ID 1001=야생, 1002=도적, 1004=네임드.
 */
export function seedInitialEncounters() {
  if (!state || state.encounters.length > 0) return;
  const home = state.family.homeHex;
  if (!home) return;
  // 홈(65,45) 주변 헥스에 배치 — 이동 범위 내
  const seeds = [
    { tpl: 1001, q: home.q - 3, r: home.r + 2 },   // 야생
    { tpl: 1001, q: home.q + 2, r: home.r - 3 },   // 야생
    { tpl: 1001, q: home.q - 4, r: home.r - 1 },   // 야생
    { tpl: 1002, q: home.q + 3, r: home.r + 4 },   // 도적
    { tpl: 1002, q: home.q - 5, r: home.r + 5 },   // 도적
    { tpl: 1004, q: home.q + 5, r: home.r - 4 },   // 네임드 (약간 멀리)
  ];
  for (const s of seeds) {
    // 헥스 유효성 검사 + passable 지형만
    const hex = _tablesRef?.worldHex?.get(s.q * 100 + s.r);
    if (!hex) continue;
    const terrain = _tablesRef?.terrains?.get(hex.TerrainID);
    if (!terrain?.Movable) continue;
    spawnEncounter(s.tpl, s.q, s.r);
  }
}

/**
 * 곡물 비용 휴식 — 회복 필요분에 비례 (1 곡물 = 10 피로 회복, 슬롯별 합산).
 * 만피로 슬롯은 비용 0 (의미 없음). 풀피로 풀파티는 비용 0 → 비활성 권장.
 * GDD `fatigue_balance_table.md §5-3` 정식판: 음식 시스템(배럭). 데모는 곡물 prox.
 * @returns {{ ok, cost, missing? }}
 */
export const REST_FATIGUE_PER_GRAIN = 10;  // 1 곡물 = 10 피로
export function getRestCost(party) {
  if (!party) return 0;
  let total = 0;
  for (const cid of party.slots) {
    if (cid == null) continue;
    const ch = state?.characters.find(c => c.id === cid);
    if (!ch) continue;
    const missing = (ch.maxFatigue || 100) - (ch.fatigue || 0);
    if (missing > 0) total += Math.ceil(missing / REST_FATIGUE_PER_GRAIN);
  }
  return total;
}
export function restPartyWithGrain(partyId) {
  if (!state) return { ok: false, reason: "no_state" };
  const party = state.parties.find(p => p.id === partyId);
  if (!party) return { ok: false, reason: "no_party" };
  const cost = getRestCost(party);
  if (cost === 0) return { ok: false, reason: "no_need" };  // 이미 풀피로
  const have = state.resources?.grain || 0;
  if (have < cost) return { ok: false, reason: "insufficient", cost, have, missing: cost - have };
  state.resources.grain = have - cost;
  for (const cid of party.slots) {
    if (cid == null) continue;
    const ch = getCharacter(cid);
    if (ch) {
      ch.fatigue = ch.maxFatigue;
      ch.status = "normal";
    }
  }
  emit("state:changed", { path: "parties", partyId, action: "rest" });
  return { ok: true, cost };
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

// ─────── 성장 카테고리 일반화 (training / research / fortification 공유 룰) ───────
//
// 모든 카테고리가 동일 컬럼 (Type / Level / UnlockFamilyLv / CostRes1~3 / CostAmt1~3 / EffectType[/2] / EffectValue[/2])
// state 키는 각각: state.training, state.research, state.fortification
// 테이블 키는 각각: tables.training, tables.research, tables.fortification
// Type 컬럼 이름은 각각: TrainingType, ResearchType, FortType
const GROWTH_CONFIG = {
  training:      { stateKey: "training",      tableKey: "training",      typeCol: "TrainingType" },
  research:      { stateKey: "research",      tableKey: "research",      typeCol: "ResearchType" },
  fortification: { stateKey: "fortification", tableKey: "fortification", typeCol: "FortType" },
};

/** 일반화 — 카테고리/타입의 현재 투자 Lv. */
export function getGrowthLevel(category, type) {
  const cfg = GROWTH_CONFIG[category];
  if (!cfg) return 0;
  return state?.[cfg.stateKey]?.[type] || 0;
}

/** 일반화 — 다음 Lv 행. 최대 도달 시 null. */
export function getNextGrowthRow(category, type, tables) {
  const cfg = GROWTH_CONFIG[category];
  if (!cfg) return null;
  const cur = getGrowthLevel(category, type);
  return tables[cfg.tableKey].all().find(
    r => r[cfg.typeCol] === type && r.Level === (cur + 1)
  ) || null;
}

/** 일반화 — 자원/가문Lv 게이팅 체크. */
export function canAffordGrowth(row) {
  if (!row) return { ok: false, reason: "max" };
  const familyLv = state?.family?.level || 1;
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

/** 일반화 — 투자 실행. 자원 차감 + Lv +1. */
export function investGrowth(category, type, tables) {
  const cfg = GROWTH_CONFIG[category];
  if (!cfg) return { ok: false, reason: "unknown_category" };
  const row = getNextGrowthRow(category, type, tables);
  const check = canAffordGrowth(row);
  if (!check.ok) return { ok: false, reason: check.reason };

  if (row.CostRes1 && row.CostAmt1) state.resources[row.CostRes1] = (state.resources[row.CostRes1] || 0) - row.CostAmt1;
  if (row.CostRes2 && row.CostAmt2) state.resources[row.CostRes2] = (state.resources[row.CostRes2] || 0) - row.CostAmt2;
  if (row.CostRes3 && row.CostAmt3) state.resources[row.CostRes3] = (state.resources[row.CostRes3] || 0) - row.CostAmt3;

  if (!state[cfg.stateKey]) state[cfg.stateKey] = {};
  state[cfg.stateKey][type] = (state[cfg.stateKey][type] || 0) + 1;
  emit("state:changed", { path: cfg.stateKey, type, action: "invest" });
  return { ok: true, row };
}

/** 일반화 — 누적 효과 합. */
export function getGrowthEffectSum(category, type, effectType, tables) {
  const cfg = GROWTH_CONFIG[category];
  if (!cfg || !tables?.[cfg.tableKey]) return 0;
  const cur = getGrowthLevel(category, type);
  if (cur === 0) return 0;
  let sum = 0;
  const rows = tables[cfg.tableKey].all().filter(
    r => r[cfg.typeCol] === type && r.Level <= cur
  );
  for (const r of rows) {
    if (r.EffectType === effectType) sum += (r.EffectValue || 0);
    if (r.EffectType2 === effectType) sum += (r.EffectValue2 || 0);
  }
  return sum;
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
    PEN_PCT: "pen", RES_PCT: "res",
    // INT_PCT는 ATK alias (Wizard/Warlock의 마법 공격력 = ATK 보정)
    INT_PCT: "atk",
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
