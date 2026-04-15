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

  debug: {
    logHexClick: true,
    showStats: true,
  },
};
