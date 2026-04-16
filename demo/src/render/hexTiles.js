// Hex tile sprite loader — maps TerrainTable.Code to PNG tiles.
// Source: Assets/ClientCore/Resources/Field/HexagonTIlied/hex_*.png (256x256)

const TILE_PATH = "assets/hex/tiles";

const CODE_TO_FILE = {
  grassland: "hex_plains",
  plains:    "hex_plains",
  coast:     "hex_coast",
  forest:    "hex_forest",
  swamp:     "hex_swamp",
  desert:    "hex_desert",
  cave:      "hex_ruins",
  volcano:   "hex_volcano",
  ice:       "hex_ice",
  mountain:  "hex_mountain",
  water:     "hex_water",
  wall:      "hex_gate_land",
  city:      "hex_city",
  fortress:  "hex_colony",
  ruins:     "hex_ruins",
  colony:    "hex_colony",
};

const imageCache = new Map();
let allLoaded = false;

export async function loadHexTiles() {
  const uniqueFiles = [...new Set(Object.values(CODE_TO_FILE))];
  const promises = uniqueFiles.map(name => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { imageCache.set(name, img); resolve(); };
      img.onerror = () => { console.warn(`[hexTiles] failed: ${name}.png`); resolve(); };
      img.src = `${TILE_PATH}/${name}.png`;
    });
  });
  await Promise.all(promises);
  allLoaded = true;
  console.log(`[hexTiles] loaded ${imageCache.size} tiles`);
}

export function getHexTileImage(terrainCode) {
  const file = CODE_TO_FILE[terrainCode] || "hex_plains";
  return imageCache.get(file) || null;
}

export function isReady() { return allLoaded; }
