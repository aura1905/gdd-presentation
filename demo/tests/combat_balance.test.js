// 자동 검증: Lv1 플레이어 6명 vs Region 1 HexLevel 1 적 100회 전투
import { describe, it, expect } from "vitest";
import { simulate, playerToSimUnit, enemyToSimUnit } from "../src/engine/battleSimulator.js";
import { findEnemyParties } from "../src/engine/combat.js";
import fs from "node:fs";

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function loadTables() {
  const dir = "data/tables";
  const make = (rows, pk) => ({
    all: () => rows,
    get: (k) => rows.find(r => r[pk] === k),
    _index: new Map(rows.map(r => [r[pk], r])),
  });
  return {
    fieldObjects: make(loadJson(`${dir}/field_objects.json`), "ID"),
    enemyParties: make(loadJson(`${dir}/enemy_parties.json`), "PartyID"),
    worldHex:     make(loadJson(`${dir}/world_hex.json`), "HexID"),
    terrains:     make(loadJson(`${dir}/terrains.json`), "TerrainID"),
    regions:      make(loadJson(`${dir}/regions.json`), "RegionID"),
    drops:        make(loadJson(`${dir}/drops.json`), "ID"),
    characterExp: make(loadJson(`${dir}/character_exp.json`), "Level"),
  };
}

function makePlayerChar(tmpl, level = 20) {
  const lvUp = level - 1;
  const maxHp = (tmpl.BaseHP || 0) + (tmpl.GrowthHP || 0) * lvUp;
  return {
    id: tmpl.ID, name: tmpl.Name, jobClass: tmpl.JobClass, role: tmpl.Role,
    level, hp: maxHp, maxHp, fatigue: 100, maxFatigue: 100,
    stats: {
      atk: (tmpl.BaseATK || 0) + (tmpl.GrowthATK || 0) * lvUp,
      def: (tmpl.BaseDEF || 0) + (tmpl.GrowthDEF || 0) * lvUp,
      spd: (tmpl.BaseSPD || 0) + (tmpl.GrowthSPD || 0) * lvUp,
      cri: (tmpl.BaseCRI || 5) + (tmpl.GrowthCRI || 0) * lvUp,
      crd: (tmpl.BaseCRD || 130) + (tmpl.GrowthCRD || 0) * lvUp,
      acc: tmpl.BaseACC || 95, evd: tmpl.BaseEVD || 5, pen: tmpl.BasePEN || 0,
    },
  };
}

describe("Balance: 연속 전투 (HP 누적 손상)", () => {
  it("R1 HexLv1 5연속 전투 (휴식 없이)", () => {
    const tables = loadTables();
    const players6 = tables.fieldObjects.all()
      .filter(r => r.ObjectType === "Player" && r.IsActivate)
      .slice(0, 6).map(t => makePlayerChar(t, 1));
    const partyChars = players6.slice(0, 3);

    const hex = tables.worldHex.all().find(h => h.RegionID === 1 && h.HexLevel === 1);
    const enemyParty = findEnemyParties(hex, tables)[0];
    const region = tables.regions.get(enemyParty.RegionID);
    const scaledLv = Math.max(1, region.Strength * (enemyParty.HexLevel || 1));

    const enemyTemplates = [enemyParty.Slot1, enemyParty.Slot2, enemyParty.Slot3]
      .filter(Boolean)
      .map(id => tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy"));

    const playerUnits = partyChars.map(c => playerToSimUnit(c, tables.fieldObjects));

    for (let battle = 1; battle <= 5; battle++) {
      const eu = enemyTemplates.map(t => enemyToSimUnit(t, scaledLv));
      const rec = simulate(playerUnits, eu);
      const hpStr = playerUnits.map((u, i) => `${u.name}HP${rec.finalHp[i]}/${u.maxHp}`).join(" ");
      console.log(`  전투${battle}: ${rec.result === "victory" ? "승" : "패"} (${rec.totalTurns}r) → ${hpStr}`);
      // HP 반영 (휴식 없이 다음 전투)
      for (let i = 0; i < playerUnits.length; i++) playerUnits[i].hp = rec.finalHp[i];
      if (rec.result !== "victory") break;
    }
  });
});

describe("Balance: Strength×HexLevel scaling — Lv1 player", () => {
  for (const [rid, hexLv, label] of [
    [1, 1, "R1 (Str=1) HexLv1"],
    [1, 2, "R1 (Str=1) HexLv2"],
    [3, 1, "R3 (Str=1) HexLv1"],
    [4, 1, "R4 (Str=3) HexLv1"],
    [5, 1, "R5 (Str=4) HexLv1"],
  ]) {
    it(label, () => {
      const tables = loadTables();
      const players6 = tables.fieldObjects.all()
        .filter(r => r.ObjectType === "Player" && r.IsActivate)
        .slice(0, 6).map(t => makePlayerChar(t, 1));   // ← Lv1 플레이어!
      const partyChars = players6.slice(0, 3);

      const hex = tables.worldHex.all().find(h => h.RegionID === rid && h.HexLevel === hexLv);
      if (!hex) { console.log(`  ${label}: 헥스 없음`); return; }
      const enemies = findEnemyParties(hex, tables);
      if (enemies.length === 0) { console.log(`  ${label}: 적 없음`); return; }
      const enemyParty = enemies[0];

      const region = tables.regions.get(enemyParty.RegionID);
      const strength = region?.Strength ?? 1;
      const scaledLv = Math.max(1, strength * (enemyParty.HexLevel || 1));

      const playerUnits = partyChars.map(c => playerToSimUnit(c, tables.fieldObjects));
      const enemyTemplates = [enemyParty.Slot1, enemyParty.Slot2, enemyParty.Slot3]
        .filter(Boolean)
        .map(id => tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy"));
      const enemyUnits = enemyTemplates.map(t => enemyToSimUnit(t, scaledLv));

      const N = 100;
      let wins = 0, totalRounds = 0;
      for (let i = 0; i < N; i++) {
        const pu = playerUnits.map(u => ({ ...u, hp: u.maxHp }));
        const eu = enemyUnits.map(u => ({ ...u, hp: u.maxHp }));
        const rec = simulate(pu, eu);
        if (rec.result === "victory") wins++;
        totalRounds += rec.totalTurns;
      }
      const sampleEnemy = enemyUnits[0];
      console.log(`  ${label} (적Lv ${scaledLv}, 샘플 ${sampleEnemy.name} HP${sampleEnemy.maxHp} ATK${sampleEnemy.atk} DEF${sampleEnemy.def} SPD${sampleEnemy.spd}): ${(wins/N*100).toFixed(0)}% 승률, ${(totalRounds/N).toFixed(1)}라운드`);
    });
  }
});

describe("Balance (legacy): Lv20 player vs Region 1", () => {
  for (const hexLv of [1, 2]) {
    it(`HexLevel ${hexLv}`, () => {
      const tables = loadTables();
      const players6 = tables.fieldObjects.all()
        .filter(r => r.ObjectType === "Player" && r.IsActivate)
        .slice(0, 6).map(t => makePlayerChar(t, 20));
      const partyChars = players6.slice(0, 3);

      const hex = tables.worldHex.all().find(h => h.RegionID === 1 && h.HexLevel === hexLv);
      if (!hex) { console.log(`  R1 HexLv${hexLv}: 헥스 없음`); return; }
      const enemies = findEnemyParties(hex, tables);
      if (enemies.length === 0) { console.log(`  R1 HexLv${hexLv}: 적 파티 없음`); return; }
      const enemyParty = enemies[0];

      const playerUnits = partyChars.map(c => playerToSimUnit(c, tables.fieldObjects));
      const enemyTemplates = [enemyParty.Slot1, enemyParty.Slot2, enemyParty.Slot3]
        .filter(Boolean)
        .map(id => tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy"));
      const enemyUnits = enemyTemplates.map(t => enemyToSimUnit(t, enemyParty.EnemyLevel));

      const N = 100;
      let wins = 0, totalRounds = 0;
      for (let i = 0; i < N; i++) {
        const pu = playerUnits.map(u => ({ ...u, hp: u.maxHp }));
        const eu = enemyUnits.map(u => ({ ...u, hp: u.maxHp }));
        const rec = simulate(pu, eu);
        if (rec.result === "victory") wins++;
        totalRounds += rec.totalTurns;
      }
      console.log(`  R1 HexLv${hexLv} (적 EnemyLv${enemyParty.EnemyLevel}, ${enemyTemplates.map(t => t?.Name).join("+")}): ${(wins/N*100).toFixed(0)}% 승률, ${(totalRounds/N).toFixed(1)}라운드`);
    });
  }
});

describe("Balance: Lv1 player vs Region 1 HexLevel 1 (legacy reference)", () => {
  it("reports win rate", () => {
    const tables = loadTables();
    const players6 = tables.fieldObjects.all()
      .filter(r => r.ObjectType === "Player" && r.IsActivate)
      .slice(0, 6).map(t => makePlayerChar(t, 1));  // Lv1 reference
    const partyChars = players6.slice(0, 3);

    // Find a Lv1 hex in region 1
    const hex = tables.worldHex.all().find(
      h => h.RegionID === 1 && h.HexLevel === 1
    );
    expect(hex).toBeTruthy();
    const enemies = findEnemyParties(hex, tables);
    expect(enemies.length).toBeGreaterThan(0);
    const enemyParty = enemies[0];

    const playerUnits = partyChars.map(c => playerToSimUnit(c, tables.fieldObjects));
    const enemyTemplates = [enemyParty.Slot1, enemyParty.Slot2, enemyParty.Slot3]
      .filter(Boolean)
      .map(id => tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy"));
    const enemyUnits = enemyTemplates.map(t => enemyToSimUnit(t, enemyParty.EnemyLevel));

    const N = 100;
    let wins = 0;
    let totalRounds = 0;
    let drawnFirst = { player: 0, enemy: 0 };

    // Pre-stat snapshot
    console.log("\n=== Player party ===");
    for (const u of playerUnits) {
      console.log(`  ${u.name.padEnd(10)} ${u.role.padEnd(8)} El=${u.element.padEnd(6)} HP=${u.maxHp} ATK=${u.atk} DEF=${u.def} SPD=${u.spd}`);
    }
    console.log("\n=== Enemy party (PartyID " + enemyParty.PartyID + ", EnemyLevel " + enemyParty.EnemyLevel + ") ===");
    for (const u of enemyUnits) {
      console.log(`  ${u.name.padEnd(10)} ${u.role.padEnd(8)} El=${u.element.padEnd(6)} HP=${u.maxHp} ATK=${u.atk} DEF=${u.def} SPD=${u.spd}`);
    }

    for (let i = 0; i < N; i++) {
      // Reset HP
      const pu = playerUnits.map(u => ({ ...u, hp: u.maxHp }));
      const eu = enemyUnits.map(u => ({ ...u, hp: u.maxHp }));
      const rec = simulate(pu, eu);
      if (rec.result === "victory") wins++;
      totalRounds += rec.totalTurns;
    }

    const winRate = (wins / N * 100).toFixed(1);
    const avgRounds = (totalRounds / N).toFixed(1);
    console.log(`\n=== Result over ${N} trials ===`);
    console.log(`  Win rate: ${winRate}% (${wins}/${N})`);
    console.log(`  Avg rounds: ${avgRounds}`);
  });
});
