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
import { initState, restoreState, getState, selectParty, deselectParty, getSelectedParty, moveParty, getCharacter, isStructureCaptured, captureStructure, abandonStructure, ownHex, abandonHex, isHexOwned, grantExp, recomputeStatsFromLevel, recomputeAllCharacters, fullRestParty, restPartyWithGrain, getRestCost, getTerritoryMaxSlots, getTerritoryUsedSlots, canOccupyMore, pushUndo, performUndo, canUndo, lastUndoLabel, getTrainingLevel, getNextTrainingRow, canAffordTraining, investTraining, levelUpFamilyIfReady, assignPartySlot, getRosterWithStatus, createParty, deleteParty, getMaxParties, getBarracksExpandCost, canExpandBarracks, expandBarracks, autoAssignParty, togglePartyAutoReturn, getGrowthLevel, getNextGrowthRow, canAffordGrowth, investGrowth, addMail, getUnreadMailCount, markMailRead, deleteMail, markAllMailRead, purgeExpiredMail, getPartyHome, setPartyHome, getFortMaxParties, getFortDeployedParties, getStructureLv, getStructureUpgradeCost, getStructureUpgradeAxes, canUpgradeStructure, upgradeStructure, stationedLvToCap, STRUCTURE_UPGRADE_MAX_LV } from "./state/gameState.js";
import { saveState, loadState, clearSave } from "./state/save.js";
import { findPath, pathCost } from "./engine/movement.js";
import { resolveCombat, findEnemyParties, findStructureDefenders, lookupDropReward, getStructureMaxHP, getPartySiegeDamage } from "./engine/combat.js";
import { getSiegeProgress, getStructureCurrentHP, markDefenderDefeated, isDefenderDefeated, applyStructureDamage, getDefenderTimerRemaining, cleanupExpiredTimers } from "./state/gameState.js";
import { recomputeFog, applyScout, getFogState, bumpAction } from "./engine/fog.js";
import { endTurn, computeHexIncome } from "./engine/turn.js";
import { initQuests, ensureQuestsState, getActiveQuests, getClaimableQuests, reportProgress, claimQuestReward } from "./engine/quests.js";
import { addCharacterToRoster, addCharacterShard, spendResource, seedInitialEncounters, getEncounterAt, removeEncounter } from "./state/gameState.js";
import { rollOnce, getDupeShardCount, getGachaCost, GRADE_COLOR, GRADE_KR } from "./engine/gacha.js";

const status = (msg) => {
  const el = document.getElementById("loading-status");
  if (el) el.textContent = msg;
};

// 자원 코드 → 표시명/HUD 점 색상 매핑 (M4-A: 턴 정산 표시용)
const RES_LABEL = {
  grain: "곡물", iron: "철", wood: "목재", stone: "석재", herbs: "약초",
  gold: "금화", vis: "비스", gem: "보석", scroll: "주문서", rp: "연구",
  mana: "마나",
};
const RES_DOT_CLASS = {
  grain: "grain", gold: "gold", vis: "vis",
  iron: "iron", wood: "wood", stone: "stone", herbs: "herbs",
  gem: "gem", scroll: "scroll", rp: "rp", mana: "mana",
};
// 자원 아이콘 emoji — 필드(worldmap.js resourceIcon) 와 동일.
// vis/scroll/rp는 필드에 없는 보조 자원이라 적합한 emoji 별도 선택.
const RES_EMOJI = {
  grain: "🌾", iron: "⛏️", wood: "🌲", stone: "🪨", herbs: "🌿",
  gold: "💰", gem: "💎", mana: "🔮",
  vis: "✨", scroll: "📜", rp: "📘",
};
const resEmoji = (code) => RES_EMOJI[code] || "❓";

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
  // 미션 상태 초기화 (옛 세이브엔 quests 없을 수 있음)
  if (saved) ensureQuestsState(gameState, tables);
  else initQuests(gameState, tables);
  // 신규/복원 직후 가문 레벨 진행 quest 즉시 평가 (이미 도달한 마일스톤 처리)
  reportProgress(gameState, tables, "family_level", gameState.family.level || 1);
  // M5-B: 부팅 시 모든 캐릭터에 훈련 보정 반영 (옛 세이브 호환)
  recomputeAllCharacters(tables);
  recomputeFog(gameState, tables);
  // 필드 조우형 적 초기 시드 (신규 세이브만)
  seedInitialEncounters();

  // GDD §9-3: 리더 사망한 파티는 전장 잔류 불가 — 복원 시 자동 퇴각(구 세이브 호환)
  {
    const home = gameState.family.homeHex;
    for (const p of gameState.parties) {
      const leaderId = p.slots?.[0];
      if (leaderId == null) continue;
      const leader = gameState.characters.find(c => c.id === leaderId);
      if (leader && leader.hp <= 0) {
        p.location = { q: home.q, r: home.r };
        for (const cid of p.slots) {
          if (cid == null) continue;
          const ch = gameState.characters.find(c => c.id === cid);
          if (ch) { ch.hp = ch.maxHp; ch.fatigue = ch.maxFatigue; ch.status = "normal"; }
        }
        console.log(`[safety] ${p.name} 리더 사망 상태로 복원됨 → 거점 자동 귀환 + 회복`);
      }
    }
  }

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

  // 쉼터 헥스 판정 — 가문 홈 또는 점령된 City/Fort
  function isShelterHexClient(q, r) {
    const gs = getState();
    const home = gs.family?.homeHex;
    if (home && q === home.q && r === home.r) return true;
    const hex = tables.worldHex.get(q * 100 + r);
    if (!hex?.StructureID) return false;
    const struct = tables.structures.get(hex.StructureID);
    if (struct?.StructureType !== "Fort" && struct?.StructureType !== "City") return false;
    return gs.capturedStructures?.has(hex.StructureID);
  }

  // --- Sync overlays with game state ---
  function syncOverlays() {
    const gs = getState();
    const home = gs.family?.homeHex;
    // 쉼터 위치 파티는 맵 아이콘 숨김 (거점 목록 패널에서 따로 표시)
    const visibleParties = gs.parties.filter(p => !isShelterHexClient(p.location.q, p.location.r));
    overlays.setParties(visibleParties.map(p => {
      const leader = p.slots[0] != null ? getCharacter(p.slots[0]) : null;
      // 파티 최하 피로원 기준 (삼전식)
      const members = p.slots.filter(id => id != null).map(id => getCharacter(id)).filter(Boolean);
      const minFat = members.length ? Math.min(...members.map(m => m.fatigue / m.maxFatigue)) : 1;
      // 상태 판정
      const isHome = home && p.location.q === home.q && p.location.r === home.r;
      let statusLabel = isHome ? "대기" : "주둔";
      if (p.state === "moving") statusLabel = "행군";
      else if (p.state === "fighting") statusLabel = "전투";
      return {
        id: p.id,
        q: p.location.q,
        r: p.location.r,
        name: p.name,
        jobClass: leader?.jobClass || "?",
        spriteName: leader?.spriteName || null,
        selected: gs.selectedPartyId === p.id,
        fatiguePct: Math.round(minFat * 100),
        statusLabel,
      };
    }));
    // 필드 조우형 적 전달
    const encList = (gs.encounters || []).map(e => {
      const tpl = tables.encounters.get(e.templateId);
      return {
        id: e.id,
        q: e.q, r: e.r,
        icon: tpl?.Icon || "⚔",
        name: tpl?.Name || "?",
        type: tpl?.EncounterType || "wild",
        level: tpl?.MinLevel || 1,
        discovered: e.discovered,
      };
    });
    overlays.setEncounters(encList);
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
    // 10종 자원 모두 갱신 (HUD에 전체 노출)
    const HUD_RES = ["grain", "iron", "wood", "stone", "herbs", "gold", "vis", "gem", "scroll", "rp"];
    for (const code of HUD_RES) {
      const el = document.getElementById(`res-${code}`);
      if (el) el.textContent = gs.resources[code] || 0;
    }
    document.getElementById("turn-num").textContent = gs.meta.turn;
    const territoryEl = document.getElementById("hud-territory");
    if (territoryEl) {
      const used = getTerritoryUsedSlots();
      const max = getTerritoryMaxSlots();
      territoryEl.innerHTML = `🏞️ 영지 <b>${used}</b><span class="hud-badge-sep">/</span><span class="hud-badge-max">${max}</span>`;
      territoryEl.classList.toggle("full", used >= max);
      territoryEl.classList.toggle("warn", used >= max * 0.8 && used < max);
    }
    // 점령 도시/거점 카운트 (가문 본거지 제외 — "추가로 점령한 것"만)
    const homeHexIdHud = gs.family.homeHex.q * 100 + gs.family.homeHex.r;
    const homeStructId = tables.worldHex.get(homeHexIdHud)?.StructureID;
    let cityN = 0, fortN = 0;
    for (const sid of gs.capturedStructures || []) {
      if (sid === homeStructId) continue;  // 가문 본거지 제외
      const s = tables.structures.get(sid);
      if (!s) continue;
      if (s.StructureType === "City") cityN++;
      else if (s.StructureType === "Fort") fortN++;
    }
    const cityEl = document.getElementById("hud-city-count");
    const fortEl = document.getElementById("hud-fort-count");
    if (cityEl) cityEl.textContent = cityN;
    if (fortEl) fortEl.textContent = fortN;
  }
  ensurePartySelected();
  syncOverlays();
  renderPartyList();
  updateHud();

  // ─────── 커스텀 툴팁 시스템 (data-tip="제목|본문") ───────
  (function initTooltip() {
    const tip = document.getElementById("custom-tooltip");
    if (!tip) return;
    let currentTarget = null;

    function show(el, ev) {
      const raw = el.getAttribute("data-tip");
      if (!raw) return;
      const [title, body] = raw.includes("|") ? raw.split("|") : [raw, ""];
      const live = computeLiveTip(el);
      tip.innerHTML =
        `<div class="tip-title">${title}</div>` +
        (body ? `<div class="tip-body">${body}</div>` : "") +
        (live ? `<div class="tip-live">${live}</div>` : "");
      tip.hidden = false;
      positionAtMouse(ev.clientX, ev.clientY);
    }

    /** 호버한 요소 종류에 따라 현재 수치/상태를 HTML로 반환. */
    function computeLiveTip(el) {
      const gs = getState();
      if (!gs) return "";
      // 자원 (HUD .res)
      if (el.classList.contains("res")) {
        const valEl = el.querySelector("[id^='res-']");
        const code = valEl?.id?.replace("res-", "");
        if (code && gs.resources) {
          const cur = gs.resources[code] || 0;
          let extra = "";
          try {
            const inc = computeHexIncome(gs, tables);
            if (inc[code]) extra = ` · 턴당 +${inc[code]}`;
          } catch {}
          return `📊 현재: <b>${cur.toLocaleString()}</b>${extra}`;
        }
      }
      // 영지 배지
      if (el.id === "hud-territory") {
        const used = getTerritoryUsedSlots();
        const max = getTerritoryMaxSlots();
        const ownedTotal = gs.ownedHexes?.size || 0;
        return `📊 영지: <b>${used}/${max}</b> · 총 점령 헥스 ${ownedTotal} (HL0·구조물 포함)`;
      }
      // 턴
      if (el.querySelector?.("#turn-num") || el.id === "turn-num") {
        return `📊 현재 턴: <b>${gs.meta?.turn || 1}</b>`;
      }
      // 분대 편성 버튼 (⚙)
      if (el.classList.contains("pc-edit-btn")) {
        const pid = el.dataset.editParty;
        const p = gs.parties.find(x => x.id === pid);
        if (p) return `📊 현재 편성: ${p.slots.filter(x => x != null).length}/${p.slots.length}명`;
      }
      // 자동 귀환 버튼
      if (el.classList.contains("pc-autoreturn-btn")) {
        const pid = el.dataset.autoreturn;
        const p = gs.parties.find(x => x.id === pid);
        if (p) return `📊 현재 상태: <b>${p.autoReturn ? "ON" : "OFF"}</b>`;
      }
      // 파티 카드 내부 요소 (.pc-summary-fat/hp/loc)
      const card = el.closest?.(".party-card");
      if (card) {
        const pid = card.dataset.partyid;
        const p = gs.parties.find(x => x.id === pid);
        if (p) {
          const members = p.slots.map(id => id != null ? getCharacter(id) : null).filter(Boolean);
          // 피로
          if (el.classList.contains("pc-summary-fat")) {
            const lines = members.map(m => {
              const pct = Math.round(m.fatigue / m.maxFatigue * 100);
              const tag = pct <= 20 ? " 🔴" : pct <= 40 ? " 🟡" : "";
              return `${m.name}: <b>${m.fatigue}/${m.maxFatigue}</b>${tag}`;
            }).join("<br>");
            return lines || "파티원 없음";
          }
          // HP
          if (el.classList.contains("pc-summary-hp")) {
            const lines = members.map(m => {
              const pct = Math.round(m.hp / m.maxHp * 100);
              const tag = m.hp <= 0 ? " 💀 KO" : pct <= 25 ? " 🔴" : pct <= 50 ? " 🟡" : "";
              return `${m.name}: <b>${m.hp}/${m.maxHp}</b>${tag}`;
            }).join("<br>");
            return lines || "파티원 없음";
          }
          // 주둔지 — 풀회복까지 턴 수 계산
          if (el.classList.contains("pc-summary-loc") || el.classList.contains("pc-location")) {
            if (!members.length) return "파티원 없음";
            const minFat = Math.min(...members.map(m => m.fatigue));
            const maxFat = members[0].maxFatigue || 100;
            const minPerTurn = 10; // CONFIG.turn.minutesPerTurn
            const home = gs.family?.homeHex;
            const isHome = home && p.location.q === home.q && p.location.r === home.r;
            const hex = tables.worldHex.get(hexId(p.location.q, p.location.r));
            const struct = hex?.StructureID ? tables.structures.get(hex.StructureID) : null;
            let rate = 0.1 * minPerTurn; // 필드
            if (isHome || struct?.StructureType === "City") rate = 5 * minPerTurn;
            else if (struct?.StructureType === "Fort") rate = 3 * minPerTurn;
            else if (struct?.StructureType === "Bunker") rate = 1.5 * minPerTurn;
            const need = maxFat - minFat;
            const turns = rate > 0 ? Math.ceil(need / rate) : Infinity;
            return `현재 최하: <b>${minFat}</b>/100<br>풀회복까지: <b>${turns === Infinity ? "∞" : turns + "턴"}</b>`;
          }
          // 리더 병종
          if (el.classList.contains("pc-leader-job") || el.classList.contains("pc-icon")) {
            const leaderId = p.slots[0];
            const leader = leaderId != null ? getCharacter(leaderId) : null;
            if (leader) return `리더: <b>${leader.name}</b> Lv${leader.level} ${leader.jobClass}`;
            return "리더 없음";
          }
        }
      }

      // 탭 도크 — 배지 등
      if (el.dataset?.tab === "quest") {
        try {
          const claim = getClaimableQuests(gs, tables);
          if (claim?.length) return `📊 수령 가능 보상 <b>${claim.length}개</b>`;
        } catch {}
      }
      if (el.dataset?.tab === "gacha") {
        const gem = gs.resources?.gem || 0;
        const scroll = gs.resources?.scroll || 0;
        return `📊 💎 ${gem} · 📜 ${scroll}`;
      }
      return "";
    }
    /** 마우스 커서 바로 옆(오른쪽 아래)에 붙임. 화면 밖이면 반대편으로 플립. */
    function positionAtMouse(mx, my) {
      if (tip.hidden) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const gap = 12;
      // 기본: 오른쪽-아래
      let x = mx + gap;
      let y = my + gap;
      // 오른쪽 초과 → 왼쪽
      if (x + tw > vw - 4) x = mx - tw - gap;
      // 아래쪽 초과 → 위쪽
      if (y + th > vh - 4) y = my - th - gap;
      // 여전히 화면 밖이면 클램프
      if (x < 4) x = 4;
      if (y < 4) y = 4;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    }
    function hide() { tip.hidden = true; currentTarget = null; }

    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest("[data-tip]");
      if (el && el !== currentTarget) {
        currentTarget = el;
        show(el, e);
      }
    });
    document.addEventListener("mousemove", (e) => {
      if (currentTarget) positionAtMouse(e.clientX, e.clientY);
    });
    document.addEventListener("mouseout", (e) => {
      if (currentTarget && !currentTarget.contains(e.relatedTarget)) hide();
    });
    document.addEventListener("click", () => hide());
    document.addEventListener("scroll", () => hide(), true);
  })();

  // GDD §4-2: 공성 타이머 만료 체크 (1초 주기)
  // 복원 시점에 토스트 알림 + UI 갱신하여 유저가 "왜 실패했는지" 인지 가능.
  setInterval(() => {
    const gs = getState();
    if (!gs?.siegeState) return;
    let anyActive = false;
    let anyExpired = false;
    for (const sid of Object.keys(gs.siegeState)) {
      const sp = gs.siegeState[sid];
      if (sp?.defenderTimers && Object.keys(sp.defenderTimers).length > 0) anyActive = true;
      const struct = tables.structures.get(Number(sid));
      if (!struct) continue;
      const expired = cleanupExpiredTimers(Number(sid));
      if (expired.length === 0) continue;
      anyExpired = true;
      const defenseRows = tables.structureDefense.all().filter(d => expired.includes(d.DefenseID));
      const layers = [...new Set(defenseRows.map(d => d.DefenseLayer))];
      for (const layer of layers) {
        const nameKr = { Patrol: "경비대", Garrison: "수비대" }[layer] || layer;
        showToast(`💀 [${struct.Name}] ${nameKr} 복원됨 (타이머 만료)`, "warn");
      }
    }
    if (anyExpired) {
      saveState(getState());
    }
    // 타이머 활성 중이면 매초 화면 갱신 (링 + 팝업 카운트다운)
    if (anyActive || anyExpired) {
      worldmap.requestDraw();
      // 패널이 이미 열려있을 때만 갱신 — 강제 표시 X (좌상단 (0,0)으로 매초 리셋되던 버그 수정)
      const hexPanel = document.getElementById("hex-panel");
      if (selectedHexRow?.StructureID && !hexPanel.hidden) {
        const left = hexPanel.style.left;
        const top  = hexPanel.style.top;
        showTilePanel(selectedHexRow, null, tables, 0, 0);
        if (left) hexPanel.style.left = left;
        if (top)  hexPanel.style.top  = top;
      }
    }
  }, 1000);

  // ─────── 분대 편성 모달 (B) ───────
  let editorSelectedCharId = null;
  function openPartyEditor(highlightCharId) {
    editorSelectedCharId = highlightCharId || null;
    document.getElementById("editor-panel").hidden = false;
    renderPartyEditor();
  }
  function closePartyEditor() {
    document.getElementById("editor-panel").hidden = true;
    editorSelectedCharId = null;
  }
  document.getElementById("btn-close-editor")?.addEventListener("click", closePartyEditor);

  function renderPartyEditor() {
    const gs = getState();
    const roster = getRosterWithStatus();
    const el = document.getElementById("editor-content");
    if (!el) return;
    const selected = editorSelectedCharId;
    const maxP = getMaxParties();
    let html = `<div class="ep-hint">💡 아래에서 캐릭을 선택한 뒤 분대 슬롯을 클릭하면 배치됩니다. 슬롯 0번이 리더(사망 시 즉시 패배). · 분대 <b>${gs.parties.length}</b>/${maxP}</div>`;
    for (const party of gs.parties) {
      html += `<div class="ep-party-row"><div class="ep-party-head"><b>${party.name}</b><button class="ep-btn-auto-party" data-auto-party="${party.id}" type="button" title="이 분대만 자동 배치 (다른 파티는 그대로)">🎯 자동</button><small>${party.slots.filter(x=>x!=null).length}/${party.slots.length}</small></div><div class="ep-slots">`;
      for (let i = 0; i < party.slots.length; i++) {
        const cid = party.slots[i];
        const ch = cid != null ? getCharacter(cid) : null;
        const leaderCls = i === 0 ? " leader" : "";
        if (ch) {
          html += `<div class="ep-slot${leaderCls}" data-party="${party.id}" data-slot="${i}">
            <canvas width="44" height="44" data-portrait="${ch.spriteName}" data-ko="${ch.hp<=0}"></canvas>
            <div class="ep-name">${ch.name} Lv${ch.level}</div>
          </div>`;
        } else {
          html += `<div class="ep-slot${leaderCls}" data-party="${party.id}" data-slot="${i}"><div class="ep-empty">+</div><div class="ep-name">빈 슬롯</div></div>`;
        }
      }
      html += `</div></div>`;
    }
    // 분대 추가 / 삭제 / 배럭 확장 버튼 (자동 배치는 각 분대 헤더에 별도)
    const canAdd = gs.parties.length < maxP;
    html += `<div class="ep-party-actions">`;
    html += `<button class="ep-btn-add" ${canAdd ? "" : "disabled"} type="button">➕ 분대 추가 ${canAdd ? `(${gs.parties.length}/${maxP})` : `(${maxP}/${maxP} 가득)`}</button>`;
    if (gs.parties.length > 1) {
      html += `<button class="ep-btn-del" type="button">🗑 마지막 분대 삭제</button>`;
    }
    html += `</div>`;

    // 배럭 확장 (maxParties < 6일 때만)
    const expandCost = getBarracksExpandCost();
    if (expandCost) {
      const exCheck = canExpandBarracks();
      const RES_LBL = { wood: "🪵목재", stone: "🪨석재", grain: "🌾곡물", gold: "💰금화", iron: "⛏️철", herbs: "🌿약초" };
      const costStr = Object.entries(expandCost)
        .map(([res, amt]) => {
          const have = gs.resources?.[res] || 0;
          const ok = have >= amt;
          return `<span style="color:${ok ? "#8c8" : "#f66"}">${RES_LBL[res] || res} ${have}/${amt}</span>`;
        }).join(" · ");
      html += `<div class="ep-expand">
        <div class="ep-expand-head">🏗️ 배럭 확장 — 최대 분대 <b>${maxP}</b> → <b>${maxP + 1}</b></div>
        <div class="ep-expand-cost">${costStr}</div>
        <button class="ep-btn-expand" ${exCheck.ok ? "" : "disabled"} type="button">${exCheck.ok ? "확장" : "자원 부족"}</button>
      </div>`;
    } else {
      html += `<div class="ep-expand"><div class="ep-expand-head">🏗️ 배럭 최대치 (6분대) 도달</div></div>`;
    }

    html += `<div class="ep-roster-section"><div class="ep-roster-title">📋 로스터 (클릭으로 선택)</div><div class="ep-roster-grid">`;
    for (const ch of roster) {
      const sel = ch.id === selected ? " selected" : "";
      const asn = ch.assignedPartyId ? " assigned" : "";
      html += `<div class="ep-roster-slot${sel}${asn}" data-charid="${ch.id}" title="${ch.name} Lv${ch.level} ${ch.jobClass}">
        <canvas width="40" height="40" data-portrait="${ch.spriteName}" data-ko="${ch.hp<=0}"></canvas>
        <div class="rs-lv">${ch.level}</div>
      </div>`;
    }
    html += `</div></div>`;
    el.innerHTML = html;

    // 캔버스 초상화 그리기
    el.querySelectorAll("canvas[data-portrait]").forEach(cv => {
      drawFacePortrait(cv, cv.dataset.portrait, cv.dataset.ko === "true");
    });

    // 분대 추가/삭제
    el.querySelector(".ep-btn-add")?.addEventListener("click", () => {
      pushUndo("분대 추가");
      const r = createParty();
      if (!r.ok && r.reason === "limit_reached") {
        showToast(`최대 분대 수 ${r.limit}개 도달`, "warn");
        return;
      }
      if (r.ok) {
        showToast(`✓ ${r.party.name} 추가됨`, "exp");
        // 좌측 파티 목록 + 모달 안 신규 카드로 자동 스크롤 (다음 tick에 DOM 갱신 후)
        setTimeout(() => {
          // 좌측 목록
          const list = document.getElementById("party-list");
          if (list) list.scrollTop = list.scrollHeight;
          // 편성 모달 콘텐츠 (모달 열려있을 때)
          const editorContent = document.getElementById("editor-content");
          if (editorContent && !document.getElementById("editor-panel").hidden) {
            editorContent.scrollTop = editorContent.scrollHeight;
          }
        }, 50);
      }
    });
    el.querySelector(".ep-btn-del")?.addEventListener("click", () => {
      const last = gs.parties[gs.parties.length - 1];
      if (!last) return;
      pushUndo(`분대 삭제: ${last.name}`);
      deleteParty(last.id);
    });
    // 파티별 자동 배치 — 클릭한 분대만 미배치 캐릭에서 채움 (다른 파티 그대로)
    el.querySelectorAll(".ep-btn-auto-party").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const pid = btn.dataset.autoParty;
        const party = gs.parties.find(p => p.id === pid);
        if (!party) return;
        pushUndo(`자동 배치: ${party.name}`);
        const r = autoAssignParty(pid);
        if (r.ok) {
          showToast(`🎯 ${party.name} 자동 배치 — ${r.assigned.length}명 편성`, "exp");
        } else {
          showToast(`자동 배치 실패: ${r.reason}`, "warn");
        }
      });
    });
    el.querySelector(".ep-btn-expand")?.addEventListener("click", () => {
      pushUndo("배럭 확장");
      const r = expandBarracks();
      if (r.ok) {
        showToast(`🏗️ 배럭 확장! 최대 분대 ${r.newMax}개`, "levelup");
      } else if (r.reason === "insufficient") {
        showToast(`자원 부족: ${r.missing} ${r.have}/${r.need}`, "warn");
      }
    });

    // 로스터 캐릭 선택
    el.querySelectorAll(".ep-roster-slot").forEach(e => {
      e.addEventListener("click", () => {
        editorSelectedCharId = Number(e.dataset.charid);
        renderPartyEditor();
      });
    });
    // 슬롯 클릭 → 배치/제거
    el.querySelectorAll(".ep-slot").forEach(e => {
      e.addEventListener("click", () => {
        const pid = e.dataset.party;
        const idx = Number(e.dataset.slot);
        if (editorSelectedCharId != null) {
          pushUndo(`편성: ${pid} 슬롯${idx}`);
          assignPartySlot(pid, idx, editorSelectedCharId);
          editorSelectedCharId = null;
          renderPartyEditor();
        } else {
          // 선택 없으면 해당 슬롯 비우기
          const party = gs.parties.find(p => p.id === pid);
          if (party?.slots[idx] != null) {
            pushUndo(`편성 제거: ${pid} 슬롯${idx}`);
            assignPartySlot(pid, idx, null);
            renderPartyEditor();
          }
        }
      });
    });
  }

  // 편성 모달 열려있으면 state 변경 시 갱신
  on("state:changed", () => {
    if (!document.getElementById("editor-panel")?.hidden) renderPartyEditor();
  });

  // ESC / 외부 클릭으로 편성 모달 닫기
  document.getElementById("editor-panel")?.addEventListener("click", (e) => {
    if (e.target.id === "editor-panel") closePartyEditor();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("editor-panel")?.hidden) {
      closePartyEditor();
    }
  });

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
      card.dataset.partyid = party.id;
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
        // HP = 빨강 계열 (생명선): 건강할수록 선명한 빨강, 부상 시 흐림
        const hpColor = hpPct <= 25 ? "#f55" : hpPct <= 50 ? "#e74a5a" : "#c73a47";
        // 피로 = 파랑 계열 (스태미너): 충분하면 파랑, 피곤하면 노랑→빨강
        const fatColor = fatPct <= 20 ? "#f55" : fatPct <= 40 ? "#fa4" : fatPct <= 70 ? "#6ab" : "#4a9edd";

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
              <div class="pcm-bar pcm-bar-hp" title="HP ${m.hp}/${m.maxHp} (${hpPct}%)">
                <div class="pcm-bar-fill" style="width:${hpPct}%;background:${hpColor}"></div>
                <span class="pcm-bar-label">${hpPct}</span>
              </div>
              <div class="pcm-bar pcm-bar-xp" title="EXP ${xpPct}%"><div class="pcm-bar-fill" style="width:${xpPct}%;background:#fa3"></div></div>
            </div>
          </div>`;
      }).join("");

      const leaderJobMap = { F: "파이터", S: "스카우트", M: "머스킷티어", W: "위자드", L: "워록" };
      const leaderJobName = leaderJobMap[leader?.jobClass] || "?";

      // 파티 주둔지 표시 (피로 회복 UX)
      const home = gs.family?.homeHex;
      const isHome = home && party.location.q === home.q && party.location.r === home.r;
      const pHex = tables.worldHex.get(hexId(party.location.q, party.location.r));
      const pStruct = pHex?.StructureID ? tables.structures.get(pHex.StructureID) : null;
      // 턴당 회복량 = energy.json RecoveryPerMin × CONFIG.turn.minutesPerTurn
      const minPerTurn = CONFIG.turn?.minutesPerTurn || 10;
      let locIcon = "🏞️", locLabel = `필드 (피로 +${(0.1 * minPerTurn).toFixed(1)}/턴)`;
      if (isHome || pStruct?.StructureType === "City") { locIcon = "🏛️"; locLabel = `도시 (피로 +${5 * minPerTurn}/턴 · 2턴 풀회복)`; }
      else if (pStruct?.StructureType === "Fort") { locIcon = "🏰"; locLabel = `거점 (피로 +${3 * minPerTurn}/턴 · 3~4턴 풀회복)`; }
      else if (pStruct?.StructureType === "Bunker") { locIcon = "⛺"; locLabel = `벙커 (피로 +${1.5 * minPerTurn}/턴)`; }
      else if (pStruct?.StructureType === "Gate") { locIcon = "🚪"; locLabel = "관문"; }

      const autoReturnOn = !!party.autoReturn;

      // 파티 HP/피로 — 삼전식: HP는 평균, 피로는 "최하 피로원" 기준 (약한 고리)
      const avgHpPct = members.length
        ? Math.round(members.reduce((s, m) => s + (m.hp / m.maxHp * 100), 0) / members.length)
        : 0;
      const minFatPct = members.length
        ? Math.min(...members.map(m => Math.round(m.fatigue / m.maxFatigue * 100)))
        : 0;
      const minFatMember = members.length
        ? members.reduce((w, m) => (m.fatigue / m.maxFatigue < w.fatigue / w.maxFatigue ? m : w), members[0])
        : null;
      const partyFatColor = minFatPct <= 20 ? "#f55" : minFatPct <= 40 ? "#fa4" : minFatPct <= 70 ? "#6ab" : "#4a9edd";
      const hpSummaryClass = avgHpPct <= 30 ? "critical" : avgHpPct <= 60 ? "warn" : "";
      const fatSummaryClass = minFatPct <= 30 ? "critical" : minFatPct <= 60 ? "warn" : "";

      // 주둔지 회복 속도 텍스트 (아이콘 옆에 표시)
      let locRateText = "";
      if (isHome || pStruct?.StructureType === "City") locRateText = `+${5 * minPerTurn}/턴`;
      else if (pStruct?.StructureType === "Fort") locRateText = `+${3 * minPerTurn}/턴`;
      else if (pStruct?.StructureType === "Bunker") locRateText = `+${1.5 * minPerTurn}/턴`;
      else locRateText = `+${(0.1 * minPerTurn).toFixed(1)}/턴`;

      // 등록된 홈 표시 (가문 도시 외)
      let homeLabel = "도시";
      if (party.homeHex) {
        const homeHex = tables.worldHex.get(party.homeHex.q * 100 + party.homeHex.r);
        const homeStruct = homeHex?.StructureID ? tables.structures.get(homeHex.StructureID) : null;
        homeLabel = homeStruct?.Name || `Fort ${homeHex?.HexID || ""}`;
      }
      card.innerHTML = `
        <div class="pc-header">
          <div class="pc-icon" style="background:${color}" data-tip="🎖 리더 병종 (${leaderJobName})|파티 리더의 병종이 파티 전체 병종 상성을 결정. 리더 사망 시 파티 즉시 패배.">${leader?.jobClass || "?"}</div>
          <div class="pc-name" data-tip="파티 이름|편성 모달(⚙)에서 멤버 변경 가능. 슬롯 0번 = 리더 (👑).">${party.name}</div>
          <div class="pc-leader-job" style="color:${color}" data-tip="🎖 리더 병종|현재 리더의 병종. 파티 전투 시 상성 판정에 사용됨.">${leaderJobName}</div>
          <span class="pc-home" title="귀환 시 갈 곳: ${homeLabel}">🏠 ${homeLabel}</span>
          <button class="pc-autoreturn-btn ${autoReturnOn ? 'on' : ''}" data-autoreturn="${party.id}" type="button"
                  title="전투 후 자동 귀환 ${autoReturnOn ? 'ON' : 'OFF'} (클릭으로 토글)">↩</button>
          <button class="pc-edit-btn" data-edit-party="${party.id}" type="button" title="분대 편성">⚙</button>
        </div>
        <div class="pc-summary">
          <span class="pc-summary-fat ${fatSummaryClass}" data-tip="⚡ 파티 피로|파티 최하 피로원 기준 (약한 고리). 현재 최저: ${minFatMember?.name ?? '-'}. 전투/이동 시 감소, 주둔지에서 턴당 자연 회복. 0이면 탈진(전투 불가).">⚡ ${minFatPct}/100</span>
          <span class="pc-summary-hp ${hpSummaryClass}" data-tip="❤️ 파티 평균 HP|3인 평균. 전투 데미지로 감소, HP 0 = KO → 부상. 부상 치료는 약재+골드 or 시간.">❤️ ${avgHpPct}%</span>
          <span class="pc-summary-loc" data-tip="${locIcon} ${locLabel}|주둔지별 피로 회복 속도. 🏛️도시(가장 빠름) > 🏰거점 > ⛺벙커 > 🏞️필드(거의 정지). 10분/턴 기준.">${locIcon} ${locRateText}</span>
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

      // 편성 버튼 — 파티 카드 click 이벤트보다 먼저 처리
      card.querySelector(".pc-edit-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openPartyEditor();
      });
      // 자동 귀환 토글 — 카드 click 이벤트 차단
      card.querySelector(".pc-autoreturn-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = togglePartyAutoReturn(party.id);
        if (r.ok) {
          showToast(`🏠 ${party.name} 자동 귀환 ${r.value ? "ON" : "OFF"}`, "exp");
        }
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
    // 1) 조우 아이콘 클릭 우선 체크 → 해당 헥스 선택 + 패널 표시
    const encId = overlays.hitTestEncounter(sx, sy);
    if (encId) {
      const gs = getState();
      const enc = gs.encounters.find(e => e.id === encId);
      if (enc) {
        const encHexRow = tables.worldHex.get(hexId(enc.q, enc.r));
        if (encHexRow) {
          selectedHexRow = encHexRow;
          overlays.setSelected(enc.q, enc.r);
          const sp = getSelectedParty();
          let path = null;
          if (sp && (sp.location.q !== enc.q || sp.location.r !== enc.r)) {
            path = findPath(sp.location.q, sp.location.r, enc.q, enc.r, tables);
            if (path && path.length > 1) overlays.setPathPreview(path);
          }
          const ps = camera.worldToScreen(hexWorld(enc.q, enc.r).x, hexWorld(enc.q, enc.r).y);
          showTilePanel(encHexRow, path, tables, ps.x, ps.y + 40);
          worldmap.requestDraw();
        }
      }
      return;
    }

    // 2) 맵 위 파티 라벨 클릭 → 해당 파티 선택
    const labelPartyId = overlays.hitTestLabel(sx, sy);
    if (labelPartyId) {
      selectParty(labelPartyId);
      const gsL = getState();
      const p = gsL.parties.find(x => x.id === labelPartyId);
      if (p) {
        overlays.setSelected(p.location.q, p.location.r);
        const pw = hexWorld(p.location.q, p.location.r);
        camera.centerOn(pw.x, pw.y);
        const pHexRow = tables.worldHex.get(hexId(p.location.q, p.location.r));
        if (pHexRow) {
          selectedHexRow = pHexRow;
          const ps = camera.worldToScreen(pw.x, pw.y);
          showTilePanel(pHexRow, null, tables, ps.x, ps.y + 40);
        }
      }
      worldmap.requestDraw();
      return;
    }

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
    // 조우형 적 정보 (GDD §5-2)
    const encAtHex = getEncounterAt(row.HexQ, row.HexR);
    const encTpl = encAtHex ? tables.encounters.get(encAtHex.templateId) : null;
    if (encTpl && encAtHex.discovered) {
      info.push(`<span style="color:#f86">${encTpl.Icon} ${encTpl.Name} (Lv ${encTpl.MinLevel})</span>`);
    }
    if (path) info.push(`경로: ${path.length - 1}칸 · 피로+${pathCost(path)}`);

    // 공성 진행 — 미점령 구조물 HP 게이지
    let siegeHtml = "";
    if (structure && !isCaptured) {
      const maxHp = getStructureMaxHP(structure);
      if (maxHp > 0) {
        const curHp = getStructureCurrentHP(structure.StructureID) ?? maxHp;
        const pct = Math.round(curHp / maxHp * 100);
        const barColor = pct > 60 ? "#a44" : pct > 25 ? "#da4" : "#fa4";
        siegeHtml = `
          <div style="margin-top:6px">
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#fcc">
              <span>🏰 ${structure.StructureType} HP</span>
              <span><b>${curHp}</b>/${maxHp}</span>
            </div>
            <div style="height:6px;background:#222;border:1px solid #000;border-radius:3px;overflow:hidden;margin-top:2px">
              <div style="height:100%;width:${pct}%;background:${barColor};transition:width 0.3s"></div>
            </div>
          </div>`;
      }
      // 공성 진행도 (layer별 타이머 시각화)
      const defs = findStructureDefenders(structure.StructureID, tables);
      const byLayer = { Patrol: [], Garrison: [], Stationed: [] };
      for (const d of defs) byLayer[d.__layer]?.push(d);
      const fmtTime = (ms) => {
        if (ms == null) return "영구";
        const s = Math.max(0, Math.floor(ms / 1000));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      };
      for (const layer of ["Patrol", "Garrison", "Stationed"]) {
        const arr = byLayer[layer];
        if (!arr.length) continue;
        const defeatedCount = arr.filter(d =>
          isDefenderDefeated(structure.StructureID, d.PartyID)
        ).length;
        const nameKr = { Patrol: "경비대", Garrison: "수비대", Stationed: "주둔군" }[layer];
        // 가장 먼저 만료되는 타이머 표시
        let timerText = "";
        if (layer !== "Stationed" && defeatedCount > 0) {
          const rems = arr
            .map(d => getDefenderTimerRemaining(structure.StructureID, d.PartyID))
            .filter(r => r != null);
          if (rems.length) {
            const earliest = Math.min(...rems);
            const color = earliest < 30000 ? "#f44" : earliest < 60000 ? "#fa4" : "#5a5";
            timerText = ` <span style="color:${color}">⏱ ${fmtTime(earliest)}</span>`;
          }
        }
        const status = defeatedCount === arr.length
          ? `<span style="color:#5a5">✅ ${defeatedCount}/${arr.length}</span>`
          : `<span style="color:#fa6">${defeatedCount}/${arr.length}</span>`;
        siegeHtml += `<div style="font-size:10px;color:#ccc;margin-top:2px">${nameKr} ${status}${timerText}</div>`;
      }
    }
    document.getElementById("hex-meta").innerHTML = info.join(" · ") + siegeHtml;

    // Action buttons
    const actions = document.getElementById("hex-actions");
    actions.innerHTML = "";

    // 이동 (경로 중 조우 감지 → 그 지점에서 자동 전투)
    if (party && path && path.length > 1) {
      const blocked = structure && !isCaptured;
      // 경로상 첫 번째 조우 감지 (시작점 제외)
      let interceptIdx = -1;
      let interceptEnc = null;
      for (let i = 1; i < path.length; i++) {
        const n = path[i];
        const encOnPath = getEncounterAt(n.q, n.r);
        if (encOnPath) {
          interceptIdx = i;
          interceptEnc = encOnPath;
          break;
        }
      }
      const label = interceptEnc
        ? `⚔️ 이동 중 교전 (피로+${path[interceptIdx].cost})`
        : (encAtHex ? `⚔️ 교전 (피로+${pathCost(path)})` : `이동 (피로+${pathCost(path)})`);
      const color = (interceptEnc || encAtHex) ? "#a03030" : "#2c5aa6";
      const btn = addAction(actions, label, color, () => {
        if (blocked && !interceptEnc) return;
        pushUndo(`이동 → #${row.HexID}`);
        // 경로 중 조우 있으면 해당 지점까지만 이동 후 전투
        const walkPath = interceptEnc ? path.slice(0, interceptIdx + 1) : path;
        const finalHex = interceptEnc ? path[interceptIdx] : { q: row.HexQ, r: row.HexR };
        const moveCost = interceptEnc ? path[interceptIdx].cost : pathCost(path);
        animatedMove(party.id, walkPath, () => {
          moveParty(party.id, finalHex.q, finalHex.r, moveCost);
          cancelInteraction();
          saveState(getState());
          const enc = interceptEnc || encAtHex;
          if (!enc) return;
          const encHex = tables.worldHex.get(hexId(finalHex.q, finalHex.r));
          if (!encHex) return;
          // 이동 중 충돌 = 즉시 교전(모달 없이) + 승리 시 잔여 경로 계속 이동
          if (interceptEnc) {
            const remainPath = path.slice(interceptIdx);  // [교전지점, ..., 목적지]
            handleEncounter(party, encHex, enc, {
              skipModal: true,
              onWin: () => {
                if (remainPath.length <= 1) return;
                const remainCost = pathCost(remainPath);
                animatedMove(party.id, remainPath, () => {
                  moveParty(party.id, row.HexQ, row.HexR, remainCost);
                  saveState(getState());
                });
              },
            });
          } else {
            // 목적지가 조우 — 기존대로 모달
            handleEncounter(party, encHex, enc);
          }
        });
      });
      if (blocked && !interceptEnc) { btn.disabled = true; btn.title = "점령 필요"; }
    }
    // 파티가 이미 조우 헥스에 있는 경우 (같은 헥스 클릭)
    if (party && encAtHex && party.location.q === row.HexQ && party.location.r === row.HexR) {
      addAction(actions, `⚔️ 교전`, "#a03030", () => {
        handleEncounter(party, row, encAtHex);
      });
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

    // 귀환 (파티별 홈으로 — 등록 안 했으면 가문 홈)
    if (party) {
      const home = getPartyHome(party);
      if (home && (party.location.q !== home.q || party.location.r !== home.r)) {
        addAction(actions, "귀환", "#555", () => doReturn());
      }
    }

    // 휴식 — 점령된 City/Fort + 파티 현재 위치. HP 회복 전용 (피로는 자연 회복).
    // 1 곡물 = 10 HP, 슬롯별 부족분 합산 (정식판 음식 시스템 prox)
    const isRestableShelter = structure && isCaptured
      && (structure.StructureType === "City" || structure.StructureType === "Fort");
    if (party && isRestableShelter && party.location.q === row.HexQ && party.location.r === row.HexR) {
      const cost = getRestCost(party);
      const haveGrain = getState().resources?.grain || 0;
      const noNeed = cost === 0;
      const canRest = !noNeed && haveGrain >= cost;
      const label = noNeed ? "🛌 풀HP" : `🛌 휴식 (🌾 ${cost})`;
      const btn = addAction(actions, label, canRest ? "#3a5a7a" : "#444", () => {
        const r = restPartyWithGrain(party.id);
        if (r.ok) {
          showToast(`🛌 ${party.name} 휴식 — HP 풀회복 (🌾 ${r.cost} 차감)`, "exp");
          const ps = camera.worldToScreen(hexWorld(row.HexQ, row.HexR).x, hexWorld(row.HexQ, row.HexR).y);
          showTilePanel(row, null, tables, ps.x, ps.y + 40);
        } else if (r.reason === "insufficient") {
          showToast(`곡물 ${r.missing} 부족`, "warn");
        }
      });
      if (!canRest) {
        btn.disabled = true;
        btn.title = noNeed
          ? "이미 모든 슬롯이 풀HP — 휴식 불필요"
          : `곡물 ${cost - haveGrain} 부족 (보유 ${haveGrain}/필요 ${cost})`;
      }
    }

    // 거점/도시 업그레이드 — 점령된 Fort/City/Gate/Bunker (4축 강화: PatrolLv/GarrisonLv/StationedLv/DurabilityLv).
    // 원안: project_structure_battle.md, structures.json 4축 컬럼 활용
    if (structure && isCaptured && getStructureUpgradeAxes(structure).length > 0) {
      addAction(actions, "🔧 거점 업그레이드", "#5a4a7a", () => {
        showStructureUpgradeModal(structure);
      });
    }

    // 거점 배치 — 점령된 Fort 헥스에 분대 배치 (이동 + 홈 등록).
    // 룰: 거점 캡 = getFortMaxParties(structure) — StationedLv 기반 (1~3=1, 4~6=2, 7~10=3)
    if (party && structure && isCaptured && structure.StructureType === "Fort") {
      const cap = getFortMaxParties(structure);
      const deployed = getFortDeployedParties(row.HexQ, row.HexR);
      const partyHomeAtHere = party.homeHex && party.homeHex.q === row.HexQ && party.homeHex.r === row.HexR;
      const others = deployed.filter(p => p.id !== party.id);
      const isFull = others.length >= cap;

      if (partyHomeAtHere) {
        // 이미 이 거점에 배치된 파티 — 해제 옵션
        addAction(actions, `🏠 ${party.name} 배치 해제 (${deployed.length}/${cap})`, "#7a5a3a", () => {
          pushUndo(`${party.name} 배치 해제`);
          setPartyHome(party.id, null, null);
          showToast(`🏠 ${party.name} 배치 해제 (귀환지: 가문 도시)`, "exp");
        });
      } else if (isFull) {
        // 캡 초과 — 비활성 버튼 + 점유 파티 표시
        const btn = addAction(actions, `🏠 만석 ${deployed.length}/${cap}`, "#444", () => {});
        btn.disabled = true;
        btn.title = `이 거점은 ${others.map(p => p.name).join(", ")} 점유 중. 거점 캡 ${cap} (StationedLv 업그레이드로 증가 — 🔧 거점 업그레이드).`;
      } else {
        // 배치 가능 — 이미 거점에 있으면 즉시 등록, 아니면 이동 + 도착 시 등록
        const alreadyHere = party.location.q === row.HexQ && party.location.r === row.HexR;
        const suffix = alreadyHere ? "" : " (이동 후)";
        const label = `🏠 ${party.name} 배치${suffix} (${deployed.length}/${cap})`;
        addAction(actions, label, "#3a7a5a", () => {
          pushUndo(`${party.name} 배치 → ${structure.Name || "Fort"}`);
          const finishDeploy = () => {
            const r = setPartyHome(party.id, row.HexQ, row.HexR);
            if (r.ok) {
              showToast(`🏠 ${party.name} 배치 → ${structure.Name || structure.StructureType}`, "exp");
            } else {
              showToast(`배치 실패: ${r.reason}`, "warn");
            }
          };
          if (alreadyHere) {
            finishDeploy();
          } else {
            // 이동 (path 없으면 즉시 워프 등록)
            if (path && path.length > 1) {
              animatedMove(party.id, path, () => {
                moveParty(party.id, row.HexQ, row.HexR, pathCost(path));
                finishDeploy();
                cancelInteraction();
                saveState(getState());
              });
            } else {
              moveParty(party.id, row.HexQ, row.HexR, 0);
              finishDeploy();
            }
          }
        });
      }
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
    const isStructureSiege = structureForCombat && !isStructureCaptured(structureForCombat.StructureID);
    if (isStructureSiege) {
      const allDefenders = findStructureDefenders(structureForCombat.StructureID, tables);
      // 데모 단순화 (§6): Patrol 무한 등장, Garrison/Stationed 격파 영구
      enemies = allDefenders.filter(d => {
        if (d.__layer === "Patrol") return true;
        return !isDefenderDefeated(structureForCombat.StructureID, d.PartyID);
      });
    }

    if (enemies.length === 0) {
      // 적 없음 — 점령 모드면 바로 점령
      if (mode === "occupy") {
        ownHex(hexRow.HexID);
        if (structureForCombat) captureStructure(structureForCombat.StructureID);
        reportProgress(getState(), tables, "occupy", 1);
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

    // 구조물 공성은 별도 BattleType="siege" 풀 (현재 데이터에 매칭 적은 편이지만 호환).
    const dropMode = isStructureSiege ? "siege" : (mode === "occupy" ? "occupy" : "subjugate");

    for (const ep of enemies) {
      lastResult = resolveCombat(playerChars, ep, terrain, tables, dropMode);
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

    // 전투 피로 소모 (GDD energy.json: BaseCombatCost=5 + CostPerRound=1 × 라운드 수)
    const rounds = lastResult?.record?.totalTurns || 1;
    const fatigueCost = 5 + rounds;
    for (const ch of playerChars) {
      ch.fatigue = Math.max(0, ch.fatigue - fatigueCost);
      if (ch.fatigue <= 0) ch.status = "exhausted";
      else if (ch.fatigue <= 30) ch.status = "tired";
    }

    // 4. 결과 처리
    const allWon = totalWins === enemies.length;

    // 구조물 공성: 격파 웨이브를 layer별 타이머로 마킹 + HP 데미지 (gdd_structure_siege.md §4)
    let siegeInfo = null;
    if (isStructureSiege && totalWins > 0) {
      const maxHp = getStructureMaxHP(structureForCombat);
      // 격파한 웨이브들을 layer별 타이머 규칙에 맞춰 마킹
      // - Patrol: 3분 타이머, Garrison: 5분 타이머, Stationed: 영구
      for (let i = 0; i < totalWins; i++) {
        const ep = enemies[i];
        markDefenderDefeated(structureForCombat.StructureID, ep.PartyID, maxHp, ep.__layer);
        showToast(`✅ [${structureForCombat.Name}] ${ep.__layerName} 격파${ep.__layer === "Stationed" ? " (영구)" : ""}`, "exp");
      }
      // 모든 방어자 격파 시 → HP 데미지 (Patrol도 포함 — 타이머 내에 깨진 상태여야 함)
      const allDefenders = findStructureDefenders(structureForCombat.StructureID, tables);
      const allCleared = allDefenders.every(d =>
        isDefenderDefeated(structureForCombat.StructureID, d.PartyID)
      );
      if (allCleared && maxHp > 0) {
        const damage = getPartySiegeDamage(playerChars);
        const fellHP = applyStructureDamage(structureForCombat.StructureID, damage, maxHp);
        const sp = getSiegeProgress(structureForCombat.StructureID, maxHp);
        siegeInfo = { damage, hp: sp.hp, maxHp, fell: fellHP, allCleared: true };
        if (fellHP && mode === "occupy") {
          // 함락! 점령 처리 — siege_gate/fort 1번이면 occupy/subjugate/siege_any 자동 fan-out
          ownHex(hexRow.HexID);
          captureStructure(structureForCombat.StructureID);
          const sType = structureForCombat.StructureType;
          if (sType === "Gate") reportProgress(getState(), tables, "siege_gate", 1);
          else if (sType === "Fort") reportProgress(getState(), tables, "siege_fort", 1);
          else reportProgress(getState(), tables, "occupy", 1);
          // 자동 귀환 옵션
          if (party.autoReturn) {
            const home = getPartyHome(party);
            moveParty(party.id, home.q, home.r, 0);
            showToast(`🏠 ${party.name} 자동 귀환`, "exp");
          }
        }
      } else if (maxHp === 0 && allCleared && mode === "occupy") {
        // 거점(Fort) — 내구도 없음, 수비대 전멸 시 즉시 함락
        ownHex(hexRow.HexID);
        captureStructure(structureForCombat.StructureID);
        reportProgress(getState(), tables, "siege_fort", 1);  // → occupy/subjugate/siege_any 자동
        siegeInfo = { damage: 0, hp: 0, maxHp: 0, fell: true, allCleared: true };
        if (party.autoReturn) {
          const home = getState().family.homeHex;
          moveParty(party.id, home.q, home.r, 0);
          showToast(`🏠 ${party.name} 자동 귀환`, "exp");
        }
      }
    }

    // GDD §9-3: 리더(슬롯 0) 사망 시 파티는 현장 잔류 불가 — 강제 퇴각
    const leaderAfter = party.slots[0] != null ? getCharacter(party.slots[0]) : null;
    const leaderDead = leaderAfter && leaderAfter.hp <= 0;

    if (allWon && !isStructureSiege && mode === "occupy" && !leaderDead) {
      // 일반 헥스 점령 (리더 생존 시에만)
      ownHex(hexRow.HexID);
      reportProgress(getState(), tables, "occupy", 1);
      // 파티는 점령 헥스에 유지 (자동 귀환 옵션 시 홈으로 이동)
      if (party.autoReturn) {
        const home = getPartyHome(party);
        moveParty(party.id, home.q, home.r, 0);
        showToast(`🏠 ${party.name} 자동 귀환`, "exp");
      }
    } else if (allWon && !isStructureSiege && mode === "subjugate" && !leaderDead) {
      // 토벌 승리 (점령 X) — 자동 귀환 옵션 시 홈으로
      reportProgress(getState(), tables, "subjugate", 1);
      if (party.autoReturn) {
        const home = getPartyHome(party);
        moveParty(party.id, home.q, home.r, 0);
        showToast(`🏠 ${party.name} 자동 귀환`, "exp");
      }
    } else if (!allWon || leaderDead) {
      // 패배/리더사망 → 등록된 파티 홈으로 자동 귀환. HP만 풀회복 (부상 시스템 Phase 2에서 분리).
      const home = getPartyHome(party);
      moveParty(party.id, home.q, home.r, 0);
      const partyObj = getState().parties.find(p => p.id === party.id);
      for (const cid of partyObj?.slots || []) {
        if (cid == null) continue;
        const ch = getCharacter(cid);
        if (ch) { ch.hp = ch.maxHp; }   // HP만 복구 (부상 시스템 Phase 2에서 분리 예정)
      }
      showToast(leaderDead ? "💀 리더 사망 — 강제 귀환" : "❌ 패배 — 자동 귀환", "warn");
    }
    // 토벌 승리 (리더 생존): 파티는 해당 헥스에 유지 (점령 안 함)

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
      showBattleResult(hexRow, lastResult, totalWins, enemies.length, mode, ps, siegeInfo);
      // M6 우편함: 전투 결과 자동 보관
      const modeLbl = mode === "occupy" ? "점령" : "토벌";
      const resLbl = allWon ? (siegeInfo?.fell ? "함락" : "승리") : (leaderDead ? "리더 사망" : "패배");
      addMail({
        type: "battle",
        title: `${resLbl} — ${modeLbl} #${hexRow.HexID}`,
        body: `${party.name} · 웨이브 ${totalWins}/${enemies.length}`,
      });
      saveState(getState());
      worldmap.requestDraw();

      // 구조물 공성 자동 반복 — HP > 0 + 리더 생존 + occupy 모드일 때 같은 파티가 자동으로 다음 사이클
      if (isStructureSiege && allWon && !leaderDead && mode === "occupy"
          && !isStructureCaptured(structureForCombat.StructureID)) {
        const sp = getSiegeProgress(structureForCombat.StructureID, getStructureMaxHP(structureForCombat));
        if (sp.hp > 0 || getStructureMaxHP(structureForCombat) === 0) {
          // 함락되지 않은 상태 (HP>0) — 자동으로 다음 사이클 (2초 딜레이)
          setTimeout(() => {
            // 사이클 사이 안전 체크: 파티 리더 살아있는지
            const leaderId = party.slots[0];
            const leader = leaderId != null ? getCharacter(leaderId) : null;
            if (leader && leader.hp > 0 && !isStructureCaptured(structureForCombat.StructureID)) {
              executeCombat(party, hexRow, mode);
            }
          }, 2000);
        }
      }
    });
    worldmap.requestDraw();
  }

  function showBattleResult(hexRow, result, wavesWon, totalWaves, mode, screenPos, siegeInfo) {
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
        // 가문 XP 누적 → 자동 레벨업 체크 (M5-A 가문레벨)
        const lvUps = levelUpFamilyIfReady(tables);
        for (const ev of lvUps) {
          showToast(`🏰 가문 Lv${ev.from} → <b>Lv${ev.to}</b>!`, "levelup");
          // M6 우편함: 가문 레벨업 알림 자동 보관
          addMail({
            type: "levelup",
            title: `🏰 가문 Lv${ev.from} → Lv${ev.to}`,
            body: `자원 보상 자동 지급 + 새 콘텐츠 해금 가능`,
          });
        }
        // 가문 레벨 변동 시 family_level 타입 quest 즉시 평가
        if (lvUps.length > 0) {
          reportProgress(getState(), tables, "family_level", gs.family.level);
        }
        const rewardLine = [];
        if (r.gold) rewardLine.push(`골드 +${r.gold}`);
        if (r.grain) rewardLine.push(`곡물 +${r.grain}`);
        if (r.vis) rewardLine.push(`비스 +${r.vis}`);
        // 점령/토벌 시 헥스의 ResourceCode 자원에 ResourceQty 즉시 가산
        // (subjugate Lv1=1, occupy Lv1=2 ... drops.json 기반)
        if (r.resourceQty && hexRow.ResourceCode) {
          const code = hexRow.ResourceCode;
          if (!(code in gs.resources)) gs.resources[code] = 0;
          gs.resources[code] += r.resourceQty;
          const label = RES_LABEL[code] || code;
          rewardLine.push(`${label} +${r.resourceQty}`);
        }
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
              recomputeStatsFromLevel(cid, tables.fieldObjects, tables);
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

      // 공성 진행 (구조물 공격 시)
      if (siegeInfo) {
        if (siegeInfo.fell) {
          parts.push(`<span style="color:#fa4">🏰 구조물 함락! HP 0/${siegeInfo.maxHp}</span>`);
        } else if (siegeInfo.allCleared && siegeInfo.maxHp > 0) {
          parts.push(`<span style="color:#fc4">🏰 수비 전멸 → 구조물 -${siegeInfo.damage} HP (남은: ${siegeInfo.hp}/${siegeInfo.maxHp})</span>`);
        } else if (won && siegeInfo.maxHp > 0 && !siegeInfo.allCleared) {
          parts.push(`<span style="color:#aaa">수비 일부 격파 (HP 데미지는 모두 격파 후)</span>`);
        }
      }

      if (!won) {
        parts.push(`<span style="color:#e44">패배 → 거점으로 자동 귀환</span>`);
      } else if (mode === "occupy" && !siegeInfo) {
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

  // ─────── 조우형 적 처리 (GDD §5-2) ───────
  /** @param opts {skipModal: bool, onWin: fn, onLose: fn} */
  function handleEncounter(party, hexRow, enc, opts = {}) {
    const tpl = tables.encounters.get(enc.templateId);
    if (!tpl) return;
    if (tpl.MovementAI === "hidden" && !enc.discovered) {
      enc.discovered = true;
      showToast(`💀 매복! ${tpl.Name}`, "warn");
    }
    const isAmbush = tpl.Ambush === 1 || tpl.Ambush === true;
    const isFleeable = tpl.Fleeable === 1 || tpl.Fleeable === true;
    // skipModal = 이동 중 충돌 or 기습 → 즉시 전투
    if (isAmbush || opts.skipModal) {
      if (isAmbush) showToast(`⚔️ ${tpl.Name} 기습!`, "warn");
      setTimeout(() => executeEncounterBattle(party, hexRow, enc, tpl, opts), 300);
      return;
    }
    const body = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
        <div style="font-size:38px">${tpl.Icon || "⚔"}</div>
        <div>
          <div style="color:#ffd452;font-weight:bold">${tpl.Name}</div>
          <div style="font-size:12px;color:#aaa">Lv ${tpl.MinLevel}~${tpl.MaxLevel} · ${tpl.EncounterType}</div>
        </div>
      </div>
      <div style="font-size:12px;color:#bbb">
        ⚔️ 전투 — 승리 시 보상 획득<br>
        🏃 도주 — 피로 -${tpl.FleePenalty || 0} (성공률 80%)
      </div>`;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">⚔ 조우!</div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          ${isFleeable ? `<button class="modal-btn" data-action="flee">🏃 도주</button>` : ""}
          <button class="modal-btn danger" data-action="fight">⚔️ 전투</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('[data-action="fight"]').onclick = () => {
      close();
      executeEncounterBattle(party, hexRow, enc, tpl);
    };
    if (isFleeable) {
      modal.querySelector('[data-action="flee"]').onclick = () => {
        close();
        attemptFlee(party, hexRow, enc, tpl);
      };
    }
  }

  function attemptFlee(party, hexRow, enc, tpl) {
    const penalty = tpl.FleePenalty || 0;
    const success = Math.random() < 0.8;
    const members = party.slots.map(id => id != null ? getCharacter(id) : null).filter(Boolean);
    for (const ch of members) ch.fatigue = Math.max(0, ch.fatigue - penalty);
    if (success) {
      showToast(`🏃 도주 성공! 피로 -${penalty}`, "exp");
      const home = getState().family.homeHex;
      moveParty(party.id, home.q, home.r, 0);
      saveState(getState());
    } else {
      showToast(`❌ 도주 실패! 전투 돌입`, "warn");
      setTimeout(() => executeEncounterBattle(party, hexRow, enc, tpl), 300);
    }
  }

  /** 턴 종료 AI 이벤트 처리 — attack 이벤트는 자동 전투 모달 트리거. */
  function handleEncounterEvents(events) {
    if (!events || !events.length) return;
    const gs = getState();
    // 우선순위: attack > approach > wander. attack만 모달 띄움.
    const attacks = events.filter(e => e.type === "attack");
    const approaches = events.filter(e => e.type === "approach");
    if (approaches.length) {
      showToast(`👀 적 ${approaches.length}마리 접근 중`, "warn");
    }
    for (const ev of attacks) {
      const enc = gs.encounters.find(e => e.id === ev.encId);
      const party = gs.parties.find(p => p.id === ev.partyId);
      if (!enc || !party) continue;
      const hexRow = tables.worldHex.get(hexId(enc.q, enc.r));
      if (!hexRow) continue;
      // 기습: 도주 불가 즉시 전투 (GDD ambush 룰 참조)
      showToast(`⚔️ 적이 공격해옵니다!`, "warn");
      // 여러 건이면 순차 처리를 위해 setTimeout stagger
      setTimeout(() => {
        const tpl = tables.encounters.get(enc.templateId);
        if (tpl) executeEncounterBattle(party, hexRow, enc, tpl);
      }, 400);
    }
  }

  function executeEncounterBattle(party, hexRow, enc, tpl, opts = {}) {
    const enemyParty = tables.enemyParties.all().find(ep => ep.PartyID === tpl.EnemyPartyRef);
    if (!enemyParty) {
      showToast(`전투 실패: 적 편성 없음 (PartyID=${tpl.EnemyPartyRef})`, "warn");
      return;
    }
    const playerChars = party.slots.filter(id => id != null).map(id => getCharacter(id)).filter(Boolean);
    const terrain = tables.terrains.get(hexRow.TerrainID);
    const result = resolveCombat(playerChars, enemyParty, terrain, tables);
    for (const pa of result.playerAfter) {
      const ch = getCharacter(pa.id);
      if (ch) ch.hp = pa.hp;
    }
    const rounds = result?.record?.totalTurns || 1;
    const fatCost = 5 + rounds;
    for (const ch of playerChars) ch.fatigue = Math.max(0, ch.fatigue - fatCost);

    // 전투 장면 연출 — 기존 combat과 동일한 overlays.startBattleScene 재사용
    const sceneChars = playerChars.map(c => ({ spriteName: c.spriteName, name: c.name }));
    const enemySlots = [enemyParty.Slot1, enemyParty.Slot2, enemyParty.Slot3]
      .filter(Boolean)
      .map(id => {
        const etmpl = tables.fieldObjects.all().find(fo => fo.ID === id && fo.ObjectType === "Enemy");
        let sprite = etmpl?.PrefabPath ? etmpl.PrefabPath.split("/")[1] : null;
        if (!sprite || !sprite.startsWith("mon_")) sprite = pickMonsterSprite(id);
        return { spriteName: sprite, name: etmpl?.Name || `E${id}` };
      });

    overlays.startBattleScene(hexRow.HexQ, hexRow.HexR, sceneChars, enemySlots, result.win, () => {
      // 장면 종료 후 결과 반영
      if (result.win) {
        removeEncounter(enc.id);
        const dropRow = tpl.RewardDropId ? tables.drops.get(tpl.RewardDropId) : null;
        const rewards = dropRow
          ? { gold: dropRow.Gold||0, vis: dropRow.Vis||0, charExp: dropRow.CharEXP||0 }
          : { gold: 30, vis: 10, charExp: 50 };
        const gs = getState();
        gs.resources.gold = (gs.resources.gold || 0) + rewards.gold;
        gs.resources.vis = (gs.resources.vis || 0) + rewards.vis;
        if (rewards.charExp > 0) {
          for (const ch of playerChars) grantExp(ch.id, rewards.charExp, tables.characterExp);
        }
        try { reportProgress(gs, tables, "encounter_win", 1); } catch {}
        showToast(`⚔️ ${tpl.Name} 격파! +💰${rewards.gold} ✨${rewards.vis} 📘${rewards.charExp}EXP`, "levelup");
        saveState(getState());
        worldmap.requestDraw();
        opts.onWin?.();   // 승리 후 후속 처리 (예: 원래 목적지까지 계속 이동)
      } else {
        const home = getState().family.homeHex;
        moveParty(party.id, home.q, home.r, 0);
        for (const ch of playerChars) ch.hp = ch.maxHp;
        showToast(`❌ ${tpl.Name}에게 패배 — 자동 귀환`, "warn");
        saveState(getState());
        worldmap.requestDraw();
        opts.onLose?.();
      }
    });
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

  // 거점 4축 업그레이드 모달 (PatrolLv/GarrisonLv/StationedLv/DurabilityLv).
  // 원안: project_structure_battle.md (각 Lv 1~10, 거점별 독립 투자).
  function showStructureUpgradeModal(structure) {
    if (!structure) return;
    const axes = getStructureUpgradeAxes(structure);
    if (axes.length === 0) return;

    const AXIS_META = {
      PatrolLv:     { icon: "🛡", name: "경비대", desc: "기본 방어력 + 재침략 저항" },
      GarrisonLv:   { icon: "🏰", name: "수비대", desc: "수비 파티 수 + 적 Tier 보정" },
      StationedLv:  { icon: "🏕", name: "주둔",   desc: "내 분대 주둔 캡 (Lv 1~3=1, 4~6=2, 7~10=3)" },
      DurabilityLv: { icon: "💪", name: "내구도", desc: "구조물 HP (도시/관문 전용)" },
    };
    const RES_ICON = { stone: "🪨", iron: "⚒️", gold: "💰", wood: "🪵", grain: "🌾" };

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    document.body.appendChild(backdrop);

    function render() {
      const tracks = axes.map(axis => {
        const meta = AXIS_META[axis];
        const curLv = getStructureLv(structure.StructureID, axis);
        const isMax = curLv >= STRUCTURE_UPGRADE_MAX_LV;
        const cost = getStructureUpgradeCost(structure.StructureID, axis);
        const check = canUpgradeStructure(structure.StructureID, axis);
        const pct = Math.round((curLv / STRUCTURE_UPGRADE_MAX_LV) * 100);

        // 효과 미리보기 (StationedLv만 즉시 효과 표시)
        let effectPreview = "";
        if (axis === "StationedLv" && structure.StructureType === "Fort") {
          const curCap = stationedLvToCap(curLv);
          const nextCap = isMax ? curCap : stationedLvToCap(curLv + 1);
          if (nextCap > curCap) {
            effectPreview = `<span class="up-effect">📈 주둔 캡 ${curCap} → ${nextCap}</span>`;
          }
        }

        let costHtml = "";
        if (cost) {
          costHtml = Object.entries(cost).map(([res, amt]) => {
            const have = getState().resources?.[res] || 0;
            const lack = have < amt;
            return `<span class="up-res ${lack ? 'lack' : ''}">${RES_ICON[res] || res} ${amt}</span>`;
          }).join(" ");
        }

        let btnHtml = "";
        if (isMax) {
          btnHtml = `<button class="up-btn" disabled>최대 Lv</button>`;
        } else if (check.ok) {
          btnHtml = `<button class="up-btn primary" data-axis="${axis}">Lv ${curLv + 1} 업그레이드</button>`;
        } else if (check.reason === "cost") {
          btnHtml = `<button class="up-btn" disabled title="자원 부족">자원 부족</button>`;
        } else {
          btnHtml = `<button class="up-btn" disabled>${check.reason}</button>`;
        }

        return `
          <div class="up-track">
            <div class="up-track-header">
              <span class="up-icon">${meta.icon}</span>
              <span class="up-name">${meta.name} <small>(${axis})</small></span>
              <span class="up-lv">${curLv} / ${STRUCTURE_UPGRADE_MAX_LV}</span>
            </div>
            <div class="up-desc">${meta.desc}</div>
            <div class="up-progress"><div style="width:${pct}%"></div></div>
            <div class="up-action">
              <span class="up-cost">${costHtml}</span>
              ${btnHtml}
            </div>
            ${effectPreview}
          </div>
        `;
      }).join("");

      backdrop.innerHTML = `
        <div class="modal-card upgrade-modal">
          <div class="modal-title">🔧 ${structure.Name || structure.StructureType} 업그레이드</div>
          <div class="modal-body up-body">${tracks}</div>
          <div class="modal-actions">
            <button class="modal-btn" data-action="cancel">닫기</button>
          </div>
        </div>`;

      backdrop.querySelectorAll(".up-btn[data-axis]").forEach(btn => {
        btn.onclick = () => {
          const axis = btn.dataset.axis;
          const r = upgradeStructure(structure.StructureID, axis);
          if (r.ok) {
            showToast(`🔧 ${structure.Name || "거점"} ${AXIS_META[axis].name} Lv ${r.newLv}`, "exp");
            saveState(getState());
            render();  // 모달 갱신 (새 Lv/비용 반영)
          } else {
            showToast(`업그레이드 실패: ${r.reason}`, "warn");
          }
        };
      });
      backdrop.querySelector('[data-action="cancel"]').onclick = close;
    }

    function close() { backdrop.remove(); }
    backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
    render();
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
      recomputeStatsFromLevel(cid, tables.fieldObjects, tables);
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
    const home = getPartyHome(party);
    if (!home) return;
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
      // 자동 풀회복 제거. 피로는 moveParty에서 최소 10 보장.
      // 풀회복 원하면 "휴식" 버튼 사용, 피로 자연 회복은 턴 경과 시.
      showToast("🏠 집 도착 — 피로 자연 회복 시작 (턴 종료 시)", "exp");
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

  // 🧪 조우 리셋 버튼 (테스트용)
  document.getElementById("btn-reset-encounters")?.addEventListener("click", () => {
    const gs = getState();
    const before = gs.encounters.length;
    gs.encounters.length = 0;
    seedInitialEncounters();
    const after = gs.encounters.length;
    saveState(gs);
    emit("state:changed", { path: "encounters", action: "reset" });
    showToast(`🧪 조우 리셋: ${before} → ${after}마리`, "exp");
  });

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

  // ─── 턴 종료 버튼 (M4-A) ───
  const btnEndTurn = document.getElementById("btn-end-turn");
  btnEndTurn.disabled = false;
  btnEndTurn.addEventListener("click", () => {
    const gs = getState();
    const preview = computeHexIncome(gs, tables);
    const previewLines = Object.entries(preview)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, v]) => `${RES_LABEL[code] || code} +${v}`)
      .join(" · ");
    const previewText = previewLines || "수급 가능한 자원 없음";
    const minutes = CONFIG.turn?.minutesPerTurn || 10;
    showConfirm({
      title: `턴 ${gs.meta.turn} 종료`,
      body: `1턴 = ${minutes}분 환산\n\n예상 수급: ${previewText}\n\n파티 피로도가 위치에 따라 회복됩니다.`,
      confirmLabel: "턴 종료",
      onConfirm: () => {
        const summary = endTurn(getState(), tables);
        emit("state:changed", { path: "*", action: "endTurn" });
        pulseHudResources(summary.gainedResources);
        showTurnSummary(summary);
        // 조우 AI 이벤트 처리 (GDD §5-2 공격형 AI)
        handleEncounterEvents(summary.encounterEvents || []);
        // 신규 스폰 알림
        if (summary.newlySpawned?.length) {
          const types = summary.newlySpawned.map(e => {
            const tpl = tables.encounters.get(e.templateId);
            return tpl?.Icon || "⚔";
          }).join(" ");
          showToast(`🆕 신규 조우 ${summary.newlySpawned.length}체: ${types}`, "exp");
        }
      },
    });
  });

  function pulseHudResources(gained) {
    if (!gained) return;
    // HUD에 노출된 모든 자원 (10종)
    for (const code of ["grain", "iron", "wood", "stone", "herbs", "gold", "vis", "gem", "scroll", "rp"]) {
      if (!(gained[code] > 0)) continue;
      const valEl = document.getElementById(`res-${code}`);
      const chip = valEl?.parentElement;
      if (!chip) continue;
      chip.classList.remove("pulse");
      void chip.offsetWidth;
      chip.classList.add("pulse");
      setTimeout(() => chip.classList.remove("pulse"), 1000);
    }
  }

  function showTurnSummary(summary) {
    if (!summary) return;
    const gainEntries = Object.entries(summary.gainedResources)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const gainHtml = gainEntries.length
      ? gainEntries.map(([code, v]) =>
          `<span class="ts-res"><span class="res-emoji">${resEmoji(code)}</span>${RES_LABEL[code] || code} <b>+${v}</b></span>`
        ).join("")
      : `<span class="ts-empty">수급된 자원 없음</span>`;

    const recovered = summary.fatigueLog.filter(l => l.after > l.before);
    const fatigueHtml = recovered.length
      ? recovered.map(l => `<div class="ts-fat-row">${l.name} ${l.before} → <b>${l.after}</b></div>`).join("")
      : `<div class="ts-empty">회복 대상 없음</div>`;

    const body = `
      <div class="ts-section-title">자원 수급</div>
      <div class="ts-res-grid">${gainHtml}</div>
      <div class="ts-section-title">피로 회복</div>
      <div class="ts-fat-list">${fatigueHtml}</div>
    `;
    showConfirm({
      title: `턴 ${summary.fromTurn} → ${summary.toTurn}`,
      body,
      confirmLabel: "확인",
      cancelLabel: "",
      onConfirm: () => {},
    });
    // 취소 버튼 숨김 (요약은 닫기만)
    setTimeout(() => {
      const back = document.querySelector(".modal-backdrop:last-child");
      const cancelBtn = back?.querySelector('[data-action="cancel"]');
      if (cancelBtn) cancelBtn.remove();
    }, 0);
  }

  // ─── 가문 성장 패널 (M5-A) ───
  // 정식 명칭은 training.json의 Name 필드에서 추출 (예: "Fighter 훈련 1" → "Fighter 훈련")
  // 효과 설명은 EffectType/EffectType2 (gdd_family_growth_system.md §4-1 기준)
  const TRAIN_ICONS = {
    stamina: "🛡️", recovery: "💖",
    class_F: "⚔️", class_S: "🏹", class_M: "🔫", class_W: "✨", class_L: "🔮",
  };
  const TRAIN_ORDER = ["stamina", "recovery", "class_F", "class_S", "class_M", "class_W", "class_L"];

  // EffectType → 한국어 단위 라벨
  const EFFECT_LABELS = {
    maxFatigue:     "최대 피로도",
    recoveryPerMin: "분당 회복",
    ATK_PCT: "ATK", DEF_PCT: "DEF", SPD_PCT: "SPD", CRI_PCT: "CRI",
    INT_PCT: "INT", RES_PCT: "RES", PEN_PCT: "PEN",
  };
  function isPctEffect(type) { return type && type.endsWith("_PCT"); }

  /** TrainingType의 카테고리명 추출 (Lv1 행의 Name에서 " 1" 제거) */
  function getTrainingCategoryName(trainingType) {
    const lv1 = tables.training.all().find(r => r.TrainingType === trainingType && r.Level === 1);
    if (!lv1?.Name) return trainingType;
    return lv1.Name.replace(/\s*\d+$/, "");  // 끝 숫자 제거
  }

  /** EffectType+EffectType2 → "ATK +1% / DEF +0.5%" 같은 표시 문자열 */
  function formatEffectDescription(row) {
    if (!row) return "";
    const parts = [];
    const fmt = (type, value) => {
      if (!type || !value) return null;
      const label = EFFECT_LABELS[type] || type;
      const unit = isPctEffect(type) ? "%" : "";
      const sign = value > 0 ? "+" : "";
      return `${label} ${sign}${value}${unit}`;
    };
    const e1 = fmt(row.EffectType, row.EffectValue);
    const e2 = fmt(row.EffectType2, row.EffectValue2);
    if (e1) parts.push(e1);
    if (e2) parts.push(e2);
    return parts.length ? parts.join(" / ") + "/Lv" : "";
  }

  const familyPanel = document.getElementById("family-panel");
  const familyBtn = document.querySelector('#tab-dock button[data-tab="family"]');
  const wmBtn = document.querySelector('#tab-dock button[data-tab="worldmap"]');
  const familyContent = document.getElementById("family-content");

  function openFamilyPanel() {
    familyPanel.hidden = false;
    familyBtn.classList.add("active");
    wmBtn.classList.remove("active");
    renderFamilyContent("training");
  }
  function closeFamilyPanel() {
    familyPanel.hidden = true;
    familyBtn.classList.remove("active");
    wmBtn.classList.add("active");
  }

  familyBtn.addEventListener("click", () => {
    if (familyPanel.hidden) openFamilyPanel(); else closeFamilyPanel();
  });
  wmBtn.addEventListener("click", () => closeFamilyPanel());
  document.getElementById("btn-close-family").addEventListener("click", closeFamilyPanel);
  // 백드롭 클릭(카드 외부) 으로 닫기
  familyPanel.addEventListener("click", (e) => {
    if (e.target === familyPanel) closeFamilyPanel();
  });
  // ESC 키로 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !familyPanel.hidden) closeFamilyPanel();
  });

  // 서브탭 전환 (현재 훈련만 활성)
  document.querySelectorAll('#family-subtabs button').forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      document.querySelectorAll('#family-subtabs button').forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderFamilyContent(btn.dataset.sub);
    });
  });

  function renderFamilyContent(sub) {
    if (sub === "training") {
      renderTrainingTab();
    } else if (sub === "research") {
      renderGrowthTab("research", RESEARCH_META);
    } else if (sub === "fortify") {
      renderGrowthTab("fortification", FORTIFY_META);
    } else if (sub === "level") {
      renderFamilyLevelTab();
    } else {
      familyContent.innerHTML = `<div class="fp-empty">준비 중</div>`;
    }
  }

  // 연구/축성 메타 — type 키별 한국어명 + 아이콘
  // research.json ResearchType: weapon_SWD/GRT/SAB/RAP/BLT/DGR/TWN/KAT/GTL/PST/RFL/BYN/CAN/XBW/STF/ROD/WND/ORB/BRC/GRM + exploration
  const RESEARCH_META = {
    order: ["weapon_SWD", "weapon_GRT", "weapon_SAB", "weapon_RAP", "weapon_BLT",
            "weapon_DGR", "weapon_TWN", "weapon_KAT", "weapon_GTL", "weapon_PST",
            "weapon_RFL", "weapon_BYN", "weapon_CAN", "weapon_XBW",
            "weapon_STF", "weapon_ROD", "weapon_WND", "weapon_ORB",
            "weapon_BRC", "weapon_GRM", "exploration"],
    label: {
      weapon_SWD: { name: "한손검 연구", icon: "🗡️" },
      weapon_GRT: { name: "대검 연구", icon: "⚔️" },
      weapon_SAB: { name: "사브르 연구", icon: "🗡️" },
      weapon_RAP: { name: "레이피어 연구", icon: "🗡️" },
      weapon_BLT: { name: "둔기 연구", icon: "🔨" },
      weapon_DGR: { name: "단검 연구", icon: "🗡️" },
      weapon_TWN: { name: "쌍수검 연구", icon: "⚔️" },
      weapon_KAT: { name: "카타르 연구", icon: "🗡️" },
      weapon_GTL: { name: "건틀릿 연구", icon: "🥊" },
      weapon_PST: { name: "권총 연구", icon: "🔫" },
      weapon_RFL: { name: "라이플 연구", icon: "🔫" },
      weapon_BYN: { name: "바요넷 연구", icon: "🔫" },
      weapon_CAN: { name: "대포 연구", icon: "💣" },
      weapon_XBW: { name: "석궁 연구", icon: "🏹" },
      weapon_STF: { name: "지팡이 연구", icon: "🔮" },
      weapon_ROD: { name: "로드 연구", icon: "🔮" },
      weapon_WND: { name: "완드 연구", icon: "🔮" },
      weapon_ORB: { name: "오브 연구", icon: "🔮" },
      weapon_BRC: { name: "팔찌 연구", icon: "✨" },
      weapon_GRM: { name: "마도서 연구", icon: "📕" },
      exploration: { name: "탐색 장비", icon: "🧭" },
    },
  };

  // fortification.json FortType: wall / gate / durability / barracks / territory
  const FORTIFY_META = {
    order: ["wall", "gate", "durability", "barracks", "territory"],
    label: {
      wall:       { name: "성벽 강화", icon: "🧱" },
      gate:       { name: "관문 강화", icon: "🚪" },
      durability: { name: "내구도 강화", icon: "🛡️" },
      barracks:   { name: "배럭 확장", icon: "🏠" },
      territory:  { name: "영지 확장", icon: "🏰" },
    },
  };

  /**
   * 일반화된 성장 탭 렌더 — research/fortification 공용.
   * @param {"research"|"fortification"} category
   * @param {{order: string[], label: {[type]: {name, icon}}}} meta
   */
  function renderGrowthTab(category, meta) {
    const gs = getState();
    const items = meta.order.map(type => {
      const cur = getGrowthLevel(category, type);
      const next = getNextGrowthRow(category, type, tables);
      const lbl = meta.label[type] || { name: type, icon: "•" };
      const lastRow = tables[category].all().filter(r =>
        (r.ResearchType || r.FortType) === type
      ).slice(-1)[0];
      const descRow = next || lastRow;
      const desc = formatEffectDescription(descRow);

      if (!next) {
        return `<div class="train-card">
          <div class="train-icon">${lbl.icon}</div>
          <div class="train-body">
            <div class="train-name">${lbl.name} <span class="train-lv">Lv ${cur} (MAX)</span></div>
            <div class="train-desc">${desc}</div>
          </div>
        </div>`;
      }

      const check = canAffordGrowth(next);
      const costs = [];
      if (next.CostRes1 && next.CostAmt1) costs.push({ res: next.CostRes1, amt: next.CostAmt1 });
      if (next.CostRes2 && next.CostAmt2) costs.push({ res: next.CostRes2, amt: next.CostAmt2 });
      if (next.CostRes3 && next.CostAmt3) costs.push({ res: next.CostRes3, amt: next.CostAmt3 });
      const costHtml = costs.map(c => {
        const have = gs.resources[c.res] || 0;
        const lack = have < c.amt;
        const label = RES_LABEL[c.res] || c.res;
        return `<span class="train-cost ${lack ? 'lack' : ''}"><span class="res-emoji">${resEmoji(c.res)}</span>${label} ${c.amt}</span>`;
      }).join("");

      let btnLabel = `Lv ${cur + 1} 투자`;
      let tooltip = `${next.Name} (Lv ${cur} → Lv ${cur + 1})`;
      let disabled = !check.ok;
      if (check.reason === "locked") {
        btnLabel = `🔒 가문 Lv${check.unlockLv} 필요`;
        tooltip = `가문 레벨 ${check.unlockLv} 이상에서 해금`;
      } else if (check.reason === "cost") {
        const lacks = Object.entries(check.missing).map(([r, n]) => `${RES_LABEL[r] || r} ${n} 부족`).join(", ");
        tooltip = lacks;
      }

      return `<div class="train-card ${disabled ? 'disabled' : ''}" data-type="${type}">
        <div class="train-icon">${lbl.icon}</div>
        <div class="train-body">
          <div class="train-name">${lbl.name} <span class="train-lv">Lv ${cur}</span></div>
          <div class="train-desc">${desc}</div>
          <div class="train-costs">${costHtml}</div>
        </div>
        <button class="train-btn" data-invest="${type}" ${disabled ? "disabled" : ""} title="${tooltip}">${btnLabel}</button>
      </div>`;
    }).join("");

    familyContent.innerHTML = `<div class="train-list">${items}</div>`;

    familyContent.querySelectorAll('button[data-invest]').forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.invest;
        const lbl = meta.label[type] || { name: type, icon: "" };
        pushUndo(`${category} 투자: ${lbl.name}`);
        const result = investGrowth(category, type, tables);
        if (result.ok) {
          showToast(`${lbl.icon} ${result.row.Name} 투자 완료`, "exp");
          renderGrowthTab(category, meta);
          updateHud();
        } else {
          showToast(`투자 실패: ${result.reason}`, "warn");
        }
      });
    });
  }

  // 가문 시설/콘텐츠 키 → 한국어 라벨 (family_level.json Unlock 컬럼)
  const UNLOCK_LABELS = {
    barracks: "배럭 시설", recovery: "회복력 강화",
    training_ground: "훈련장", class_F: "Fighter 훈련", class_S: "Scout 훈련", class_M: "Musketeer 훈련",
    mcc_team_2: "분대 2팀", barracks_expand: "배럭 확장", exploration: "탐색",
    kitchen: "주방", smithy: "대장간",
    infirmary: "치료소", warehouse: "창고", wall: "성벽", weapon_research: "무기 연구", garrison: "수비대",
    trading_post: "교역소", lab: "연구소", outpost_2: "거점 2", class_W: "Wizard 훈련", class_L: "Warlock 훈련", gate: "관문",
    trade_system: "교역 시스템",
    management_office: "관저", mcc_team_3: "분대 3팀", awakening: "각성",
  };

  function renderFamilyLevelTab() {
    const gs = getState();
    const cur = gs.family.level || 1;
    const xp = gs.family.xp || 0;
    const curRow = tables.familyLevel.get(cur);
    const nextRow = tables.familyLevel.get(cur + 1);

    let progressHtml;
    if (nextRow) {
      const reqStart = curRow?.CumulativeXP || 0;
      const reqEnd = nextRow.CumulativeXP || 0;
      const span = Math.max(1, reqEnd - reqStart);
      const have = Math.max(0, xp - reqStart);
      const pct = Math.min(100, Math.round(have / span * 100));
      progressHtml = `
        <div class="fl-progress-label">XP ${xp} / ${reqEnd} (다음 Lv ${cur + 1}까지 <b>${reqEnd - xp}</b>)</div>
        <div class="fl-progress-bar"><div class="fl-progress-fill" style="width:${pct}%"></div></div>
      `;
    } else {
      progressHtml = `<div class="fl-progress-label">최대 레벨 달성</div>`;
    }

    // 다음 5개 레벨 해금 미리보기
    const upcoming = [];
    for (let lv = cur + 1; lv <= cur + 10 && upcoming.length < 5; lv++) {
      const row = tables.familyLevel.get(lv);
      if (!row) break;
      if (!row.Unlock) continue;
      const items = row.Unlock.split(",").map(k => UNLOCK_LABELS[k.trim()] || k.trim());
      upcoming.push(`<div class="fl-unlock-row">
        <span class="fl-unlock-lv">Lv ${lv}</span>
        <span class="fl-unlock-list">${items.join(", ")}</span>
      </div>`);
    }
    const upcomingHtml = upcoming.length
      ? `<div class="fl-section-title">앞으로 해금되는 항목</div><div class="fl-unlock-list-box">${upcoming.join("")}</div>`
      : "";

    // XP 획득 안내
    const hintHtml = `
      <div class="fl-section-title">가문 XP 획득 방법</div>
      <ul class="fl-hint">
        <li>전투 승리 (점령/토벌) 시 자동 가산 (DropTable의 FamilyEXP)</li>
        <li>점령 ★등급이 높을수록 큰 XP</li>
      </ul>
    `;

    familyContent.innerHTML = `
      <div class="fl-wrap">
        <div class="fl-current">
          <div class="fl-lv-big">가문 Lv <b>${cur}</b></div>
          ${progressHtml}
        </div>
        ${upcomingHtml}
        ${hintHtml}
      </div>
    `;
  }

  function renderTrainingTab() {
    const gs = getState();
    const items = TRAIN_ORDER.map(type => {
      const cur = getTrainingLevel(type);
      const next = getNextTrainingRow(type, tables);
      const icon = TRAIN_ICONS[type] || "•";
      const categoryName = getTrainingCategoryName(type);
      // desc는 다음 행이 있으면 다음 행 효과, 없으면 마지막 행 효과 (MAX 표시용)
      const lastRow = tables.training.all().filter(r => r.TrainingType === type).slice(-1)[0];
      const descRow = next || lastRow;
      const desc = formatEffectDescription(descRow);

      if (!next) {
        return `<div class="train-card">
          <div class="train-icon">${icon}</div>
          <div class="train-body">
            <div class="train-name">${categoryName} <span class="train-lv">Lv ${cur} (MAX)</span></div>
            <div class="train-desc">${desc}</div>
          </div>
        </div>`;
      }

      const check = canAffordTraining(next);
      const costs = [];
      if (next.CostRes1 && next.CostAmt1) costs.push({ res: next.CostRes1, amt: next.CostAmt1 });
      if (next.CostRes2 && next.CostAmt2) costs.push({ res: next.CostRes2, amt: next.CostAmt2 });
      if (next.CostRes3 && next.CostAmt3) costs.push({ res: next.CostRes3, amt: next.CostAmt3 });
      const costHtml = costs.map(c => {
        const have = gs.resources[c.res] || 0;
        const lack = have < c.amt;
        const label = RES_LABEL[c.res] || c.res;
        return `<span class="train-cost ${lack ? 'lack' : ''}"><span class="res-emoji">${resEmoji(c.res)}</span>${label} ${c.amt}</span>`;
      }).join("");

      let btnLabel = `Lv ${cur + 1} 투자`;
      let tooltip = `${next.Name} (Lv ${cur} → Lv ${cur + 1})`;
      let disabled = !check.ok;
      if (check.reason === "locked") {
        btnLabel = `🔒 가문 Lv${check.unlockLv} 필요`;
        tooltip = `가문 레벨 ${check.unlockLv} 이상에서 해금`;
      } else if (check.reason === "cost") {
        const lacks = Object.entries(check.missing).map(([r, n]) => `${RES_LABEL[r] || r} ${n} 부족`).join(", ");
        tooltip = lacks;
      }

      return `<div class="train-card ${disabled ? 'disabled' : ''}" data-type="${type}">
        <div class="train-icon">${icon}</div>
        <div class="train-body">
          <div class="train-name">${categoryName} <span class="train-lv">Lv ${cur}</span></div>
          <div class="train-desc">${desc}</div>
          <div class="train-costs">${costHtml}</div>
        </div>
        <button class="train-btn" data-invest="${type}" ${disabled ? "disabled" : ""} title="${tooltip}">${btnLabel}</button>
      </div>`;
    }).join("");

    familyContent.innerHTML = `<div class="train-list">${items}</div>`;

    // 투자 클릭
    familyContent.querySelectorAll('button[data-invest]').forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.invest;
        const categoryName = getTrainingCategoryName(type);
        pushUndo(`훈련 투자: ${categoryName}`);
        const result = investTraining(type, tables);
        if (result.ok) {
          // M5-B: 투자 직후 모든 캐릭터 stats 재계산 (maxFatigue + 병종 % 보정)
          recomputeAllCharacters(tables);
          showToast(`${TRAIN_ICONS[type] || ""} ${result.row.Name} 투자 완료`, "exp");
          // Quest 진행도: 모든 훈련 = "training", 병종 훈련 = "class_train" + class_train_level
          reportProgress(getState(), tables, "training", 1);
          if (type.startsWith("class_")) {
            reportProgress(getState(), tables, "class_train", 1);
            // class_train_level: 해당 type의 새 Lv 보고 (가장 높은 class_train Lv)
            const newLv = getTrainingLevel(type);
            reportProgress(getState(), tables, "class_train_level", newLv);
          }
          renderTrainingTab();
          updateHud();
        } else {
          showToast(`투자 실패: ${result.reason}`, "warn");
        }
      });
    });
  }

  // 자원/가문 변동 시 가문 패널 자동 갱신 (열려있을 때만)
  on("state:changed", () => {
    if (familyPanel.hidden) return;
    const active = document.querySelector('#family-subtabs button.active');
    if (!active) return;
    if (active.dataset.sub === "training") renderTrainingTab();
    else if (active.dataset.sub === "research") renderGrowthTab("research", RESEARCH_META);
    else if (active.dataset.sub === "fortify")  renderGrowthTab("fortification", FORTIFY_META);
    else if (active.dataset.sub === "level") renderFamilyLevelTab();
  });

  // ─── 임무 패널 (M6-lite) ───
  const TARGET_LABELS = {
    occupy: "헥스 점령", subjugate: "토벌", siege_gate: "관문 함락", siege_fort: "거점 함락",
    siege_any: "관문/거점 함락", kill_named: "네임드 처치", enter_region: "신규 리전 진입",
    discover_gate: "관문 발견", craft_food: "음식 제작", craft_equip: "장비 제작",
    class_train: "병종 훈련", training: "훈련 (훈련/체력/회복)",
    class_train_level: "병종 훈련 Lv 도달", facility_level: "시설 Lv 도달",
    family_level: "가문 Lv 도달", occupy_special: "특수자원 점령",
    patrol: "순찰", daily_all: "일일 전부 완료", weekly_all: "주간 전부 완료",
  };

  const questPanel = document.getElementById("quest-panel");
  const questBtn = document.querySelector('#tab-dock button[data-tab="quest"]');
  const questBadge = document.getElementById("quest-badge");
  const questContent = document.getElementById("quest-content");

  function openQuestPanel() {
    closeFamilyPanel();
    questPanel.hidden = false;
    questBtn.classList.add("active");
    wmBtn.classList.remove("active");
    renderQuestContent("chain");
  }
  function closeQuestPanel() {
    questPanel.hidden = true;
    questBtn.classList.remove("active");
    if (familyPanel.hidden) wmBtn.classList.add("active");
  }
  questBtn.addEventListener("click", () => {
    if (questPanel.hidden) openQuestPanel(); else closeQuestPanel();
  });
  wmBtn.addEventListener("click", () => closeQuestPanel());
  document.getElementById("btn-close-quest").addEventListener("click", closeQuestPanel);
  questPanel.addEventListener("click", (e) => {
    if (e.target === questPanel) closeQuestPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !questPanel.hidden) closeQuestPanel();
  });

  document.querySelectorAll('#quest-subtabs button').forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll('#quest-subtabs button').forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderQuestContent(btn.dataset.qsub);
    });
  });

  // ─────── 모집 (가챠) 탭 ───────
  const gachaPanel = document.getElementById("gacha-panel");
  const gachaBtn = document.querySelector('#tab-dock button[data-tab="gacha"]');
  const gachaContent = document.getElementById("gacha-content");
  let lastGachaResults = null; // 직전 뽑기 결과 (재렌더 시 표시 유지)

  function openGachaPanel() {
    closeFamilyPanel();
    closeQuestPanel();
    gachaPanel.hidden = false;
    gachaBtn.classList.add("active");
    wmBtn.classList.remove("active");
    renderGachaContent();
  }
  function closeGachaPanel() {
    gachaPanel.hidden = true;
    gachaBtn.classList.remove("active");
    lastGachaResults = null;
    if (familyPanel.hidden && questPanel.hidden) wmBtn.classList.add("active");
  }
  gachaBtn.addEventListener("click", () => {
    if (gachaPanel.hidden) openGachaPanel(); else closeGachaPanel();
  });
  wmBtn.addEventListener("click", () => closeGachaPanel());
  document.getElementById("btn-close-gacha")?.addEventListener("click", closeGachaPanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !gachaPanel.hidden) closeGachaPanel();
  });
  gachaPanel.addEventListener("click", (e) => {
    if (e.target === gachaPanel) closeGachaPanel();
  });

  function renderGachaContent() {
    const gs = getState();
    const gem = gs.resources?.gem || 0;
    const scroll = gs.resources?.scroll || 0;
    const cost1Gem = getGachaCost(1, "gem", tables);
    const cost10Gem = getGachaCost(10, "gem", tables);
    const cost1Scroll = getGachaCost(1, "scroll", tables);
    const cost10Scroll = getGachaCost(10, "scroll", tables);

    // 확률 표
    const rates = tables.gacha.all().filter(r => r.ConfigType === "rate")
      .sort((a, b) => a.Rate - b.Rate);

    let html = `<div class="gc-head">
      <div class="gc-res"><span>💎 젬</span><b>${gem}</b></div>
      <div class="gc-res"><span>📜 모집권</span><b>${scroll}</b></div>
    </div>`;

    // 배너 쇼케이스 — 실제 스프라이트 폴더 있는 최상급 캐릭 중 4명
    const featured = tables.fieldObjects.all()
      .filter(p => p.ObjectType === "Player" && p.Rarity >= 5 && p.PrefabPath && resolveSpriteFolder(p.PrefabPath.split("/")[1]))
      .slice(0, 4);
    html += `<div class="gc-banner">
      <div class="gc-banner-sparkle"></div>
      <div class="gc-banner-title">★ Featured</div>
      <div class="gc-banner-headline">전설의 인재 모집</div>
      <div class="gc-banner-subline">★6~7 등장 확률 1.5% · 영웅 8%</div>
      <div class="gc-silhouettes">`;
    for (const p of featured) {
      const sp = p.PrefabPath.split("/")[1];
      html += `<div class="gc-silhouette"><canvas width="64" height="80" data-portrait="${sp}" data-ko="false"></canvas></div>`;
    }
    html += `</div></div>`;

    html += `<div class="gc-buttons">
      <button class="gc-btn single" data-pulls="1" data-currency="gem" ${gem<cost1Gem?"disabled":""}>
        <div>단발</div><small>💎 ${cost1Gem}</small>
      </button>
      <button class="gc-btn ten" data-pulls="10" data-currency="gem" ${gem<cost10Gem?"disabled":""}>
        <div>10연차</div><small>💎 ${cost10Gem}</small>
      </button>
      <button class="gc-btn single scroll" data-pulls="1" data-currency="scroll" ${scroll<cost1Scroll?"disabled":""}>
        <div>단발</div><small>📜 ${cost1Scroll}</small>
      </button>
      <button class="gc-btn ten scroll" data-pulls="10" data-currency="scroll" ${scroll<cost10Scroll?"disabled":""}>
        <div>10연차</div><small>📜 ${cost10Scroll}</small>
      </button>
    </div>`;

    // 결과
    if (lastGachaResults) {
      html += `<div class="gc-results"><div class="gc-results-title">결과 ${lastGachaResults.length}명</div><div class="gc-results-grid">`;
      for (const r of lastGachaResults) {
        const color = GRADE_COLOR[r.grade];
        const kr = GRADE_KR[r.grade];
        const dupeStr = r.duplicate ? `<div class="gc-dupe">+조각 ${r.shardCount}</div>` : "";
        html += `<div class="gc-result-card grade-${r.grade}" style="border-color:${color}">
          <canvas width="48" height="48" data-portrait="${r.char?.PrefabPath?.split('/')[1] || ''}" data-ko="false"></canvas>
          <div class="gc-grade" style="color:${color}">★${r.char?.Rarity || '?'} ${kr}</div>
          <div class="gc-name">${r.char?.Name || 'N/A'}</div>
          ${dupeStr}
        </div>`;
      }
      html += `</div></div>`;
    }

    // 확률 표시
    html += `<div class="gc-rates"><div class="gc-rates-title">📊 확률 (기본 배너)</div>`;
    for (const r of rates.reverse()) {
      const color = GRADE_COLOR[r.Grade];
      html += `<div class="gc-rate-row"><span style="color:${color}">● ${GRADE_KR[r.Grade]} (${r.Remark || ''})</span><b>${r.Rate}%</b></div>`;
    }
    html += `</div>`;

    gachaContent.innerHTML = html;

    // 캔버스 초상화
    gachaContent.querySelectorAll("canvas[data-portrait]").forEach(cv => {
      if (cv.dataset.portrait) drawFacePortrait(cv, cv.dataset.portrait, false);
    });

    // 버튼 핸들러
    gachaContent.querySelectorAll(".gc-btn").forEach(btn => {
      btn.addEventListener("click", () => doGachaPull(Number(btn.dataset.pulls), btn.dataset.currency));
    });
  }

  function doGachaPull(count, currency) {
    const gs = getState();
    const cost = getGachaCost(count, currency, tables);
    if ((gs.resources[currency] || 0) < cost) {
      showToast(`${currency} 부족`, "warn");
      return;
    }
    pushUndo(`${count}연차 (${currency})`);
    spendResource(currency, cost);

    const results = [];
    for (let i = 0; i < count; i++) {
      const one = rollOnce(tables);
      if (!one.char) continue;
      // 중복 체크
      const existingIds = new Set(gs.characters.map(c => c.id));
      if (existingIds.has(one.char.ID)) {
        const shardCount = getDupeShardCount(one.grade, tables);
        addCharacterShard(one.char.ID, shardCount);
        results.push({ ...one, duplicate: true, shardCount });
      } else {
        const r = addCharacterToRoster(one.char, 1);
        results.push({ ...one, duplicate: false, addedOk: r.ok });
        // 신규 캐릭 퀘스트 진행도 (있다면)
        try { reportProgress(gs, tables, "recruit", 1); } catch {}
      }
    }
    lastGachaResults = results;
    // 스프라이트 프리로드
    const newSprites = results
      .filter(r => !r.duplicate && r.char?.PrefabPath)
      .map(r => r.char.PrefabPath.split("/")[1]);
    if (newSprites.length) preloadSprites(newSprites);
    renderGachaContent();
    // 성급 높은 거 있으면 축하 토스트
    const bestGrade = results.reduce((best, r) =>
      (["normal","high","rare","unique","legend"].indexOf(r.grade) > ["normal","high","rare","unique","legend"].indexOf(best) ? r.grade : best),
    "normal");
    if (bestGrade === "legend" || bestGrade === "unique") {
      showToast(`✨ ${GRADE_KR[bestGrade]} 획득!`, "levelup");
    }
  }

  function renderQuestContent(qtype) {
    if (qtype === "mail") {
      renderMailTab();
      return;
    }
    const gs = getState();
    if (!gs.quests) {
      questContent.innerHTML = `<div class="fp-empty">미션 데이터 미초기화</div>`;
      return;
    }
    const all = tables.quests.all().filter(q => q.QuestType === qtype);
    // chain: 활성/대기 중인 것만 + 완료된 마지막 N개
    let displayed;
    if (qtype === "chain") {
      displayed = all.filter(q => gs.quests.active.includes(q.QuestID) || gs.quests.completed.includes(q.QuestID))
        .sort((a, b) => a.QuestID - b.QuestID);
    } else {
      displayed = all.sort((a, b) => a.QuestID - b.QuestID);
    }

    if (displayed.length === 0) {
      questContent.innerHTML = `<div class="fp-empty">표시할 미션 없음</div>`;
      return;
    }

    const html = displayed.map(q => {
      const claimed = gs.quests.completed.includes(q.QuestID);
      const ready = gs.quests.readyToClaim.includes(q.QuestID);
      const cur = Math.min(gs.quests.progress[q.QuestID] || 0, q.TargetCount);
      const pct = Math.round(cur / q.TargetCount * 100);
      const targetLabel = TARGET_LABELS[q.TargetType] || q.TargetType;

      // 보상 표시
      const rewards = [];
      // 보상 표시 — 5대 물자 + 화폐 (5대 물자: grain/iron/wood/stone/herbs)
      const rwdMap = [
        ["grain",  q.RwdGrain],
        ["iron",   q.RwdIron],
        ["wood",   q.RwdWood],
        ["stone",  q.RwdStone],
        ["herbs",  q.RwdHerbs],
        ["gold",   q.RwdGold],
        ["vis",    q.RwdVis],
        ["gem",    q.RwdGem],
        ["scroll", q.RwdScroll],
      ];
      for (const [code, amt] of rwdMap) {
        if (amt) rewards.push(`<span class="qrw"><span class="res-emoji">${resEmoji(code)}</span>${amt}</span>`);
      }
      if (q.RwdFamilyEXP) rewards.push(`<span class="qrw qrw-fexp">🏰 ${q.RwdFamilyEXP}</span>`);

      let btn;
      if (claimed) {
        btn = `<button class="quest-btn done" disabled>✓ 수령 완료</button>`;
      } else if (ready) {
        btn = `<button class="quest-btn claim" data-claim="${q.QuestID}">🎁 보상 수령</button>`;
      } else {
        btn = `<button class="quest-btn" disabled>${cur} / ${q.TargetCount}</button>`;
      }

      return `<div class="quest-card ${claimed ? 'claimed' : ''} ${ready ? 'ready' : ''}">
        <div class="quest-body">
          <div class="quest-head">
            <span class="quest-title">${q.Title}</span>
            <span class="quest-target">${targetLabel} ${q.TargetCount}</span>
          </div>
          <div class="quest-desc">${q.Description}</div>
          <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${Math.min(100, pct)}%"></div></div>
          <div class="quest-rewards">${rewards.join("")}</div>
        </div>
        ${btn}
      </div>`;
    }).join("");

    questContent.innerHTML = `<div class="quest-list">${html}</div>`;

    // 보상 수령 클릭
    questContent.querySelectorAll('button[data-claim]').forEach(btn => {
      btn.addEventListener("click", () => {
        const qid = parseInt(btn.dataset.claim, 10);
        const result = claimQuestReward(getState(), tables, qid, () => levelUpFamilyIfReady(tables));
        if (result.ok) {
          const lines = [];
          if (result.rewards.familyExp) lines.push(`🏰 가문EXP +${result.rewards.familyExp}`);
          // 5대 물자 + 화폐 모두 토스트에 표시
          for (const code of ["grain", "iron", "wood", "stone", "herbs", "gold", "vis", "gem", "scroll"]) {
            const v = result.rewards[code];
            if (v) lines.push(`${resEmoji(code)} +${v}`);
          }
          showToast(`✓ 보상 수령: ${lines.join(" · ")}`, "exp");
          // 펄스도 트리거 (자원 변화 시각화)
          pulseHudResources(result.rewards);
          for (const ev of (result.levelUps || [])) {
            showToast(`🏰 가문 Lv${ev.from} → <b>Lv${ev.to}</b>!`, "levelup");
          }
          renderQuestContent(qtype);
          updateHud();
          updateQuestBadge();
        }
      });
    });
  }

  function renderMailTab() {
    const gs = getState();
    purgeExpiredMail();  // 만료 자동 정리
    const mails = gs.mailbox || [];
    if (mails.length === 0) {
      questContent.innerHTML = `<div class="fp-empty">📭 우편 없음 — 전투/레벨업 시 자동 보관됨</div>`;
      return;
    }
    const TYPE_ICON = { battle: "⚔️", levelup: "🏰", system: "📢" };
    const html = mails.map(m => {
      const icon = TYPE_ICON[m.type] || "📬";
      const turnsLeft = (m.expiresTurn || 0) - (gs.meta?.turn || 1);
      const exp = turnsLeft > 0 ? `${turnsLeft}턴 후 자동 삭제` : "곧 만료";
      return `<div class="mail-card ${m.read ? '' : 'unread'}" data-mail="${m.id}">
        <div class="mail-icon">${icon}</div>
        <div class="mail-body">
          <div class="mail-head">
            <span class="mail-title">${m.title}</span>
            <span class="mail-turn">턴 ${m.turn}</span>
          </div>
          <div class="mail-desc">${m.body || ''}</div>
          <div class="mail-foot">${exp}</div>
        </div>
        <button class="mail-del" data-mail-del="${m.id}" type="button" title="삭제">✕</button>
      </div>`;
    }).join("");

    const actions = `<div class="mail-actions">
      <button class="mail-mark-all" type="button">📖 모두 읽음</button>
    </div>`;
    questContent.innerHTML = actions + `<div class="mail-list">${html}</div>`;

    // 클릭 = 읽음 처리
    questContent.querySelectorAll('.mail-card').forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.closest('.mail-del')) return;  // 삭제 버튼은 별도
        markMailRead(el.dataset.mail);
      });
    });
    // 삭제
    questContent.querySelectorAll('button[data-mail-del]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteMail(btn.dataset.mailDel);
      });
    });
    // 모두 읽음
    questContent.querySelector('.mail-mark-all')?.addEventListener("click", () => {
      const n = markAllMailRead();
      if (n > 0) showToast(`📖 ${n}개 읽음 처리`, "exp");
    });
  }

  function updateQuestBadge() {
    const gs = getState();
    const ready = gs.quests?.readyToClaim || [];
    const unreadMail = getUnreadMailCount();
    // 하단 도크 전체 합계 (수령 가능 + 미읽음 우편)
    const n = ready.length + unreadMail;
    if (n > 0) {
      questBadge.textContent = n;
      questBadge.hidden = false;
    } else {
      questBadge.hidden = true;
    }
    // 서브탭별 카운트 (mail은 별도 카운트 — readyToClaim 아님)
    const perType = { chain: 0, daily: 0, weekly: 0, achievement: 0, mail: unreadMail };
    for (const qid of ready) {
      const q = tables.quests.get(qid);
      if (q && perType.hasOwnProperty(q.QuestType)) perType[q.QuestType]++;
    }
    document.querySelectorAll('#quest-subtabs button').forEach(btn => {
      const type = btn.dataset.qsub;
      const cnt = perType[type] || 0;
      // 기존 배지 제거 후 재삽입 (정확성)
      btn.querySelectorAll('.subtab-badge').forEach(el => el.remove());
      if (cnt > 0) {
        const b = document.createElement("span");
        b.className = "subtab-badge";
        b.textContent = cnt;
        btn.appendChild(b);
      }
    });
  }

  // 미션 진행 변동 시 패널 갱신 + 배지 업데이트
  on("state:changed", () => {
    updateQuestBadge();
    if (questPanel.hidden) return;
    const active = document.querySelector('#quest-subtabs button.active');
    if (active) renderQuestContent(active.dataset.qsub);
  });
  updateQuestBadge();

  // ─── 거점 목록 패널 ───
  const outpostPanel = document.getElementById("outpost-panel");
  const outpostContent = document.getElementById("outpost-content");
  function openOutpostPanel() {
    outpostPanel.hidden = false;
    renderOutpostList();
  }
  function closeOutpostPanel() { outpostPanel.hidden = true; }
  // 트리거 — 토글 + 외부 클릭 차단 (drop down 위치 안 닫히게)
  document.getElementById("btn-outpost-list")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (outpostPanel.hidden) openOutpostPanel(); else closeOutpostPanel();
  });
  document.getElementById("hud-outposts")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (outpostPanel.hidden) openOutpostPanel(); else closeOutpostPanel();
  });
  document.getElementById("btn-close-outpost")?.addEventListener("click", closeOutpostPanel);
  // 패널 내부 클릭은 닫히지 않게 — 외부 클릭만 닫기
  outpostPanel?.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => {
    if (!outpostPanel.hidden) closeOutpostPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !outpostPanel.hidden) closeOutpostPanel();
  });

  function renderOutpostList() {
    const gs = getState();
    // 점령된 City/Fort 모두 + 주둔 파티 매핑
    const homeHexId = gs.family.homeHex.q * 100 + gs.family.homeHex.r;
    const items = [];
    for (const sid of gs.capturedStructures || []) {
      const struct = tables.structures.get(sid);
      if (!struct) continue;
      if (struct.StructureType !== "City" && struct.StructureType !== "Fort") continue;
      // 구조물의 위치 (StructureTable에 HexQ/HexR 저장됨, 또는 worldHex 역검색)
      const hex = tables.worldHex.all().find(h => h.StructureID === sid);
      if (!hex) continue;
      const isHome = hex.HexID === homeHexId;
      // 주둔 파티 = 그 헥스에 location한 파티 + homeHex 등록 파티 (둘 다 표시)
      const presentParties = gs.parties.filter(p => p.location.q === hex.HexQ && p.location.r === hex.HexR);
      const homedParties = gs.parties.filter(p => p.homeHex && p.homeHex.q === hex.HexQ && p.homeHex.r === hex.HexR);
      items.push({ sid, struct, hex, isHome, presentParties, homedParties });
    }
    items.sort((a, b) => (b.isHome ? 1 : 0) - (a.isHome ? 1 : 0));  // 홈 도시 우선

    if (items.length === 0) {
      outpostContent.innerHTML = `<div class="fp-empty">점령한 도시/거점이 없습니다.</div>`;
      return;
    }

    const html = items.map(it => {
      const typeIcon = it.struct.StructureType === "City" ? "🏛️" : "🏰";
      const homeBadge = it.isHome ? '<span class="op-home-badge">가문 도시</span>' : "";
      // 주둔 파티 (현재 위치) 카드
      const presentHtml = it.presentParties.map(p => {
        const leader = p.slots[0] != null ? getCharacter(p.slots[0]) : null;
        const minFat = (() => {
          const m = p.slots.filter(id => id != null).map(id => getCharacter(id)).filter(Boolean);
          return m.length ? Math.round(Math.min(...m.map(x => x.fatigue / x.maxFatigue)) * 100) : 100;
        })();
        return `<div class="op-party" data-select-party="${p.id}">
          <span class="op-party-icon" style="background:${({F:'#c86464',S:'#5aaa5a',M:'#c8a03c',W:'#5a82c8',L:'#a050b4'})[leader?.jobClass]||'#888'}">${leader?.jobClass||'?'}</span>
          <span class="op-party-name">${p.name}</span>
          <span class="op-party-fat">⚡${minFat}</span>
        </div>`;
      }).join("");
      // 등록 파티 (다른 위치인 경우 — 이 거점이 홈)
      const homedNotPresent = it.homedParties.filter(hp => !it.presentParties.includes(hp));
      const homedHtml = homedNotPresent.map(p => {
        const leader = p.slots[0] != null ? getCharacter(p.slots[0]) : null;
        return `<div class="op-party op-party-away" data-select-party="${p.id}" title="배치(홈)는 여기지만 현재 출격 중">
          <span class="op-party-icon" style="background:${({F:'#c86464',S:'#5aaa5a',M:'#c8a03c',W:'#5a82c8',L:'#a050b4'})[leader?.jobClass]||'#888'}">${leader?.jobClass||'?'}</span>
          <span class="op-party-name">${p.name}</span>
          <span class="op-party-status">출격 중</span>
        </div>`;
      }).join("");
      const partiesBlock = (presentHtml || homedHtml)
        ? `<div class="op-parties">${presentHtml}${homedHtml}</div>`
        : `<div class="op-empty">주둔 파티 없음</div>`;
      return `<div class="op-card" data-go="${it.hex.HexQ},${it.hex.HexR}">
        <div class="op-head">
          <span class="op-type">${typeIcon}</span>
          <span class="op-name">${it.struct.Name || it.struct.StructureType} #${it.sid}</span>
          ${homeBadge}
          <button class="op-go-btn" data-go-cam="${it.hex.HexQ},${it.hex.HexR}" type="button" title="카메라 이동">📍</button>
        </div>
        ${partiesBlock}
      </div>`;
    }).join("");

    outpostContent.innerHTML = `<div class="op-list">${html}</div>`;

    // 카메라 이동
    outpostContent.querySelectorAll('button[data-go-cam]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [q, r] = btn.dataset.goCam.split(",").map(Number);
        const w = hexWorld(q, r);
        camera.centerOn(w.x, w.y);
        worldmap.requestDraw();
      });
    });
    // 카드 전체 클릭 = 카메라 이동
    outpostContent.querySelectorAll('.op-card').forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest('[data-select-party]') || e.target.closest('.op-go-btn')) return;
        const [q, r] = card.dataset.go.split(",").map(Number);
        const w = hexWorld(q, r);
        camera.centerOn(w.x, w.y);
        worldmap.requestDraw();
      });
    });
    // 파티 카드 클릭 = 선택
    outpostContent.querySelectorAll('[data-select-party]').forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectParty(el.dataset.selectParty);
        closeOutpostPanel();
      });
    });
  }

  // 거점 목록 자동 갱신 (열려있을 때만)
  on("state:changed", () => {
    if (outpostPanel && !outpostPanel.hidden) renderOutpostList();
  });

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
