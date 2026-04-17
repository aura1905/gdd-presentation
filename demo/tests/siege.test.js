// 구조물 공성 시뮬레이션 — 데모 룰 검증.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { simulate, playerToSimUnit, enemyToSimUnit } from "../src/engine/battleSimulator.js";
import {
  findStructureDefenders, getStructureMaxHP, getPartySiegeDamage,
} from "../src/engine/combat.js";

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function loadTables() {
  const dir = "data/tables";
  const make = (rows, pk) => ({
    all: () => rows,
    get: (k) => rows.find(r => r[pk] === k),
    _index: new Map(rows.map(r => [r[pk], r])),
  });
  return {
    fieldObjects:     make(loadJson(`${dir}/field_objects.json`), "ID"),
    enemyParties:     make(loadJson(`${dir}/enemy_parties.json`), "PartyID"),
    worldHex:         make(loadJson(`${dir}/world_hex.json`), "HexID"),
    terrains:         make(loadJson(`${dir}/terrains.json`), "TerrainID"),
    regions:          make(loadJson(`${dir}/regions.json`), "RegionID"),
    drops:            make(loadJson(`${dir}/drops.json`), "ID"),
    characterExp:     make(loadJson(`${dir}/character_exp.json`), "Level"),
    structures:       make(loadJson(`${dir}/structures.json`), "StructureID"),
    structureDefense: make(loadJson(`${dir}/structure_defense.json`), "DefenseID"),
  };
}

function makePlayerChar(tmpl, level = 1) {
  const lvUp = level - 1;
  const maxHp = (tmpl.BaseHP || 0) + (tmpl.GrowthHP || 0) * lvUp;
  return {
    id: tmpl.ID, name: tmpl.Name, jobClass: tmpl.JobClass, role: tmpl.Role,
    level, hp: maxHp, maxHp, fatigue: 100, maxFatigue: 100,
    stats: {
      atk: (tmpl.BaseATK || 0) + (tmpl.GrowthATK || 0) * lvUp,
      def: (tmpl.BaseDEF || 0) + (tmpl.GrowthDEF || 0) * lvUp,
      spd: (tmpl.BaseSPD || 0) + (tmpl.GrowthSPD || 0) * lvUp,
      cri: tmpl.BaseCRI || 5, crd: tmpl.BaseCRD || 130,
      acc: tmpl.BaseACC || 95, evd: tmpl.BaseEVD || 5, pen: tmpl.BasePEN || 0,
    },
  };
}

/** 한 파티의 공성 1회 시도. 반환: { won, totalWins, defeatedDefenseIds, siegeDamage } */
function attemptSiege(tables, structure, partyChars, alreadyDefeated /* Set */) {
  // 데모 룰: Patrol은 매번 등장, Garrison/Stationed 격파된건 제외
  const allDefenders = findStructureDefenders(structure.StructureID, tables);
  const enemies = allDefenders.filter(d => {
    if (d.__layer === "Patrol") return true;
    return !alreadyDefeated.has(d.PartyID);
  });

  if (enemies.length === 0) {
    // 수비 다 잡힌 상태 — 바로 HP 데미지만
    return { won: true, totalWins: 0, newDefeated: [], siegeDamage: getPartySiegeDamage(partyChars) };
  }

  const playerUnits = partyChars.map(c => playerToSimUnit(c, tables.fieldObjects));
  let totalWins = 0;
  const newDefeated = [];

  for (const ep of enemies) {
    const enemyTemplates = [ep.Slot1, ep.Slot2, ep.Slot3]
      .filter(Boolean)
      .map(id => tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy"));
    const lvl = ep.__isStructure ? Math.max(1, ep.EnemyLevel) : 1;
    const enemyUnits = enemyTemplates.map(t => enemyToSimUnit(t, lvl));

    // HP 리셋 (각 웨이브 풀회복 — 우리 sim 동작)
    const pu = playerUnits.map(u => ({ ...u, hp: u.maxHp }));
    const eu = enemyUnits.map(u => ({ ...u, hp: u.maxHp }));
    const rec = simulate(pu, eu);

    if (rec.result === "victory") {
      totalWins++;
      if (ep.__layer !== "Patrol") newDefeated.push(ep.PartyID);
    } else {
      break;  // 패배 → 진행 멈춤
    }
  }

  // 전체 격파 시 HP 데미지
  const allCleared = enemies.every(e => totalWins >= enemies.indexOf(e) + 1);
  let siegeDamage = 0;
  if (allCleared && totalWins === enemies.length) {
    // 모든 수비 + 비-Patrol 다 격파 상태면 HP 데미지
    const totalNonPatrol = allDefenders.filter(d => d.__layer !== "Patrol");
    const allDown = totalNonPatrol.every(d =>
      alreadyDefeated.has(d.PartyID) || newDefeated.includes(d.PartyID)
    );
    if (allDown) siegeDamage = getPartySiegeDamage(partyChars);
  }

  return { won: totalWins === enemies.length, totalWins, newDefeated, siegeDamage };
}

describe("Structure Siege — Lv1 player vs gates", () => {
  const tables = loadTables();
  const players6 = tables.fieldObjects.all()
    .filter(r => r.ObjectType === "Player" && r.IsActivate)
    .slice(0, 6).map(t => makePlayerChar(t, 1));
  const partyChars = players6.slice(0, 3);

  it("Gate ID 41 (Lv1 플레이어로 함락 시도)", () => {
    const struct = tables.structures.get(41);
    const maxHp = getStructureMaxHP(struct);
    const expectedDamage = getPartySiegeDamage(partyChars);
    console.log(`\n=== 관문 ID 41 (${struct.StructureType}) ===`);
    console.log(`  PatrolLv${struct.PatrolLv}/GarrisonLv${struct.GarrisonLv}/StationedLv${struct.StationedLv}/DurabilityLv${struct.DurabilityLv}`);
    console.log(`  HP=${maxHp}, 1파티 공성치=${expectedDamage} (사기100)`);
    console.log(`  파티: ${partyChars.map(c => `${c.name}(${c.jobClass})`).join(",")}`);

    let hp = maxHp;
    const defeated = new Set();
    let attempts = 0;
    while (hp > 0 && attempts < 30) {
      attempts++;
      const result = attemptSiege(tables, struct, partyChars, defeated);
      result.newDefeated.forEach(d => defeated.add(d));
      if (result.siegeDamage > 0) hp -= result.siegeDamage;
      console.log(`  시도${attempts}: ${result.won ? "승" : "패"} (${result.totalWins}웨이브) → HP ${Math.max(0,hp)}/${maxHp}, 격파누적=${defeated.size}`);
      if (!result.won) break;  // Lv1로는 못 이김
    }
    console.log(`  결과: ${hp <= 0 ? "함락" : "실패 (Lv1으론 불가)"}`);
  });

  it("Gate ID 45 (가장 강한 외곽 관문)", () => {
    const struct = tables.structures.get(45);
    const maxHp = getStructureMaxHP(struct);
    console.log(`\n=== 관문 ID 45 ===`);
    console.log(`  PatrolLv${struct.PatrolLv}/GarrisonLv${struct.GarrisonLv}/StationedLv${struct.StationedLv}/DurabilityLv${struct.DurabilityLv}`);
    console.log(`  HP=${maxHp}, 1파티 공성치=${getPartySiegeDamage(partyChars)}`);

    let hp = maxHp;
    const defeated = new Set();
    let attempts = 0;
    while (hp > 0 && attempts < 5) {
      attempts++;
      const result = attemptSiege(tables, struct, partyChars, defeated);
      result.newDefeated.forEach(d => defeated.add(d));
      if (result.siegeDamage > 0) hp -= result.siegeDamage;
      console.log(`  시도${attempts}: ${result.won ? "승" : "패"} (${result.totalWins}웨이브)`);
      if (!result.won) break;
    }
    console.log(`  결과: ${hp <= 0 ? "함락" : "실패"} (Lv1 → 강한 수비대 못 잡음)`);
  });
});

describe("Structure Siege — 다양한 레벨 vs 관문 ID 41 (가장 약한 외곽)", () => {
  const tables = loadTables();
  const players6 = tables.fieldObjects.all()
    .filter(r => r.ObjectType === "Player" && r.IsActivate);

  for (const lv of [30, 50, 80, 100, 150]) {
    it(`Lv${lv} 파티`, () => {
      const partyChars = players6.slice(0, 3).map(t => makePlayerChar(t, lv));
      const struct = tables.structures.get(41);
      const maxHp = getStructureMaxHP(struct);
      const dmg = getPartySiegeDamage(partyChars);

      let hp = maxHp;
      const defeated = new Set();
      let attempts = 0, wins = 0, lost = false;
      while (hp > 0 && attempts < 30) {
        attempts++;
        const result = attemptSiege(tables, struct, partyChars, defeated);
        if (result.won) wins++; else lost = true;
        result.newDefeated.forEach(d => defeated.add(d));
        if (result.siegeDamage > 0) hp -= result.siegeDamage;
      }
      console.log(`  Lv${lv} (HP=${partyChars[0].maxHp} ATK=${partyChars[0].stats.atk}): ${wins}승/${attempts}회, 공성치${dmg}, HP ${Math.max(0,hp)}/${maxHp} → ${hp<=0 ? "함락" : (lost ? "패배" : "진행중")}`);
    });
  }
});

describe("디버그: 관문43 Patrol vs Lv50 단판", () => {
  it("스탯 확인 + 1번 전투", () => {
    const tables = loadTables();
    const players6 = tables.fieldObjects.all()
      .filter(r => r.ObjectType === "Player" && r.IsActivate);
    const partyChars = players6.slice(0, 3).map(t => makePlayerChar(t, 30));
    const struct = tables.structures.get(43);
    const defs = findStructureDefenders(struct.StructureID, tables);
    const patrol = defs.find(d => d.__layer === "Patrol");

    console.log("\n=== 플레이어 (Lv50) ===");
    const playerUnits = partyChars.map(c => playerToSimUnit(c, tables.fieldObjects));
    for (const u of playerUnits) {
      console.log(`  ${u.name}(${u.role}/${u.jobClass}) El=${u.element} HP=${u.maxHp} ATK=${u.atk} DEF=${u.def} SPD=${u.spd}`);
    }

    console.log(`\n=== 적 (Patrol PartyLv ${patrol.EnemyLevel}) ===`);
    const enemyTemplates = [patrol.Slot1, patrol.Slot2, patrol.Slot3]
      .filter(Boolean)
      .map(id => tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy"));
    const enemyUnits = enemyTemplates.map(t => enemyToSimUnit(t, patrol.EnemyLevel));
    for (const u of enemyUnits) {
      console.log(`  ID=? ${u.name}(${u.role}/${u.jobClass}) El=${u.element} HP=${u.maxHp} ATK=${u.atk} DEF=${u.def} SPD=${u.spd}`);
    }

    // 단판 시뮬
    let pwin = 0;
    for (let i = 0; i < 20; i++) {
      const pu = playerUnits.map(u => ({ ...u, hp: u.maxHp }));
      const eu = enemyUnits.map(u => ({ ...u, hp: u.maxHp }));
      const rec = simulate(pu, eu);
      if (rec.result === "victory") pwin++;
    }
    console.log(`\n=== 결과: 20회 전투, 승리 ${pwin}회 (${pwin*5}%) ===`);

    // 상세 1회
    const pu = playerUnits.map(u => ({ ...u, hp: u.maxHp }));
    const eu = enemyUnits.map(u => ({ ...u, hp: u.maxHp }));
    const rec = simulate(pu, eu);
    console.log(`첫 전투: ${rec.result}, ${rec.totalTurns}턴, 액션 ${rec.actions.length}개`);
    for (const a of rec.actions.slice(0, 15)) {
      if (a.type === "Attack") {
        const att = rec.allUnits[a.actorIdx];
        const tgt = rec.allUnits[a.targetIdx];
        console.log(`  T${a.turn}: ${att.name} → ${tgt.name} -${a.damage}${a.died ? " (사망!)" : ""}`);
      } else if (a.type === "LeaderDown") {
        console.log(`  T${a.turn}: 리더 사망 (${a.side}) → 즉시 ${a.side==='player'?'패배':'승리'}`);
      }
    }
  });
});

describe("Structure Siege — 모든 관문 권장 레벨 검증", () => {
  const tables = loadTables();
  const players6 = tables.fieldObjects.all()
    .filter(r => r.ObjectType === "Player" && r.IsActivate);
  const allGates = tables.structures.all().filter(s => s.StructureType === "Gate");

  it("관문별 함락 가능 최저 레벨", () => {
    console.log("\n=== 관문별 함락 가능 최저 레벨 (Patrol/Garr/Stat/Dur, HP, 권장Lv, 함락회수) ===");
    const results = [];
    for (const gate of allGates.sort((a,b) => (a.StationedLv||0) - (b.StationedLv||0))) {
      const maxHp = getStructureMaxHP(gate);
      let minLv = null, attempts = 0;
      for (const lv of [1, 5, 10, 15, 20, 25, 30, 40, 50, 70, 100, 150]) {
        const partyChars = players6.slice(0, 3).map(t => makePlayerChar(t, lv));
        // 3회 시도 평균 — 한 번 함락하면 OK
        let captured = false;
        let tries = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
          let hp = maxHp;
          const defeated = new Set();
          let a = 0;
          while (hp > 0 && a < 120) {
            a++;
            const result = attemptSiege(tables, gate, partyChars, defeated);
            result.newDefeated.forEach(d => defeated.add(d));
            if (result.siegeDamage > 0) hp -= result.siegeDamage;
            if (!result.won) break;
          }
          if (hp <= 0) { captured = true; tries = a; break; }
        }
        if (captured) { minLv = lv; attempts = tries; break; }
      }
      results.push({ gate, minLv, attempts });
      const stat = `Pat${gate.PatrolLv}/Gar${gate.GarrisonLv}/Sta${gate.StationedLv}/Dur${gate.DurabilityLv}`;
      console.log(`  Gate#${String(gate.StructureID).padEnd(3)} ${stat}  HP=${String(maxHp).padEnd(5)} → 최저Lv=${minLv ?? "X(Lv150도 불가)"}, ${attempts}회`);
    }
  });
});

describe("Structure Siege — 관문 ID 43 (Patrol1/Garr1/Stat1/Dur1, 가장 약한 등급)", () => {
  const tables = loadTables();
  const players6 = tables.fieldObjects.all()
    .filter(r => r.ObjectType === "Player" && r.IsActivate);
  const struct = tables.structures.get(43);
  const maxHp = getStructureMaxHP(struct);
  console.log(`\n=== 관문 ID 43 (HP=${maxHp}) ===`);

  for (const lv of [1, 10, 20, 30, 50, 80]) {
    it(`Lv${lv} 파티`, () => {
      const partyChars = players6.slice(0, 3).map(t => makePlayerChar(t, lv));
      const dmg = getPartySiegeDamage(partyChars);

      let hp = maxHp;
      const defeated = new Set();
      let attempts = 0, wins = 0, lost = false;
      const log = [];
      while (hp > 0 && attempts < 30) {
        attempts++;
        const result = attemptSiege(tables, struct, partyChars, defeated);
        if (result.won) wins++; else lost = true;
        result.newDefeated.forEach(d => defeated.add(d));
        if (result.siegeDamage > 0) hp -= result.siegeDamage;
        log.push(`${result.won ? "승" : "패"}${result.siegeDamage > 0 ? `(-${result.siegeDamage}HP)` : ""}`);
      }
      console.log(`  Lv${lv} (HP=${partyChars[0].maxHp} ATK=${partyChars[0].stats.atk}, 공성치${dmg}): ${wins}승/${attempts}회 [${log.slice(0, 12).join(",")}${log.length > 12 ? "…" : ""}] → ${hp<=0 ? `${attempts}회 함락` : (lost ? "수비대 못 잡음" : "진행중")}`);
    });
  }
});
