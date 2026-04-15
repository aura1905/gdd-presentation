// Overlays: currently just the selected hex highlight (ISO-correct).
import { CONFIG } from "../config.js";
import { hexWorld } from "../util/hex.js";

const ISO_Y = 0.75;

export function createOverlays() {
  const state = {
    selectedHex: null,   // { q, r }
  };

  function hexVertsIso(cx, cy, size) {
    const v = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      v.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) * ISO_Y });
    }
    return v;
  }

  function draw(ctx, camera) {
    if (!state.selectedHex) return;
    const { q, r } = state.selectedHex;
    const p = hexWorld(q, r);
    const screen = camera.worldToScreen(p.x, p.y);
    const size = (CONFIG.hex.W / 2) * camera.scale;
    const verts = hexVertsIso(screen.x, screen.y, size);
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 3 * camera.scale);
    ctx.strokeStyle = "#ffd452";
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function setSelected(q, r) { state.selectedHex = { q, r }; }
  function clearSelected() { state.selectedHex = null; }

  return { draw, setSelected, clearSelected, state };
}
