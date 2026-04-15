// Terrain colour palette — copied verbatim from world-map-editor
// (gdd-presentation/world-map-editor/index.html, const TERRAINS).
// Keys match TerrainTable.Code.  Missing codes fall back to 'plains'.
export const TERRAIN_PALETTE = {
  grassland: { color: "#8fc06e", side: "#6a9a4e", dark: "#507838", passable: true,  elev: 2  },
  plains:    { color: "#8fc06e", side: "#6a9a4e", dark: "#507838", passable: true,  elev: 2  },
  forest:    { color: "#5a9e3e", side: "#3d7a28", dark: "#2d5e1c", passable: true,  elev: 2  },
  desert:    { color: "#e2c76a", side: "#c4a84e", dark: "#a68e38", passable: true,  elev: 2  },
  coast:     { color: "#c8b87a", side: "#a89860", dark: "#8a7a48", passable: true,  elev: 2  },
  swamp:     { color: "#7aaa5e", side: "#5c8844", dark: "#446830", passable: true,  elev: 2  },
  ice:       { color: "#d0d8c8", side: "#b0b8a8", dark: "#909888", passable: true,  elev: 2  },
  city:      { color: "#c0b8a8", side: "#9a9488", dark: "#7a7468", passable: true,  elev: 2  },
  fortress:  { color: "#b0a090", side: "#8a7a68", dark: "#6a5a48", passable: true,  elev: 2  },
  wall:      { color: "#908888", side: "#686060", dark: "#484040", passable: false, elev: 8  },
  mountain:  { color: "#8a8078", side: "#5e5650", dark: "#3e3838", passable: false, elev: 14 },
  cave:      { color: "#4a3e36", side: "#302820", dark: "#201c16", passable: false, elev: 8  },
  volcano:   { color: "#7a3030", side: "#5a2020", dark: "#401818", passable: false, elev: 16 },
  water:     { color: "#2a6090", side: "#1a4060", dark: "#102840", passable: false, elev: -4 },
};

const FALLBACK = TERRAIN_PALETTE.plains;

export function paletteForTerrainCode(code) {
  return TERRAIN_PALETTE[code] || FALLBACK;
}
