// Duskline Depot defenders: five bots with roles. Two holders guard the
// sites, a rotator patrols between them, a hunter tracks the striker, and the
// fifth bot defuses a planted spike. States: hold, patrol, rotate,
// investigate (heard something), hunt (knows roughly where you are), engage
// (sees you) and defuse. Bots see through a vision cone with a line-of-sight
// raycast that smoke blocks, hear loud shots, and converge on a planted spike.
// Their shots are bursts with a reaction delay and spread, so a careful
// player can win a duel — but a bot that hears you will come looking.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';

const BOT_SPEED = 3.1;
const HUNT_SPEED = 4.1;
const VISION_RANGE = 26;
const VISION_HALF_ANGLE = 1.15;
const DEFUSE_SECONDS = 5;
const NAMES = ['Vex', 'Mara', 'Ilya', 'Sable', 'Rook'];

export function createBots(scene, map, playerHitMeshes, onBotShot, hooks) {
  const random = mulberry32(hooks?.seed ?? 7);
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const losBlocked = hooks?.losBlocked ?? (() => false);
  const dir = new THREE.Vector3();
  const toPlayer = new THREE.Vector3();

  const bodyGeo = new THREE.BoxGeometry(0.62, 1.05, 0.38);
  const headGeo = new THREE.SphereGeometry(0.21, 10, 8);
  const legGeo = new THREE.BoxGeometry(0.5, 0.55, 0.34);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.62);
  const visorGeo = new THREE.BoxGeometry(0.3, 0.07, 0.05);

  function buildBot(index, spawn) {
    const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5e2b26'), roughness: 0.75, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2320'), roughness: 0.8, metalness: 0.2 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(bodyGeo, suit);
    torso.position.y = 1.05;
    torso.castShadow = true;
    torso.userData.bot = null; // wired below
    const head = new THREE.Mesh(headGeo, dark);
    head.position.y = 1.72;
    head.castShadow = true;
    const visor = new THREE.Mesh(visorGeo, new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.amber), emissive: new THREE.Color(PALETTE.amber), emissiveIntensity: 1.2,
    }));
    visor.position.set(0, 1.74, 0.19);
    const legs = new THREE.Mesh(legGeo, dark);
    legs.position.y = 0.28;
    const gun = new THREE.Mesh(gunGeo, dark);
    gun.position.set(0.2, 1.15, -0.35);
    group.add(torso, head, visor, legs, gun);
    group.position.set(spawn.x, 0, spawn.z);
    scene.add(group);
    const bot = {
      index,
      name: NAMES[index],
      role: spawn.role,
      site: spawn.site,
      group,
      torso,
      head,
      position: group.position,
      yaw: Math.PI,
      health: 100,
      alive: true,
      state: 'hold',
      waitLeft: 1 + random() * 2,
      path: [],
      pathIndex: 0,
      targetNode: null,
      lastKnown: null,
      lastKnownTime: -100,
      reaction: 0.35 + random() * 0.35,
      burstLeft: 0,
      burstPause: 0,
      defuseProgress: 0,
      defuseDone: false,
      fall: 0,
      patrolTarget: null,
      skill: 0.75 + random() * 0.4,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    return bot;
  }

  const bots = map.botSpawns.map((spawn, i) => buildBot(i, spawn));

  function reset() {
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      const spawn = map.botSpawns[i];
      bot.position.set(spawn.x, 0, spawn.z);
      bot.yaw = Math.PI;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.health = 100;
      bot.alive = true;
      bot.state = 'hold';
      bot.waitLeft = 1 + random() * 2;
      bot.path = [];
      bot.pathIndex = 0;
      bot.lastKnown = null;
      bot.defuseProgress = 0;
      bot.defuseDone = false;
      bot.fall = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.group.visible = true;
    }
  }

  function aliveCount() {
    let n = 0;
    for (const bot of bots) if (bot.alive) n += 1;
    return n;
  }

  function nearestNodeTo(bot) {
    return map.nearestNode(bot.position.x, bot.position.z);
  }

  function goTo(bot, nodeId) {
    const from = nearestNodeTo(bot);
    bot.path = map.findPath(from.id, nodeId);
    bot.pathIndex = 0;
  }

  function randomPatrolNode(bot) {
    const candidates = bot.site === 'A' ? ['a1', 'a2', 'w3', 'c3'] : ['b1', 'b2', 'e3', 'wh1', 'wh2'];
    return candidates[Math.floor(random() * candidates.length)];
  }

  // Vision: in range, inside the cone, line of sight clear, smoke not in the
  // way. Returns true when the bot can currently see the player.
  function canSee(bot, player) {
    const p = player.state.position;
    toPlayer.set(p.x - bot.position.x, 0, p.z - bot.position.z);
    const dist = toPlayer.length();
    if (dist > VISION_RANGE) return false;
    const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const angle = forward.angleTo(toPlayer.clone().normalize());
    if (angle > VISION_HALF_ANGLE && dist > 4) return false;
    dir.set(p.x - bot.position.x, (p.y + 1.5) - (bot.position.y + 1.5), p.z - bot.position.z).normalize();
    raycaster.set(new THREE.Vector3(bot.position.x, bot.position.y + 1.5, bot.position.z), dir);
    const hits = raycaster.intersectObjects(map.shootables, false);
    if (hits.length > 0 && hits[0].distance < dist - 0.5) return false;
    if (losBlocked(bot.position, p)) return false;
    return true;
  }

  function hear(position, time, loud) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
      if (d < (loud ? 26 : 12)) {
        bot.lastKnown = { x: position.x, z: position.z };
        bot.lastKnownTime = time;
        if (bot.state !== 'engage' && bot.state !== 'defuse') {
          bot.state = bot.role === 'hunter' ? 'hunt' : 'investigate';
          goTo(bot, nearestNodeTo(bot).id);
          bot.path = map.findPath(nearestNodeTo(bot).id, map.nearestNode(position.x, position.z).id);
          bot.pathIndex = 0;
        }
      }
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.fall = 0.0001;
      // A teammate going down tells the hunter where it happened.
      for (const other of bots) {
        if (other.alive && other.role === 'hunter') {
          other.lastKnown = { x: bot.position.x, z: bot.position.z };
          other.lastKnownTime = 9999;
          other.state = 'hunt';
          other.path = map.findPath(nearestNodeTo(other).id, map.nearestNode(bot.position.x, bot.position.z).id);
          other.pathIndex = 0;
        }
      }
      return true;
    }
    // Being shot at makes a bot turn toward the shooter.
    bot.lastKnown = null;
    return false;
  }

  function moveAlongPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = bot.path[bot.pathIndex];
    const dx = node.x - bot.position.x;
    const dz = node.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const step = Math.min(dist, speed * dt);
    bot.position.x += (dx / dist) * step;
    bot.position.z += (dz / dist) * step;
    const targetYaw = Math.atan2(-dx, -dz);
    let diff = targetYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += diff * Math.min(1, dt * 8);
    return false;
  }

  function resolveWalls(bot) {
    const p = bot.position;
    for (const box of map.colliders) {
      // Flat ground never blocks horizontal movement (see player.js).
      if (box.max.y <= 0.05) continue;
      if (p.y > box.max.y || p.y + 1.7 < box.min.y) continue;
      const cx = Math.max(box.min.x, Math.min(p.x, box.max.x));
      const cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= 0.36 * 0.36 || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (0.36 - d) / d;
      p.x += dx * push;
      p.z += dz * push;
    }
  }

  function botShoot(bot, dt, player, time) {
    // Bursts of 3-5 with a pause between; accuracy scales with the bot's
    // skill and the player's movement. Damage falls off with distance.
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.burstPause = 0.12;
      return;
    }
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.burstPause = 0.7 + random() * 0.6;
    const p = player.state.position;
    const dist = Math.hypot(p.x - bot.position.x, p.z - bot.position.z);
    const moving = Math.hypot(player.state.velocity.x, player.state.velocity.z);
    const spread = (0.02 + dist * 0.0016 + moving * 0.004) / bot.skill;
    dir.set(p.x - bot.position.x, (p.y + 1.35) - (bot.position.y + 1.45), p.z - bot.position.z);
    dir.x += (random() * 2 - 1) * spread * dist;
    dir.y += (random() * 2 - 1) * spread * dist * 0.6;
    dir.z += (random() * 2 - 1) * spread * dist;
    dir.normalize();
    raycaster.set(new THREE.Vector3(bot.position.x, bot.position.y + 1.45, bot.position.z), dir);
    const hits = raycaster.intersectObjects(map.shootables.concat(playerHitMeshes), false);
    const damage = Math.max(6, Math.round(24 - dist * 0.35));
    onBotShot(bot, hits, damage);
  }

  function stepBot(bot, dt, time, player, spike, phase) {
    if (!bot.alive) {
      if (bot.fall > 0 && bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt * 4);
        bot.group.rotation.x = -1.45 * bot.fall;
      }
      return;
    }
    // A planted spike pulls every living bot toward the plant site; the
    // closest one defuses while the rest hunt the planter.
    if (spike.state === 'planted' && phase === 'play') {
      const site = map.sites[spike.site];
      const dSite = Math.hypot(bot.position.x - site.plant.x, bot.position.z - site.plant.z);
      if (dSite < 1.6) {
        bot.state = 'defuse';
      } else if (bot.state !== 'defuse') {
        let closest = true;
        for (const other of bots) {
          if (other.alive && other !== bot && other.state === 'defuse') { closest = false; break; }
        }
        if (closest) {
          const myDist = Math.hypot(bot.position.x - site.plant.x, bot.position.z - site.plant.z);
          let nearer = false;
          for (const other of bots) {
            if (other.alive && other !== bot && Math.hypot(other.position.x - site.plant.x, other.position.z - site.plant.z) < myDist) { nearer = true; break; }
          }
          if (!nearer) {
            bot.state = 'defuse';
            goTo(bot, map.nearestNode(site.plant.x, site.plant.z).id);
          }
        }
      }
    }
    if (bot.state === 'defuse') {
      const site = map.sites[spike.site];
      if (spike.state !== 'planted') { bot.state = 'hold'; bot.defuseProgress = 0; return; }
      const arrived = moveAlongPath(bot, dt, BOT_SPEED);
      resolveWalls(bot);
      if (arrived) {
        bot.defuseProgress += dt;
        if (bot.defuseProgress >= DEFUSE_SECONDS) bot.defuseDone = true;
      }
      bot.group.rotation.y = bot.yaw;
      return;
    }

    const sees = phase === 'play' && canSee(bot, player);
    if (sees) {
      bot.state = 'engage';
      bot.lastKnown = { x: player.state.position.x, z: player.state.position.z };
      bot.lastKnownTime = time;
    } else if (bot.state === 'engage') {
      // Lost sight: the hunter keeps hunting the last known spot; others
      // fall back to investigating it, then return to their post.
      bot.state = bot.role === 'hunter' ? 'hunt' : 'investigate';
      if (bot.lastKnown) {
        bot.path = map.findPath(nearestNodeTo(bot).id, map.nearestNode(bot.lastKnown.x, bot.lastKnown.z).id);
        bot.pathIndex = 0;
      }
    }

    if (bot.state === 'engage') {
      const p = player.state.position;
      const dx = p.x - bot.position.x;
      const dz = p.z - bot.position.z;
      const targetYaw = Math.atan2(-dx, -dz);
      let diff = targetYaw - bot.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      bot.yaw += diff * Math.min(1, dt * 10);
      bot.reaction -= dt;
      if (bot.reaction <= 0) botShoot(bot, dt, player, time);
      // Sidestep while duelling so bots are not standing targets.
      if (Math.abs(diff) < 0.2) {
        bot.position.x += Math.sin(bot.yaw + Math.PI / 2) * Math.sin(time * 1.3 + bot.index) * dt * 0.8;
        bot.position.z += Math.cos(bot.yaw + Math.PI / 2) * Math.sin(time * 1.3 + bot.index) * dt * 0.8;
        resolveWalls(bot);
      }
    } else if (bot.state === 'hunt' || bot.state === 'investigate') {
      const arrived = moveAlongPath(bot, dt, bot.state === 'hunt' ? HUNT_SPEED : BOT_SPEED);
      resolveWalls(bot);
      if (arrived) {
        // Reached the last known spot and found nobody: look around, then
        // the hunter picks a new sweep and the investigator goes home.
        bot.waitLeft -= dt;
        bot.yaw += dt * 1.2;
        if (bot.waitLeft <= 0) {
          if (bot.role === 'hunter') {
            bot.state = 'hunt';
            goTo(bot, randomPatrolNode(bot));
            bot.waitLeft = 2;
          } else {
            bot.state = bot.role === 'rotator' ? 'rotate' : 'hold';
            goTo(bot, map.nearestNode(map.botSpawns[bot.index].x, map.botSpawns[bot.index].z).id);
          }
        }
      }
    } else if (bot.state === 'rotate') {
      if (bot.pathIndex >= bot.path.length) {
        bot.waitLeft -= dt;
        if (bot.waitLeft <= 0) {
          goTo(bot, randomPatrolNode(bot));
          bot.waitLeft = 1.5 + random() * 2;
        }
      } else {
        moveAlongPath(bot, dt, BOT_SPEED);
        resolveWalls(bot);
      }
    } else {
      // hold: mostly stay, but shuffle between two nearby posts so the site
      // is never guarded from exactly one angle.
      bot.waitLeft -= dt;
      if (bot.waitLeft <= 0) {
        if (bot.pathIndex >= bot.path.length) {
          goTo(bot, randomPatrolNode(bot));
          bot.waitLeft = 2 + random() * 3;
        } else {
          const arrived = moveAlongPath(bot, dt, BOT_SPEED * 0.7);
          resolveWalls(bot);
          if (arrived) bot.waitLeft = 2 + random() * 3;
        }
      }
      // Holders scan: slow yaw sweep while waiting.
      if (bot.pathIndex >= bot.path.length) bot.yaw += dt * 0.35;
    }
    bot.group.rotation.y = bot.yaw;
  }

  function stepAll(dt, time, player, spike, phase) {
    for (const bot of bots) stepBot(bot, dt, time, player, spike, phase);
  }

  function aimPoint(index) {
    const bot = bots[index];
    return new THREE.Vector3(bot.position.x, bot.position.y + 1.4, bot.position.z);
  }

  return {
    bots,
    reset,
    aliveCount,
    stepAll,
    hear,
    damage,
    canSee,
    aimPoint,
  };
}
