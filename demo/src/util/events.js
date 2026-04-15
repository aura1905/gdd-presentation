// Minimal pub/sub event bus. Synchronous delivery.
const handlers = new Map();

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  handlers.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set = handlers.get(event);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); }
    catch (e) { console.error(`[events] handler error for ${event}:`, e); }
  }
}
