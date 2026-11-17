// Duskline Depot input: keyboard state, pointer-lock mouse look, firing and
// one-shot key presses. The game loop reads state and consumes presses; this
// module never touches game state.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    zoomHeld: false,
    locked: false,
    lookX: 0,
    lookY: 0,
  };
  const pressed = new Set();

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseDown(event) {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.zoomHeld = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.zoomHeld = false;
  }
  function onMouseMove(event) {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.firing = false;
      state.zoomHeld = false;
    }
    onLockChange(state.locked);
  }
  function onContext(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('contextmenu', onContext);

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },
    wasPressed(code) {
      return pressed.has(code);
    },
    consumePressed(code) {
      pressed.delete(code);
    },
  };
}
