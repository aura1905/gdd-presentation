// Camera: pan + zoom. World coordinates <-> screen coordinates.
// Centered on (tx, ty), scaled by s.  Handles wheel zoom and drag pan.
import { CONFIG } from "../config.js";

export function createCamera(canvas, worldWidth, worldHeight) {
  const cam = {
    tx: worldWidth / 2,
    ty: worldHeight / 2,
    scale: CONFIG.camera.stratScale,
    _onChange: new Set(),
  };

  function clampScale(s) {
    return Math.min(CONFIG.camera.maxScale, Math.max(CONFIG.camera.minScale, s));
  }

  cam.worldToScreen = (wx, wy) => ({
    x: (wx - cam.tx) * cam.scale + canvas.clientWidth / 2,
    y: (wy - cam.ty) * cam.scale + canvas.clientHeight / 2,
  });
  cam.screenToWorld = (sx, sy) => ({
    x: (sx - canvas.clientWidth / 2) / cam.scale + cam.tx,
    y: (sy - canvas.clientHeight / 2) / cam.scale + cam.ty,
  });

  cam.setScale = (s, pivotScreen) => {
    const next = clampScale(s);
    if (pivotScreen) {
      const before = cam.screenToWorld(pivotScreen.x, pivotScreen.y);
      cam.scale = next;
      const after = cam.screenToWorld(pivotScreen.x, pivotScreen.y);
      cam.tx += before.x - after.x;
      cam.ty += before.y - after.y;
    } else {
      cam.scale = next;
    }
    notify();
  };
  cam.pan = (dx, dy) => {
    cam.tx -= dx / cam.scale;
    cam.ty -= dy / cam.scale;
    notify();
  };
  cam.centerOn = (wx, wy) => {
    cam.tx = wx; cam.ty = wy; notify();
  };
  cam.onChange = (fn) => { cam._onChange.add(fn); return () => cam._onChange.delete(fn); };

  function notify() { for (const fn of cam._onChange) fn(cam); }

  // ------- Input -------
  let dragging = false, lastX = 0, lastY = 0, movedSincePress = 0;
  let clickHandler = null;

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * CONFIG.camera.wheelSensitivity);
    const rect = canvas.getBoundingClientRect();
    cam.setScale(cam.scale * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, { passive: false });

  const onPress = (x, y) => { dragging = true; lastX = x; lastY = y; movedSincePress = 0; };
  const onMove = (x, y) => {
    if (!dragging) return;
    const dx = x - lastX, dy = y - lastY;
    cam.pan(dx, dy);
    movedSincePress += Math.abs(dx) + Math.abs(dy);
    lastX = x; lastY = y;
  };
  const onRelease = (x, y) => {
    if (!dragging) return;
    dragging = false;
    if (movedSincePress < 4 && clickHandler) {
      const rect = canvas.getBoundingClientRect();
      clickHandler(x - rect.left, y - rect.top);
    }
  };

  canvas.addEventListener("mousedown", (e) => onPress(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
  window.addEventListener("mouseup", (e) => onRelease(e.clientX, e.clientY));

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      onPress(t.clientX, t.clientY);
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
    }
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    onRelease(t.clientX, t.clientY);
  });

  cam.onClick = (fn) => { clickHandler = fn; };

  return cam;
}
