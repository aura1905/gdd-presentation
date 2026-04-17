// Bootstrap: load tables, init state, run render loop + interaction.
import { CONFIG } from "./config.js";
import { loadAllTables, tr } from "./data/tables.js";
import { createCamera } from "./render/camera.js";
import { createWorldmapRenderer } from "./render/worldmap.js";
import { createOverlays } from "./render/overlays.js";
import { loadHexTiles } from "./render/hexTiles.js";
import * as __spriteHelpers from "./render/charSprites.js";
import { resolveSpriteFolder, preloadSprites } from "./render/charSprites.js";

// 모듈 레벨: 머리 박스 감지 캐시
const __headBoxCache = new Map();
const __scanCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
const __scanCtx = __scanCanvas?.getContext("2d", { willReadFrequently: true });
import { worldToHex, hexId, hexWorld, neighbors } from "./util/hex.js";
import { emit, on } from "./util/events.js";
import { initState, restoreState, getState, selectParty, deselectParty, getSelectedParty, moveParty, getCharacter, isStructureCaptured, captureStructure, abandonStructure, ownHex, abandonHex, isHexOwned, grantExp, recomputeStatsFromLevel, fullRestParty, getTerritoryMaxSlots, getTerritoryUsedSlots, canOccupyMore, pushUndo, performUndo, canUndo, lastUndoLabel } from "./state/gameState.js";
import { saveState, loadState, clearSave } from "./state/save.js";
import { findPath, pathCost } from "./engine/movement.js";
import { resolveCombat, findEnemyParties, findStructureDefenders, lookupDropReward } from "./engine/combat.js";
import { recomputeFog, applyScout, getFogState, bumpAction } from "./engine/fog.js";

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
  if (saved) {
    console.log("[save] 저장 복원:", saved.ownedHexes?.length || 0, "헥스,", saved.capturedStructures?.length || 0, "구조물");
  }
  const gameState = saved ? restoreState(saved, tables) : initState(tables);
  recomputeFog(gameState, tables);

  status("헥스 타일 로드 중…");
  await loadHexTiles();

  status("캐릭터 스프라이트 프리로드…");
  // 시작 캐릭터 sprite 미리 로드
  const charSprites = (getState()?.characters || []).map(c => c.spriteName).filter(Boolean);
  await preloadSprites(charSprites);

  status(`렌더 초기화 (${tables.worldHex.count()} 헥스)…`);
  const overlays = createOverlays();
  const camera = createCamera(canvas, 0, 0);
  const worldmap = createWorldmapRenderer(ctx, canvas, camera, tables, overlays);

  // Connect overlays animation to render loop
  overlays.setRequestDraw(() => worldmap.requestDraw());

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
        spriteName: leader?.spriteName || null,
        selected: gs.selectedPartyId === p.id,
      };
    }));
    worldmap.requestDraw();
  }
  function syncAll() {
    recomputeFog(getState(), tables);
    syncOverlays(); renderPartyList(); updateHud();
    saveState(getState());
    worldmap.requestDraw();
  }
  on("state:changed", syncAll);
  on("state:init", () => { syncOverlays(); renderPartyList(); updateHud(); });

  function updateHud() {
    const gs = getState();
    document.getElementById("res-grain").textContent = gs.resources.grain;
    document.getElementById("res-gold").textContent = gs.resources.gold;
    document.getElementById("res-vis").textContent = gs.resources.vis;
    document.getElementById("turn-num").textContent = gs.meta.turn;
    const territoryEl = document.getElementById("hud-territory");
    if (territoryEl) {
      const used = getTerritoryUsedSlots();
      const max = getTerritoryMaxSlots();
      territoryEl.innerHTML = `🏰 영지 <b>${used}</b><span class="hud-badge-sep">/</span><span class="hud-badge-max">${max}</span>`;
      territoryEl.classList.toggle("full", used >= max);
      territoryEl.classList.toggle("warn", used >= max * 0.8 && used < max);
    }
  }
  ensurePartySelected();
  syncOverlays();
  renderPartyList();
  updateHud();

  function renderPartyList() {
    const gs = getState();
    const container = document.getElementById("party-list");
    container.innerHTML = "";
    for (const party of gs.parties) {
      const members = party.slots.filter(id => id != null).map(id => getCharacter(id)).filter(Boolean);
      const leader = members[0];
      const avgFatiguePct = members.length
        ? Math.round(members.reduce((sum, m) => sum + (m.fatigue / m.maxFatigue * 100), 0) / members.length)
        : 100;
      const avgLv = members.length
        ? Math.round(members.reduce((s, m) => s + m.level, 0) / members.length)
        : 1;

      const card = document.createElement("div");
      card.className = "party-card" + (gs.selectedPartyId === party.id ? " selected" : "");
      const jobColor = { F: "#c86464", S: "#5aaa5a", M: "#c8a03c", W: "#5a82c8", L: "#a050b4" };
      const color = jobColor[leader?.jobClass] || "#888";
      // GDD: 100=최상, 감소형. 30 이하 위험.
      const fatigueColor = avgFatiguePct <= 30 ? "#e44" : avgFatiguePct <= 60 ? "#da2" : "#5a5";

      // 정확히 3슬롯 표시 (빈 슬롯도 회색 카드)
      const memberHtml = [0, 1, 2].map(slotIdx => {
        const m = members[slotIdx];
        if (!m) {
          return `<div class="pc-member" style="opacity:0.3"><div class="pcm-portrait"></div><div class="pcm-name">—</div></div>`;
        }
        const fatPct = Math.round(m.fatigue / m.maxFatigue * 100);
        const hpPct = Math.round(m.hp / m.maxHp * 100);
        const fatColor = fatPct <= 30 ? "#e44" : fatPct <= 60 ? "#da2" : "#5a5";
        const hpColor = hpPct <= 25 ? "#e44" : hpPct <= 50 ? "#da2" : "#5a5";

        const nextLvRow = tables.characterExp.get(m.level + 1);
        const cumNext = nextLvRow?.CumulativeEXP ?? null;
        const cumNow = tables.characterExp.get(m.level)?.CumulativeEXP ?? 0;
        const xp = m.xp || 0;
        let xpPct = 100;
        if (cumNext != null) {
          const need = cumNext - cumNow;
          const have = Math.max(0, xp - cumNow);
          xpPct = Math.min(100, Math.round(have / need * 100));
        }

        const isKO = m.hp <= 0;
        const statusClass = isKO ? "ko" : (m.status === "exhausted" ? "exhausted" : (m.status === "tired" ? "tired" : ""));
        // KO: X자 마크만 오버레이 / 탈진: 좌하단 작은 배지 / 피로: 테두리 글로우만
        let statusOverlay = "";
        if (isKO) statusOverlay = `<div class="pcm-ko-mark"></div>`;
        else if (m.status === "exhausted") statusOverlay = `<div class="pcm-status-badge">탈진</div>`;

        const portraitId = `pcm-face-${party.id}-${slotIdx}`;
        const jobLetter = m.jobClass || "?";
        const jobBg = jobColor[jobLetter] || "#888";
        const jobNameMap = { F: "파이터", S: "스카우트", M: "머스킷티어", W: "위자드", L: "워록" };
        const jobFullName = jobNameMap[jobLetter] || "?";
        const isLeader = slotIdx === 0;
        const leaderCrown = isLeader ? `<div class="pcm-leader-crown" title="리더">👑</div>` : "";
        return `
          <div class="pc-member ${statusClass} ${isLeader ? "is-leader" : ""}" title="${m.name} Lv${m.level} ${jobFullName}${isLeader ? " · 리더" : ""} HP${m.hp}/${m.maxHp} 피로${fatPct}%">
            <div class="pcm-portrait">
              <canvas id="${portraitId}" width="48" height="48"></canvas>
              <div class="pcm-job-badge" style="background:${jobBg}" title="${jobFullName}">${jobLetter}</div>
              ${leaderCrown}
              ${statusOverlay}
            </div>
            <div class="pcm-lv-badge">${m.level}</div>
            <div class="pcm-name">${m.name}</div>
            <div class="pcm-bars">
              <div class="pcm-bar" title="HP ${m.hp}/${m.maxHp}"><div class="pcm-bar-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
              <div class="pcm-bar" title="피로 ${fatPct}%"><div class="pcm-bar-fill" style="width:${fatPct}%;background:${fatColor}"></div></div>
              <div class="pcm-bar" title="EXP ${xpPct}%"><div class="pcm-bar-fill" style="width:${xpPct}%;background:#fa3"></div></div>
            </div>
          </div>`;
      }).join("");

      const leaderJobMap = { F: "파이터", S: "스카우트", M: "머스킷티어", W: "위자드", L: "워록" };
      const leaderJobName = leaderJobMap[leader?.jobClass] || "?";
      card.innerHTML = `
        <div class="pc-header">
          <div class="pc-icon" style="background:${color}" title="리더 병종: ${leaderJobName}">${leader?.jobClass || "?"}</div>
          <div class="pc-name">${party.name}</div>
          <div class="pc-leader-job" style="color:${color}">${leaderJobName}</div>
        </div>
        <div class="pc-members">${memberHtml}</div>`;

      // 캔버스에 얼굴 부분만 그리기 (스프라이트 첫 프레임의 상단)
      [0, 1, 2].forEach(slotIdx => {
        const m = members[slotIdx];
        if (!m) return;
        const cv = card.querySelector(`#pcm-face-${party.id}-${slotIdx}`);
        if (!cv) return;
        drawFacePortrait(cv, m.spriteName, m.hp <= 0);
      });

      card.addEventListener("click", () => {
        selectParty(party.id);
        overlays.setSelected(party.location.q, party.location.r);
        const hexRow = tables.worldHex.get(hexId(party.location.q, party.location.r));
        const ps = camera.worldToScreen(hexWorld(party.location.q, party.location.r).x, hexWorld(party.location.q, party.location.r).y);
        if (hexRow) showTilePanel(hexRow, null, tables, ps.x, ps.y + 40);
        const p = hexWorld(party.location.q, party.location.r);
        camera.centerOn(p.x, p.y);
        worldmap.requestDraw();
      });

      container.appendChild(card);
    }
  }

  // --- Interaction: 삼전식 (타일 클릭 → 액션 버튼) ---
  let selectedHexRow = null;

  camera.onClick((sx, sy) => {
    const world = camera.screenToWorld(sx, sy);
    const { q, r } = worldToHex(world.x, world.y);
    const id = hexId(q, r);
    const row = tables.worldHex.get(id);

    if (!row) {
      cancelInteraction();
      return;
    }

    // 같은 헥스 재클릭: 파티 있으면 순환 선택
    const gs = getState();
    const partiesHere = gs.parties.filter(p => p.location.q === q && p.location.r === r);
    if (partiesHere.length > 0 && selectedHexRow?.HexID === row.HexID) {
      const curIdx = partiesHere.findIndex(p => p.id === gs.selectedPartyId);
      const next = partiesHere[(curIdx + 1) % partiesHere.length];
      selectParty(next.id);
    } else if (partiesHere.length > 0 && !gs.selectedPartyId) {
      selectParty(partiesHere[0].id);
    }

    selectedHexRow = row;
    overlays.setSelected(q, r);
    overlays.clearPathPreview();

    // 경로 프리뷰 (파티 선택 + 다른 헥스)
    const party = getSelectedParty();
    let path = null;
    if (party && (party.location.q !== q || party.location.r !== r)) {
      path = findPath(party.location.q, party.location.r, q, r, tables);
      if (path && path.length > 1) overlays.setPathPreview(path);
    }

    // 팝업 위치: 클릭한 헥스 바로 아래
    const hexScreen = camera.worldToScreen(hexWorld(q, r).x, hexWorld(q, r).y);
    const popupX = hexScreen.x;
    const popupY = hexScreen.y + (CONFIG.hex.W / 2) * camera.scale + 8;
    showTilePanel(row, path, tables, popupX, popupY);
    worldmap.requestDraw();

    if (CONFIG.debug.logHexClick) {
      console.log("[hex]", { HexID: row.HexID, HexQ: row.HexQ, HexR: row.HexR,
        TerrainID: row.TerrainID, RegionID: row.RegionID, HexLevel: row.HexLevel });
    }
  });

  // 통합 타일 패널 (삼전식: 타일 바로 아래 팝업)
  function showTilePanel(row, path, tables, screenX, screenY) {
    const panel = document.getElementById("hex-panel");
    const terrain = tables.terrains.get(row.TerrainID);
    const region = tables.regions.get(row.RegionID);
    const structure = row.StructureID ? tables.structures.get(row.StructureID) : null;
    const party = getSelectedParty();
    const isHidden = false;  // 안개 비활성
    let enemies = findEnemyParties(row, tables);
    const isCaptured = structure ? isStructureCaptured(structure.StructureID) : false;
    if (structure && !isCaptured) {
      const defenders = findStructureDefenders(structure.StructureID, tables);
      if (defenders.length > 0) enemies = defenders;
    }
    const hasEnemies = enemies.length > 0;
    const hexOwned = isHexOwned(row.HexID);
    const isPassable = terrain?.Movable !== false;

    // Title
    document.getElementById("hex-title").textContent =
      region ? tr(tables, region.NameKey, `R${region.RegionID}`) : `#${row.HexID}`;

    // Info — hidden이면 지형만 노출, 자원/구조물/적 정보 숨김
    const info = [`지형: ${terrain?.Code || "?"}`];
    if (!isHidden) {
      if (row.HexLevel > 0) info[0] += ` Lv${row.HexLevel}`;
      if (hexOwned) info.push(`<span style="color:#5a5">점령됨</span>`);
      if (row.ResourceCode) info.push(`자원: ${row.ResourceCode}`);
      if (structure) info.push(`${structure.StructureType}${isCaptured ? " (점령됨)" : ""}`);
      if (hasEnemies) info.push(`적 ${enemies.length}${enemies[0]?.__isStructure ? "웨이브" : "파티"}`);
    } else {
      info.push(`<span style="color:#888">⚫ 안개 — 정보 미공개</span>`);
    }
    if (path) info.push(`경로: ${path.length - 1}칸 · 피로+${pathCost(path)}`);
    document.getElementById("hex-meta").innerHTML = info.join(" · ");

    // Action buttons
    const actions = document.getElementById("hex-actions");
    actions.innerHTML = "";

    // 이동
    if (party && path && path.length > 1) {
      const blocked = structure && !isCaptured;
      const btn = addAction(actions, `이동 (피로+${pathCost(path)})`, "#2c5aa6", () => {
        if (blocked) return;
        pushUndo(`이동 → #${row.HexID}`);
        animatedMove(party.id, path, () => {
          moveParty(party.id, row.HexQ, row.HexR, pathCost(path));
          cancelInteraction();
          saveState(getState());
        });
      });
      if (blocked) { btn.disabled = true; btn.title = "점령 필요"; }
    }

    // 탐색 (적 있는 헥스)
    if (hasEnemies) {
      addAction(actions, "탐색", "#2a7a5a", () => doScout(row));
    }

    // 점령 — 미점령 헥스 (적 있으면 전투 후 점령, 없으면 바로 점령)
    // 룰: ① 인접성 (아군 영토와 붙어야 함) ② 영지 슬롯 여유 (기본 15, 최대 81)
    // 구조물(관문/거점/도시) 헥스는 슬롯 카운트와 무관 (별도 영토)
    if (party && isPassable && !hexOwned) {
      const adjacent = isAdjacentToOwnedTerritory(row.HexQ, row.HexR);
      const isStructHex = !!structure;
      const slotsOk = isStructHex || canOccupyMore();
      const label = isStructHex ? `점령(${structure.StructureType})` : "점령";
      const btn = addAction(actions, label, "#8a6020", () => {
        if (!adjacent || !slotsOk) return;
        doCombatAction(row, path, "occupy");
      });
      if (!adjacent) {
        btn.disabled = true;
        btn.title = "아군 영토와 인접해야 점령 가능";
      } else if (!slotsOk) {
        btn.disabled = true;
        btn.title = `영지 슬롯 가득참 (${getTerritoryUsedSlots()}/${getTerritoryMaxSlots()})`;
      }
    }

    // 토벌 — 적 있는 헥스 (점령 안 하고 전투만, 보상 획득)
    if (party && hasEnemies) {
      addAction(actions, "토벌", "#a03030", () => {
        doCombatAction(row, path, "subjugate");
      });
    }

    // 귀환
    if (party) {
      const home = getState().family.homeHex;
      if (party.location.q !== home.q || party.location.r !== home.r) {
        addAction(actions, "귀환", "#555", () => doReturn());
      }
    }

    // 휴식 (아군 점령 헥스 + 파티 현재 위치 = 그 헥스)
    if (party && hexOwned && party.location.q === row.HexQ && party.location.r === row.HexR) {
      addAction(actions, "휴식", "#3a5a7a", () => {
        fullRestParty(party.id);
        const ps = camera.worldToScreen(hexWorld(row.HexQ, row.HexR).x, hexWorld(row.HexQ, row.HexR).y);
        showTilePanel(row, null, tables, ps.x, ps.y + 40);
      });
    }

    // 포기 — 점령된 헥스 또는 점령된 구조물 (홈 도시만 보호)
    const home = getState().family.homeHex;
    const isHome = (row.HexQ === home.q && row.HexR === home.r);
    const isHomeCity = structure && structure.HexQ === home.q && structure.HexR === home.r;
    const isStructAbandonable = structure && isCaptured && !isHomeCity;
    const isHexAbandonable = hexOwned && !structure && !isHome;

    if (isStructAbandonable || isHexAbandonable) {
      const partyHere = getState().parties.find(p => p.location.q === row.HexQ && p.location.r === row.HexR);
      const targetLabel = isStructAbandonable
        ? `${structure.StructureType} #${structure.StructureID}`
        : `헥스 #${row.HexID}`;
      const btn = addAction(actions, "포기", "#6a3030", () => {
        if (partyHere) return;
        showConfirm({
          title: `🏳️ 포기`,
          body: `<b style="color:#ffd452">${targetLabel}</b>를 포기합니다.${isStructAbandonable ? "\n구조물이 적 소유로 돌아가고 통과 불가가 됩니다." : "\n슬롯 1개가 회수됩니다."}`,
          confirmLabel: "포기",
          danger: true,
          onConfirm: () => {
            pushUndo(`포기 ${targetLabel}`);
            if (isStructAbandonable) {
              abandonStructure(structure.StructureID);
              // 구조물의 모든 헥스도 영지에서 제외
              for (const hx of tables.worldHex.all()) {
                if (hx.StructureID === structure.StructureID) abandonHex(hx.HexID);
              }
            } else {
              abandonHex(row.HexID);
            }
            document.getElementById("hex-panel").hidden = true;
            worldmap.requestDraw();
          },
        });
      });
      if (partyHere) {
        btn.disabled = true;
        btn.title = "파티가 주둔 중인 헥스는 포기 불가";
      }
    }

    // 파티 미선택 안내
    if (!party && (hasEnemies || path)) {
      const hint = document.createElement("span");
      hint.textContent = "← 파티를 선택하세요";
      hint.style.cssText = "color:#888;font-size:11px;padding:6px";
      actions.appendChild(hint);
    }

    panel.hidden = false;

    // Position popup near the hex (clamped to viewport)
    if (screenX != null && screenY != null) {
      const pw = panel.offsetWidth || 200;
      const ph = panel.offsetHeight || 100;
      let left = screenX - pw / 2;
      let top = screenY;
      // Clamp to viewport
      left = Math.max(4, Math.min(left, window.innerWidth - pw - 4));
      top = Math.max(4, Math.min(top, window.innerHeight - ph - 60));
      // If would go below bottom, show above hex instead
      if (top + ph > window.innerHeight - 60) {
        top = screenY - ph - (CONFIG.hex.W / 2) * camera.scale * 2 - 8;
      }
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.bottom = "auto";
      panel.style.right = "auto";
    }
  }

  // 인접성 검사 — 6방향 이웃 중 하나라도 아군 점령이면 OK
  function isAdjacentToOwnedTerritory(q, r) {
    for (const n of neighbors(q, r)) {
      if (isHexOwned(hexId(n.q, n.r))) return true;
    }
    return false;
  }

  function addAction(container, label, bg, onclick) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.background = bg;
    btn.onclick = onclick;
    container.appendChild(btn);
    return btn;
  }

  function cancelInteraction() {
    selectedHexRow = null;
    overlays.clearPathPreview();
    overlays.clearSelected();
    document.getElementById("hex-panel").hidden = true;
    // 파티 선택은 유지 — 1개는 항상 선택된 상태로
    ensurePartySelected();
    worldmap.requestDraw();
  }

  // 파티 1개는 항상 선택 상태 유지 (번거로움 방지)
  function ensurePartySelected() {
    const gs = getState();
    if (!gs?.parties?.length) return;
    if (gs.selectedPartyId && gs.parties.find(p => p.id === gs.selectedPartyId)) return;
    selectParty(gs.parties[0].id);
  }

  // --- UI Panels ---
  function showHexPanel(row, tables, msg) {
    showTilePanel(row, null, tables);
    if (msg) {
      const meta = document.getElementById("hex-meta");
      meta.innerHTML += ` · <span style="color:#f44">${msg}</span>`;
    }
  }

  // --- M3 Actions ---

  function doScout(hexRow) {
    let enemies = findEnemyParties(hexRow, tables);
    const struct = hexRow.StructureID ? tables.structures.get(hexRow.StructureID) : null;
    if (struct && !isStructureCaptured(struct.StructureID)) {
      const defenders = findStructureDefenders(struct.StructureID, tables);
      if (defenders.length > 0) enemies = defenders;
    }
    if (enemies.length === 0) {
      showHexPanel(hexRow, tables, "적 파티 없음");
      return;
    }
    // 안개 시스템에 scouted 마킹 (5액션 유지)
    const preview = {
      partyCount: enemies.length,
      level: enemies[0]?.EnemyLevel || 1,
    };
    bumpAction(getState());
    applyScout(getState(), hexRow.HexID, 5, preview);
    saveState(getState());
    worldmap.requestDraw();

    const meta = document.getElementById("hex-meta");
    const isStruct = enemies[0].__isStructure;
    const parts = [`<b>${isStruct ? `${enemies[0].__structureType} 수비 ${enemies.length}웨이브` : `적 파티 ${enemies.length}개`}</b>`];
    for (const ep of enemies) {
      const slots = [ep.Slot1, ep.Slot2, ep.Slot3].filter(Boolean);
      const prefix = ep.__layerName ? `[${ep.__layerName}]` : `W${ep.PartyIndex}`;
      parts.push(`${prefix} Lv${ep.EnemyLevel} [${slots.length}명]`);
    }
    parts.push(`<span style="color:#9c9;font-size:10px">5액션간 정보 유지</span>`);
    meta.innerHTML = parts.join("<br>");
  }

  // mode: "occupy" (점령) or "subjugate" (토벌)
  function doCombatAction(hexRow, path, mode) {
    const party = getSelectedParty();
    if (!party) return;

    pushUndo(mode === "occupy" ? `점령 #${hexRow.HexID}` : `토벌 #${hexRow.HexID}`);

    document.getElementById("hex-panel").hidden = true;
    const moveCost = path ? pathCost(path) : 0;

    // 경로 있으면 애니메이션 이동 후 전투, 없으면 즉시 전투
    if (path && path.length > 1) {
      animatedMove(party.id, path, () => {
        moveParty(party.id, hexRow.HexQ, hexRow.HexR, moveCost);
        executeCombat(party, hexRow, mode);
      });
      return;
    }
    moveParty(party.id, hexRow.HexQ, hexRow.HexR, moveCost);
    executeCombat(party, hexRow, mode);
  }

  function executeCombat(party, hexRow, mode) {

    // 적 파티 결정 — 구조물 미점령이면 수비대(StructureDefenseTable), 아니면 일반 필드 적
    let enemies = findEnemyParties(hexRow, tables);
    const structureForCombat = hexRow.StructureID ? tables.structures.get(hexRow.StructureID) : null;
    if (structureForCombat && !isStructureCaptured(structureForCombat.StructureID)) {
      const defenders = findStructureDefenders(structureForCombat.StructureID, tables);
      if (defenders.length > 0) enemies = defenders;
    }

    if (enemies.length === 0) {
      // 적 없음 — 점령 모드면 바로 점령
      if (mode === "occupy") {
        ownHex(hexRow.HexID);
        if (structureForCombat) captureStructure(structureForCombat.StructureID);
        const ps = camera.worldToScreen(hexWorld(hexRow.HexQ, hexRow.HexR).x, hexWorld(hexRow.HexQ, hexRow.HexR).y);
        showBattleResult(hexRow, null, 0, 0, mode, ps);
      }
      saveState(getState());
      worldmap.requestDraw();
      return;
    }

    // 3. 전투 (웨이브 순차)
    const playerChars = party.slots
      .filter(id => id != null)
      .map(id => getCharacter(id))
      .filter(Boolean);
    const terrain = tables.terrains.get(hexRow.TerrainID);
    let totalWins = 0;
    let lastResult = null;

    for (const ep of enemies) {
      lastResult = resolveCombat(playerChars, ep, terrain, tables);
      for (const pa of lastResult.playerAfter) {
        const ch = getCharacter(pa.id);
        if (ch) ch.hp = pa.hp;
      }
      if (lastResult.win) {
        totalWins++;
      } else {
        break;
      }
    }

    // 전투 피로 소모 (GDD: 100=최상 → 감소). 전투당 5 차감.
    for (const ch of playerChars) {
      ch.fatigue = Math.max(0, ch.fatigue - 5);
    }

    // 4. 결과 처리
    const allWon = totalWins === enemies.length;

    if (allWon && mode === "occupy") {
      ownHex(hexRow.HexID);
      const structure = hexRow.StructureID ? tables.structures.get(hexRow.StructureID) : null;
      if (structure && !isStructureCaptured(structure.StructureID)) {
        captureStructure(structure.StructureID);
      }
      // 파티는 점령 헥스에 유지
    } else if (!allWon) {
      // 패배 → 자동 귀환 + 거점 도착 즉시 전체 회복 (HP/피로)
      const home = getState().family.homeHex;
      moveParty(party.id, home.q, home.r, 0);
      fullRestParty(party.id);
    }
    // 토벌 승리: 파티는 해당 헥스에 유지 (점령 안 함)

    const ps = camera.worldToScreen(hexWorld(hexRow.HexQ, hexRow.HexR).x, hexWorld(hexRow.HexQ, hexRow.HexR).y);

    // 전투 연출 (월드맵 위 직접 렌더) → 결과 팝업
    const enemyParty1 = enemies[Math.min(totalWins, enemies.length - 1)];
    const enemySlots = [enemyParty1.Slot1, enemyParty1.Slot2, enemyParty1.Slot3]
      .filter(Boolean)
      .map(id => {
        const tmpl = tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy");
        let sprite = tmpl?.PrefabPath ? tmpl.PrefabPath.split("/")[1] : null;
        // 매핑 실패 시 ID 해시로 mon_* 풀에서 임의 선택 (결정론적, 같은 ID는 항상 같은 몬스터)
        if (!sprite || !sprite.startsWith("mon_")) sprite = pickMonsterSprite(id);
        return { spriteName: sprite, name: tmpl?.Name || `E${id}` };
      });
    const sceneChars = playerChars.map(c => ({ spriteName: c.spriteName, name: c.name }));

    overlays.startBattleScene(hexRow.HexQ, hexRow.HexR, sceneChars, enemySlots, allWon, () => {
      showBattleResult(hexRow, lastResult, totalWins, enemies.length, mode, ps);
      saveState(getState());
      worldmap.requestDraw();
    });
    worldmap.requestDraw();
  }

  function showBattleResult(hexRow, result, wavesWon, totalWaves, mode, screenPos) {
    const panel = document.getElementById("hex-panel");
    const title = document.getElementById("hex-title");
    const meta = document.getElementById("hex-meta");
    const actions = document.getElementById("hex-actions");

    const parts = [];

    if (!result) {
      // 전투 없이 점령 (적 없는 타일)
      title.textContent = "점령 완료!";
      title.style.color = "#5a5";
      parts.push("적 없음 — 바로 점령됨");
    } else {
      const won = result.win;
      const modeLabel = mode === "occupy" ? "점령" : "토벌";
      title.textContent = won ? `${modeLabel} 성공!` : `${modeLabel} 실패`;
      title.style.color = won ? "#5a5" : "#e44";

      parts.push(`${result.rounds}라운드 · 웨이브 ${wavesWon}/${totalWaves}`);
      parts.push(`<b>아군:</b> ${result.playerAfter.map(u => `${u.name} HP ${u.hp}/${u.maxHp}`).join(" · ")}`);
      parts.push(`<b>적군:</b> ${result.enemyAfter.map(u => `${u.name} HP ${u.hp}/${u.maxHp}`).join(" · ")}`);

      // 보상 — 승리 시 자원 지급 (DropTable)
      if (won && result.rewards) {
        const r = result.rewards;
        const gs = getState();
        gs.resources.gold += r.gold || 0;
        gs.resources.grain += r.grain || 0;
        gs.resources.vis += r.vis || 0;
        gs.family.xp += r.familyExp || 0;
        const rewardLine = [];
        if (r.gold) rewardLine.push(`골드 +${r.gold}`);
        if (r.grain) rewardLine.push(`곡물 +${r.grain}`);
        if (r.vis) rewardLine.push(`비스 +${r.vis}`);
        if (r.familyExp) rewardLine.push(`가문EXP +${r.familyExp}`);
        if (rewardLine.length) parts.push(`<b style="color:#ffd452">보상:</b> ${rewardLine.join(", ")}`);
      }

      // 캐릭터 EXP — gdd: 모든 전투에서 참가 3인 직접 부여 (승패 무관 100%)
      const partyForExp = getSelectedParty();
      const dropForExp = lookupDropReward(mode === "occupy" ? "occupy" : "subjugate", tables, hexRow.HexLevel || 1);
      if (dropForExp.charExp) {
        const actualExp = dropForExp.charExp;
        const expLines = [];
        if (partyForExp) {
          for (const cid of partyForExp.slots) {
            if (cid == null) continue;
            const expResult = grantExp(cid, actualExp, tables.characterExp);
            if (expResult) {
              recomputeStatsFromLevel(cid, tables.fieldObjects);
              const ch = getCharacter(cid);
              if (expResult.after > expResult.before) {
                expLines.push(`<span style="color:#ffd452">★${ch.name} Lv${expResult.before}→${expResult.after}!</span>`);
                showToast(`★ ${ch.name}  Lv${expResult.before} → <b>Lv${expResult.after}</b>!`, "levelup");
              } else {
                expLines.push(`${ch.name} +${actualExp}`);
              }
            }
          }
        }
        parts.push(`<b style="color:#9d9">캐릭터EXP:</b> ${expLines.join(" · ")}`);
        showToast(`+${actualExp} EXP × ${partyForExp?.slots.filter(Boolean).length || 0}명`, "exp");
      }

      if (!won) {
        parts.push(`<span style="color:#e44">패배 → 거점으로 자동 귀환</span>`);
      } else if (mode === "occupy") {
        parts.push(`<span style="color:#5a5">영토 점령 완료</span>`);
      }

      // 라운드 로그 (접기/펼치기)
      if (result.log && result.log.length > 0) {
        const logHtml = formatBattleLog(result.log, result.record);
        parts.push(`<details style="margin-top:6px"><summary style="cursor:pointer;color:#aaa;font-size:10px">전투 로그 (${result.log.length}건)</summary><div style="font-size:10px;max-height:180px;overflow-y:auto;color:#bbb;margin-top:4px">${logHtml}</div></details>`);
      }
    }

    setTimeout(() => { title.style.color = ""; }, 3000);
    meta.innerHTML = parts.join("<br>");
    actions.innerHTML = "";
    const btnOk = document.createElement("button");
    btnOk.textContent = "확인";
    btnOk.style.background = "#2c5aa6";
    btnOk.onclick = () => cancelInteraction();
    actions.appendChild(btnOk);
    panel.hidden = false;

    // Position popup
    if (screenPos) {
      const pw = panel.offsetWidth || 200;
      let left = screenPos.x - pw / 2;
      let top = screenPos.y + 20;
      left = Math.max(4, Math.min(left, window.innerWidth - pw - 4));
      top = Math.max(4, Math.min(top, window.innerHeight - (panel.offsetHeight || 100) - 60));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.bottom = "auto";
      panel.style.right = "auto";
    }
  }

  function detectHeadBox(img, frame) {
    const key = `${img.src}|${frame.x},${frame.y},${frame.w},${frame.h}`;
    if (__headBoxCache.has(key)) return __headBoxCache.get(key);

    __scanCanvas.width = frame.w;
    __scanCanvas.height = frame.h;
    __scanCtx.clearRect(0, 0, frame.w, frame.h);
    try {
      __scanCtx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      const data = __scanCtx.getImageData(0, 0, frame.w, frame.h).data;
      // 1) 비투명 픽셀의 최상단 행 찾기 (머리 꼭대기)
      let topY = 0;
      outer1: for (let y = 0; y < frame.h; y++) {
        for (let x = 0; x < frame.w; x++) {
          if (data[(y * frame.w + x) * 4 + 3] > 16) { topY = y; break outer1; }
        }
      }
      // 2) 머리 영역: 캐릭터 전체 높이의 상단 ~38% (목/얼굴까지 충분히)
      const charHeight = frame.h - topY;
      const headHeight = Math.max(10, Math.floor(charHeight * 0.38));
      // 3) 머리 영역 좌우 비투명 범위 (head bbox)
      let minX = frame.w, maxX = 0;
      for (let y = topY; y < topY + headHeight; y++) {
        for (let x = 0; x < frame.w; x++) {
          if (data[(y * frame.w + x) * 4 + 3] > 16) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      if (minX > maxX) { minX = 0; maxX = frame.w - 1; }
      // 정사각형에 가깝게 만들기 위해 좁은 쪽에 더 패딩
      const headW = maxX - minX + 1;
      let padX = Math.floor(headW * 0.20);
      let padY = Math.floor(headHeight * 0.10);
      // 정사각형 보정: 가로/세로 비율을 ~1.0에 가깝게
      const ratio = (headW + padX * 2) / (headHeight + padY * 2);
      if (ratio < 0.85) padX += Math.floor((headHeight + padY * 2) * 0.85 - (headW + padX * 2)) / 2 | 0;
      else if (ratio > 1.15) padY += Math.floor((headW + padX * 2) / 1.15 - (headHeight + padY * 2)) / 2 | 0;
      const x0 = Math.max(0, minX - padX);
      const x1 = Math.min(frame.w, maxX + padX + 1);
      const y0 = Math.max(0, topY - padY);
      const y1 = Math.min(frame.h, topY + headHeight + padY);
      const box = { x: frame.x + x0, y: frame.y + y0, w: x1 - x0, h: y1 - y0 };
      __headBoxCache.set(key, box);
      return box;
    } catch (e) {
      // CORS 등 실패 시 폴백 (상단 30% 중앙 60%)
      const box = {
        x: frame.x + Math.floor(frame.w * 0.2),
        y: frame.y,
        w: Math.floor(frame.w * 0.6),
        h: Math.max(8, Math.floor(frame.h * 0.32)),
      };
      __headBoxCache.set(key, box);
      return box;
    }
  }

  // 캐릭터 머리/얼굴 부분만 캔버스에 크롭하여 그리기
  function drawFacePortrait(canvas, spriteName, isKO) {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const data = spriteName ? __spriteHelpers.getSpriteData(spriteName) : null;
    if (!data || !data.image.complete || data.frames.length === 0) {
      // 폴백 — 회색 배경 + ?
      ctx.fillStyle = "#333";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#888";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", canvas.width / 2, canvas.height / 2);
      // 한 번 더 그려보기 (이미지 로드 후 자동 갱신)
      data?.image.addEventListener("load", () => drawFacePortrait(canvas, spriteName, isKO), { once: true });
      return;
    }
    const f = data.frames[0];
    const head = detectHeadBox(data.image, f);
    const sx = head.x, sy = head.y, sw = head.w, sh = head.h;
    // fill — 박스를 꽉 채우고 살짝 확대 (긴 쪽 약간 잘림 허용)
    const scale = Math.max(canvas.width / sw, canvas.height / sh) * 1.05;
    const dw = sw * scale, dh = sh * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    ctx.drawImage(data.image, sx, sy, sw, sh, dx, dy, dw, dh);
    if (isKO) {
      ctx.fillStyle = "rgba(40,40,40,0.55)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // 몬스터 sprite 풀 — 적절한 매핑 없을 때 ID 해시로 선택 (같은 ID = 같은 몬스터)
  const MONSTER_SPRITES = [
    "mon_bat", "mon_white_wolf", "mon_wild_boar", "mon_spider", "mon_skeleton",
    "mon_smuggler", "mon_zombi", "mon_Centaur", "mon_Scorpion", "mon_HoneySpider",
    "mon_Dingo", "mon_Saber_Boar", "mon_pirate_soldier", "mon_Skeleton_Soldier",
    "mon_zealot", "mon_sneak", "mon_deer", "mon_jellyfish",
  ];
  function pickMonsterSprite(id) {
    const hash = Math.abs((id * 2654435761) | 0);
    return MONSTER_SPRITES[hash % MONSTER_SPRITES.length];
  }

  // 커스텀 confirm 모달 (browser confirm 대체)
  function showConfirm({ title, body, confirmLabel = "확인", cancelLabel = "취소", danger = false, onConfirm }) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button class="modal-btn" data-action="cancel">${cancelLabel}</button>
          <button class="modal-btn ${danger ? 'danger' : 'primary'}" data-action="confirm">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('[data-action="cancel"]').onclick = close;
    backdrop.querySelector('[data-action="confirm"]').onclick = () => { close(); onConfirm?.(); };
    backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  }

  function showToast(text, kind = "") {
    const area = document.getElementById("toast-area");
    if (!area) return;
    const div = document.createElement("div");
    div.className = "toast" + (kind ? " " + kind : "");
    div.innerHTML = text;
    area.appendChild(div);
    setTimeout(() => div.remove(), kind === "levelup" ? 4000 : 3000);
  }
  window.__toast = showToast;  // for debug

  function awardCombatExp(party, charExp, mode, won) {
    if (!party || !charExp) return;
    // GDD: 모든 전투에서 참가 3인 직접 부여 (승패 무관, DropTable 기준)
    // 패배 시 50% 감산 (학습/연마 가치)
    const actualExp = won ? charExp : Math.floor(charExp * 0.5);
    if (actualExp <= 0) return;

    for (const cid of party.slots) {
      if (cid == null) continue;
      const before = getCharacter(cid)?.level;
      const result = grantExp(cid, actualExp, tables.characterExp);
      if (!result) continue;
      recomputeStatsFromLevel(cid, tables.fieldObjects);
      const ch = getCharacter(cid);
      if (result.after > result.before) {
        showToast(`★ ${ch.name} Lv${result.before} → Lv${result.after}!`, "levelup");
      }
    }
    showToast(`+${actualExp} EXP × ${party.slots.filter(Boolean).length}명${won ? "" : " (패배 50%)"}`, "exp");
  }

  function formatBattleLog(actions, record) {
    if (!actions || !record) return "";
    const lines = [];
    let lastTurn = -1;
    for (const a of actions) {
      if (a.type === "TurnStart") {
        lines.push(`<div style="color:#ffd452;margin-top:2px">— Turn ${a.turn} —</div>`);
        lastTurn = a.turn;
      } else if (a.type === "Attack") {
        const actor = record.allUnits[a.actorIdx];
        const target = record.allUnits[a.targetIdx];
        const tags = [];
        if (a.miss) tags.push('<span style="color:#888">MISS</span>');
        if (a.crit) tags.push('<span style="color:#ff8">CRIT</span>');
        if (a.blocked) tags.push('<span style="color:#8af">BLK</span>');
        if (a.died) tags.push('<span style="color:#f55">KO</span>');
        const tagStr = tags.length ? " " + tags.join(" ") : "";
        const dmgStr = a.miss ? "회피" : `-${a.damage}`;
        const aColor = a.actorIdx < record.playerUnits.length ? "#5a5" : "#e44";
        const tColor = a.targetIdx < record.playerUnits.length ? "#5a5" : "#e44";
        lines.push(`<div><span style="color:${aColor}">${actor.name}</span> → <span style="color:${tColor}">${target.name}</span> ${dmgStr}${tagStr}</div>`);
      } else if (a.type === "Death") {
        const u = record.allUnits[a.actorIdx];
        lines.push(`<div style="color:#e44;font-style:italic">${u.name} 전사</div>`);
      }
    }
    return lines.join("");
  }

  function doReturn() {
    const party = getSelectedParty();
    if (!party) return;
    const home = getState().family.homeHex;
    const path = findPath(party.location.q, party.location.r, home.q, home.r, tables);
    if (!path) {
      const hexRow = tables.worldHex.get(hexId(party.location.q, party.location.r));
      if (hexRow) showHexPanel(hexRow, tables, "귀환 경로 없음");
      return;
    }
    const cost = pathCost(path);
    document.getElementById("hex-panel").hidden = true;
    animatedMove(party.id, path, () => {
      moveParty(party.id, home.q, home.r, cost);
      // 거점 도착 시 자동 풀 회복 (HP/피로/상태)
      fullRestParty(party.id);
      cancelInteraction();
      saveState(getState());
    });
  }

  // 파티 이동 애니메이션 (150ms per hex step)
  function animatedMove(partyId, path, onComplete) {
    overlays.clearPathPreview();
    overlays.animateParty(partyId, path, 150, onComplete);
  }

  // showPartyPanel / showMovePanel 삭제 — showTilePanel로 통합됨.

  // Zoom preset buttons
  document.getElementById("btn-zoom-strat").addEventListener("click", () =>
    camera.setScale(CONFIG.camera.stratScale));
  document.getElementById("btn-zoom-tile").addEventListener("click", () =>
    camera.setScale(CONFIG.camera.tileScale));

  // 실행 취소 버튼 + Ctrl+Z
  const btnUndo = document.getElementById("btn-undo");
  function refreshUndoBtn() {
    const can = canUndo();
    btnUndo.disabled = !can;
    btnUndo.title = can ? `실행 취소: ${lastUndoLabel()} (Ctrl+Z)` : "취소할 작업 없음";
  }
  btnUndo.addEventListener("click", () => {
    if (performUndo()) {
      showToast(`↶ 실행 취소`, "exp");
      saveState(getState());
      worldmap.requestDraw();
    }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      btnUndo.click();
    }
  });
  on("undo:changed", refreshUndoBtn);
  refreshUndoBtn();
  document.getElementById("btn-close-panel").addEventListener("click", () => cancelInteraction());

  // Animation loop
  function tick() { worldmap.draw(); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);

  status(`준비 완료 · ${tables.worldHex.count()} 헥스 · 파티 ${getState().parties.length}개`);
  setTimeout(() => document.getElementById("splash").classList.add("hide"), 400);

  if (CONFIG.debug.showStats) {
    window.__demo = { tables, camera, worldmap, overlays, getState, clearSave };
    console.log("[demo] debug: window.__demo (clearSave로 리셋 가능)");
  }
}

boot().catch((e) => { console.error(e); status(`오류: ${e.message}`); });
