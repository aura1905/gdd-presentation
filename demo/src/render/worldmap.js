// World map renderer — editor-style (colored hex polygons + ISO Y compression).
// Matches gdd-presentation/world-map-editor visual convention.
import { CONFIG } from "../config.js";
import { hexWorld, hexId } from "../util/hex.js";
import { paletteForTerrainCode } from "./terrainColors.js";
import { getHexTileImage } from "./hexTiles.js";
import { isHexOwned } from "../state/gameState.js";
import { getFogState } from "../engine/fog.js";
import { getState } from "../state/gameState.js";

const ISO_Y = 0.75;  // matches util/hex.js

export function createWorldmapRenderer(ctx, canvas, camera, tables, overlays) {
  const R = CONFIG.hex.W / 2;   // hex radius in world px (before ISO)
  // Sort hexes for isometric draw order (painter's algorithm):
  // back (top of screen) → front (bottom of screen).
  // Use actual world-space Y, with X as tiebreaker (left before right).
  const hexes = tables.worldHex.all().slice().sort((a, b) => {
    const wa = hexWorld(a.HexQ, a.HexR);
    const wb = hexWorld(b.HexQ, b.HexR);
    if (wa.y !== wb.y) return wa.y - wb.y;   // smaller worldY (higher on screen) drawn first
    return wa.x - wb.x;                       // left before right
  });
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
  // 캐릭터 애니메이션 / 파티 이동 애니메이션을 위해 매 프레임 다시 그림
  setInterval(() => { needsDraw = true; }, 80);  // ~12.5fps refresh trigger

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

    // Try sprite tile first, fall back to colored polygon
    const tileImg = getHexTileImage(code);
    if (tileImg) {
      // Tiles are 256x256, scale to hex size. Width = size*2, maintain aspect.
      const drawW = size * 2;
      const drawH = drawW * (tileImg.height / tileImg.width);
      ctx.drawImage(tileImg,
        screen.x - drawW / 2,
        screen.y - drawH / 2 - size * 0.08,  // slight Y offset for ISO base alignment
        drawW, drawH);
    } else {
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
    }

    // 점령 오버레이는 별도 패스에서 (드로우 순서 문제 회피)

    // Hex level tint
    if (hx.HexLevel && hx.HexLevel > 0 && size > 6) {
      const alpha = 0.08 * hx.HexLevel;
      ctx.fillStyle = `rgba(180,40,40,${alpha})`;
      ctx.fill();
    }

    // Resource icon (헥스 중앙, 큼직한 이모지 + 그림자)
    if (hx.ResourceCode && size > 8) {
      const icon = resourceIcon(hx.ResourceCode);
      ctx.font = `${size * 0.95}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = Math.max(2, size * 0.12);
      ctx.fillStyle = "#fff";
      ctx.fillText(icon, screen.x, screen.y - size * 0.05);
      ctx.shadowBlur = 0;
    }

    // HexLevel number — 우상단으로 이동 (자원 아이콘과 겹치지 않게)
    if (hx.HexLevel && hx.HexLevel > 0 && size > 10) {
      const lx = screen.x + size * 0.45, ly = screen.y - size * 0.4;
      const lr = size * 0.22;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hx.HexLevel >= 4 ? "180,40,40" : hx.HexLevel >= 2 ? "200,140,40" : "100,140,80"},0.95)`;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.font = `bold ${Math.max(8, size * 0.34)}px 'Segoe UI'`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(String(hx.HexLevel), lx, ly);
    }

    return true;
  }

  // 점령 헥스 오버레이 (반투명 초록 + 두꺼운 테두리)
  function drawOwnedOverlay() {
    for (const hx of hexes) {
      if (!isHexOwned(hx.HexID)) continue;
      const p = hexWorld(hx.HexQ, hx.HexR);
      const screen = camera.worldToScreen(p.x, p.y);
      const size = R * camera.scale;
      const margin = size * 2;
      if (screen.x < -margin || screen.x > canvas.clientWidth + margin ||
          screen.y < -margin || screen.y > canvas.clientHeight + margin) continue;
      const ov = hexVertsIso(screen.x, screen.y, size);
      ctx.beginPath();
      ctx.moveTo(ov[0].x, ov[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(ov[i].x, ov[i].y);
      ctx.closePath();
      ctx.fillStyle = "rgba(60,200,60,0.20)";
      ctx.fill();
      ctx.strokeStyle = "rgba(80,255,80,0.95)";
      ctx.lineWidth = Math.max(1.5, size * 0.07);
      ctx.stroke();
    }
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

  function resourceIcon(code) {
    switch (code) {
      case "iron":  return "⛏️";   // 철광석
      case "wood":  return "🌲";   // 목재
      case "stone": return "🪨";   // 석재
      case "grain": return "🌾";   // 곡물
      case "herbs": return "🌿";   // 약초
      case "gem":   return "💎";   // 보석광
      case "mana":  return "🔮";   // 마석
      case "gold":  return "💰";   // 골드
      default:      return "❓";
    }
  }

  // GDD §4-2: 공성 타이머 시각화 (구조물 헥스 위 카운트다운 링 + 시간)
  function drawSiegeTimers() {
    const state = getState();
    if (!state?.siegeState) return;
    const structRows = tables.structures.all();
    for (const s of structRows) {
      const sp = state.siegeState[s.StructureID];
      if (!sp?.defenderTimers) continue;
      const now = Date.now();
      // 남은 시간 최소값 (가장 먼저 만료)
      let minRem = Infinity;
      for (const expireAt of Object.values(sp.defenderTimers)) {
        const rem = expireAt - now;
        if (rem > 0 && rem < minRem) minRem = rem;
      }
      if (!isFinite(minRem)) continue;

      const p = hexWorld(s.HexQ, s.HexR);
      const screen = camera.worldToScreen(p.x, p.y);
      const size = R * camera.scale;
      if (screen.x < -size || screen.x > canvas.clientWidth + size ||
          screen.y < -size || screen.y > canvas.clientHeight + size) continue;

      // 링 진행도 (가장 긴 타이머 기준으로 pct — 여기선 Patrol 3분 기준)
      const MAX_MS = 3 * 60 * 1000;
      const pct = Math.max(0, Math.min(1, minRem / MAX_MS));
      const urgent = minRem < 30000;
      const color = urgent ? "#f44" : minRem < 60000 ? "#fa4" : "#5a5";
      const ringR = size * 0.6;
      const cx = screen.x;
      const cy = screen.y - size * 0.1;

      // 배경 링
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = Math.max(3, size * 0.12);
      ctx.stroke();
      // 진행 링 (남은 pct만큼)
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, size * 0.12);
      ctx.lineCap = "round";
      ctx.stroke();

      // 시간 텍스트 m:ss
      const s_total = Math.ceil(minRem / 1000);
      const mm = Math.floor(s_total / 60);
      const ss = s_total % 60;
      const timeText = `${mm}:${String(ss).padStart(2, "0")}`;
      ctx.font = `bold ${Math.max(10, size * 0.35)}px 'Segoe UI'`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 외곽선
      ctx.strokeStyle = "#000";
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.strokeText(timeText, cx, cy);
      ctx.fillStyle = urgent ? "#ff8888" : "#fff";
      ctx.fillText(timeText, cx, cy);

      // 임박 시 흔들림 효과(텍스트만 한 번 더)
      if (urgent && Math.floor(now / 250) % 2 === 0) {
        ctx.fillStyle = "#ff4444";
        ctx.fillText("⚠", cx - size * 0.5, cy - size * 0.5);
      }
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

    // 점령 오버레이 (별도 패스 — 모든 타일 위에)
    drawOwnedOverlay();

    drawStructures();
    drawSiegeTimers();

    overlays?.draw(ctx, camera);

    stats.lastFrameMs = performance.now() - t0;
    stats.drawnHexes = drawn;
    return true;
  }

  return { draw, worldSize, stats, requestDraw: () => { needsDraw = true; } };
}
