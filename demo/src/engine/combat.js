// High-level combat orchestrator — wraps battleSimulator for the demo flow.
import { simulate, playerToSimUnit, enemyToSimUnit } from "./battleSimulator.js";

/**
 * Resolve a single battle (one wave) and return BattleRecord-like result
 * plus convenient summary fields for the UI.
 */
export function resolveCombat(playerChars, enemyParty, terrainBonus, tables) {
  const playerUnits = playerChars.map(c => playerToSimUnit(c, tables.fieldObjects));

  const enemyTemplates = [
    enemyParty.Slot1, enemyParty.Slot2, enemyParty.Slot3,
  ].filter(id => id != null).map(id =>
    tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy")
  );

  // 적 레벨 = Region.Strength × HexLevel (RegionTable.Strength 적용으로 권역별 난이도 차등)
  const region = tables.regions.get(enemyParty.RegionID);
  const strength = region?.Strength ?? 1;
  const scaledLevel = Math.max(1, strength * (enemyParty.HexLevel || 1));
  const enemyUnits = enemyTemplates.map(t => enemyToSimUnit(t, scaledLevel));

  // Apply terrain bonus to player units (ATK/DEF flat bonus from TerrainTable).
  if (terrainBonus) {
    for (const u of playerUnits) {
      u.atk += terrainBonus.CombatBonusATK || 0;
      u.def += terrainBonus.CombatBonusDEF || 0;
      u.spd += terrainBonus.CombatBonusSPD || 0;
    }
  }

  const record = simulate(playerUnits, enemyUnits);
  const win = record.result === "victory";

  // Extract per-unit final HP for caller convenience.
  const playerAfter = playerUnits.map((_, i) => ({
    id: playerChars[i].id,
    name: playerChars[i].name,
    hp: record.finalHp[i] ?? 0,
    maxHp: playerUnits[i].maxHp,
  }));
  const enemyAfter = enemyUnits.map((u, i) => ({
    name: u.name,
    hp: record.finalHp[playerUnits.length + i] ?? 0,
    maxHp: u.maxHp,
  }));

  return {
    win,
    rounds: record.totalTurns,
    record,
    playerAfter,
    enemyAfter,
    log: record.actions,
    rewards: win ? lookupDropReward("subjugate", tables, /*hexLevel*/ enemyParty.HexLevel || 1) : null,
  };
}

/** Look up DropTable reward for a battle (BattleType + HexLevel). */
export function lookupDropReward(battleType, tables, hexLevel) {
  const drops = tables.drops.all();
  const row = drops.find(d => d.BattleType === battleType && d.HexLevel === hexLevel)
            || drops.find(d => d.BattleType === battleType
                            && (d.HexLevelMin ?? d.HexLevel) <= hexLevel
                            && (d.HexLevelMax ?? d.HexLevel) >= hexLevel);
  if (!row) return { gold: 0, vis: 0, grain: 0, charExp: 0, familyExp: 0 };
  return {
    gold: row.Gold || 0,
    vis: row.Vis || 0,
    grain: row.SupplyGrain || 0,
    charExp: row.CharEXP || 0,
    familyExp: row.FamilyEXP || 0,
  };
}

/** Find enemy parties for a hex by RegionID + HexLevel match. */
export function findEnemyParties(hex, tables) {
  return tables.enemyParties.all()
    .filter(ep => ep.RegionID === hex.RegionID && ep.HexLevel === hex.HexLevel)
    .sort((a, b) => a.PartyIndex - b.PartyIndex);
}

/**
 * 구조물(관문/거점/도시/던전) 수비대 — GDD project_structure_battle.md 기준.
 * 4축 체계: 경비대(Patrol) → 수비대(Garrison) → 주둔군(Stationed) 순차 만남.
 * 각 layer의 Lv는 StructureTable의 PatrolLv/GarrisonLv/StationedLv 사용.
 */
export function findStructureDefenders(structureId, tables) {
  const struct = tables.structures.get(structureId);
  if (!struct) return [];

  const LAYER_ORDER = { Patrol: 0, Garrison: 1, Stationed: 2 };
  const LAYER_LV = {
    Patrol: struct.PatrolLv || 0,
    Garrison: struct.GarrisonLv || 0,
    Stationed: struct.StationedLv || 0,
  };
  // 적 레벨: 각 layer Lv × 5 (Patrol 약 / Garrison 중 / Stationed 강)
  const LAYER_MULT = { Patrol: 5, Garrison: 10, Stationed: 15 };
  const LAYER_NAME_KR = { Patrol: "경비대", Garrison: "수비대", Stationed: "주둔군" };

  return tables.structureDefense.all()
    .filter(d => d.StructureID === structureId)
    .sort((a, b) => {
      const la = LAYER_ORDER[a.DefenseLayer] ?? 99;
      const lb = LAYER_ORDER[b.DefenseLayer] ?? 99;
      if (la !== lb) return la - lb;
      return (a.WaveIndex || 0) - (b.WaveIndex || 0);
    })
    .map(d => {
      const layerLv = LAYER_LV[d.DefenseLayer] || 1;
      const layerMult = LAYER_MULT[d.DefenseLayer] || 5;
      return {
        PartyID: d.DefenseID,
        RegionID: 0,
        HexLevel: 1,
        PartyIndex: d.WaveIndex,
        PartyCount: 0,
        Slot1: d.Slot1, Slot1Role: d.Slot1Role,
        Slot2: d.Slot2, Slot2Role: d.Slot2Role,
        Slot3: d.Slot3, Slot3Role: d.Slot3Role,
        EnemyLevel: Math.max(1, layerLv * layerMult),
        EnemyStar: 0,
        __isStructure: true,
        __layer: d.DefenseLayer,
        __layerName: LAYER_NAME_KR[d.DefenseLayer] || d.DefenseLayer,
        __structureType: struct.StructureType,
      };
    });
}
