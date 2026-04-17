// 가문 레벨 자동 진행 — XP 누적에 따른 레벨업 + 보상 지급 검증.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { initState, getState, levelUpFamilyIfReady } from "../src/state/gameState.js";

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
  };
}

describe("levelUpFamilyIfReady", () => {
  const tables = loadTables();

  beforeEach(() => initState(tables));

  it("XP 부족 시 레벨업 없음", () => {
    const events = levelUpFamilyIfReady(tables);
    expect(events.length).toBe(0);
    expect(getState().family.level).toBe(1);
  });

  it("Lv 2 누적 XP(158) 도달 → Lv 2로 자동 레벨업 + 보상", () => {
    const state = getState();
    state.family.xp = 158;
    const events = levelUpFamilyIfReady(tables);
    expect(events.length).toBe(1);
    expect(events[0].from).toBe(1);
    expect(events[0].to).toBe(2);
    expect(state.family.level).toBe(2);
    // family_level.json Lv2 보상: Grain 100 / Gold 200 / Vis 500 / Gem 10
    expect(state.resources.grain).toBe(100);
    expect(state.resources.gold).toBe(200);
    expect(state.resources.vis).toBe(500);
    expect(state.resources.gem).toBe(10);
  });

  it("대량 XP 누적 시 여러 레벨 연속 업 (Lv1 → Lv5)", () => {
    const state = getState();
    state.family.xp = 1035;  // Lv5의 CumulativeXP
    const events = levelUpFamilyIfReady(tables);
    expect(events.length).toBe(4);  // Lv1→2, 2→3, 3→4, 4→5
    expect(state.family.level).toBe(5);
    // 누적 보상: Grain 100+100+150+200 = 550
    expect(state.resources.grain).toBe(550);
    // Gold 200+200+300+500 = 1200
    expect(state.resources.gold).toBe(1200);
  });

  it("최대 레벨 도달 시 더 이상 레벨업 없음", () => {
    const state = getState();
    const maxLv = tables.familyLevel.all().slice(-1)[0].Level;
    state.family.level = maxLv;
    state.family.xp = 99999999;
    const events = levelUpFamilyIfReady(tables);
    expect(events.length).toBe(0);
    expect(state.family.level).toBe(maxLv);
  });

  it("훈련 잠금 해제 흐름 — Lv 6 도달 시 회복 수련 해금", () => {
    const state = getState();
    // 회복 수련(class별이 아닌 recovery)는 UnlockFamilyLv=6
    const recoveryRow = tables.training.all().find(r => r.TrainingType === "recovery" && r.Level === 1);
    expect(recoveryRow.UnlockFamilyLv).toBe(6);

    // Lv6 누적 XP까지 부여
    const lv6 = tables.familyLevel.get(6);
    state.family.xp = lv6.CumulativeXP;
    levelUpFamilyIfReady(tables);
    expect(state.family.level).toBe(6);
    // 가문 Lv 6 ≥ recovery UnlockFamilyLv 6 → 잠금 해제 조건 충족
    expect(state.family.level).toBeGreaterThanOrEqual(recoveryRow.UnlockFamilyLv);
  });
});
