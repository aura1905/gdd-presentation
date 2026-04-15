// Bootstrap: load tables + atlas, init canvas, run render loop.
import { CONFIG } from "./config.js";
import { loadAllTables, tr } from "./data/tables.js";
import { createCamera } from "./render/camera.js";
import { createWorldmapRenderer } from "./render/worldmap.js";
import { createOverlays } from "./render/overlays.js";
import { worldToHex, hexId } from "./util/hex.js";
import { emit } from "./util/events.js";

const status = (msg) => {
  const el = document.getElementById("loading-status");
  if (el) el.textContent = msg;
};

async function boot() {
  const canvas = document.getElementById("worldmap");
  const ctx = canvas.getContext("2d", { alpha: false });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  status("테이블 로드 중…");
  const tables = await loadAllTables((name) => {
    if (name) status(`테이블 로드: ${name}…`);
  });

  status(`렌더 초기화 (${tables.worldHex.count()} 헥스)…`);
  const overlays = createOverlays();
  const camera = createCamera(canvas, 0, 0);
  const worldmap = createWorldmapRenderer(ctx, canvas, camera, tables, overlays);

  // Center camera on world center.
  const center = {
    x: (worldmap.worldSize.minX + worldmap.worldSize.maxX) / 2,
    y: (worldmap.worldSize.minY + worldmap.worldSize.maxY) / 2,
  };
  camera.centerOn(center.x, center.y);
  camera.setScale(CONFIG.camera.stratScale);

  // Interaction: click -> hex info
  camera.onClick((sx, sy) => {
    const world = camera.screenToWorld(sx, sy);
    const { q, r } = worldToHex(world.x, world.y);
    const id = hexId(q, r);
    const row = tables.worldHex.get(id);
    if (!row) {
      overlays.clearSelected();
      document.getElementById("hex-panel").hidden = true;
      worldmap.requestDraw();
      return;
    }
    overlays.setSelected(q, r);
    showHexPanel(row, tables);
    worldmap.requestDraw();
    if (CONFIG.debug.logHexClick) {
      console.log("[hex]", { HexID: row.HexID, HexQ: row.HexQ, HexR: row.HexR,
        TerrainID: row.TerrainID, RegionID: row.RegionID,
        HexLevel: row.HexLevel, ResourceCode: row.ResourceCode ?? null,
        StructureID: row.StructureID ?? 0 });
    }
    emit("hex:selected", { hexId: id, q, r, row });
  });

  // Zoom preset buttons
  document.getElementById("btn-zoom-strat").addEventListener("click", () =>
    camera.setScale(CONFIG.camera.stratScale));
  document.getElementById("btn-zoom-tile").addEventListener("click", () =>
    camera.setScale(CONFIG.camera.tileScale));

  document.getElementById("btn-close-panel").addEventListener("click", () => {
    document.getElementById("hex-panel").hidden = true;
    overlays.clearSelected();
    worldmap.requestDraw();
  });

  // Animation loop
  function tick() {
    worldmap.draw();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  status(`준비 완료 · ${tables.worldHex.count()} 헥스 · ${tables.regions.count()} 리전`);
  setTimeout(() => document.getElementById("splash").classList.add("hide"), 400);

  if (CONFIG.debug.showStats) {
    window.__demo = { tables, atlas, camera, worldmap, overlays };
    console.log("[demo] debug handle exposed as window.__demo");
  }
}

function showHexPanel(row, tables) {
  const panel = document.getElementById("hex-panel");
  const terrain = tables.terrains.get(row.TerrainID);
  const region = tables.regions.get(row.RegionID);
  const structure = row.StructureID ? tables.structures.get(row.StructureID) : null;
  const title = document.getElementById("hex-title");
  const meta = document.getElementById("hex-meta");
  const parts = [];
  parts.push(`헥스 #${row.HexID} (Q=${row.HexQ}, R=${row.HexR})`);
  parts.push(`지형: ${terrain ? terrain.Code : "?"}  Lv${row.HexLevel ?? 0}`);
  if (region) parts.push(`리전: ${tr(tables, region.NameKey, `R${region.RegionID}`)}`);
  if (row.ResourceCode) parts.push(`자원: ${row.ResourceCode}`);
  if (structure) parts.push(`구조물: ${structure.StructureType} #${structure.StructureID}`);
  title.textContent = region ? tr(tables, region.NameKey, `R${region.RegionID}`) : `헥스 #${row.HexID}`;
  meta.innerHTML = parts.join("<br>");

  // M1: action buttons are placeholders (disabled until M2/M3).
  const actions = document.getElementById("hex-actions");
  actions.innerHTML = "";
  for (const label of ["이동", "공격", "탐색", "점령"]) {
    const b = document.createElement("button");
    b.textContent = label;
    b.disabled = true;
    actions.appendChild(b);
  }
  panel.hidden = false;
}

boot().catch((e) => {
  console.error(e);
  status(`오류: ${e.message}`);
});
