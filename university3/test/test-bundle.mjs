import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// engine build for math classes; override with PLAYCANVAS_MJS if the default is missing
const PC_MJS = process.env.PLAYCANVAS_MJS || '/Users/larry/gta6/node_modules/playcanvas/build/playcanvas.mjs';
const realPc = await import(PC_MJS);

const scratch = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

let proto = null;
const pc = Object.create(null);
for (const k of Object.keys(realPc)) pc[k] = realPc[k];
pc.createScript = () => {
    const f = function () {};
    f.attributes = { add() {} };
    proto = f.prototype;
    return f;
};

const sandbox = {
    console, Math, JSON, Object, Uint8Array, Uint32Array, Float32Array, Infinity,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    document: {
        getElementById: () => null,
        createElement: () => ({ style: {}, appendChild(){} }),
        body: { appendChild(){} },
        pointerLockElement: null
    },
    pc
};
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(`${scratch}/voxel-data.js`, 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(`${scratch}/walk-collision.bundle.js`, 'utf8'), sandbox);

// fake script instance
const entityState = { pos: null, ang: null };
const script = {
    app: {
        graphicsDevice: { canvas: { addEventListener(){}, removeEventListener(){}, requestPointerLock(){} } },
        root: { findByName: () => null, addChild() {} },
        assets: { add() {}, load() {} },
        scene: {}
    },
    entity: {
        setPosition: (x, y, z) => { entityState.pos = [x, y, z]; },
        setEulerAngles: (x, y, z) => { entityState.ang = [x, y, z]; }
    },
    on() {}
};
Object.setPrototypeOf(script, proto);

script.initialize();
const cam = script._walkCamera;
console.log('after spawn:', cam.position.toString(), 'angles', cam.angles.toString());

const dt = 1 / 60;

// settle for 1s
for (let i = 0; i < 60; i++) script.update(dt);
console.log('settled:', cam.position.toString());

// strafe right at spawn for 3s
script._keys.right = true;
for (let i = 0; i < 180; i++) script.update(dt);
script._keys.right = false;
console.log('strafe right from spawn:', cam.position.toString());

// strafe left for 6s (should cross hallway and stop at other wall)
script._keys.left = true;
for (let i = 0; i < 360; i++) script.update(dt);
script._keys.left = false;
console.log('strafe left 6s:', cam.position.toString());

// walk forward 3s
script._keys.forward = true;
for (let i = 0; i < 180; i++) script.update(dt);
script._keys.forward = false;
console.log('forward 3s:', cam.position.toString());

// jump
script._keys.jump = true;
let maxY = -Infinity;
for (let i = 0; i < 90; i++) { script.update(dt); maxY = Math.max(maxY, cam.position.y); }
script._keys.jump = false;
for (let i = 0; i < 60; i++) script.update(dt);
console.log('jump peak y:', maxY.toFixed(2), 'settled back:', cam.position.y.toFixed(2));

// ---- physics + carve tests ----
const balls = script._balls;
const labels = script._labels;
const collision = script._labels.collision;

// ball: drop from mid-hallway air
balls.throwBall({ x: -0.1, y: 1.0, z: -10.9 }, { x: 0, y: 0.3, z: -1 });
let lastBallPos = null;
for (let i = 0; i < 600; i++) {
    balls.step(1/60);
    const bb = balls.balls[0];
    if (!bb) break; // culled after max bounces — fine
    lastBallPos = { x: bb.p.x, y: bb.p.y, z: bb.p.z };
}
console.log('ball (culled after bounces or resting):',
    lastBallPos ? `${lastBallPos.x.toFixed(2)} ${lastBallPos.y.toFixed(2)} ${lastBallPos.z.toFixed(2)}` : 'none',
    '| culled:', balls.balls.length === 0);

// carve: pick a solid voxel near the floor under spawn, mark removed sphere over it
const res = collision.voxelResolution;
const ix = Math.floor((-0.1 - collision.gridMinX) / res);
const iz = Math.floor((-10.9 - collision.gridMinZ) / res);
let solidIy = -1;
for (let iy = 0; iy < collision.numVoxelsY; iy++) {
    if (collision.isVoxelSolid(ix, iy, iz)) { solidIy = iy; break; }
}
const wy = collision.gridMinY + (solidIy + 0.5) * res;
console.log('solid voxel found at iy', solidIy, 'worldY', wy.toFixed(2), 'solid?', collision.isVoxelSolid(ix, solidIy, iz));
labels.markers.push({ center: { x: -0.1, y: wy, z: -10.9 }, radius: 0.5, label: 'test', removed: true });
console.log('after carve, solid?', collision.isVoxelSolid(ix, solidIy, iz), '(expect false)');
labels.markers.length = 0;
console.log('after restore, solid?', collision.isVoxelSolid(ix, solidIy, iz), '(expect true)');
