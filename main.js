import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
  CubeRush 3×3 — a 3×3 speed-cube puzzle for the browser.
  Mouse / touch : drag a sticker to turn its layer, drag empty space to rotate the whole cube.
  Keyboard      : speedcuber layout (I/K = R/R', J/F = U/U', H/G = F/F' ...) or plain notation.
*/

/* ------------------------------------------------------------------ */
/* Persistence (wrapped: storage can be blocked in private windows)    */
/* ------------------------------------------------------------------ */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

const SETTINGS_KEY = 'cuberush.settings.v1';
const SOLVES_KEY = 'cuberush.solves.v1';
const settings = { speed: 120, layout: 'speed', inspection: false, sound: true, ...store.get(SETTINGS_KEY, {}) };
if (!['speed', 'notation'].includes(settings.layout)) settings.layout = 'speed';
settings.speed = Math.min(300, Math.max(0, Number(settings.speed) || 0));
let solves = store.get(SOLVES_KEY, []);
if (!Array.isArray(solves)) solves = [];
const saveSettings = () => store.set(SETTINGS_KEY, settings);

const $ = (id) => document.getElementById(id);
const isTouch = window.matchMedia('(hover: none)').matches;
const mobileMQ = window.matchMedia('(max-width: 820px)');

/* ------------------------------------------------------------------ */
/* Renderer, camera, lights                                            */
/* ------------------------------------------------------------------ */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 80);
const VIEW_DIR = new THREE.Vector3(0.62, 0.7, 1).normalize();

scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2f38, 1.15));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xbfd4ff, 0.55);
fillLight.position.set(-6, -3, 4);
scene.add(fillLight);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const radius = 2.65; // screen-space radius of the cube to keep visible
  const distV = radius / (0.58 * tanHalf);
  const distH = radius / (0.86 * tanHalf * camera.aspect);
  camera.position.copy(VIEW_DIR).multiplyScalar(Math.max(distV, distH));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ */
/* Cube model: 26 cubies, each a rounded black body plus stickers      */
/* ------------------------------------------------------------------ */
const FACE_COLORS = { U: 0xf4f4f4, D: 0xffd500, F: 0x009e60, B: 0x0051ba, R: 0xc41e3a, L: 0xff5800 };
const FACE_DIRS = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0] };
const STICKER_ROT = {
  U: [-Math.PI / 2, 0, 0],
  D: [Math.PI / 2, 0, 0],
  F: [0, 0, 0],
  B: [0, Math.PI, 0],
  R: [0, Math.PI / 2, 0],
  L: [0, -Math.PI / 2, 0],
};

function roundedSquare(size, r) {
  const s = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  return new THREE.ShapeGeometry(shape, 6);
}

const cubeGroup = new THREE.Group();
scene.add(cubeGroup);
const pivot = new THREE.Object3D();
cubeGroup.add(pivot);

const cubies = [];
const pickables = [];
const bodyGeo = new RoundedBoxGeometry(0.97, 0.97, 0.97, 4, 0.08);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.5, metalness: 0.05 });
const stickerGeo = roundedSquare(0.8, 0.13);
const stickerMats = {};
for (const [face, color] of Object.entries(FACE_COLORS)) {
  stickerMats[face] = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0 });
}

for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const cubie = new THREE.Group();
      cubie.position.set(x, y, z);
      cubie.userData.home = new THREE.Vector3(x, y, z);
      cubie.userData.stickers = [];
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      cubie.add(body);
      pickables.push(body);
      for (const [face, [dx, dy, dz]] of Object.entries(FACE_DIRS)) {
        if ((dx && dx === x) || (dy && dy === y) || (dz && dz === z)) {
          const sticker = new THREE.Mesh(stickerGeo, stickerMats[face]);
          sticker.position.set(dx * 0.489, dy * 0.489, dz * 0.489);
          sticker.rotation.set(...STICKER_ROT[face]);
          sticker.userData = { face, normal: new THREE.Vector3(dx, dy, dz) };
          cubie.add(sticker);
          cubie.userData.stickers.push(sticker);
          pickables.push(sticker);
        }
      }
      cubeGroup.add(cubie);
      cubies.push(cubie);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Move notation                                                       */
/* ------------------------------------------------------------------ */
// [axis, layers, direction of the clockwise turn as a sign of the angle around +axis]
const BASE = {
  R: ['x', [1], -1], L: ['x', [-1], 1], M: ['x', [0], 1],
  U: ['y', [1], -1], D: ['y', [-1], 1], E: ['y', [0], 1],
  F: ['z', [1], -1], B: ['z', [-1], 1], S: ['z', [0], -1],
  r: ['x', [0, 1], -1], l: ['x', [-1, 0], 1],
  u: ['y', [0, 1], -1], d: ['y', [-1, 0], 1],
  f: ['z', [0, 1], -1], b: ['z', [-1, 0], 1],
  x: ['x', [-1, 0, 1], -1], y: ['y', [-1, 0, 1], -1], z: ['z', [-1, 0, 1], -1],
};
const MOVE_RE = /^([RLUDFBMESrludfbxyz])(w?)(2?)('?)$/;

function parseMove(text) {
  const m = MOVE_RE.exec(String(text).trim().replace(/[’′]/g, "'"));
  if (!m) return null;
  let base = m[1];
  if (m[2]) {
    if (!'RLUDFB'.includes(base)) return null;
    base = base.toLowerCase();
  }
  const [axis, layers, dir] = BASE[base];
  const turns = m[3] ? 2 : 1;
  const prime = !!m[4];
  const sign = prime ? -dir : dir;
  return {
    name: base + (turns === 2 ? '2' : prime ? "'" : ''),
    axis,
    layers,
    angle: (sign * turns * Math.PI) / 2,
    rotation: 'xyz'.includes(base),
  };
}

function inverseMove(mv) {
  const base = mv.name.replace(/['2]/g, '');
  const name = mv.name.includes('2') ? mv.name : mv.name.endsWith("'") ? base : base + "'";
  return { name, axis: mv.axis, layers: mv.layers, angle: -mv.angle, rotation: mv.rotation };
}

const LAYER_NAMES = { x: { 1: 'R', '-1': 'L', 0: 'M' }, y: { 1: 'U', '-1': 'D', 0: 'E' }, z: { 1: 'F', '-1': 'B', 0: 'S' } };
// sign = +1 means a positive (counter-clockwise from +axis) rotation
function moveFromAxis(axis, layer, sign) {
  const base = LAYER_NAMES[axis][layer];
  const dir = BASE[base][2];
  return parseMove(base + (sign === dir ? '' : "'"));
}

/* ------------------------------------------------------------------ */
/* Turn animation queue                                                */
/* ------------------------------------------------------------------ */
const queue = [];
let anim = null;

function startMove(mv) {
  pivot.rotation.set(0, 0, 0);
  pivot.updateMatrixWorld(true);
  const sel = cubies.filter((c) => mv.layers.includes(Math.round(c.position[mv.axis])));
  for (const c of sel) pivot.attach(c);
  anim = { mv, sel, t: 0 };
  if (!mv.silent) playTick();
}

const _m4 = new THREE.Matrix4();
function snap(c) {
  c.position.set(Math.round(c.position.x), Math.round(c.position.y), Math.round(c.position.z));
  _m4.makeRotationFromQuaternion(c.quaternion);
  const e = _m4.elements;
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) e[i] = Math.round(e[i]);
  c.quaternion.setFromRotationMatrix(_m4);
  c.scale.set(1, 1, 1);
}

function finishMove() {
  const { mv, sel } = anim;
  pivot.rotation[mv.axis] = mv.angle;
  pivot.updateMatrixWorld(true);
  for (const c of sel) {
    cubeGroup.attach(c);
    snap(c);
  }
  pivot.rotation.set(0, 0, 0);
  anim = null;
  onMoveFinished(mv);
}

function moveDuration() {
  const pending = queue.length;
  if (pending >= 3 || settings.speed <= 0) return 0; // fast typists: never fall behind
  const base = settings.speed * (Math.abs(anim.mv.angle) > 2 ? 1.45 : 1);
  return base / (1 + pending * 1.5);
}

function flush() {
  while (anim || queue.length) {
    if (!anim) startMove(queue.shift());
    finishMove();
  }
  cubeGroup.updateMatrixWorld(true);
}

const easeOut = (p) => 1 - Math.pow(1 - p, 3);

function stepAnimation(dt) {
  let budget = dt;
  for (let guard = 0; guard < 400; guard++) {
    if (!anim) {
      if (!queue.length) return;
      startMove(queue.shift());
    }
    const dur = moveDuration();
    anim.t += budget;
    budget = 0;
    if (anim.t >= dur) {
      budget = anim.t - dur;
      finishMove();
      continue;
    }
    pivot.rotation[anim.mv.axis] = anim.mv.angle * easeOut(anim.t / dur);
    return;
  }
}

/* ------------------------------------------------------------------ */
/* Sound: a tiny synthesized click per turn                            */
/* ------------------------------------------------------------------ */
let audioCtx = null;
let lastTickAt = 0;
function playTick() {
  if (!settings.sound) return;
  const now = performance.now();
  if (now - lastTickAt < 30) return;
  lastTickAt = now;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(700 + Math.random() * 250, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.05);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  } catch {
    /* audio unavailable */
  }
}

/* ------------------------------------------------------------------ */
/* Solved check: every outward direction shows a single colour         */
/* ------------------------------------------------------------------ */
const _v = new THREE.Vector3();
function dominantAxis(v) {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return 'x';
  return ay >= az ? 'y' : 'z';
}
function isSolved() {
  const seen = {};
  for (const c of cubies) {
    for (const s of c.userData.stickers) {
      _v.copy(s.userData.normal).applyQuaternion(c.quaternion);
      const axis = dominantAxis(_v);
      const key = (_v[axis] > 0 ? '+' : '-') + axis;
      if (!(key in seen)) seen[key] = s.userData.face;
      else if (seen[key] !== s.userData.face) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */
let state = 'free'; // free | ready | inspecting | solving | solved
let moveCount = 0;
let solveStart = 0;
let inspectStart = 0;
let finalTime = 0;
let finalMoves = 0;
let scrambleText = '';
let history = [];
let log = [];

function doMove(input, { record = true } = {}) {
  const mv = typeof input === 'string' ? parseMove(input) : { ...input };
  if (!mv) return;
  mv.issuedAt = performance.now();
  if (!mv.rotation) {
    if (state === 'solved') {
      state = 'free';
      moveCount = 0;
    }
    if (state === 'ready' || state === 'inspecting') startSolve(mv.issuedAt);
    moveCount++;
  }
  mv.seq = moveCount;
  if (record) history.push(mv);
  log.push(mv.name);
  if (log.length > 60) log.shift();
  queue.push(mv);
  refreshUI();
}

function undo() {
  const last = history.pop();
  if (last) doMove(inverseMove(last), { record: false });
}

function onMoveFinished(mv) {
  if (mv.silent) return;
  if (state === 'solving' && !mv.rotation && isSolved()) finishSolve(mv);
}

function startSolve(at) {
  solveStart = at;
  state = 'solving';
  refreshUI();
}

function finishSolve(mv) {
  finalTime = Math.max(0, mv.issuedAt - solveStart);
  finalMoves = mv.seq;
  state = 'solved';
  const prevBest = bestTime();
  solves.push({ t: Math.round(finalTime), m: finalMoves, d: Date.now(), s: scrambleText });
  if (solves.length > 500) solves = solves.slice(-500);
  store.set(SOLVES_KEY, solves);
  renderStats();
  refreshUI();
  showResult(prevBest === null || finalTime < prevBest);
}

function resetCubeModel() {
  for (const c of cubies) {
    c.position.copy(c.userData.home);
    c.quaternion.identity();
    c.scale.set(1, 1, 1);
  }
  cubeGroup.updateMatrixWorld(true);
}

function genScramble(length = 21) {
  const faces = 'RLUDFB';
  const axisOf = { R: 'x', L: 'x', U: 'y', D: 'y', F: 'z', B: 'z' };
  const out = [];
  while (out.length < length) {
    const f = faces[Math.floor(Math.random() * 6)];
    const a = out[out.length - 1];
    const b = out[out.length - 2];
    if (a && a[0] === f) continue;
    if (a && b && axisOf[a[0]] === axisOf[f] && axisOf[b[0]] === axisOf[f]) continue;
    out.push(f + ['', "'", '2'][Math.floor(Math.random() * 3)]);
  }
  return out;
}

function newScramble() {
  flush();
  closeOverlays();
  resetCubeModel();
  let seq;
  do {
    seq = genScramble();
    resetCubeModel();
    for (const s of seq) queue.push({ ...parseMove(s), silent: true });
    flush();
  } while (isSolved());
  scrambleText = seq.join(' ');
  history = [];
  log = [];
  moveCount = 0;
  finalTime = 0;
  if (settings.inspection) {
    inspectStart = performance.now();
    state = 'inspecting';
  } else {
    state = 'ready';
  }
  refreshUI();
}

function resetAll() {
  flush();
  closeOverlays();
  resetCubeModel();
  history = [];
  log = [];
  moveCount = 0;
  scrambleText = '';
  finalTime = 0;
  state = 'free';
  refreshUI();
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */
const ui = { timer: $('timer'), status: $('status'), meta: $('meta'), scramble: $('scramble'), moveLog: $('moveLog') };

function fmt(ms) {
  const cs = Math.floor(ms / 10);
  const c = cs % 100;
  const s = Math.floor(cs / 100) % 60;
  const m = Math.floor(cs / 6000);
  const cc = String(c).padStart(2, '0');
  return m ? `${m}:${String(s).padStart(2, '0')}.${cc}` : `${s}.${cc}`;
}

const START_HINT = isTouch ? 'tap <b>Scramble</b>' : 'press <kbd>Space</kbd>';
const STATUS = {
  free: `Free play · ${START_HINT} to scramble`,
  ready: 'Scrambled · the timer starts on your first turn',
  inspecting: 'Inspection · the timer starts on your first turn',
  solving: 'Solving…',
  solved: `Solved! ${isTouch ? 'Tap <b>Scramble</b>' : 'Press <kbd>Space</kbd>'} for the next one`,
};

let lastTimerText = '';
let lastTimerClass = '';
function updateTimer(now) {
  let text;
  let cls;
  if (state === 'inspecting') {
    const left = 15 - (now - inspectStart) / 1000;
    if (left <= 0) {
      startSolve(inspectStart + 15000);
      return updateTimer(now);
    }
    text = String(Math.ceil(left));
    cls = 'inspect';
  } else if (state === 'solving') {
    text = fmt(Math.max(0, now - solveStart));
    cls = 'running';
  } else if (state === 'solved') {
    text = fmt(finalTime);
    cls = 'done';
  } else {
    text = '0.00';
    cls = 'idle';
  }
  if (text !== lastTimerText) {
    ui.timer.textContent = text;
    lastTimerText = text;
  }
  if (cls !== lastTimerClass) {
    ui.timer.className = 'timer ' + cls;
    lastTimerClass = cls;
  }
}

let lastMeta = '';
function updateMeta(now) {
  let text = `Moves ${state === 'solved' ? finalMoves : moveCount}`;
  if (state === 'solving') {
    const secs = (now - solveStart) / 1000;
    if (secs > 0.5) text += ` · ${(moveCount / secs).toFixed(2)} TPS`;
  } else if (state === 'solved' && finalTime > 0) {
    text += ` · ${(finalMoves / (finalTime / 1000)).toFixed(2)} TPS`;
  }
  if (text !== lastMeta) {
    ui.meta.textContent = text;
    lastMeta = text;
  }
}

function refreshUI() {
  ui.status.innerHTML = STATUS[state];
  ui.scramble.innerHTML = `<span class="lbl">Scramble</span>${scrambleText || '—'}`;
  ui.moveLog.textContent = log.slice(-16).join(' ');
  $('btnUndo').disabled = history.length === 0;
  updateMeta(performance.now());
}

function bestTime() {
  return solves.length ? Math.min(...solves.map((s) => s.t)) : null;
}
function averageOf(n) {
  if (solves.length < n) return null;
  const times = solves.slice(-n).map((s) => s.t).sort((a, b) => a - b);
  times.shift();
  times.pop();
  return times.reduce((a, b) => a + b, 0) / times.length;
}
function renderStats() {
  const best = bestTime();
  const ao5 = averageOf(5);
  const ao12 = averageOf(12);
  $('stBest').textContent = best === null ? '–' : fmt(best);
  $('stAo5').textContent = ao5 === null ? '–' : fmt(ao5);
  $('stAo12').textContent = ao12 === null ? '–' : fmt(ao12);
  $('stCount').textContent = String(solves.length);
  const recent = solves.slice(-12).reverse();
  $('recent').innerHTML = recent.length
    ? recent
        .map((s, i) => `<li><span class="n">${solves.length - i}.</span><span class="t">${fmt(s.t)}</span><span class="m">${s.m} moves</span></li>`)
        .join('')
    : '<li class="empty">No solves yet</li>';
}

function showResult(isPB) {
  $('resTime').textContent = fmt(finalTime);
  const tps = finalTime > 0 ? (finalMoves / (finalTime / 1000)).toFixed(2) : '–';
  $('resMeta').textContent = `${finalMoves} moves · ${tps} turns per second`;
  $('pbBadge').hidden = !isPB;
  closeOverlays();
  $('result').classList.add('open');
  confetti();
}

function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f4f4f4', '#ffd500', '#009e60', '#0051ba', '#c41e3a', '#ff5800'];
  const box = document.createElement('div');
  box.className = 'confetti';
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.35 + 's';
    p.style.animationDuration = 1.6 + Math.random() * 1.4 + 's';
    p.style.setProperty('--dx', (Math.random() * 2 - 1) * 140 + 'px');
    p.style.setProperty('--rot', Math.random() * 900 + 'deg');
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3600);
}

/* ------------------------------------------------------------------ */
/* Mouse / touch                                                       */
/* ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function pick(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  if (!hits.length) return null;
  const h = hits[0];
  const cubie = h.object.parent;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  const axis = dominantAxis(n);
  const sign = Math.sign(n[axis]);
  if (Math.round(cubie.position[axis]) !== sign) return null; // not an outer face
  const normal = new THREE.Vector3();
  normal[axis] = sign;
  return { cubie, point: h.point.clone(), normal };
}

function toScreen(v) {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
}

function turnFromDrag(hit, dx, dy) {
  const len = Math.hypot(dx, dy);
  const p0 = toScreen(hit.point);
  let best = null;
  for (const name of ['x', 'y', 'z']) {
    const t = AXES[name];
    if (Math.abs(t.dot(hit.normal)) > 0.5) continue;
    const p1 = toScreen(hit.point.clone().addScaledVector(t, 0.5));
    const sx = p1.x - p0.x;
    const sy = p1.y - p0.y;
    const sl = Math.hypot(sx, sy) || 1;
    const d = (sx * dx + sy * dy) / (sl * len);
    if (!best || Math.abs(d) > Math.abs(best.d)) best = { t, d };
  }
  // A positive rotation about (normal × t) moves the touched sticker along +t.
  const axisVec = new THREE.Vector3().crossVectors(hit.normal, best.t);
  const axis = dominantAxis(axisVec);
  let sign = best.d > 0 ? 1 : -1;
  if (axisVec[axis] < 0) sign = -sign;
  const layer = Math.round(hit.cubie.position[axis]);
  doMove(moveFromAxis(axis, layer, sign));
}

function rotateFromDrag(x0, dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) {
    doMove(dx < 0 ? 'y' : "y'");
    return;
  }
  const centerX = toScreen(new THREE.Vector3()).x;
  if (x0 < centerX) doMove(dy < 0 ? 'x' : "x'");
  else doMove(dy < 0 ? "z'" : 'z');
}

const DRAG_PX = { mouse: 6, pen: 8, touch: 12 };
let drag = null;

canvas.addEventListener('pointerdown', (e) => {
  if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  closePopover();
  flush();
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, hit: pick(e.clientX, e.clientY), used: false };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.used || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) < (DRAG_PX[drag.type] || 8)) return;
  drag.used = true;
  if (drag.hit) turnFromDrag(drag.hit, dx, dy);
  else rotateFromDrag(drag.x, dx, dy);
});

const endDrag = (e) => {
  if (drag && e.pointerId === drag.id) {
    drag = null;
    canvas.classList.remove('dragging');
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */
// Physical key positions (event.code), so it works with any input language (e.g. Korean IME).
const SPEED_KEYS = {
  KeyI: 'R', KeyK: "R'", KeyD: 'L', KeyE: "L'",
  KeyJ: 'U', KeyF: "U'", KeyS: 'D', KeyL: "D'",
  KeyH: 'F', KeyG: "F'", KeyW: 'B', KeyO: "B'",
  KeyU: 'r', KeyM: "r'", KeyV: 'l', KeyR: "l'",
  KeyT: 'x', KeyY: 'x', KeyB: "x'", KeyN: "x'",
  Semicolon: 'y', KeyA: "y'", KeyP: 'z', KeyQ: "z'",
  Digit5: 'M', Digit6: 'M', KeyX: "M'", Period: "M'",
  KeyZ: 'd', Slash: "d'", Comma: 'u', KeyC: "u'",
};
const NOTATION_KEYS = {
  KeyR: 'R', KeyL: 'L', KeyU: 'U', KeyD: 'D', KeyF: 'F', KeyB: 'B',
  KeyM: 'M', KeyE: 'E', KeyS: 'S', KeyX: 'x', KeyY: 'y', KeyZ: 'z',
};
const ARROW_KEYS = { ArrowLeft: 'y', ArrowRight: "y'", ArrowUp: 'x', ArrowDown: "x'" };

window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if (e.code === 'Escape') e.target.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ' && !e.repeat) {
      e.preventDefault();
      undo();
    }
    return;
  }
  if (e.altKey) return;

  if (e.code === 'Escape') {
    e.preventDefault();
    if (document.querySelector('.backdrop.open') || $('settings').classList.contains('open')) closeOverlays();
    else resetAll();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) newScramble();
    return;
  }
  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
    e.preventDefault();
    if (!e.repeat) toggleKeys();
    return;
  }
  if (e.code === 'Backspace') {
    e.preventDefault();
    if (!e.repeat) undo();
    return;
  }

  let mv = ARROW_KEYS[e.code];
  if (!mv) {
    if (settings.layout === 'speed') {
      mv = SPEED_KEYS[e.code];
    } else {
      const base = NOTATION_KEYS[e.code];
      if (base) mv = base + (e.shiftKey ? "'" : '');
    }
  }
  if (!mv) return;
  e.preventDefault();
  if (e.repeat) return;
  $('welcome').classList.remove('open');
  $('result').classList.remove('open');
  doMove(mv);
});

/* ------------------------------------------------------------------ */
/* Overlays, settings, buttons                                         */
/* ------------------------------------------------------------------ */
const KB_ROWS = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];
const KB_OFFSETS = [0, 0.5, 0.75, 1.25];
const PUNCT = { Semicolon: ';', Comma: ',', Period: '.', Slash: '/' };
const keyLabel = (code) => (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : PUNCT[code]);
const moveClass = (mv) => {
  const b = mv[0];
  if ('xyz'.includes(b)) return 'rot';
  if ('MES'.includes(b)) return 'slice';
  return 'f-' + b.toUpperCase();
};

function renderKeymap() {
  const speed = settings.layout === 'speed';
  const map = speed ? SPEED_KEYS : NOTATION_KEYS;
  let html = `<p class="note">Layout: <b>${speed ? 'Speedcuber (two-handed)' : 'Notation'}</b>. Change it in Settings.</p>`;
  html += '<div class="kb">';
  KB_ROWS.forEach((row, i) => {
    html += `<div class="kb-row" style="--off:${KB_OFFSETS[i]}">`;
    for (const code of row) {
      const mv = map[code];
      html += `<div class="key${mv ? ' on ' + moveClass(mv) : ''}"><span class="k">${keyLabel(code)}</span><span class="mv">${mv || ''}</span></div>`;
    }
    html += '</div>';
  });
  html += '</div>';
  html += speed
    ? '<p class="note">Right hand: <kbd>I</kbd> R, <kbd>J</kbd> U, <kbd>H</kbd> F, <kbd>K</kbd> R′, <kbd>L</kbd> D′, <kbd>O</kbd> B′. Left hand: <kbd>F</kbd> U′, <kbd>G</kbd> F′, <kbd>D</kbd> L, <kbd>E</kbd> L′, <kbd>S</kbd> D, <kbd>W</kbd> B. Lower-case letters are wide turns (r = Rw); x, y, z rotate the whole cube.</p>'
    : '<p class="note">Press a face letter to turn it clockwise. Hold <kbd>Shift</kbd> for counter-clockwise, e.g. <kbd>Shift</kbd>+<kbd>R</kbd> = R′. x, y, z rotate the whole cube.</p>';
  html += `<table class="globals"><tbody>
    <tr><td><kbd>Space</kbd></td><td>New scramble (timer starts on your first turn)</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Reset to a solved cube / close a window</td></tr>
    <tr><td><kbd>Backspace</kbd> or <kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>Undo the last move</td></tr>
    <tr><td><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd></td><td>Rotate the whole cube (← y, → y′, ↑ x, ↓ x′)</td></tr>
    <tr><td><kbd>?</kbd></td><td>Show or hide this help</td></tr>
  </tbody></table>`;
  $('keymapBody').innerHTML = html;
}

function closePopover() {
  $('settings').classList.remove('open');
  $('btnSettings').setAttribute('aria-expanded', 'false');
}
function closeOverlays() {
  document.querySelectorAll('.backdrop.open').forEach((b) => b.classList.remove('open'));
  closePopover();
}
function toggleKeys() {
  const keys = $('keys');
  const wasOpen = keys.classList.contains('open');
  closeOverlays();
  if (!wasOpen) {
    renderKeymap();
    keys.classList.add('open');
  }
}

document.querySelectorAll('.backdrop').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    if (e.target === b) b.classList.remove('open');
  });
});
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('.backdrop').classList.remove('open'));
});
document.querySelectorAll('[data-open="keys"]').forEach((btn) => btn.addEventListener('click', toggleKeys));
// Buttons should never keep keyboard focus, or Space would also "click" them.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (b) b.blur();
});

$('btnScramble').addEventListener('click', newScramble);
$('btnStart').addEventListener('click', newScramble);
$('btnNext').addEventListener('click', newScramble);
$('btnUndo').addEventListener('click', undo);
$('btnReset').addEventListener('click', resetAll);
$('btnKeys').addEventListener('click', toggleKeys);
$('btnStats').addEventListener('click', () => {
  const panel = $('stats');
  panel.classList.toggle(mobileMQ.matches ? 'expanded' : 'collapsed');
});
$('btnSettings').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('settings').classList.toggle('open');
  $('btnSettings').setAttribute('aria-expanded', String(open));
});
document.addEventListener('pointerdown', (e) => {
  const pop = $('settings');
  if (pop.classList.contains('open') && !pop.contains(e.target) && !$('btnSettings').contains(e.target)) closePopover();
});
$('btnClear').addEventListener('click', () => {
  if (!solves.length) return;
  if (window.confirm('Clear all saved solve times on this device?')) {
    solves = [];
    store.set(SOLVES_KEY, solves);
    renderStats();
  }
});

const speedInput = $('setSpeed');
const layoutInput = $('setLayout');
const inspectInput = $('setInspect');
const soundInput = $('setSound');
const speedLabel = (v) => (Number(v) === 0 ? '(instant)' : `(${v} ms)`);
speedInput.value = settings.speed;
layoutInput.value = settings.layout;
inspectInput.checked = settings.inspection;
soundInput.checked = settings.sound;
$('setSpeedVal').textContent = speedLabel(settings.speed);
speedInput.addEventListener('input', () => {
  settings.speed = Number(speedInput.value);
  $('setSpeedVal').textContent = speedLabel(settings.speed);
  saveSettings();
});
speedInput.addEventListener('change', () => speedInput.blur());
layoutInput.addEventListener('change', () => {
  settings.layout = layoutInput.value;
  saveSettings();
  renderKeymap();
  layoutInput.blur();
});
inspectInput.addEventListener('change', () => {
  settings.inspection = inspectInput.checked;
  saveSettings();
  inspectInput.blur();
});
soundInput.addEventListener('change', () => {
  settings.sound = soundInput.checked;
  saveSettings();
  soundInput.blur();
});

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(80, Math.max(0, now - lastFrame));
  lastFrame = now;
  stepAnimation(dt);
  updateTimer(now);
  updateMeta(now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Small hook for testing from the browser console.
window.cuberush = {
  apply(seq) {
    String(seq).split(/\s+/).filter(Boolean).forEach((m) => doMove(m));
  },
  isSolved,
  flush,
  // colour (as its home face letter) of the sticker facing `face` on the cubie at (x, y, z)
  stickerAt(x, y, z, face) {
    const want = new THREE.Vector3(...FACE_DIRS[face]);
    const c = cubies.find((q) => q.position.distanceTo(new THREE.Vector3(x, y, z)) < 0.1);
    const s = c && c.userData.stickers.find((st) => st.userData.normal.clone().applyQuaternion(c.quaternion).distanceTo(want) < 0.1);
    return s ? s.userData.face : null;
  },
  get log() {
    return log.join(' ');
  },
  scramble: newScramble,
  reset: resetAll,
  get state() {
    return state;
  },
  get moves() {
    return moveCount;
  },
};

renderStats();
renderKeymap();
refreshUI();
$('loading').classList.add('gone');
requestAnimationFrame(frame);
