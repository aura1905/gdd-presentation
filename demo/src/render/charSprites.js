// 캐릭터 도트 스프라이트 + 프레임/태그 메타 로더.
// 각 캐릭터: assets/sprites/<name>/sprite.png (가로 스트립) + frames.json
// frames.json:
//   { frames: { "0": {frame:{x,y,w,h}, duration: ms}, ... },
//     meta:   { size:{w,h}, frameCount, tags: [{name, from, to, direction}] } }
//
// 사용:
//   const data = getSpriteData("fighter_f");
//   const f = pickFrame(data, "idle", performance.now());
//   ctx.drawImage(data.image, f.x, f.y, f.w, f.h, dx, dy, dw, dh);

const dataCache = new Map();   // lowercase folder → { image, meta, frames, tagIndex }
const aliasMap = new Map();
let resolved = false;

const KNOWN_FOLDERS = [
  "Adelina_F","Alejandro_M","Andre_M","Berneli_F","Brunie_F","Calyce_F",
  "Catherine_F","Claude_M","Coimbra_Trooper_M","Corthasar_M","Daria_F","Emilia_F",
  "Garcia_M","Gracielo_M","Idge_F","Jack_M","Leonele_M","Lorch_M",
  "M'Boma_M","Musketeer_F","Musketeer_M","Natalie_F","Panfilo_M","Raven_M",
  "Rio_M","Scout_F","Scout_M","Soho_M","Soldier_Reboldoeux_M","Tiburon_M",
  "Valeria_F","Warlock_F","Warlock_M","fighter_F","fighter_M","fighter_boy",
  "fighter_boy_256","lisa_F","wizard_F","wizard_M",
  "mon_Bandit_leader","mon_Basilisk","mon_Centaur","mon_Dingo","mon_Flying_Sickle",
  "mon_Ghost_Baron","mon_Ghostly_Father","mon_Ghostly_flammer","mon_Grim_Ripper",
  "mon_HoneySpider","mon_Hydrobomber","mon_Jormongand","mon_Jumping_Croc",
  "mon_Jumping_Fish","mon_Leviathan","mon_Merman","mon_Merman_Eater",
  "mon_Necromancer","mon_Saber_Boar","mon_Scorpion","mon_Skeleton_Soldier",
  "mon_Treasure_Golem","mon_bat","mon_blizzard_revenant","mon_cerberus",
  "mon_death_knight","mon_deer","mon_gargoyle","mon_ghost_sailor","mon_griffon",
  "mon_hill_giant","mon_jabberwock","mon_jellyfish","mon_medusa","mon_pirate_soldier",
  "mon_scissors_beetle","mon_skeleton","mon_smuggler","mon_sneak","mon_spider",
  "mon_white_wolf","mon_wild_boar","mon_wolf_king","mon_zealot","mon_zombi",
];

function resolveAlias() {
  if (resolved) return;
  for (const f of KNOWN_FOLDERS) aliasMap.set(f.toLowerCase(), f);
  resolved = true;
}

export function resolveSpriteFolder(name) {
  resolveAlias();
  if (!name) return null;
  return aliasMap.get(name.toLowerCase()) || null;
}

function loadOne(folder) {
  const key = folder.toLowerCase();
  if (dataCache.has(key)) return dataCache.get(key);

  // 즉시 빈 데이터 등록 (image 로드 시작) → 같은 sprite 중복 fetch 방지
  const img = new Image();
  const data = { image: img, meta: null, frames: [], tagIndex: new Map() };
  dataCache.set(key, data);

  img.src = `assets/sprites/${folder}/sprite.png`;
  fetch(`assets/sprites/${folder}/frames.json`)
    .then(r => r.ok ? r.json() : null)
    .then(meta => {
      if (!meta?.frames) return;
      const keys = Object.keys(meta.frames).sort((a, b) => +a - +b);
      for (const k of keys) {
        const f = meta.frames[k];
        data.frames.push({ ...f.frame, duration: f.duration || 100 });
      }
      if (meta.meta?.tags) {
        for (const t of meta.meta.tags) data.tagIndex.set(t.name.toLowerCase(), t);
      }
      data.meta = meta;
    })
    .catch(() => {});
  return data;
}

function loadOneAsync(folder) {
  loadOne(folder);
  const key = folder.toLowerCase();
  const data = dataCache.get(key);
  return new Promise((resolve) => {
    if (data.image.complete && data.frames.length > 0) return resolve();
    let done = false;
    const check = () => {
      if (done) return;
      if (data.image.complete && data.frames.length > 0) { done = true; resolve(); }
    };
    data.image.onload = check;
    // 폴링 fallback
    const iv = setInterval(() => { if (data.frames.length > 0) check(); if (done) clearInterval(iv); }, 50);
    setTimeout(() => { if (!done) { done = true; clearInterval(iv); resolve(); } }, 5000);
  });
}

export async function preloadSprites(names) {
  const folders = [...new Set(names.filter(Boolean).map(resolveSpriteFolder).filter(Boolean))];
  await Promise.all(folders.map(loadOneAsync));
}

export function getSpriteData(name) {
  const folder = resolveSpriteFolder(name);
  if (!folder) return null;
  const key = folder.toLowerCase();
  if (!dataCache.has(key)) {
    // 지연 로드 — 캐시 미스 시 백그라운드에서 fetch (다음 프레임부터 사용 가능)
    loadOne(folder);
  }
  return dataCache.get(key) || null;
}

/** 현재 시간 기준으로 태그의 프레임을 선택. tagName 없으면 전체 첫 프레임. */
export function pickFrame(data, tagName, nowMs) {
  if (!data || data.frames.length === 0) return null;
  let from = 0, to = data.frames.length - 1, direction = "forward";
  if (tagName) {
    const tag = data.tagIndex.get(tagName.toLowerCase());
    if (tag) { from = tag.from; to = tag.to; direction = tag.direction || "forward"; }
  }
  const slice = data.frames.slice(from, to + 1);
  if (slice.length === 0) return data.frames[0];

  // 태그 전체 길이(ms)와 누적 duration 계산
  const total = slice.reduce((s, f) => s + f.duration, 0);
  if (total <= 0) return slice[0];

  let t = nowMs % total;
  if (direction === "reverse") t = total - 1 - t;
  // pingpong 처리 (간단화)

  let acc = 0;
  for (const f of slice) {
    acc += f.duration;
    if (t < acc) return f;
  }
  return slice[slice.length - 1];
}

/** 호환용: 단순 이미지만 필요한 경우. */
export function getSpriteImage(name) {
  const data = getSpriteData(name);
  return data?.image || null;
}
