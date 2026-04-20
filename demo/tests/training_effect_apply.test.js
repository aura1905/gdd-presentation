// 훈련 투자 효과 → 실제 캐릭터/전투에 적용되는지 검증.
// 현재 가설: 카운터만 올라가고 실제 maxFatigue/스탯/회복량에 반영되지 않음.
// 이 테스트들이 실패하면 = M5-B 미구현 입증.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import {
  initState, getState, getTrainingLevel, investTraining,
  recomputeStatsFromLevel, recomputeAllCharacters,
} from "../src/state/gameState.js";
import { computeFatigueRecovery } from "../src/engine/turn.js";

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function loadTables() {
  const dir = "data/tables";
  const make = (rows, pk) => ({ all: () => rows, get: (k) => rows.find(r => r[pk] === k) });
  return {
    fieldObjects: make(loadJson(`${dir}/field_objects.json`), "ID"),
    worldHex:     make(loadJson(`${dir}/world_hex.json`), "HexID"),
    structures:   make(loadJson(`${dir}/structures.json`), "StructureID"),
    familyLevel:  make(loadJson(`${dir}/family_level.json`), "Level"),
    training:     make(loadJson(`${dir}/training.json`), "ID"),
    energy:       make(loadJson(`${dir}/energy.json`),     "ID"),
  };
}

function giveResources(state) {
  state.resources.grain = 999999;
  state.resources.gold  = 999999;
  state.resources.iron  = 999999;
  state.resources.wood  = 999999;
  state.resources.stone = 999999;
  state.resources.herbs = 999999;
  state.resources.rp    = 999999;
  state.resources.scroll = 999999;
  state.resources.gem   = 999999;
  // training expects "txp" too — energy 등에 사용되는 자원 모두
  state.resources.txp   = 999999;
  state.resources.mana  = 999999;
  state.family.level    = 99;  // 모든 훈련 해금
}

describe("훈련 효과 적용 검증 (M5-B 미구현 시 실패 예상)", () => {
  const tables = loadTables();
  beforeEach(() => initState(tables));

  it("[stamina] 체력 단련 5 투자 → ch.maxFatigue가 100보다 커져야 함 (+5)", () => {
    const state = getState();
    giveResources(state);
    for (let i = 0; i < 5; i++) {
      const r = investTraining("stamina", tables);
      expect(r.ok).toBe(true);
    }
    expect(getTrainingLevel("stamina")).toBe(5);

    // M5-B: 투자 후 캐릭터 stats 재계산 (실제 main.js 흐름과 동일)
    recomputeAllCharacters(tables);

    const ch = state.characters[0];
    // 기대: stamina Lv1당 maxFatigue +1 → Lv5는 105
    expect(ch.maxFatigue).toBe(105);
  });

  it("[recovery] 회복력 강화 5 투자 → 필드 위치 파티 회복량이 기본보다 커져야 함", () => {
    const state = getState();
    giveResources(state);
    for (let i = 0; i < 5; i++) {
      const r = investTraining("recovery", tables);
      expect(r.ok).toBe(true);
    }
    // 필드 헥스에 파티 위치 (홈 외부)
    const ch = state.characters[0];
    ch.fatigue = 0;
    state.parties[0].location = { q: 60, r: 45 };  // 필드
    state.parties[0].slots = [ch.id];

    const recMap = computeFatigueRecovery(state, tables);
    const baseRec = 1 * 10;  // 필드 RecoveryPerMin=1 × 10분
    // 기대: recovery Lv5 → +0.02 × 5 = +0.1/min × 10분 = +1 → 총 11
    expect(recMap.get(ch.id)).toBeGreaterThan(baseRec);
  });

  it("[class_F] Fighter 훈련 5 투자 → F 캐릭터 ATK가 기본보다 커져야 함 (+%)", () => {
    const state = getState();
    giveResources(state);
    for (let i = 0; i < 5; i++) {
      investTraining("class_F", tables);
    }

    // F 직업 캐릭터 찾기
    const fighter = state.characters.find(c => c.jobClass === "F");
    if (!fighter) {
      // 데모 시작 캐릭터에 F가 없으면 스킵 (불가능 상황)
      throw new Error("No Fighter in starting characters");
    }
    const baseAtk = fighter.stats.atk;

    // 스탯 재계산 (현재는 training을 안 봄)
    recomputeStatsFromLevel(fighter.id, tables.fieldObjects, tables);
    const newAtk = fighter.stats.atk;

    // 기대: Fighter 훈련 Lv5 → ATK +1%×5 = +5% (Base 기준)
    expect(newAtk).toBeGreaterThan(baseAtk);
  });

  it("[class_S] Scout 훈련 30(Max) 투자 → S 캐릭터 CRI가 기본보다 커져야 함 (+%)", () => {
    const state = getState();
    giveResources(state);
    // 시작 6명에 S 직업이 없으므로 합성. SPD는 BaseSPD=1로 너무 작아 round로 죽으므로
    // CRI(BaseCRI≥5)로 검증. Scout 훈련 EffectType2=CRI_PCT/0.5/Lv 누적.
    const scoutTmpl = tables.fieldObjects.all().find(r => r.JobClass === "S" && r.ObjectType === "Player");
    if (!scoutTmpl) throw new Error("No Scout template in fieldObjects");
    const scout = {
      id: scoutTmpl.ID, name: scoutTmpl.Name, jobClass: "S",
      level: 1, hp: 100, maxHp: 100, fatigue: 100, maxFatigue: 100, status: "normal",
      stats: { atk: scoutTmpl.BaseATK || 8, def: scoutTmpl.BaseDEF || 3, spd: scoutTmpl.BaseSPD || 1, cri: 5, crd: 130 },
    };
    state.characters.push(scout);

    // Max Lv까지 투자: 누적 CRI_PCT = 0.5 × 30 = 15% → CRI 5 × 1.15 = 5.75 → round 6
    for (let i = 0; i < 30; i++) {
      const r = investTraining("class_S", tables);
      expect(r.ok).toBe(true);
    }
    const baseCri = 5;  // FieldObject 기본 CRI 5
    recomputeStatsFromLevel(scout.id, tables.fieldObjects, tables);
    expect(scout.stats.cri).toBeGreaterThan(baseCri);
  });

  it("[class_F] F 훈련 효과는 다른 직업에 적용 안 됨 (cross-class no-effect)", () => {
    const state = getState();
    giveResources(state);
    for (let i = 0; i < 5; i++) {
      investTraining("class_F", tables);
    }
    const nonF = state.characters.find(c => c.jobClass !== "F");
    if (!nonF) return;  // skip
    const baseAtk = nonF.stats.atk;
    recomputeStatsFromLevel(nonF.id, tables.fieldObjects, tables);
    // 비-F 캐릭터는 ATK 변동 없어야 함
    expect(nonF.stats.atk).toBe(baseAtk);
  });
});
