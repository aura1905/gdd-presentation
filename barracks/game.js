// ============================================================
// GE 개척시대 — 배럭 라이프 프로토타입 (Part 1: Core + Data)
// ============================================================

// === PIXEL SPRITE DEFINITIONS ===
// Each sprite is a small pixel grid drawn on canvas (no external assets needed)
const PALETTE = {
    skin: '#f0c8a0', skinDark: '#d0a070', hair: '#4a3020', hairLight: '#6a4838',
    shirt: '#4060a0', shirtLight: '#5080c0', pants: '#3a3050', boot: '#2a2030',
    white: '#f0e8d8', gold: '#f0c040', red: '#d04050', green: '#50c878',
    blue: '#5090d0', wood: '#8a6040', woodDark: '#604020', stone: '#808888',
    roof: '#a04030', roofDark: '#803020', smoke: '#c0b8b0', fire: '#f08020',
    water: '#4080c0', grass: '#408040', grassLight: '#60a860', dirt: '#907050',
    dirtDark: '#705030', sky1: '#1a2848', sky2: '#2a3858', sky3: '#3a4868',
};

// === CHARACTER DATABASE ===
const CHARACTERS = [
    {
        id: 'fighter_m', name: '파이터(남)', stars: 3, role: 'Fighter', job: '사냥꾼', jobGrade: 'A',
        colors: { hair: '#3a2818', shirt: '#805030', pants: '#4a3828' }, fatigue: 72
    },
    {
        id: 'emilia', name: '에밀리아', stars: 4, role: 'Healer', job: '의무관', jobGrade: 'S',
        colors: { hair: '#d0a040', shirt: '#f0f0f0', pants: '#6070a0' }, fatigue: 85
    },
    {
        id: 'garcia', name: '가르시아', stars: 3, role: 'Shooter', job: '사냥꾼', jobGrade: 'B',
        colors: { hair: '#2a2020', shirt: '#304080', pants: '#3a3040' }, fatigue: 60
    },
    {
        id: 'panfilo', name: '판필로', stars: 2, role: 'Fighter', job: '요리사', jobGrade: 'S',
        colors: { hair: '#604830', shirt: '#f0f0f0', pants: '#504838' }, fatigue: 90
    },
    {
        id: 'lisa', name: '리사', stars: 3, role: 'Caster', job: '채집꾼', jobGrade: 'A',
        colors: { hair: '#a06030', shirt: '#60a060', pants: '#4a5040' }, fatigue: 78
    },
    {
        id: 'jack', name: '잭', stars: 2, role: 'Fighter', job: '대장장이', jobGrade: 'S',
        colors: { hair: '#2a2028', shirt: '#705040', pants: '#3a3030' }, fatigue: 65
    },
    {
        id: 'vincent', name: '빈센트', stars: 3, role: 'Caster', job: '연구원', jobGrade: 'A',
        colors: { hair: '#505868', shirt: '#404868', pants: '#2a2838' }, fatigue: 88
    },
    {
        id: 'naru', name: '나르', stars: 2, role: 'Fighter', job: '사냥꾼', jobGrade: 'A',
        colors: { hair: '#804020', shirt: '#a08050', pants: '#605040' }, fatigue: 45
    },
    {
        id: 'andre', name: '앙드레', stars: 3, role: 'Shooter', job: '상인', jobGrade: 'B',
        colors: { hair: '#c0a870', shirt: '#a04050', pants: '#3a2838' }, fatigue: 92
    },
    {
        id: 'scout_m', name: '스카우트(남)', stars: 2, role: 'Shooter', job: '사냥꾼', jobGrade: 'B',
        colors: { hair: '#3a3020', shirt: '#508050', pants: '#3a4030' }, fatigue: 55
    },
    {
        id: 'cath', name: '까뜨린느', stars: 3, role: 'Fighter', job: '훈련교관', jobGrade: 'A',
        colors: { hair: '#c03030', shirt: '#303040', pants: '#2a2030' }, fatigue: 70
    },
    {
        id: 'wizard_f', name: '위자드(여)', stars: 3, role: 'Caster', job: '연구원', jobGrade: 'B',
        colors: { hair: '#6050a0', shirt: '#404080', pants: '#3a3060' }, fatigue: 80
    },
];

// === BUILDING DEFINITIONS ===
const BUILDINGS = [
    {
        id: 'kitchen', name: '식당', level: 3, icon: '🍳', x: 0.14, y: 0.42, w: 90, h: 70,
        roofColor: '#a04030', wallColor: '#8a6a50', jobType: '요리사'
    },
    {
        id: 'smithy', name: '대장간', level: 2, icon: '🔨', x: 0.38, y: 0.38, w: 85, h: 65,
        roofColor: '#605050', wallColor: '#706058', jobType: '대장장이'
    },
    {
        id: 'lab', name: '연구소', level: 2, icon: '🔬', x: 0.62, y: 0.35, w: 80, h: 65,
        roofColor: '#405080', wallColor: '#607088', jobType: '연구원'
    },
    {
        id: 'clinic', name: '의무실', level: 2, icon: '🏥', x: 0.86, y: 0.40, w: 75, h: 60,
        roofColor: '#f0f0f0', wallColor: '#c0c8d0', jobType: '의무관'
    },
    {
        id: 'market', name: '교역소', level: 1, icon: '💰', x: 0.15, y: 0.56, w: 80, h: 60,
        roofColor: '#c08030', wallColor: '#a08060', jobType: '상인'
    },
    {
        id: 'training', name: '훈련장', level: 2, icon: '⚔️', x: 0.50, y: 0.52, w: 95, h: 50,
        roofColor: '#604020', wallColor: '#7a6a50', jobType: '훈련교관'
    },
    {
        id: 'barracks', name: '숙소', level: 3, icon: '🛏️', x: 0.50, y: 0.65, w: 110, h: 70,
        roofColor: '#6a4a3a', wallColor: '#8a7060', jobType: null
    },
    {
        id: 'gate', name: '출입구', level: 0, icon: '🚪', x: 0.85, y: 0.58, w: 60, h: 80,
        roofColor: '#504030', wallColor: '#6a5a48', jobType: null
    },
];

// === ACTIVITY STATES ===
const ACTIVITIES = {
    idle: { label: '대기 중', emoji: '😊', color: '#a098b0' },
    cooking: { label: '요리 중', emoji: '🍳', color: '#f0c040' },
    smithing: { label: '단조 중', emoji: '🔨', color: '#e87040' },
    researching: { label: '연구 중', emoji: '📖', color: '#5090d0' },
    healing: { label: '치료 중', emoji: '💊', color: '#50c878' },
    trading: { label: '교역 중', emoji: '💰', color: '#f0c040' },
    training: { label: '훈련 중', emoji: '⚔️', color: '#d04050' },
    gathering: { label: '채집 중', emoji: '🌿', color: '#60a860' },
    hunting: { label: '사냥 출발', emoji: '🏹', color: '#a06030' },
    huntReturn: { label: '사냥 귀환', emoji: '🎒', color: '#a06030' },
    resting: { label: '휴식 중', emoji: '💤', color: '#8080b0' },
    walking: { label: '이동 중', emoji: '🚶', color: '#a098b0' },
    chatting: { label: '대화 중', emoji: '💬', color: '#c0a870' },
};

const JOB_TO_ACTIVITY = {
    '요리사': 'cooking', '대장장이': 'smithing', '연구원': 'researching',
    '의무관': 'healing', '상인': 'trading', '훈련교관': 'training',
    '채집꾼': 'gathering', '사냥꾼': 'hunting',
};

const JOB_TO_BUILDING = {
    '요리사': 'kitchen', '대장장이': 'smithy', '연구원': 'lab',
    '의무관': 'clinic', '상인': 'market', '훈련교관': 'training',
};

// ============================================================
// Part 2: GAME ENGINE
// ============================================================

class BarracksGame {
    constructor() {
        this.canvas = document.getElementById('barracks-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.chars = [];
        this.time = 0;
        this.gameHour = 14;
        this.gameMinute = 0;
        this.hoveredChar = null;
        this.particles = [];
        this.smokeParticles = [];
        this.frameCount = 0;

        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.canvas.addEventListener('mousemove', e => this.onMouseMove(e));
        this.canvas.addEventListener('click', e => this.onClick(e));
        // 모바일 터치 지원
        this.canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            const touch = e.touches[0];
            this.onMouseMove(touch);
            this.onClick(touch);
        }, { passive: false });
        this.canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            const touch = e.touches[0];
            this.onMouseMove(touch);
        }, { passive: false });
        document.getElementById('panel-close').addEventListener('click', () => {
            document.getElementById('side-panel').classList.add('hidden');
        });
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        this.initCharacters();
        this.startLoop();
        this.startEvents();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.W = rect.width;
        this.H = rect.height;
        this.canvas.width = this.W * dpr;
        this.canvas.height = this.H * dpr;
        this.canvas.style.width = this.W + 'px';
        this.canvas.style.height = this.H + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // We draw at ~2x pixel size for retro feel
        this.PX = Math.max(2, Math.floor(Math.min(this.W, this.H) / 300));
    }

    // --- CHARACTER INIT ---
    initCharacters() {
        CHARACTERS.forEach((data, i) => {
            const bldgId = JOB_TO_BUILDING[data.job];
            const bldg = bldgId ? BUILDINGS.find(b => b.id === bldgId) : BUILDINGS.find(b => b.id === 'barracks');
            const activity = JOB_TO_ACTIVITY[data.job] || 'idle';
            this.chars.push({
                ...data,
                x: bldg.x * this.W + (Math.random() - 0.5) * 40,
                y: bldg.y * this.H + (Math.random() - 0.5) * 20,
                targetX: 0, targetY: 0,
                vx: 0, vy: 0,
                activity: activity,
                activityTimer: 200 + Math.random() * 300,
                facing: Math.random() > 0.5 ? 1 : -1,
                frame: Math.floor(Math.random() * 4),
                frameTimer: 0,
                bobOffset: Math.random() * Math.PI * 2,
                scale: 1,
                speechBubble: null,
                speechTimer: 0,
                assigned: bldgId || 'barracks',
            });
        });
        // Start some characters hunting (away)
        const hunters = this.chars.filter(c => c.activity === 'hunting');
        if (hunters.length > 1) {
            hunters[0].activity = 'huntReturn';
            hunters[0].activityTimer = 100;
            const gate = BUILDINGS.find(b => b.id === 'gate');
            hunters[0].x = this.W + 30;
            hunters[0].y = gate.y * this.H;
            hunters[0].targetX = gate.x * this.W;
            hunters[0].targetY = gate.y * this.H;
        }
    }

    // --- MAIN LOOP ---
    startLoop() {
        const loop = () => {
            this.update();
            this.render();
            this.frameCount++;
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    // --- UPDATE ---
    update() {
        this.time += 1 / 60;
        // Game clock
        if (this.frameCount % 120 === 0) {
            this.gameMinute++;
            if (this.gameMinute >= 60) { this.gameMinute = 0; this.gameHour = (this.gameHour + 1) % 24; }
            const period = this.gameHour >= 6 && this.gameHour < 18 ? '☀️ 낮' : '🌙 밤';
            const el = document.getElementById('time-display');
            if (el) el.textContent = `${period} ${String(this.gameHour).padStart(2, '0')}:${String(this.gameMinute).padStart(2, '0')}`;
        }

        // Character AI
        this.chars.forEach(c => this.updateChar(c));

        // Particles
        if (this.frameCount % 30 === 0) this.addSmoke();
        this.smokeParticles = this.smokeParticles.filter(p => {
            p.y -= 0.3; p.opacity -= 0.008; p.x += Math.sin(p.y * 0.05) * 0.3;
            return p.opacity > 0;
        });
        // Firefly particles at night
        if (this.gameHour >= 19 || this.gameHour < 5) {
            if (this.frameCount % 60 === 0) {
                this.particles.push({
                    x: Math.random() * this.W, y: Math.random() * this.H * 0.6 + this.H * 0.3,
                    opacity: 0, phase: Math.random() * Math.PI * 2, life: 180 + Math.random() * 120
                });
            }
        }
        this.particles = this.particles.filter(p => {
            p.life--; p.opacity = Math.sin(p.life * 0.03 + p.phase) * 0.5;
            p.x += Math.sin(p.phase + this.time) * 0.3; p.y += Math.cos(p.phase + this.time * 0.7) * 0.2;
            return p.life > 0;
        });
    }

    updateChar(c) {
        c.frameTimer++;
        if (c.frameTimer > 12) { c.frameTimer = 0; c.frame = (c.frame + 1) % 4; }

        c.activityTimer--;
        // State transitions
        if (c.activityTimer <= 0) {
            this.transitionActivity(c);
        }

        // Movement
        if (c.activity === 'walking' || c.activity === 'huntReturn' || c.activity === 'hunting') {
            const dx = c.targetX - c.x;
            const dy = c.targetY - c.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 3) {
                const spd = c.activity === 'hunting' || c.activity === 'huntReturn' ? 1.5 : 0.8;
                c.vx = (dx / dist) * spd;
                c.vy = (dy / dist) * spd;
                c.facing = c.vx > 0 ? 1 : -1;
            } else {
                c.vx = 0; c.vy = 0;
                if (c.activity === 'walking') {
                    const bldgId = c.assigned;
                    const act = Object.entries(JOB_TO_BUILDING).find(([job, bid]) => bid === bldgId);
                    c.activity = act ? JOB_TO_ACTIVITY[act[0]] : 'idle';
                    c.activityTimer = 300 + Math.random() * 400;
                } else if (c.activity === 'huntReturn') {
                    c.activity = 'idle';
                    c.activityTimer = 100 + Math.random() * 100;
                    this.showToast(`🎒 ${c.name}이(가) 사냥에서 돌아왔습니다! 소재 +3`);
                } else if (c.activity === 'hunting') {
                    // Move off screen
                    if (c.x > this.W + 20 || c.x < -20) {
                        c.activityTimer = 400 + Math.random() * 300;
                        c.activity = 'huntReturn';
                        c.targetX = BUILDINGS.find(b => b.id === 'gate').x * this.W;
                        c.targetY = BUILDINGS.find(b => b.id === 'gate').y * this.H;
                    }
                }
            }
        } else {
            c.vx *= 0.8; c.vy *= 0.8;
        }
        c.x += c.vx; c.y += c.vy;

        // Speech bubbles
        if (c.speechTimer > 0) c.speechTimer--;
        if (c.speechBubble && c.speechTimer <= 0) c.speechBubble = null;
    }

    transitionActivity(c) {
        const roll = Math.random();
        if (c.job === '사냥꾼' && roll < 0.25 && c.activity !== 'hunting') {
            // Go hunting
            c.activity = 'hunting';
            c.activityTimer = 200;
            const gate = BUILDINGS.find(b => b.id === 'gate');
            c.targetX = this.W + 30;
            c.targetY = gate.y * this.H + (Math.random() - 0.5) * 20;
            // First walk to gate
            const gx = gate.x * this.W;
            const gy = gate.y * this.H;
            c.activity = 'walking';
            c.targetX = gx; c.targetY = gy;
            c.activityTimer = 999;
            setTimeout(() => {
                if (c.activity === 'walking' || c.activity === 'idle') {
                    c.activity = 'hunting';
                    c.targetX = this.W + 50;
                    c.activityTimer = 300;
                    this.showToast(`🏹 ${c.name}이(가) 사냥을 떠납니다`);
                }
            }, 5000);
            return;
        }

        if (roll < 0.15) {
            // Random walk
            c.activity = 'walking';
            const bldg = BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)];
            c.targetX = bldg.x * this.W + (Math.random() - 0.5) * 50;
            c.targetY = bldg.y * this.H + (Math.random() - 0.5) * 20 + 20;
            c.activityTimer = 500;
        } else if (roll < 0.25) {
            c.activity = 'resting';
            c.activityTimer = 200 + Math.random() * 200;
            c.speechBubble = '💤'; c.speechTimer = 80;
        } else if (roll < 0.35) {
            c.activity = 'chatting';
            c.activityTimer = 150 + Math.random() * 100;
            const bubbles = ['안녕!', '오늘 날씨 좋다', '밥 먹었어?', '힘내자!', '피곤해...', '재밌다~'];
            c.speechBubble = bubbles[Math.floor(Math.random() * bubbles.length)];
            c.speechTimer = 100;
        } else {
            // Return to job
            const bldgId = JOB_TO_BUILDING[c.job] || 'barracks';
            const bldg = BUILDINGS.find(b => b.id === bldgId);
            c.activity = 'walking';
            c.targetX = bldg.x * this.W + (Math.random() - 0.5) * 30;
            c.targetY = bldg.y * this.H + 15 + (Math.random() - 0.5) * 10;
            c.assigned = bldgId;
            c.activityTimer = 600;
        }
    }

    addSmoke() {
        const kitchen = BUILDINGS.find(b => b.id === 'kitchen');
        const smithy = BUILDINGS.find(b => b.id === 'smithy');
        [kitchen, smithy].forEach(b => {
            if (!b) return;
            this.smokeParticles.push({
                x: b.x * this.W + b.w / 2 * (Math.random() - 0.5),
                y: b.y * this.H - 10,
                opacity: 0.4 + Math.random() * 0.2,
                size: 3 + Math.random() * 4,
            });
        });
    }

    // --- RENDER ---
    render() {
        const ctx = this.ctx;
        const W = this.W, H = this.H;
        ctx.clearRect(0, 0, W, H);

        this.drawBackground(ctx, W, H);
        this.drawBuildings(ctx, W, H);
        this.drawSmoke(ctx);
        // Sort chars by y for depth
        const sorted = [...this.chars].sort((a, b) => a.y - b.y);
        sorted.forEach(c => this.drawCharacter(ctx, c));
        this.drawParticles(ctx);
        this.drawVignette(ctx, W, H);
    }

    drawBackground(ctx, W, H) {
        // Sky gradient based on time
        const isNight = this.gameHour >= 19 || this.gameHour < 6;
        const isDusk = this.gameHour >= 17 && this.gameHour < 19;
        let sky1, sky2;
        if (isNight) { sky1 = '#0a0818'; sky2 = '#1a1830'; }
        else if (isDusk) { sky1 = '#4a2030'; sky2 = '#2a1838'; }
        else { sky1 = '#3a6898'; sky2 = '#2a4868'; }

        const grad = ctx.createLinearGradient(0, 0, 0, H * 0.5);
        grad.addColorStop(0, sky1); grad.addColorStop(1, sky2);
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H * 0.5);

        // Mountains
        ctx.fillStyle = '#2a3040';
        ctx.beginPath(); ctx.moveTo(0, H * 0.35);
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H * 0.35 - Math.sin(x * 0.008) * 30 - Math.sin(x * 0.003) * 50);
        ctx.lineTo(W, H * 0.5); ctx.lineTo(0, H * 0.5); ctx.fill();

        // Ground
        const gGrad = ctx.createLinearGradient(0, H * 0.4, 0, H);
        gGrad.addColorStop(0, '#3a5030'); gGrad.addColorStop(0.3, '#4a6040');
        gGrad.addColorStop(0.7, '#5a7050'); gGrad.addColorStop(1, '#4a5a38');
        ctx.fillStyle = gGrad; ctx.fillRect(0, H * 0.4, W, H * 0.6);

        // Dirt paths
        ctx.strokeStyle = '#7a6a50'; ctx.lineWidth = 8; ctx.lineCap = 'round';
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(W * 0.12, H * 0.65); ctx.quadraticCurveTo(W * 0.3, H * 0.60, W * 0.50, H * 0.58);
        ctx.quadraticCurveTo(W * 0.68, H * 0.56, W * 0.85, H * 0.62);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(W * 0.50, H * 0.58); ctx.quadraticCurveTo(W * 0.52, H * 0.68, W * 0.50, H * 0.78);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(W * 0.80, H * 0.75); ctx.lineTo(W + 10, H * 0.75);
        ctx.stroke();

        // Grass tufts
        ctx.fillStyle = '#60a860';
        for (let i = 0; i < 30; i++) {
            const gx = (i * 137 + 50) % W, gy = H * 0.45 + ((i * 73) % Math.floor(H * 0.5));
            if (gy < H * 0.4) continue;
            ctx.fillRect(gx, gy, 3, 2); ctx.fillRect(gx + 2, gy - 2, 2, 3);
        }

        // Stars at night
        if (this.gameHour >= 19 || this.gameHour < 6) {
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 40; i++) {
                const sx = (i * 173 + 20) % W, sy = (i * 97 + 10) % (H * 0.35);
                const twinkle = Math.sin(this.time * 2 + i) * 0.3 + 0.7;
                ctx.globalAlpha = twinkle * 0.6;
                ctx.fillRect(sx, sy, 1.5, 1.5);
            }
            ctx.globalAlpha = 1;
        }
    }

    drawBuildings(ctx, W, H) {
        const labelsEl = document.getElementById('building-labels');
        labelsEl.innerHTML = '';

        BUILDINGS.forEach(b => {
            const bx = b.x * W - b.w / 2;
            const by = b.y * H - b.h / 2;

            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.beginPath();
            ctx.ellipse(b.x * W, b.y * H + b.h / 2 + 5, b.w / 2 + 5, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            // Wall
            ctx.fillStyle = b.wallColor;
            ctx.fillRect(bx + 4, by + 12, b.w - 8, b.h - 12);
            // Wall detail line
            ctx.fillStyle = 'rgba(0,0,0,0.1)';
            ctx.fillRect(bx + 4, by + b.h / 2, b.w - 8, 2);

            // Door
            ctx.fillStyle = '#4a3020';
            const doorW = 12, doorH = 18;
            ctx.fillRect(b.x * W - doorW / 2, by + b.h - doorH - 2, doorW, doorH);
            ctx.fillStyle = '#f0c040';
            ctx.fillRect(b.x * W + 3, by + b.h - doorH / 2 - 2, 2, 2);

            // Window
            if (b.w > 70) {
                ctx.fillStyle = this.gameHour >= 19 || this.gameHour < 6 ? '#f0c860' : '#80b0d0';
                ctx.fillRect(bx + 12, by + 20, 10, 8);
                ctx.fillRect(bx + b.w - 22, by + 20, 10, 8);
                if (this.gameHour >= 19 || this.gameHour < 6) {
                    ctx.fillStyle = 'rgba(240,200,96,0.15)';
                    ctx.beginPath(); ctx.ellipse(bx + 17, by + 24, 15, 12, 0, 0, Math.PI * 2); ctx.fill();
                }
            }

            // Roof
            ctx.fillStyle = b.roofColor;
            ctx.beginPath();
            ctx.moveTo(bx - 4, by + 14);
            ctx.lineTo(b.x * W, by - 8);
            ctx.lineTo(bx + b.w + 4, by + 14);
            ctx.closePath();
            ctx.fill();
            // Roof shine
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.moveTo(bx - 2, by + 13);
            ctx.lineTo(b.x * W, by - 6);
            ctx.lineTo(b.x * W, by + 13);
            ctx.closePath();
            ctx.fill();

            // Activity indicator
            const workers = this.chars.filter(ch => ch.assigned === b.id && ch.activity !== 'walking' && ch.activity !== 'hunting');
            if (workers.length > 0 && b.jobType) {
                ctx.fillStyle = 'rgba(80,200,120,0.8)';
                ctx.beginPath();
                ctx.arc(bx + b.w - 2, by + 8, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = '7px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(workers.length, bx + b.w - 2, by + 10.5);
            }

            // HTML label
            const label = document.createElement('div');
            label.className = 'building-label';
            label.style.left = (b.x * 100) + '%';
            label.style.top = (b.y * 100 - b.h / H * 50 - 6) + '%';
            label.innerHTML = `${b.icon} ${b.name}${b.level > 0 ? `<span class="bldg-level">Lv.${b.level}</span>` : ''}`;
            labelsEl.appendChild(label);
        });
    }

    drawCharacter(ctx, c) {
        const px = this.PX;
        const bob = Math.sin(this.time * 3 + c.bobOffset) * (c.activity === 'resting' ? 0.5 : 1.5);
        const isMoving = Math.abs(c.vx) > 0.1 || Math.abs(c.vy) > 0.1;
        const walkBob = isMoving ? Math.sin(this.time * 8 + c.bobOffset) * 2 : 0;
        const x = Math.round(c.x);
        const y = Math.round(c.y + bob + walkBob);
        const f = c.facing;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(x, y + 10 * px / 2, 5 * px / 2, 2 * px / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(x, y);
        if (f < 0) ctx.scale(-1, 1);

        // Body
        const drawPx = (cx, cy, color) => {
            ctx.fillStyle = color;
            ctx.fillRect(cx * px, cy * px, px, px);
        };

        // Head (3x3)
        drawPx(-1, -7, c.colors.hair);
        drawPx(0, -7, c.colors.hair);
        drawPx(1, -7, c.colors.hair);
        drawPx(-1, -6, PALETTE.skin);
        drawPx(0, -6, PALETTE.skin);
        drawPx(1, -6, c.colors.hair);
        drawPx(-1, -5, PALETTE.skin);
        drawPx(0, -5, PALETTE.skin);
        drawPx(1, -5, PALETTE.skin);

        // Eyes
        ctx.fillStyle = '#202020';
        ctx.fillRect(0 * px, -6 * px, px * 0.6, px * 0.6);

        // Torso (3x3)
        drawPx(-1, -4, c.colors.shirt);
        drawPx(0, -4, c.colors.shirt);
        drawPx(1, -4, c.colors.shirt);
        drawPx(-1, -3, c.colors.shirt);
        drawPx(0, -3, c.colors.shirt);
        drawPx(1, -3, c.colors.shirt);
        drawPx(-1, -2, c.colors.shirt);
        drawPx(0, -2, c.colors.shirt);
        drawPx(1, -2, c.colors.shirt);

        // Legs (walk animation)
        const legFrame = isMoving ? Math.floor(this.time * 6) % 2 : 0;
        if (legFrame === 0) {
            drawPx(-1, -1, c.colors.pants); drawPx(0, -1, c.colors.pants);
            drawPx(-1, 0, PALETTE.boot); drawPx(0, 0, PALETTE.boot);
        } else {
            drawPx(-1, -1, c.colors.pants); drawPx(1, -1, c.colors.pants);
            drawPx(-1, 0, PALETTE.boot); drawPx(1, 0, PALETTE.boot);
        }

        // Activity tool
        this.drawActivityTool(ctx, c, px);

        ctx.restore();

        // Speech bubble
        if (c.speechBubble && c.speechTimer > 0) {
            const alpha = Math.min(1, c.speechTimer / 20);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            const bw = ctx.measureText(c.speechBubble).width + 12 || 40;
            const bx2 = x - bw / 2;
            const by2 = y - 12 * px - 18;
            ctx.beginPath();
            ctx.roundRect(bx2, by2, bw, 18, 6);
            ctx.fill();
            ctx.fillStyle = '#333';
            ctx.font = '11px "Noto Sans KR"';
            ctx.textAlign = 'center';
            ctx.fillText(c.speechBubble, x, by2 + 13);
            ctx.restore();
        }

        // Name tag on hover
        if (this.hoveredChar === c) {
            ctx.fillStyle = 'rgba(240,192,64,0.8)';
            ctx.font = 'bold 11px "Noto Sans KR"';
            ctx.textAlign = 'center';
            ctx.fillText(c.name, x, y - 12 * px - 4);

            // Activity icon
            const act = ACTIVITIES[c.activity];
            if (act) {
                ctx.font = '13px sans-serif';
                ctx.fillText(act.emoji, x, y - 12 * px - 18);
            }
        }
    }

    drawActivityTool(ctx, c, px) {
        const drawPx = (cx, cy, color) => {
            ctx.fillStyle = color;
            ctx.fillRect(cx * px, cy * px, px, px);
        };
        switch (c.activity) {
            case 'cooking':
                drawPx(2, -4, '#808080'); drawPx(2, -3, '#808080'); // pan handle
                drawPx(3, -3, '#a0a0a0');
                if (Math.sin(this.time * 5) > 0) drawPx(3, -5, '#f08020'); // flame flicker
                break;
            case 'smithing':
                drawPx(2, -5, '#606060'); drawPx(2, -4, '#606060'); drawPx(2, -3, '#805020'); // hammer
                break;
            case 'researching':
                drawPx(2, -4, '#d0c8a0'); drawPx(2, -3, '#d0c8a0'); drawPx(3, -4, '#d0c8a0'); // book
                break;
            case 'healing':
                drawPx(2, -4, '#f0f0f0'); drawPx(3, -3, '#d04050'); // bandage + cross
                break;
            case 'gathering':
                drawPx(2, -4, '#60a060'); drawPx(2, -3, '#60a060'); drawPx(3, -3, '#80c080'); // plants
                break;
            case 'training':
                drawPx(2, -5, '#a0a0a0'); drawPx(2, -4, '#a0a0a0'); drawPx(2, -3, '#805020'); // sword
                break;
            case 'resting':
                // Z particles
                if (this.frameCount % 40 < 20) {
                    ctx.fillStyle = 'rgba(128,128,176,0.6)';
                    ctx.font = '9px sans-serif';
                    ctx.fillText('z', 2 * px, -7 * px);
                }
                break;
        }
    }

    drawSmoke(ctx) {
        this.smokeParticles.forEach(p => {
            ctx.fillStyle = `rgba(180,170,160,${p.opacity})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    drawParticles(ctx) {
        this.particles.forEach(p => {
            if (p.opacity <= 0) return;
            ctx.fillStyle = `rgba(240,220,100,${Math.max(0, p.opacity)})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    drawVignette(ctx, W, H) {
        const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.8);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    // --- INTERACTION ---
    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        let closest = null, closestDist = 30; // 모바일 터치 대응 히트박스 확대
        this.chars.forEach(c => {
            const dx = mx - c.x, dy = my - c.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < closestDist) { closest = c; closestDist = d; }
        });
        this.hoveredChar = closest;
        this.canvas.style.cursor = closest ? 'pointer' : 'default';

        // Tooltip
        const tip = document.getElementById('char-tooltip');
        if (closest) {
            tip.classList.remove('hidden');
            tip.style.left = Math.min(mx + 15, this.W - 200) + 'px';
            tip.style.top = Math.min(my - 15, this.H - 100) + 'px';
            tip.querySelector('.tooltip-name').textContent = closest.name;
            tip.querySelector('.tooltip-stars').textContent = '★'.repeat(closest.stars);
            tip.querySelector('.tooltip-job').textContent = `${closest.job} (${closest.jobGrade}등급) · ${closest.role}`;
            const act = ACTIVITIES[closest.activity];
            tip.querySelector('.tooltip-status').textContent = `${act?.emoji || ''} ${act?.label || ''}`;
            tip.querySelector('.tooltip-status').style.color = act?.color || '#aaa';
            tip.querySelector('.fatigue-fill').style.width = closest.fatigue + '%';
            tip.querySelector('.fatigue-text').textContent = `피로 ${closest.fatigue}/100`;
        } else {
            tip.classList.add('hidden');
        }
    }

    onClick(e) {
        if (!this.hoveredChar) return;
        this.showCharPanel(this.hoveredChar);
    }

    showCharPanel(c) {
        const panel = document.getElementById('side-panel');
        const content = document.getElementById('panel-content');
        const act = ACTIVITIES[c.activity];
        content.innerHTML = `
      <div class="panel-char-header">
        <div class="panel-char-name">${'★'.repeat(c.stars)} ${c.name}</div>
        <div class="panel-char-title">${c.role} · ${c.job} ${c.jobGrade}등급</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">현재 상태</div>
        <div class="panel-stat-row"><span class="panel-stat-label">활동</span><span class="panel-stat-value" style="color:${act?.color || '#aaa'}">${act?.emoji || ''} ${act?.label || ''}</span></div>
        <div class="panel-stat-row"><span class="panel-stat-label">피로도</span><span class="panel-stat-value">${c.fatigue}/100</span></div>
        <div class="panel-stat-row"><span class="panel-stat-label">배치</span><span class="panel-stat-value">${BUILDINGS.find(b => b.id === c.assigned)?.name || '미배치'}</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">스탯</div>
        <div class="panel-stat-row"><span class="panel-stat-label">ATK</span><span class="panel-stat-value">${200 + c.stars * 80 + Math.floor(Math.random() * 50)}</span></div>
        <div class="panel-stat-row"><span class="panel-stat-label">DEF</span><span class="panel-stat-value">${100 + c.stars * 40 + Math.floor(Math.random() * 30)}</span></div>
        <div class="panel-stat-row"><span class="panel-stat-label">SPD</span><span class="panel-stat-value">${70 + c.stars * 15 + Math.floor(Math.random() * 20)}</span></div>
        <div class="panel-stat-row"><span class="panel-stat-label">HP</span><span class="panel-stat-value">${800 + c.stars * 300 + Math.floor(Math.random() * 100)}</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">생활 스킬</div>
        <div class="panel-stat-row"><span class="panel-stat-label">${c.job} 숙련도</span><span class="panel-stat-value">Lv.${Math.min(10, 1 + Math.floor(Math.random() * 5))}</span></div>
        <div class="panel-stat-row"><span class="panel-stat-label">생산 효율</span><span class="panel-stat-value">${c.jobGrade === 'S' ? '×1.5' : c.jobGrade === 'A' ? '×1.3' : '×1.0'}</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">배치 변경</div>
        <div class="panel-actions">
          ${BUILDINGS.filter(b => b.jobType).map(b => `<button class="panel-action-btn" onclick="game.assignChar('${c.id}','${b.id}')">${b.icon} ${b.name}</button>`).join('')}
          <button class="panel-action-btn" onclick="game.assignChar('${c.id}','barracks')">🛏️ 휴식</button>
        </div>
      </div>
    `;
        panel.classList.remove('hidden');
    }

    assignChar(charId, bldgId) {
        const c = this.chars.find(ch => ch.id === charId);
        if (!c) return;
        c.assigned = bldgId;
        const bldg = BUILDINGS.find(b => b.id === bldgId) || BUILDINGS.find(b => b.id === 'barracks');
        c.activity = 'walking';
        c.targetX = bldg.x * this.W + (Math.random() - 0.5) * 30;
        c.targetY = bldg.y * this.H + 15;
        c.activityTimer = 600;
        this.showToast(`📋 ${c.name}을(를) ${bldg.name}(으)로 배치했습니다`);
        this.showCharPanel(c);
    }

    // --- EVENTS ---
    startEvents() {
        // Periodic resource generation
        setInterval(() => {
            const cooks = this.chars.filter(c => c.activity === 'cooking').length;
            const smiths = this.chars.filter(c => c.activity === 'smithing').length;
            const gatherers = this.chars.filter(c => c.activity === 'gathering').length;
            if (cooks > 0) {
                this.showToast(`🍳 요리 완성! 음식 +${cooks}`);
                this.updateResource('res-food', cooks);
            }
            if (smiths > 0) this.updateResource('res-ore', -smiths);
            if (gatherers > 0) {
                this.updateResource('res-herb', gatherers);
                this.updateResource('res-food', Math.floor(gatherers / 2));
            }
            this.updateResource('res-gold', 100 + Math.floor(Math.random() * 200));
        }, 20000);

        // Random chatter
        setInterval(() => {
            const idle = this.chars.filter(c => c.activity !== 'hunting' && c.activity !== 'walking' && !c.speechBubble);
            if (idle.length > 0) {
                const c = idle[Math.floor(Math.random() * idle.length)];
                const lines = [
                    '배고프다~', '오늘 뭐 해?', '날씨 좋다!', '가주님!', '파이팅!',
                    '졸려...', '이거 다 되가!', '어디갔지...', '좋은 아침!', '수고 많아~',
                    `${this.chars[Math.floor(Math.random() * this.chars.length)].name}!`,
                ];
                c.speechBubble = lines[Math.floor(Math.random() * lines.length)];
                c.speechTimer = 120;
            }
        }, 6000);

        // Random relationship events
        setInterval(() => {
            if (Math.random() < 0.3) {
                const c1 = this.chars[Math.floor(Math.random() * this.chars.length)];
                const c2 = this.chars.filter(c => c !== c1)[Math.floor(Math.random() * (this.chars.length - 1))];
                if (c1 && c2) {
                    const events = [
                        `💬 ${c1.name}와(과) ${c2.name}이(가) 대화를 나누고 있습니다 (유대 +2)`,
                        `🤝 ${c1.name}이(가) ${c2.name}을(를) 도와주고 있습니다 (호감도 +3)`,
                        `⚡ ${c1.name}와(과) ${c2.name} 사이에 긴장감이... (충성도 주의)`,
                    ];
                    this.showToast(events[Math.floor(Math.random() * events.length)]);
                }
            }
        }, 15000);
    }

    updateResource(id, delta) {
        const el = document.getElementById(id);
        if (!el) return;
        let val = parseInt(el.textContent.replace(/,/g, '')) || 0;
        val = Math.max(0, val + delta);
        el.textContent = val.toLocaleString();
        el.parentElement.style.transform = 'scale(1.1)';
        setTimeout(() => el.parentElement.style.transform = '', 200);
    }

    showToast(msg) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3200);
    }
}

// === INIT ===
let game;
window.addEventListener('DOMContentLoaded', () => { game = new BarracksGame(); });
