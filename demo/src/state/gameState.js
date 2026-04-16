// Mutable game state — single source of truth.
// Changes only through exported action functions.
import { emit } from "../util/events.js";

let state = null;

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
    territoryLv: 0,   // FortificationTable territory: Lv 0 = 15슬롯, Lv33 = 81슬롯
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
  emit("state:changed", { path: "capturedStructures", structureId });
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
