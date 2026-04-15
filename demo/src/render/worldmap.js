// World map renderer — editor-style (colored hex polygons + ISO Y compression).
// Matches gdd-presentation/world-map-editor visual convention.
import { CONFIG } from "../config.js";
import { hexWorld } from "../util/hex.js";
import { paletteForTerrainCode } from "./terrainColors.js";

const ISO_Y = 0.75;  // matches util/hex.js

export function createWorldmapRenderer(ctx, canvas, camera, tables, overlays) {
  const R = CONFIG.hex.W / 2;   // hex radius in world px (before ISO)
  const hexes = tables.worldHex.all();
  const terrainById = tables.terrains;  // already indexed by TerrainID

  // World-space bounds (ISO already applied by hexWorld).
  let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
  for (const hx of hexes) {
    const c = hexWorld(hx.HexQ, hx.HexR);
    if (c.x < wMinX) wMinX = c.x;
    if (c.x > wMaxX) wMaxX = c.x;
    if (c.y < wMinY) wMinY = c.y;
    if (c.y > wMaxY) wMaxY = c.y;
  }
  const worldSize = {
    minX: wMinX - R, minY: wMinY - R, maxX: wMaxX + R, maxY: wMaxY + R,
    w: (wMaxX - wMinX) + R * 2, h: (wMaxY - wMinY) + R * 2,
  };

  let needsDraw = true;
  camera.onChange(() => { needsDraw = true; });

  const stats = { lastFrameMs: 0, drawnHexes: 0 };

  function hexVertsIso(cx, cy, size) {
    // editor's hexVerts: flat-top hex (angle steps Math.PI/3), with ISO_Y on sin.
    const v = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      v.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) * ISO_Y });
    }
    return v;
  }

  function drawHex(hx) {
    const p = hexWorld(hx.HexQ, hx.HexR);
    const screen = camera.worldToScreen(p.x, p.y);
    const size = R * camera.scale;
    // Viewport cull
    const margin = size * 2;
    if (screen.x < -margin || screen.x > canvas.clientWidth + margin ||
        screen.y < -margin || screen.y > canvas.clientHeight + margin) {
      return false;
    }

    const terrain = terrainById.get(hx.TerrainID);
    const code = terrain ? terrain.Code : "plains";
    const pal = paletteForTerrainCode(code);

    const verts = hexVertsIso(screen.x, screen.y, size);
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    ctx.fillStyle = pal.color;
    ctx.fill();
    if (size > 3) {
      ctx.strokeStyle = pal.dark;
      ctx.lineWidth = Math.max(0.3, size * 0.03);
      ctx.stroke();
    }

    // Hex level tint (darker for higher-level "combat" hexes to hint danger).
    if (hx.HexLevel && hx.HexLevel > 0 && size > 6) {
      const alpha = 0.08 * hx.HexLevel;
      ctx.fillStyle = `rgba(180,40,40,${alpha})`;
      ctx.fill();
    }

    // Resource dot (small, bottom-left of hex so it doesn't collide with level label)
    if (hx.ResourceCode && size > 8) {
      const rx = screen.x - size * 0.4, ry = screen.y + size * 0.3;
      ctx.beginPath();
      ctx.arc(rx, ry, size * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = resourceColor(hx.ResourceCode);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // HexLevel number (1~5) — centered
    if (hx.HexLevel && hx.HexLevel > 0 && size > 10) {
      const fontSize = Math.max(8, size * 0.42);
      ctx.font = `bold ${fontSize}px 'Segoe UI'`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillText(String(hx.HexLevel), screen.x + 1, screen.y + 1);
      ctx.fillStyle = "#fff";
      ctx.fillText(String(hx.HexLevel), screen.x, screen.y);
    }

    return true;
  }

  // Draw structures (Gate / Fort / City / Dungeon) in a second pass so they
  // always render on top of the base hex layer.
  function drawStructures() {
    const structRows = tables.structures.all();
    for (const s of structRows) {
      if (s.HexQ == null || s.HexR == null) continue;
      const p = hexWorld(s.HexQ, s.HexR);
      const screen = camera.worldToScreen(p.x, p.y);
      const size = R * camera.scale;
      if (screen.x < -size * 3 || screen.x > canvas.clientWidth + size * 3 ||
          screen.y < -size * 3 || screen.y > canvas.clientHeight + size * 3) continue;
      drawStructure(s, screen.x, screen.y, size);
    }
  }

  function drawStructure(s, cx, cy, size) {
    const type = s.StructureType;
    if (type === "Gate")    return drawGate(cx, cy, size, s);
    if (type === "Fort")    return drawFort(cx, cy, size, s);
    if (type === "City")    return drawCity(cx, cy, size, s);
    if (type === "Dungeon") return drawDungeon(cx, cy, size, s);
  }

  function drawGate(cx, cy, size, s) {
    // editor's drawGateIcon (simplified): two pillars + lintel + arch.
    const w = size * 0.9;
    ctx.fillStyle = "#6a6070";
    ctx.fillRect(cx - w * 0.55, cy - w * 0.5, w * 0.25, w * 0.9);
    ctx.fillRect(cx + w * 0.3,  cy - w * 0.5, w * 0.25, w * 0.9);
    ctx.fillStyle = "#8a7890";
    ctx.fillRect(cx - w * 0.65, cy - w * 0.6, w * 1.3, w * 0.2);
    ctx.fillStyle = "#1a1a2e";
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.28, cy + w * 0.4);
    ctx.lineTo(cx - w * 0.28, cy - w * 0.15);
    ctx.quadraticCurveTo(cx, cy - w * 0.45, cx + w * 0.28, cy - w * 0.15);
    ctx.lineTo(cx + w * 0.28, cy + w * 0.4);
    ctx.closePath();
    ctx.fill();
    // Gate number label below
    if (size > 9) {
      ctx.font = `bold ${size * 0.45}px 'Segoe UI'`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#ffd452";
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 2;
      const label = String(s.StructureID);
      ctx.strokeText(label, cx, cy + w * 0.5);
      ctx.fillText(label, cx, cy + w * 0.5);
    }
  }

  function drawFort(cx, cy, size, s) {
    // Circle + "F" letter
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.55, 0, Math.PI * 2 * ISO_Y);  // squashed disc
    ctx.ellipse?.(cx, cy, size * 0.55, size * 0.55 * ISO_Y, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(243,139,168,0.85)";
    ctx.fill();
    ctx.strokeStyle = "#c05070";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (size > 8) {
      ctx.font = `bold ${size * 0.7}px 'Segoe UI'`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeText("F", cx, cy);
      ctx.fillText("F", cx, cy);
    }
  }

  function drawCity(cx, cy, size, s) {
    // Large ring + NAME label
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 2.2, size * 2.2 * ISO_Y, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "#c8a848";
    ctx.setLineDash([6, 3]);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 1.8, size * 1.8 * ISO_Y, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(249,226,175,0.12)";
    ctx.fill();
    if (size > 5) {
      const label = s.Name || s.NameKey || "City";
      ctx.font = `bold ${size * 1.1}px 'Segoe UI'`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
      ctx.fillStyle = "#f9e2af";
      ctx.fillText(label, cx, cy);
      ctx.shadowBlur = 0;
    }
  }

  function drawDungeon(cx, cy, size, s) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.5, size * 0.5 * ISO_Y, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,107,107,0.85)";
    ctx.fill();
    ctx.strokeStyle = "#c03030";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (size > 8) {
      ctx.font = `bold ${size * 0.65}px 'Segoe UI'`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeText("D", cx, cy);
      ctx.fillText("D", cx, cy);
    }
  }

  function resourceColor(code) {
    switch (code) {
      case "iron":  return "#a8a8a8";
      case "wood":  return "#6b4a2a";
      case "stone": return "#c0bab0";
      case "grain": return "#e8c858";
      case "herbs": return "#72c272";
      default:      return "#cccccc";
    }
  }

  function draw() {
    if (!needsDraw) return false;
    needsDraw = false;
    const t0 = performance.now();

    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sort by world-y so back hexes render first (simple painter's algorithm).
    // For perf with 10k+ hexes, skip sorting and rely on correct insertion order.
    // The WorldHexTable is insertion-ordered by HexID, which is close enough for a flat ISO view.
    let drawn = 0;
    for (const hx of hexes) {
      if (drawHex(hx)) drawn += 1;
    }

    drawStructures();

    overlays?.draw(ctx, camera);

    stats.lastFrameMs = performance.now() - t0;
    stats.drawnHexes = drawn;
    return true;
  }

  return { draw, worldSize, stats, requestDraw: () => { needsDraw = true; } };
}
