export const CONFIG = {
  // Hex tile pixel size (atlas is 72x72 flat-top tiles).
  hex: {
    W: 72,
    H: 72,
    // Flat-top offset odd-q (Unity convention):
    //   x = q * W * 3/4
    //   y = r * H + (q & 1 ? H/2 : 0)
    // Odd-column parity shift direction. +1 = odd cols shift DOWN, -1 = UP.
    // Start with +1 (Red Blob standard); flip here if art mismatches.
    oddColShift: +1,
  },

  camera: {
    minScale: 0.15,   // 전략맵
    maxScale: 2.0,
    // 2단계 프리셋
    stratScale: 0.25,
    tileScale: 0.85,
    wheelSensitivity: 0.0015,
  },

  // 시야/안개 반경 (M3에서 사용; 선언만 미리)
  vision: {
    outpost: 3,
    gate: 2,
    city: 4,
    party: 1,
    scoutDuration: 5,
  },

  // 턴 길이: 자원/피로 테이블이 모두 분 단위(ProductionPerMin/RecoveryPerMin)이므로
  // "1턴 = N분"으로 환산. 데모 기본 10분 (Grade1 자원 30/턴, 필드 회복 10/턴).
  turn: {
    minutesPerTurn: 10,
  },

  debug: {
    logHexClick: true,
    showStats: true,
  },
};
