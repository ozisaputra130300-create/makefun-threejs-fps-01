// Duskline Depot player: first-person movement with acceleration, friction,
// crouching, sneaking and AABB collision against the map. The player is a
// capsule approximated by a vertical segment; every wall is an axis-aligned
// box, so collision is a circle-vs-box resolve on the XZ plane plus a floor
// at y = 0. No jumping: the depot is played on foot, low and deliberate.
import * as THREE from 'three';

const WALK_SPEED = 4.6;
const SNEAK_SPEED = 2.1;
const CROUCH_SPEED = 2.4;
const ACCEL = 34;
const FRICTION = 11;
const RADIUS = 0.36;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;

export function createPlayer(colliders, spawn) {
  const state = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    sneaking: false,
    health: 100,
    armor: 0,
  };
  const tmp = new THREE.Vector3();

  function reset() {
    state.position.set(spawn.x, 0, spawn.z);
    state.velocity.set(0, 0, 0);
    state.yaw = spawn.yaw;
    state.pitch = 0;
    state.eye = EYE_STAND;
    state.crouched = false;
    state.sneaking = false;
    state.health = 100;
    state.armor = 0;
  }

  function collide() {
    const p = state.position;
    for (const box of colliders) {
      // Flat ground (floor, tracks, sleepers): the player stands on it, it
      // never blocks horizontal movement.
      if (box.max.y <= 0.05) continue;
      if (p.y > box.max.y || p.y + 1.7 < box.min.y) continue;
      const cx = Math.max(box.min.x, Math.min(p.x, box.max.x));
      const cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (RADIUS - d) / d;
        p.x += dx * push;
        p.z += dz * push;
      } else {
        // Centre inside the box: push out along the smallest penetration.
        const px = Math.min(p.x - (box.min.x - RADIUS), (box.max.x + RADIUS) - p.x);
        const pz = Math.min(p.z - (box.min.z - RADIUS), (box.max.z + RADIUS) - p.z);
        if (px < pz) p.x += (p.x - (box.min.x + box.max.x) / 2) >= 0 ? px : -px;
        else p.z += (p.z - (box.min.z + box.max.z) / 2) >= 0 ? pz : -pz;
      }
    }
    // Yard bounds: the depot fence is the map edge.
    p.x = Math.max(-16.6, Math.min(16.6, p.x));
    p.z = Math.max(-14.6, Math.min(14.6, p.z));
  }

  function step(dt, keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    state.crouched = keys.has('ControlLeft') || keys.has('KeyC');
    state.sneaking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const targetEye = state.crouched ? EYE_CROUCH : EYE_STAND;
    state.eye += (targetEye - state.eye) * Math.min(1, dt * 12);
    const speed = state.crouched ? CROUCH_SPEED : state.sneaking ? SNEAK_SPEED : WALK_SPEED;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    // Forward is -Z rotated by yaw; strafe is +X rotated by yaw.
    tmp.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
    if (tmp.lengthSq() > 0) tmp.normalize().multiplyScalar(speed);
    // Exponential approach to the target velocity: acceleration when moving,
    // friction when the keys are released.
    const rate = tmp.lengthSq() > 0 ? ACCEL / speed : FRICTION;
    state.velocity.x += (tmp.x - state.velocity.x) * Math.min(1, rate * dt);
    state.velocity.z += (tmp.z - state.velocity.z) * Math.min(1, rate * dt);
    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;
    collide();
  }

  function look(dx, dy) {
    state.yaw -= dx * 0.0021;
    state.pitch -= dy * 0.0021;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch += pitchKick;
    state.yaw += yawKick;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
  }

  function groundSpeed() {
    return Math.hypot(state.velocity.x, state.velocity.z);
  }

  // Damage first eats armour (armour absorbs half), then health.
  function takeDamage(amount) {
    let rest = amount;
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, Math.ceil(amount / 2));
      state.armor -= absorbed;
      rest = amount - absorbed;
    }
    state.health -= rest;
    return state.health;
  }

  return { state, reset, step, look, recoil, groundSpeed, takeDamage };
}
