// 가문 성장 — 훈련 투자 (M5-A) 검증.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import {
  initState, getState, getTrainingLevel, getNextTrainingRow,
  canAffordTraining, investTraining,
} from "../src/state/gameState.js";

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function loadTables() {
  const dir = "data/tables";
  const make = (rows, pk) => ({ all: () => rows, get: (k) => rows.find(r => r[pk] === k) });
  return {
    fieldObjects: make(loadJson(`${dir}/field_objects.json`), "ID"),
    worldHex:     make(loadJson(`${dir}/world_hex.json`), "HexID"),
    training:     make(loadJson(`${dir}/training.json`), "ID"),
    structures:   make(loadJson(`${dir}/structures.json`), "StructureID"),
  };
}

describe("getNextTrainingRow", () => {
  const tables = loadTables();

  beforeEach(() => initState(tables));

  it("Lv 0 시작 → 다음 행은 Level=1", () => {
    const row = getNextTrainingRow("stamina", tables);
    expect(row.Level).toBe(1);
    expect(row.TrainingType).toBe("stamina");
    expect(row.Name).toContain("체력 단련");
  });

  it("최대 레벨 도달 시 null", () => {
    const state = getState();
    state.training.stamina = 999;  // 데이터엔 50이 최대
    expect(getNextTrainingRow("stamina", tables)).toBeNull();
  });
});

describe("canAffordTraining", () => {
  const tables = loadTables();

  beforeEach(() => initState(tables));

  it("자원 0 + Lv1 행 → cost 부족", () => {
    const row = getNextTrainingRow("stamina", tables);  // grain 30, gold 100
    const check = canAffordTraining(row);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("cost");
    expect(check.missing.grain).toBe(30);
    expect(check.missing.gold).toBe(100);
  });

  it("자원 충분 + 가문 Lv 충족 → ok", () => {
    const state = getState();
    state.resources.grain = 1000;
    state.resources.gold = 1000;
    const row = getNextTrainingRow("stamina", tables);
    expect(canAffordTraining(row).ok).toBe(true);
  });

  it("UnlockFamilyLv 미충족 → locked", () => {
    const state = getState();
    state.resources.grain = 99999;
    state.resources.gold = 99999;
    state.family.level = 1;
    // class_W (위자드) 의 첫 행은 UnlockFamilyLv > 1 일 가능성 — 직접 검증
    const wizardRow = tables.training.all().find(r => r.TrainingType === "class_W" && r.Level === 1);
    if (wizardRow.UnlockFamilyLv > 1) {
      const check = canAffordTraining(wizardRow);
      expect(check.ok).toBe(false);
      expect(check.reason).toBe("locked");
      expect(check.unlockLv).toBe(wizardRow.UnlockFamilyLv);
    }
  });

  it("null row(최대) → max 사유", () => {
    expect(canAffordTraining(null)).toEqual({ ok: false, reason: "max" });
  });
});

describe("investTraining — 자원 차감 + 레벨 업", () => {
  const tables = loadTables();

  beforeEach(() => initState(tables));

  it("성공 시 자원 차감 + Lv +1 + state.training 갱신", () => {
    const state = getState();
    state.resources.grain = 100;
    state.resources.gold = 200;

    const result = investTraining("stamina", tables);
    expect(result.ok).toBe(true);
    expect(state.training.stamina).toBe(1);
    expect(state.resources.grain).toBe(70);   // 100 - 30
    expect(state.resources.gold).toBe(100);   // 200 - 100
  });

  it("실패 시 state 변동 없음", () => {
    const state = getState();
    // 자원 0
    const before = JSON.stringify(state.resources);
    const result = investTraining("stamina", tables);
    expect(result.ok).toBe(false);
    expect(state.training.stamina || 0).toBe(0);
    expect(JSON.stringify(state.resources)).toBe(before);
  });

  it("연속 3회 투자 → Lv 3, 비용 누적 정확", () => {
    const state = getState();
    state.resources.grain = 99999;
    state.resources.gold = 99999;
    const startGrain = state.resources.grain;

    let cost = 0;
    for (let i = 0; i < 3; i++) {
      const row = getNextTrainingRow("stamina", tables);  // 호출 시점의 다음 행
      cost += row.CostAmt1;  // grain 비용 누적
      expect(investTraining("stamina", tables).ok).toBe(true);
    }
    expect(state.training.stamina).toBe(3);
    expect(startGrain - state.resources.grain).toBe(cost);
  });
});
