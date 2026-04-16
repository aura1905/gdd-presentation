// Mutable game state — single source of truth.
// Changes only through exported action functions.
import { emit } from "../util/events.js";

let state = null;

export function getState() { return state; }

export function initState(tables) {
  const startHex = { q: 65, r: 45 };  // Reboldoeux city

  // Pick starting characters: first 6 active Player units from FieldObjectTable
  const players = tables.fieldObjects.all()
    .filter(r => r.ObjectType === "Player" && r.IsActivate)
    .slice(0, 6);

  const characters = players.map((p, i) => ({
    id: p.ID,
    name: p.Name || `Unit_${p.ID}`,
    jobClass: p.JobClass || "F",
    role: p.Role || "Dealer",
    level: 1,
    hp: p.BaseHP,
    maxHp: p.BaseHP,
    fatigue: 0,        // 피로도: 0=최상, 이동/전투마다 증가, 80%+경고, 100%탈진
    maxFatigue: 100,   // 피로단련 레벨업 시 110, 120 등으로 확장 (여유분)
    stats: {
      atk: p.BaseATK, def: p.BaseDEF, spd: p.BaseSPD,
      cri: p.BaseCRI || 5, acc: p.BaseACC || 95, evd: p.BaseEVD || 5,
    },
    status: "normal",
  }));

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
    capturedStructures: new Set(),  // StructureID set — 점령한 구조물
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
  // Apply fatigue to party members
  for (const cid of party.slots) {
    if (cid == null) continue;
    const ch = state.characters.find(c => c.id === cid);
    if (ch) {
      ch.fatigue = Math.min(ch.maxFatigue, ch.fatigue + fatigueCost);
      const pct = ch.fatigue / ch.maxFatigue * 100;
      if (pct >= 100) ch.status = "exhausted";
      else if (pct >= 80) ch.status = "tired";
      else ch.status = "normal";
    }
  }
  emit("state:changed", { path: "parties", partyId, action: "move" });
}

// Restore from saved JSON (localStorage)
export function restoreState(saved, tables) {
  state = saved;
  // capturedStructures was serialized as array, convert back to Set
  if (Array.isArray(state.capturedStructures)) {
    state.capturedStructures = new Set(state.capturedStructures);
  } else if (!state.capturedStructures) {
    state.capturedStructures = new Set();
  }
  emit("state:init", state);
  return state;
}

export function getCharacter(id) {
  return state?.characters.find(c => c.id === id) || null;
}

export function isStructureCaptured(structureId) {
  return state?.capturedStructures.has(structureId) || false;
}

export function captureStructure(structureId) {
  state.capturedStructures.add(structureId);
  emit("state:changed", { path: "capturedStructures", structureId });
}
