// 전투 연출 모달 — 3v3 face-off, attack 애니메이션, 승/패 이펙트.
// onDone() 콜백으로 후속 처리(결과 팝업 등) 트리거.
import { getSpriteData, pickFrame } from "../render/charSprites.js";

const SCENE_DURATION_MS = 2400;   // 전체 연출 시간
const ATTACK_PHASE_MS = 1600;     // attack 동작 구간
const RESULT_FLASH_MS = 800;      // 승/패 플래시

let canvas = null, ctx = null, container = null;
let activeScene = null;

function ensureLayer() {
  if (canvas) return;
  container = document.createElement("div");
  container.id = "battle-scene";
  container.style.cssText =
    "position:absolute;inset:0;z-index:50;pointer-events:none;display:flex;" +
    "align-items:center;justify-content:center;background:rgba(0,0,0,0.55);" +
    "opacity:0;transition:opacity 0.2s;";
  canvas = document.createElement("canvas");
  canvas.style.cssText = "image-rendering:pixelated;max-width:90vw;max-height:70vh;";
  container.appendChild(canvas);
  ctx = canvas.getContext("2d");
  document.body.appendChild(container);
}

/**
 * 전투 연출 시작.
 * @param {object[]} playerChars  현재 파티 캐릭터 (id/name/spriteName/hp/maxHp)
 * @param {object[]} enemyTemplates EnemyParty 슬롯의 FieldObject 템플릿 (Name, PrefabPath 등)
 * @param {boolean} won
 * @param {function} onDone 연출 종료 콜백
 */
export function playBattleScene(playerChars, enemyTemplates, won, onDone) {
  ensureLayer();

  const W = 720, H = 320;
  canvas.width = W; canvas.height = H;
  container.style.opacity = "1";

  // 적 sprite name 추출 (FieldObject Name → 폴더명, 또는 mon_ 접두 추정)
  const enemySprites = enemyTemplates.map(t => {
    if (!t) return null;
    if (t.PrefabPath) return t.PrefabPath.split("/")[1];
    // PrefabPath 없으면 Name으로 추정 (몬스터)
    return t.SpriteName || null;
  });

  const startMs = performance.now();
  activeScene = { startMs, playerChars, enemyTemplates, enemySprites, won, onDone };
  requestAnimationFrame(tick);
}

function tick(now) {
  if (!activeScene) return;
  const { startMs, playerChars, enemyTemplates, enemySprites, won, onDone } = activeScene;
  const elapsed = now - startMs;

  // Background
  ctx.fillStyle = "#1a1612";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 그라디언트 배경
  const g = ctx.createLinearGradient(0, 0, canvas.width, 0);
  g.addColorStop(0, "rgba(40,80,40,0.4)");
  g.addColorStop(0.5, "rgba(0,0,0,0.0)");
  g.addColorStop(1, "rgba(80,40,40,0.4)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // VS 텍스트
  ctx.font = "bold 36px 'Segoe UI'";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "#000"; ctx.shadowBlur = 8;
  ctx.fillText("VS", canvas.width / 2, canvas.height / 2 - 30);
  ctx.shadowBlur = 0;

  // attack phase: attackers play "attack" tag, others "idle"
  // 0~400ms: 양측 idle, 400~1600ms: attack 모션, 1600~ : idle
  const attackerTag = (elapsed > 400 && elapsed < ATTACK_PHASE_MS) ? "attack" : "idle";

  // 플레이어 (좌측) 3명 — 오른쪽을 바라봄 (정상)
  const slotW = 160;
  const py = canvas.height / 2 + 30;
  for (let i = 0; i < 3; i++) {
    const ch = playerChars[i];
    if (!ch) continue;
    const px = 70 + i * 50;
    drawSprite(ch.spriteName, px, py, attackerTag, /*flip*/ false);
    // HP 바
    drawHpBar(px, py + 80, 60, ch.hp, ch.maxHp);
  }

  // 적 (우측) 3명 — 왼쪽을 바라봄 (flip)
  for (let i = 0; i < 3; i++) {
    const tmpl = enemyTemplates[i];
    if (!tmpl) continue;
    const ex = canvas.width - 70 - i * 50;
    drawSprite(enemySprites[i], ex, py, attackerTag, /*flip*/ true);
    const eHp = tmpl._hp ?? 100;
    const eMax = tmpl._maxHp ?? 100;
    drawHpBar(ex, py + 80, 60, eHp, eMax);
  }

  // 결과 플래시 (마지막 800ms)
  if (elapsed > SCENE_DURATION_MS - RESULT_FLASH_MS) {
    const flashT = (elapsed - (SCENE_DURATION_MS - RESULT_FLASH_MS)) / RESULT_FLASH_MS;
    const alpha = Math.sin(flashT * Math.PI) * 0.5;
    ctx.fillStyle = won ? `rgba(255,212,82,${alpha})` : `rgba(220,40,40,${alpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = "bold 64px 'Segoe UI'";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "#000"; ctx.shadowBlur = 12;
    ctx.fillStyle = won ? "#ffd452" : "#ff6464";
    ctx.fillText(won ? "VICTORY" : "DEFEAT", canvas.width / 2, canvas.height / 2);
    ctx.shadowBlur = 0;
  }

  if (elapsed >= SCENE_DURATION_MS) {
    container.style.opacity = "0";
    setTimeout(() => { activeScene = null; onDone?.(); }, 200);
    return;
  }
  requestAnimationFrame(tick);
}

function drawSprite(name, cx, cy, tagName, flip) {
  const data = name ? getSpriteData(name) : null;
  const targetH = 110;
  if (!data || !data.image.complete || data.frames.length === 0) {
    // 폴백: 색상 사각형
    ctx.fillStyle = flip ? "#a04040" : "#4080a0";
    ctx.fillRect(cx - 30, cy - targetH, 60, targetH);
    return;
  }
  const f = pickFrame(data, tagName, performance.now()) || data.frames[0];
  const aspect = f.w / f.h;
  const dw = targetH * aspect;
  const dh = targetH;
  ctx.save();
  if (flip) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(data.image, f.x, f.y, f.w, f.h, -dw / 2, cy - dh, dw, dh);
  } else {
    ctx.drawImage(data.image, f.x, f.y, f.w, f.h, cx - dw / 2, cy - dh, dw, dh);
  }
  ctx.restore();
}

function drawHpBar(cx, cy, w, hp, maxHp) {
  const pct = Math.max(0, hp / Math.max(1, maxHp));
  ctx.fillStyle = "#222";
  ctx.fillRect(cx - w / 2, cy, w, 6);
  ctx.fillStyle = pct > 0.5 ? "#5a5" : pct > 0.25 ? "#da2" : "#e44";
  ctx.fillRect(cx - w / 2, cy, w * pct, 6);
}
