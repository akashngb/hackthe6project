import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const scratch = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const realPc = await import(process.env.PLAYCANVAS_MJS || '/Users/larry/gta6/node_modules/playcanvas/build/playcanvas.mjs');
let proto = null;
const pc = Object.create(null);
for (const k of Object.keys(realPc)) pc[k] = realPc[k];
pc.createScript = () => { const f = function(){}; f.attributes = { add(){} }; proto = f.prototype; return f; };
const sandbox = { console, Math, JSON, Object, Uint8Array, Uint32Array, Float32Array, Infinity,
  atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
  addEventListener(){}, removeEventListener(){},
  document: { getElementById: () => null, createElement: () => ({ style: {}, appendChild(){}, getContext: () => ({ clearRect(){}, fillRect(){}, strokeRect(){} }) }), body: { appendChild(){} }, pointerLockElement: null },
  performance, setTimeout, clearTimeout, pc };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(`${scratch}/voxel-data.js`, 'utf8'), sandbox);
let src = fs.readFileSync(`${scratch}/walk-collision.bundle.js`, 'utf8');
src = src.replace(/\}\)\(\);\s*$/, '  window.UNI3_DEBUG = { VoxelCollision, findCylinderSpawn };\n})();');
vm.runInContext(src, sandbox);
const script = { app: { graphicsDevice: { canvas: { addEventListener(){}, removeEventListener(){}, requestPointerLock(){} } }, root: { findByName: () => null, addChild(){} }, assets: { add(){}, load(){}, find: () => null }, scene: {} }, entity: { setPosition(){}, setEulerAngles(){}, getPosition: () => new pc.Vec3(-0.1, 0.75, -10.9) }, on(){} };
Object.setPrototypeOf(script, proto);
script.initialize();
const balls = script._balls;
const col = script._labels.collision;
let escapes = 0;
for (let trial = 0; trial < 40; trial++) {
    balls.clear();
    const yaw = Math.random() * Math.PI * 2;
    const pitch = (Math.random() - 0.5) * 1.5;
    const dir = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
    balls.throwBall({ x: -0.1 + (Math.random()-0.5), y: 0.2 + Math.random(), z: -10.9 + (Math.random()-0.5)*4 }, dir, 16, 0.055);
    let worst = null;
    for (let i = 0; i < 240; i++) {
        balls.step(1/30); // 30fps worst-case dt
        const b = balls.balls[0];
        if (!b) break; // culled after max bounces — contained by definition
        worst = { x: b.p.x, y: b.p.y, z: b.p.z };
        const inX = b.p.x > col.gridMinX - 0.3 && b.p.x < col.gridMinX + col.numVoxelsX * 0.05 + 0.3;
        const inY = b.p.y > col.gridMinY - 0.3;
        const inZ = b.p.z > col.gridMinZ - 0.3 && b.p.z < col.gridMinZ + col.numVoxelsZ * 0.05 + 0.3;
        if (!(inX && inY && inZ)) { escapes++; console.log('escape at', b.p.x.toFixed(2), b.p.y.toFixed(2), b.p.z.toFixed(2)); break; }
    }
}
console.log(escapes === 0 ? 'ALL 40 BALLS CONTAINED ✓' : `${escapes}/40 escaped`);
