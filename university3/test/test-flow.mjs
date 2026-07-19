import fs from 'node:fs';
import vm from 'node:vm';
let stage = 'boot';
setTimeout(() => { console.log('WATCHDOG stuck at:', stage); process.exit(9); }, 60000);

const scratch = '/private/tmp/claude-501/-Users-larry-hackthe6project--claude-worktrees-university-hallway-walking-collision-ef254f/63d0550f-16ce-48c9-bf7b-e60eeb946264/scratchpad';
const repo = '/Users/larry/hackthe6project/.claude/worktrees/university-hallway-walking-collision-ef254f/university3/collision';
const realPc = await import('/Users/larry/gta6/node_modules/playcanvas/build/playcanvas.mjs');
let proto = null;
const pc = Object.create(null);
for (const k of Object.keys(realPc)) pc[k] = realPc[k];
pc.createScript = () => { const f = function(){}; f.attributes = { add(){} }; proto = f.prototype; return f; };

const FILES = {
  '298987764': `${repo}/classroom/classroom.voxel.json`,
  '298987765': `${repo}/classroom/classroom.voxel.bin`,
  '298987090': `${repo}/myhal/myhal.voxel.json`,
  '298987091': `${repo}/myhal/myhal.voxel.bin`,
  '298988209': `${repo}/bahen-hallway/bahen-hallway.voxel.json`,
  '298988210': `${repo}/bahen-hallway/bahen-hallway.voxel.bin`,
  '298987673': `${repo}/bahen-front/bahen-front.voxel.json`,
  '298987674': `${repo}/bahen-front/bahen-front.voxel.bin`
};
const fetchStub = async (url) => {
  const m = String(url).match(/\/api\/assets\/(\d+)\//);
  const f = m && FILES[m[1]];
  if (!f) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  const buf = fs.readFileSync(f);
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
  };
};

const mkEl = () => {
  const el = {
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', value: '0', id: '',
    appendChild(c) { this.children.push(c); }, prepend(c) { this.children.unshift(c); },
    addEventListener() {}, removeEventListener() {}, remove() {}, blur() {},
    get lastChild() { return this.children[this.children.length - 1] || null; }
  };
  return el;
};
const sandbox = { console, Math, JSON, Object, Uint8Array, Uint32Array, Float32Array, Infinity,
  atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
  addEventListener(){}, removeEventListener(){}, performance, setTimeout, clearTimeout,
  fetch: fetchStub,
  location: { origin: 'http://test' },
  document: { getElementById: () => null, createElement: mkEl, body: mkEl(), pointerLockElement: null, exitPointerLock() {} },
  pc };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(`${scratch}/voxel-data.js`, 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(`${scratch}/gta6-walk-bundle.js`, 'utf8'), sandbox);

stage = 'script-init';
const script = {
  app: {
    graphicsDevice: { canvas: { addEventListener(){}, removeEventListener(){}, requestPointerLock(){}, clientWidth: 800, clientHeight: 600, width: 800, height: 600 } },
    root: { findByName: () => null, addChild() {} },
    assets: { add() {}, load() {}, find: () => null, get: () => null },
    scene: {}
  },
  entity: { setPosition(){}, setEulerAngles(){}, getPosition: () => sandbox.walk.camera.position, camera: null },
  on() {}
};
Object.setPrototypeOf(script, proto);
script.initialize();
const w = sandbox.walk;
console.log('init: scenes?', !!w.scenes, 'npcs?', !!w.npcs, 'director?', !!w.director);

// pretend npc assets are ready so population logic runs (no models needed)
w.npcs.ready = true;
w.npcs._spawnNpcReal = w.npcs._spawnNpc;
w.npcs._spawnNpc = function () {
  const spot = this._randomFloorSpot();
  if (!spot) return;
  this.npcs.push({ root: { destroy(){}, setPosition(){}, setEulerAngles(){} }, model: null, p: spot,
    state: 'idle', stateTime: 1, hp: 3, hitCooldown: 0, yaw: 0, fit: null, pers: { name: 'T', aggression: 0.5, randomness: 0 },
    canSee: false, percT: 1, lkp: null, lkpTime: 0, shootT: 1, bullets: 30, reloadT: 0, el: null });
};

const step = (n) => { for (let i = 0; i < n; i++) script.update(1/60); };
const settle = async () => {
  for (let i = 0; i < 500; i++) {
    if (!w.scenes._busy && !w.scenes._queued) return;
    await new Promise(r => setTimeout(r, 20));
  }
  console.log('settle timeout!');
};

stage = 'start-game';
w.director._start();
step(10);

const show = (label) => {
  const cam = w.camera.position;
  const col = w.collision;
  console.log(`--- ${label}: player (${cam.x.toFixed(2)}, ${cam.y.toFixed(2)}, ${cam.z.toFixed(2)}) gridMinY ${col.gridMinY.toFixed(2)} numY ${col.numVoxelsY}`);
  const floors = [];
  for (let i = 0; i < 8; i++) {
    const s = w.npcs._randomFloorSpot();
    floors.push(s ? s.y.toFixed(2) : 'null');
  }
  console.log('   spot floors:', floors.join(' '));
  console.log('   npc count:', w.npcs.npcs.length, 'p.y values:', w.npcs.npcs.slice(0,5).map(n => n.p.y.toFixed(2)).join(' '));
};

stage = 'switch-classroom';
await w.scenes.switchTo(3);
await settle();
step(90); // > wave delay
console.log('current scene index:', w.scenes.current);
show('classroom');

stage = 'switch-myhal';
await w.scenes.switchTo(1);
await settle();
step(90);
console.log('current scene index:', w.scenes.current);
show('myhal (from classroom)');

process.exit(0);
