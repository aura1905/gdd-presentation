// Headless battle simulator — port of
// Assets/ClientCore/Scripts/Battle/Simulation/BattleSimulator.cs
//
// Phase 1 scope (이번 포팅): turn loop, SPD-based order, target = lowest HP enemy,
// 7-stage attack via combatFormula, BattleRecord with action log.
// Phase 2 (예정): CombatEffect (buffs/debuffs/CC/DoT), SkillResolver (active/charge skills).
import { calculateDamage } from "./combatFormula.js";

const MAX_TURNS = 30;
const MAX_ACTIONS = 500;

/**
 * Build a SimUnit from a player character (gameState format).
 * @param {object} ch - character from gameState.characters
 * @returns {object} SimUnit
 */
export function playerToSimUnit(ch, fieldObjectsTable) {
  // GDD 피로도: 100=최상, 그대로 전달.
  const fatigue = ch.fatigue;
  // FieldObjectTable에서 element/role 정확히 가져오기
  const tmpl = fieldObjectsTable?.all().find(r => r.ID === ch.id && r.ObjectType === "Player");
  return {
    name: ch.name, team: "player", role: ch.role || tmpl?.Role, jobClass: ch.jobClass,
    element: tmpl?.Element || "None",
    maxHp: ch.maxHp, hp: ch.hp,
    atk: ch.stats.atk, def: ch.stats.def, spd: ch.stats.spd,
    cri: ch.stats.cri ?? 5, crd: ch.stats.crd ?? 130,
    pen: ch.stats.pen ?? 0,
    fatigue,
  };
}

/**
 * Build SimUnit from FieldObjectTable enemy template + EnemyParty level.
 */
export function enemyToSimUnit(tmpl, enemyLevel) {
  if (!tmpl) {
    return {
      name: "Unknown", team: "enemy", role: "Dealer", element: "None",
      maxHp: 50, hp: 50, atk: 8, def: 3, spd: 1,
      cri: 5, crd: 130, pen: 0, fatigue: 100,
    };
  }
  const level = Math.max(1, enemyLevel || 1);
  const lv1 = level - 1;
  const stat = (base, growth) => Math.round((base ?? 0) + (growth ?? 0) * lv1);
  return {
    name: tmpl.Name || `E${tmpl.ID}`, team: "enemy", role: tmpl.Role || "Dealer",
    element: tmpl.Element || "None",
    jobClass: tmpl.JobClass || "?",
    maxHp: stat(tmpl.BaseHP, tmpl.GrowthHP),
    hp:    stat(tmpl.BaseHP, tmpl.GrowthHP),
    atk: stat(tmpl.BaseATK, tmpl.GrowthATK),
    def: stat(tmpl.BaseDEF, tmpl.GrowthDEF),
    spd: tmpl.BaseSPD ?? 1,
    cri: tmpl.BaseCRI ?? 5, crd: tmpl.BaseCRD ?? 130,
    pen: tmpl.BasePEN ?? 0,
    fatigue: 100,  // 적은 항상 풀 컨디션
  };
}

/**
 * Run combat simulation.
 * @param {object[]} playerUnits - list of SimUnit (team=player)
 * @param {object[]} enemyUnits  - list of SimUnit (team=enemy)
 * @param {object}   opts
 * @returns {object} BattleRecord
 */
export function simulate(playerUnits, enemyUnits, opts = {}) {
  const rng = opts.rng || Math.random;
  const allUnits = [...playerUnits, ...enemyUnits];
  const playerCount = playerUnits.length;
  const total = allUnits.length;

  const record = {
    result: "ongoing",
    totalTurns: 0,
    playerUnits, enemyUnits, allUnits,
    actions: [],
    finalHp: [],
  };

  if (total === 0) {
    record.result = "defeat";
    record.finalHp = [];
    return record;
  }

  const hp = allUnits.map(u => u.maxHp);
  const alive = allUnits.map(() => true);

  // Turn order (SPD desc, ties by index)
  const order = [...Array(total).keys()].sort((a, b) => {
    const cmp = allUnits[b].spd - allUnits[a].spd;
    return cmp !== 0 ? cmp : a - b;
  });

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (record.actions.length >= MAX_ACTIONS) {
      record.result = "defeat";
      record.totalTurns = turn;
      break;
    }
    record.actions.push({ type: "TurnStart", turn });

    for (const actorIdx of order) {
      if (!alive[actorIdx]) continue;
      const attacker = allUnits[actorIdx];
      const isPlayer = actorIdx < playerCount;

      // Target = lowest-HP alive enemy
      const enemyStart = isPlayer ? playerCount : 0;
      const enemyEnd   = isPlayer ? total : playerCount;
      let targetIdx = -1;
      let bestHp = Infinity;
      for (let i = enemyStart; i < enemyEnd; i++) {
        if (alive[i] && hp[i] < bestHp) { bestHp = hp[i]; targetIdx = i; }
      }
      if (targetIdx < 0) break;

      const target = allUnits[targetIdx];
      const dmg = calculateDamage({
        attackerAtk: attacker.atk,
        attackerCri: attacker.cri,
        attackerCrd: attacker.crd,
        attackerPen: attacker.pen,
        attackerCurrentHp: hp[actorIdx],
        attackerMaxHp: attacker.maxHp,
        attackerElement: attacker.element,
        attackerRole: attacker.role,
        targetDef: target.def,
        targetElement: target.element,
        targetRole: target.role,
        fatiguePercent: attacker.fatigue,
        rng,
      });

      hp[targetIdx] = Math.max(0, hp[targetIdx] - dmg.finalDamage);
      const died = hp[targetIdx] <= 0;
      if (died) alive[targetIdx] = false;

      record.actions.push({
        type: "Attack", turn, actorIdx, targetIdx,
        damage: dmg.finalDamage, miss: false,
        crit: dmg.isCrit, blocked: false, died,
        elementMult: dmg.elementMult, roleMult: dmg.roleMult,
      });

      if (died) record.actions.push({ type: "Death", turn, actorIdx: targetIdx });

      const playerAlive = alive.slice(0, playerCount).some(Boolean);
      const enemyAlive  = alive.slice(playerCount).some(Boolean);
      if (!playerAlive || !enemyAlive) {
        record.result = !enemyAlive ? "victory" : "defeat";
        record.totalTurns = turn;
        record.finalHp = [...hp];
        return record;
      }
    }

    if (turn === MAX_TURNS) {
      record.result = "defeat";  // 시간 초과 = 적 잔존 = 패배
      record.totalTurns = turn;
    }
  }

  record.finalHp = [...hp];
  return record;
}
