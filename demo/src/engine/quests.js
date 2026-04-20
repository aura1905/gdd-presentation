// 미션 시스템 (M6) — chain/daily/weekly/achievement 추적 + 보상 수령.
//
// 데이터: quests.json
//   QuestType: chain | daily | weekly | achievement
//   TargetType: occupy | subjugate | family_level | siege_gate | siege_fort |
//               kill_named | enter_region | discover_gate | craft_food |
//               craft_equip | class_train | training | patrol | facility_level |
//               class_train_level | occupy_special | siege_any |
//               daily_all | weekly_all (집계 타입)
//   NextQuestID: chain 다음 quest (chain 한정)
//
// state.quests = {
//   active:    [questId, ...]       // 활성 (수령 가능 여부와 무관)
//   progress:  { [questId]: count } // 진행 카운트
//   completed: Set<questId>         // 보상 수령 완료
//   readyToClaim: [questId, ...]    // 진행도 도달했지만 미수령
// }

import { emit } from "../util/events.js";

// 의미적 포함 관계 — 한 이벤트가 다른 이벤트들도 트리거.
//   - occupy(점령) ⊃ subjugate(토벌)  : 점령했으면 적도 격파한 것
//   - siege_gate ⊃ occupy ⊃ subjugate, + siege_any
//   - siege_fort ⊃ occupy ⊃ subjugate, + siege_any
// 이 매핑은 1단계만 따로 풀고, fan-out 시 재귀적으로 펼침 (cycle 방지).
const TARGET_IMPLIES = {
  occupy:     ["subjugate"],
  siege_gate: ["occupy", "siege_any"],
  siege_fort: ["occupy", "siege_any"],
  // siege_any는 더 이상 펼치지 않음 (총괄 키)
};

/** 신규 게임 시작 시 호출. chain Phase1 첫 quest + 모든 daily/weekly/achievement 활성화. */
export function initQuests(state, tables) {
  if (state.quests) return;  // 이미 초기화됨
  const all = tables.quests.all();
  const active = [];
  // Chain은 첫 quest만 활성 (NextQuestID 흐름)
  const firstChain = all.find(q => q.QuestType === "chain" && q.QuestID === 101);
  if (firstChain) active.push(firstChain.QuestID);
  // daily/weekly/achievement은 전부 활성
  for (const q of all) {
    if (q.QuestType === "daily" || q.QuestType === "weekly" || q.QuestType === "achievement") {
      active.push(q.QuestID);
    }
  }
  state.quests = {
    active,
    progress: {},
    completed: [],   // serialization 친화적 → 배열, 룩업 시 includes
    readyToClaim: [],
  };
}

/** 옛 세이브 호환. */
export function ensureQuestsState(state, tables) {
  if (!state.quests) {
    initQuests(state, tables);
    return;
  }
  if (!Array.isArray(state.quests.active)) state.quests.active = [];
  if (!state.quests.progress) state.quests.progress = {};
  if (!Array.isArray(state.quests.completed)) state.quests.completed = [];
  if (!Array.isArray(state.quests.readyToClaim)) state.quests.readyToClaim = [];
}

/** 활성 중이고 미수령인 quest 객체 리스트. */
export function getActiveQuests(state, tables) {
  if (!state.quests) return [];
  return state.quests.active
    .filter(qid => !state.quests.completed.includes(qid))
    .map(qid => tables.quests.get(qid))
    .filter(Boolean);
}

/** 보상 수령 가능 quest 리스트. */
export function getClaimableQuests(state, tables) {
  if (!state.quests) return [];
  return state.quests.readyToClaim
    .map(qid => tables.quests.get(qid))
    .filter(Boolean);
}

/**
 * 진행도 보고 — 이벤트 발생 시 호출. TARGET_IMPLIES 따라 자동 fan-out.
 * 예: occupy 1회 보고 → subjugate quest도 자동 진행.
 * @param {string} eventType  - TargetType과 매칭 ("occupy"/"subjugate"/"family_level" 등)
 * @param {number} amount     - 증가량 (기본 1). family_level은 "현재 레벨"을 그대로 전달
 */
export function reportProgress(state, tables, eventType, amount = 1) {
  if (!state.quests) return;
  // 의미적 포함 관계 따라 펼침 (재귀, cycle 방지용 visited)
  const visited = new Set();
  const queue = [eventType];
  while (queue.length) {
    const t = queue.shift();
    if (visited.has(t)) continue;
    visited.add(t);
    _applyOneType(state, tables, t, amount);
    for (const implied of (TARGET_IMPLIES[t] || [])) queue.push(implied);
  }
  emit("state:changed", { path: "quests", action: "progress", eventType });
}

function _applyOneType(state, tables, eventType, amount) {
  for (const qid of state.quests.active) {
    if (state.quests.completed.includes(qid)) continue;
    if (state.quests.readyToClaim.includes(qid)) continue;
    const q = tables.quests.get(qid);
    if (!q || q.TargetType !== eventType) continue;

    // family_level은 "현재 도달 레벨이 TargetCount 이상이면 완료"로 처리 (절대 비교)
    if (eventType === "family_level") {
      if (amount >= q.TargetCount) {
        state.quests.progress[qid] = q.TargetCount;
        state.quests.readyToClaim.push(qid);
      } else {
        state.quests.progress[qid] = amount;
      }
      continue;
    }

    // 일반 카운터 누적
    const cur = (state.quests.progress[qid] || 0) + amount;
    state.quests.progress[qid] = cur;
    if (cur >= q.TargetCount) {
      state.quests.readyToClaim.push(qid);
    }
  }
}

/**
 * 보상 수령. chain은 NextQuestID 자동 활성화. daily/weekly는 단순 완료 처리.
 * @returns {{ ok, rewards?, levelUps? }}
 */
export function claimQuestReward(state, tables, questId, levelUpFamily) {
  if (!state.quests) return { ok: false, reason: "no_quests" };
  if (!state.quests.readyToClaim.includes(questId)) return { ok: false, reason: "not_ready" };
  if (state.quests.completed.includes(questId)) return { ok: false, reason: "already_claimed" };

  const q = tables.quests.get(questId);
  if (!q) return { ok: false, reason: "unknown_quest" };

  // 보상 가산 — 5대 물자 (grain/iron/wood/stone/herbs) + 화폐 (gold/vis/gem) + scroll + familyExp
  const rewards = {
    grain: q.RwdGrain || 0,
    iron:  q.RwdIron  || 0,
    wood:  q.RwdWood  || 0,
    stone: q.RwdStone || 0,
    herbs: q.RwdHerbs || 0,
    gold:  q.RwdGold  || 0,
    vis:   q.RwdVis   || 0,
    gem:   q.RwdGem   || 0,
    scroll: q.RwdScroll || 0,
    familyExp: q.RwdFamilyEXP || 0,
    item:    q.RwdItem || null,
    itemQty: q.RwdItemQty || 0,
  };
  for (const code of ["grain", "iron", "wood", "stone", "herbs", "gold", "vis", "gem", "scroll"]) {
    if (rewards[code]) state.resources[code] = (state.resources[code] || 0) + rewards[code];
  }
  if (rewards.familyExp) state.family.xp = (state.family.xp || 0) + rewards.familyExp;
  // 아이템 처리는 후속 (item 시스템 보류)

  // 완료 처리
  state.quests.completed.push(questId);
  state.quests.readyToClaim = state.quests.readyToClaim.filter(x => x !== questId);

  // chain → 다음 quest 활성화
  let activatedNext = null;
  if (q.QuestType === "chain" && q.NextQuestID) {
    if (!state.quests.active.includes(q.NextQuestID)) {
      state.quests.active.push(q.NextQuestID);
      activatedNext = q.NextQuestID;
      // family_level 타입의 다음 quest는 즉시 평가 (이미 가문 Lv 충족 가능성)
      const nextQ = tables.quests.get(q.NextQuestID);
      if (nextQ && nextQ.TargetType === "family_level") {
        const curLv = state.family?.level || 1;
        if (curLv >= nextQ.TargetCount) {
          state.quests.progress[q.NextQuestID] = nextQ.TargetCount;
          state.quests.readyToClaim.push(q.NextQuestID);
        }
      }
    }
  }

  // FamilyEXP 가산 후 자동 레벨업 체크 (caller가 levelUpFamily 함수 주입)
  let levelUps = [];
  if (rewards.familyExp && typeof levelUpFamily === "function") {
    levelUps = levelUpFamily();
    // 레벨업 후 family_level 진행 quest들 자동 평가
    const newLv = state.family.level || 1;
    reportProgress(state, tables, "family_level", newLv);
  }

  emit("state:changed", { path: "quests", action: "claim", questId, activatedNext });
  return { ok: true, rewards, activatedNext, levelUps };
}
