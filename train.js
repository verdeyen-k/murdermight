// Murder Might: the train. Cars, walls, rooms, tasks and the paths bots walk on.
// Pure JavaScript (no three.js), so it also works in Node for testing.
//
// The train runs along x. z goes across the train: -2 is the outside wall on the room side,
// +2 the outside wall on the corridor side. Every car has the same doorway (z 0.75 to 1.75) at each end.
(function () {
  const CW = 2;          // half the width of a car
  const T = 0.12;        // wall thickness
  const GAP = 0.8;       // the walkway between two cars
  const CORR = 0.5;      // the wall between the rooms and the corridor
  const DOOR0 = 0.75, DOOR1 = 1.75, DOORZ = 1.25;
  const R = 0.3;         // how fat a person is
  const ROOM = 2.4;      // how long each room is
  const MEETING_N = 25;  // the meeting room: you have to be in here to accuse someone

  const CARS = [];   // { i, name, kind, x0, x1, first }
  const SIGHT = [];  // walls: block walking and seeing
  const SOLID = [];  // walls + furniture: block walking
  const FURN = [];   // furniture boxes, for drawing: { x0, x1, z0, z1, h, kind }
  const ROOMS = [];  // { n, car, a, b, xc }
  const TASKS = [];  // { id, kind, name, where, ox, oy, oz, sx, sz, car }
  const NODES = [];  // { i, x, z, nb: [node index] }
  const HIDES = [];  // hiding places: { id, kind, x, z (middle), ex, ez (where you stand to get in and come out), car }

  const KINDS = {
    bed: 'Make the bed', lamp: 'Fix the lamp', case: 'Pack the suitcase', plant: 'Water the plant',
    clock: 'Wind the clock', window: 'Clean the window',
    coal: 'Shovel coal into the fire', gauge: 'Check the gauges', whistle: 'Blow the whistle',
    brake: 'Check the brakes', mail: 'Sort the mail', stove: 'Warm up the stove',
  };

  function box(x0, x1, z0, z1) {
    return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
  }
  function wall(x0, x1, z0, z1) { const w = box(x0, x1, z0, z1); SIGHT.push(w); SOLID.push(w); return w; }
  function furn(x0, x1, z0, z1, h, kind) { const f = Object.assign(box(x0, x1, z0, z1), { h, kind }); FURN.push(f); SOLID.push(f); return f; }

  // a tiny fixed random, so every computer builds the same train
  let seed = 20261122;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  function hide(kind, x0, x1, z0, z1, ex, ez, car) {
    furn(x0, x1, z0, z1, 2.0, kind);
    HIDES.push({ id: HIDES.length, kind, x: (x0 + x1) / 2, z: (z0 + z1) / 2, ex, ez, car });
  }

  function task(kind, where, ox, oy, oz, sx, sz, car) {
    TASKS.push({ id: TASKS.length, kind, name: KINDS[kind], where, ox, oy, oz, sx, sz, car });
  }

  // ---------- build ----------
  const specs = [{ name: 'Locomotive', kind: 'loco', len: 12 }];
  for (let i = 0; i < 5; i++) specs.push({ name: `Rooms ${i * 10 + 1}-${i * 10 + 10}`, kind: 'pass', len: 26, first: i * 10 + 1 });
  specs.push({ name: 'Caboose', kind: 'cab', len: 10 });
  let x = 0;
  specs.forEach((sp, i) => {
    const car = Object.assign({ i, x0: x, x1: x + sp.len }, sp);
    CARS.push(car);
    x = car.x1 + GAP;
  });
  const LAST = CARS.length - 1;

  for (const car of CARS) {
    const { x0, x1 } = car;
    wall(x0, x1, -CW - T, -CW);
    wall(x0, x1, CW, CW + T);
    // end walls, with a doorway unless it's the very front or very back of the train
    if (car.i === 0) wall(x0, x0 + T, -CW, CW); else { wall(x0, x0 + T, -CW, DOOR0); wall(x0, x0 + T, DOOR1, CW); }
    if (car.i === LAST) wall(x1 - T, x1, -CW, CW); else { wall(x1 - T, x1, -CW, DOOR0); wall(x1 - T, x1, DOOR1, CW); }
    // the walkway to the next car
    if (car.i < LAST) { const nx = CARS[car.i + 1].x0; wall(x1, nx, DOOR0 - T, DOOR0); wall(x1, nx, DOOR1, DOOR1 + T); }

    if (car.kind === 'pass') {
      const rx0 = x0 + 1;
      for (let k = 0; k <= 10; k++) { const px = rx0 + k * ROOM; wall(px - T / 2, px + T / 2, -CW, CORR); }
      for (let k = 0; k < 10; k++) {
        const a = rx0 + k * ROOM, b = a + ROOM, xc = a + ROOM / 2, n = car.first + k;
        wall(a, xc - 0.5, CORR, CORR + T);
        wall(xc + 0.5, b, CORR, CORR + T);
        ROOMS.push({ n, car: car.i, a, b, xc });
        if (n === MEETING_N) { // the meeting room: a long table, no bed and no task
          furn(a + 0.35, b - 0.35, -CW, -1.35, 0.75, 'meeting');
          continue;
        }
        furn(a + 0.1, a + 1.85, -CW, -1.3, 0.5, 'bed');
        if (n % 2) hide('wardrobe', a + 0.07, a + 0.62, -0.15, 0.48, a + 0.4, -0.58, car.i); // a wardrobe in every odd room
        furn(b - 0.5, b - 0.08, -CW, -1.55, 0.7, 'table');
        const kinds = ['bed', 'lamp', 'case', 'plant', 'clock', 'window'];
        const kind = kinds[Math.floor(rnd() * kinds.length)];
        const where = `room ${n}`;
        if (kind === 'bed') task(kind, where, a + 0.45, 0.55, -1.7, a + 0.55, -1.0, car.i);
        if (kind === 'lamp') task(kind, where, b - 0.29, 0.7, -1.78, b - 0.55, -0.9, car.i);
        if (kind === 'case') task(kind, where, xc - 0.3, 0, -0.95, xc, -0.35, car.i);
        if (kind === 'plant') task(kind, where, b - 0.35, 0, 0.2, b - 0.75, -0.3, car.i);
        if (kind === 'clock') task(kind, where, a + 0.08, 1.7, -0.6, a + 0.6, -0.6, car.i);
        if (kind === 'window') task(kind, where, xc, 1.5, -CW + 0.02, xc, -1.0, car.i);
      }
    }
    if (car.kind === 'loco') {
      wall(x0, x0 + 6.5, -CW, 0.3);                 // the big boiler
      furn(x0 + 7.4, x0 + 9, -CW, -1.1, 0.6, 'coal');
      furn(x0 + 10.6, x0 + 11.85, -CW, -1.3, 1.0, 'panel');
      hide('locker', x0 + 9.3, x0 + 10.2, -CW, -1.45, x0 + 9.75, -0.85, car.i);
      task('gauge', 'the locomotive', x0 + 6.52, 1.4, -0.9, x0 + 7.1, -0.5, car.i);
      task('coal', 'the locomotive', x0 + 8.2, 0.6, -1.4, x0 + 8.2, -0.5, car.i);
      task('whistle', 'the locomotive', x0 + 11.2, 2.2, 1.6, x0 + 10.6, 1.2, car.i);
    }
    if (car.kind === 'cab') {
      furn(x0 + 3, x0 + 5, -CW, -1.3, 0.8, 'desk');
      furn(x0 + 8.3, x0 + 9.85, -CW, -1.2, 0.9, 'stove');
      furn(x0 + 6.5, x0 + 9.85, 1.2, CW, 0.5, 'bunk');
      hide('locker', x0 + 1.0, x0 + 1.9, -CW, -1.45, x0 + 1.45, -0.85, car.i);
      hide('locker', x0 + 5.5, x0 + 6.4, -CW, -1.45, x0 + 5.95, -0.85, car.i);
      task('mail', 'the caboose', x0 + 4, 0.8, -1.65, x0 + 4, -0.8, car.i);
      task('stove', 'the caboose', x0 + 9, 0.9, -1.6, x0 + 8.4, -0.6, car.i);
      task('brake', 'the caboose', x0 + 9.8, 1.1, 0.3, x0 + 9.2, 0.3, car.i);
    }
  }

  // ---------- collisions and seeing ----------
  // does the line from a to b go through box w (made fatter by pad)?
  function segHits(ax, az, bx, bz, w, pad) {
    const x0 = w.x0 - pad, x1 = w.x1 + pad, z0 = w.z0 - pad, z1 = w.z1 + pad;
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) return false;
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    if (Math.abs(dx) < 1e-9) { if (ax < x0 || ax > x1) return false; } else {
      let ta = (x0 - ax) / dx, tb = (x1 - ax) / dx; if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return false;
    }
    if (Math.abs(dz) < 1e-9) { if (az < z0 || az > z1) return false; } else {
      let ta = (z0 - az) / dz, tb = (z1 - az) / dz; if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return false;
    }
    return true;
  }
  // can someone at a see b? (only walls block seeing; beds and tables don't)
  function los(ax, az, bx, bz) {
    for (const w of SIGHT) if (segHits(ax, az, bx, bz, w, 0)) return false;
    return true;
  }
  // can a person walk straight from a to b?
  function clearPath(ax, az, bx, bz) {
    for (const w of SOLID) if (segHits(ax, az, bx, bz, w, R + 0.02)) return false;
    return true;
  }
  function blocked(x, z) {
    for (const w of SOLID) if (x + R > w.x0 && x - R < w.x1 && z + R > w.z0 && z - R < w.z1) return true;
    return false;
  }
  // move a person, sliding along walls
  function move(p, dx, dz) {
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.15) || 1;
    for (let i = 0; i < n; i++) {
      if (!blocked(p.x + dx / n, p.z)) p.x += dx / n;
      if (!blocked(p.x, p.z + dz / n)) p.z += dz / n;
    }
  }

  // which car is this spot in? (the walkway counts as the car in front of it)
  function carAt(x) {
    for (const c of CARS) if (x < c.x1 + GAP / 2) return c;
    return CARS[LAST];
  }
  function placeName(x, z) {
    const c = carAt(x);
    if (c.kind === 'pass' && z < CORR) { const r = ROOMS.find((r) => r.car === c.i && x >= r.a && x < r.b); if (r) return r.n === MEETING_N ? `Room ${r.n} (meeting room)` : `Room ${r.n}`; }
    return c.name;
  }

  const MEETING = ROOMS.find((r) => r.n === MEETING_N);
  // is this spot inside the meeting room? (pad makes the room a bit bigger, for checking online positions)
  function inMeeting(x, z, pad = 0) {
    return x > MEETING.a - pad && x < MEETING.b + pad && z < CORR + pad && z > -CW - pad;
  }

  // ---------- paths for bots ----------
  function node(x, z) { NODES.push({ i: NODES.length, x, z, nb: [] }); }
  for (const car of CARS) {
    const { x0, x1 } = car;
    if (car.kind === 'pass') {
      node(x0 + 0.5, DOORZ); node(x1 - 0.5, DOORZ);
      for (const r of ROOMS.filter((r) => r.car === car.i)) { node(r.xc, DOORZ); node(r.xc, -0.4); }
    }
    if (car.kind === 'loco') { node(x0 + 1, 1.15); node(x0 + 4, 1.15); node(x0 + 7.2, 1.15); node(x0 + 7.2, -0.5); node(x0 + 10, -0.6); node(x0 + 10, 1.15); node(x1 - 0.5, DOORZ); }
    if (car.kind === 'cab') { node(x0 + 0.5, DOORZ); node(x0 + 3, 0.6); node(x0 + 4, -0.8); node(x0 + 6, 0); node(x0 + 8.4, -0.5); node(x0 + 9.2, 0.4); }
    if (car.i < LAST) node((x1 + CARS[car.i + 1].x0) / 2, DOORZ);
  }
  for (const a of NODES) for (const b of NODES) {
    if (b.i <= a.i) continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < 6.5 && clearPath(a.x, a.z, b.x, b.z)) { a.nb.push(b.i); b.nb.push(a.i); }
  }

  function nearestNode(x, z) {
    const list = NODES.map((n) => [(n.x - x) ** 2 + (n.z - z) ** 2, n]).sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < Math.min(8, list.length); i++) if (clearPath(x, z, list[i][1].x, list[i][1].z)) return list[i][1];
    for (let i = 0; i < Math.min(8, list.length); i++) if (los(x, z, list[i][1].x, list[i][1].z)) return list[i][1];
    return list[0][1];
  }
  // a list of points to walk through to get from (x, z) to (gx, gz)
  function findPath(x, z, gx, gz) {
    if (clearPath(x, z, gx, gz)) return [[gx, gz]];
    const a = nearestNode(x, z), b = nearestNode(gx, gz);
    const dist = new Array(NODES.length).fill(Infinity), prev = new Array(NODES.length).fill(-1), done = new Array(NODES.length).fill(false);
    dist[a.i] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < NODES.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === b.i) break;
      done[u] = true;
      for (const v of NODES[u].nb) {
        const d = dist[u] + Math.hypot(NODES[u].x - NODES[v].x, NODES[u].z - NODES[v].z);
        if (d < dist[v]) { dist[v] = d; prev[v] = u; }
      }
    }
    const pts = [[gx, gz]];
    for (let u = b.i; u >= 0; u = prev[u]) pts.unshift([NODES[u].x, NODES[u].z]);
    // skip the first point if we can already walk straight to the second
    while (pts.length > 1 && clearPath(x, z, pts[1][0], pts[1][1])) pts.shift();
    return pts;
  }

  // corridor spots where people start
  const SPAWNS = NODES.filter((n) => n.z === DOORZ && CARS[carAt(n.x).i].kind === 'pass');

  const api = {
    CW, T, GAP, CORR, DOOR0, DOOR1, DOORZ, R, CARS, SIGHT, SOLID, FURN, ROOMS, TASKS, NODES, HIDES, SPAWNS, KINDS, LENGTH: CARS[LAST].x1,
    MEETING, MEETING_N, los, clearPath, blocked, move, carAt, placeName, findPath, nearestNode, inMeeting,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.TRAIN = api;
})();
