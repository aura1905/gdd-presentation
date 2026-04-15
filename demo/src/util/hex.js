// Hex utilities — matches world-map-editor (gdd-presentation/world-map-editor/index.html).
//
// Convention (world-map-editor § HEX MATH):
//   - Flat-top hexagons
//   - q = ROW (vertical index), r = COL (horizontal index)
//   - Odd-r offset: odd COLUMNS are shifted vertically by 0.5 row
//   - WorldHexTable: HexID = HexQ * 100 + HexR, "에디터 좌표 그대로 (swap 없음)"
//
// Pixel space:
//   x = R * 1.5 * r
//   y = R * sqrt(3) * (q + 0.5 * (r & 1))
//   where R = hex radius (half-width).
import { CONFIG } from "../config.js";

const SQRT3 = Math.sqrt(3);
const R = () => CONFIG.hex.W / 2;  // hex radius in pixels
const ISO_Y = 0.75;  // editor's isometric Y compression (applied in screen space only)

// ---------------------------------------------------------------------------
// HexID packing  (HexID = q * 100 + r)
// ---------------------------------------------------------------------------
export const hexId = (q, r) => q * 100 + r;
export const unpackId = (id) => ({ q: Math.floor(id / 100), r: id % 100 });

// ---------------------------------------------------------------------------
// Axial/offset <-> pixel
// ---------------------------------------------------------------------------
export function hexCenter(q, r) {
  const size = R();
  return {
    x: size * 1.5 * r,
    y: size * SQRT3 * (q + 0.5 * (r & 1)),
  };
}

// World-space center (includes editor's ISO Y flip & 0.75 compression).
// All rendering and hit-testing should use this as the canonical world space.
export function hexWorld(q, r) {
  const p = hexCenter(q, r);
  return { x: p.x, y: -p.y * ISO_Y };
}

// Inverse of hexWorld: world-space pixel -> (q, r).
export function worldToHex(wx, wy) {
  return pixelToHex(wx, -wy / ISO_Y);
}

// pixel -> (q, r), for the flat (non-iso) projection.
// (Matches the editor's pixelToHex with realPy = py, no ISO inversion.)
export function pixelToHex(px, py) {
  const size = R();
  const cx = (2 / 3 * px) / size;
  const cz = (-1 / 3 * px + SQRT3 / 3 * py) / size;
  const cy = -cx - cz;
  let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
  const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  // cube -> odd-r offset:  r = col = cube_x, q = row = cube_z + floor(cube_x / 2)
  return { q: rz + ((rx - (rx & 1)) >> 1), r: rx };
}

// ---------------------------------------------------------------------------
// Neighbors (odd-r offset, flat-top) — editor's getHexDirs verbatim.
//   Even r (col): [+1,0],[-1,0],[0,+1],[-1,+1],[0,-1],[-1,-1]
//   Odd r (col):  [+1,0],[-1,0],[+1,+1],[0,+1],[+1,-1],[0,-1]
// ---------------------------------------------------------------------------
const DELTAS_EVEN_R = [[1, 0], [-1, 0], [0, 1], [-1, 1], [0, -1], [-1, -1]];
const DELTAS_ODD_R  = [[1, 0], [-1, 0], [1, 1], [0, 1], [1, -1], [0, -1]];

export function neighborDeltas(q, r) {
  return (r & 1) ? DELTAS_ODD_R : DELTAS_EVEN_R;
}

export function neighbors(q, r) {
  return neighborDeltas(q, r).map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

// ---------------------------------------------------------------------------
// Distance (cube-based).  odd-r -> cube inversion must match editor's convention.
// ---------------------------------------------------------------------------
function offsetToCube(q, r) {
  // odd-r offset (editor):
  //   cube_x = r
  //   cube_z = q - (r - (r & 1)) / 2
  //   cube_y = -cube_x - cube_z
  const x = r;
  const z = q - ((r - (r & 1)) >> 1);
  const y = -x - z;
  return { x, y, z };
}

export function distance(q1, r1, q2, r2) {
  const a = offsetToCube(q1, r1);
  const b = offsetToCube(q2, r2);
  return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2;
}

// ---------------------------------------------------------------------------
// BFS range
// ---------------------------------------------------------------------------
export function withinRadius(q, r, radius) {
  const out = [];
  const visited = new Set();
  const key = (q, r) => `${q},${r}`;
  const queue = [{ q, r, d: 0 }];
  visited.add(key(q, r));
  while (queue.length) {
    const { q: cq, r: cr, d } = queue.shift();
    out.push({ q: cq, r: cr, d });
    if (d === radius) continue;
    for (const n of neighbors(cq, cr)) {
      const k = key(n.q, n.r);
      if (!visited.has(k)) {
        visited.add(k);
        queue.push({ q: n.q, r: n.r, d: d + 1 });
      }
    }
  }
  return out;
}
