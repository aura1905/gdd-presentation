// 안개(Fog of War) — 삼전식 동적 공개/재가림.
//
// 헥스 상태 3단계:
//   "hidden"   — 어두운 오버레이, 지형만 보임 (적/구조물 정보 숨김)
//   "revealed" — 정상 채도, 자원/구조물 종류 보임 (적 강도 정밀 정보는 숨김)
//   "scouted"  — revealed + 적 파티 정보 (탐색 액션, N턴/액션 유효)
//
// 공개 트리거 (4종):
//   1. 아군 점령 헥스 (영구)
//   2. 아군 구조물 시야 반경 (city=4, gate=2, outpost=3)
//   3. 아군 파티 위치 반경 (1)
//   4. 탐색 액션 → 해당 헥스 5액션간 scouted
//
// 재가림: 매 액션마다 재계산. 조건 탈락 시 hidden으로.
import { neighbors, hexId } from "../util/hex.js";
import { CONFIG } from "../config.js";

const STRUCTURE_VISION = { city: 4, gate: 2, outpost: 3, fort: 3, dungeon: 1 };
const PARTY_VISION = 1;

/** 한 헥스 주변 반경 r 내 모든 HexID 수집 (BFS). */
function hexesWithinRadius(q, r, radius) {
  const out = new Set([hexId(q, r)]);
  let frontier = [{ q, r }];
  for (let d = 0; d < radius; d++) {
    const next = [];
    for (const cur of frontier) {
      for (const n of neighbors(cur.q, cur.r)) {
        const id = hexId(n.q, n.r);
        if (!out.has(id)) {
          out.add(id);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * 안개 상태 재계산.
 * @param {object} state - gameState
 * @param {object} tables
 */
export function recomputeFog(state, tables) {
  if (!state) return;
  if (!state.fog) state.fog = {};

  const visibleSet = new Set();

  // 1. 아군 점령 헥스
  for (const id of state.ownedHexes || []) visibleSet.add(id);

  // 2. 아군 구조물 시야 반경
  for (const sid of state.capturedStructures || []) {
    const struct = tables.structures.get(sid);
    if (!struct) continue;
    const type = (struct.StructureType || "").toLowerCase();
    const r = STRUCTURE_VISION[type] ?? 2;
    for (const id of hexesWithinRadius(struct.HexQ, struct.HexR, r)) {
      visibleSet.add(id);
    }
  }

  // 3. 아군 파티 위치 반경
  for (const p of state.parties || []) {
    if (!p.location) continue;
    for (const id of hexesWithinRadius(p.location.q, p.location.r, PARTY_VISION)) {
      visibleSet.add(id);
    }
  }

  // 4. 결과 적용 — 모든 헥스 순회하며 fog 결정
  // scouted: 기존 scoutExpire 살아있고 visibleSet에도 있으면 유지
  const newFog = {};
  for (const hx of tables.worldHex.all()) {
    const id = hx.HexID;
    const prev = state.fog[id];
    if (visibleSet.has(id)) {
      // scouted 우선 (기존 scoutExpire 유효)
      if (prev?.state === "scouted" && (prev.scoutExpireAction || 0) > (state.actionCount || 0)) {
        newFog[id] = { state: "scouted", scoutExpireAction: prev.scoutExpireAction, enemyPreview: prev.enemyPreview };
      } else {
        newFog[id] = { state: "revealed" };
      }
    } else {
      // 비가시 — 기존이 scouted였더라도 만료 안되었으면 메모리에서 정보는 유지하지만 hidden 처리
      // (재진입시 다시 보일 수 있게). 단순화: hidden.
      newFog[id] = { state: "hidden" };
    }
  }
  state.fog = newFog;
}

/** 탐색 액션: 해당 헥스를 scouted로 마킹 + 적 프리뷰 저장. */
export function applyScout(state, hexId, durationActions, enemyPreview) {
  if (!state.fog) state.fog = {};
  const expire = (state.actionCount || 0) + (durationActions || 5);
  state.fog[hexId] = {
    state: "scouted",
    scoutExpireAction: expire,
    enemyPreview,
  };
}

/** 헥스의 안개 상태 조회. */
export function getFogState(state, hexId) {
  return state?.fog?.[hexId]?.state || "hidden";
}

/** 액션 카운터 증가 (이동/공격/점령/탐색 등). 안개 재계산 트리거. */
export function bumpAction(state) {
  state.actionCount = (state.actionCount || 0) + 1;
}
