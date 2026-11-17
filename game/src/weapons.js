// Duskline Depot arsenal: six guns, two grenades and body armour. Every gun
// has a price, damage, headshot damage, fire rate, magazine, reserve, reload
// time, spread (standing still / moving), recoil and whether it fires
// automatically. Spread grows with movement speed and shrinks when crouched
// or scoped, so stopping to aim pays. The player starts with the Mako-9.
import * as THREE from 'three';

export const WEAPONS = {
  mako: {
    id: 'mako', name: 'Mako-9 Pistol', price: 0, damage: 26, headDamage: 78,
    interval: 0.16, mag: 12, reserveAmmo: 48, reload: 1.1,
    spreadStill: 0.006, spreadMove: 0.03, recoil: 0.006, auto: false, zoom: 1,
    slot: 1,
  },
  vex: {
    id: 'vex', name: 'Vex SMG', price: 1200, damage: 20, headDamage: 60,
    interval: 0.085, mag: 28, reserveAmmo: 112, reload: 1.6,
    spreadStill: 0.011, spreadMove: 0.042, recoil: 0.005, auto: true, zoom: 1,
    slot: 1,
  },
  longhaul: {
    id: 'longhaul', name: 'Longhaul AR-77', price: 2700, damage: 34, headDamage: 136,
    interval: 0.11, mag: 30, reserveAmmo: 90, reload: 2.0,
    spreadStill: 0.007, spreadMove: 0.038, recoil: 0.011, auto: true, zoom: 1,
    slot: 1,
  },
  needle: {
    id: 'needle', name: 'Needle DMR', price: 3400, damage: 62, headDamage: 186,
    interval: 0.55, mag: 8, reserveAmmo: 32, reload: 2.4,
    spreadStill: 0.002, spreadMove: 0.05, recoil: 0.02, auto: false, zoom: 2.6,
    slot: 1,
  },
  riot: {
    id: 'riot', name: 'Riot-12 Shotgun', price: 1900, damage: 13, headDamage: 26,
    interval: 0.8, mag: 6, reserveAmmo: 24, reload: 2.6,
    spreadStill: 0.045, spreadMove: 0.07, recoil: 0.03, auto: false, zoom: 1,
    slot: 1, pellets: 7,
  },
  saw: {
    id: 'saw', name: 'Saw-60 LMG', price: 4200, damage: 26, headDamage: 78,
    interval: 0.095, mag: 60, reserveAmmo: 120, reload: 3.4,
    spreadStill: 0.014, spreadMove: 0.05, recoil: 0.009, auto: true, zoom: 1,
    slot: 1,
  },
  frag: {
    id: 'frag', name: 'Frag Grenade', price: 300, damage: 0, headDamage: 0,
    interval: 0.9, mag: 1, reserveAmmo: 0, reload: 0,
    spreadStill: 0, spreadMove: 0, recoil: 0, auto: false, zoom: 1, slot: 3,
  },
  smoke: {
    id: 'smoke', name: 'Smoke Grenade', price: 250, damage: 0, headDamage: 0,
    interval: 0.9, mag: 1, reserveAmmo: 0, reload: 0,
    spreadStill: 0, spreadMove: 0, recoil: 0, auto: false, zoom: 1, slot: 3,
  },
};
export const ARMOR_PRICE = 650;
export const GRENADE_LIMIT = 2;

// The arsenal owns one ammo pouch per weapon id plus the current selection.
// Slots: 1 = primary rifle/SMG/shotgun/LMG (the pistol is always slot 2),
// 3 = grenades. Selecting a grenade throws it on fire; buying one adds a
// single throw to the pouch.
export function createArsenal(camera) {
  const owned = {
    mako: { mag: WEAPONS.mako.mag, reserve: WEAPONS.mako.reserveAmmo },
  };
  let currentId = 'mako';
  let lastShot = -10;
  let reloadUntil = -1;
  const zoomState = { zoomed: false };
  // A simple first-person gun model: a dark box + barrel, parented to the
  // camera so it follows the view. Recoil kicks it back briefly.
  const gun = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x23252c, roughness: 0.55, metalness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xffb02e, roughness: 0.5, metalness: 0.3 });
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), bodyMat);
  const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), bodyMat);
  gunBarrel.position.set(0, 0.02, -0.38);
  const gunSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accentMat);
  gunSight.position.set(0, 0.09, -0.1);
  gun.add(gunBody, gunBarrel, gunSight);
  gun.position.set(0.24, -0.2, -0.45);
  camera.add(gun);
  let kick = 0;

  function current() {
    return WEAPONS[currentId];
  }
  function ammo() {
    return owned[currentId] ?? { mag: 0, reserve: 0 };
  }
  function has(id) {
    return Boolean(owned[id]);
  }
  function ready(now) {
    const def = current();
    return ammo().mag > 0 && now - lastShot >= def.interval && now >= reloadUntil;
  }
  function takeRound(now) {
    if (ammo().mag <= 0) return false;
    owned[currentId].mag -= 1;
    lastShot = now;
    return true;
  }
  function pullTrigger() {
    kick = 1;
  }
  function spread(speed, crouched, scoped) {
    const def = current();
    const moving = Math.min(1, speed / 4.5);
    let s = def.spreadStill + (def.spreadMove - def.spreadStill) * moving;
    if (crouched) s *= 0.6;
    if (scoped) s *= 0.45;
    return s;
  }
  function reload(now) {
    const def = current();
    const pouch = owned[currentId];
    if (!pouch || pouch.mag >= def.mag || pouch.reserve <= 0 || now < reloadUntil) return false;
    reloadUntil = now + def.reload;
    return true;
  }
  function finishReload() {
    const def = current();
    const pouch = owned[currentId];
    if (!pouch) return;
    const need = def.mag - pouch.mag;
    const take = Math.min(need, pouch.reserve);
    pouch.mag += take;
    pouch.reserve -= take;
  }
  function buy(id, money) {
    const def = WEAPONS[id];
    if (!def || id === 'frag' || id === 'smoke') return money;
    if (owned[id] || money < def.price) return money;
    owned[id] = { mag: def.mag, reserve: def.reserveAmmo };
    return money - def.price;
  }
  function buyGrenade(id, money) {
    const def = WEAPONS[id];
    if (!def || money < def.price) return money;
    const pouch = owned[id] ?? { mag: 0, reserve: 0 };
    if (pouch.mag + pouch.reserve >= GRENADE_LIMIT) return money;
    // Grenades are thrown from the magazine: each buy is one ready throw.
    pouch.mag += 1;
    owned[id] = pouch;
    return money - def.price;
  }
  function select(id) {
    if (!owned[id]) return false;
    currentId = id;
    return true;
  }
  function selectSlot(slot) {
    if (slot === 2) { select('mako'); return; }
    if (slot === 3) {
      if (owned.frag && (owned.frag.mag + owned.frag.reserve) > 0) select('frag');
      else if (owned.smoke && (owned.smoke.mag + owned.smoke.reserve) > 0) select('smoke');
      return;
    }
    // Slot 1: the most recently bought primary, or the first owned one.
    const primaries = ['saw', 'needle', 'longhaul', 'riot', 'vex'];
    for (const id of primaries) {
      if (owned[id]) { select(id); return; }
    }
  }
  function cycle() {
    const ids = Object.keys(owned).filter((id) => WEAPONS[id].slot !== 3);
    if (ids.length < 2) return;
    const index = ids.indexOf(currentId);
    select(ids[(index + 1) % ids.length]);
  }
  function refill() {
    for (const id of Object.keys(owned)) {
      const def = WEAPONS[id];
      if (def.slot === 3) continue;
      owned[id] = { mag: def.mag, reserve: def.reserveAmmo };
    }
    reloadUntil = -1;
  }
  function update(dt, now) {
    if (reloadUntil > 0 && now >= reloadUntil) {
      finishReload();
      reloadUntil = -1;
    }
    kick = Math.max(0, kick - dt * 6);
    gun.position.z = -0.45 + kick * 0.07;
    gun.rotation.x = kick * 0.12;
  }

  return {
    owned,
    get currentId() { return currentId; },
    get current() { return current(); },
    get ammo() { return ammo(); },
    get state() { return zoomState; },
    has,
    ready: (now) => ready(now),
    takeRound,
    pullTrigger,
    spread,
    reload: (now) => reload(now),
    buy,
    buyGrenade,
    select,
    selectSlot,
    cycle,
    refill,
    setZoom(zoomed) { zoomState.zoomed = zoomed; },
    update,
  };
}
