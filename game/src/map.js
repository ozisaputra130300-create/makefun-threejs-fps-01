// Duskline Depot map: a rail depot at dusk, 34 x 30 m. Three lanes run north
// from the attacker yard to two bomb sites — A, the Crane Yard (west, amber),
// and B, the Warehouse (east, teal). Between them: a container mid with rail
// tracks, a gantry walkway, and a second, enclosed area — the drainage tunnel
// — a low roofed passage that runs under the gantry from mid to the warehouse
// door, giving a quiet flank route. Every solid is a box: a collider for
// movement and a surface a bullet stops on. Waypoints form the graph the
// bots navigate on, including the tunnel and the warehouse interior.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WAYPOINTS = [
  { id: 'spawn', x: 0, z: 13 },
  { id: 'w1', x: -13, z: 9 },
  { id: 'w2', x: -13, z: 2 },
  { id: 'w3', x: -13, z: -5 },
  { id: 'a1', x: -11, z: -9 },
  { id: 'a2', x: -7.5, z: -10.5 },
  { id: 'm1', x: 0, z: 9 },
  { id: 'm2', x: 0, z: 3 },
  { id: 'm3', x: 0, z: -4 },
  { id: 't1', x: 4, z: -0.5 },
  { id: 't2', x: 4, z: -3.5 },
  { id: 't3', x: 6.5, z: -4 },
  { id: 'e1', x: 13, z: 9 },
  { id: 'e2', x: 13, z: 2 },
  { id: 'e3', x: 13, z: -5 },
  { id: 'b1', x: 11, z: -9 },
  { id: 'b2', x: 8.5, z: -11 },
  { id: 'c1', x: -6, z: 5 },
  { id: 'c2', x: 6, z: 5 },
  { id: 'c3', x: -6, z: -6 },
  { id: 'c4', x: 6, z: -7 },
  { id: 'midW', x: -9, z: -1 },
  { id: 'midE', x: 9, z: -1 },
  { id: 'wh1', x: 10, z: -7 },
  { id: 'wh2', x: 14, z: -10 },
];
const EDGES = [
  ['spawn', 'w1'], ['spawn', 'm1'], ['spawn', 'e1'],
  ['w1', 'w2'], ['w2', 'w3'], ['w3', 'a1'], ['a1', 'a2'], ['a2', 'm3'],
  ['m1', 'm2'], ['m2', 'm3'], ['m3', 'b2'], ['b2', 'b1'], ['b1', 'e3'],
  ['e1', 'e2'], ['e2', 'e3'], ['e3', 'b1'],
  ['m1', 'c1'], ['m1', 'c2'], ['c1', 'c3'], ['c2', 'c4'],
  ['w2', 'c1'], ['e2', 'c2'], ['c3', 'm2'], ['c4', 'm2'],
  ['w3', 'c3'], ['e3', 'c4'], ['w2', 'midW'], ['e2', 'midE'],
  ['midW', 'c3'], ['midE', 'c4'], ['midW', 'm3'], ['midE', 'm3'],
  // The drainage tunnel: mid -> t1 -> t2 -> warehouse door -> wh1.
  ['m2', 't1'], ['t1', 't2'], ['t2', 't3'], ['t3', 'wh1'], ['t3', 'b2'],
  ['wh1', 'wh2'], ['wh1', 'b1'], ['wh2', 'b2'],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = {};
  for (const name of ['floor', 'concrete', 'steel', 'iron', 'rust']) {
    mat[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'floor' ? 0.95 : 0.8,
      metalness: name === 'floor' ? 0.05 : 0.3,
    });
  }
  mat.teal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.65, metalness: 0.35 });
  mat.amber = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.amber), roughness: 0.6,
    emissive: new THREE.Color(PALETTE.amber), emissiveIntensity: 0.7,
  });
  mat.tealGlow = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.teal), roughness: 0.6,
    emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 0.7,
  });
  mat.glowA = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#33220a'), roughness: 0.9,
    emissive: new THREE.Color(PALETTE.amber), emissiveIntensity: 1.5,
  });
  mat.glowB = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0e3a36'), roughness: 0.9,
    emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 1.2,
  });
  mat.track = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d1e24'), roughness: 0.9, metalness: 0.4 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and perimeter: 34 x 30 m depot, 5 m fence walls, open dusk sky.
  box(34.4, 0.4, 30.4, 0, -0.2, 0, 'floor');
  box(0.4, 5, 30.4, -17.2, 2.5, 0, 'steel');
  box(0.4, 5, 30.4, 17.2, 2.5, 0, 'steel');
  box(34.4, 5, 0.4, 0, 2.5, -15.2, 'steel');
  box(34.4, 5, 0.4, 0, 2.5, 15.2, 'steel');

  // Rail tracks: two dark strips running north-south through mid, with
  // sleeper blocks. They are flat (non-solid) so they never block movement.
  box(0.9, 0.06, 26, -3.4, 0.03, -1, 'track', false);
  box(0.9, 0.06, 26, 3.4, 0.03, -1, 'track', false);
  for (let z = -12; z <= 10; z += 2) {
    box(2.2, 0.05, 0.5, -3.4, 0.025, z, 'iron', false);
    box(2.2, 0.05, 0.5, 3.4, 0.025, z, 'iron', false);
  }

  // Divider wall at z = -2 with gaps at the west/east lanes and a wide mid
  // gap the drainage tunnel runs through.
  box(12, 4, 0.6, -7, 2, -2, 'steel');
  box(6, 4, 0.6, 10, 2, -2, 'steel');

  // Site A — the Crane Yard: a gantry crane (two legs, a top beam, a hanging
  // hook block) over an open floor, flanked by rusted containers.
  box(1.4, 7, 1.4, -14, 3.5, -12, 'iron');
  box(1.4, 7, 1.4, -8, 3.5, -12, 'iron');
  box(7.4, 1, 1.6, -11, 7.2, -12, 'steel');
  box(0.9, 1.4, 0.9, -11, 5.6, -12, 'amber');
  box(2.6, 1.1, 1.2, -14.4, 0.55, -7.8, 'rust');
  box(1.2, 2.4, 1.2, -7.6, 1.2, -12.6, 'iron');
  box(2.4, 1.1, 1.2, -7.2, 0.55, -6.8, 'iron');
  box(1.2, 1.1, 2.4, -14.8, 0.55, -9.6, 'iron');

  // Site B — the Warehouse: a roofed hall (x 6.5..17, z -14.5..-5) with a
  // wide door on its south wall. Inside: stacked crates and a teal beacon.
  // Hall walls (the north/east edges are the perimeter fence already).
  box(0.5, 4.5, 9.5, 6.5, 2.25, -9.75, 'concrete'); // west wall
  box(4.5, 4.5, 0.5, 8.75, 2.25, -5, 'concrete'); // south wall, west of door
  box(3.2, 4.5, 0.5, 15.4, 2.25, -5, 'concrete'); // south wall, east of door
  box(10.5, 0.5, 9.5, 11.75, 4.6, -9.75, 'steel'); // roof slab
  box(1.2, 2.6, 1.2, 9.5, 1.3, -12.5, 'teal');
  box(2.4, 1.1, 1.2, 13.5, 0.55, -12.5, 'iron');
  box(1.2, 1.1, 1.2, 14.5, 0.55, -8.5, 'iron');
  box(1.2, 1.1, 2.4, 8.5, 0.55, -8.2, 'iron');
  box(0.9, 2.2, 0.9, 12, 1.1, -10.5, 'tealGlow');

  // The drainage tunnel: a low roofed passage running north-south through
  // the divider gap, mid -> warehouse door. Walls at x = 2 and x = 6 from
  // z = 0 to z = -4, roof slab at 2.6, open at both ends.
  box(0.5, 2.6, 4, 1.75, 1.3, -2, 'concrete');
  box(0.5, 2.6, 4, 6.25, 1.3, -2, 'concrete');
  box(5, 0.4, 4.5, 4, 2.8, -2, 'steel');
  // Tunnel mouth lamps so the passage reads from outside.
  box(0.3, 0.3, 0.3, 4, 2.2, 0.2, 'amber');
  box(0.3, 0.3, 0.3, 4, 2.2, -4.2, 'amber');

  // Gantry walkway across mid (overlook, not a route: no jump in this game).
  box(12, 0.3, 2, 0, 3.1, 4.5, 'iron');
  box(0.3, 3.2, 2, -6, 1.6, 4.5, 'steel');
  box(0.3, 3.2, 2, 6, 1.6, 4.5, 'steel');

  // Mid containers: teal stacks that break sightlines down every lane.
  box(3, 2.6, 1.4, -6.5, 1.3, 5.5, 'teal');
  box(3, 2.6, 1.4, 6.5, 1.3, 5.5, 'teal');
  box(1.4, 2.6, 3, -9.5, 1.3, -6.5, 'teal');
  box(1.4, 2.6, 3, 9.5, 1.3, -6.5, 'teal');
  box(2.4, 1.1, 1.2, -9.5, 0.55, 9, 'iron');
  box(2.4, 1.1, 1.2, 9.5, 0.55, 9, 'iron');
  box(1.2, 1.1, 1.2, -4.5, 0.55, 11.5, 'iron');
  box(1.2, 1.1, 1.2, 4.5, 0.55, 11.5, 'iron');
  box(1.2, 2.6, 1.2, -6, 1.3, -7, 'iron');
  box(1.2, 2.6, 1.2, 6, 1.3, -7, 'iron');

  // Site markers: glowing floor plates that read as A and B at a glance.
  const plateA = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 2.2), mat.amber);
  plateA.position.set(-11, 0.03, -10);
  group.add(plateA);
  const plateB = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 2.2), mat.tealGlow);
  plateB.position.set(11, 0.03, -10);
  group.add(plateB);

  // Light: cold dusk moonlight, amber crane glow at A, teal glow inside B,
  // warm yard lamps and a tunnel light.
  scene.add(new THREE.AmbientLight(new THREE.Color('#4a4a60'), 0.6));
  scene.add(new THREE.HemisphereLight(new THREE.Color('#5a5a86'), new THREE.Color('#2c2c38'), 1.4));
  const moon = new THREE.DirectionalLight(new THREE.Color('#dfe8ff'), 2.4);
  moon.position.set(10, 18, 8);
  moon.target.position.set(0, 0, -2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -20;
  moon.shadow.camera.right = 20;
  moon.shadow.camera.top = 20;
  moon.shadow.camera.bottom = -20;
  moon.shadow.camera.far = 60;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);
  const glowA = new THREE.PointLight(new THREE.Color(PALETTE.amber), 45, 18, 1.6);
  glowA.position.set(-11, 3, -11);
  scene.add(glowA);
  const glowB = new THREE.PointLight(new THREE.Color(PALETTE.teal), 30, 16, 1.6);
  glowB.position.set(11, 2.5, -10);
  scene.add(glowB);
  const yard = new THREE.PointLight(new THREE.Color('#ffd9a0'), 26, 20, 1.6);
  yard.position.set(0, 5, 10);
  scene.add(yard);
  const tunnelLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 14, 10, 1.6);
  tunnelLight.position.set(4, 2, -2);
  scene.add(tunnelLight);

  const sites = {
    A: {
      id: 'A', name: 'Crane Yard', color: PALETTE.amber,
      zone: new THREE.Box3(new THREE.Vector3(-14, 0, -13), new THREE.Vector3(-8, 3, -7)),
      plant: new THREE.Vector3(-11, 0, -10),
    },
    B: {
      id: 'B', name: 'Warehouse', color: PALETTE.teal,
      zone: new THREE.Box3(new THREE.Vector3(8, 0, -13), new THREE.Vector3(14.5, 3, -7)),
      plant: new THREE.Vector3(11, 0, -10),
    },
  };

  const nodes = new Map(WAYPOINTS.map((w) => [w.id, { ...w }]));
  const adjacency = new Map(WAYPOINTS.map((w) => [w.id, []]));
  for (const [a, b] of EDGES) {
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  function nearestNode(x, z) {
    let best = null;
    let bestDist = Infinity;
    for (const node of nodes.values()) {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  // A* over the waypoint graph; returns nodes from start to goal.
  function findPath(fromId, toId) {
    if (fromId === toId) return [nodes.get(toId)];
    const open = [{ id: fromId, cost: 0 }];
    const came = new Map();
    const spent = new Map([[fromId, 0]]);
    const goal = nodes.get(toId);
    function heuristic(id) {
      const n = nodes.get(id);
      return Math.hypot(n.x - goal.x, n.z - goal.z);
    }
    while (open.length > 0) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (open[i].cost + heuristic(open[i].id) < open[bestIndex].cost + heuristic(open[bestIndex].id)) bestIndex = i;
      }
      const current = open.splice(bestIndex, 1)[0];
      if (current.id === toId) {
        const path = [nodes.get(toId)];
        let step = toId;
        while (came.has(step)) {
          step = came.get(step);
          path.unshift(nodes.get(step));
        }
        return path;
      }
      for (const next of adjacency.get(current.id)) {
        const a = nodes.get(current.id);
        const b = nodes.get(next);
        const stepCost = Math.hypot(a.x - b.x, a.z - b.z);
        const total = spent.get(current.id) + stepCost;
        if (!spent.has(next) || total < spent.get(next)) {
          spent.set(next, total);
          came.set(next, current.id);
          open.push({ id: next, cost: total });
        }
      }
    }
    return [nodes.get(toId)];
  }

  return {
    colliders,
    shootables,
    sites,
    nodes,
    nearestNode,
    findPath,
    playerSpawn: { x: 0, z: 13, yaw: 0 },
    botSpawns: [
      { site: 'A', x: -11, z: -11.5, role: 'holder' },
      { site: 'A', x: -7.5, z: -9.5, role: 'holder' },
      { site: 'B', x: 11, z: -11.5, role: 'holder' },
      { site: 'B', x: 8.5, z: -8.5, role: 'rotator' },
      { site: 'B', x: 13, z: -6.5, role: 'hunter' },
    ],
  };
}
