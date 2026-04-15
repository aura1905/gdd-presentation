// hex utils — verifies our implementation matches world-map-editor (Unity YXZ / odd-r).
import { describe, it, expect } from "vitest";
import {
  hexId, unpackId, hexCenter, pixelToHex,
  neighbors, neighborDeltas, distance, withinRadius,
} from "../src/util/hex.js";
import { CONFIG } from "../src/config.js";

const SIZE = CONFIG.hex.W / 2;
const SQRT3 = Math.sqrt(3);

describe("hex ID packing (HexID = q*100 + r)", () => {
  it("packs/unpacks correctly", () => {
    expect(hexId(42, 81)).toBe(4281);
    expect(hexId(0, 5)).toBe(5);
    expect(hexId(10, 0)).toBe(1000);
    expect(unpackId(4281)).toEqual({ q: 42, r: 81 });
    expect(unpackId(1000)).toEqual({ q: 10, r: 0 });
  });
});

describe("hex center (editor formula)", () => {
  it("origin at (0, 0)", () => {
    expect(hexCenter(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("column stride x = 1.5 * R", () => {
    const c0 = hexCenter(0, 0);
    const c1 = hexCenter(0, 1);
    expect(c1.x - c0.x).toBeCloseTo(1.5 * SIZE);
  });

  it("row stride y = sqrt(3) * R (at even r)", () => {
    const c0 = hexCenter(0, 0);
    const c1 = hexCenter(1, 0);
    expect(c1.y - c0.y).toBeCloseTo(SQRT3 * SIZE);
  });

  it("odd-r column shifted by +0.5 row", () => {
    const evenR = hexCenter(3, 0);  // r=0 even
    const oddR  = hexCenter(3, 1);  // r=1 odd
    const shift = oddR.y - evenR.y;
    expect(shift).toBeCloseTo(0.5 * SQRT3 * SIZE);
  });

  it("same r parity -> same y pattern", () => {
    const a = hexCenter(3, 0);
    const b = hexCenter(3, 2);
    expect(a.y).toBeCloseTo(b.y);
  });
});

describe("pixelToHex inverse", () => {
  it("round-trips interior hexes", () => {
    const samples = [
      [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 2],
      [10, 10], [42, 81], [99, 99], [50, 25], [7, 88], [33, 33],
    ];
    for (const [q, r] of samples) {
      const c = hexCenter(q, r);
      const got = pixelToHex(c.x, c.y);
      expect(got.q).toBe(q);
      expect(got.r).toBe(r);
    }
  });

  it("snaps to nearest hex from offset pixel", () => {
    const c = hexCenter(5, 5);
    expect(pixelToHex(c.x + 1, c.y + 1)).toEqual({ q: 5, r: 5 });
    expect(pixelToHex(c.x - 2, c.y - 3)).toEqual({ q: 5, r: 5 });
  });
});

describe("neighbors (odd-r offset, flat-top)", () => {
  it("returns 6 unique neighbors", () => {
    for (const [q, r] of [[0, 0], [1, 1], [10, 10], [2, 5]]) {
      const ns = neighbors(q, r);
      expect(ns).toHaveLength(6);
      const set = new Set(ns.map(n => `${n.q},${n.r}`));
      expect(set.size).toBe(6);
      expect(set.has(`${q},${r}`)).toBe(false);
    }
  });

  it("even-r and odd-r use different deltas", () => {
    expect(neighborDeltas(0, 0)).not.toEqual(neighborDeltas(0, 1));
  });

  it("neighbor relation symmetric", () => {
    for (const [q, r] of [[5, 5], [10, 20], [33, 7]]) {
      for (const n of neighbors(q, r)) {
        const back = neighbors(n.q, n.r);
        expect(back.some(b => b.q === q && b.r === r)).toBe(true);
      }
    }
  });

  it("neighbors of (3, 0) [r=0 even] match editor DELTAS_EVEN_R", () => {
    // (3,0): even r → [1,0],[-1,0],[0,1],[-1,1],[0,-1],[-1,-1]
    const expected = new Set([
      "4,0", "2,0", "3,1", "2,1", "3,-1", "2,-1",
    ]);
    const got = new Set(neighbors(3, 0).map(n => `${n.q},${n.r}`));
    expect(got).toEqual(expected);
  });

  it("neighbors of (3, 1) [r=1 odd] match editor DELTAS_ODD_R", () => {
    // (3,1): odd r → [1,0],[-1,0],[1,1],[0,1],[1,-1],[0,-1]
    const expected = new Set([
      "4,1", "2,1", "4,2", "3,2", "4,0", "3,0",
    ]);
    const got = new Set(neighbors(3, 1).map(n => `${n.q},${n.r}`));
    expect(got).toEqual(expected);
  });

  it("neighbor pixel distance ≈ 1 hex step", () => {
    // Any neighbor's center should be ~sqrt(3) * R away (since x-step = 1.5R, y-step = sqrt(3)/2*R per side).
    // Actually for flat-top the neighbor distance equals R * sqrt(3).
    const expectedPx = SIZE * SQRT3;
    for (const n of neighbors(5, 5)) {
      const a = hexCenter(5, 5), b = hexCenter(n.q, n.r);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      expect(d).toBeCloseTo(expectedPx, 1);
    }
  });
});

describe("distance (cube)", () => {
  it("zero for same hex", () => {
    expect(distance(5, 5, 5, 5)).toBe(0);
  });

  it("one for neighbors", () => {
    for (const [q, r] of [[5, 5], [10, 10], [2, 8]]) {
      for (const n of neighbors(q, r)) {
        expect(distance(q, r, n.q, n.r)).toBe(1);
      }
    }
  });

  it("triangle inequality", () => {
    const ab = distance(0, 0, 5, 3);
    const bc = distance(5, 3, 10, 7);
    const ac = distance(0, 0, 10, 7);
    expect(ac).toBeLessThanOrEqual(ab + bc);
  });

  it("symmetric", () => {
    expect(distance(0, 0, 7, 11)).toBe(distance(7, 11, 0, 0));
  });
});

describe("withinRadius", () => {
  it("radius 0 returns only center", () => {
    const r0 = withinRadius(5, 5, 0);
    expect(r0).toHaveLength(1);
    expect(r0[0]).toMatchObject({ q: 5, r: 5, d: 0 });
  });

  it("radius 1 returns 7 hexes", () => {
    expect(withinRadius(5, 5, 1)).toHaveLength(7);
  });

  it("radius 2 returns 19 hexes (1 + 6 + 12)", () => {
    expect(withinRadius(10, 10, 2)).toHaveLength(19);
  });

  it("radius 3 returns 37 hexes", () => {
    expect(withinRadius(10, 10, 3)).toHaveLength(37);
  });

  it("all returned satisfy distance <= radius", () => {
    const r = 4;
    for (const h of withinRadius(20, 20, r)) {
      expect(distance(20, 20, h.q, h.r)).toBeLessThanOrEqual(r);
    }
  });
});
