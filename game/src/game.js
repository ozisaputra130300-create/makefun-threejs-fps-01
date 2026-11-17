// Duskline Depot match: one striker against five guards, first to 6 rounds
// (max 11). The single state store lives here — phase, round, money, charge,
// grenades, smoke — and the fixed-step loop in main.js calls step() sixty
// times a second. Rendering never writes to it; only this module and the bots
// move it. The charge is planted at the Crane Yard (A) or the Warehouse (B);
// a planted charge detonates after 40 s unless a guard defuses it.
import * as THREE from 'three';
import { WEAPONS, ARMOR_PRICE } from './weapons.js';
import { PALETTE } from './palette.js';

const ROUND_SECONDS = 90;
const BUY_SECONDS = 12;
const PLANT_SECONDS = 3;
const FUSE_SECONDS = 40;
const WIN_ROUNDS = 6;
const MAX_ROUNDS = 11;
const KILL_REWARD = 300;
const PLANT_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const START_MONEY = 800;

export function createGame(deps) {
  const { scene, camera, map, player, arsenal, hud, input, audio } = deps;
  let bots = deps.bots || null;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const direction = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();

  // Invisible hitbox the bots shoot at: a body box and a head sphere.
  const hitBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.35, 0.7),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitBody.userData.part = 'torso';
  const hitHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitHead.userData.part = 'head';
  scene.add(hitBody, hitHead);
  const playerHitMeshes = [hitBody, hitHead];

  // Pooled tracers and impact sparks: no new objects in the hot loop.
  const tracers = [];
  for (let i = 0; i < 12; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;
  const sparks = [];
  for (let i = 0; i < 8; i += 1) {
    const spark = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.money), transparent: true, opacity: 0 }),
    );
    spark.visible = false;
    scene.add(spark);
    sparks.push({ mesh: spark, life: 0 });
  }
  let sparkIndex = 0;
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 22, 1.6);
  scene.add(boomLight);
  const boomShell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0, depthWrite: false }),
  );
  boomShell.visible = false;
  scene.add(boomShell);
  let boomLife = 0;

  // Smoke clouds: pooled translucent spheres. A cloud blocks bot vision when
  // the sight line passes through it (bots ask losBlocked).
  const smokes = [];
  for (let i = 0; i < 3; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 14, 10),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.smoke), transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, life: 0 });
  }
  let smokeIndex = 0;

  const state = {
    phase: 'menu',
    round: 1,
    wins: { you: 0, foes: 0 },
    money: START_MONEY,
    timer: BUY_SECONDS,
    charge: { state: 'carried', site: null, fuse: 0, plantProgress: 0 },
    grenades: [],
    time: 0,
    plantSite: null,
    kills: 0,
    deaths: 0,
  };

  function syncPlayerHitbox() {
    const p = player.state;
    hitBody.position.set(p.position.x, p.position.y + 0.85, p.position.z);
    hitHead.position.set(p.position.x, p.position.y + p.eye + 0.05, p.position.z);
  }

  function spawnTracer(from, to) {
    const t = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.material.opacity = 0.85;
    t.life = 0.09;
  }

  function spawnSpark(point) {
    const s = sparks[sparkIndex];
    sparkIndex = (sparkIndex + 1) % sparks.length;
    s.mesh.position.copy(point);
    s.mesh.visible = true;
    s.mesh.material.opacity = 0.95;
    s.mesh.scale.setScalar(1);
    s.life = 0.22;
  }

  // The view is derived from player state (position, eye, yaw, pitch), not
  // from the render camera: the simulation must shoot straight even when no
  // frame has rendered since the player moved (headless tests, slow frames).
  function viewOrigin(out) {
    const p = player.state;
    return out.set(p.position.x, p.position.y + p.eye, p.position.z);
  }
  function viewDirection(out) {
    const p = player.state;
    const cp = Math.cos(p.pitch);
    return out.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
  }

  function muzzlePoint() {
    viewOrigin(muzzle);
    viewDirection(direction);
    const right = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
    return muzzle.addScaledVector(direction, 0.5).addScaledVector(right, 0.22).add(new THREE.Vector3(0, -0.14, 0));
  }

  // Does the segment from a to b pass through any live smoke cloud?
  function losBlocked(a, b) {
    for (const s of smokes) {
      if (s.life <= 0) continue;
      const c = s.mesh.position;
      tmpVec.set(b.x - a.x, 0, b.z - a.z);
      const len2 = tmpVec.lengthSq();
      if (len2 < 1e-6) continue;
      let t = ((c.x - a.x) * tmpVec.x + (c.z - a.z) * tmpVec.z) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + tmpVec.x * t;
      const pz = a.z + tmpVec.z * t;
      const dy = Math.abs(1.2 - c.y);
      if (Math.hypot(px - c.x, pz - c.z) < 3.2 && dy < 3.2) return true;
    }
    return false;
  }

  function shoot(spread) {
    const def = arsenal.current;
    if (def.id === 'frag' || def.id === 'smoke') {
      throwGrenade(def.id);
      return;
    }
    if (!arsenal.takeRound(state.time)) {
      audio.dryFire();
      return;
    }
    const pellets = def.pellets ?? 1;
    let hitAny = false;
    for (let p = 0; p < pellets; p += 1) {
      viewDirection(direction);
      direction.x += (Math.random() * 2 - 1) * spread;
      direction.y += (Math.random() * 2 - 1) * spread;
      direction.z += (Math.random() * 2 - 1) * spread;
      direction.normalize();
      scene.updateMatrixWorld(true);
      viewOrigin(tmpVec);
      raycaster.set(tmpVec, direction);
      const botMeshes = [];
      for (const bot of bots.bots) {
        if (bot.alive) botMeshes.push(bot.torso, bot.head);
      }
      const hits = raycaster.intersectObjects(map.shootables.concat(botMeshes), false);
      const from = muzzlePoint();
      if (hits.length > 0) {
        const hit = hits[0];
        spawnTracer(from, hit.point);
        const bot = hit.object.userData.bot;
        if (bot) {
          hitAny = true;
          const killed = bots.damage(bot, hit.object.userData.part === 'head' ? def.headDamage : def.damage);
          hud.hitMarker(killed);
          audio.hit(killed);
          if (killed) {
            state.kills += 1;
            state.money += KILL_REWARD;
            hud.killfeed(`You dropped ${bot.name} (${hit.object.userData.part === 'head' ? 'headshot' : def.name})`);
            hud.setMoney(state.money);
            if (bots.aliveCount() === 0) {
              endRound(true, state.charge.state === 'planted' ? 'Charge armed, depot clear' : 'All guards down');
              return;
            }
          }
        } else {
          spawnSpark(hit.point);
        }
      } else {
        viewOrigin(tmpVec);
        spawnTracer(from, tmpVec.addScaledVector(direction, 60));
      }
    }
    arsenal.pullTrigger();
    player.recoil(0.009 + Math.random() * 0.005, (Math.random() * 2 - 1) * 0.004);
    audio.shot(def.id);
    bots.hear(player.state.position, state.time, !player.state.sneaking);
    hud.setAmmo(arsenal.ammo.mag, arsenal.ammo.reserve);
  }

  function throwGrenade(kind) {
    if (!arsenal.takeRound(state.time)) {
      audio.dryFire();
      return;
    }
    viewDirection(direction);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(kind === 'smoke' ? PALETTE.teal : PALETTE.amber), roughness: 0.4, metalness: 0.5 }),
    );
    viewOrigin(tmpVec);
    mesh.position.copy(tmpVec).addScaledVector(direction, 0.4);
    scene.add(mesh);
    state.grenades.push({
      mesh,
      kind,
      velocity: direction.clone().multiplyScalar(12).add(new THREE.Vector3(0, 4.2, 0)),
      fuse: kind === 'smoke' ? 1.4 : 1.7,
    });
    arsenal.pullTrigger();
    audio.shot(kind);
  }

  function explodeGrenade(g) {
    scene.remove(g.mesh);
    const center = g.mesh.position.clone();
    if (g.kind === 'smoke') {
      const s = smokes[smokeIndex];
      smokeIndex = (smokeIndex + 1) % smokes.length;
      s.mesh.position.set(center.x, 1.4, center.z);
      s.mesh.visible = true;
      s.mesh.material.opacity = 0.55;
      s.life = 12;
      audio.smokePop();
      return;
    }
    boomLight.position.copy(center);
    boomLight.intensity = 60;
    boomShell.position.copy(center);
    boomShell.visible = true;
    boomShell.scale.setScalar(0.2);
    boomLife = 0.45;
    audio.explosion();
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.position.x - center.x, bot.position.z - center.z) + Math.abs(bot.position.y - center.y) * 0.5;
      if (d < 6.5) {
        const damage = Math.round(90 - (d / 6.5) * 72);
        const killed = bots.damage(bot, damage);
        if (killed) {
          state.kills += 1;
          state.money += KILL_REWARD;
          hud.killfeed(`You dropped ${bot.name} (frag)`);
          hud.setMoney(state.money);
        }
      }
    }
    const pd = Math.hypot(player.state.position.x - center.x, player.state.position.z - center.z);
    if (pd < 4) hurtPlayer(Math.round((1 - pd / 4) * 40));
    if (bots.aliveCount() === 0 && state.phase === 'play') {
      endRound(true, 'All guards down');
    }
  }

  function hurtPlayer(amount, headshot = false) {
    if (state.phase !== 'play' && state.phase !== 'buy') return;
    player.takeDamage(headshot ? amount * 1.5 : amount);
    hud.setHealth(player.state.health);
    hud.setArmor(player.state.armor);
    hud.damageFlash();
    audio.hurt();
    if (player.state.health <= 0) {
      player.state.health = 0;
      state.deaths += 1;
      endRound(false, 'Striker down');
    }
  }

  function onBotShot(bot, hits, damage) {
    audio.enemyShot();
    const from = new THREE.Vector3(bot.position.x, bot.position.y + 1.45, bot.position.z);
    if (hits.length > 0 && (hits[0].object === hitBody || hits[0].object === hitHead)) {
      spawnTracer(from, hits[0].point);
      hurtPlayer(damage, hits[0].object === hitHead);
    } else if (hits.length > 0) {
      spawnTracer(from, hits[0].point);
      spawnSpark(hits[0].point);
    } else {
      spawnTracer(from, from.clone().add(new THREE.Vector3(0, 0, -1)));
    }
  }

  function siteAt(position) {
    for (const site of Object.values(map.sites)) {
      if (site.zone.containsPoint(new THREE.Vector3(position.x, 0.5, position.z))) return site;
    }
    return null;
  }

  function startRound() {
    bots.reset();
    player.reset();
    arsenal.refill();
    for (const g of state.grenades) scene.remove(g.mesh);
    state.grenades = [];
    state.charge = { state: 'carried', site: null, fuse: 0, plantProgress: 0 };
    state.timer = BUY_SECONDS;
    state.phase = 'buy';
    hud.setHealth(player.state.health);
    hud.setArmor(player.state.armor);
    hud.setAmmo(arsenal.ammo.mag, arsenal.ammo.reserve);
    hud.setMoney(state.money);
    hud.setScore(state.wins.you, state.wins.foes);
    hud.setAlive(1, bots.aliveCount());
    hud.setWeapon(arsenal.current.name);
    hud.setSpike(null, 0);
    hud.setSite('Duskline Depot');
    hud.banner(`Round ${state.round}`, 'Buy up — B opens the market');
    hud.showBuy(buyItems(), state.money);
  }

  function buyItems() {
    const list = [];
    const defs = [
      { id: 'vex', key: '1', name: 'Vex SMG' },
      { id: 'longhaul', key: '2', name: 'Longhaul AR-77' },
      { id: 'riot', key: '3', name: 'Riot-12 Shotgun' },
      { id: 'needle', key: '4', name: 'Needle DMR' },
      { id: 'saw', key: '5', name: 'Saw-60 LMG' },
      { id: 'frag', key: '6', name: 'Frag Grenade' },
      { id: 'smoke', key: '7', name: 'Smoke Grenade' },
      { id: 'armor', key: '8', name: 'Body Armour (50)' },
    ];
    for (const d of defs) {
      if (d.id === 'armor') {
        list.push({
          ...d, price: ARMOR_PRICE, owned: player.state.armor >= 50,
          disabled: player.state.armor >= 50 || state.money < ARMOR_PRICE,
          onBuy: (id) => buy(id),
        });
        continue;
      }
      const def = WEAPONS[d.id];
      const pouch = arsenal.owned[d.id];
      const count = d.id === 'frag' || d.id === 'smoke'
        ? (pouch ? pouch.mag + pouch.reserve : 0) : 0;
      const owned = d.id === 'frag' || d.id === 'smoke' ? count >= 2 : Boolean(pouch);
      list.push({
        ...d,
        price: def.price,
        owned,
        disabled: d.id === 'frag' || d.id === 'smoke'
          ? count >= 2 || state.money < def.price
          : Boolean(pouch) || state.money < def.price,
        onBuy: (id) => buy(id),
      });
    }
    return list;
  }

  function buy(id) {
    if (state.phase !== 'buy') return;
    if (id === 'armor') {
      if (player.state.armor >= 50 || state.money < ARMOR_PRICE) return;
      state.money -= ARMOR_PRICE;
      player.state.armor = 50;
      audio.buy();
    } else if (id === 'frag' || id === 'smoke') {
      const before = state.money;
      state.money = arsenal.buyGrenade(id, state.money);
      if (state.money !== before) audio.buy();
    } else {
      const before = state.money;
      state.money = arsenal.buy(id, state.money);
      if (state.money !== before) {
        audio.buy();
        arsenal.select(id);
        hud.setWeapon(arsenal.current.name);
      }
    }
    hud.setMoney(state.money);
    hud.setArmor(player.state.armor);
    hud.setAmmo(arsenal.ammo.mag, arsenal.ammo.reserve);
    hud.showBuy(buyItems(), state.money);
  }

  function endRound(won, reason) {
    if (state.phase !== 'play' && state.phase !== 'buy') return;
    state.phase = 'roundEnd';
    if (won) {
      state.wins.you += 1;
      state.money += WIN_REWARD;
    } else {
      state.wins.foes += 1;
      state.money += LOSS_REWARD;
    }
    hud.setScore(state.wins.you, state.wins.foes);
    hud.setMoney(state.money);
    hud.hideBuy();
    hud.setSpike(null, 0);
    if (won) audio.roundWin();
    else audio.roundLoss();
    hud.banner(won ? 'Round won' : 'Round lost', reason);
    if (state.wins.you >= WIN_ROUNDS || state.wins.foes >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      endMatch(state.wins.you > state.wins.foes);
    } else {
      hud.showOverlay(won ? 'roundWin' : 'roundLoss', `${state.wins.you} — ${state.wins.foes} · ${reason}`);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  function endMatch(youWon) {
    state.phase = 'matchEnd';
    hud.showOverlay(youWon ? 'matchWin' : 'matchLoss', `${state.wins.you} — ${state.wins.foes} · ${state.kills} eliminations`);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function startMatch() {
    state.round = 1;
    state.wins = { you: 0, foes: 0 };
    state.money = START_MONEY;
    state.kills = 0;
    state.deaths = 0;
    startRound();
  }

  function nextRound() {
    state.round += 1;
    startRound();
  }

  function step(dt) {
    state.time += dt;
    syncPlayerHitbox();
    arsenal.update(dt, state.time);
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
      }
    }
    for (const s of sparks) {
      if (s.life > 0) {
        s.life -= dt;
        s.mesh.scale.setScalar(1 + (0.22 - s.life) * 6);
        s.mesh.material.opacity = Math.max(0, s.life / 0.22) * 0.95;
        if (s.life <= 0) s.mesh.visible = false;
      }
    }
    if (boomLife > 0) {
      boomLife -= dt;
      boomLight.intensity = Math.max(0, boomLife / 0.45) * 60;
      boomShell.scale.setScalar(0.2 + (0.45 - boomLife) * 22);
      boomShell.material.opacity = Math.max(0, boomLife / 0.45) * 0.5;
      if (boomLife <= 0) boomShell.visible = false;
    }
    for (const s of smokes) {
      if (s.life > 0) {
        s.life -= dt;
        s.mesh.material.opacity = Math.max(0, s.life / 12) * 0.55;
        if (s.life <= 0) s.mesh.visible = false;
      }
    }
    for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
      const g = state.grenades[i];
      g.velocity.y -= 14 * dt;
      g.mesh.position.addScaledVector(g.velocity, dt);
      if (g.mesh.position.y < 0.07) {
        g.mesh.position.y = 0.07;
        g.velocity.y = Math.abs(g.velocity.y) * 0.35;
        g.velocity.x *= 0.6;
        g.velocity.z *= 0.6;
      }
      // Walls stop a grenade: push it out of the shallowest face and
      // reflect that velocity component, so a throw never leaves the depot.
      for (const box of map.colliders) {
        if (box.max.y <= 0.05) continue;
        const p = g.mesh.position;
        if (p.x < box.min.x - 0.07 || p.x > box.max.x + 0.07
          || p.y < box.min.y - 0.07 || p.y > box.max.y + 0.07
          || p.z < box.min.z - 0.07 || p.z > box.max.z + 0.07) continue;
        const dxMin = p.x - (box.min.x - 0.07);
        const dxMax = (box.max.x + 0.07) - p.x;
        const dyMin = p.y - (box.min.y - 0.07);
        const dyMax = (box.max.y + 0.07) - p.y;
        const dzMin = p.z - (box.min.z - 0.07);
        const dzMax = (box.max.z + 0.07) - p.z;
        const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
        if (m === dxMin) { p.x = box.min.x - 0.07; g.velocity.x = -Math.abs(g.velocity.x) * 0.4; }
        else if (m === dxMax) { p.x = box.max.x + 0.07; g.velocity.x = Math.abs(g.velocity.x) * 0.4; }
        else if (m === dyMin) { p.y = box.min.y - 0.07; g.velocity.y = -Math.abs(g.velocity.y) * 0.4; }
        else if (m === dyMax) { p.y = box.max.y + 0.07; g.velocity.y = Math.abs(g.velocity.y) * 0.4; }
        else if (m === dzMin) { p.z = box.min.z - 0.07; g.velocity.z = -Math.abs(g.velocity.z) * 0.4; }
        else { p.z = box.max.z + 0.07; g.velocity.z = Math.abs(g.velocity.z) * 0.4; }
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        state.grenades.splice(i, 1);
        explodeGrenade(g);
      }
    }

    if (state.phase === 'menu' || state.phase === 'roundEnd' || state.phase === 'matchEnd') return;

    state.timer -= dt;
    if (state.phase === 'buy' && state.timer <= 0) {
      state.phase = 'play';
      state.timer = ROUND_SECONDS;
      hud.hideBuy();
      hud.banner('Go', 'Plant the charge at A or B');
    } else if (state.phase === 'play' && state.timer <= 0) {
      if (state.charge.state === 'planted') {
        endRound(true, 'Charge detonated the depot');
        return;
      }
      endRound(false, 'Time expired — charge never planted');
      return;
    }

    if (state.charge.state === 'planted') {
      state.charge.fuse -= dt;
      hud.setSpike('planted', 1 - state.charge.fuse / FUSE_SECONDS);
      if (state.charge.fuse <= 0) {
        state.charge.state = 'detonated';
        endRound(true, 'Charge detonated');
        return;
      }
    }

    for (const bot of bots.bots) {
      if (bot.defuseDone) {
        state.charge.state = 'defused';
        endRound(false, `${bot.name} defused the charge`);
        return;
      }
    }

    // Planting: hold E inside a site, standing still.
    const site = siteAt(player.state.position);
    hud.setSite(site ? `${site.id} — ${site.name}` : state.phase === 'buy' ? 'Duskline Depot' : 'Mid yard');
    if (state.phase === 'play' && state.charge.state === 'carried' && site) {
      if (input.state.keys.has('KeyE') && player.groundSpeed() < 1.2) {
        state.charge.plantProgress += dt;
        hud.setSpike('planting', state.charge.plantProgress / PLANT_SECONDS);
        if (Math.floor(state.charge.plantProgress * 2) !== Math.floor((state.charge.plantProgress - dt) * 2)) audio.plantBeep();
        if (state.charge.plantProgress >= PLANT_SECONDS) {
          state.charge.state = 'planted';
          state.charge.site = site.id;
          state.charge.fuse = FUSE_SECONDS;
          state.charge.plantProgress = 0;
          state.money += PLANT_REWARD;
          hud.setMoney(state.money);
          hud.killfeed(`Charge planted at ${site.id} — ${site.name}`);
          audio.plantBeep();
        }
      } else {
        state.charge.plantProgress = Math.max(0, state.charge.plantProgress - dt * 2);
        if (state.charge.state === 'carried') hud.setSpike(null, 0);
      }
    }

    const defusing = bots.bots.find((b) => b.alive && b.state === 'defuse');
    if (defusing && state.charge.state === 'planted') {
      hud.setSpike('defusing', (defusing.defuseProgress || 0) / 5);
    }

    player.step(dt, input.state.keys);
    bots.stepAll(dt, state.time, player, state.charge, state.phase);
    arsenal.setZoom(input.state.zoomHeld && input.state.locked);
    camera.fov += ((arsenal.state.zoomed ? 74 / arsenal.current.zoom : 74) - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
    if (state.phase === 'play' && input.state.firing && arsenal.current.auto && arsenal.ready(state.time)) {
      shoot(arsenal.spread(player.groundSpeed(), player.state.crouched, arsenal.state.zoomed));
    }
    if (input.wasPressed('KeyR')) {
      if (arsenal.reload(state.time)) audio.reload();
      input.consumePressed('KeyR');
    }
    if (input.wasPressed('KeyB') && state.phase === 'buy') {
      hud.showBuy(buyItems(), state.money);
      if (document.pointerLockElement) document.exitPointerLock();
      input.consumePressed('KeyB');
    }
    // Weapon keys only outside the buy phase: during buy, digits 1-8 buy.
    if (state.phase !== 'buy') {
      if (input.wasPressed('Digit1')) { arsenal.selectSlot(1); input.consumePressed('Digit1'); }
      if (input.wasPressed('Digit2')) { arsenal.selectSlot(2); input.consumePressed('Digit2'); }
      if (input.wasPressed('Digit3')) { arsenal.selectSlot(3); input.consumePressed('Digit3'); }
      if (input.wasPressed('KeyQ')) { arsenal.cycle(); input.consumePressed('KeyQ'); }
    }
    if (input.wasPressed('KeyG')) {
      if (arsenal.currentId === 'frag' || arsenal.currentId === 'smoke') {
        if (arsenal.ready(state.time)) shoot(0);
      } else {
        arsenal.selectSlot(3);
      }
      input.consumePressed('KeyG');
    }
    // Buy-menu number keys 1-8.
    if (state.phase === 'buy') {
      const buyIds = ['vex', 'longhaul', 'riot', 'needle', 'saw', 'frag', 'smoke', 'armor'];
      for (let i = 0; i < buyIds.length; i += 1) {
        const code = `Digit${i + 1}`;
        if (input.wasPressed(code)) {
          buy(buyIds[i]);
          input.consumePressed(code);
        }
      }
    }

    hud.setHealth(player.state.health);
    hud.setArmor(player.state.armor);
    hud.setAmmo(arsenal.ammo.mag, arsenal.ammo.reserve);
    hud.setTimer(state.timer);
    hud.setAlive(1, bots.aliveCount());
    hud.setWeapon(arsenal.current.name);
    hud.setCrosshairSpread(10 + arsenal.spread(player.groundSpeed(), player.state.crouched, arsenal.state.zoomed) * 900);
  }

  return {
    state,
    playerHitMeshes,
    losBlocked,
    smokeClouds: smokes,
    setBots(b) { bots = b; },
    startMatch,
    startRound,
    nextRound,
    buy,
    shoot,
    hurtPlayer,
    onBotShot,
    step,
    siteAt,
    teleportPlayer(x, z, yaw, pitch) {
      player.state.position.set(x, 0, z);
      player.state.velocity.set(0, 0, 0);
      player.state.yaw = yaw;
      player.state.pitch = pitch;
    },
    aimAt(point) {
      const p = player.state;
      const dx = point.x - p.position.x;
      const dy = point.y - (p.position.y + p.eye);
      const dz = point.z - p.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    },
  };
}
