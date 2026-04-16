// BFS pathfinding on hex grid.
// Respects terrain passability (TerrainTable.Movable).
// Returns path as [{q, r, cost}] from start to goal (inclusive), or null if unreachable.
import { neighbors, hexId } from "../util/hex.js";
import { isStructureCaptured } from "../state/gameState.js";

// Build a lookup: HexID → StructureType for gate blocking.
let _gateHexCache = null;
function getGateHexes(tables) {
  if (_gateHexCache) return _gateHexCache;
  _gateHexCache = new Map();
  const structures = tables.structures.all();
  const worldHexIndex = tables.worldHex._index;
  for (const s of structures) {
    // Mark all hexes that have this structure's StructureID
    for (const [, hx] of worldHexIndex) {
      if (hx.StructureID === s.StructureID) {
        _gateHexCache.set(hx.HexID, s);
      }
    }
  }
  return _gateHexCache;
}

// Check if a hex is blocked by an uncaptured gate or other impassable structure.
function isBlockedByStructure(hexData, tables) {
  if (!hexData.StructureID) return false;
  const gateHexes = getGateHexes(tables);
  const struct = gateHexes.get(hexData.HexID);
  if (!struct) return false;
  // Gate: blocked until captured
  if (struct.StructureType === "Gate") {
    return !isStructureCaptured(struct.StructureID);
  }
  // Fort/City/Dungeon: blocked until captured (enemy territory)
  if (struct.StructureType === "Fort" || struct.StructureType === "City" || struct.StructureType === "Dungeon") {
    return !isStructureCaptured(struct.StructureID);
  }
  return false;
}

export function findPath(startQ, startR, goalQ, goalR, tables, maxSteps = 200) {
  const worldHexIndex = tables.worldHex._index;
  const terrainIndex = tables.terrains._index;

  const startKey = `${startQ},${startR}`;
  const goalKey = `${goalQ},${goalR}`;
  if (startKey === goalKey) return [{ q: startQ, r: startR, cost: 0 }];

  // Check goal hex exists and is movable
  const goalHex = worldHexIndex.get(hexId(goalQ, goalR));
  if (!goalHex) return null;
  const goalTerrain = terrainIndex.get(goalHex.TerrainID);
  if (goalTerrain && !goalTerrain.Movable) return null;
  // Goal hex blocked by uncaptured structure → can move TO it (to attack) but path stops there
  const goalBlocked = isBlockedByStructure(goalHex, tables);

  const visited = new Map();  // key -> { prev, cost }
  visited.set(startKey, { prev: null, cost: 0 });
  const queue = [{ q: startQ, r: startR, cost: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    const cKey = `${current.q},${current.r}`;
    if (cKey === goalKey) break;
    if (current.cost >= maxSteps) continue;

    for (const n of neighbors(current.q, current.r)) {
      const nKey = `${n.q},${n.r}`;
      if (visited.has(nKey)) continue;

      const nHexId = hexId(n.q, n.r);
      const nHex = worldHexIndex.get(nHexId);
      if (!nHex) continue;

      const nTerrain = terrainIndex.get(nHex.TerrainID);
      if (!nTerrain || !nTerrain.Movable) continue;

      // Blocked by uncaptured structure — can't pass THROUGH, but can target AS destination
      const blocked = isBlockedByStructure(nHex, tables);
      if (blocked && nKey !== goalKey) continue;  // can't pass through, only stop at

      const stepCost = nTerrain.FatigueCost || 1;
      const totalCost = current.cost + stepCost;
      visited.set(nKey, { prev: cKey, cost: totalCost });

      // If this hex is the blocked goal, don't expand further from it
      if (!blocked) {
        queue.push({ q: n.q, r: n.r, cost: totalCost });
      }
    }
  }

  // Reconstruct path
  if (!visited.has(goalKey)) return null;
  const path = [];
  let cur = goalKey;
  while (cur) {
    const [q, r] = cur.split(",").map(Number);
    const entry = visited.get(cur);
    path.unshift({ q, r, cost: entry.cost });
    cur = entry.prev;
  }
  return path;
}

// Get total fatigue cost of a path (last element's cost).
export function pathCost(path) {
  if (!path || path.length === 0) return 0;
  return path[path.length - 1].cost;
}

// Check if a hex is passable.
export function isPassable(q, r, tables) {
  const hx = tables.worldHex._index.get(hexId(q, r));
  if (!hx) return false;
  const terrain = tables.terrains._index.get(hx.TerrainID);
  return terrain ? terrain.Movable : false;
}
