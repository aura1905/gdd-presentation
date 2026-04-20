// Loads all JSON tables and provides indexed Map lookups.
//
// Each table is fetched on demand or pre-loaded via loadAllTables().
// Usage:
//   const t = await loadAllTables();
//   t.terrains.get(1)          // TerrainID 1 row
//   t.worldHex.get(4281)       // HexID 4281 row
//   t.regions.get(1)           // RegionID 1 row

const BASE = "data/tables";

const TABLE_CONFIG = {
  terrains:          { file: "terrains.json",          pk: "TerrainID" },
  regions:           { file: "regions.json",           pk: "RegionID" },
  resources:         { file: "resources.json",         pk: "ID" },
  structures:        { file: "structures.json",        pk: "StructureID" },
  structureDefense:  { file: "structure_defense.json", pk: "ID" },
  enemyParties:      { file: "enemy_parties.json",     pk: "ID" },
  fieldObjects:      { file: "field_objects.json",     pk: null },      // composite (ID + ObjectType)
  skills:            { file: "skills.json",            pk: "SkillID" },
  equipment:         { file: "equipment.json",         pk: "ID" },
  bonds:             { file: "bonds.json",             pk: "ID" },
  characterExp:      { file: "character_exp.json",     pk: "Level" },
  quests:            { file: "quests.json",            pk: "QuestID" },
  drops:             { file: "drops.json",             pk: "ID" },
  training:          { file: "training.json",          pk: "ID" },
  research:          { file: "research.json",          pk: "ID" },
  fortification:     { file: "fortification.json",     pk: "ID" },
  familyLevel:       { file: "family_level.json",      pk: "Level" },
  gacha:             { file: "gacha.json",             pk: "ID" },
  energy:            { file: "energy.json",            pk: "ID" },
  stages:            { file: "stages.json",            pk: "StageID" },
  battleFields:      { file: "battle_fields.json",     pk: "ID" },
  worldHex:          { file: "world_hex.json",         pk: "HexID" },
};

async function fetchJson(path) {
  // Cache-busting — 데이터 테이블이 자주 갱신되므로 항상 fresh fetch.
  // 브라우저가 옛 JSON을 들고 있어서 변경이 안 보이는 문제 해결.
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  return await r.json();
}

function indexRows(rows, pk) {
  const m = new Map();
  if (!pk) return m;
  for (const row of rows) {
    const k = row[pk];
    if (k != null) m.set(k, row);
  }
  return m;
}

export async function loadAllTables(onProgress) {
  const entries = Object.entries(TABLE_CONFIG);
  const tables = {};
  let done = 0;
  for (const [name, cfg] of entries) {
    onProgress?.(name, done, entries.length);
    const rows = await fetchJson(`${BASE}/${cfg.file}`);
    tables[name] = {
      rows,
      get: (key) => indexMap.get(key),
      all: () => rows,
      count: () => rows.length,
    };
    const indexMap = indexRows(rows, cfg.pk);
    tables[name].get = (key) => indexMap.get(key);
    tables[name]._index = indexMap;
    done += 1;
  }
  onProgress?.(null, done, entries.length);

  // Also load strings_kr (flat map)
  tables.strings = await fetchJson(`${BASE}/strings_kr.json`);

  return tables;
}

// Translate helper
export function tr(tables, key, fallback = null) {
  if (!key) return fallback ?? "";
  return tables.strings?.[key] ?? (fallback ?? key);
}
