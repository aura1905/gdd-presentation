// Gacha engine — roll grade via rate table, pick character from pool.
// GDD: gacha.json (rate/pity/banner/cost/dupe_shard/disassemble)
import { resolveSpriteFolder } from "../render/charSprites.js";

/** 실제 스프라이트 폴더가 존재하는 캐릭터인지 (charSprites.js KNOWN_FOLDERS 기준). */
function hasSprite(p) {
  if (!p.PrefabPath) return false;
  const name = p.PrefabPath.split("/")[1];
  return resolveSpriteFolder(name) != null;
}

// Grade → Rarity 매핑
const GRADE_RARITY = {
  legend: [6, 7],    // C6~C7
  unique: [5],        // C5
  rare: [4],          // ★★★★
  high: [3],          // ★★★
  normal: [2],        // ★★
};

// 성급별 색상 (결과 연출)
export const GRADE_COLOR = {
  legend: "#ff9f3a",    // 주황 (최상)
  unique: "#b868ff",    // 보라
  rare: "#68a8ff",      // 파랑
  high: "#68d88a",      // 녹색
  normal: "#bbb",        // 회색
};

export const GRADE_KR = {
  legend: "전설",
  unique: "영웅",
  rare: "희귀",
  high: "고급",
  normal: "일반",
};

/** 확률 기반 grade 1개 추첨. rng는 0~1 난수 함수. */
export function rollGrade(tables, rng = Math.random) {
  const rates = tables.gacha.all()
    .filter(r => r.ConfigType === "rate")
    .sort((a, b) => b.Rate - a.Rate); // 높은 확률 먼저 (의미는 없지만 안정성용)
  const roll = rng() * 100;
  let acc = 0;
  for (const r of rates) {
    acc += r.Rate;
    if (roll <= acc) return r.Grade;
  }
  return rates[rates.length - 1]?.Grade || "normal";
}

/** grade에 해당하는 캐릭터 풀에서 1명 랜덤 픽 — 실제 스프라이트 폴더 있는 것만. */
export function pickCharacter(grade, tables, rng = Math.random) {
  const rarityList = GRADE_RARITY[grade] || [2];
  const pool = tables.fieldObjects.all().filter(p =>
    p.ObjectType === "Player" && hasSprite(p) && rarityList.includes(p.Rarity)
  );
  if (pool.length === 0) {
    // Fallback: 전체 Player(실제 스프라이트 있는)에서 랜덤
    const anyPool = tables.fieldObjects.all().filter(p =>
      p.ObjectType === "Player" && hasSprite(p)
    );
    if (anyPool.length === 0) return null;
    return anyPool[Math.floor(rng() * anyPool.length)];
  }
  return pool[Math.floor(rng() * pool.length)];
}

/** 단일 뽑기 결과 생성 (비용 차감/로스터 추가 없이 순수 결과만). */
export function rollOnce(tables, rng = Math.random) {
  const grade = rollGrade(tables, rng);
  const char = pickCharacter(grade, tables, rng);
  return { grade, char };
}

/** 중복 시 조각 수 조회 (dupe_shard 테이블). */
export function getDupeShardCount(grade, tables) {
  const row = tables.gacha.all().find(r =>
    r.ConfigType === "dupe_shard" && r.Grade === grade
  );
  return row?.ShardCount || 1;
}

/** 비용 조회 (CurrencyType + 횟수). cost 행 2개를 Amount 오름차순으로 정렬해 single/10-pull 매핑. */
export function getGachaCost(count, currency, tables) {
  const rows = tables.gacha.all()
    .filter(r => r.ConfigType === "cost" && r.CurrencyType === currency)
    .sort((a, b) => (a.Amount || 0) - (b.Amount || 0));
  if (count === 1) return rows[0]?.Amount ?? (currency === "gem" ? 280 : 1);
  if (count === 10) return rows[1]?.Amount ?? (currency === "gem" ? 2800 : 10);
  return 0;
}
