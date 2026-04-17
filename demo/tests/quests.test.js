// 미션 시스템 (M6-lite) 검증.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { initState, getState, levelUpFamilyIfReady } from "../src/state/gameState.js";
import {
  initQuests, getActiveQuests, getClaimableQuests,
  reportProgress, claimQuestReward,
} from "../src/engine/quests.js";

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function loadTables() {
  const dir = "data/tables";
  const make = (rows, pk) => ({ all: () => rows, get: (k) => rows.find(r => r[pk] === k) });
  return {
    fieldObjects: make(loadJson(`${dir}/field_objects.json`), "ID"),
    worldHex:     make(loadJson(`${dir}/world_hex.json`), "HexID"),
    structures:   make(loadJson(`${dir}/structures.json`), "StructureID"),
    familyLevel:  make(loadJson(`${dir}/family_level.json`), "Level"),
    training:     make(loadJson(`${dir}/training.json`), "ID"),
    quests:       make(loadJson(`${dir}/quests.json`), "QuestID"),
  };
}

describe("initQuests", () => {
  const tables = loadTables();
  beforeEach(() => initState(tables));

  it("chain Q101이 첫 활성 quest로 등록", () => {
    const state = getState();
    initQuests(state, tables);
    expect(state.quests.active).toContain(101);
    expect(state.quests.completed).toEqual([]);
    expect(state.quests.readyToClaim).toEqual([]);
  });

  it("daily/weekly/achievement 모두 활성", () => {
    const state = getState();
    initQuests(state, tables);
    // 데이터에 있는 daily/weekly/achievement 모두
    const dailyIds = tables.quests.all().filter(q => q.QuestType === "daily").map(q => q.QuestID);
    for (const did of dailyIds) {
      expect(state.quests.active).toContain(did);
    }
  });
});

describe("reportProgress + claimQuestReward — chain 흐름", () => {
  const tables = loadTables();
  beforeEach(() => { initState(tables); initQuests(getState(), tables); });

  it("Q101(occupy×1) 진행 후 readyToClaim", () => {
    const state = getState();
    reportProgress(state, tables, "occupy", 1);
    expect(state.quests.readyToClaim).toContain(101);
    expect(state.quests.progress[101]).toBe(1);
  });

  it("Q101 보상 수령 → 자원/FamilyEXP 가산 + Q102 자동 활성", () => {
    const state = getState();
    reportProgress(state, tables, "occupy", 1);
    const result = claimQuestReward(state, tables, 101, () => levelUpFamilyIfReady(tables));
    expect(result.ok).toBe(true);
    // Q101 보상: Grain 50, Gold 100, FamilyEXP 30
    expect(state.resources.grain).toBe(50);
    expect(state.resources.gold).toBe(100);
    expect(state.family.xp).toBe(30);
    // 완료 처리
    expect(state.quests.completed).toContain(101);
    expect(state.quests.readyToClaim).not.toContain(101);
    // 다음 chain 자동 활성
    expect(state.quests.active).toContain(102);
    expect(result.activatedNext).toBe(102);
  });

  it("Q105(family_level×6) — 가문 Lv 6 도달 시 즉시 readyToClaim", () => {
    const state = getState();
    state.quests.active.push(105);  // chain은 보통 NextQuestID로 활성, 테스트용 직접
    reportProgress(state, tables, "family_level", 6);
    expect(state.quests.readyToClaim).toContain(105);
  });

  it("Q105 가문 Lv 5 도달 — readyToClaim 안 됨", () => {
    const state = getState();
    state.quests.active.push(105);
    reportProgress(state, tables, "family_level", 5);
    expect(state.quests.readyToClaim).not.toContain(105);
    expect(state.quests.progress[105]).toBe(5);
  });
});

describe("FamilyEXP 보상으로 가문 레벨 점프", () => {
  const tables = loadTables();
  beforeEach(() => { initState(tables); initQuests(getState(), tables); });

  it("Q101~Q104 연속 클리어 → 가문 XP 누적 + 레벨업", () => {
    const state = getState();
    // Q101 occupy
    reportProgress(state, tables, "occupy", 1);
    claimQuestReward(state, tables, 101, () => levelUpFamilyIfReady(tables));
    // Q102 occupy×3
    reportProgress(state, tables, "occupy", 3);
    claimQuestReward(state, tables, 102, () => levelUpFamilyIfReady(tables));
    // Q103 subjugate×1
    reportProgress(state, tables, "subjugate", 1);
    claimQuestReward(state, tables, 103, () => levelUpFamilyIfReady(tables));
    // Q104 subjugate×3
    reportProgress(state, tables, "subjugate", 3);
    claimQuestReward(state, tables, 104, () => levelUpFamilyIfReady(tables));

    // 누적 FamilyEXP: 30+50+30+50 = 160 ≥ Lv2 (158) → Lv2 도달
    expect(state.family.xp).toBe(160);
    expect(state.family.level).toBe(2);
  });
});

describe("getClaimableQuests / getActiveQuests", () => {
  const tables = loadTables();
  beforeEach(() => { initState(tables); initQuests(getState(), tables); });

  it("초기 상태: 활성 quest는 있고 수령 가능은 없음", () => {
    const state = getState();
    expect(getActiveQuests(state, tables).length).toBeGreaterThan(0);
    expect(getClaimableQuests(state, tables).length).toBe(0);
  });

  it("진행 후 수령 가능 quest 노출", () => {
    const state = getState();
    reportProgress(state, tables, "occupy", 1);
    const claimable = getClaimableQuests(state, tables);
    expect(claimable.some(q => q.QuestID === 101)).toBe(true);
  });
});
