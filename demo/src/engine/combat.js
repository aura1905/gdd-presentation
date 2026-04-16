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
