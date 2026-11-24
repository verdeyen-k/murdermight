// Murder Might: a murder mystery on a train.
// One secret murderer, everyone else innocent. Innocents do 5 tasks, then go to the meeting room to accuse.
// Two maps: the train and the mansion (see maps.js).
// The murderer starts with a dagger, gets a shotgun after 2 kills and a tracker after 4.
(() => {
  'use strict';
  const MAPS = window.MAPS;
  let TR = MAPS.train; // the map being played
  const $ = (id) => document.getElementById(id);

  const COLORS = [
    { n: 'Red', h: '#e53935' }, { n: 'Orange', h: '#fb8c00' }, { n: 'Yellow', h: '#fdd835' }, { n: 'Green', h: '#43a047' },
    { n: 'Teal', h: '#00a58e' }, { n: 'Blue', h: '#1e88e5' }, { n: 'Purple', h: '#8e24aa' }, { n: 'Pink', h: '#f472b6' },
    { n: 'Black', h: '#262626' }, { n: 'White', h: '#f2f2f2' },
  ];
  const MAXP = 10, NTASK = 5;
  const EYE = 1.55, SPEED = 3.4, BOT_SPEED = 2.8, GHOST_SPEED = 6;
  const TASK_TIME = 3, REACH = 1.5;
  const DAGGER = 2.0, SHOTGUN = 12, GRACE = 10;
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const now = () => performance.now() / 1000;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const faceTo = (s, x, z) => Math.atan2(-(x - s.x), -(z - s.z));
  const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };

  let G = null;     // the game being played
  let A = null;     // the referee's notes (solo, or the host online)
  let room = null;  // online room

  const cname = (i) => COLORS[G.slots[i].c].n;
  const tag = (i) => `<span class="dot" style="background:${COLORS[G.slots[i].c].h};width:14px;height:14px;vertical-align:-2px"></span> <b>${cname(i)}</b>`;

  // =====================================================================
  // Sound
  // =====================================================================
  let AC = null, rumbleOn = false, rumbleGain = null;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (AC.state === 'suspended') AC.resume();
    if (!rumbleOn && AC) { rumbleOn = true; startRumble(); }
    return AC;
  }
  let NOISE = null; // one shared 2-second noise sound, reused by every effect
  function noiseBuf() {
    if (NOISE) return NOISE;
    NOISE = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = NOISE.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return NOISE;
  }
  function noise(sec, freq, vol, type = 'lowpass') {
    if (!audio()) return;
    const src = AC.createBufferSource(); src.buffer = noiseBuf();
    const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = AC.createGain(); g.gain.setValueAtTime(vol, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + sec);
    src.connect(f).connect(g).connect(AC.destination); src.start(0, Math.random(), sec);
  }
  function tone(freq, sec, vol, type = 'sine', to) {
    if (!audio()) return;
    const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, AC.currentTime);
    if (to) o.frequency.exponentialRampToValueAtTime(to, AC.currentTime + sec);
    const g = AC.createGain(); g.gain.setValueAtTime(vol, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + sec);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + sec);
  }
  function startRumble() {
    const src = AC.createBufferSource(); src.buffer = noiseBuf(); src.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 90;
    const g = AC.createGain(); g.gain.value = G && TR.name !== 'train' ? 0 : 0.25; rumbleGain = g;
    src.connect(f).connect(g).connect(AC.destination); src.start();
    setInterval(() => { if (G && !document.hidden && TR.name === 'train') { noise(0.06, 900, 0.05); setTimeout(() => noise(0.06, 800, 0.04), 160); } }, 1300);
  }
  const SFX = {
    stab: () => noise(0.2, 2500, 0.5, 'highpass'),
    bang: (v = 1) => { noise(0.6, 1200, 0.9 * v); tone(80, 0.4, 0.6 * v, 'sine', 30); },
    ding: () => { tone(880, 0.15, 0.25); setTimeout(() => tone(1320, 0.3, 0.25), 120); },
    buzz: () => tone(130, 0.6, 0.3, 'square'),
    yay: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.2, 'triangle'), i * 120)); },
    whistle: () => { tone(520, 0.9, 0.12, 'triangle'); tone(655, 0.9, 0.12, 'triangle'); },
    swish: () => noise(0.12, 3000, 0.2, 'bandpass'),
    gasp: () => tone(500, 0.4, 0.2, 'sawtooth', 200),
  };

  // =====================================================================
  // 3D world
  // =====================================================================
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0a12);
  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 240);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const mats = {};
  const mat = (c) => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({ color: c }));
  const glow = (c) => mats['g' + c] || (mats['g' + c] = new THREE.MeshBasicMaterial({ color: c }));
  function boxAt(parent, w, h, d, x, y, z, color, m) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat(color));
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function cyl(parent, r1, r2, h, x, y, z, color, seg = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat(color));
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function ball(parent, r, x, y, z, color, m) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m || mat(color));
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function textTex(text, bg, fg, w = 256, h = 96, size = 54) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = fg; g.font = `bold ${size}px Fredoka, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 3);
    const t = new THREE.CanvasTexture(c); return t;
  }
  function sign(text, x, y, z, rotY, w = 0.5, h = 0.19, bg = '#2b1a0e', fg = '#ffd86b') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTex(text, bg, fg, Math.round(256 * w / h / 2.6), 96, 54) }));
    m.position.set(x, y, z); m.rotation.y = rotY; build.add(m); return m;
  }

  // the view out of the windows: one long picture that slides past
  const landTex = (() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 256); sky.addColorStop(0, '#2a3b7a'); sky.addColorStop(0.55, '#e88a6a'); sky.addColorStop(0.6, '#3d6b3a'); sky.addColorStop(1, '#22401f');
    g.fillStyle = sky; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = '#4a5a8a';
    for (let x = 0; x < 1024; x += 4) { const y = 130 - 35 * Math.abs(Math.sin(x / 90)) - 15 * Math.sin(x / 33); g.fillRect(x, y, 4, 160 - y); }
    g.fillStyle = '#2e5a2a';
    for (let x = 0; x < 1024; x += 4) { const y = 150 - 14 * Math.sin(x / 50 + 1); g.fillRect(x, y, 4, 256 - y); }
    for (let i = 0; i < 26; i++) {
      const x = (i * 39 + 7) % 1024, y = 150 + (i * 13) % 50;
      g.fillStyle = '#3a2a1a'; g.fillRect(x - 2, y - 4, 4, 18);
      g.fillStyle = i % 3 ? '#1e4a22' : '#285a2a'; g.beginPath(); g.arc(x, y - 12, 12 + (i % 4) * 3, 0, Math.PI * 2); g.fill();
    }
    for (let x = 0; x < 1024; x += 128) { g.fillStyle = '#2a2018'; g.fillRect(x, 120, 5, 120); g.fillRect(x - 10, 124, 25, 4); }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
  })();
  const LAND_W = 18; // metres of train per copy of the picture
  function windowPane(x, y, z, w, h, facing, tex = landTex) {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const wx = x + pos.getX(i) * facing; // which way the plane faces flips its x
      uv.setX(i, wx / LAND_W);
    }
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(x, y, z); m.rotation.y = facing > 0 ? 0 : Math.PI; build.add(m);
    boxAt(build, w + 0.1, 0.06, 0.06, x, y - h / 2, z + 0.02 * facing, '#3a2412');
    boxAt(build, w + 0.1, 0.06, 0.06, x, y + h / 2, z + 0.02 * facing, '#3a2412');
  }

  const WALL_H = 2.7;
  let build = scene; // the group that the map being drawn goes into
  function drawTrain(M) {
    build.add(new THREE.AmbientLight(0xffffff, 0.45));
    build.add(new THREE.HemisphereLight(0xfff0d8, 0x442a1a, 0.4));
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
    for (const car of M.CARS) {
      const len = car.x1 - car.x0, cx = (car.x0 + car.x1) / 2;
      const floor = car.kind === 'loco' ? '#3b3b40' : car.kind === 'cab' ? '#6b4a2a' : '#8a5a34';
      boxAt(build, len, 0.1, M.CW * 2 + 0.24, cx, -0.05, 0, floor);
      boxAt(build, len, 0.1, M.CW * 2 + 0.24, cx, WALL_H + 0.05, 0, car.kind === 'loco' ? '#2a2a2e' : '#e8d8b8');
      if (car.kind === 'pass') boxAt(build, len - 2, 0.02, 1.0, cx, 0.01, M.DOORZ, '#7a1e2a'); // corridor carpet
      const nl = car.kind === 'pass' ? 2 : 1;
      for (let k = 0; k < nl; k++) {
        const lx = car.x0 + len * (k + 0.5) / nl;
        const l = new THREE.PointLight(0xffd9a0, 0.8, 20); l.position.set(lx, 2.35, 0.3); build.add(l);
      }
      for (let lx = car.x0 + 1.5; lx < car.x1 - 0.5; lx += 4) ball(build, 0.1, lx, WALL_H - 0.05, M.DOORZ, null, lampMat);
      // car name signs over the doors
      if (car.i > 0) sign(car.name, car.x0 + M.T + 0.01, 2.2, M.DOORZ, Math.PI / 2, 0.9, 0.22);
      if (car.i < M.CARS.length - 1) sign(car.name, car.x1 - M.T - 0.01, 2.2, M.DOORZ, -Math.PI / 2, 0.9, 0.22);
      if (car.i < M.CARS.length - 1) { // the walkway between cars
        const nx = M.CARS[car.i + 1].x0;
        boxAt(build, nx - car.x1, 0.1, M.DOOR1 - M.DOOR0 + 0.24, (car.x1 + nx) / 2, -0.05, M.DOORZ, '#2a2a2a');
        boxAt(build, nx - car.x1, 0.1, M.DOOR1 - M.DOOR0 + 0.24, (car.x1 + nx) / 2, WALL_H + 0.05, M.DOORZ, '#1a1a1a');
      }
    }
    for (const w of M.WALLS) {
      const car = M.CARS.find((c) => w.x0 >= c.x0 - 0.01 && w.x1 <= c.x1 + 0.01);
      let color = '#c39463', h = WALL_H;
      if (w.z0 <= -M.CW - M.T + 0.001 || w.z1 >= M.CW + M.T - 0.001) color = '#6e2630';
      else if (!car) color = '#4a4a4e';
      else if (w.boiler) { color = '#20402c'; h = 2.2; }
      else if (car.kind !== 'pass') color = '#5a3a22';
      boxAt(build, w.x1 - w.x0, h, w.z1 - w.z0, (w.x0 + w.x1) / 2, h / 2, (w.z0 + w.z1) / 2, color);
    }
    // windows
    for (const r of M.ROOMS) {
      windowPane(r.xc, 1.55, -M.CW + 0.01, 1.2, 0.8, 1);
      windowPane(r.xc, 1.55, M.CW - 0.01, 1.2, 0.8, -1);
      const t = textTex(String(r.n), r.n === M.MEETING_N ? '#7a1020' : '#2b1a0e', '#ffd86b', 128, 96, 60);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.25), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(r.xc, 2.3, M.CORR + M.T + 0.01); build.add(m);
      if (r.n === M.MEETING_N) sign('MEETING ROOM', r.xc, 2.0, M.CORR + M.T + 0.01, 0, 0.9, 0.16, '#7a1020', '#fff');
    }
    for (const car of M.CARS) if (car.kind !== 'pass') {
      for (let x = car.x0 + 2; x < car.x1 - 1; x += 3) windowPane(x, 1.6, M.CW - 0.01, 1.0, 0.7, -1);
    }
    for (const f of M.FURN) drawFurn(M, f);
    // the front of the locomotive: a fire door on the boiler
    const loco = M.CARS[0];
    boxAt(build, 0.04, 0.5, 0.7, loco.x0 + 6.52, 0.6, -1.3, null, glow('#ff6a10'));
    // task objects
    for (const t of M.TASKS) taskObject(M, t);
  }

  // is this piece of furniture a hiding place?
  function hideAt(M, f) {
    return M.HIDES.find((h) => h.f === (f.f || 0) && Math.abs(h.x - (f.x0 + f.x1) / 2) < 0.01 && Math.abs(h.z - (f.z0 + f.z1) / 2) < 0.01);
  }
  // a wardrobe, locker, closet, pantry, cabinet or shower, with its doors facing where you get in
  function drawHide(P, f, h) {
    const w = f.x1 - f.x0, d = f.z1 - f.z0, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
    const look = {
      wardrobe: ['#6a3e1e', '#4a2a12'], closet: ['#7a5030', '#4a2a12'], pantry: ['#c8b080', '#7a5a3a'],
      cabinet: ['#5a2a18', '#3a1a0a'], locker: ['#4a5a6a', '#333'], shower: ['#e8f0f4', '#9ab0c0'],
    }[h.kind] || ['#6a3e1e', '#4a2a12'];
    boxAt(P, w, f.h, d, cx, f.h / 2, cz, look[0]);
    boxAt(P, w + 0.04, 0.06, d + 0.04, cx, f.h, cz, look[1]);
    // which side are the doors on? the side nearest where you get in
    const side = h.ez < f.z0 ? 'z0' : h.ez > f.z1 ? 'z1' : h.ex < f.x0 ? 'x0' : 'x1';
    const alongX = side[0] === 'z';
    const fz = side === 'z0' ? f.z0 - 0.01 : side === 'z1' ? f.z1 + 0.01 : cz;
    const fx = side === 'x0' ? f.x0 - 0.01 : side === 'x1' ? f.x1 + 0.01 : cx;
    if (h.kind === 'shower') { // a shower curtain
      boxAt(P, alongX ? w - 0.1 : 0.02, f.h - 0.3, alongX ? 0.02 : d - 0.1, fx, f.h / 2 + 0.1, fz, '#5aa8d8');
      return;
    }
    boxAt(P, alongX ? 0.015 : 0.02, f.h - 0.2, alongX ? 0.02 : 0.015, fx, f.h / 2, fz, '#2a1a0a');
    for (const k of [-0.06, 0.06]) ball(P, 0.025, fx + (alongX ? k : 0), 1.0, fz + (alongX ? 0 : k), '#e8c040');
    if (h.kind === 'locker') for (let y = 1.5; y < 1.8; y += 0.08) boxAt(P, alongX ? w - 0.2 : 0.02, 0.02, alongX ? 0.02 : d - 0.2, fx, y, fz, '#222');
  }

  // ---------- the mansion ----------
  const gardenTex = new THREE.CanvasTexture(landTex.image); gardenTex.wrapS = THREE.RepeatWrapping;
  function drawMansion(M) {
    const FH = M.FH, W = M.BOUNDS.x1, D = M.BOUNDS.z1, ST = M.STAIRS[0];
    build.add(new THREE.AmbientLight(0xffffff, 0.5));
    build.add(new THREE.HemisphereLight(0xfff0d8, 0x442a1a, 0.4));
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
    for (let f = 0; f < 2; f++) {
      const y = f * FH;
      // floors: downstairs is one big floor, upstairs has a hole for the stairs
      if (f === 0) boxAt(build, W, 0.1, D, W / 2, -0.05, D / 2, '#7a5030');
      else {
        boxAt(build, ST.x0, 0.2, D, ST.x0 / 2, y - 0.1, D / 2, '#7a5030');
        boxAt(build, W - ST.x0, 0.2, D - ST.z1, (ST.x0 + W) / 2, y - 0.1, (ST.z1 + D) / 2, '#7a5030');
      }
      boxAt(build, W, 0.1, D, W / 2, y + FH - 0.15, D / 2, '#efe4cc').visible = f === 1; // the roof's ceiling
      // rugs and tiles in each room
      for (const r of M.ROOMS.filter((r) => r.f === f)) {
        const tile = r.name === 'Kitchen' || r.name === 'Bathroom';
        boxAt(build, r.x1 - r.x0 - 1.2, 0.02, r.z1 - r.z0 - 1.2, r.xc, y + 0.01, (r.z0 + r.z1) / 2, tile ? '#d8d8d0' : r.color);
        const l = new THREE.PointLight(0xffd9a0, 0.75, 14); l.position.set(r.xc, y + 2.7, 7.5); build.add(l);
        ball(build, 0.15, r.xc, y + FH - 0.3, 7.5, null, lamp);
        // the room's name over its door, on the hallway side
        sign(r.name === 'Study' ? 'STUDY (MEETING ROOM)' : r.name.toUpperCase(), r.xc, y + 2.55, M.ROOMS[0].z0 - 0.01, Math.PI, r.name === 'Study' ? 1.5 : 1.1, 0.22, r.name === 'Study' ? '#7a1020' : '#2b1a0e', '#ffd86b');
        windowPane(r.xc, y + 1.6, D - 0.01, 1.6, 1.1, -1, gardenTex);
      }
      boxAt(build, W - 1, 0.02, 1.2, W / 2 - 3, y + 0.01, 1.5, '#7a1e2a'); // hallway carpet
      for (const lx of [5, 15]) {
        const l = new THREE.PointLight(0xffd9a0, 0.6, 12); l.position.set(lx, y + 2.6, 1.5); build.add(l);
        ball(build, 0.12, lx, y + FH - 0.3, 1.5, null, lamp);
      }
      for (const wx of [4, 12]) windowPane(wx, y + 1.6, 0.01, 1.4, 1.0, 1, gardenTex);
      // paintings in the hallway
      for (const px of [7, 10, 17]) { boxAt(build, 0.9, 0.7, 0.04, px, y + 1.6, 0.03, '#c0a040'); boxAt(build, 0.75, 0.55, 0.02, px, y + 1.6, 0.06, ['#4a6a9a', '#9a4a4a', '#4a8a5a'][px % 3]); }
    }
    // walls
    for (const w of M.WALLS) {
      const outer = w.z0 < 0 || w.z1 > D || w.x0 < 0 || w.x1 > W;
      boxAt(build, w.x1 - w.x0, FH, w.z1 - w.z0, (w.x0 + w.x1) / 2, w.f * FH + FH / 2, (w.z0 + w.z1) / 2, outer ? '#8a6a5a' : '#d8c8a8');
    }
    // the stairs: 12 steps going up toward the study end of the hallway
    const n = 12, len = ST.x1 - ST.x0;
    for (let i = 0; i < n; i++) {
      const top = (i + 1) * FH / n, x1 = ST.x1 - i * len / n;
      boxAt(build, len / n, top, ST.z1 - ST.z0, x1 - len / n / 2, top / 2, (ST.z0 + ST.z1) / 2, i % 2 ? '#8a5a30' : '#7a4a24');
    }
    for (const f of M.FURN) drawFurn(M, f);
    for (const t of M.TASKS) taskObject(M, t);
  }

  // furniture (on its own floor)
  function drawFurn(M, f) {
    const P = new THREE.Group(); P.position.y = (f.f || 0) * M.FH; build.add(P);
      const w = f.x1 - f.x0, d = f.z1 - f.z0, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      if (f.kind === 'bed') {
        boxAt(P, w, 0.3, d, cx, 0.15, cz, '#5a3a22');
        boxAt(P, w - 0.05, 0.15, d - 0.05, cx, 0.37, cz, '#e9e4f2');
        boxAt(P, w * 0.55, 0.06, d - 0.04, cx + w * 0.2, 0.47, cz, '#6a7ac8');
      } else if (f.kind === 'table') {
        boxAt(P, w, 0.06, d, cx, f.h, cz, '#7a4e2a');
        boxAt(P, 0.08, f.h, 0.08, cx, f.h / 2, cz, '#5a3a22');
      } else if (f.kind === 'meeting') {
        boxAt(P, w, 0.08, d, cx, f.h, cz, '#4a2a18');
        boxAt(P, w - 0.2, f.h, 0.1, cx, f.h / 2, cz, '#3a2012');
        cyl(P, 0.12, 0.16, 0.18, cx, f.h + 0.13, cz, '#e8c040');
        for (const dx of [-0.6, 0, 0.6]) cyl(P, 0.2, 0.2, 0.45, cx + dx, 0.22, cz + d / 2 + 0.35, '#8a1e2e');
      } else if (f.kind === 'coal') {
        boxAt(P, w, 0.3, d, cx, 0.15, cz, '#3a3a3a');
        for (let i = 0; i < 14; i++) ball(P, 0.12 + (i % 3) * 0.04, f.x0 + 0.15 + (i * 0.37) % (w - 0.3), 0.35 + (i % 4) * 0.05, f.z0 + 0.15 + (i * 0.23) % (d - 0.3), '#151515');
      } else if (f.kind === 'panel') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#555a60');
        for (let i = 0; i < 4; i++) cyl(P, 0.06, 0.06, 0.05, f.x0 + 0.2 + i * 0.25, f.h + 0.03, cz, i % 2 ? '#e03030' : '#30c040', 8);
      } else if (f.kind === 'desk') {
        boxAt(P, w, 0.06, d, cx, f.h, cz, '#6a4020');
        boxAt(P, w - 0.1, f.h, d - 0.1, cx, f.h / 2, cz, '#4a2a14');
      } else if (f.kind === 'stove') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#222');
        boxAt(P, 0.4, 0.25, 0.02, cx, 0.45, f.z1 + 0.01, null, glow('#ff7a20'));
        cyl(P, 0.1, 0.1, WALL_H - f.h, cx, f.h + (WALL_H - f.h) / 2, cz, '#333');
      } else if (f.kind === 'bunk') {
        boxAt(P, w, 0.25, d, cx, f.h - 0.12, cz, '#5a3a22');
        boxAt(P, w - 0.05, 0.12, d - 0.05, cx, f.h + 0.06, cz, '#b0a080');
      } else if (hideAt(M, f)) {
        drawHide(P, f, hideAt(M, f));
      } else if (f.kind === 'counter' || f.kind === 'sideboard' || f.kind === 'dresser') {
        boxAt(P, w, f.h - 0.05, d, cx, (f.h - 0.05) / 2, cz, f.kind === 'counter' ? '#e8e0d0' : '#5a3218');
        boxAt(P, w + 0.04, 0.05, d + 0.04, cx, f.h - 0.025, cz, f.kind === 'counter' ? '#6a6a70' : '#3a1e0c');
      } else if (f.kind === 'oven') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#2a2a2e');
        boxAt(P, w - 0.3, 0.35, 0.02, cx, 0.35, f.z0 - 0.01, null, glow('#ff8a30'));
        for (const dx of [-0.4, 0.4]) cyl(P, 0.15, 0.15, 0.02, cx + dx, f.h + 0.01, cz, '#111', 12);
      } else if (f.kind === 'fridge') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#e8eef2');
        boxAt(P, 0.02, 0.5, 0.04, f.x1 + 0.01, 1.2, cz + 0.4, '#999');
      } else if (f.kind === 'dtable' || f.kind === 'ktable') {
        boxAt(P, w, 0.06, d, cx, f.h, cz, '#6a3a1a');
        for (const [ox, oz] of [[0.1, 0.1], [w - 0.1, 0.1], [0.1, d - 0.1], [w - 0.1, d - 0.1]]) boxAt(P, 0.08, f.h, 0.08, f.x0 + ox, f.h / 2, f.z0 + oz, '#4a2a12');
        if (f.kind === 'dtable') for (let x = f.x0 + 0.5; x < f.x1; x += 1) for (const z of [f.z0 - 0.35, f.z1 + 0.35]) {
          boxAt(P, 0.45, 0.06, 0.45, x, 0.45, z, '#7a1e2e'); boxAt(P, 0.45, 0.6, 0.06, x, 0.75, z + (z < cz ? -0.2 : 0.2), '#4a2a12');
        }
      } else if (f.kind === 'trash') {
        cyl(P, 0.28, 0.24, f.h, cx, f.h / 2, cz, '#6a7a6a');
      } else if (f.kind === 'gclock') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#4a2410');
        const face = cyl(P, 0.2, 0.2, 0.03, cx, 1.75, f.z0 - 0.01, '#f4ecd0', 20); face.rotation.x = Math.PI / 2;
      } else if (f.kind === 'sofa') {
        boxAt(P, w, 0.45, d, cx, 0.22, cz, '#8a2a3a');
        boxAt(P, w, 0.5, 0.25, cx, 0.7, f.z1 - 0.12, '#7a1e2e');
        for (const x of [f.x0 + 0.12, f.x1 - 0.12]) boxAt(P, 0.25, 0.65, d, x, 0.32, cz, '#7a1e2e');
      } else if (f.kind === 'fireplace') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#8a5a4a');
        boxAt(P, 0.04, 0.6, d - 0.8, f.x0 - 0.01, 0.4, cz, null, glow('#ff6a10'));
        boxAt(P, w + 0.2, 0.1, d + 0.2, cx, f.h, cz, '#5a3a2a');
      } else if (f.kind === 'radio') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#6a3a1a');
        boxAt(P, w - 0.3, 0.3, 0.02, cx, 0.6, f.z0 - 0.01, '#d8c080');
      } else if (f.kind === 'mbed') {
        boxAt(P, w, 0.35, d, cx, 0.18, cz, '#5a3a22');
        boxAt(P, w - 0.05, 0.2, d - 0.05, cx, 0.45, cz, '#f0e8f4');
        boxAt(P, w - 0.1, 0.06, d * 0.55, cx, 0.57, f.z0 + d * 0.3, '#b04a6a');
        boxAt(P, w, 1.1, 0.1, cx, 0.55, f.z1 - 0.05, '#4a2a12');
      } else if (f.kind === 'bath') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#f4f4f8');
        boxAt(P, w - 0.2, 0.05, d - 0.2, cx, f.h - 0.04, cz, '#7ac0e8');
      } else if (f.kind === 'bsink' || f.kind === 'toilet') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#f4f4f8');
        if (f.kind === 'bsink') boxAt(P, w - 0.1, 0.8, 0.03, cx, 1.6, f.z1 - 0.02, '#bfe0f0');
      } else if (f.kind === 'books') {
        boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#4a2a12');
        for (let y = 0.35; y < f.h; y += 0.45) for (let x = f.x0 + 0.1; x < f.x1 - 0.1; x += 0.3) boxAt(P, 0.22, 0.32, 0.04, x + 0.11, y, f.z0 - 0.02, ['#a03030', '#305a90', '#30804a', '#c0a030'][Math.floor(x * 7 + y * 3) % 4]);
      } else if (f.kind === 'rail') {
        boxAt(P, w, 0.06, d, cx, f.h, cz, '#5a3218');
        for (let x = f.x0 + 0.1; x < f.x1; x += 0.4) boxAt(P, 0.05, f.h, 0.05, x, f.h / 2, cz, '#5a3218');
      } else boxAt(P, w, f.h, d, cx, f.h / 2, cz, '#777');
      }
  function taskObject(M, t) {
    const g = new THREE.Group(); g.position.set(t.ox, t.oy + t.f * M.FH, t.oz); build.add(g);
    switch (t.kind) {
      case 'bed': boxAt(g, 0.45, 0.14, 0.4, 0, 0.05, 0, '#ffffff'); break;
      case 'lamp': cyl(g, 0.05, 0.08, 0.3, 0, 0.15, 0, '#8a6a3a'); cyl(g, 0.08, 0.17, 0.18, 0, 0.36, 0, '#f0d070'); break;
      case 'case': boxAt(g, 0.6, 0.4, 0.22, 0, 0.2, 0, '#8a4a1e'); boxAt(g, 0.2, 0.05, 0.04, 0, 0.43, 0, '#333'); break;
      case 'plant': cyl(g, 0.15, 0.11, 0.3, 0, 0.15, 0, '#b0502a'); ball(g, 0.25, 0, 0.5, 0, '#2f8a2f'); break;
      case 'clock': { const c = cyl(g, 0.18, 0.18, 0.04, 0.02, 0, 0, '#f4ecd0', 20); c.rotation.z = Math.PI / 2; boxAt(g, 0.02, 0.13, 0.02, 0.05, 0.05, 0, '#222'); break; }
      case 'window': boxAt(g, 0.3, 0.25, 0.03, 0.4, -0.25, 0.03, '#60d0f0'); break;
      case 'coal': { const s = boxAt(g, 0.06, 1.0, 0.06, 0, 0.3, 0.35, '#7a5a3a'); s.rotation.x = 0.4; boxAt(g, 0.25, 0.03, 0.3, 0, -0.15, 0.6, '#666'); break; }
      case 'gauge': for (const dz of [-0.2, 0.2]) { const c = cyl(g, 0.12, 0.12, 0.04, 0.03, 0, dz, '#f0f0e0', 16); c.rotation.z = Math.PI / 2; } break;
      case 'whistle': cyl(g, 0.01, 0.01, 0.5, 0, 0.25, 0, '#ccc', 6); ball(g, 0.05, 0, 0, 0, '#e0b030'); break;
      case 'brake': { const w = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 8, 20), mat('#c03030')); w.rotation.y = Math.PI / 2; g.add(w); cyl(g, 0.03, 0.03, 1.1, 0, -0.55, 0, '#555', 6); break; }
      case 'mail': for (let i = 0; i < 4; i++) boxAt(g, 0.28, 0.02, 0.18, (i % 2) * 0.05, 0.03 + i * 0.025, 0, '#f4f0e0'); break;
      case 'stove': boxAt(g, 0.3, 0.12, 0.2, 0, 0.06, 0, '#5a2a10'); break;
      // the mansion
      case 'dishes': for (let i = 0; i < 4; i++) cyl(g, 0.13, 0.11, 0.02, 0, 0.02 + i * 0.025, 0, '#f4f4f4', 14); break;
      case 'soup': cyl(g, 0.16, 0.14, 0.22, 0, 0.11, 0, '#5a5a62', 14); break;
      case 'trash': boxAt(g, 0.3, 0.12, 0.3, 0, 0.06, 0, '#2a2a2a'); break;
      case 'fridge': boxAt(g, 0.4, 0.3, 0.3, 0.4, -0.65, 0, '#b07a3a'); break;
      case 'settable': for (const dx of [-0.6, 0, 0.6]) cyl(g, 0.12, 0.12, 0.02, dx, 0.02, 0, '#f4f4f4', 14); break;
      case 'candles': for (const dx of [-0.15, 0, 0.15]) { cyl(g, 0.03, 0.03, 0.25, dx, 0.13, 0, '#f4ecd0', 8); ball(g, 0.03, dx, 0.28, 0, null, glow('#ffb030')); } break;
      case 'silver': cyl(g, 0.12, 0.08, 0.1, 0, 0.05, 0, '#c8ccd4', 12); break;
      case 'clock': break;
      case 'fire': for (let i = 0; i < 3; i++) { const l = cyl(g, 0.05, 0.05, 0.6, 0, 0.05 + i * 0.08, -0.3 + i * 0.3, '#5a3a1a', 8); l.rotation.z = Math.PI / 2; } break;
      case 'cushions': for (const dx of [-1, 0, 1]) boxAt(g, 0.4, 0.35, 0.15, dx, 0.18, 0, ['#e0c040', '#40a0c0', '#c04070'][dx + 1]); break;
      case 'radio': ball(g, 0.04, 0.3, 0, -0.03, '#222'); break;
      case 'sweep': { const b = cyl(g, 0.02, 0.02, 1.2, 0, 0.6, 0, '#8a6a3a', 6); b.rotation.z = 0.3; boxAt(g, 0.3, 0.12, 0.08, -0.17, 0.05, 0, '#c0a050'); break; }
      case 'clothes': for (let i = 0; i < 3; i++) boxAt(g, 0.35, 0.05, 0.3, 0, 0.03 + i * 0.05, 0, ['#4a7ac0', '#c04a4a', '#e0e0e0'][i]); break;
      case 'curtains': boxAt(g, 0.04, 1.6, 1.3, 0.02, 0, 0, '#9a2a4a'); break;
      case 'cat': ball(g, 0.18, 0, 0.18, 0.25, '#e08a30'); ball(g, 0.11, 0, 0.36, 0.05, '#e08a30'); cyl(g, 0.12, 0.1, 0.06, 0, 0.03, -0.25, '#3070c0', 12); break;
      case 'mirror': boxAt(g, 0.7, 0.6, 0.02, 0, 0, -0.02, '#cfe8f4'); break;
      case 'tub': ball(g, 0.12, 0.3, 0.05, 0, '#f0e040'); break;
      case 'toilet': { const p = cyl(g, 0.02, 0.02, 0.6, 0.3, 0.3, 0, '#8a6a3a', 6); p.rotation.z = 0.2; cyl(g, 0.1, 0.06, 0.08, 0.36, 0.0, 0, '#a02020', 10); break; }
      case 'towels': boxAt(g, 0.04, 0.6, 0.5, 0.02, 0, 0, '#5ac0b0'); break;
      case 'paint': boxAt(g, 0.25, 0.08, 0.04, 0.6, -0.4, 0.05, '#e0d0a0'); break;
    }
    return g;
  }

  // ---------- people ----------
  function darker(hex, k) {
    const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString();
  }
  function makePerson(hex) {
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    const pants = hex === '#262626' ? '#444' : darker(hex, 0.6);
    boxAt(body, 0.15, 0.55, 0.16, -0.1, 0.28, 0, pants);
    boxAt(body, 0.15, 0.55, 0.16, 0.1, 0.28, 0, pants);
    cyl(body, 0.24, 0.27, 0.62, 0, 0.86, 0, hex);
    cyl(body, 0.06, 0.06, 0.55, -0.32, 0.88, 0, hex, 6).rotation.z = 0.15;
    cyl(body, 0.06, 0.06, 0.55, 0.32, 0.88, 0, hex, 6).rotation.z = -0.15;
    ball(body, 0.22, 0, 1.38, 0, '#f2c9a0');
    boxAt(body, 0.46, 0.12, 0.46, 0, 1.55, 0, hex); // a hat in their colour
    boxAt(body, 0.3, 0.14, 0.3, 0, 1.66, 0, hex);
    for (const ex of [-0.08, 0.08]) {
      ball(body, 0.045, ex, 1.42, -0.19, '#ffffff');
      ball(body, 0.025, ex, 1.42, -0.225, '#111111');
    }
    const hand = new THREE.Group(); hand.position.set(0.36, 0.7, -0.15); body.add(hand);
    const weapons = [null, makeDagger(), makeShotgun()];
    weapons[1].visible = weapons[2].visible = false;
    hand.add(weapons[1]); hand.add(weapons[2]);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), mat('#8a0a14'));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.015; pool.visible = false; g.add(pool);
    g.userData = { body, weapons, pool };
    scene.add(g);
    return g;
  }
  function makeDagger() {
    const g = new THREE.Group();
    boxAt(g, 0.05, 0.05, 0.14, 0, 0, 0.02, '#5a3a1a');
    boxAt(g, 0.16, 0.03, 0.03, 0, 0, -0.06, '#d4af37');
    boxAt(g, 0.04, 0.015, 0.34, 0, 0, -0.24, '#dfe6ee');
    return g;
  }
  function makeShotgun() {
    const g = new THREE.Group();
    boxAt(g, 0.08, 0.12, 0.3, 0, -0.02, 0.15, '#6a3a1a');
    const b = cyl(g, 0.035, 0.035, 0.8, 0, 0.03, -0.35, '#333', 8); b.rotation.x = Math.PI / 2;
    const b2 = cyl(g, 0.035, 0.035, 0.8, 0.065, 0.03, -0.35, '#333', 8); b2.rotation.x = Math.PI / 2;
    return g;
  }
  // the weapon you see in your own hand
  const viewWeapons = [null, makeDagger(), makeShotgun()];
  for (const w of viewWeapons.slice(1)) { w.visible = false; camera.add(w); }
  viewWeapons[1].position.set(0.28, -0.28, -0.5);
  viewWeapons[2].position.set(0.25, -0.3, -0.45);

  // my task markers: a glowing ring where to stand and a diamond over the object
  const markers = [];
  function makeMarkers() {
    for (const m of markers) scene.remove(m.ring, m.gem);
    markers.length = 0;
    if (G.me < 0) return;
    for (const id of G.slots[G.me].tasks) {
      const t = TR.TASKS[id];
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.45, 24), new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0.8 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(t.sx, 0.03, t.sz); scene.add(ring);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), glow('#ffd23d'));
      gem.position.set(t.ox, Math.min(t.oy + 0.6, 2.5), t.oz); scene.add(gem);
      markers.push({ id, ring, gem });
    }
  }

  // =====================================================================
  // Starting a game
  // =====================================================================
  // def: { id, slots: [{ c, o }], m, tasks: [[ids]], spawn: [[x, z]] }  (o = owner: '' for a bot)
  function makeDef(map, humans, total, murderer) {
    TR = MAPS[map];
    const free = shuffle(COLORS.map((_, i) => i).filter((i) => !humans.some((h) => h.c === i)));
    const slots = humans.map((h) => ({ c: h.c, o: h.o }));
    while (slots.length < total && free.length) slots.push({ c: free.pop(), o: '' });
    const ids = TR.TASKS.map((t) => t.id);
    const tasks = slots.map(() => shuffle(ids.slice()).slice(0, NTASK));
    const spots = shuffle(TR.SPAWNS.slice());
    const spawn = slots.map((_, i) => { const n = spots[i % spots.length]; return [n.x, n.z, n.f]; });
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), map, slots, m: murderer, tasks, spawn };
  }

  function startGame(def, online) {
    stopGame();
    TR = MAPS[def.map] || MAPS.train;
    showMap(TR.name);
    const me = online ? def.slots.findIndex((s) => s.o === myId) : def.slots.findIndex((s) => s.o === 'me');
    G = {
      def, online, host: online ? room.isHost : true, me, m: def.m, bodies: [], over: false, t0: now(),
      myDone: new Set(), seenBodies: new Set(), offs: [], hold: 0, lastSend: 0, cool: 0, swing: 0,
      slots: def.slots.map((d, i) => ({
        i, c: d.c, o: d.o || '', tasks: def.tasks[i], alive: true, out: false,
        x: def.spawn[i][0], z: def.spawn[i][1], a: Math.random() * Math.PI * 2, w: 0, kills: 0,
        tx: def.spawn[i][0], tz: def.spawn[i][1], ta: 0, ai: null, mesh: null, hide: -1, f: def.spawn[i][2] || 0,
      })),
    };
    for (const s of G.slots) { s.ta = s.a; s.mesh = makePerson(COLORS[s.c].h); }
    if (G.host) {
      A = { alive: G.slots.map(() => true), done: G.slots.map(() => new Set()), kills: 0, last: 0, over: false, start: now() };
      for (const s of G.slots) if (!s.o) s.ai = newAI(s);
    } else A = null;
    if (online) netStart();
    makeMarkers();
    pitch = 0;
    for (const id of ['menu', 'lobby', 'over', 'pick']) $(id).hidden = true;
    $('hud').hidden = false;
    $('touch').hidden = !isTouch;
    $('msgs').innerHTML = '';
    lastTaskHtml = '';
    const mine = G.slots[G.me];
    if (G.me === G.m) {
      big('🔪 You are the MURDERER!', `Kill everyone without getting seen. Your weapon is ready in ${GRACE} seconds. Click to attack!`, 6);
      $('role').className = 'm';
    } else {
      big('🙂 You are INNOCENT', `Do your 5 tasks, then go to ${TR.MEETING_NAME} to accuse the murderer!`, 6);
      $('role').className = 'i';
    }
    $('t-weap').hidden = $('t-hit').hidden = G.me !== G.m;
    $('t-acc').hidden = G.me === G.m;
    $('hiding').hidden = true;
    camera.position.set(mine.x, TR.yAt(mine.x, mine.z, mine.f) + EYE, mine.z);
    audio();
    if (rumbleGain) rumbleGain.gain.value = TR.name === 'train' ? 0.25 : 0;
    if (TR.name === 'train') SFX.whistle(); else SFX.ding();
    if (!isTouch) tryLock();
  }

  function stopGame() {
    if (!G) return;
    for (const off of G.offs) off();
    for (const s of G.slots) scene.remove(s.mesh);
    for (const m of markers) scene.remove(m.ring, m.gem);
    markers.length = 0;
    for (const w of viewWeapons.slice(1)) w.visible = false;
    G = null; A = null;
    $('hud').hidden = true; $('touch').hidden = true; $('pick').hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // =====================================================================
  // The referee (solo, or the host online). Everything that changes who's alive goes through here.
  // =====================================================================
  function emit(ev) {
    if (G.online) room.ref.child('ev').push(ev);
    else applyEv(ev);
  }
  function request(r) {
    if (!G) return;
    if (G.host) handleReq(r);
    else room.ref.child('req').push(r);
  }
  function handleReq(r) {
    if (!A || A.over || !G) return;
    const t = now();
    const by = r.by, k = G.slots[by];
    if (!k || !A.alive[by]) return;
    if (r.t === 'task') { if (k.tasks.includes(r.id)) A.done[by].add(r.id); return; }
    if (r.t === 'kill') {
      const w = r.w === 2 ? 2 : 1, v = r.v, s = G.slots[v];
      if (by !== G.m || (w === 2 && A.kills < 2) || t - A.start < GRACE - 1) return;
      const spot = s && s.hide >= 0 ? TR.HIDES[s.hide] : null;
      const ok = s && v !== by && A.alive[v] && t - A.last > 0.4 && (spot
        ? w === 1 && k.f === spot.f && Math.hypot(k.x - spot.x, k.z - spot.z) <= 2.2 // someone hiding: only the dagger, right at the hiding place
        : k.f === s.f && dist(k, s) <= (w === 2 ? SHOTGUN + 1.5 : DAGGER + 1.2) && (w === 1 || TR.see(k, s)));
      if (!ok) { if (w === 2) emit({ t: 'bang', by }); return; }
      A.alive[v] = false; A.kills++; A.last = t;
      emit({ t: 'kill', by, v, w, x: +s.x.toFixed(2), z: +s.z.toFixed(2), f: s.f });
      // bots who saw it now know who the murderer is
      for (const b of G.slots) {
        if (b.ai && A.alive[b.i] && b.i !== by && dist(b, k) < 20 && TR.see(b, k)) { b.ai.known = true; b.ai.sus = by; }
      }
      checkWin();
      return;
    }
    if (r.t === 'acc') {
      const v = r.v;
      if (by === G.m || !G.slots[v] || !A.alive[v] || v === by || A.done[by].size < NTASK || !TR.inMeeting(k.x, k.z, k.f, 0.8)) return;
      if (v === G.m) { A.over = true; emit({ t: 'acc', by, v, ok: 1 }); emit({ t: 'win', w: 'i', by }); return; }
      // wrong! the innocent you accused is out, and so are you
      A.alive[v] = false; A.alive[by] = false;
      emit({ t: 'acc', by, v, ok: 0, r: by });
      checkWin();
    }
  }
  function checkWin() {
    if (A.over) return;
    if (!G.slots.some((s) => A.alive[s.i] && s.i !== G.m)) { A.over = true; emit({ t: 'win', w: 'm' }); }
  }

  // ---------- what happened (everyone runs this) ----------
  function applyEv(ev) {
    if (!G) return;
    const me = G.slots[G.me];
    if (ev.t === 'kill') {
      const v = G.slots[ev.v], k = G.slots[ev.by];
      v.alive = false; v.x = v.tx = ev.x; v.z = v.tz = ev.z; v.f = ev.f || 0; v.w = 0; v.hide = -1;
      if (ev.v === G.me) $('hiding').hidden = true;
      k.kills++;
      G.bodies.push({ slot: ev.v, x: ev.x, z: ev.z, f: ev.f || 0 });
      layBody(v);
      if (ev.w === 2) bangHeard(ev.by); else if (dist(me, v) < 12) SFX.stab();
      if (ev.v === G.me) {
        flash(); SFX.gasp();
        big('💀 You were killed!', 'You are a ghost now. You can fly through walls and watch.', 5);
      }
      if (ev.by === G.me) {
        msg(`You got ${tag(ev.v)}. Kills: ${k.kills}`);
        if (k.kills === 2) { msg('🔫 You got the SHOTGUN! Press Q to switch weapons. It\'s LOUD!'); SFX.ding(); }
        if (k.kills === 4) { msg('📡 You got the TRACKER! Now the map shows everyone.'); SFX.ding(); }
      }
    } else if (ev.t === 'bang') {
      bangHeard(ev.by);
    } else if (ev.t === 'acc') {
      SFX.buzz();
      if (ev.ok) msg(`☝ ${tag(ev.by)} accused ${tag(ev.v)}... and was RIGHT!`);
      else {
        const outs = [ev.v].concat(ev.r >= 0 ? [ev.r] : []);
        for (const i of outs) { const s = G.slots[i]; s.alive = false; s.out = true; s.w = 0; s.mesh.visible = false; }
        msg(`☝ ${tag(ev.by)} accused ${tag(ev.v)}, but ${cname(ev.v)} was innocent! ${outs.map(tag).join(' and ')} ${outs.length > 1 ? 'are' : 'is'} ${TR.name === 'train' ? 'off the train' : 'out of the game'}!`);
        if (outs.includes(G.me)) big('🚪 You\'re out!', ev.v === G.me ? `${cname(ev.by)} accused you, but you were innocent!` : `${cname(ev.v)} was innocent, so you're out too!`, 5);
      }
    } else if (ev.t === 'win') {
      G.over = true;
      if (document.pointerLockElement) document.exitPointerLock();
      setTimeout(() => showOver(ev), 1800);
    }
  }
  function bangHeard(by) {
    const k = G.slots[by], me = G.slots[G.me];
    SFX.bang(Math.max(0.35, 1 - dist(me, k) / 80));
    const z = TR.zoneName(k.x, k.z, k.f);
    msg(`💥 BANG! A shotgun went off in <b>${/^(the |Rooms )/.test(z) ? z : 'the ' + z}</b>!`);
  }
  function layBody(s) {
    const m = s.mesh;
    m.visible = true;
    m.position.set(s.x, TR.yAt(s.x, s.z, s.f), s.z);
    m.userData.body.rotation.x = -Math.PI / 2;
    m.userData.body.position.y = 0.25;
    m.userData.pool.visible = true;
    for (const w of m.userData.weapons.slice(1)) w.visible = false;
  }
  function showOver(ev) {
    if (!G) return;
    const mur = tag(G.m);
    const iWon = (ev.w === 'm') === (G.me === G.m);
    $('over-title').textContent = ev.w === 'm' ? '🔪 The murderer wins!' : '🙂 The innocents win!';
    $('over-text').innerHTML = (ev.w === 'm'
      ? `The murderer was ${mur}, with ${G.slots[G.m].kills} kills. Nobody caught them!`
      : `${tag(ev.by)} caught the murderer: ${mur}!`) + `<br><br><b style="font-size:22px">${iWon ? '🏆 You win!' : '😢 You lose!'}</b>`;
    $('again').hidden = G.online && !G.host;
    $('again').textContent = G.online ? 'Back to the room' : 'Play again';
    $('over').hidden = false;
    if (iWon) SFX.yay(); else SFX.buzz();
  }

  // =====================================================================
  // Bots
  // =====================================================================
  function newAI(s) {
    return {
      path: [], goal: null, repath: 0, mode: '', task: -1, doing: 0, wait: 0, known: false, sus: -1, susT: 0,
      seen: new Set(), cool: now() + (s.i === G.m ? rand(18, 26) : 0), target: -1, targetT: 0, drawT: 0, hideAt: 0,
      think: rand(0, 0.2), stuckT: 0, lx: s.x, lz: s.z, until: 0,
    };
  }
  function goTo(s, x, z, f) { s.ai.path = TR.findPath(s.x, s.z, s.f, x, z, f); s.ai.goal = [x, z, f]; s.ai.stuckT = 0; }
  function sees(s, o, r) { return !(o.hide >= 0) && dist(s, o) < r && TR.see(s, o); }
  const spotFree = (id) => !G.slots.some((o) => o.hide === id && o.alive);
  function botHide(s, id) { const h = TR.HIDES[id]; s.x = h.ex; s.z = h.ez; s.f = h.f; s.hide = id; s.ai.path = []; s.w = 0; }

  function updateBot(s, dt, t) {
    const ai = s.ai;
    ai.think -= dt;
    if (ai.think <= 0) { ai.think = 0.2; if (s.i === G.m) thinkMurderer(s, t); else thinkInnocent(s, t); }
    if (!ai.path.length) return;
    const [gx, gz] = ai.path[0];
    const dx = gx - s.x, dz = gz - s.z, d = Math.hypot(dx, dz);
    if (d < 0.12) { ai.path.shift(); return; }
    const st = Math.min(d, (ai.mode === 'hunt' ? BOT_SPEED * 1.2 : BOT_SPEED) * dt); // the murderer hurries when hunting
    TR.move(s, dx / d * st, dz / d * st);
    s.a = Math.atan2(-dx, -dz);
    // stuck? try again
    if (Math.hypot(s.x - ai.lx, s.z - ai.lz) < 0.02) { ai.stuckT += dt; if (ai.stuckT > 1.2 && ai.goal) { TR.move(s, rand(-0.2, 0.2), rand(-0.2, 0.2)); goTo(s, ai.goal[0], ai.goal[1], ai.goal[2]); } }
    else ai.stuckT = 0;
    ai.lx = s.x; ai.lz = s.z;
  }
  function wander(s, t) {
    const ai = s.ai;
    if (ai.path.length) return;
    if (!ai.wait) { ai.wait = t + rand(1, 4); return; }
    if (t < ai.wait) return;
    ai.wait = 0;
    const near = TR.NODES.filter((n) => Math.abs(n.x - s.x) < 30);
    const n = pick(near.length ? near : TR.NODES);
    goTo(s, n.x, n.z, n.f);
  }

  function thinkInnocent(s, t) {
    const ai = s.ai, M = G.slots[G.m], mAlive = A.alive[G.m];
    if (s.hide >= 0) { // hiding: stay in until it feels safe
      if (t > ai.until && !(mAlive && M.hide < 0 && dist(s, M) < 6 && TR.see(s, M))) { s.hide = -1; ai.mode = ''; }
      return;
    }
    if (ai.mode === 'hide') { // on the way to a hiding place
      const h = TR.HIDES[ai.spot];
      if (!spotFree(ai.spot)) ai.mode = '';
      else if (s.f === h.f && Math.hypot(s.x - h.ex, s.z - h.ez) < 0.5) { botHide(s, ai.spot); ai.until = t + rand(8, 16); return; }
      else { if (!ai.path.length) goTo(s, h.ex, h.ez, h.f); return; }
    }
    if (mAlive && M.w > 0 && sees(s, M, 18)) { ai.known = true; ai.sus = G.m; }
    for (const b of G.bodies) {
      if (ai.seen.has(b.slot) || !sees(s, b, 10)) continue;
      ai.seen.add(b.slot);
      if (ai.known) continue;
      // who was standing near the body? (maybe the murderer... maybe not)
      let best = -1, bd = 8;
      for (const o of G.slots) {
        if (o.i === s.i || !A.alive[o.i]) continue;
        const d = Math.hypot(o.x - b.x, o.z - b.z);
        if (d < bd && sees(s, o, 20)) { bd = d; best = o.i; }
      }
      if (best >= 0 && Math.random() < 0.55) { ai.sus = best; ai.susT = t; }
    }
    if (ai.sus >= 0 && !A.alive[ai.sus]) ai.sus = -1;
    const done = A.done[s.i].size >= NTASK;
    // tasks done, bodies found, but no idea who did it? Sometimes take a guess (maybe a wrong one!)
    if (done && ai.sus < 0 && ai.seen.size && t > (ai.guessT || 0)) {
      ai.guessT = t + 15;
      const others = G.slots.filter((o) => o.i !== s.i && A.alive[o.i]);
      if (others.length && Math.random() < 0.35) { ai.sus = pick(others).i; ai.susT = t - 6; }
    }
    // the murderer is close: run!
    if (ai.known && mAlive && sees(s, M, 7) && !(done && TR.inMeeting(s.x, s.z, s.f))) {
      if (ai.mode !== 'flee' || t > ai.until || !ai.path.length) {
        ai.mode = 'flee'; ai.until = t + 3; ai.doing = 0;
        // a hiding place close by? jump in!
        const spot = TR.HIDES.filter((h) => h.f === s.f && spotFree(h.id) && Math.hypot(h.ex - s.x, h.ez - s.z) < 7 && Math.hypot(h.ex - M.x, h.ez - M.z) > Math.hypot(h.ex - s.x, h.ez - s.z))[0];
        if (spot && Math.random() < 0.6) { ai.mode = 'hide'; ai.spot = spot.id; goTo(s, spot.ex, spot.ez, spot.f); return; }
        // run somewhere far from the murderer (and away from them, not past them)
        const away = (n) => n.f !== M.f ? 30 : Math.hypot(n.x - M.x, n.z - M.z) - Math.hypot(n.x - s.x, n.z - s.z);
        const far = TR.SPAWNS.filter((n) => away(n) > 8);
        const n = pick(far.length ? far : TR.SPAWNS);
        goTo(s, n.x, n.z, n.f);
      }
      return;
    }
    // tasks done and someone looks guilty: go to the meeting room and accuse them
    if (done && ai.sus >= 0 && (ai.known || t - ai.susT > 6)) {
      ai.mode = 'accuse';
      if (TR.inMeeting(s.x, s.z, s.f)) { handleReq({ t: 'acc', by: s.i, v: ai.sus }); ai.sus = -1; ai.path = []; return; }
      if (!ai.path.length) goTo(s, TR.MEETING.sx, TR.MEETING.sz, TR.MEETING.f);
      return;
    }
    if (!done) {
      if (ai.doing) {
        if (t >= ai.doing) { handleReq({ t: 'task', by: s.i, id: ai.task }); ai.doing = 0; ai.task = -1; }
        return;
      }
      if (ai.task < 0 || A.done[s.i].has(ai.task) || ai.mode !== 'task') {
        const left = s.tasks.filter((id) => !A.done[s.i].has(id)).map((id) => TR.TASKS[id]);
        const far = (p) => Math.abs(p.sx - s.x) + Math.abs(p.sz - s.z) + (p.f !== s.f ? 20 : 0);
        left.sort((p, q) => far(p) - far(q));
        ai.task = left[0].id; ai.mode = 'task';
        goTo(s, left[0].sx, left[0].sz, left[0].f);
      }
      const tk = TR.TASKS[ai.task];
      if (s.f === tk.f && Math.hypot(s.x - tk.sx, s.z - tk.sz) < 0.35) { ai.doing = t + TASK_TIME + rand(0, 1.5); ai.path = []; s.a = faceTo(s, tk.ox, tk.oz); }
      else if (!ai.path.length) goTo(s, tk.sx, tk.sz, tk.f);
      return;
    }
    if (ai.mode !== 'wander') { ai.mode = 'wander'; ai.path = []; }
    wander(s, t);
  }

  function thinkMurderer(s, t) {
    const ai = s.ai;
    if (ai.hideAt && t > ai.hideAt) { s.w = 0; ai.hideAt = 0; }
    const others = (a, b) => G.slots.filter((o) => o.i !== a && o.i !== b && A.alive[o.i]);
    const witnesses = (v) => others(s.i, v).filter((o) => sees(o, s, 16)).length;
    if (t < ai.cool) {
      if (!ai.hideAt) s.w = 0;
      // pretend to do tasks
      if (ai.doing) { if (t > ai.doing) ai.doing = 0; return; }
      if (ai.mode !== 'fake' || !ai.path.length) {
        if (ai.mode === 'fake' && ai.task >= 0) { const tk = TR.TASKS[ai.task]; if (s.f === tk.f && Math.hypot(s.x - tk.sx, s.z - tk.sz) < 0.5) { ai.doing = t + rand(2, 4); s.a = faceTo(s, tk.ox, tk.oz); ai.task = -1; return; } }
        ai.mode = 'fake'; ai.task = pick(s.tasks);
        const tk = TR.TASKS[ai.task]; goTo(s, tk.sx, tk.sz, tk.f);
      }
      return;
    }
    const tracker = A.kills >= 4;
    ai.lastSeen = ai.lastSeen || {};
    for (const o of others(s.i, -1)) if (sees(s, o, 16)) ai.lastSeen[o.i] = t;
    // the target jumped into a hiding place right in front of us? we know where they are
    if (ai.target >= 0 && A.alive[ai.target] && G.slots[ai.target].hide >= 0) {
      if (ai.spot == null) ai.spot = t - (ai.lastSeen[ai.target] || -99) < 1.5 ? G.slots[ai.target].hide : -1;
      if (ai.spot < 0 || G.slots[ai.target].hide !== ai.spot) { ai.target = -1; ai.spot = null; }
    } else ai.spot = null;
    if (ai.target < 0 || !A.alive[ai.target] || t > ai.targetT) {
      let best = -1, score = 1e9;
      for (const o of others(s.i, -1)) {
        const d = dist(s, o);
        if (o.hide >= 0) continue; // can't find people who are hiding
        if (!tracker && (d > 9 || o.f !== s.f) && !sees(s, o, 16)) continue;
        const sc = d + others(s.i, o.i).filter((q) => sees(q, o, 14)).length * 15;
        if (sc < score) { score = sc; best = o.i; }
      }
      ai.target = best; ai.targetT = t + 20;
    }
    if (ai.target < 0) { if (!ai.hideAt) s.w = 0; ai.mode = 'wander'; wander(s, t); return; }
    if (ai.mode !== 'hunt') ai.huntT = t;
    ai.mode = 'hunt';
    const v = G.slots[ai.target], d = dist(s, v), see = TR.see(s, v);
    // hunting for a long time with no luck? take the risk, even if someone might see
    const wit = t - ai.huntT > 30 ? 0 : witnesses(ai.target);
    if (ai.spot != null && ai.spot >= 0) { // go stab the hiding place
      const h = TR.HIDES[ai.spot];
      if (s.f === h.f && Math.hypot(s.x - h.x, s.z - h.z) < 1.5 && wit === 0) {
        ai.path = []; s.a = faceTo(s, h.x, h.z);
        if (s.w !== 1) { s.w = 1; ai.drawT = t; ai.hideAt = 0; }
        else if (t - ai.drawT > 0.35) { handleReq({ t: 'kill', by: s.i, v: ai.target, w: 1 }); ai.cool = t + rand(10, 18); ai.hideAt = t + 0.9; ai.target = -1; ai.spot = null; }
        return;
      }
      if (t > ai.repath || !ai.path.length) { goTo(s, h.ex, h.ez, h.f); ai.repath = t + 0.7; }
      return;
    }
    const want = A.kills >= 2 && d > 2.2 ? 2 : 1;
    const range = want === 2 ? 9 : 2.0;
    if (wit === 0 && see && d < range) {
      ai.path = []; s.a = faceTo(s, v.x, v.z);
      if (s.w !== want) { s.w = want; ai.drawT = t; ai.hideAt = 0; }
      else if (t - ai.drawT > 0.2) {
        handleReq({ t: 'kill', by: s.i, v: ai.target, w: want });
        ai.cool = t + rand(10, 18); ai.hideAt = t + 0.9; ai.target = -1; ai.mode = '';
      }
      return;
    }
    if (wit > 0 && !ai.hideAt) s.w = 0;
    if (t > ai.repath || !ai.path.length) { goTo(s, v.x, v.z, v.f); ai.repath = t + 0.7; }
  }

  // =====================================================================
  // Controls
  // =====================================================================
  const keys = {};
  let pitch = 0, stick = { x: 0, y: 0 }, touchTask = false;
  function tryLock() { if (!isTouch && G && !G.over && $('pick').hidden) canvas.requestPointerLock && canvas.requestPointerLock(); }
  canvas.addEventListener('click', () => { audio(); if (!document.pointerLockElement) tryLock(); });
  document.addEventListener('mousemove', (e) => {
    if (!G || document.pointerLockElement !== canvas) return;
    look(e.movementX * 0.0024, e.movementY * 0.0024);
  });
  document.addEventListener('mousedown', (e) => {
    if (!G || e.target !== canvas || e.button !== 0) return;
    if (G.me === G.m) attack();
    else if (G.slots[G.me].hide >= 0 || nearSpot()) toggleHide(); // innocents: click a wardrobe to hide in it
  });
  function look(dx, dy) {
    const s = G.slots[G.me];
    s.a -= dx;
    pitch = Math.max(-1.3, Math.min(1.3, pitch - dy));
  }
  document.addEventListener('keydown', (e) => {
    if (!G) return;
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (e.code === 'KeyQ') cycleWeapon();
    if (e.code === 'KeyF') openAccuse();
    if (e.code === 'KeyH') toggleHide();
    if (e.code === 'Escape') $('pick').hidden = true;
  });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // phone controls
  (function touchControls() {
    const st = $('stick'), knob = $('knob');
    let sid = null, cx = 0, cy = 0;
    st.addEventListener('pointerdown', (e) => { sid = e.pointerId; const r = st.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; st.setPointerCapture(sid); moveStick(e); });
    st.addEventListener('pointermove', (e) => { if (e.pointerId === sid) moveStick(e); });
    const endStick = (e) => { if (e.pointerId !== sid) return; sid = null; stick = { x: 0, y: 0 }; knob.style.transform = ''; };
    st.addEventListener('pointerup', endStick); st.addEventListener('pointercancel', endStick);
    function moveStick(e) {
      let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy), max = 50;
      if (d > max) { dx *= max / d; dy *= max / d; }
      stick = { x: dx / max, y: dy / max }; knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    const lk = $('look'); let lid = null, lx = 0, ly = 0;
    lk.addEventListener('pointerdown', (e) => { audio(); lid = e.pointerId; lx = e.clientX; ly = e.clientY; lk.setPointerCapture(lid); });
    lk.addEventListener('pointermove', (e) => { if (e.pointerId !== lid || !G) return; look((e.clientX - lx) * 0.006, (e.clientY - ly) * 0.006); lx = e.clientX; ly = e.clientY; });
    lk.addEventListener('pointerup', () => { lid = null; }); lk.addEventListener('pointercancel', () => { lid = null; });
    const tb = $('t-task');
    tb.addEventListener('pointerdown', () => { touchTask = true; });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) tb.addEventListener(ev, () => { touchTask = false; });
    $('t-acc').addEventListener('click', openAccuse);
    $('t-weap').addEventListener('click', cycleWeapon);
    $('t-hit').addEventListener('click', attack);
    $('t-hide').addEventListener('click', toggleHide);
  })();

  function cycleWeapon() {
    if (!G || G.me !== G.m || G.over) return;
    const s = G.slots[G.me];
    if (!s.alive) return;
    if (now() - G.t0 < GRACE) { msg(`Your weapon is ready in ${Math.ceil(GRACE - (now() - G.t0))} seconds.`); return; }
    s.w = s.w === 0 ? 1 : s.w === 1 && s.kills >= 2 ? 2 : 0;
    if (s.w) G.lastW = s.w;
    G.hideAt = 0;
    SFX.swish();
  }
  // who is in front of me?
  function aimAt(range, maxAng, needSight = true) {
    const s = G.slots[G.me];
    let best = -1, bd = 1e9;
    for (const o of G.slots) {
      if (o.i === G.me || !o.alive || o.hide >= 0) continue;
      const d = dist(s, o);
      if (d > range) continue;
      const diff = angDiff(faceTo(s, o.x, o.z), s.a);
      if (diff > Math.max(maxAng, Math.atan(0.35 / Math.max(d, 0.1)))) continue;
      if (o.f !== s.f || (needSight && !TR.see(s, o))) continue;
      if (diff * d < bd) { bd = diff * d; best = o.i; }
    }
    return best;
  }
  function attack() {
    if (!G || G.over || G.me !== G.m) return;
    const s = G.slots[G.me];
    if (!s.alive || now() < G.cool || s.hide >= 0) return;
    if (!s.w) { // clicking takes your weapon out and attacks straight away
      if (now() - G.t0 < GRACE) { msg(`Your weapon is ready in ${Math.ceil(GRACE - (now() - G.t0))} seconds.`); return; }
      s.w = G.lastW || 1;
    }
    G.hideAt = now() + 1; // the weapon goes away again by itself
    G.cool = now() + (s.w === 2 ? 1.0 : 0.5);
    G.swing = now();
    if (s.w === 1) {
      SFX.swish();
      let v = aimAt(DAGGER + 0.3, 0.5);
      if (v < 0) { // stab a hiding place: whoever is inside gets it
        const h = spotInFront();
        if (h) v = G.slots.findIndex((o) => o.alive && o.hide === h.id);
      }
      if (v >= 0) request({ t: 'kill', by: G.me, v, w: 1 });
    } else {
      const v = aimAt(SHOTGUN, 0.12);
      request({ t: 'kill', by: G.me, v, w: 2 });
    }
  }
  // the hiding place I'm standing at and looking at
  function spotInFront() {
    const s = G.slots[G.me];
    for (const h of TR.HIDES) {
      if (h.f !== s.f) continue;
      const d = Math.hypot(s.x - h.x, s.z - h.z);
      if (d < 1.6 && angDiff(faceTo(s, h.x, h.z), s.a) < 0.9) return h;
    }
    return null;
  }
  function nearSpot() {
    const s = G.slots[G.me];
    for (const h of TR.HIDES) if (h.f === s.f && (Math.hypot(s.x - h.ex, s.z - h.ez) < 0.9 || Math.hypot(s.x - h.x, s.z - h.z) < 1.1)) return h;
    return null;
  }
  function toggleHide() {
    if (!G || G.over) return;
    const s = G.slots[G.me];
    if (!s.alive) return;
    if (s.hide >= 0) { s.hide = -1; $('hiding').hidden = true; SFX.swish(); return; }
    const h = nearSpot();
    if (!h) { msg('Find a wardrobe or a locker to hide in!'); return; }
    if (G.slots.some((o) => o.alive && o.hide === h.id)) { msg('Someone is already hiding in there!'); return; }
    s.x = h.ex; s.z = h.ez; s.hide = h.id; s.w = 0; G.hold = 0;
    s.a = faceTo(h, h.ex, h.ez); // look out of the door
    $('hiding').innerHTML = `🙈 You're hiding in the ${h.kind}. Nobody can see you!<br><small>${isTouch ? '🚪' : 'Click or H'} to come out</small>`;
    $('hiding').hidden = false;
    SFX.swish();
  }
  function openAccuse() {
    if (!G || G.over || G.me === G.m) return;
    const s = G.slots[G.me];
    if (!s.alive || s.hide >= 0) return;
    if (G.myDone.size < NTASK) { msg(`Finish all your tasks first! (${G.myDone.size}/${NTASK})`); return; }
    if (!TR.inMeeting(s.x, s.z, s.f)) { msg(`Go to <b>${TR.MEETING_NAME}</b> to accuse someone.`); return; }
    if (document.pointerLockElement) document.exitPointerLock();
    const box = $('pick-btns'); box.innerHTML = '';
    for (const o of G.slots) {
      if (o.i === G.me || !o.alive) continue;
      const b = document.createElement('button');
      b.innerHTML = `<span class="dot" style="background:${COLORS[o.c].h}"></span>${COLORS[o.c].n}`;
      b.onclick = () => { $('pick').hidden = true; request({ t: 'acc', by: G.me, v: o.i }); tryLock(); };
      box.appendChild(b);
    }
    $('pick').hidden = false;
  }
  $('pick-cancel').onclick = () => { $('pick').hidden = true; tryLock(); };

  // =====================================================================
  // Every frame
  // =====================================================================
  let last = now(), lastTaskHtml = '';
  function frame() {
    requestAnimationFrame(frame);
    const t = now(), dt = Math.min(0.05, t - last);
    last = t;
    landTex.offset.x -= dt * 14 / LAND_W;
    if (!G) { renderer.render(scene, camera); return; }
    updateMe(dt, t);
    for (const s of G.slots) {
      if (s.i === G.me) continue;
      if (s.ai) { if (A.alive[s.i] && !G.over) updateBot(s, dt, t); }
      else if (s.alive) { // someone online: glide toward where they really are
        const k = Math.min(1, dt * 10);
        s.x += (s.tx - s.x) * k; s.z += (s.tz - s.z) * k;
        let da = s.ta - s.a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; s.a += da * k;
      }
    }
    if (G.online) netSend(t);
    drawPeople(t);
    hud(t);
    renderer.render(scene, camera);
  }

  function updateMe(dt, t) {
    const s = G.slots[G.me];
    let f = 0, r = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= stick.y; r += stick.x;
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    const sp = (s.alive ? SPEED : GHOST_SPEED) * dt;
    const dx = (-Math.sin(s.a) * f + Math.cos(s.a) * r) * sp, dz = (-Math.cos(s.a) * f - Math.sin(s.a) * r) * sp;
    if (s.alive && !G.over && s.hide < 0) TR.move(s, dx, dz);
    else if (!s.alive) { // ghosts float through walls
      const B = TR.BOUNDS;
      s.x = Math.max(B.x0 + 0.1, Math.min(B.x1 - 0.1, s.x + dx));
      s.z = Math.max(B.z0 + 0.1, Math.min(B.z1 - 0.1, s.z + dz));
      TR.updateFloor(s);
    }
    const moving = len > 0.1 && s.alive;
    G.bob = (G.bob || 0) + (moving ? dt * 9 : 0);
    const sway = Math.sin(t * 1.7) * 0.004;
    camera.position.set(s.x, TR.yAt(s.x, s.z, s.f) + (s.alive ? EYE : 1.9) + Math.sin(G.bob) * 0.04, s.z);
    if (s.hide >= 0) { const h = TR.HIDES[s.hide]; camera.position.set(h.x + (h.ex - h.x) * 0.55, h.f * TR.FH + EYE, h.z + (h.ez - h.z) * 0.55); }
    camera.rotation.set(pitch, s.a, sway);

    // tasks
    G.near = -1;
    if (s.alive && !G.over && s.hide < 0) {
      for (const id of s.tasks) {
        if (G.myDone.has(id)) continue;
        const tk = TR.TASKS[id];
        if (tk.f === s.f && Math.hypot(s.x - tk.ox, s.z - tk.oz) < REACH || Math.hypot(s.x - tk.sx, s.z - tk.sz) < 0.6) { G.near = id; break; }
      }
    }
    if (G.near >= 0 && (keys.KeyE || touchTask)) {
      G.hold += dt;
      if (G.hold >= TASK_TIME) {
        G.myDone.add(G.near); G.hold = 0; SFX.ding();
        request({ t: 'task', by: G.me, id: G.near });
        const m = markers.find((m) => m.id === G.near); if (m) { scene.remove(m.ring, m.gem); }
        if (G.me !== G.m && G.myDone.size === NTASK) { msg(`✅ All tasks done! Go to <b>${TR.MEETING_NAME}</b> to accuse someone.`); SFX.yay(); }
      }
    } else G.hold = 0;

    // bodies I find
    if (s.alive) {
      for (const b of G.bodies) {
        if (G.seenBodies.has(b.slot) || b.slot === G.me) continue;
        if (Math.hypot(s.x - b.x, s.z - b.z) < 9 && TR.see(s, b)) {
          G.seenBodies.add(b.slot);
          if (G.slots[b.slot] && G.me !== G.m) { msg(`😱 You found ${tag(b.slot)}'s body in ${TR.placeName(b.x, b.z, b.f)}!`); SFX.gasp(); }
        }
      }
    }

    // my weapon in my hand (it goes away by itself a moment after attacking)
    if (G.hideAt && t > G.hideAt) { s.w = 0; G.hideAt = 0; }
    const swing = Math.max(0, 1 - (t - G.swing) * 5);
    for (let w = 1; w <= 2; w++) viewWeapons[w].visible = s.alive && s.w === w;
    viewWeapons[1].position.z = -0.5 - swing * 0.3;
    viewWeapons[2].rotation.x = swing * 0.3;
  }

  function drawPeople(t) {
    for (const s of G.slots) {
      const m = s.mesh;
      if (s.out) { m.visible = false; continue; }
      if (!s.alive) continue; // bodies stay where they fell
      m.visible = s.i !== G.me && !(s.hide >= 0);
      m.position.set(s.x, TR.yAt(s.x, s.z, s.f), s.z);
      m.rotation.y = s.a;
      const mv = Math.hypot(s.x - (s.px ?? s.x), s.z - (s.pz ?? s.z)) > 0.004;
      s.px = s.x; s.pz = s.z;
      m.userData.body.position.y = mv ? Math.abs(Math.sin(t * 9 + s.i)) * 0.05 : 0;
      m.userData.weapons[1].visible = s.w === 1;
      m.userData.weapons[2].visible = s.w === 2;
    }
    for (const mk of markers) {
      mk.gem.rotation.y = t * 2;
      const tk = TR.TASKS[mk.id];
      mk.gem.position.y = tk.f * TR.FH + Math.min(tk.oy + 0.6, 2.5) + Math.sin(t * 3) * 0.06;
      mk.ring.material.opacity = 0.5 + Math.sin(t * 4) * 0.3;
    }
  }

  // =====================================================================
  // HUD
  // =====================================================================
  function msg(html) {
    const d = document.createElement('div'); d.innerHTML = html;
    const box = $('msgs'); box.appendChild(d);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  }
  let bigUntil = 0;
  function big(title, small, sec) {
    $('big').innerHTML = `${title}<small>${small}</small>`;
    bigUntil = now() + sec;
  }
  function flash() { const f = $('flash'); f.style.opacity = 1; setTimeout(() => { f.style.opacity = 0; }, 300); }

  function hud(t) {
    const s = G.slots[G.me];
    if (t > bigUntil) $('big').innerHTML = '';
    $('click').hidden = isTouch || !!document.pointerLockElement || G.over || !$('pick').hidden;
    $('where').textContent = '📍 ' + TR.placeName(s.x, s.z, s.f);
    // role box
    let role;
    if (G.me === G.m) {
      const wait = GRACE - (t - G.t0);
      role = `<b>🔪 Murderer</b><br>Kills: ${s.kills}<br>` +
        (wait > 0 ? `Weapon ready in ${Math.ceil(wait)}...` : `In hand: ${['nothing (click to attack)', '🔪 Dagger', '🔫 Shotgun'][s.w]}`) +
        `<br><small>${s.kills < 2 ? `🔫 Shotgun after ${2 - s.kills} more` : s.kills < 4 ? `📡 Tracker after ${4 - s.kills} more` : '📡 Tracker on!'}</small>`;
    } else role = `<b>🙂 Innocent</b><br>Tasks: ${G.myDone.size}/${NTASK}<br><small>${G.myDone.size < NTASK ? `Then go to ${TR.MEETING_SHORT} to accuse` : `Go to ${TR.MEETING_SHORT} and press F to accuse!`}</small>`;
    if (!s.alive) role = s.out ? `<b>🚪 Out</b><br>You're ${TR.name === 'train' ? 'off the train' : 'out'}. Watch the rest!` : '<b>👻 Ghost</b><br>You were killed. Watch the rest!';
    if ($('role').innerHTML !== role) $('role').innerHTML = role;
    // task list
    const th = `<h3>${G.me === G.m ? 'Fake tasks (to look innocent)' : 'Your tasks'}</h3><ul>` +
      s.tasks.map((id) => { const tk = TR.TASKS[id]; return `<li class="${G.myDone.has(id) ? 'done' : ''}">${G.myDone.has(id) ? '✅' : '⬜'} ${tk.name}: <b>${tk.where}</b></li>`; }).join('') + '</ul>';
    if (th !== lastTaskHtml) { $('tasks').innerHTML = th; lastTaskHtml = th; }
    // prompt and progress bar
    let p = '';
    if (s.alive && !G.over) {
      if (s.hide < 0 && nearSpot()) p = `${isTouch ? '🚪' : G.me === G.m ? 'H' : 'Click'}: hide in the ${nearSpot().kind}`;
      if (G.near >= 0) p = `${isTouch ? 'Hold ✋' : 'Hold E'}: ${TR.TASKS[G.near].name}`;
      if (s.hide >= 0) p = '';
      if (G.me === G.m && s.w) {
        const v = s.w === 1 ? aimAt(DAGGER + 0.3, 0.5) : aimAt(SHOTGUN, 0.12);
        if (v >= 0) p = `${isTouch ? '💥' : 'Click'}: attack ${COLORS[G.slots[v].c].n}`;
        else if (s.w === 1 && spotInFront()) p = `${isTouch ? '💥' : 'Click'}: stab the ${spotInFront().kind}`;
      } else if (G.me === G.m && s.hide < 0 && spotInFront() && !(G.near >= 0)) {
        p = `${isTouch ? '💥' : 'Click'}: stab the ${spotInFront().kind}` + (nearSpot() ? ` · ${isTouch ? '🚪' : 'H'}: hide` : '');
      }
      if (G.me !== G.m && TR.inMeeting(s.x, s.z, s.f)) p = G.myDone.size >= NTASK ? `${isTouch ? '☝ Accuse' : 'Press F'} to accuse someone!` : `Finish your tasks to accuse (${G.myDone.size}/${NTASK})`;
    }
    $('prompt').hidden = !p; if (p) $('prompt').textContent = p;
    $('bar').hidden = !(G.hold > 0);
    $('bar').firstElementChild.style.width = (G.hold / TASK_TIME * 100) + '%';
    drawMap(t);
  }

  function drawMap(t) {
    const c = $('map'), W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W * 2) { c.width = W * 2; c.height = H * 2; }
    const g = c.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, W, H);
    // one panel per floor, side by side
    const B = TR.BOUNDS, nf = TR.floors, pad = 6, top = 10, hh = H - 16;
    const pw = (W - pad * (nf + 1)) / nf;
    const X = (x, f = 0) => pad + f * (pw + pad) + (x - B.x0) / (B.x1 - B.x0) * pw;
    const Z = (z) => top + (z - B.z0) / (B.z1 - B.z0) * hh;
    const SX = pw / (B.x1 - B.x0), SZ = hh / (B.z1 - B.z0);
    g.font = '600 9px Fredoka, sans-serif'; g.textAlign = 'center';
    const mr = TR.MEETING;
    for (const r of TR.MAP) {
      g.fillStyle = r.color;
      g.fillRect(X(r.x0, r.f), Z(r.z0), (r.x1 - r.x0) * SX, (r.z1 - r.z0) * SZ);
      if (nf === 1) { g.fillStyle = '#ffffffaa'; g.fillText(r.label, X((r.x0 + r.x1) / 2, r.f), 8); }
    }
    g.fillStyle = '#c0304088'; g.fillRect(X(mr.x0, mr.f), Z(mr.z0), (mr.x1 - mr.x0) * SX, (mr.z1 - mr.z0) * SZ);
    if (nf > 1) {
      for (const r of TR.MAP) if (r.label) { g.fillStyle = '#ffffffcc'; g.fillText(r.z0 > B.z0 ? r.label : '', X((r.x0 + r.x1) / 2, r.f), Z((r.z0 + r.z1) / 2) + 3); }
      for (let f = 0; f < nf; f++) { g.fillStyle = '#ffd86b'; g.fillText(f ? '⬆ Upstairs' : 'Downstairs', X((B.x0 + B.x1) / 2, f), 8); }
    }
    const s = G.slots[G.me];
    for (const id of s.tasks) {
      if (G.myDone.has(id)) continue;
      const tk = TR.TASKS[id]; g.fillStyle = '#ffd23d'; g.fillRect(X(tk.sx, tk.f) - 2.5, Z(tk.sz) - 2.5, 5, 5);
    }
    const all = !s.alive || (G.me === G.m && s.kills >= 4);
    for (const o of G.slots) {
      if (o.out || o.i === G.me || (o.alive && o.hide >= 0)) continue;
      if (!o.alive && (G.seenBodies.has(o.i) || all)) { g.fillStyle = '#fff'; g.fillText('✖', X(o.x, o.f), Z(o.z) + 3); continue; }
      if (!o.alive || !all) continue;
      g.fillStyle = COLORS[o.c].h; g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath(); g.arc(X(o.x, o.f), Z(o.z), 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = COLORS[s.c].h; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(X(s.x, s.f), Z(s.z), 4.2 + Math.sin(t * 6) * 0.6, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  // =====================================================================
  // Online
  // =====================================================================
  // Rooms live at murdermight/rooms/<CODE>. Only game things are sent: colours, positions, task ticks,
  // kills and accusations. No names or chat. The host is the referee and runs the bots.
  const VERSION = 2;
  const ROOMS = 'murdermight/rooms';
  const NO_SERVER = "Can't reach the game server. Check the internet connection.";
  const db = window.firebase ? (firebase.initializeApp({
    apiKey: 'AIzaSyAsJboNGVuESMhkivllUD0o8MUB5LUCMRQ',
    authDomain: 'kvgames.firebaseapp.com',
    databaseURL: 'https://kvgames-default-rtdb.firebaseio.com',
    projectId: 'kvgames',
    storageBucket: 'kvgames.firebasestorage.app',
    messagingSenderId: '463308384695',
    appId: '1:463308384695:web:5d57623ebd52101ad26032',
  }), firebase.database()) : null;
  const myId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function genCode() {
    const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
    return s;
  }
  function menuError(t) { $('menu-error').textContent = t; }
  function busy(on) { for (const b of document.querySelectorAll('#menu button')) b.disabled = on; }

  async function createRoom() {
    menuError('');
    if (!db) return menuError(NO_SERVER);
    busy(true);
    try {
      for (let i = 0; i < 6; i++) {
        const code = genCode(), ref = db.ref(`${ROOMS}/${code}`);
        const res = await ref.transaction((cur) => (cur ? undefined : {
          host: myId, v: VERSION, created: firebase.database.ServerValue.TIMESTAMP, phase: 'lobby', fill: 8, map: $('mapsel').value, players: { [myId]: { c: myColor } },
        }));
        if (res.committed) { ref.onDisconnect().remove(); enterRoom(code, ref, true); return; }
      }
      menuError('Could not make a room. Try again.');
    } catch (e) { console.error(e); menuError(NO_SERVER); } finally { busy(false); }
  }
  async function joinRoom() {
    menuError('');
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length !== 4) return menuError('Type the 4-letter room code.');
    if (!db) return menuError(NO_SERVER);
    busy(true);
    try {
      const ref = db.ref(`${ROOMS}/${code}`);
      const r = (await ref.once('value')).val();
      if (!r) return menuError('No room with that code.');
      if (r.v !== VERSION) return menuError('That room has a different version of the game. Refresh the page (Ctrl+F5).');
      if (r.phase !== 'lobby') return menuError('That game already started.');
      const used = Object.values(r.players || {}).map((p) => p.c);
      if (used.length >= MAXP) return menuError('That room is full.');
      const c = used.includes(myColor) ? COLORS.findIndex((_, i) => !used.includes(i)) : myColor;
      await ref.child('players/' + myId).set({ c });
      ref.child('players/' + myId).onDisconnect().remove();
      enterRoom(code, ref, false);
    } catch (e) { console.error(e); menuError(NO_SERVER); } finally { busy(false); }
  }

  function enterRoom(code, ref, isHost) {
    room = { code, ref, isHost, players: {}, fill: 8, map: 'train', gameId: null, offs: [] };
    const on = (r, evt, fn) => { r.on(evt, fn); room.offs.push(() => r.off(evt, fn)); };
    $('code').textContent = code;
    showScreen('lobby');
    on(ref.child('host'), 'value', (snap) => { if (!snap.val() && room && room.ref === ref) closeRoom('The room closed. The host left.'); });
    on(ref.child('players'), 'value', (snap) => {
      room.players = snap.val() || {};
      if (G && G.online && G.host) { // someone left mid-game: a bot takes over their spot
        for (const s of G.slots) if (s.o && s.o !== myId && !room.players[s.o]) { s.o = ''; s.ai = newAI(s); s.ai.cool = now() + 5; }
      }
      drawLobby();
    });
    on(ref.child('fill'), 'value', (snap) => { room.fill = snap.val() || 8; drawLobby(); });
    on(ref.child('map'), 'value', (snap) => { room.map = MAPS[snap.val()] ? snap.val() : 'train'; drawLobby(); });
    on(ref.child('phase'), 'value', (snap) => {
      if (snap.val() === 'lobby' && G) { stopGame(); showScreen('lobby'); drawLobby(); }
    });
    on(ref.child('game'), 'value', (snap) => {
      const def = snap.val();
      if (!def || def.id === room.gameId) return;
      room.gameId = def.id;
      if (!def.slots.some((s) => s.o === myId)) return;
      startGame(def, true);
    });
  }
  function leaveRoom() {
    if (!room) return;
    const r = room; room = null;
    for (const off of r.offs) off();
    if (r.isHost) { r.ref.onDisconnect().cancel(); r.ref.remove(); }
    else { r.ref.child('players/' + myId).onDisconnect().cancel(); r.ref.child('players/' + myId).remove(); }
  }
  function closeRoom(text) {
    leaveRoom(); stopGame(); showScreen('menu'); menuError(text);
  }
  function drawLobby() {
    if (!room) return;
    const ids = Object.keys(room.players);
    $('lobby-players').innerHTML = ids.map((id) => {
      const c = COLORS[room.players[id].c] || COLORS[0];
      return `<span><span class="dot" style="background:${c.h}"></span>${c.n}${id === myId ? ' (you)' : ''}</span>`;
    }).join('');
    const used = ids.filter((id) => id !== myId).map((id) => room.players[id].c);
    const mine = room.players[myId] ? room.players[myId].c : -1;
    swatches($('lobby-colors'), mine, used, (i) => room.ref.child('players/' + myId + '/c').set(i));
    const sel = $('lobby-fill'), min = Math.max(3, ids.length);
    const want = Math.max(min, room.fill);
    const opts = []; for (let n = min; n <= MAXP; n++) opts.push(`<option ${n === want ? 'selected' : ''}>${n}</option>`);
    sel.innerHTML = opts.join(''); sel.disabled = !room.isHost;
    $('lobby-map').value = room.map; $('lobby-map').disabled = !room.isHost;
    $('lobby-start').hidden = !room.isHost;
    $('lobby-msg').textContent = room.isHost ? `${ids.length} player${ids.length > 1 ? 's' : ''} here. Tell friends the code, then press GO!` : 'Waiting for the host to press GO...';
  }
  $('lobby-fill').onchange = () => { if (room && room.isHost) room.ref.child('fill').set(+$('lobby-fill').value); };
  $('lobby-map').onchange = () => { if (room && room.isHost) room.ref.child('map').set($('lobby-map').value); };
  $('lobby-start').onclick = () => {
    if (!room || !room.isHost) return;
    const ids = Object.keys(room.players);
    const humans = ids.map((id) => ({ c: room.players[id].c, o: id }));
    // two people can't share a colour
    const seen = new Set();
    for (const h of humans) { if (seen.has(h.c)) h.c = COLORS.findIndex((_, i) => !seen.has(i) && !humans.some((q) => q.c === i)); seen.add(h.c); }
    const total = Math.max(3, humans.length, room.fill);
    const def = makeDef(room.map, humans, total, 0);
    def.m = Math.floor(Math.random() * def.slots.length);
    room.ref.update({ phase: 'play', ev: null, req: null, pos: null, game: def });
  };
  $('lobby-leave').onclick = () => { leaveRoom(); showScreen('menu'); };

  function netStart() {
    const ref = room.ref;
    const on = (r, evt, fn) => { r.on(evt, fn); G.offs.push(() => r.off(evt, fn)); };
    on(ref.child('ev'), 'child_added', (snap) => applyEv(snap.val()));
    const posFn = (snap) => {
      if (!G) return;
      const s = G.slots[+snap.key], p = snap.val();
      if (!s || s.i === G.me || s.ai || !p) return;
      s.tx = p.x; s.tz = p.z; s.ta = p.a; s.w = p.w || 0; s.hide = p.h == null ? -1 : p.h; s.f = p.f || 0;
      if (s.hide >= 0) { s.x = s.tx; s.z = s.tz; }
    };
    on(ref.child('pos'), 'child_added', posFn);
    on(ref.child('pos'), 'child_changed', posFn);
    if (G.host) {
      on(ref.child('req'), 'child_added', (snap) => { handleReq(snap.val()); snap.ref.remove(); });
    }
  }
  function netSend(t) {
    if (t - G.lastSend < 0.1) return;
    G.lastSend = t;
    const up = {};
    const put = (s) => { up[s.i] = { x: +s.x.toFixed(2), z: +s.z.toFixed(2), a: +s.a.toFixed(2), w: s.w, h: s.hide, f: s.f }; };
    put(G.slots[G.me]);
    if (G.host) for (const s of G.slots) if (s.ai) put(s);
    room.ref.child('pos').update(up);
  }

  // =====================================================================
  // Menus
  // =====================================================================
  let myColor = 0, who = 'r';
  try { const c = +localStorage.getItem('mm-color'); if (c >= 0 && c < COLORS.length) myColor = c; } catch (e) { /* no storage */ }
  function swatches(box, sel, taken, onPick) {
    box.innerHTML = '';
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.style.background = c.h; b.title = c.n; b.setAttribute('aria-label', c.n);
      b.setAttribute('aria-pressed', String(i === sel));
      if (taken.includes(i)) b.className = 'taken';
      b.onclick = () => { if (!taken.includes(i)) onPick(i); };
      box.appendChild(b);
    });
  }
  function drawSolo() {
    swatches($('solo-colors'), myColor, [], (i) => { myColor = i; try { localStorage.setItem('mm-color', i); } catch (e) { /* */ } drawSolo(); });
  }
  drawSolo();
  for (const b of $('who').children) b.onclick = () => { who = b.dataset.v; for (const x of $('who').children) x.setAttribute('aria-pressed', String(x === b)); };
  function soloGame() {
    const n = +$('count').value;
    const def = makeDef($('mapsel').value, [{ c: myColor, o: 'me' }], n, 0);
    def.m = who === 'm' ? 0 : who === 'i' ? 1 + Math.floor(Math.random() * (n - 1)) : Math.floor(Math.random() * n);
    startGame(def, false);
  }
  $('solo').onclick = soloGame;
  $('create').onclick = createRoom;
  $('join').onclick = joinRoom;
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  function showScreen(id) {
    $('menu').hidden = id !== 'menu';
    $('lobby').hidden = id !== 'lobby';
    $('over').hidden = true;
  }
  $('again').onclick = () => {
    if (!G) return;
    if (G.online) { if (G.host) room.ref.update({ phase: 'lobby', game: null, ev: null, req: null, pos: null }); }
    else soloGame();
  };
  function toMenu() {
    if (room) leaveRoom();
    stopGame(); showScreen('menu');
  }
  $('over-menu').onclick = toMenu;
  $('quit').onclick = toMenu;

  // camera for the menu background
  // build both maps, each in its own group; only the one being played is shown
  const mapGroups = {};
  for (const name of Object.keys(MAPS)) {
    build = mapGroups[name] = new THREE.Group(); scene.add(build);
    if (name === 'train') drawTrain(MAPS[name]); else drawMansion(MAPS[name]);
  }
  build = scene;
  function showMap(name) { for (const k in mapGroups) mapGroups[k].visible = k === name; $('hud').classList.toggle('tall', MAPS[name].floors > 1); }
  showMap('train');
  camera.position.set(70, 1.55, 1.25); camera.rotation.set(0, -Math.PI / 2, 0);
  requestAnimationFrame(frame);

  // for testing
  window.MM = { get G() { return G; }, get A() { return A; }, handleReq, get TR() { return TR; } };
})();
