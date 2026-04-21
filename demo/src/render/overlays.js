// Overlays: selected hex, party icons, movement path preview.
import { CONFIG } from "../config.js";
import { hexWorld } from "../util/hex.js";
import { getSpriteData, pickFrame } from "./charSprites.js";

const ISO_Y = 0.75;
const JOB_COLORS = { F: "#c86464", S: "#5aaa5a", M: "#c8a03c", W: "#5a82c8", L: "#a050b4" };

export function createOverlays() {
  const state = {
    selectedHex: null,
    parties: [],         // [{id, q, r, name, jobClass, selected}]
    pathPreview: null,   // [{q, r, cost}] or null
    animations: [],      // [{partyId, path, progress, speed, onComplete}]
    battleScene: null,   // {q, r, players, enemies, won, startMs, onDone}
    labelHits: [],       // [{partyId, x, y, w, h}] — 매 draw마다 갱신, 클릭 hit-test용
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

    // 매 draw마다 라벨 hit-test 영역 초기화
    state.labelHits = [];

    // Advance animations
    const now = performance.now();
    for (let i = state.animations.length - 1; i >= 0; i--) {
      const anim = state.animations[i];
      anim.progress += (now - (anim._lastTime || now)) / anim.speed;
      anim._lastTime = now;
      if (anim.progress >= anim.path.length - 1) {
        state.animations.splice(i, 1);
        anim.onComplete?.();
        continue;
      }
      // Draw moving party at interpolated position
      const idx = Math.floor(anim.progress);
      const frac = anim.progress - idx;
      const from = anim.path[idx], to = anim.path[idx + 1];
      const pFrom = hexWorld(from.q, from.r);
      const pTo = hexWorld(to.q, to.r);
      const wx = pFrom.x + (pTo.x - pFrom.x) * frac;
      const wy = pFrom.y + (pTo.y - pFrom.y) * frac;
      const s = camera.worldToScreen(wx, wy);
      const party = state.parties.find(p => p.id === anim.partyId);
      if (party) drawPartyIcon(ctx, s.x, s.y, size, party, "run");
    }
    if (state.animations.length > 0) requestDraw?.();

    // Party icons — offset when multiple share same hex (skip animated parties)
    const animatingIds = new Set(state.animations.map(a => a.partyId));
    const hexGroups = new Map();
    for (const party of state.parties) {
      const key = `${party.q},${party.r}`;
      if (!hexGroups.has(key)) hexGroups.set(key, []);
      hexGroups.get(key).push(party);
    }
    for (const [, group] of hexGroups) {
      const staticGroup = group.filter(p => !animatingIds.has(p.id));
      if (!staticGroup.length) continue;
      const p = hexWorld(staticGroup[0].q, staticGroup[0].r);
      const s = camera.worldToScreen(p.x, p.y);
      const count = staticGroup.length;
      for (let i = 0; i < count; i++) {
        const offsetX = count > 1 ? (i - (count - 1) / 2) * size * 0.7 : 0;
        drawPartyIcon(ctx, s.x + offsetX, s.y, size, staticGroup[i]);
      }
    }

    // 전투 연출 (월드맵 위 직접 렌더)
    drawBattleScene(ctx, camera);
  }

  function drawPartyIcon(ctx, cx, cy, hexSize, party, tagName = "idle") {
    const isSelected = party.selected;
    const portraitH = hexSize * 1.4;  // 캐릭터 도트 — 헥스보다 살짝 크게
    const baseY = cy + hexSize * 0.05;  // 발이 헥스 중심 살짝 아래

    // 선택 시 골든 후광
    if (isSelected) {
      ctx.beginPath();
      ctx.ellipse(cx, baseY, hexSize * 0.55, hexSize * 0.55 * ISO_Y, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,212,82,0.35)";
      ctx.fill();
      ctx.strokeStyle = "#ffd452";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // 그림자
      ctx.beginPath();
      ctx.ellipse(cx, baseY, hexSize * 0.4, hexSize * 0.4 * ISO_Y, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fill();
    }

    // 캐릭터 도트 애니메이션 (idle/run 태그 루프) — 우리팀은 오른쪽 바라봄 (flip)
    const data = party.spriteName ? getSpriteData(party.spriteName) : null;
    if (data && data.image.complete && data.image.naturalWidth > 0 && data.frames.length > 0) {
      const f = pickFrame(data, tagName, performance.now()) || data.frames[0];
      const aspect = f.w / f.h;
      const drawH = portraitH;
      const drawW = drawH * aspect;
      ctx.save();
      ctx.translate(cx, 0); ctx.scale(-1, 1);
      ctx.drawImage(data.image, f.x, f.y, f.w, f.h, -drawW / 2, baseY - drawH * 0.92, drawW, drawH);
      ctx.restore();
    } else {
      // Fallback: 색상 원형 + 직업 문자
      const r = Math.max(6, hexSize * 0.38);
      const color = JOB_COLORS[party.jobClass] || "#888";
      ctx.beginPath();
      ctx.arc(cx, baseY - hexSize * 0.2, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (r > 5) {
        ctx.font = `bold ${r * 1.1}px 'Segoe UI'`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.fillText(party.jobClass || "?", cx, baseY - hexSize * 0.2);
      }
    }

    // 파티 라벨 — 게임스러운 스타일 (둥근 모서리 + 그라디언트 + 골드 테두리)
    if (hexSize > 12) {
      // 캐릭터 머리 바로 위에 붙도록 조금 내림
      const labelY = baseY - portraitH * 0.85;
      const nameFontSize = Math.max(9, hexSize * 0.28);
      const statusFontSize = Math.max(8, hexSize * 0.22);

      // 상태 색상 팔레트
      const statusColor = {
        "대기": "#8fdb7c", "주둔": "#9cd070", "행군": "#7ab8ff",
        "전투": "#ff6b6b", "귀환": "#ffc96b",
      }[party.statusLabel] || "#ccc";
      const accentColor = isSelected ? "#ffd452" : "#c8a848";

      // 패널 크기 (이름 + 상태)
      ctx.font = `bold ${nameFontSize}px 'Segoe UI'`;
      const nameW = ctx.measureText(party.name).width;
      const panelW = Math.max(nameW + 18, hexSize * 1.15);
      const panelH = nameFontSize + statusFontSize + 10;
      const panelX = cx - panelW / 2;
      const panelY = labelY - panelH - 6;
      const radius = Math.min(6, panelH * 0.3);

      // 클릭 영역 등록 (피로 바까지 포함, 살짝 여유)
      const hitH = panelH + (party.fatiguePct != null ? Math.max(4, hexSize * 0.13) + 4 : 6);
      state.labelHits.push({
        partyId: party.id,
        x: panelX - 2, y: panelY - 2,
        w: panelW + 4, h: hitH,
      });

      // 1) 그림자 (depth)
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;

      // 2) 배경 그라디언트 (어두운 앰버-브라운)
      const bgGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
      bgGrad.addColorStop(0, "rgba(44,30,18,0.95)");
      bgGrad.addColorStop(1, "rgba(20,14,10,0.95)");
      ctx.fillStyle = bgGrad;
      roundRectFill(ctx, panelX, panelY, panelW, panelH, radius);

      ctx.restore();

      // 3) 골드 테두리 + 내부 하이라이트
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = isSelected ? 2 : 1.2;
      roundRectStroke(ctx, panelX, panelY, panelW, panelH, radius);

      // 내부 상단 하이라이트 (광택)
      const highlight = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH * 0.4);
      highlight.addColorStop(0, "rgba(255,220,130,0.15)");
      highlight.addColorStop(1, "rgba(255,220,130,0)");
      ctx.fillStyle = highlight;
      roundRectFill(ctx, panelX + 1, panelY + 1, panelW - 2, panelH * 0.5, radius - 1);

      // 4) 이름 (골드 섀도우)
      ctx.font = `bold ${nameFontSize}px 'Segoe UI'`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 3;
      ctx.fillStyle = isSelected ? "#ffe890" : "#ffebb0";
      ctx.fillText(party.name, cx, panelY + 3);
      ctx.shadowBlur = 0;

      // 5) 상태 라벨 (색상 + 작은 dot)
      if (party.statusLabel) {
        const statusY = panelY + nameFontSize + 4;
        // dot
        ctx.beginPath();
        ctx.arc(cx - ctx.measureText(party.statusLabel).width / 2 - 5, statusY + statusFontSize * 0.5, statusFontSize * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();
        // 텍스트
        ctx.font = `bold ${statusFontSize}px 'Segoe UI'`;
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 2;
        ctx.fillStyle = statusColor;
        ctx.fillText(party.statusLabel, cx, statusY);
        ctx.shadowBlur = 0;
      }

      // 6) 피로 바 — 패널 하단 가장자리에 끼워넣기
      if (party.fatiguePct != null) {
        const barW = panelW - 8;
        const barH = Math.max(4, hexSize * 0.13);
        const barX = cx - barW / 2;
        const barY = labelY - 2 - barH;
        const pct = party.fatiguePct;
        const fatColor = pct <= 20 ? "#ff5555" : pct <= 40 ? "#ffaa44" : pct <= 70 ? "#66bbcc" : "#4aa0d8";

        // 배경 홈
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        roundRectFill(ctx, barX, barY, barW, barH, barH * 0.4);
        // 진행
        const fillW = (pct / 100) * (barW - 2);
        if (fillW > 0) {
          const barGrad = ctx.createLinearGradient(barX, barY, barX, barY + barH);
          barGrad.addColorStop(0, lightenColor(fatColor, 0.3));
          barGrad.addColorStop(1, fatColor);
          ctx.fillStyle = barGrad;
          roundRectFill(ctx, barX + 1, barY + 1, fillW, barH - 2, (barH - 2) * 0.4);
        }
        // 테두리
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.lineWidth = 0.8;
        roundRectStroke(ctx, barX, barY, barW, barH, barH * 0.4);
      }
    }
  }

  // 둥근 모서리 rect 헬퍼
  function roundRectFill(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }
  function roundRectStroke(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.stroke();
  }
  function lightenColor(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amount));
    const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * amount));
    const b = Math.min(255, (n & 0xff) + Math.round(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  /** 화면 좌표(sx, sy)가 어떤 파티 라벨 영역에 들어있는지 반환 (가장 위에 그려진 것 우선). */
  function hitTestLabel(sx, sy) {
    // 마지막 push가 가장 위에 그려진 것 → 역순 검사
    for (let i = state.labelHits.length - 1; i >= 0; i--) {
      const h = state.labelHits[i];
      if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) {
        return h.partyId;
      }
    }
    return null;
  }

  function setSelected(q, r) { state.selectedHex = { q, r }; }
  function clearSelected() { state.selectedHex = null; }
  function setParties(parties) { state.parties = parties; }
  function setPathPreview(path) { state.pathPreview = path; }
  function clearPathPreview() { state.pathPreview = null; }

  let requestDraw = null;
  function setRequestDraw(fn) { requestDraw = fn; }

  // Animate party movement along a path. speed = ms per hex step.
  function animateParty(partyId, path, speed, onComplete) {
    // Remove any existing animation for this party
    state.animations = state.animations.filter(a => a.partyId !== partyId);
    state.animations.push({
      partyId, path, progress: 0, speed,
      _lastTime: performance.now(), onComplete,
    });
    requestDraw?.();
  }

  function isAnimating() { return state.animations.length > 0; }

  // ─────── 인플레이스 전투 연출 ───────
  const SCENE_TOTAL = 1800, SCENE_POPIN = 300, SCENE_CLASH = 1300;

  function startBattleScene(q, r, players, enemies, won, onDone) {
    state.battleScene = { q, r, players, enemies, won, startMs: performance.now(), onDone };
    requestDraw?.();
  }

  function drawSpriteAnim(c, cx, cy, targetH, spriteName, tagName, flip) {
    const data = spriteName ? getSpriteData(spriteName) : null;
    if (!data || !data.image.complete || data.frames.length === 0) {
      c.fillStyle = flip ? "rgba(160,80,80,0.85)" : "rgba(80,140,200,0.85)";
      c.fillRect(cx - targetH * 0.3, cy - targetH, targetH * 0.6, targetH);
      return;
    }
    const f = pickFrame(data, tagName, performance.now()) || data.frames[0];
    const aspect = f.w / f.h;
    const dw = targetH * aspect, dh = targetH;
    c.save();
    if (flip) {
      c.translate(cx, 0); c.scale(-1, 1);
      c.drawImage(data.image, f.x, f.y, f.w, f.h, -dw / 2, cy - dh, dw, dh);
    } else {
      c.drawImage(data.image, f.x, f.y, f.w, f.h, cx - dw / 2, cy - dh, dw, dh);
    }
    c.restore();
  }

  function drawBattleScene(c, camera) {
    const sc = state.battleScene;
    if (!sc) return;
    const elapsed = performance.now() - sc.startMs;
    const p = hexWorld(sc.q, sc.r);
    const screen = camera.worldToScreen(p.x, p.y);
    const hexSize = (CONFIG.hex.W / 2) * camera.scale;
    const baseY = screen.y + hexSize * 0.05;
    const spacing = hexSize * 0.55;

    const popT = Math.min(1, elapsed / SCENE_POPIN);
    const enemyDropY = (1 - popT) * -hexSize * 0.8;
    const playerOffsetX = (1 - popT) * -hexSize * 0.5;
    const inClash = elapsed >= SCENE_POPIN && elapsed < SCENE_CLASH;
    const fadeOut = elapsed > SCENE_CLASH ? 1 - (elapsed - SCENE_CLASH) / (SCENE_TOTAL - SCENE_CLASH) : 1;

    // 비네팅
    const radius = hexSize * 4 * popT * fadeOut;
    if (radius > 0) {
      const grad = c.createRadialGradient(screen.x, baseY, hexSize * 0.5, screen.x, baseY, radius);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.7, `rgba(0,0,0,${0.35 * fadeOut})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = grad;
      c.fillRect(screen.x - radius, baseY - radius, radius * 2, radius * 2);
    }

    c.globalAlpha = fadeOut;
    const tag = inClash ? "attack" : "idle";
    // 아군(좌) → 오른쪽 바라봄 (flip), 적(우) → 왼쪽 바라봄 (스프라이트 기본)
    for (let i = 0; i < sc.players.length; i++) {
      const cx = screen.x - spacing * 1.5 + i * spacing * 0.4 + playerOffsetX;
      drawSpriteAnim(c, cx, baseY, hexSize * 1.0, sc.players[i].spriteName, tag, true);
    }
    for (let i = 0; i < sc.enemies.length; i++) {
      const cx = screen.x + spacing * 1.5 - i * spacing * 0.4;
      drawSpriteAnim(c, cx, baseY + enemyDropY, hexSize * 1.0, sc.enemies[i].spriteName, tag, false);
    }
    c.globalAlpha = 1;

    // 충돌 — 검 X자 + 스파크 + 화이트 플래시
    if (inClash) {
      const ct = (elapsed - SCENE_POPIN) / (SCENE_CLASH - SCENE_POPIN);
      // 0~0.3: 검이 X자로 빠르게 들어옴, 0.3~0.7: 충돌+스파크, 0.7~: 페이드
      const swordPhase = Math.min(1, ct * 3);          // 0~1 sword approach
      const sparkPhase = Math.max(0, Math.min(1, (ct - 0.25) * 4));
      const flashPulse = Math.max(0, Math.sin(ct * Math.PI * 6) * (1 - ct));

      // 화이트 펄스 플래시 (3~4번 강하게)
      if (flashPulse > 0) {
        const fr = hexSize * 2.2;
        const fg = c.createRadialGradient(screen.x, baseY, 0, screen.x, baseY, fr);
        fg.addColorStop(0, `rgba(255,255,240,${flashPulse * 0.9})`);
        fg.addColorStop(0.4, `rgba(255,220,140,${flashPulse * 0.5})`);
        fg.addColorStop(1, "rgba(255,80,0,0)");
        c.fillStyle = fg;
        c.beginPath(); c.arc(screen.x, baseY, fr, 0, Math.PI * 2); c.fill();
      }

      // ⚔️ 칼 아이콘 + 충격파 링
      if (swordPhase > 0) {
        const slashCx = screen.x, slashCy = baseY - hexSize * 0.3;
        c.save();

        // 충격파 링 (확장)
        const ringR = hexSize * (0.5 + swordPhase * 1.6);
        const ringAlpha = (1 - swordPhase) * 0.9;
        c.strokeStyle = `rgba(255,250,200,${ringAlpha})`;
        c.lineWidth = Math.max(2, hexSize * 0.15 * (1 - swordPhase * 0.5));
        c.beginPath(); c.arc(slashCx, slashCy, ringR, 0, Math.PI * 2); c.stroke();

        // ⚔️ 이모지 (스케일 바운스: 0→1.5→1.0)
        let iconScale;
        if (swordPhase < 0.4) iconScale = (swordPhase / 0.4) * 1.5;
        else if (swordPhase < 0.7) iconScale = 1.5 - ((swordPhase - 0.4) / 0.3) * 0.5;
        else iconScale = 1.0;
        const iconSize = hexSize * 1.5 * iconScale;
        const iconAlpha = Math.min(1, swordPhase * 3) * (1 - Math.max(0, (swordPhase - 0.7) / 0.3) * 0.4);
        c.font = `${iconSize}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
        c.textAlign = "center"; c.textBaseline = "middle";
        c.shadowColor = "rgba(0,0,0,0.85)";
        c.shadowBlur = Math.max(4, hexSize * 0.2);
        c.globalAlpha = iconAlpha;
        c.fillText("⚔️", slashCx, slashCy);
        c.shadowBlur = 0;
        c.globalAlpha = 1;
        c.restore();
      }

      // 스파크 (충돌 지점에서 8방향 단단한 점)
      if (sparkPhase > 0) {
        const sparkCx = screen.x, sparkCy = baseY - hexSize * 0.3;
        c.save();
        const SPARKS = 12;
        for (let i = 0; i < SPARKS; i++) {
          const ang = (i / SPARKS) * Math.PI * 2;
          const dist = hexSize * 0.4 + sparkPhase * hexSize * 1.0;
          const x = sparkCx + Math.cos(ang) * dist;
          const y = sparkCy + Math.sin(ang) * dist * ISO_Y;
          const r = Math.max(1, hexSize * 0.12 * (1 - sparkPhase));
          c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
          c.fillStyle = `rgba(255,${200 + Math.floor(55 * (1 - sparkPhase))},80,${1 - sparkPhase})`;
          c.fill();
        }
        c.restore();
      }
    }

    // 결과 텍스트 — 뿅 등장 (스케일 바운스 + 글로우)
    if (elapsed > SCENE_CLASH) {
      const tt = (elapsed - SCENE_CLASH) / (SCENE_TOTAL - SCENE_CLASH);
      // 스케일 바운스: 0→1.4→1.0 (overshoot)
      let scale;
      if (tt < 0.2) {
        const t = tt / 0.2;
        scale = t * 1.4;
      } else if (tt < 0.4) {
        const t = (tt - 0.2) / 0.2;
        scale = 1.4 - t * 0.4;
      } else {
        scale = 1.0;
      }
      const a = Math.min(1, tt * 4) * Math.sin(Math.min(1, (1 - tt) * 2 + 0.5) * Math.PI / 2);
      const fontSize = Math.max(20, hexSize * 1.0) * scale;
      c.save();
      c.font = `900 ${fontSize}px 'Segoe UI'`;
      c.textAlign = "center"; c.textBaseline = "middle";
      const tx = screen.x, ty = screen.y - hexSize * 1.4;
      // 외곽 글로우
      c.shadowColor = sc.won ? "rgba(255,212,82,0.95)" : "rgba(255,80,80,0.95)";
      c.shadowBlur = 24 * scale;
      c.fillStyle = sc.won ? `rgba(255,240,160,${a})` : `rgba(255,160,160,${a})`;
      c.fillText(sc.won ? "VICTORY" : "DEFEAT", tx, ty);
      // 검정 외곽선
      c.shadowBlur = 0;
      c.strokeStyle = `rgba(0,0,0,${a})`;
      c.lineWidth = Math.max(2, fontSize * 0.06);
      c.strokeText(sc.won ? "VICTORY" : "DEFEAT", tx, ty);
      // 본체
      c.fillStyle = sc.won ? `rgba(255,212,82,${a})` : `rgba(255,80,80,${a})`;
      c.fillText(sc.won ? "VICTORY" : "DEFEAT", tx, ty);
      c.restore();
    }

    if (elapsed >= SCENE_TOTAL) {
      const onDone = sc.onDone;
      state.battleScene = null;
      onDone?.();
    } else {
      requestDraw?.();
    }
  }

  return {
    draw, setSelected, clearSelected, setParties, setPathPreview, clearPathPreview,
    animateParty, isAnimating, setRequestDraw, startBattleScene, state,
    hitTestLabel,
  };
}
