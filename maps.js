// Murder Might: the maps (the train and the mansion). Walls, rooms, tasks, hiding places,
// stairs and the paths bots walk on. Pure JavaScript (no three.js), so it also works in Node for testing.
//
// Everything is on a flat x/z plan. A map can have more than one floor: every wall, task, hiding place and
// person has a floor number f (0 = downstairs). People only bump into and see things on their own floor.
// Stairs are a strip of floor where you walk up from one floor to the next.
(function () {
  const R = 0.3;   // how fat a person is
  const FH = 3.2;  // how tall one floor is

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
  const box = (x0, x1, z0, z1) => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });

  // a new empty map, with helpers for adding things to it
  function newMap(name, title, floors) {
    const M = {
      name, title, floors, FH, R,
      WALLS: [], FURN: [], TASKS: [], HIDES: [], NODES: [], STAIRS: [], LINKS: [], SPAWNS: [],
    };
    M.wall = (x0, x1, z0, z1, f = 0, h) => { const w = Object.assign(box(x0, x1, z0, z1), { f, h }); M.WALLS.push(w); return w; };
    M.furn = (x0, x1, z0, z1, h, kind, f = 0) => { const o = Object.assign(box(x0, x1, z0, z1), { h, kind, f }); M.FURN.push(o); return o; };
    M.hide = (kind, x0, x1, z0, z1, ex, ez, f = 0) => {
      M.furn(x0, x1, z0, z1, 2.0, kind, f);
      M.HIDES.push({ id: M.HIDES.length, kind, x: (x0 + x1) / 2, z: (z0 + z1) / 2, ex, ez, f });
    };
    M.task = (kind, name, where, ox, oy, oz, sx, sz, f = 0) => {
      M.TASKS.push({ id: M.TASKS.length, kind, name, where, ox, oy, oz, sx, sz, f });
    };
    M.node = (x, z, f = 0) => { const n = { i: M.NODES.length, x, z, f, nb: [] }; M.NODES.push(n); return n; };
    return M;
  }

  // turn the lists into a working map: bumping, seeing, stairs and paths
  function finish(M) {
    const sight = [], solid = [];
    for (let f = 0; f < M.floors; f++) {
      sight.push(M.WALLS.filter((w) => w.f === f));
      solid.push(M.WALLS.filter((w) => w.f === f).concat(M.FURN.filter((o) => o.f === f)));
    }
    // can someone at a see b on floor f? (only walls block seeing; beds and tables don't)
    M.los = (ax, az, bx, bz, f = 0) => {
      for (const w of sight[f]) if (segHits(ax, az, bx, bz, w, 0)) return false;
      return true;
    };
    // can person a see person b? (they have to be on the same floor)
    M.see = (a, b) => (a.f || 0) === (b.f || 0) && M.los(a.x, a.z, b.x, b.z, a.f || 0);
    M.clearPath = (ax, az, bx, bz, f = 0) => {
      for (const w of solid[f]) if (segHits(ax, az, bx, bz, w, R + 0.02)) return false;
      return true;
    };
    M.blocked = (x, z, f = 0) => {
      for (const w of solid[f]) if (x + R > w.x0 && x - R < w.x1 && z + R > w.z0 && z - R < w.z1) return true;
      return false;
    };
    // stairs: how far up them is this spot? (0 = bottom, 1 = top, null = not on the stairs)
    M.stairAt = (x, z) => {
      for (const st of M.STAIRS) {
        if (x < st.x0 || x > st.x1 || z < st.z0 || z > st.z1) continue;
        return { st, t: st.dir < 0 ? (st.x1 - x) / (st.x1 - st.x0) : (x - st.x0) / (st.x1 - st.x0) };
      }
      return null;
    };
    // how high is the floor under this spot?
    M.yAt = (x, z, f = 0) => {
      const s = M.stairAt(x, z);
      if (s && (f === s.st.f0 || f === s.st.f1)) return (s.st.f0 + s.t) * FH;
      return f * FH;
    };
    // walking up or down the stairs changes your floor
    M.updateFloor = (p) => {
      const s = M.stairAt(p.x, p.z);
      if (!s) return;
      if ((p.f || 0) === s.st.f0 && s.t > 0.9) p.f = s.st.f1;
      else if (p.f === s.st.f1 && s.t < 0.85) p.f = s.st.f0;
    };
    // move a person, sliding along walls
    M.move = (p, dx, dz) => {
      const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.15) || 1;
      for (let i = 0; i < n; i++) {
        const f = p.f || 0;
        if (!M.blocked(p.x + dx / n, p.z, f)) p.x += dx / n;
        if (!M.blocked(p.x, p.z + dz / n, f)) p.z += dz / n;
        M.updateFloor(p);
      }
    };
    M.inMeeting = (x, z, f = 0, pad = 0) => {
      const m = M.MEETING;
      return f === m.f && x > m.x0 - pad && x < m.x1 + pad && z > m.z0 - pad && z < m.z1 + pad;
    };

    // ---------- paths for bots ----------
    for (const a of M.NODES) for (const b of M.NODES) {
      if (b.i <= a.i || a.f !== b.f) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < M.linkDist && M.clearPath(a.x, a.z, b.x, b.z, a.f)) { a.nb.push(b.i); b.nb.push(a.i); }
    }
    for (const [a, b] of M.LINKS) { a.nb.push(b.i); b.nb.push(a.i); }
    M.nearestNode = (x, z, f = 0) => {
      const list = M.NODES.filter((n) => n.f === f).map((n) => [(n.x - x) ** 2 + (n.z - z) ** 2, n]).sort((p, q) => p[0] - q[0]);
      for (let i = 0; i < Math.min(8, list.length); i++) if (M.clearPath(x, z, list[i][1].x, list[i][1].z, f)) return list[i][1];
      for (let i = 0; i < Math.min(8, list.length); i++) if (M.los(x, z, list[i][1].x, list[i][1].z, f)) return list[i][1];
      return list[0][1];
    };
    // a list of points to walk through to get from (x, z) on floor f to (gx, gz) on floor gf
    M.findPath = (x, z, f, gx, gz, gf) => {
      if (f === gf && M.clearPath(x, z, gx, gz, f)) return [[gx, gz, gf]];
      const N = M.NODES, a = M.nearestNode(x, z, f), b = M.nearestNode(gx, gz, gf);
      const dist = new Array(N.length).fill(Infinity), prev = new Array(N.length).fill(-1), done = new Array(N.length).fill(false);
      dist[a.i] = 0;
      for (;;) {
        let u = -1;
        for (let i = 0; i < N.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
        if (u < 0 || u === b.i) break;
        done[u] = true;
        for (const v of N[u].nb) {
          const d = dist[u] + Math.hypot(N[u].x - N[v].x, N[u].z - N[v].z);
          if (d < dist[v]) { dist[v] = d; prev[v] = u; }
        }
      }
      const pts = [[gx, gz, gf]];
      for (let u = b.i; u >= 0; u = prev[u]) pts.unshift([N[u].x, N[u].z, N[u].f]);
      // skip points while we can already walk straight to the next one
      while (pts.length > 1 && pts[1][2] === f && pts[0][2] === f && M.clearPath(x, z, pts[1][0], pts[1][1], f)) pts.shift();
      return pts;
    };
    return M;
  }

  // =====================================================================
  // The train: 7 cars in a row. x runs along the train, z across it (-2 = outside wall on the room side).
  // =====================================================================
  function buildTrain() {
    const M = newMap('train', 'The Train', 1);
    const CW = 2, T = 0.12, GAP = 0.8, CORR = 0.5, DOOR0 = 0.75, DOOR1 = 1.75, DOORZ = 1.25, ROOM = 2.4, MEETING_N = 25;
    Object.assign(M, { CW, T, GAP, CORR, DOOR0, DOOR1, DOORZ, MEETING_N, CARS: [], ROOMS: [], linkDist: 6.5 });
    const { wall, furn, hide, CARS, ROOMS } = M;
    const KINDS = {
      bed: 'Make the bed', lamp: 'Fix the lamp', case: 'Pack the suitcase', plant: 'Water the plant',
      clock: 'Wind the clock', window: 'Clean the window',
      coal: 'Shovel coal into the fire', gauge: 'Check the gauges', whistle: 'Blow the whistle',
      brake: 'Check the brakes', mail: 'Sort the mail', stove: 'Warm up the stove',
    };
    const task = (kind, where, ox, oy, oz, sx, sz) => M.task(kind, KINDS[kind], where, ox, oy, oz, sx, sz, 0);
    // a tiny fixed random, so every computer builds the same train
    let seed = 20261122;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    const specs = [{ name: 'Locomotive', kind: 'loco', len: 12 }];
    for (let i = 0; i < 5; i++) specs.push({ name: `Rooms ${i * 10 + 1}-${i * 10 + 10}`, kind: 'pass', len: 26, first: i * 10 + 1 });
    specs.push({ name: 'Caboose', kind: 'cab', len: 10 });
    let x = 0;
    specs.forEach((sp, i) => { const car = Object.assign({ i, x0: x, x1: x + sp.len }, sp); CARS.push(car); x = car.x1 + GAP; });
    const LAST = CARS.length - 1;
    M.LENGTH = CARS[LAST].x1;
    M.BOUNDS = { x0: 0, x1: M.LENGTH, z0: -CW, z1: CW };

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
          if (n % 2) hide('wardrobe', a + 0.07, a + 0.62, -0.15, 0.48, a + 0.4, -0.58); // a wardrobe in every odd room
          furn(b - 0.5, b - 0.08, -CW, -1.55, 0.7, 'table');
          const kinds = ['bed', 'lamp', 'case', 'plant', 'clock', 'window'];
          const kind = kinds[Math.floor(rnd() * kinds.length)];
          const where = `room ${n}`;
          if (kind === 'bed') task(kind, where, a + 0.45, 0.55, -1.7, a + 0.55, -1.0);
          if (kind === 'lamp') task(kind, where, b - 0.29, 0.7, -1.78, b - 0.55, -0.9);
          if (kind === 'case') task(kind, where, xc - 0.3, 0, -0.95, xc, -0.35);
          if (kind === 'plant') task(kind, where, b - 0.35, 0, 0.2, b - 0.75, -0.3);
          if (kind === 'clock') task(kind, where, a + 0.08, 1.7, -0.6, a + 0.6, -0.6);
          if (kind === 'window') task(kind, where, xc, 1.5, -CW + 0.02, xc, -1.0);
        }
      }
      if (car.kind === 'loco') {
        wall(x0, x0 + 6.5, -CW, 0.3).boiler = true;   // the big boiler
        furn(x0 + 7.4, x0 + 9, -CW, -1.1, 0.6, 'coal');
        furn(x0 + 10.6, x0 + 11.85, -CW, -1.3, 1.0, 'panel');
        hide('locker', x0 + 9.3, x0 + 10.2, -CW, -1.45, x0 + 9.75, -0.85);
        task('gauge', 'the locomotive', x0 + 6.52, 1.4, -0.9, x0 + 7.1, -0.5);
        task('coal', 'the locomotive', x0 + 8.2, 0.6, -1.4, x0 + 8.2, -0.5);
        task('whistle', 'the locomotive', x0 + 11.2, 2.2, 1.6, x0 + 10.6, 1.2);
      }
      if (car.kind === 'cab') {
        furn(x0 + 3, x0 + 5, -CW, -1.3, 0.8, 'desk');
        furn(x0 + 8.3, x0 + 9.85, -CW, -1.2, 0.9, 'stove');
        furn(x0 + 6.5, x0 + 9.85, 1.2, CW, 0.5, 'bunk');
        hide('locker', x0 + 1.0, x0 + 1.9, -CW, -1.45, x0 + 1.45, -0.85);
        hide('locker', x0 + 5.5, x0 + 6.4, -CW, -1.45, x0 + 5.95, -0.85);
        task('mail', 'the caboose', x0 + 4, 0.8, -1.65, x0 + 4, -0.8);
        task('stove', 'the caboose', x0 + 9, 0.9, -1.6, x0 + 8.4, -0.6);
        task('brake', 'the caboose', x0 + 9.8, 1.1, 0.3, x0 + 9.2, 0.3);
      }
    }

    // which car is this spot in? (the walkway counts as the car in front of it)
    M.carAt = (x) => { for (const c of CARS) if (x < c.x1 + GAP / 2) return c; return CARS[LAST]; };
    M.zoneName = (x) => M.carAt(x).name;
    M.placeName = (x, z) => {
      const c = M.carAt(x);
      if (c.kind === 'pass' && z < CORR) { const r = ROOMS.find((r) => r.car === c.i && x >= r.a && x < r.b); if (r) return r.n === MEETING_N ? `Room ${r.n} (meeting room)` : `Room ${r.n}`; }
      return c.name;
    };
    const mr = ROOMS.find((r) => r.n === MEETING_N);
    M.MEETING = Object.assign({ x0: mr.a, x1: mr.b, z0: -CW, z1: CORR, f: 0, sx: mr.xc, sz: -0.6 }, mr);
    M.MEETING_NAME = 'room 25, the meeting room';
    M.MEETING_SHORT = 'room 25';
    // the little map at the top of the screen
    M.MAP = CARS.map((c) => ({ x0: c.x0, x1: c.x1, z0: -CW, z1: CW, f: 0, label: c.kind === 'pass' ? c.name.replace('Rooms ', '') : c.kind === 'loco' ? '🚂' : 'Caboose', color: c.kind === 'loco' ? '#3a4a3a' : c.kind === 'cab' ? '#7a3a2a' : '#5a3a3a' }));

    // paths
    const node = M.node;
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
    finish(M);
    // people start in the corridors
    M.SPAWNS = M.NODES.filter((n) => n.z === DOORZ && M.carAt(n.x).kind === 'pass');
    return M;
  }

  // =====================================================================
  // The mansion: 2 floors, 3 rooms on each, a hallway along the front and stairs at the end of the hallway.
  //   Downstairs: kitchen, dining room, living room.  Upstairs: bedroom, bathroom, study (the meeting room).
  //   x runs along the house (0 to 27), z from the front wall (0) to the back wall (12).
  // =====================================================================
  function buildMansion() {
    const M = newMap('mansion', 'The Mansion', 2);
    const W = 27, D = 12, HALL = 3, T = 0.15;
    const { wall, furn, hide } = M;
    M.BOUNDS = { x0: 0, x1: W, z0: 0, z1: D };
    M.linkDist = 2.3;
    const rooms = [
      { name: 'Kitchen', f: 0, x0: 0, x1: 8, color: '#5a6a4a' },
      { name: 'Dining room', f: 0, x0: 8, x1: 16, color: '#6a3a3a' },
      { name: 'Living room', f: 0, x0: 16, x1: W, color: '#4a4a6a' },
      { name: 'Bedroom', f: 1, x0: 0, x1: 8, color: '#5a4a6a' },
      { name: 'Bathroom', f: 1, x0: 8, x1: 16, color: '#3a5a6a' },
      { name: 'Study', f: 1, x0: 16, x1: W, color: '#7a1020' },
    ];
    for (const r of rooms) { r.z0 = HALL; r.z1 = D; r.xc = (r.x0 + r.x1) / 2; }
    M.ROOMS = rooms;
    const halls = [{ name: 'Downstairs hallway', f: 0 }, { name: 'Upstairs hallway', f: 1 }];
    // the stairs: a strip along the front wall at the end of the hallway, going up toward -x
    const ST = { x0: 21, x1: W, z0: 0, z1: 1.6, dir: -1, f0: 0, f1: 1 };
    M.STAIRS.push(ST);

    for (let f = 0; f < 2; f++) {
      wall(-T, W + T, -T, 0, f); wall(-T, W + T, D, D + T, f);   // front and back walls
      wall(-T, 0, 0, D, f); wall(W, W + T, 0, D, f);             // the two ends
      // the wall between the hallway and the rooms, with a door into each room
      let x = 0;
      for (const r of rooms.filter((r) => r.f === f)) { wall(x, r.xc - 0.6, HALL, HALL + T, f); x = r.xc + 0.6; }
      wall(x, W, HALL, HALL + T, f);
      // walls between rooms, with a door in the middle
      for (const px of [8, 16]) { wall(px, px + T, HALL, 7, f); wall(px, px + T, 8.2, D, f); }
    }
    // downstairs: a wall beside the stairs (you get on at the bottom, by the end wall) and a wall at the top end
    wall(ST.x0, 25, ST.z1, ST.z1 + 0.12, 0);
    wall(ST.x0, ST.x0 + 0.12, ST.z0, ST.z1, 0);
    // upstairs: a railing around the stairwell (you can see over it)
    furn(ST.x0, W, ST.z1, ST.z1 + 0.1, 1.0, 'rail', 1);

    const task = (kind, name, where, ox, oy, oz, sx, sz, f) => M.task(kind, name, where, ox, oy, oz, sx, sz, f);
    // --- kitchen ---
    furn(0.5, 5.6, 11.2, D, 0.9, 'counter');
    furn(5.6, 7.4, 11.2, D, 0.9, 'oven');
    furn(0, 0.8, 7.6, 9.2, 1.9, 'fridge');
    furn(3, 5, 6, 7.4, 0.78, 'ktable');
    furn(7.25, 7.85, 3.3, 3.9, 0.6, 'trash');
    hide('pantry', 0, 0.9, 3.25, 5, 1.45, 4.1);
    task('dishes', 'Wash the dishes', 'the kitchen', 2.2, 0.9, 11.6, 2.2, 10.55, 0);
    task('soup', 'Cook the soup', 'the kitchen', 6.5, 0.9, 11.6, 6.5, 10.55, 0);
    task('trash', 'Take out the trash', 'the kitchen', 7.55, 0.6, 3.6, 6.85, 4.3, 0);
    task('fridge', 'Put the groceries away', 'the kitchen', 0.4, 1.2, 8.4, 1.3, 8.4, 0);
    // --- dining room ---
    furn(9.5, 14.5, 6.8, 8.4, 0.78, 'dtable');
    furn(10, 13, 11.4, D, 0.9, 'sideboard');
    furn(8.2, 8.8, 11.3, 11.9, 2.1, 'gclock');
    hide('cabinet', 15.2, 15.95, 9.5, 11.2, 14.6, 10.35);
    task('settable', 'Set the table', 'the dining room', 11, 0.8, 7.6, 11, 8.95, 0);
    task('candles', 'Light the candles', 'the dining room', 13.5, 0.8, 7.6, 13.5, 6.25, 0);
    task('silver', 'Polish the silver', 'the dining room', 11.5, 0.9, 11.7, 11.5, 10.75, 0);
    task('clock', 'Wind the grandfather clock', 'the dining room', 8.5, 1.5, 11.3, 9.25, 10.9, 0);
    // --- living room ---
    furn(18, 22, 10.8, 11.8, 0.8, 'sofa');
    furn(26.2, W, 6, 8.5, 1.2, 'fireplace');
    furn(24, 25, 11.3, D, 0.9, 'radio');
    hide('closet', 16.2, 17, 9.8, 11.8, 17.55, 10.8);
    task('fire', 'Light the fireplace', 'the living room', 26.3, 0.5, 7.25, 25.4, 7.25, 0);
    task('cushions', 'Fluff the cushions', 'the living room', 20, 0.8, 11.3, 20, 10.2, 0);
    task('plant', 'Water the plant', 'the living room', 16.6, 0, 3.7, 17.3, 4.4, 0);
    task('radio', 'Tune the radio', 'the living room', 24.5, 0.9, 11.65, 24.5, 10.7, 0);
    // --- downstairs hallway ---
    hide('closet', 0.05, 0.9, 0.05, 1.4, 1.45, 0.75, 0);
    task('sweep', 'Sweep the hallway', 'the downstairs hallway', 9, 0, 1.5, 9, 1.5, 0);
    // --- bedroom ---
    furn(0.3, 2.5, 9.5, D, 0.6, 'mbed', 1);
    furn(3.5, 5.5, 11.4, D, 1.0, 'dresser', 1);
    hide('wardrobe', 6.6, 7.95, 11.2, D, 7.25, 10.6, 1);
    task('bed', 'Make the bed', 'the bedroom', 1.4, 0.6, 10.5, 2.85, 10.5, 1);
    task('clothes', 'Fold the clothes', 'the bedroom', 4.5, 1.0, 11.7, 4.5, 10.8, 1);
    task('curtains', 'Close the curtains', 'the bedroom', 0.08, 1.6, 6, 0.8, 6, 1);
    task('cat', 'Feed the cat', 'the bedroom', 6, 0, 4.4, 6, 5.1, 1);
    // --- bathroom ---
    furn(8.2, 10.5, 10.5, D, 0.6, 'bath', 1);
    furn(12, 13, 11.5, D, 0.9, 'bsink', 1);
    furn(14.5, 15.3, 11.3, D, 0.5, 'toilet', 1);
    hide('shower', 15.0, 15.95, 3.25, 4.6, 14.4, 3.95, 1);
    task('mirror', 'Clean the mirror', 'the bathroom', 12.5, 1.6, 11.95, 12.5, 10.95, 1);
    task('tub', 'Scrub the bathtub', 'the bathroom', 9.3, 0.6, 11.2, 9.3, 9.9, 1);
    task('toilet', 'Unclog the toilet', 'the bathroom', 14.9, 0.5, 11.65, 14.9, 10.7, 1);
    task('towels', 'Hang up the towels', 'the bathroom', 8.2, 1.2, 5, 9.0, 5, 1);
    // --- study: the meeting room (no tasks, no hiding) ---
    furn(19, 24, 7, 8.5, 0.8, 'meeting', 1);
    furn(16.5, 26.5, 11.6, D, 2.2, 'books', 1);
    // --- upstairs hallway ---
    hide('closet', 0.05, 0.9, 0.05, 1.4, 1.45, 0.75, 1);
    task('paint', 'Dust the paintings', 'the upstairs hallway', 10, 1.6, 0.05, 10, 0.9, 1);

    const study = rooms[5];
    M.MEETING = { x0: study.x0, x1: study.x1, z0: HALL, z1: D, f: 1, sx: 21.5, sz: 9.5 };
    M.MEETING_NAME = 'the study (the meeting room, upstairs)';
    M.MEETING_SHORT = 'the study';
    M.zoneName = (x, z, f = 0) => {
      if (M.stairAt(x, z)) return 'the stairs';
      if (z < HALL) return halls[f].name;
      const r = rooms.find((r) => r.f === f && x >= r.x0 && x < r.x1);
      return r ? r.name : halls[f].name;
    };
    M.placeName = (x, z, f = 0) => { const n = M.zoneName(x, z, f); return n === 'Study' ? 'Study (meeting room)' : n === 'the stairs' ? 'Stairs' : n; };
    M.MAP = [];
    for (let f = 0; f < 2; f++) {
      M.MAP.push({ x0: 0, x1: W, z0: 0, z1: HALL, f, label: f ? 'Upstairs' : 'Downstairs', color: '#5a4a3a' });
      for (const r of rooms.filter((r) => r.f === f)) M.MAP.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, f, label: r.name, color: r.color });
      M.MAP.push({ x0: ST.x0, x1: ST.x1, z0: ST.z0, z1: ST.z1, f, label: '', color: '#8a7a5a' });
    }

    // paths: a grid of points on each floor, plus the doorways and the stairs
    for (let f = 0; f < 2; f++) {
      for (let x = 0.75; x < W; x += 1.5) for (let z = 0.75; z < D; z += 1.5) {
        if (M.STAIRS.some((s) => x > s.x0 - 0.3 && x < s.x1 + 0.3 && z > s.z0 - 0.3 && z < s.z1 + 0.3)) continue;
        M.node(x, z, f);
      }
      for (const r of rooms.filter((r) => r.f === f)) { M.node(r.xc, HALL - 0.6, f); M.node(r.xc, HALL + 0.7, f); }
      for (const px of [8, 16]) { M.node(px - 0.6, 7.6, f); M.node(px + 0.75, 7.6, f); }
    }
    // around the dining table
    for (const [x, z] of [[9.0, 6.0], [9.0, 9.0], [15.1, 6.0], [15.1, 9.0], [12, 9.0], [12, 6.1]]) M.node(x, z, 0);
    const bottom = M.node(26.3, 0.8, 0), bottom2 = M.node(26.3, 2.35, 0), top = M.node(20.3, 0.8, 1);
    M.LINKS.push([bottom, top], [bottom, bottom2]);
    // only keep points where a person fits
    const keep = M.NODES.filter((n) => !blockedRaw(M, n.x, n.z, n.f));
    M.NODES.length = 0;
    keep.forEach((n, i) => { n.i = i; M.NODES.push(n); });
    finish(M);
    M.SPAWNS = M.NODES.filter((n) => !M.inMeeting(n.x, n.z, n.f) && !M.stairAt(n.x, n.z));
    return M;
  }
  // bumping check before the map is finished
  function blockedRaw(M, x, z, f) {
    for (const w of M.WALLS.concat(M.FURN)) if (w.f === f && x + R > w.x0 && x - R < w.x1 && z + R > w.z0 && z - R < w.z1) return true;
    return false;
  }

  const MAPS = { train: buildTrain(), mansion: buildMansion() };
  if (typeof module !== 'undefined' && module.exports) module.exports = MAPS;
  else window.MAPS = MAPS;
})();
