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

  // 적 레벨 산정:
  //   - 구조물 수비대: findStructureDefenders가 미리 산정한 EnemyLevel (PatrolLv×5 등) 사용
  //   - 일반 필드 적: Region.Strength × HexLevel (권역별 난이도)
  let scaledLevel;
  if (enemyParty.__isStructure) {
    scaledLevel = Math.max(1, enemyParty.EnemyLevel || 1);
  } else {
    const region = tables.regions.get(enemyParty.RegionID);
    const strength = region?.Strength ?? 1;
    scaledLevel = Math.max(1, strength * (enemyParty.HexLevel || 1));
  }
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

// ─────── 구조물 공성 시스템 (gdd_structure_siege.md §2~§4) ───────

// §2: DurabilityLv → MaxHP (관문/도시/던전)
const DURABILITY_HP = {
  Gate:    [0, 500, 800, 1200, 1800, 2500, 3500, 5000, 7000, 9000, 12000],
  City:    [0, 1000, 1500, 2500, 4000, 5500, 7500, 10000, 14000, 18000, 24000],
  Dungeon: [0, 300, 500, 800, 1200, 1800, 2500, 3500, 5000, 7000, 9000],
  Fort:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],  // 거점은 내구도 없음
};

export function getStructureMaxHP(structure) {
  if (!structure) return 0;
  const table = DURABILITY_HP[structure.StructureType];
  if (!table) return 0;
  const lv = Math.max(0, Math.min(10, structure.DurabilityLv || 0));
  return table[lv];
}

// §3-1: 직업별 공성치
const SIEGE_APTITUDE = {
  F: 40,   // Fighter — 근접 A
  M: 48,   // Musketeer — 화력 S
  S: 28,   // Scout — 기동 C
  W: 32,   // Wizard — 책략 B
  L: 32,   // Warlock — 책략 B
};

// §3-3: 사기(피로도) 보정 — battle_logic_spec.md §4-4 동일
function siegeFatigueMultiplier(fatigue) {
  if (fatigue >= 71) return 1.00;
  if (fatigue >= 51) return 0.95;
  if (fatigue >= 31) return 0.85;
  if (fatigue >= 11) return 0.70;
  return 0.50;
}

/**
 * 파티의 공성치 = 슬롯 1+2+3 캐릭터 공성치 합 × 평균 사기 보정.
 * @param {object[]} chars  - 활성 캐릭터 (gameState format)
 */
export function getPartySiegeDamage(chars) {
  if (!chars || chars.length === 0) return 0;
  let total = 0;
  let avgFat = 0;
  for (const c of chars) {
    total += SIEGE_APTITUDE[c.jobClass] ?? 30;
    avgFat += c.fatigue ?? 100;
  }
  avgFat /= chars.length;
  const mult = siegeFatigueMultiplier(avgFat);
  return Math.max(1, Math.floor(total * mult));
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
  // 적 레벨 = 8 + StationedLv × 8 → Sta1=16, Sta9=80 (Player 권장 Lv와 매칭)
  const enemyLevel = Math.max(1, 8 + (struct.StationedLv || 1) * 8);
  const enemyStar = Math.max(0, (struct.GarrisonLv || 0) - 1);
  const LAYER_NAME_KR = { Patrol: "경비대", Garrison: "수비대", Stationed: "주둔군" };

  return tables.structureDefense.all()
    .filter(d => d.StructureID === structureId)
    .sort((a, b) => {
      const la = LAYER_ORDER[a.DefenseLayer] ?? 99;
      const lb = LAYER_ORDER[b.DefenseLayer] ?? 99;
      if (la !== lb) return la - lb;
      return (a.WaveIndex || 0) - (b.WaveIndex || 0);
    })
    .map(d => ({
      PartyID: d.DefenseID,
      RegionID: 0,
      HexLevel: 1,
      PartyIndex: d.WaveIndex,
      PartyCount: 0,
      Slot1: d.Slot1, Slot1Role: d.Slot1Role,
      Slot2: d.Slot2, Slot2Role: d.Slot2Role,
      Slot3: d.Slot3, Slot3Role: d.Slot3Role,
      EnemyLevel: enemyLevel,
      EnemyStar: enemyStar,
      __isStructure: true,
      __layer: d.DefenseLayer,
      __layerName: LAYER_NAME_KR[d.DefenseLayer] || d.DefenseLayer,
      __structureType: struct.StructureType,
    }));
}
