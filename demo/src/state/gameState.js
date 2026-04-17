// Mutable game state — single source of truth.
// Changes only through exported action functions.
import { emit } from "../util/events.js";

let state = null;

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

  // 시작 헥스 = 리볼도외 도시. 모든 구성 헥스 + 도시 구조물 자동 점령.
  const homeHexId = startHex.q * 100 + startHex.r;
  const homeHexRow = tables.worldHex.get(homeHexId);
  const ownedHexes = new Set([homeHexId]);
  const capturedStructures = new Set();
  if (homeHexRow?.StructureID) capturedStructures.add(homeHexRow.StructureID);
  // 같은 StructureID(도시 7헥스 등)를 가진 모든 헥스 자동 점령
  if (homeHexRow?.StructureID) {
    for (const hx of tables.worldHex.all()) {
      if (hx.StructureID === homeHexRow.StructureID) ownedHexes.add(hx.HexID);
    }
  }

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
    // 공성 진행 상태: { [structureId]: { hp, defeatedDefenseIds: [DefenseID] } }
    siegeState: {},
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
  if (!state.siegeState) state.siegeState = {};

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
  const home = state.family?.homeHex;
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

/** Apply level-based stat growth from FieldObjectTable Growth fields. */
export function recomputeStatsFromLevel(charId, fieldObjectsTable) {
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
  // HP cap clamping
  if (ch.hp > ch.maxHp) ch.hp = ch.maxHp;
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

/** 구조물의 현재 공성 진행 상태 (없으면 새로 생성). */
export function getSiegeProgress(structureId, maxHp) {
  if (!state.siegeState) state.siegeState = {};
  if (!state.siegeState[structureId]) {
    state.siegeState[structureId] = { hp: maxHp, defeatedDefenseIds: [] };
  }
  return state.siegeState[structureId];
}

export function getStructureCurrentHP(structureId) {
  return state?.siegeState?.[structureId]?.hp;
}

/** 수비 웨이브 격파 마킹. */
export function markDefenderDefeated(structureId, defenseId, maxHp) {
  const sp = getSiegeProgress(structureId, maxHp);
  if (!sp.defeatedDefenseIds.includes(defenseId)) {
    sp.defeatedDefenseIds.push(defenseId);
  }
}

/** 격파 여부 확인. */
export function isDefenderDefeated(structureId, defenseId) {
  return state?.siegeState?.[structureId]?.defeatedDefenseIds?.includes(defenseId) || false;
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

export function getTerritoryUsedSlots() {
  return state?.ownedHexes.size || 0;
}

export function canOccupyMore() {
  return getTerritoryUsedSlots() < getTerritoryMaxSlots();
}
