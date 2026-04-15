// HexTileAtlas loader + TerrainID → atlas folder mapping.
//
// Atlas: 2048×1024 PNG, 72×72 tiles, 321 sprites across 63 folders.
// Meta JSON provides each sprite's (x, y) rect.
//
// Each terrain maps to 1~N atlas folders; we pick a deterministic variant
// per hex (hashed by HexID) so neighboring hexes show variety.

const ATLAS_PNG = "assets/hex/atlas.png";
const ATLAS_JSON = "assets/hex/atlas.json";

// TerrainID (TerrainTable) → list of candidate folder names in HexTileAtlas.json.
// If multiple folders, chosen by hash(HexID) for variety.
// Folders unknown to the atlas are filtered out silently.
const TERRAIN_FOLDER_MAP = {
  1:  ["Grass", "LightGrass"],            // grassland
  2:  ["Clear", "LightGrass"],            // plains
  3:  ["RoughIsland", "WoodsIsland"],     // coast
  4:  ["Woods", "Woods2", "PineForest"],  // forest
  5:  ["Marsh", "Swamp", "SymSwamp"],     // swamp
  6:  ["Desert", "DesertScrub"],          // desert
  7:  ["DarkWoods2", "WoodsDark"],        // cave (fallback: dark woods)
  8:  ["Rough", "BoulderHills"],          // volcano (fallback: rough)
  9:  ["Snow", "Ice", "SnowLandClear"],   // ice
  10: ["Mountains", "PointyHills"],       // mountain
  11: ["Ocean", "Water", "Lakes"],        // water
  12: ["Bridges"],                        // wall
  13: ["Cities", "Cities2", "medievalVillages"], // city
  14: ["Churches", "Buildings"],          // fortress
};

const FALLBACK_FOLDER = "Clear";

export async function loadHexAtlas() {
  const [metaRes, img] = await Promise.all([
    fetch(ATLAS_JSON).then(r => r.json()),
    loadImage(ATLAS_PNG),
  ]);

  // Bucket sprites by folder.
  const byFolder = new Map();
  for (const [, sprite] of Object.entries(meta(metaRes).sprites)) {
    if (!byFolder.has(sprite.folder)) byFolder.set(sprite.folder, []);
    byFolder.get(sprite.folder).push(sprite);
  }

  const tileW = metaRes.tileWidth, tileH = metaRes.tileHeight;

  function pick(terrainId, hexId) {
    const candidates = TERRAIN_FOLDER_MAP[terrainId] || [];
    for (const name of candidates) {
      const arr = byFolder.get(name);
      if (arr && arr.length) {
        const hash = Math.abs((hexId * 2654435761) | 0);
        return arr[hash % arr.length];
      }
    }
    const fb = byFolder.get(FALLBACK_FOLDER);
    return fb ? fb[0] : null;
  }

  return {
    image: img,
    tileW, tileH,
    pick,
    _meta: metaRes,
  };
}

function meta(obj) { return obj; }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`image load failed: ${src}`));
    img.src = src;
  });
}

export const HEX_ATLAS_IMPASSABLE_TERRAINS = new Set([10, 11, 12]);
