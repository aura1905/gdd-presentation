// 턴 종료 정산 — M4-A 검증.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { endTurn, computeHexIncome, computeFatigueRecovery } from "../src/engine/turn.js";

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function loadTables() {
  const dir = "data/tables";
  const make = (rows, pk) => ({
    all: () => rows,
    get: (k) => rows.find(r => r[pk] === k),
  });
  return {
    worldHex:   make(loadJson(`${dir}/world_hex.json`),  "HexID"),
    resources:  make(loadJson(`${dir}/resources.json`),  "ID"),
    energy:     make(loadJson(`${dir}/energy.json`),     "ID"),
    structures: make(loadJson(`${dir}/structures.json`), "StructureID"),
  };
}

function makeState(ownedHexes = [], parties = [], characters = []) {
  return {
    meta: { turn: 1, version: "0.1" },
    family: { homeHex: { q: 65, r: 45 } },
    resources: { grain: 0, iron: 0, wood: 0, stone: 0, herbs: 0, gold: 0, vis: 0, gem: 0, mana: 0 },
    characters,
    parties,
    ownedHexes: new Set(ownedHexes),
  };
}

describe("computeHexIncome (자원 수급)", () => {
  const tables = loadTables();

  it("HL0 빈 헥스는 자원 0", () => {
    const home = 6545;  // 리볼도외 중심: TerrainID=13, HexLevel=0
    const inc = computeHexIncome(makeState([home]), tables);
    expect(Object.keys(inc).length).toBe(0);
  });

  it("HL1 iron 헥스는 ProductionPerMin × ValueMultiplier × minutes 만큼 수급", () => {
    // (60,45) HexID=6045 = iron HL1 (Grade1: 3/min × 1.0)
    const inc = computeHexIncome(makeState([6045]), tables);
    expect(inc.iron).toBe(3 * 1 * 10);  // = 30
  });

  it("여러 자원 헥스 동시 수급", () => {
    // 6045=iron HL1, 6144=wood HL1
    const inc = computeHexIncome(makeState([6045, 6144]), tables);
    expect(inc.iron).toBe(30);
    expect(inc.wood).toBe(30);
  });

  it("StructureID 보유 헥스는 별도 처리 (제외)", () => {
    const inc = computeHexIncome(makeState([6545]), tables);
    expect(inc.gold).toBeUndefined();
  });
});

describe("computeFatigueRecovery (피로 회복)", () => {
  const tables = loadTables();

  it("필드 위치 파티 = field RecoveryPerMin × minutes", () => {
    const ch = { id: 1, name: "T", fatigue: 50, maxFatigue: 100 };
    const party = { id: "p1", slots: [1], location: { q: 60, r: 45 } };
    const rec = computeFatigueRecovery(makeState([], [party], [ch]), tables);
    expect(rec.get(1)).toBe(10);  // field 1/min × 10
  });

  it("도시(홈) 위치 파티 = 부족분 전부 회복 (InstantRecovery=-1)", () => {
    const ch = { id: 1, name: "T", fatigue: 30, maxFatigue: 100 };
    const party = { id: "p1", slots: [1], location: { q: 65, r: 45 } };
    const rec = computeFatigueRecovery(makeState([], [party], [ch]), tables);
    expect(rec.get(1)).toBe(70);  // 30 → 100 = +70
  });
});

describe("endTurn (턴 +1 + 정산)", () => {
  const tables = loadTables();

  it("턴 카운터 증가", () => {
    const state = makeState();
    const summary = endTurn(state, tables);
    expect(summary.fromTurn).toBe(1);
    expect(summary.toTurn).toBe(2);
    expect(state.meta.turn).toBe(2);
  });

  it("자원 수급 후 state.resources 누적", () => {
    const state = makeState([6045]);  // iron HL1
    expect(state.resources.iron).toBe(0);
    endTurn(state, tables);
    expect(state.resources.iron).toBe(30);
    endTurn(state, tables);
    expect(state.resources.iron).toBe(60);
  });

  it("피로 회복 적용 + 상태 재계산", () => {
    const ch = { id: 1, name: "T", fatigue: 5, maxFatigue: 100, status: "exhausted" };
    const party = { id: "p1", slots: [1], location: { q: 60, r: 45 } };  // 필드
    const state = makeState([], [party], [ch]);
    endTurn(state, tables);
    expect(ch.fatigue).toBe(15);  // 5 + 10
    expect(ch.status).toBe("tired");  // 15 ≤ 30
  });

  it("리볼도외 7헥스만 보유 + 도시 파티 → 자원 0, 피로 풀회복", () => {
    const reboldoeux = [6545, 6645, 6445, 6646, 6546, 6644, 6544];
    const ch = { id: 1, name: "T", fatigue: 20, maxFatigue: 100 };
    const party = { id: "p1", slots: [1], location: { q: 65, r: 45 } };
    const state = makeState(reboldoeux, [party], [ch]);
    const summary = endTurn(state, tables);
    expect(Object.keys(summary.gainedResources).length).toBe(0);  // HL0 + 구조물 → 0
    expect(ch.fatigue).toBe(100);
  });
});
