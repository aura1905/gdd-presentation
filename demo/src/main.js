// Bootstrap: load tables, init state, run render loop + interaction.
import { CONFIG } from "./config.js";
import { loadAllTables, tr } from "./data/tables.js";
import { createCamera } from "./render/camera.js";
import { createWorldmapRenderer } from "./render/worldmap.js";
import { createOverlays } from "./render/overlays.js";
import { worldToHex, hexId, hexWorld } from "./util/hex.js";
import { emit, on } from "./util/events.js";
import { initState, restoreState, getState, selectParty, deselectParty, getSelectedParty, moveParty, getCharacter, isStructureCaptured } from "./state/gameState.js";
import { saveState, loadState } from "./state/save.js";
import { findPath, pathCost } from "./engine/movement.js";

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

  status("게임 상태 초기화…");
  const saved = loadState();
  const gameState = saved ? restoreState(saved, tables) : initState(tables);

  status(`렌더 초기화 (${tables.worldHex.count()} 헥스)…`);
  const overlays = createOverlays();
  const camera = createCamera(canvas, 0, 0);
  const worldmap = createWorldmapRenderer(ctx, canvas, camera, tables, overlays);

  // Center camera on Reboldoeux
  const home = hexWorld(gameState.family.homeHex.q, gameState.family.homeHex.r);
  camera.centerOn(home.x, home.y);
  camera.setScale(CONFIG.camera.tileScale);

  // --- Sync overlays with game state ---
  function syncOverlays() {
    const gs = getState();
    overlays.setParties(gs.parties.map(p => {
      const leader = p.slots[0] != null ? getCharacter(p.slots[0]) : null;
      return {
        id: p.id,
        q: p.location.q,
        r: p.location.r,
        name: p.name,
        jobClass: leader?.jobClass || "?",
        selected: gs.selectedPartyId === p.id,
      };
    }));
    worldmap.requestDraw();
  }
  on("state:changed", () => { syncOverlays(); renderPartyList(); });
  on("state:init", () => { syncOverlays(); renderPartyList(); });
  syncOverlays();
  renderPartyList();

  function renderPartyList() {
    const gs = getState();
    const container = document.getElementById("party-list");
    container.innerHTML = "";
    for (const party of gs.parties) {
      const members = party.slots.filter(id => id != null).map(id => getCharacter(id)).filter(Boolean);
      const leader = members[0];
      const avgFatiguePct = members.length
        ? Math.round(members.reduce((sum, m) => sum + (m.fatigue / m.maxFatigue * 100), 0) / members.length)
        : 0;

      const card = document.createElement("div");
      card.className = "party-card" + (gs.selectedPartyId === party.id ? " selected" : "");
      const jobColor = { F: "#c86464", S: "#5aaa5a", M: "#c8a03c", W: "#5a82c8", L: "#a050b4" };
      const color = jobColor[leader?.jobClass] || "#888";
      const fatigueColor = avgFatiguePct >= 80 ? "#e44" : avgFatiguePct >= 50 ? "#da2" : "#5a5";

      card.innerHTML = `
        <div class="pc-icon" style="background:${color}">${leader?.jobClass || "?"}</div>
        <div class="pc-info">
          <div class="pc-name">${party.name}</div>
          <div class="pc-detail">
            ${members.map(m => m.jobClass).join("·")}
            피로 ${avgFatiguePct}%
            <span class="pc-fatigue"><span class="pc-fatigue-fill" style="width:${avgFatiguePct}%;background:${fatigueColor}"></span></span>
          </div>
        </div>`;

      card.addEventListener("click", () => {
        selectParty(party.id);
        interactionMode = "partySelected";
        overlays.setSelected(party.location.q, party.location.r);
        showPartyPanel(party, tables);
        // Center camera on party
        const p = hexWorld(party.location.q, party.location.r);
        camera.centerOn(p.x, p.y);
        worldmap.requestDraw();
      });

      container.appendChild(card);
    }
  }

  // --- Interaction state machine ---
  let interactionMode = "browse";  // "browse" | "partySelected" | "pathPreview"
  let currentPath = null;

  camera.onClick((sx, sy) => {
    const world = camera.screenToWorld(sx, sy);
    const { q, r } = worldToHex(world.x, world.y);
    const id = hexId(q, r);
    const row = tables.worldHex.get(id);

    if (interactionMode === "pathPreview" && currentPath) {
      // Click on the last hex of path to confirm, or anywhere else to cancel
      const last = currentPath[currentPath.length - 1];
      if (q === last.q && r === last.r) {
        confirmMove();
        return;
      }
      // Click different hex: re-compute path from party to new target
      const party = getSelectedParty();
      if (party && row) {
        const path = findPath(party.location.q, party.location.r, q, r, tables);
        if (path && path.length > 1) {
          currentPath = path;
          overlays.setPathPreview(path);
          overlays.setSelected(q, r);
          showMovePanel(row, path, tables);
          worldmap.requestDraw();
          return;
        }
      }
      // Can't path here — cancel
      cancelMove();
      return;
    }

    if (!row) {
      cancelInteraction();
      return;
    }

    // Check if clicked on a party
    const gs = getState();
    const clickedParty = gs.parties.find(p => p.location.q === q && p.location.r === r);

    if (interactionMode === "browse") {
      // Multiple parties on same hex? Cycle through them.
      const partiesHere = gs.parties.filter(p => p.location.q === q && p.location.r === r);
      if (partiesHere.length > 0) {
        const currentIdx = partiesHere.findIndex(p => p.id === gs.selectedPartyId);
        const next = partiesHere[(currentIdx + 1) % partiesHere.length];
        selectParty(next.id);
        interactionMode = "partySelected";
        overlays.setSelected(q, r);
        showPartyPanel(next, tables);
      } else {
        overlays.setSelected(q, r);
        showHexPanel(row, tables);
      }
    } else if (interactionMode === "partySelected") {
      const party = getSelectedParty();
      // Re-click same hex: cycle parties or deselect
      const partiesHere = gs.parties.filter(p => p.location.q === q && p.location.r === r);
      if (partiesHere.length > 0 && partiesHere.some(p => p.id === party?.id)) {
        if (partiesHere.length > 1) {
          const idx = partiesHere.findIndex(p => p.id === party.id);
          const next = partiesHere[(idx + 1) % partiesHere.length];
          selectParty(next.id);
          showPartyPanel(next, tables);
          worldmap.requestDraw();
          return;
        }
        cancelInteraction();
        return;
      }
      // Try to find path from selected party to clicked hex
      if (party && row) {
        const path = findPath(party.location.q, party.location.r, q, r, tables);
        if (path && path.length > 1) {
          currentPath = path;
          overlays.setPathPreview(path);
          overlays.setSelected(q, r);
          interactionMode = "pathPreview";
          showMovePanel(row, path, tables);
        } else {
          overlays.setSelected(q, r);
          showHexPanel(row, tables, path === null ? "이동 불가" : null);
        }
      }
    }

    worldmap.requestDraw();

    if (CONFIG.debug.logHexClick) {
      console.log("[hex]", { HexID: row.HexID, HexQ: row.HexQ, HexR: row.HexR,
        TerrainID: row.TerrainID, RegionID: row.RegionID, HexLevel: row.HexLevel });
    }
  });

  function confirmMove() {
    const party = getSelectedParty();
    if (!party || !currentPath) return;
    const last = currentPath[currentPath.length - 1];
    const lastHexId = hexId(last.q, last.r);
    const lastHex = tables.worldHex.get(lastHexId);

    // 목적지에 미점령 구조물이 있으면 이동 차단 (점령/공격 먼저 필요)
    if (lastHex?.StructureID) {
      const struct = tables.structures.get(lastHex.StructureID);
      if (struct && !isStructureCaptured(struct.StructureID)) {
        showHexPanel(lastHex, tables, `${struct.StructureType === "Gate" ? "관문" : struct.StructureType} — 점령 필요`);
        return;
      }
    }

    const cost = pathCost(currentPath);
    moveParty(party.id, last.q, last.r, cost);
    cancelMove();
    saveState(getState());
  }

  function cancelMove() {
    currentPath = null;
    overlays.clearPathPreview();
    interactionMode = "partySelected";
    const party = getSelectedParty();
    if (party) {
      overlays.setSelected(party.location.q, party.location.r);
    }
    document.getElementById("hex-panel").hidden = true;
    worldmap.requestDraw();
  }

  function cancelInteraction() {
    currentPath = null;
    overlays.clearPathPreview();
    overlays.clearSelected();
    deselectParty();
    interactionMode = "browse";
    document.getElementById("hex-panel").hidden = true;
    worldmap.requestDraw();
  }

  // --- UI Panels ---
  function showHexPanel(row, tables, msg) {
    const panel = document.getElementById("hex-panel");
    const terrain = tables.terrains.get(row.TerrainID);
    const region = tables.regions.get(row.RegionID);
    const structure = row.StructureID ? tables.structures.get(row.StructureID) : null;
    document.getElementById("hex-title").textContent =
      region ? tr(tables, region.NameKey, `R${region.RegionID}`) : `#${row.HexID}`;
    const parts = [`지형: ${terrain?.Code || "?"} Lv${row.HexLevel || 0}`];
    if (row.ResourceCode) parts.push(`자원: ${row.ResourceCode}`);
    if (structure) parts.push(`구조물: ${structure.StructureType}`);
    if (msg) parts.push(`<span style="color:#f44">${msg}</span>`);
    document.getElementById("hex-meta").innerHTML = parts.join(" · ");
    // Disable action buttons in M1
    const actions = document.getElementById("hex-actions");
    actions.innerHTML = "";
    panel.hidden = false;
  }

  function showPartyPanel(party, tables) {
    const panel = document.getElementById("hex-panel");
    const members = party.slots
      .filter(id => id != null)
      .map(id => getCharacter(id))
      .filter(Boolean);
    document.getElementById("hex-title").textContent = `${party.name}`;
    const memberStr = members.map(m => {
      const pct = Math.round(m.fatigue / m.maxFatigue * 100);
      const display = m.maxFatigue > 100 ? `${m.fatigue}/${m.maxFatigue}` : `${pct}%`;
      return `${m.name}(${m.jobClass}) HP:${m.hp} 피로:${display}`;
    }).join("<br>");
    document.getElementById("hex-meta").innerHTML = `<div>${memberStr}</div><div style="color:#aaa;margin-top:4px">이동할 헥스를 클릭하세요</div>`;
    document.getElementById("hex-actions").innerHTML = "";
    panel.hidden = false;
  }

  function showMovePanel(row, path, tables) {
    const panel = document.getElementById("hex-panel");
    const terrain = tables.terrains.get(row.TerrainID);
    const cost = pathCost(path);
    document.getElementById("hex-title").textContent = `이동 확인`;
    document.getElementById("hex-meta").innerHTML =
      `목표: ${terrain?.Code || "?"} (${path.length - 1}칸) · 피로 비용: <b style="color:#ffd452">${cost}</b>`;

    const actions = document.getElementById("hex-actions");
    actions.innerHTML = "";
    const btnConfirm = document.createElement("button");
    btnConfirm.textContent = `이동 (피로+${cost})`;
    btnConfirm.onclick = () => confirmMove();
    actions.appendChild(btnConfirm);
    const btnCancel = document.createElement("button");
    btnCancel.textContent = "취소";
    btnCancel.style.background = "#555";
    btnCancel.onclick = () => cancelMove();
    actions.appendChild(btnCancel);
    panel.hidden = false;
  }

  // Zoom preset buttons
  document.getElementById("btn-zoom-strat").addEventListener("click", () =>
    camera.setScale(CONFIG.camera.stratScale));
  document.getElementById("btn-zoom-tile").addEventListener("click", () =>
    camera.setScale(CONFIG.camera.tileScale));
  document.getElementById("btn-close-panel").addEventListener("click", () => cancelInteraction());

  // Animation loop
  function tick() { worldmap.draw(); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);

  status(`준비 완료 · ${tables.worldHex.count()} 헥스 · 파티 ${getState().parties.length}개`);
  setTimeout(() => document.getElementById("splash").classList.add("hide"), 400);

  if (CONFIG.debug.showStats) {
    window.__demo = { tables, camera, worldmap, overlays, getState };
    console.log("[demo] debug: window.__demo");
  }
}

boot().catch((e) => { console.error(e); status(`오류: ${e.message}`); });
