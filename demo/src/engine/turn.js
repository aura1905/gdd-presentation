// 턴 종료 정산 — M4-A.
//
// 1턴 = CONFIG.turn.minutesPerTurn 분 (resources.json의 ProductionPerMin / energy.json의
// RecoveryPerMin 데이터를 분 단위 그대로 반영하기 위함).
//
// 정산 항목:
//  1. 자원 수급: 보유 헥스 중 HexLevel ≥ 1 + ResourceCode 보유 헥스
//                → resources.json (ResourceCode + Grade=HexLevel) 조회
//                → ProductionPerMin × ValueMultiplier × MinutesPerTurn → 가산
//  2. 피로 회복: 파티 위치별 회복량
//                - 도시 (홈) : InstantRecovery=-1 → 즉시 100 (이미 fullRestParty가 처리)
//                - 거점/벙커 : RecoveryPerMin × MinutesPerTurn (energy.json LocationType)
//                - 그 외 필드: BaseRecoveryPerMin × MinutesPerTurn
//  3. 턴 +1
//
// 예외/누락 케이스는 throw 대신 0 반환 (데이터 없음).
import { CONFIG } from "../config.js";

const RESOURCE_KEYS = ["grain", "iron", "wood", "stone", "herbs", "gold", "vis", "gem", "scroll", "rp", "mana"];

/**
 * 보유 헥스 1턴 자원 생산량 계산.
 * @returns {{ [resourceCode: string]: number }}
 */
export function computeHexIncome(state, tables) {
  const minutes = CONFIG.turn?.minutesPerTurn || 10;
  const income = Object.create(null);
  if (!state?.ownedHexes) return income;

  for (const hexId of state.ownedHexes) {
    const hx = tables.worldHex.get(hexId);
    if (!hx) continue;
    if (!hx.ResourceCode) continue;
    const grade = hx.HexLevel || 0;
    if (grade < 1) continue;            // HL0 = 빈 통로 (생산 없음)
    if (hx.StructureID) continue;       // 구조물 헥스는 별도 (M4-B에서 처리)

    // resources.json에서 (ResourceCode, Grade) 매칭
    const row = tables.resources.all().find(
      r => r.ResourceCode === hx.ResourceCode && r.Grade === grade
    );
    if (!row) continue;
    const perTurn = (row.ProductionPerMin || 0) * (row.ValueMultiplier || 1) * minutes;
    income[hx.ResourceCode] = (income[hx.ResourceCode] || 0) + perTurn;
  }

  // 정수 단위로 floor
  for (const k of Object.keys(income)) income[k] = Math.floor(income[k]);
  return income;
}

/**
 * 파티 위치별 피로 회복량 계산 (캐릭터 단위).
 * @returns {Map<charId, recoveryAmount>}
 */
export function computeFatigueRecovery(state, tables) {
  const minutes = CONFIG.turn?.minutesPerTurn || 10;
  const result = new Map();
  if (!state?.parties) return result;

  // energy.json에서 base + location_recovery 룩업
  const baseRow = tables.energy.all().find(r => r.ConfigType === "base");
  const baseRecPerMin = baseRow?.BaseRecoveryPerMin || 1;

  const locRecovery = {};
  for (const r of tables.energy.all()) {
    if (r.ConfigType === "location_recovery") {
      locRecovery[r.LocationType] = r;
    }
  }

  const home = state.family?.homeHex;

  for (const party of state.parties) {
    const { q, r } = party.location || {};
    if (q == null || r == null) continue;

    let perMin = baseRecPerMin;
    let instant = 0;

    // 위치 종류 판정 (도시 > 거점 > 필드)
    const isHome = home && q === home.q && r === home.r;
    const hexId = q * 100 + r;
    const hex = tables.worldHex.get(hexId);
    const struct = hex?.StructureID ? tables.structures.get(hex.StructureID) : null;

    if (isHome || struct?.StructureType === "City") {
      const cityRow = locRecovery["city"];
      perMin = cityRow?.RecoveryPerMin ?? 0;
      instant = cityRow?.InstantRecovery ?? 0;  // -1 = full
    } else if (struct?.StructureType === "Fort") {
      const fortRow = locRecovery["fort"];
      perMin = fortRow?.RecoveryPerMin ?? baseRecPerMin;
      instant = fortRow?.InstantRecovery ?? 0;
    } else {
      const fieldRow = locRecovery["field"];
      perMin = fieldRow?.RecoveryPerMin ?? baseRecPerMin;
    }

    const recovery = perMin * minutes;

    for (const cid of party.slots || []) {
      if (cid == null) continue;
      const ch = state.characters.find(c => c.id === cid);
      if (!ch) continue;
      // 도시 InstantRecovery=-1 → max로 설정
      if (instant === -1) {
        result.set(cid, ch.maxFatigue - ch.fatigue);  // 부족분 전부
      } else {
        result.set(cid, recovery + (instant > 0 ? instant : 0));
      }
    }
  }
  return result;
}

/**
 * 턴 종료 — state mutation + summary 반환.
 * @returns {{ turn, gainedResources, fatigueLog }}
 */
export function endTurn(state, tables) {
  if (!state) return null;
  const fromTurn = state.meta.turn;

  // 1) 자원 수급
  const income = computeHexIncome(state, tables);
  for (const code of Object.keys(income)) {
    if (!(code in state.resources)) state.resources[code] = 0;
    state.resources[code] += income[code];
  }

  // 2) 피로 회복
  const recoveryMap = computeFatigueRecovery(state, tables);
  const fatigueLog = [];
  for (const ch of state.characters || []) {
    const rec = recoveryMap.get(ch.id) || 0;
    if (rec <= 0) continue;
    const before = ch.fatigue;
    ch.fatigue = Math.min(ch.maxFatigue, ch.fatigue + rec);
    if (ch.fatigue > 30) ch.status = "normal";
    else if (ch.fatigue > 0) ch.status = "tired";
    fatigueLog.push({ id: ch.id, name: ch.name, before, after: ch.fatigue });
  }

  // 3) 턴 +1
  state.meta.turn = fromTurn + 1;

  return {
    fromTurn,
    toTurn: state.meta.turn,
    gainedResources: income,
    fatigueLog,
    minutesPerTurn: CONFIG.turn?.minutesPerTurn || 10,
  };
}
