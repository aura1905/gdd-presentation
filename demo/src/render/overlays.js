// Overlays: selected hex, party icons, movement path preview.
import { CONFIG } from "../config.js";
import { hexWorld } from "../util/hex.js";

const ISO_Y = 0.75;
const JOB_COLORS = { F: "#c86464", S: "#5aaa5a", M: "#c8a03c", W: "#5a82c8", L: "#a050b4" };

export function createOverlays() {
  const state = {
    selectedHex: null,
    parties: [],         // [{id, q, r, name, jobClass, selected}]
    pathPreview: null,   // [{q, r, cost}] or null
  };

  function hexVertsIso(cx, cy, size) {
    const v = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      v.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) * ISO_Y });
    }
    return v;
  }

  function strokeHex(ctx, cx, cy, size, color, lineWidth) {
    const v = hexVertsIso(cx, cy, size);
    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function draw(ctx, camera) {
    const R = CONFIG.hex.W / 2;
    const size = R * camera.scale;

    // Path preview (movable hexes highlighted)
    if (state.pathPreview) {
      for (const step of state.pathPreview) {
        const p = hexWorld(step.q, step.r);
        const s = camera.worldToScreen(p.x, p.y);
        strokeHex(ctx, s.x, s.y, size, "rgba(100,200,255,0.6)", Math.max(1, size * 0.06));
        // Cost label at small zoom
        if (size > 12 && step.cost > 0) {
          ctx.font = `${size * 0.35}px 'Segoe UI'`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(100,200,255,0.9)";
          ctx.fillText(String(step.cost), s.x, s.y - size * 0.35);
        }
      }
    }

    // Selected hex highlight
    if (state.selectedHex) {
      const { q, r } = state.selectedHex;
      const p = hexWorld(q, r);
      const s = camera.worldToScreen(p.x, p.y);
      strokeHex(ctx, s.x, s.y, size, "#ffd452", Math.max(1.5, 3 * camera.scale));
    }

    // Party icons — offset when multiple share same hex
    const hexGroups = new Map();
    for (const party of state.parties) {
      const key = `${party.q},${party.r}`;
      if (!hexGroups.has(key)) hexGroups.set(key, []);
      hexGroups.get(key).push(party);
    }
    for (const [, group] of hexGroups) {
      const p = hexWorld(group[0].q, group[0].r);
      const s = camera.worldToScreen(p.x, p.y);
      const count = group.length;
      for (let i = 0; i < count; i++) {
        const offsetX = count > 1 ? (i - (count - 1) / 2) * size * 0.7 : 0;
        drawPartyIcon(ctx, s.x + offsetX, s.y, size, group[i]);
      }
    }
  }

  function drawPartyIcon(ctx, cx, cy, hexSize, party) {
    const r = Math.max(6, hexSize * 0.38);
    const color = JOB_COLORS[party.jobClass] || "#888";
    const isSelected = party.selected;

    // Circle
    ctx.beginPath();
    ctx.arc(cx, cy - hexSize * 0.15, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = isSelected ? "#ffd452" : "#222";
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.stroke();

    // Job class letter
    if (r > 5) {
      ctx.font = `bold ${r * 1.1}px 'Segoe UI'`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(party.jobClass || "?", cx, cy - hexSize * 0.15);
    }

    // Party name label below
    if (hexSize > 14) {
      ctx.font = `${Math.max(8, hexSize * 0.28)}px 'Segoe UI'`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = isSelected ? "#ffd452" : "#ddd";
      ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
      ctx.fillText(party.name, cx, cy + hexSize * 0.2);
      ctx.shadowBlur = 0;
    }
  }

  function setSelected(q, r) { state.selectedHex = { q, r }; }
  function clearSelected() { state.selectedHex = null; }
  function setParties(parties) { state.parties = parties; }
  function setPathPreview(path) { state.pathPreview = path; }
  function clearPathPreview() { state.pathPreview = null; }

  return { draw, setSelected, clearSelected, setParties, setPathPreview, clearPathPreview, state };
}
