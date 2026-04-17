// 점령/토벌 즉시 보상 분기 검증 — drops.json BattleType 매칭 + ResourceQty.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { lookupDropReward } from "../src/engine/combat.js";

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function loadTables() {
  const dir = "data/tables";
  const make = (rows, pk) => ({
    all: () => rows,
    get: (k) => rows.find(r => r[pk] === k),
  });
  return {
    drops: make(loadJson(`${dir}/drops.json`), "ID"),
  };
}

describe("lookupDropReward — BattleType 분기", () => {
  const tables = loadTables();

  it("occupy Lv1: Gold 30, Vis 10, ResourceQty 2, MaterialQty 1", () => {
    const r = lookupDropReward("occupy", tables, 1);
    expect(r.gold).toBe(30);
    expect(r.vis).toBe(10);
    expect(r.charExp).toBe(50);
    expect(r.resourceQty).toBe(2);
    expect(r.materialQty).toBe(1);
  });

  it("subjugate Lv1: Gold 20, Vis 5, ResourceQty 1 (occupy보다 적음)", () => {
    const r = lookupDropReward("subjugate", tables, 1);
    expect(r.gold).toBe(20);
    expect(r.vis).toBe(5);
    expect(r.resourceQty).toBe(1);
  });

  it("occupy/subjugate 보상 비교 — 점령이 토벌보다 큼 (Gold/Vis/ResourceQty)", () => {
    for (const lv of [1, 2, 3, 4, 5]) {
      const occ = lookupDropReward("occupy", tables, lv);
      const sub = lookupDropReward("subjugate", tables, lv);
      expect(occ.gold).toBeGreaterThan(sub.gold);
      expect(occ.vis).toBeGreaterThan(sub.vis);
      expect(occ.resourceQty).toBeGreaterThan(sub.resourceQty);
    }
  });

  it("매칭 없는 BattleType → 모두 0", () => {
    const r = lookupDropReward("nonsense", tables, 1);
    expect(r.gold).toBe(0);
    expect(r.resourceQty).toBe(0);
    expect(r.materialQty).toBe(0);
  });

  it("HexLevel 5 occupy: ResourceQty 12, MaterialQty 3 (최대값)", () => {
    const r = lookupDropReward("occupy", tables, 5);
    expect(r.resourceQty).toBe(12);
    expect(r.materialQty).toBe(3);
  });
});
