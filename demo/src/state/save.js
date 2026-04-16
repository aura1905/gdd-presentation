// localStorage save/load for game state.
const SAVE_KEY = "ge_web_demo_save";

export function saveState(state) {
  try {
    // Set → Array for JSON serialization
    const serializable = {
      ...state,
      capturedStructures: [...(state.capturedStructures || [])],
      ownedHexes: [...(state.ownedHexes || [])],
      selectedPartyId: null,  // don't persist UI selection
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializable));
  } catch (e) {
    console.warn("[save] failed:", e);
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("[load] failed:", e);
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}
