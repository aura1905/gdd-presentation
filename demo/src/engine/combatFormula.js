// 10-stage damage pipeline — verbatim port of
// Planning/battle_logic_spec.md §3-X CalculateDamage
//
// Stage 1: 기본 피해 (PEN-adjusted DEF)
// Stage 2: 스킬 배율
// Stage 3: HP 감쇠 보정 (hpRatio^0.3)
// Stage 4: 주피증 (합연산)
// Stage 5: 받피감 (곱연산)
// Stage 6: 속성 상성 (±25% / Light↔Dark 상호 +25%)
// Stage 7: 역할 상성 (±10%)
// Stage 8: CRI (cap 0.75, CRD cap 2.50)
// Stage 9: 피로도 보정
// Stage 10: 난수 ±5%

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => clamp(v, 0, 1);

// ─────────────── Stage 6: Element ───────────────
// GDD §4-2 표:  FIRE→WIND, WATER→FIRE, WIND→EARTH, EARTH→WATER (4원소 순환), LIGHT↔DARK 상호 유리.
// 데이터 추가 원소(Ice, Lightning, None)는 중립 처리.
const ELEMENT_ADV = {
  Fire: "Wind", Water: "Fire", Wind: "Earth", Earth: "Water",
  // Light↔Dark 별도 처리
};

export function getElementMultiplier(attackerEl, targetEl) {
  if (!attackerEl || !targetEl) return 1.0;
  if (attackerEl === targetEl) return 1.0;
  // 4원소 유리/불리
  if (ELEMENT_ADV[attackerEl] === targetEl) return 1.25;
  if (ELEMENT_ADV[targetEl] === attackerEl) return 0.75;
  // 광↔암 상호 유리
  if ((attackerEl === "Light" && targetEl === "Dark") ||
      (attackerEl === "Dark" && targetEl === "Light")) return 1.25;
  return 1.0;
}

// ─────────────── Stage 7: Role ───────────────
// 데이터 Role(Tanker/Dealer/Healer/Support/Leader) → GDD Archetype 매핑
const ROLE_TO_ARCH = {
  Dealer: "BURST", Leader: "BURST",
  Support: "CONTROL",
  Tanker: "SUSTAIN", Healer: "SUSTAIN",
};
const ARCH_ADV = { BURST: "CONTROL", CONTROL: "SUSTAIN", SUSTAIN: "BURST" };

export function getRoleMultiplier(attackerRole, targetRole) {
  const a = ROLE_TO_ARCH[attackerRole], t = ROLE_TO_ARCH[targetRole];
  if (!a || !t || a === t) return 1.0;
  if (ARCH_ADV[a] === t) return 1.10;
  return 0.90;
}

// ─────────────── Stage 9: Fatigue (GDD §4-4) ───────────────
export function fatigueMultiplier(fatigue) {
  if (fatigue >= 71) return 1.00;
  if (fatigue >= 51) return 0.95;
  if (fatigue >= 31) return 0.85;
  if (fatigue >= 11) return 0.70;
  return 0.50;
}

/**
 * 10-stage damage calculation.
 * @returns {{ finalDamage:number, isCrit:boolean, elementMult:number, roleMult:number }}
 */
export function calculateDamage({
  attackerAtk, attackerCri = 0.05, attackerCrd = 1.30, attackerPen = 0,
  attackerCurrentHp, attackerMaxHp,
  attackerElement, attackerRole,
  targetDef, targetElement, targetRole,
  skillMultiplier = 1.0,
  fatiguePercent = 100,
  damageIncreaseSum = 0,
  damageReductionList = [],
  rng = Math.random,
}) {
  // GDD: PEN/CRI/CRD가 0~100% 단위로 들어와도 0~1 단위로 정규화.
  const pen01 = attackerPen > 1 ? attackerPen / 100 : attackerPen;
  const cri01 = attackerCri > 1 ? attackerCri / 100 : attackerCri;
  const crd01 = attackerCrd > 3 ? attackerCrd / 100 : attackerCrd;

  // Stage 1: 기본 피해 (Physical, PEN-adjusted DEF)
  const effectiveDef = Math.floor(targetDef * (1 - clamp01(pen01)));
  let dmg = attackerAtk + Math.max(0, attackerAtk - effectiveDef) * 0.5;

  // Stage 2: 스킬 배율 (기본 공격 = 1.0)
  dmg *= skillMultiplier;

  // Stage 3: HP 감쇠 (^0.3)
  if (attackerMaxHp > 0) {
    const hpRatio = Math.max(0.01, attackerCurrentHp / attackerMaxHp);
    dmg *= Math.pow(hpRatio, 0.3);
  }

  // Stage 4: 주피증 (합연산)
  dmg *= 1 + damageIncreaseSum;

  // Stage 5: 받피감 (곱연산)
  for (const r of damageReductionList) dmg *= 1 - r;

  // Stage 6: 속성 상성
  const elementMult = getElementMultiplier(attackerElement, targetElement);
  dmg *= elementMult;

  // Stage 7: 역할 상성
  const roleMult = getRoleMultiplier(attackerRole, targetRole);
  dmg *= roleMult;

  // Stage 8: CRI (cap 0.75, CRD cap 2.50)
  let isCrit = false;
  const cappedCri = Math.min(cri01, 0.75);
  if (rng() < cappedCri) {
    isCrit = true;
    const cappedCrd = Math.min(crd01, 2.50);
    dmg *= cappedCrd;
  }

  // Stage 9: 피로도
  dmg *= fatigueMultiplier(fatiguePercent);

  // Stage 10: 난수 ±5%
  dmg *= 0.95 + rng() * 0.10;

  return {
    finalDamage: Math.max(1, Math.floor(dmg)),
    isCrit, elementMult, roleMult,
    isMiss: false, isBlocked: false,  // GDD엔 미스/블록 없음
  };
}
