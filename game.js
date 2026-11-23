// Murder Might: a murder mystery on a train.
// One secret murderer, everyone else innocent. Innocents do 5 tasks, then go to room 25 (the meeting room) to accuse.
// The murderer starts with a dagger, gets a shotgun after 2 kills and a tracker after 4.
(() => {
  'use strict';
  const TR = window.TRAIN;
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
  let AC = null, rumbleOn = false;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (AC.state === 'suspended') AC.resume();
    if (!rumbleOn && AC) { rumbleOn = true; startRumble(); }
    return AC;
  }
  function noiseBuf(sec) {
    const b = AC.createBuffer(1, AC.sampleRate * sec, AC.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function noise(sec, freq, vol, type = 'lowpass') {
    if (!audio()) return;
    const src = AC.createBufferSource(); src.buffer = noiseBuf(sec);
    const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = AC.createGain(); g.gain.setValueAtTime(vol, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + sec);
    src.connect(f).connect(g).connect(AC.destination); src.start();
  }
  function tone(freq, sec, vol, type = 'sine', to) {
    if (!audio()) return;
    const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, AC.currentTime);
    if (to) o.frequency.exponentialRampToValueAtTime(to, AC.currentTime + sec);
    const g = AC.createGain(); g.gain.setValueAtTime(vol, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + sec);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + sec);
  }
  function startRumble() {
    const src = AC.createBufferSource(); src.buffer = noiseBuf(2); src.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 90;
    const g = AC.createGain(); g.gain.value = 0.25;
    src.connect(f).connect(g).connect(AC.destination); src.start();
    setInterval(() => { if (G && !document.hidden) { noise(0.06, 900, 0.05); setTimeout(() => noise(0.06, 800, 0.04), 160); } }, 1300);
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
    m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m); return m;
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
  function windowPane(x, y, z, w, h, facing) {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const wx = x + pos.getX(i) * facing; // which way the plane faces flips its x
      uv.setX(i, wx / LAND_W);
    }
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: landTex }));
    m.position.set(x, y, z); m.rotation.y = facing > 0 ? 0 : Math.PI; scene.add(m);
    boxAt(scene, w + 0.1, 0.06, 0.06, x, y - h / 2, z + 0.02 * facing, '#3a2412');
    boxAt(scene, w + 0.1, 0.06, 0.06, x, y + h / 2, z + 0.02 * facing, '#3a2412');
  }

  const WALL_H = 2.7;
  const TASK_MESH = []; // task id -> the object for that task
  function buildTrain() {
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    scene.add(new THREE.HemisphereLight(0xfff0d8, 0x442a1a, 0.4));
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
    for (const car of TR.CARS) {
      const len = car.x1 - car.x0, cx = (car.x0 + car.x1) / 2;
      const floor = car.kind === 'loco' ? '#3b3b40' : car.kind === 'cab' ? '#6b4a2a' : '#8a5a34';
      boxAt(scene, len, 0.1, TR.CW * 2 + 0.24, cx, -0.05, 0, floor);
      boxAt(scene, len, 0.1, TR.CW * 2 + 0.24, cx, WALL_H + 0.05, 0, car.kind === 'loco' ? '#2a2a2e' : '#e8d8b8');
      if (car.kind === 'pass') boxAt(scene, len - 2, 0.02, 1.0, cx, 0.01, TR.DOORZ, '#7a1e2a'); // corridor carpet
      const nl = car.kind === 'pass' ? 2 : 1;
      for (let k = 0; k < nl; k++) {
        const lx = car.x0 + len * (k + 0.5) / nl;
        const l = new THREE.PointLight(0xffd9a0, 0.8, 20); l.position.set(lx, 2.35, 0.3); scene.add(l);
      }
      for (let lx = car.x0 + 1.5; lx < car.x1 - 0.5; lx += 4) ball(scene, 0.1, lx, WALL_H - 0.05, TR.DOORZ, null, lampMat);
      // car name signs over the doors
      if (car.i > 0) sign(car.name, car.x0 + TR.T + 0.01, 2.2, TR.DOORZ, Math.PI / 2, 0.9, 0.22);
      if (car.i < TR.CARS.length - 1) sign(car.name, car.x1 - TR.T - 0.01, 2.2, TR.DOORZ, -Math.PI / 2, 0.9, 0.22);
      if (car.i < TR.CARS.length - 1) { // the walkway between cars
        const nx = TR.CARS[car.i + 1].x0;
        boxAt(scene, nx - car.x1, 0.1, TR.DOOR1 - TR.DOOR0 + 0.24, (car.x1 + nx) / 2, -0.05, TR.DOORZ, '#2a2a2a');
        boxAt(scene, nx - car.x1, 0.1, TR.DOOR1 - TR.DOOR0 + 0.24, (car.x1 + nx) / 2, WALL_H + 0.05, TR.DOORZ, '#1a1a1a');
      }
    }
    for (const w of TR.SIGHT) {
      const car = TR.CARS.find((c) => w.x0 >= c.x0 - 0.01 && w.x1 <= c.x1 + 0.01);
      let color = '#c39463', h = WALL_H;
      if (w.z0 <= -TR.CW - TR.T + 0.001 || w.z1 >= TR.CW + TR.T - 0.001) color = '#6e2630';
      else if (!car) color = '#4a4a4e';
      else if (car.kind === 'loco' && w.x1 - w.x0 > 5) { color = '#20402c'; h = 2.2; }
      else if (car.kind !== 'pass') color = '#5a3a22';
      boxAt(scene, w.x1 - w.x0, h, w.z1 - w.z0, (w.x0 + w.x1) / 2, h / 2, (w.z0 + w.z1) / 2, color);
    }
    // windows
    for (const r of TR.ROOMS) {
      windowPane(r.xc, 1.55, -TR.CW + 0.01, 1.2, 0.8, 1);
      windowPane(r.xc, 1.55, TR.CW - 0.01, 1.2, 0.8, -1);
      const t = textTex(String(r.n), r.n === TR.MEETING_N ? '#7a1020' : '#2b1a0e', '#ffd86b', 128, 96, 60);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.25), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(r.xc, 2.3, TR.CORR + TR.T + 0.01); scene.add(m);
      if (r.n === TR.MEETING_N) sign('MEETING ROOM', r.xc, 2.0, TR.CORR + TR.T + 0.01, 0, 0.9, 0.16, '#7a1020', '#fff');
    }
    for (const car of TR.CARS) if (car.kind !== 'pass') {
      for (let x = car.x0 + 2; x < car.x1 - 1; x += 3) windowPane(x, 1.6, TR.CW - 0.01, 1.0, 0.7, -1);
    }
    // furniture
    for (const f of TR.FURN) {
      const w = f.x1 - f.x0, d = f.z1 - f.z0, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      if (f.kind === 'bed') {
        boxAt(scene, w, 0.3, d, cx, 0.15, cz, '#5a3a22');
        boxAt(scene, w - 0.05, 0.15, d - 0.05, cx, 0.37, cz, '#e9e4f2');
        boxAt(scene, w * 0.55, 0.06, d - 0.04, cx + w * 0.2, 0.47, cz, '#6a7ac8');
      } else if (f.kind === 'table') {
        boxAt(scene, w, 0.06, d, cx, f.h, cz, '#7a4e2a');
        boxAt(scene, 0.08, f.h, 0.08, cx, f.h / 2, cz, '#5a3a22');
      } else if (f.kind === 'meeting') {
        boxAt(scene, w, 0.08, d, cx, f.h, cz, '#4a2a18');
        boxAt(scene, w - 0.2, f.h, 0.1, cx, f.h / 2, cz, '#3a2012');
        cyl(scene, 0.12, 0.16, 0.18, cx, f.h + 0.13, cz, '#e8c040');
        for (const dx of [-0.6, 0, 0.6]) cyl(scene, 0.2, 0.2, 0.45, cx + dx, 0.22, cz + d / 2 + 0.35, '#8a1e2e');
      } else if (f.kind === 'coal') {
        boxAt(scene, w, 0.3, d, cx, 0.15, cz, '#3a3a3a');
        for (let i = 0; i < 14; i++) ball(scene, 0.12 + (i % 3) * 0.04, f.x0 + 0.15 + (i * 0.37) % (w - 0.3), 0.35 + (i % 4) * 0.05, f.z0 + 0.15 + (i * 0.23) % (d - 0.3), '#151515');
      } else if (f.kind === 'panel') {
        boxAt(scene, w, f.h, d, cx, f.h / 2, cz, '#555a60');
        for (let i = 0; i < 4; i++) cyl(scene, 0.06, 0.06, 0.05, f.x0 + 0.2 + i * 0.25, f.h + 0.03, cz, i % 2 ? '#e03030' : '#30c040', 8);
      } else if (f.kind === 'desk') {
        boxAt(scene, w, 0.06, d, cx, f.h, cz, '#6a4020');
        boxAt(scene, w - 0.1, f.h, d - 0.1, cx, f.h / 2, cz, '#4a2a14');
      } else if (f.kind === 'stove') {
        boxAt(scene, w, f.h, d, cx, f.h / 2, cz, '#222');
        boxAt(scene, 0.4, 0.25, 0.02, cx, 0.45, f.z1 + 0.01, null, glow('#ff7a20'));
        cyl(scene, 0.1, 0.1, WALL_H - f.h, cx, f.h + (WALL_H - f.h) / 2, cz, '#333');
      } else if (f.kind === 'bunk') {
        boxAt(scene, w, 0.25, d, cx, f.h - 0.12, cz, '#5a3a22');
        boxAt(scene, w - 0.05, 0.12, d - 0.05, cx, f.h + 0.06, cz, '#b0a080');
      } else boxAt(scene, w, f.h, d, cx, f.h / 2, cz, '#777');
    }
    // the front of the locomotive: a fire door on the boiler
    const loco = TR.CARS[0];
    boxAt(scene, 0.04, 0.5, 0.7, loco.x0 + 6.52, 0.6, -1.3, null, glow('#ff6a10'));
    // task objects
    for (const t of TR.TASKS) TASK_MESH[t.id] = taskObject(t);
  }

  function taskObject(t) {
    const g = new THREE.Group(); g.position.set(t.ox, t.oy, t.oz); scene.add(g);
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
  function makeDef(humans, total, murderer) {
    const free = shuffle(COLORS.map((_, i) => i).filter((i) => !humans.some((h) => h.c === i)));
    const slots = humans.map((h) => ({ c: h.c, o: h.o }));
    while (slots.length < total && free.length) slots.push({ c: free.pop(), o: '' });
    const ids = TR.TASKS.map((t) => t.id);
    const tasks = slots.map(() => shuffle(ids.slice()).slice(0, NTASK));
    const spots = shuffle(TR.SPAWNS.slice());
    const spawn = slots.map((_, i) => { const n = spots[i % spots.length]; return [+(n.x + rand(-0.4, 0.4)).toFixed(2), n.z]; });
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), slots, m: murderer, tasks, spawn };
  }

  function startGame(def, online) {
    stopGame();
    const me = online ? def.slots.findIndex((s) => s.o === myId) : def.slots.findIndex((s) => s.o === 'me');
    G = {
      def, online, host: online ? room.isHost : true, me, m: def.m, bodies: [], over: false, t0: now(),
      myDone: new Set(), seenBodies: new Set(), offs: [], hold: 0, lastSend: 0, cool: 0, swing: 0,
      slots: def.slots.map((d, i) => ({
        i, c: d.c, o: d.o || '', tasks: def.tasks[i], alive: true, out: false,
        x: def.spawn[i][0], z: def.spawn[i][1], a: Math.random() * Math.PI * 2, w: 0, kills: 0,
        tx: def.spawn[i][0], tz: def.spawn[i][1], ta: 0, ai: null, mesh: null,
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
      big('🔪 You are the MURDERER!', `Kill everyone without getting seen. Your weapon is ready in ${GRACE} seconds. Press Q to take it out.`, 6);
      $('role').className = 'm';
    } else {
      big('🙂 You are INNOCENT', 'Do your 5 tasks, then go to room 25 (the meeting room) to accuse the murderer!', 6);
      $('role').className = 'i';
    }
    $('t-weap').hidden = $('t-hit').hidden = G.me !== G.m;
    $('t-acc').hidden = G.me === G.m;
    camera.position.set(mine.x, EYE, mine.z);
    audio();
    SFX.whistle();
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
      const ok = s && v !== by && A.alive[v] && t - A.last > 0.4 &&
        dist(k, s) <= (w === 2 ? SHOTGUN + 1.5 : DAGGER + 1.2) && (w === 1 || TR.los(k.x, k.z, s.x, s.z));
      if (!ok) { if (w === 2) emit({ t: 'bang', by }); return; }
      A.alive[v] = false; A.kills++; A.last = t;
      emit({ t: 'kill', by, v, w, x: +s.x.toFixed(2), z: +s.z.toFixed(2) });
      // bots who saw it now know who the murderer is
      for (const b of G.slots) {
        if (b.ai && A.alive[b.i] && b.i !== by && dist(b, k) < 20 && TR.los(b.x, b.z, k.x, k.z)) { b.ai.known = true; b.ai.sus = by; }
      }
      checkWin();
      return;
    }
    if (r.t === 'acc') {
      const v = r.v;
      if (by === G.m || !G.slots[v] || !A.alive[v] || v === by || A.done[by].size < NTASK || !TR.inMeeting(k.x, k.z, 0.8)) return;
      if (v === G.m) { A.over = true; emit({ t: 'acc', by, v, ok: 1 }); emit({ t: 'win', w: 'i', by }); return; }
      A.alive[v] = false;
      const others = G.slots.filter((s) => A.alive[s.i] && s.i !== G.m).map((s) => s.i);
      const r2 = others.length ? pick(others) : -1;
      if (r2 >= 0) A.alive[r2] = false;
      emit({ t: 'acc', by, v, ok: 0, r: r2 });
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
      v.alive = false; v.x = v.tx = ev.x; v.z = v.tz = ev.z; v.w = 0;
      k.kills++;
      G.bodies.push({ slot: ev.v, x: ev.x, z: ev.z });
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
        msg(`☝ ${tag(ev.by)} accused ${tag(ev.v)}, but ${cname(ev.v)} was innocent! ${outs.map(tag).join(' and ')} ${outs.length > 1 ? 'are' : 'is'} off the train!`);
        if (outs.includes(G.me)) big('🚪 You\'re out!', ev.v === G.me ? `${cname(ev.by)} accused you, but you were innocent!` : `${cname(ev.by)} accused the wrong person, and you got kicked off too!`, 5);
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
    msg(`💥 BANG! A shotgun went off in <b>${TR.carAt(k.x).name}</b>!`);
  }
  function layBody(s) {
    const m = s.mesh;
    m.visible = true;
    m.position.set(s.x, 0, s.z);
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
  function goTo(s, x, z) { s.ai.path = TR.findPath(s.x, s.z, x, z); s.ai.goal = [x, z]; s.ai.stuckT = 0; }
  function sees(s, o, r) { return dist(s, o) < r && TR.los(s.x, s.z, o.x, o.z); }

  function updateBot(s, dt, t) {
    const ai = s.ai;
    ai.think -= dt;
    if (ai.think <= 0) { ai.think = 0.2; if (s.i === G.m) thinkMurderer(s, t); else thinkInnocent(s, t); }
    if (!ai.path.length) return;
    const [gx, gz] = ai.path[0];
    const dx = gx - s.x, dz = gz - s.z, d = Math.hypot(dx, dz);
    if (d < 0.12) { ai.path.shift(); return; }
    const st = Math.min(d, BOT_SPEED * dt);
    TR.move(s, dx / d * st, dz / d * st);
    s.a = Math.atan2(-dx, -dz);
    // stuck? try again
    if (Math.hypot(s.x - ai.lx, s.z - ai.lz) < 0.02) { ai.stuckT += dt; if (ai.stuckT > 1.2 && ai.goal) { TR.move(s, rand(-0.2, 0.2), rand(-0.2, 0.2)); goTo(s, ai.goal[0], ai.goal[1]); } }
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
    goTo(s, n.x, n.z);
  }

  function thinkInnocent(s, t) {
    const ai = s.ai, M = G.slots[G.m], mAlive = A.alive[G.m];
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
    if (ai.known && mAlive && sees(s, M, 7) && !(done && TR.inMeeting(s.x, s.z))) {
      if (ai.mode !== 'flee' || t > ai.until || !ai.path.length) {
        ai.mode = 'flee'; ai.until = t + 3; ai.doing = 0;
        const far = TR.SPAWNS.filter((n) => Math.abs(n.x - M.x) > 15 && Math.sign(n.x - s.x) === Math.sign(s.x - M.x || 1));
        const n = pick(far.length ? far : TR.SPAWNS);
        goTo(s, n.x, n.z);
      }
      return;
    }
    // tasks done and someone looks guilty: go to the meeting room and accuse them
    if (done && ai.sus >= 0 && (ai.known || t - ai.susT > 6)) {
      ai.mode = 'accuse';
      if (TR.inMeeting(s.x, s.z)) { handleReq({ t: 'acc', by: s.i, v: ai.sus }); ai.sus = -1; ai.path = []; return; }
      if (!ai.path.length) goTo(s, TR.MEETING.xc, -0.6);
      return;
    }
    if (!done) {
      if (ai.doing) {
        if (t >= ai.doing) { handleReq({ t: 'task', by: s.i, id: ai.task }); ai.doing = 0; ai.task = -1; }
        return;
      }
      if (ai.task < 0 || A.done[s.i].has(ai.task) || ai.mode !== 'task') {
        const left = s.tasks.filter((id) => !A.done[s.i].has(id)).map((id) => TR.TASKS[id]);
        left.sort((p, q) => Math.abs(p.sx - s.x) - Math.abs(q.sx - s.x));
        ai.task = left[0].id; ai.mode = 'task';
        goTo(s, left[0].sx, left[0].sz);
      }
      const tk = TR.TASKS[ai.task];
      if (Math.hypot(s.x - tk.sx, s.z - tk.sz) < 0.35) { ai.doing = t + TASK_TIME + rand(0, 1.5); ai.path = []; s.a = faceTo(s, tk.ox, tk.oz); }
      else if (!ai.path.length) goTo(s, tk.sx, tk.sz);
      return;
    }
    if (ai.mode !== 'wander') { ai.mode = 'wander'; ai.path = []; }
    wander(s, t);
  }

  function thinkMurderer(s, t) {
    const ai = s.ai;
    if (ai.hideAt && t > ai.hideAt) { s.w = 0; ai.hideAt = 0; }
    const others = (a, b) => G.slots.filter((o) => o.i !== a && o.i !== b && A.alive[o.i]);
    const witnesses = (v) => others(s.i, v).filter((o) => sees(o, s, 22)).length;
    if (t < ai.cool) {
      if (!ai.hideAt) s.w = 0;
      // pretend to do tasks
      if (ai.doing) { if (t > ai.doing) ai.doing = 0; return; }
      if (ai.mode !== 'fake' || !ai.path.length) {
        if (ai.mode === 'fake' && ai.task >= 0) { const tk = TR.TASKS[ai.task]; if (Math.hypot(s.x - tk.sx, s.z - tk.sz) < 0.5) { ai.doing = t + rand(2, 4); s.a = faceTo(s, tk.ox, tk.oz); ai.task = -1; return; } }
        ai.mode = 'fake'; ai.task = pick(s.tasks);
        const tk = TR.TASKS[ai.task]; goTo(s, tk.sx, tk.sz);
      }
      return;
    }
    const tracker = A.kills >= 4;
    if (ai.target < 0 || !A.alive[ai.target] || t > ai.targetT) {
      let best = -1, score = 1e9;
      for (const o of others(s.i, -1)) {
        const d = dist(s, o);
        if (!tracker && d > 9 && !sees(s, o, 16)) continue;
        const sc = d + others(s.i, o.i).filter((q) => sees(q, o, 14)).length * 15;
        if (sc < score) { score = sc; best = o.i; }
      }
      ai.target = best; ai.targetT = t + 20;
    }
    if (ai.target < 0) { if (!ai.hideAt) s.w = 0; ai.mode = 'wander'; wander(s, t); return; }
    ai.mode = 'hunt';
    const v = G.slots[ai.target], d = dist(s, v), see = TR.los(s.x, s.z, v.x, v.z);
    const wit = witnesses(ai.target);
    const want = A.kills >= 2 && d > 2.2 ? 2 : 1;
    const range = want === 2 ? 9 : 1.6;
    if (wit === 0 && see && d < range) {
      ai.path = []; s.a = faceTo(s, v.x, v.z);
      if (s.w !== want) { s.w = want; ai.drawT = t; ai.hideAt = 0; }
      else if (t - ai.drawT > 0.35) {
        handleReq({ t: 'kill', by: s.i, v: ai.target, w: want });
        ai.cool = t + rand(10, 18); ai.hideAt = t + 0.9; ai.target = -1; ai.mode = '';
      }
      return;
    }
    if (wit > 0 && !ai.hideAt) s.w = 0;
    if (t > ai.repath || !ai.path.length) { goTo(s, v.x, v.z); ai.repath = t + 0.7; }
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
  document.addEventListener('mousedown', (e) => { if (G && document.pointerLockElement === canvas && e.button === 0) attack(); });
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
  })();

  function cycleWeapon() {
    if (!G || G.me !== G.m || G.over) return;
    const s = G.slots[G.me];
    if (!s.alive) return;
    if (now() - G.t0 < GRACE) { msg(`Your weapon is ready in ${Math.ceil(GRACE - (now() - G.t0))} seconds.`); return; }
    s.w = s.w === 0 ? 1 : s.w === 1 && s.kills >= 2 ? 2 : 0;
    SFX.swish();
  }
  // who is in front of me?
  function aimAt(range, maxAng, needSight = true) {
    const s = G.slots[G.me];
    let best = -1, bd = 1e9;
    for (const o of G.slots) {
      if (o.i === G.me || !o.alive) continue;
      const d = dist(s, o);
      if (d > range) continue;
      const diff = angDiff(faceTo(s, o.x, o.z), s.a);
      if (diff > Math.max(maxAng, Math.atan(0.35 / Math.max(d, 0.1)))) continue;
      if (needSight && !TR.los(s.x, s.z, o.x, o.z)) continue;
      if (diff * d < bd) { bd = diff * d; best = o.i; }
    }
    return best;
  }
  function attack() {
    if (!G || G.over || G.me !== G.m) return;
    const s = G.slots[G.me];
    if (!s.alive || !s.w || now() < G.cool) return;
    G.cool = now() + (s.w === 2 ? 1.0 : 0.5);
    G.swing = now();
    if (s.w === 1) {
      SFX.swish();
      const v = aimAt(DAGGER + 0.3, 0.5);
      if (v >= 0) request({ t: 'kill', by: G.me, v, w: 1 });
    } else {
      const v = aimAt(SHOTGUN, 0.12);
      request({ t: 'kill', by: G.me, v, w: 2 });
    }
  }
  function openAccuse() {
    if (!G || G.over || G.me === G.m) return;
    const s = G.slots[G.me];
    if (!s.alive) return;
    if (G.myDone.size < NTASK) { msg(`Finish all your tasks first! (${G.myDone.size}/${NTASK})`); return; }
    if (!TR.inMeeting(s.x, s.z)) { msg('Go to <b>room 25, the meeting room</b>, to accuse someone.'); return; }
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
    if (s.alive && !G.over) TR.move(s, dx, dz);
    else if (!s.alive) { // ghosts float through walls
      s.x = Math.max(-1, Math.min(TR.LENGTH + 1, s.x + dx));
      s.z = Math.max(-1.9, Math.min(1.9, s.z + dz));
    }
    const moving = len > 0.1 && s.alive;
    G.bob = (G.bob || 0) + (moving ? dt * 9 : 0);
    const sway = Math.sin(t * 1.7) * 0.004;
    camera.position.set(s.x, (s.alive ? EYE : 1.9) + Math.sin(G.bob) * 0.04, s.z);
    camera.rotation.set(pitch, s.a, sway);

    // tasks
    G.near = -1;
    if (s.alive && !G.over) {
      for (const id of s.tasks) {
        if (G.myDone.has(id)) continue;
        const tk = TR.TASKS[id];
        if (Math.hypot(s.x - tk.ox, s.z - tk.oz) < REACH || Math.hypot(s.x - tk.sx, s.z - tk.sz) < 0.6) { G.near = id; break; }
      }
    }
    if (G.near >= 0 && (keys.KeyE || touchTask)) {
      G.hold += dt;
      if (G.hold >= TASK_TIME) {
        G.myDone.add(G.near); G.hold = 0; SFX.ding();
        request({ t: 'task', by: G.me, id: G.near });
        const m = markers.find((m) => m.id === G.near); if (m) { scene.remove(m.ring, m.gem); }
        if (G.me !== G.m && G.myDone.size === NTASK) { msg('✅ All tasks done! Go to <b>room 25, the meeting room</b>, to accuse someone.'); SFX.yay(); }
      }
    } else G.hold = 0;

    // bodies I find
    if (s.alive) {
      for (const b of G.bodies) {
        if (G.seenBodies.has(b.slot) || b.slot === G.me) continue;
        if (Math.hypot(s.x - b.x, s.z - b.z) < 9 && TR.los(s.x, s.z, b.x, b.z)) {
          G.seenBodies.add(b.slot);
          if (G.slots[b.slot] && G.me !== G.m) { msg(`😱 You found ${tag(b.slot)}'s body in ${TR.placeName(b.x, b.z)}!`); SFX.gasp(); }
        }
      }
    }

    // my weapon in my hand
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
      m.visible = s.i !== G.me;
      m.position.set(s.x, 0, s.z);
      m.rotation.y = s.a;
      const mv = Math.hypot(s.x - (s.px ?? s.x), s.z - (s.pz ?? s.z)) > 0.004;
      s.px = s.x; s.pz = s.z;
      m.userData.body.position.y = mv ? Math.abs(Math.sin(t * 9 + s.i)) * 0.05 : 0;
      m.userData.weapons[1].visible = s.w === 1;
      m.userData.weapons[2].visible = s.w === 2;
    }
    for (const mk of markers) {
      mk.gem.rotation.y = t * 2;
      mk.gem.position.y = Math.min(TR.TASKS[mk.id].oy + 0.6, 2.5) + Math.sin(t * 3) * 0.06;
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
    $('where').textContent = '📍 ' + TR.placeName(s.x, s.z);
    // role box
    let role;
    if (G.me === G.m) {
      const wait = GRACE - (t - G.t0);
      role = `<b>🔪 Murderer</b><br>Kills: ${s.kills}<br>` +
        (wait > 0 ? `Weapon ready in ${Math.ceil(wait)}...` : `In hand: ${['nothing (Q)', '🔪 Dagger', '🔫 Shotgun'][s.w]}`) +
        `<br><small>${s.kills < 2 ? `🔫 Shotgun after ${2 - s.kills} more` : s.kills < 4 ? `📡 Tracker after ${4 - s.kills} more` : '📡 Tracker on!'}</small>`;
    } else role = `<b>🙂 Innocent</b><br>Tasks: ${G.myDone.size}/${NTASK}<br><small>${G.myDone.size < NTASK ? 'Then go to room 25 to accuse' : 'Go to room 25 and press F to accuse!'}</small>`;
    if (!s.alive) role = s.out ? '<b>🚪 Out</b><br>You\'re off the train. Watch the rest!' : '<b>👻 Ghost</b><br>You were killed. Watch the rest!';
    if ($('role').innerHTML !== role) $('role').innerHTML = role;
    // task list
    const th = `<h3>${G.me === G.m ? 'Fake tasks (to look innocent)' : 'Your tasks'}</h3><ul>` +
      s.tasks.map((id) => { const tk = TR.TASKS[id]; return `<li class="${G.myDone.has(id) ? 'done' : ''}">${G.myDone.has(id) ? '✅' : '⬜'} ${tk.name}: <b>${tk.where}</b></li>`; }).join('') + '</ul>';
    if (th !== lastTaskHtml) { $('tasks').innerHTML = th; lastTaskHtml = th; }
    // prompt and progress bar
    let p = '';
    if (s.alive && !G.over) {
      if (G.near >= 0) p = `${isTouch ? 'Hold ✋' : 'Hold E'}: ${TR.TASKS[G.near].name}`;
      if (G.me === G.m && s.w) {
        const v = s.w === 1 ? aimAt(DAGGER + 0.3, 0.5) : aimAt(SHOTGUN, 0.12);
        if (v >= 0) p = `${isTouch ? '💥' : 'Click'}: attack ${COLORS[G.slots[v].c].n}`;
      }
      if (G.me !== G.m && TR.inMeeting(s.x, s.z)) p = G.myDone.size >= NTASK ? `${isTouch ? '☝ Accuse' : 'Press F'} to accuse someone!` : `Finish your tasks to accuse (${G.myDone.size}/${NTASK})`;
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
    const pad = 6, sx = (W - pad * 2) / TR.LENGTH, top = 10, hh = H - 16;
    const X = (x) => pad + x * sx, Z = (z) => top + (z + TR.CW) / (TR.CW * 2) * hh;
    g.font = '600 9px Fredoka, sans-serif'; g.textAlign = 'center';
    for (const car of TR.CARS) {
      g.fillStyle = car.kind === 'loco' ? '#3a4a3a' : car.kind === 'cab' ? '#7a3a2a' : '#5a3a3a';
      g.fillRect(X(car.x0), top, (car.x1 - car.x0) * sx, hh);
      g.fillStyle = '#ffffffaa';
      g.fillText(car.kind === 'pass' ? car.name.replace('Rooms ', '') : car.kind === 'loco' ? '🚂' : 'Caboose', X((car.x0 + car.x1) / 2), 8);
    }
    const mr = TR.MEETING;
    g.fillStyle = '#c0304088'; g.fillRect(X(mr.a), Z(-TR.CW), (mr.b - mr.a) * sx, Z(TR.CORR) - Z(-TR.CW));
    const s = G.slots[G.me];
    for (const id of s.tasks) {
      if (G.myDone.has(id)) continue;
      const tk = TR.TASKS[id]; g.fillStyle = '#ffd23d'; g.fillRect(X(tk.sx) - 2.5, Z(tk.sz) - 2.5, 5, 5);
    }
    const all = !s.alive || (G.me === G.m && s.kills >= 4);
    for (const o of G.slots) {
      if (o.out || o.i === G.me) continue;
      if (!o.alive && (G.seenBodies.has(o.i) || all)) { g.fillStyle = '#fff'; g.fillText('✖', X(o.x), Z(o.z) + 3); continue; }
      if (!o.alive || !all) continue;
      g.fillStyle = COLORS[o.c].h; g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath(); g.arc(X(o.x), Z(o.z), 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = COLORS[s.c].h; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(X(s.x), Z(s.z), 4.2 + Math.sin(t * 6) * 0.6, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  // =====================================================================
  // Online
  // =====================================================================
  // Rooms live at murdermight/rooms/<CODE>. Only game things are sent: colours, positions, task ticks,
  // kills and accusations. No names or chat. The host is the referee and runs the bots.
  const VERSION = 1;
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
          host: myId, v: VERSION, created: firebase.database.ServerValue.TIMESTAMP, phase: 'lobby', fill: 8, players: { [myId]: { c: myColor } },
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
    room = { code, ref, isHost, players: {}, fill: 8, gameId: null, offs: [] };
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
    $('lobby-start').hidden = !room.isHost;
    $('lobby-msg').textContent = room.isHost ? `${ids.length} player${ids.length > 1 ? 's' : ''} here. Tell friends the code, then press GO!` : 'Waiting for the host to press GO...';
  }
  $('lobby-fill').onchange = () => { if (room && room.isHost) room.ref.child('fill').set(+$('lobby-fill').value); };
  $('lobby-start').onclick = () => {
    if (!room || !room.isHost) return;
    const ids = Object.keys(room.players);
    const humans = ids.map((id) => ({ c: room.players[id].c, o: id }));
    // two people can't share a colour
    const seen = new Set();
    for (const h of humans) { if (seen.has(h.c)) h.c = COLORS.findIndex((_, i) => !seen.has(i) && !humans.some((q) => q.c === i)); seen.add(h.c); }
    const total = Math.max(3, humans.length, room.fill);
    const def = makeDef(humans, total, 0);
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
      s.tx = p.x; s.tz = p.z; s.ta = p.a; s.w = p.w || 0;
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
    const put = (s) => { up[s.i] = { x: +s.x.toFixed(2), z: +s.z.toFixed(2), a: +s.a.toFixed(2), w: s.w }; };
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
    const def = makeDef([{ c: myColor, o: 'me' }], n, 0);
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
  buildTrain();
  camera.position.set(70, 1.55, 1.25); camera.rotation.set(0, -Math.PI / 2, 0);
  requestAnimationFrame(frame);

  // for testing
  window.MM = { get G() { return G; }, get A() { return A; }, handleReq, TR };
})();
