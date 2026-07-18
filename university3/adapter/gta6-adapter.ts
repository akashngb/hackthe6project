// Editor adapter around gta6's exact WalkController + VoxelCollision.
// Registers the classic script 'walkCollision' (same name the Camera entity
// already references). Voxel data comes from window.UNI3_VOXEL (voxel-data.js).

import { WalkController } from './vendor/cameras/walk-controller';
import { Camera as WalkCamera } from './vendor/cameras/camera';
import { VoxelCollision } from './vendor/collision/voxel-collision';

const pc: any = (globalThis as any).pc;

/** Keyboard move input scale (matches gta6 main.ts) */
const MOVE_SPEED = 4;
const RUN_MULTIPLIER = 2;
const LOOK_SENSITIVITY = 0.15;

/** Minimal stand-in for the engine InputFrame when unavailable. */
class SimpleInputFrame {
    deltas: any = {};

    constructor(shape: Record<string, number[]>) {
        for (const k of Object.keys(shape)) {
            const value = shape[k].map(() => 0);
            this.deltas[k] = {
                value,
                append(a: number[]) {
                    for (let i = 0; i < a.length; i++) value[i] += a[i];
                }
            };
        }
    }

    read() {
        const out: any = {};
        for (const k of Object.keys(this.deltas)) {
            out[k] = this.deltas[k].value.slice();
            this.deltas[k].value.fill(0);
        }
        return out;
    }
}

// ---- physics playground: bouncy balls colliding with the splat's voxel world ----

const BALL_RADIUS = 0.12;
const BALL_RESTITUTION = 0.55;
const BALL_FRICTION = 0.985;
const BALL_GRAVITY = 9.8;
const MAX_BALLS = 48;
const THROW_SPEED = 8;

class BallPhysics {
    app: any;
    collision: any;
    balls: any[] = [];
    obstacles: any[] = [];
    _push = { x: 0, y: 0, z: 0 };

    constructor(app: any, collision: any) {
        this.app = app;
        this.collision = collision;
    }

    throwBall(origin: any, dir: { x: number; y: number; z: number }) {
        if (this.balls.length >= MAX_BALLS) {
            const oldest = this.balls.shift();
            if (oldest.entity) oldest.entity.destroy();
        }
        let e: any = null;
        try {
            e = new pc.Entity('ball');
            e.addComponent('render', { type: 'sphere' });
            const mat = new pc.StandardMaterial();
            const h = Math.random();
            mat.diffuse.set(0.4 + 0.6 * Math.abs(Math.sin(h * 12.9)), 0.4 + 0.6 * Math.abs(Math.sin(h * 78.2 + 2)), 0.4 + 0.6 * Math.abs(Math.sin(h * 39.4 + 4)));
            mat.update();
            e.render.meshInstances[0].material = mat;
            e.setLocalScale(BALL_RADIUS * 2, BALL_RADIUS * 2, BALL_RADIUS * 2);
            e.setPosition(origin.x + dir.x * 0.4, origin.y + dir.y * 0.4, origin.z + dir.z * 0.4);
            this.app.root.addChild(e);
        } catch (err) {
            e = null; // headless (tests): simulate without visuals
        }

        this.balls.push({
            entity: e,
            p: { x: origin.x + dir.x * 0.4, y: origin.y + dir.y * 0.4, z: origin.z + dir.z * 0.4 },
            v: { x: dir.x * THROW_SPEED, y: dir.y * THROW_SPEED, z: dir.z * THROW_SPEED }
        });
    }

    clear() {
        for (const b of this.balls) {
            if (b.entity) b.entity.destroy();
        }
        this.balls.length = 0;
    }

    step(dt: number) {
        const col = this.collision;
        const push = this._push;
        const balls = this.balls;

        for (const b of balls) {
            b.v.y -= BALL_GRAVITY * dt;
            b.p.x += b.v.x * dt;
            b.p.y += b.v.y * dt;
            b.p.z += b.v.z * dt;

            if (col.querySphere(b.p.x, b.p.y, b.p.z, BALL_RADIUS, push)) {
                b.p.x += push.x; b.p.y += push.y; b.p.z += push.z;
                const len = Math.sqrt(push.x * push.x + push.y * push.y + push.z * push.z);
                if (len > 1e-9) {
                    const nx = push.x / len, ny = push.y / len, nz = push.z / len;
                    const vn = b.v.x * nx + b.v.y * ny + b.v.z * nz;
                    if (vn < 0) {
                        // reflect normal component, damp tangential (friction)
                        b.v.x -= (1 + BALL_RESTITUTION) * vn * nx;
                        b.v.y -= (1 + BALL_RESTITUTION) * vn * ny;
                        b.v.z -= (1 + BALL_RESTITUTION) * vn * nz;
                        b.v.x *= BALL_FRICTION; b.v.y *= BALL_FRICTION; b.v.z *= BALL_FRICTION;
                    }
                    // rest condition: slow and supported from below
                    if (ny > 0.5 && Math.abs(b.v.y) < 0.3 && (b.v.x * b.v.x + b.v.z * b.v.z) < 0.04) {
                        b.v.y = 0;
                    }
                }
            }

            // fell out of the world: recycle above spawn
            if (b.p.y < col.gridMinY - 10) {
                b.v.x = b.v.y = b.v.z = 0;
                b.p.y = col.gridMinY + col.numVoxelsY * col.voxelResolution * 0.5;
            }
        }

        // static cylinder obstacles (props)
        for (const o of this.obstacles) {
            for (const b of balls) {
                if (b.p.y < o.minY - BALL_RADIUS || b.p.y > o.maxY + BALL_RADIUS) continue;
                const dx = b.p.x - o.x, dz = b.p.z - o.z;
                const d2 = dx * dx + dz * dz;
                const minD = o.radius + BALL_RADIUS;
                if (d2 > 1e-12 && d2 < minD * minD) {
                    const d = Math.sqrt(d2);
                    const nx = dx / d, nz = dz / d;
                    b.p.x = o.x + nx * minD;
                    b.p.z = o.z + nz * minD;
                    const vn = b.v.x * nx + b.v.z * nz;
                    if (vn < 0) {
                        b.v.x -= (1 + BALL_RESTITUTION) * vn * nx;
                        b.v.z -= (1 + BALL_RESTITUTION) * vn * nz;
                    }
                }
            }
        }

        // ball-ball elastic collision
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                const a = balls[i], c = balls[j];
                const dx = c.p.x - a.p.x, dy = c.p.y - a.p.y, dz = c.p.z - a.p.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                const minD = BALL_RADIUS * 2;
                if (d2 > 1e-12 && d2 < minD * minD) {
                    const d = Math.sqrt(d2);
                    const nx = dx / d, ny = dy / d, nz = dz / d;
                    const overlap = (minD - d) * 0.5;
                    a.p.x -= nx * overlap; a.p.y -= ny * overlap; a.p.z -= nz * overlap;
                    c.p.x += nx * overlap; c.p.y += ny * overlap; c.p.z += nz * overlap;
                    const rvx = c.v.x - a.v.x, rvy = c.v.y - a.v.y, rvz = c.v.z - a.v.z;
                    const vn = rvx * nx + rvy * ny + rvz * nz;
                    if (vn < 0) {
                        const imp = -(1 + BALL_RESTITUTION) * vn * 0.5;
                        a.v.x -= imp * nx; a.v.y -= imp * ny; a.v.z -= imp * nz;
                        c.v.x += imp * nx; c.v.y += imp * ny; c.v.z += imp * nz;
                    }
                }
            }
        }

        for (const b of balls) {
            if (b.entity) b.entity.setPosition(b.p.x, b.p.y, b.p.z);
        }
    }
}

// ---- soldier NPCs: wander the hallway, animated, killed by thrown balls ----

const NPC_ASSET_IDS: Record<string, [number, string]> = {
    model: [298980993, 'npc-soldier2.glb'],
    idle: [298980995, 'npc-idle.glb'],
    walk: [298980998, 'npc-walk-forward.glb'],
    run: [298980999, 'npc-run-forward.glb'],
    deathFront: [298981004, 'npc-death-from-the-front.glb'],
    deathBack: [298981007, 'npc-death-from-the-back.glb'],
    gun: [298983884, 'npc-m16.glb'],
    flash: [298983886, 'npc-muzzle-flash.glb']
};

/** m16 attachment recipe from the original FPS project */
const GUN_LOCAL_POS: [number, number, number] = [-0.01, 0.1, 0.01];
const GUN_LOCAL_EULER: [number, number, number] = [160, 0, 105];
const GUN_LOCAL_SCALE = 50;
const FLASH_LOCAL_POS: [number, number, number] = [0.9191, 0.1532, -0.0064];
const FLASH_LOCAL_SCALE = 100;

const NPC_COUNT = 3;
const NPC_HP = 3;
const NPC_HEIGHT = 1.7;
const NPC_RADIUS = 0.3;
const NPC_WALK_SPEED = 1.1;
const NPC_HIT_COOLDOWN = 0.35;
const NPC_CORPSE_TIME = 6;
const NPC_MIN_BALL_SPEED = 2;

class NpcSystem {
    app: any;
    collision: any;
    cameraEntity: any;
    npcs: any[] = [];
    assets: any = {};
    ready = false;
    failed = false;
    npcHeight = NPC_HEIGHT;
    npcRadius = NPC_RADIUS;
    _push = { x: 0, y: 0, z: 0 };
    _screenPos: any;

    constructor(app: any, collision: any, cameraEntity: any) {
        this.app = app;
        this.collision = collision;
        this.cameraEntity = cameraEntity;
        this._screenPos = new pc.Vec3();
        this._loadAssets();
    }

    _branchQuery() {
        try {
            const cfg = (window as any).config;
            const bid = (cfg && (cfg.self?.branch?.id || cfg.self?.branchId)) || '87d9f884-5657-4343-887e-e823e912488f';
            return `?branchId=${bid}`;
        } catch (e) {
            return '';
        }
    }

    _loadAssets() {
        const names = Object.keys(NPC_ASSET_IDS);
        let remaining = names.length;
        const q = this._branchQuery();

        for (const key of names) {
            const [id, fname] = NPC_ASSET_IDS[key];
            const url = `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
            const asset = new pc.Asset(fname, 'container', { url, filename: fname });
            asset.on('load', () => {
                this.assets[key] = asset;
                if (--remaining === 0) this._onAssetsReady();
            });
            asset.on('error', (err: string) => {
                console.error('npc asset failed:', fname, err);
                this.failed = true;
            });
            this.app.assets.add(asset);
            this.app.assets.load(asset);
        }
    }

    _measureModel(model: any) {
        let min: any = null, max: any = null;
        const rs = model.findComponents('render');
        for (const r of rs) {
            for (const mi of r.meshInstances) {
                const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
                if (!min) {
                    min = { x: mn.x, y: mn.y, z: mn.z };
                    max = { x: mx.x, y: mx.y, z: mx.z };
                } else {
                    min.x = Math.min(min.x, mn.x); min.y = Math.min(min.y, mn.y); min.z = Math.min(min.z, mn.z);
                    max.x = Math.max(max.x, mx.x); max.y = Math.max(max.y, mx.y); max.z = Math.max(max.z, mx.z);
                }
            }
        }
        if (!min) return null;
        return { minY: min.y, ext: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } };
    }

    _track(key: string) {
        const c = this.assets[key];
        const animAssets = c && c.resource ? c.resource.animations : null;
        return animAssets && animAssets.length ? animAssets[0].resource : null;
    }

    _measureHallway() {
        const col = this.collision;
        const res = col.voxelResolution;
        const midY = col.gridMinY + col.numVoxelsY * res * 0.5;
        const gMaxX = col.gridMinX + col.numVoxelsX * res;
        const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;
        const clearances: number[] = [];
        for (let i = 0; i < 60 && clearances.length < 25; i++) {
            const x = col.gridMinX + 0.5 + Math.random() * (gMaxX - col.gridMinX - 1);
            const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
            const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
            const up = col.queryRay(x, midY, z, 0, 1, 0, 30);
            if (down && up) clearances.push(up.y - down.y);
        }
        if (clearances.length >= 5) {
            clearances.sort((a, b) => a - b);
            const median = clearances[Math.floor(clearances.length / 2)];
            // people are roughly 2/3 of corridor height
            this.npcHeight = Math.max(0.5, Math.min(2.2, median * 0.55));
            this.npcRadius = this.npcHeight * 0.18;
            console.log('npcSystem: corridor clearance', median.toFixed(2), '→ soldier height', this.npcHeight.toFixed(2));
        }
    }

    _onAssetsReady() {
        try {
            this._measureHallway();
            for (let i = 0; i < NPC_COUNT; i++) this._spawnNpc(i);
            this.ready = true;
            console.log('npcSystem: spawned', this.npcs.length, 'soldiers');
        } catch (e) {
            console.error('npcSystem spawn failed', e);
            this.failed = true;
        }
    }

    _randomFloorSpot() {
        const col = this.collision;
        const res = col.voxelResolution;
        const gMaxX = col.gridMinX + col.numVoxelsX * res;
        const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;
        const midY = col.gridMinY + col.numVoxelsY * res * 0.5;

        for (let attempt = 0; attempt < 80; attempt++) {
            const x = col.gridMinX + 0.5 + Math.random() * (gMaxX - col.gridMinX - 1);
            const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
            const down = col.queryRay(x, midY, z, 0, -1, 0, 20);
            if (!down) continue;
            const floor = down.y;
            // need standing headroom and free space at torso
            const up = col.queryRay(x, floor + 0.2, z, 0, 1, 0, 20);
            if (up && up.y - floor < this.npcHeight + 0.1) continue;
            if (!col.isFreeAt(x, floor + 0.9, z)) continue;
            return { x, y: floor, z };
        }
        return null;
    }

    _spawnNpc(seed: number) {
        const spot = this._randomFloorSpot();
        if (!spot) return;

        const root = new pc.Entity('npc');
        const model = this.assets.model.resource.instantiateRenderEntity();
        root.addChild(model);
        this.app.root.addChild(root);

        // scale is applied one frame later, once the skinned mesh has a real AABB
        // mixamo rigs face +Z; PlayCanvas forward is -Z
        model.setLocalEulerAngles(0, 180, 0);

        model.addComponent('anim', { activate: true });
        const idle = this._track('idle');
        const walk = this._track('walk');
        const deathF = this._track('deathFront');
        const deathB = this._track('deathBack');
        if (idle) model.anim.assignAnimation('Idle', idle);
        if (walk) model.anim.assignAnimation('Walk', walk);
        if (deathF) model.anim.assignAnimation('DeathF', deathF, undefined, 1, false);
        if (deathB) model.anim.assignAnimation('DeathB', deathB, undefined, 1, false);

        root.setPosition(spot.x, spot.y, spot.z);

        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;transform:translate(-50%,-100%);z-index:9997;color:#fff;background:rgba(30,30,30,0.75);font:11px monospace;padding:1px 7px;border-radius:9px;pointer-events:none;white-space:nowrap;';
        document.body.appendChild(el);

        const npc = {
            root, model,
            p: { x: spot.x, y: spot.y, z: spot.z },
            target: null as any,
            state: 'idle',           // idle | walk | dying | dead
            stateTime: 1 + Math.random() * 3,
            hp: NPC_HP,
            hitCooldown: 0,
            yaw: Math.random() * 360,
            fit: { phase: 'orient', wait: 3, idx: 0, results: [] as number[] },
            el
        };
        this._setAnim(npc, 'Idle');
        this._syncTag(npc);
        this.npcs.push(npc);
    }

    _setAnim(npc: any, stateName: string) {
        try {
            const anim = npc.model.anim;
            if (anim && anim.baseLayer && npc._animState !== stateName) {
                anim.baseLayer.transition(stateName, 0.2);
                npc._animState = stateName;
            }
        } catch (e) { /* anim not ready */ }
    }

    _syncTag(npc: any) {
        if (!npc.el) return;
        if (npc.state === 'dying' || npc.state === 'dead') {
            npc.el.textContent = 'soldier ☠';
            npc.el.style.background = 'rgba(120,20,20,0.8)';
        } else {
            npc.el.textContent = `soldier ${'♥'.repeat(npc.hp)}`;
            npc.el.style.background = 'rgba(30,30,30,0.75)';
        }
    }

    _pickTarget(npc: any) {
        const spot = this._randomFloorSpot();
        if (spot) {
            npc.target = spot;
            npc.state = 'walk';
            this._setAnim(npc, 'Walk');
        } else {
            npc.state = 'idle';
            npc.stateTime = 2;
        }
    }

    hitTest(ball: any, dt: number) {
        if (!this.ready) return;
        const speedSq = ball.v.x * ball.v.x + ball.v.y * ball.v.y + ball.v.z * ball.v.z;
        if (speedSq < NPC_MIN_BALL_SPEED * NPC_MIN_BALL_SPEED) return;

        for (const npc of this.npcs) {
            if (npc.state === 'dying' || npc.state === 'dead' || npc.hitCooldown > 0) continue;
            const dx = ball.p.x - npc.p.x;
            const dz = ball.p.z - npc.p.z;
            const dy = ball.p.y - (npc.p.y + this.npcHeight * 0.5);
            const xz = Math.sqrt(dx * dx + dz * dz);
            const withinY = Math.abs(dy) < this.npcHeight * 0.5 + BALL_RADIUS;
            if (xz < this.npcRadius + BALL_RADIUS && withinY) {
                npc.hp--;
                npc.hitCooldown = NPC_HIT_COOLDOWN;
                // bounce the ball back off the soldier
                const nx = xz > 1e-6 ? dx / xz : 1, nz = xz > 1e-6 ? dz / xz : 0;
                const vn = ball.v.x * nx + ball.v.z * nz;
                if (vn < 0) {
                    ball.v.x -= 1.6 * vn * nx;
                    ball.v.z -= 1.6 * vn * nz;
                }
                if (npc.hp <= 0) {
                    npc.state = 'dying';
                    npc.stateTime = NPC_CORPSE_TIME;
                    // die away from the incoming ball: hit from front → fall back
                    const camFwd = { x: -nx, z: -nz };
                    const facing = { x: -Math.sin(npc.yaw * Math.PI / 180), z: -Math.cos(npc.yaw * Math.PI / 180) };
                    const frontal = camFwd.x * facing.x + camFwd.z * facing.z < 0;
                    this._setAnim(npc, frontal ? 'DeathB' : 'DeathF');
                }
                this._syncTag(npc);
            }
        }
    }

    /** world-space Y of a skeleton bone whose name contains `part` */
    _boneY(model: any, part: string): number | null {
        const stack = [model];
        while (stack.length) {
            const n = stack.pop();
            if (n.name && n.name.indexOf(part) !== -1) return n.getPosition().y;
            const ch = n.children;
            for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
        }
        return null;
    }

    _fitStep(npc: any) {
        const CANDS = [[0, 180, 0], [-90, 180, 0], [90, 180, 0], [180, 180, 0], [180, 0, 0]];
        const fit = npc.fit;
        if (fit.wait > 0) { fit.wait--; return; }
        const m = this._measureModel(npc.model);
        if (!m || !isFinite(m.ext.y) || m.ext.y <= 0.01) { fit.wait = 3; return; }

        if (fit.phase === 'orient') {
            // upright means the head bone sits above the hips bone
            const headY = this._boneY(npc.model, 'Head');
            const hipsY = this._boneY(npc.model, 'Hips');
            const upright = headY !== null && hipsY !== null ? headY - hipsY : 0;
            fit.results.push({ yExt: m.ext.y, upright });
            fit.idx++;
            if (fit.idx < CANDS.length) {
                const c = CANDS[fit.idx];
                npc.model.setLocalEulerAngles(c[0], c[1], c[2]);
                fit.wait = 2;
            } else {
                // among candidates with head above hips, pick the tallest;
                // fall back to tallest overall
                let best = -1;
                for (let i = 0; i < fit.results.length; i++) {
                    const r = fit.results[i];
                    if (r.upright > 0 && (best < 0 || r.yExt > fit.results[best].yExt)) best = i;
                }
                if (best < 0) {
                    best = 0;
                    for (let i = 1; i < fit.results.length; i++) {
                        if (fit.results[i].yExt > fit.results[best].yExt) best = i;
                    }
                }
                const c = CANDS[best];
                npc.model.setLocalEulerAngles(c[0], c[1], c[2]);
                console.log('npcSystem: orientation', JSON.stringify(c), 'candidates',
                    fit.results.map((r: any) => `${r.yExt.toFixed(2)}${r.upright > 0 ? '↑' : '↓'}`).join('/'));
                fit.phase = 'scale';
                fit.wait = 2;
            }
        } else if (fit.phase === 'scale') {
            const cur = npc.model.getLocalScale().x;
            const scale = cur * (this.npcHeight / m.ext.y);
            npc.model.setLocalScale(scale, scale, scale);
            console.log('npcSystem: model height', m.ext.y.toFixed(2), '→ scale', scale.toFixed(4));
            fit.phase = 'ground';
            fit.wait = 2;
        } else if (fit.phase === 'ground') {
            const lp = npc.model.getLocalPosition();
            npc.model.setLocalPosition(lp.x, lp.y + (npc.p.y - m.minY), lp.z);
            npc.fit = null;
            this._attachWeapon(npc);
        }
    }

    /** clone m16 + muzzle flash into the right-hand bone (recipe from the old FPS project) */
    _attachWeapon(npc: any) {
        try {
            if (!this.assets.gun || npc.gun) return;
            let hand = npc.model.findByName('mixamorig:RightHand');
            if (!hand) {
                const all = npc.model.find((n: any) => n.name && n.name.indexOf('RightHand') !== -1);
                hand = all && all.length ? all[0] : null;
            }
            if (!hand) { console.warn('npcSystem: RightHand bone not found'); return; }

            const gun = this.assets.gun.resource.instantiateRenderEntity();
            hand.addChild(gun);
            gun.setLocalPosition(GUN_LOCAL_POS[0], GUN_LOCAL_POS[1], GUN_LOCAL_POS[2]);
            gun.setLocalEulerAngles(GUN_LOCAL_EULER[0], GUN_LOCAL_EULER[1], GUN_LOCAL_EULER[2]);
            // local scale is relative to the hand bone (inherits the rig scale),
            // so the old project's value keeps the same gun:body proportion
            gun.setLocalScale(GUN_LOCAL_SCALE, GUN_LOCAL_SCALE, GUN_LOCAL_SCALE);
            npc.gun = gun;

            if (this.assets.flash) {
                const flash = this.assets.flash.resource.instantiateRenderEntity();
                gun.addChild(flash);
                flash.setLocalPosition(FLASH_LOCAL_POS[0], FLASH_LOCAL_POS[1], FLASH_LOCAL_POS[2]);
                flash.setLocalScale(FLASH_LOCAL_SCALE, FLASH_LOCAL_SCALE, FLASH_LOCAL_SCALE);
                flash.enabled = false;
                npc.flash = flash;
                npc.flashTimer = 2 + Math.random() * 3;
                npc.flashOn = 0;
            }
            console.log('npcSystem: m16 attached to', npc.root.name, 'scale', GUN_LOCAL_SCALE);
        } catch (e) {
            console.warn('npcSystem: weapon attach failed', e);
        }
    }

    step(dt: number, balls: any[]) {
        if (!this.ready) return;
        const col = this.collision;

        for (const b of balls) this.hitTest(b, dt);

        for (const npc of this.npcs) {
            if (npc.fit && npc.state !== 'dead') this._fitStep(npc);
            if (npc.hitCooldown > 0) npc.hitCooldown -= dt;

            // occasional muzzle flash while alive
            if (npc.flash && npc.state !== 'dying' && npc.state !== 'dead') {
                if (npc.flashOn > 0) {
                    npc.flashOn -= dt;
                    if (npc.flashOn <= 0) npc.flash.enabled = false;
                } else {
                    npc.flashTimer -= dt;
                    if (npc.flashTimer <= 0) {
                        npc.flash.enabled = true;
                        npc.flashOn = 0.09;
                        npc.flashTimer = 1.5 + Math.random() * 3.5;
                    }
                }
            }

            if (npc.state === 'dying') {
                npc.stateTime -= dt;
                if (npc.stateTime <= 0) {
                    npc.state = 'dead';
                    npc.root.destroy();
                    if (npc.el) npc.el.remove();
                    // respawn a fresh soldier elsewhere
                    this._spawnNpc(0);
                }
                continue;
            }
            if (npc.state === 'dead') continue;

            if (npc.state === 'idle') {
                npc.stateTime -= dt;
                if (npc.stateTime <= 0) this._pickTarget(npc);
            } else if (npc.state === 'walk' && npc.target) {
                const dx = npc.target.x - npc.p.x;
                const dz = npc.target.z - npc.p.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < 0.4) {
                    npc.target = null;
                    npc.state = 'idle';
                    npc.stateTime = 1.5 + Math.random() * 3.5;
                    this._setAnim(npc, 'Idle');
                } else {
                    const nx = dx / dist, nz = dz / dist;
                    npc.p.x += nx * NPC_WALK_SPEED * dt;
                    npc.p.z += nz * NPC_WALK_SPEED * dt;

                    // face movement direction (root yaw; model has its own 180 fix)
                    const targetYaw = Math.atan2(-nx, -nz) * 180 / Math.PI;
                    let dyaw = targetYaw - npc.yaw;
                    while (dyaw > 180) dyaw -= 360;
                    while (dyaw < -180) dyaw += 360;
                    npc.yaw += Math.max(-360 * dt, Math.min(360 * dt, dyaw));

                    // follow the floor
                    const down = col.queryRay(npc.p.x, npc.p.y + 1.2, npc.p.z, 0, -1, 0, 3);
                    if (down) npc.p.y += (down.y - npc.p.y) * Math.min(1, dt * 10);

                    // capsule collision against walls: push and re-target if blocked
                    const cy = npc.p.y + this.npcHeight * 0.5;
                    if (col.queryCapsule(npc.p.x, cy, npc.p.z, this.npcHeight * 0.5 - this.npcRadius, this.npcRadius, this._push)) {
                        npc.p.x += this._push.x;
                        npc.p.z += this._push.z;
                        const pushMag = Math.abs(this._push.x) + Math.abs(this._push.z);
                        if (pushMag > 0.03) {
                            npc.target = null;
                            npc.state = 'idle';
                            npc.stateTime = 0.5;
                            this._setAnim(npc, 'Idle');
                        }
                    }
                }
            }

            npc.root.setPosition(npc.p.x, npc.p.y, npc.p.z);
            npc.root.setEulerAngles(0, npc.yaw, 0);
        }

        // project name tags
        const camComp = this.cameraEntity.camera;
        const canvas = this.app.graphicsDevice.canvas;
        if (camComp && canvas) {
            const sx = canvas.clientWidth / canvas.width;
            const sy = canvas.clientHeight / canvas.height;
            for (const npc of this.npcs) {
                if (!npc.el || npc.state === 'dead') continue;
                camComp.worldToScreen(new pc.Vec3(npc.p.x, npc.p.y + this.npcHeight + 0.15, npc.p.z), this._screenPos);
                if (this._screenPos.z < 0) { npc.el.style.display = 'none'; continue; }
                npc.el.style.display = 'block';
                npc.el.style.left = `${this._screenPos.x * sx}px`;
                npc.el.style.top = `${this._screenPos.y * sy}px`;
            }
        }
    }
}

// ---- static props: decorative models that stand in the hallway ----

const PROP_ASSET: [number, string] = [298983207, 'prop-mega-knight.glb'];
/** statue height as a fraction of the corridor's floor-to-ceiling clearance */
const PROP_HEIGHT_FACTOR = 0.65;

class PropSystem {
    app: any;
    collision: any;
    ready = false;
    prop: any = null;
    /** cylinder obstacles for BallPhysics: {x, z, radius, minY, maxY} */
    obstacles: any[] = [];

    constructor(app: any, collision: any) {
        this.app = app;
        this.collision = collision;
        this._load();
    }

    _load() {
        const [id, fname] = PROP_ASSET;
        let q = '';
        try {
            const cfg = (window as any).config;
            const bid = (cfg && (cfg.self?.branch?.id || cfg.self?.branchId)) || '87d9f884-5657-4343-887e-e823e912488f';
            q = `?branchId=${bid}`;
        } catch (e) { /* default */ }
        const url = `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
        const asset = new pc.Asset(fname, 'container', { url, filename: fname });
        asset.on('load', () => this._spawn(asset));
        asset.on('error', (err: string) => console.error('prop asset failed:', fname, err));
        this.app.assets.add(asset);
        this.app.assets.load(asset);
    }

    _corridorStats() {
        const col = this.collision;
        const res = col.voxelResolution;
        const midY = col.gridMinY + col.numVoxelsY * res * 0.5;
        const gMaxX = col.gridMinX + col.numVoxelsX * res;
        const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;
        const cs: number[] = [];
        const floors: number[] = [];
        for (let i = 0; i < 80 && cs.length < 30; i++) {
            const x = col.gridMinX + 0.5 + Math.random() * (gMaxX - col.gridMinX - 1);
            const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
            const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
            const up = col.queryRay(x, midY, z, 0, 1, 0, 30);
            if (down && up) { cs.push(up.y - down.y); floors.push(down.y); }
        }
        if (cs.length < 5) return { clearance: 2.4, floor: col.gridMinY };
        cs.sort((a, b) => a - b);
        floors.sort((a, b) => a - b);
        return {
            clearance: cs[Math.floor(cs.length / 2)],
            floor: floors[Math.floor(floors.length / 2)]
        };
    }

    _validSpot(x: number, z: number, stats: any, targetHeight: number) {
        const col = this.collision;
        const res = col.voxelResolution;
        const midY = col.gridMinY + col.numVoxelsY * res * 0.5;
        const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
        if (!down) return null;
        // must be on the actual corridor floor, not on top of a wall
        if (Math.abs(down.y - stats.floor) > 0.4) return null;
        const up = col.queryRay(x, down.y + 0.2, z, 0, 1, 0, 30);
        if (up && up.y - down.y < targetHeight + 0.15) return null;
        if (!col.isFreeAt(x, down.y + 0.6, z)) return null;
        if (!col.isFreeAt(x, down.y + 1.2, z)) return null;
        return { x, y: down.y, z };
    }

    _spawn(asset: any) {
        const col = this.collision;
        const res = col.voxelResolution;
        const midX = col.gridMinX + col.numVoxelsX * res * 0.5;
        const midZ = col.gridMinZ + col.numVoxelsZ * res * 0.5;
        const gMaxX = col.gridMinX + col.numVoxelsX * res;
        const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;

        const stats = this._corridorStats();
        const targetHeight = stats.clearance * PROP_HEIGHT_FACTOR;

        // preferred: centred a few metres down the hall from the walk spawn
        let spot: any = null;
        for (const dz of [-4, 4, -6, 6, -2, 2, 0, -8, 8]) {
            spot = this._validSpot(midX, midZ + dz, stats, targetHeight);
            if (spot) break;
        }
        // fallback: random search across the corridor
        for (let i = 0; !spot && i < 150; i++) {
            const x = col.gridMinX + 0.4 + Math.random() * (gMaxX - col.gridMinX - 0.8);
            const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
            spot = this._validSpot(x, z, stats, targetHeight);
        }
        if (!spot) { console.warn('prop: no floor spot found'); return; }
        console.log('propSystem: placing at', spot.x.toFixed(2), spot.y.toFixed(2), spot.z.toFixed(2), 'floor median', stats.floor.toFixed(2));

        const root = new pc.Entity('mega-knight');
        const model = asset.resource.instantiateRenderEntity();
        root.addChild(model);
        this.app.root.addChild(root);
        root.setPosition(spot.x, spot.y, spot.z);
        // face the walk spawn (grid center)
        root.setEulerAngles(0, spot.z < midZ ? 0 : 180, 0);

        this.prop = {
            root, model, p: spot,
            targetHeight,
            fit: { phase: 'scale', wait: 3 }
        };
    }

    _measure(model: any) {
        let min: any = null, max: any = null;
        const rs = model.findComponents('render');
        for (const r of rs) {
            for (const mi of r.meshInstances) {
                const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
                if (!min) {
                    min = { x: mn.x, y: mn.y, z: mn.z };
                    max = { x: mx.x, y: mx.y, z: mx.z };
                } else {
                    min.x = Math.min(min.x, mn.x); min.y = Math.min(min.y, mn.y); min.z = Math.min(min.z, mn.z);
                    max.x = Math.max(max.x, mx.x); max.y = Math.max(max.y, mx.y); max.z = Math.max(max.z, mx.z);
                }
            }
        }
        if (!min) return null;
        return {
            minY: min.y,
            center: { x: (min.x + max.x) * 0.5, y: (min.y + max.y) * 0.5, z: (min.z + max.z) * 0.5 },
            ext: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }
        };
    }

    step(dt: number) {
        const prop = this.prop;
        if (!prop || !prop.fit) return;
        const fit = prop.fit;
        if (fit.wait > 0) { fit.wait--; return; }
        const m = this._measure(prop.model);
        if (!m || !isFinite(m.ext.y) || m.ext.y <= 0.01) { fit.wait = 3; return; }

        if (fit.phase === 'scale') {
            const cur = prop.model.getLocalScale().x;
            const scale = cur * (prop.targetHeight / m.ext.y);
            prop.model.setLocalScale(scale, scale, scale);
            console.log('propSystem: mega knight height', m.ext.y.toFixed(2), '→ scale', scale.toFixed(4), 'target', prop.targetHeight.toFixed(2));
            fit.phase = 'ground';
            fit.wait = 2;
        } else if (fit.phase === 'ground') {
            // world-space correction: geometry bbox centre → root position (X/Z),
            // bbox bottom → floor (Y)
            const ws = new pc.Vec3(
                prop.p.x - m.center.x,
                prop.p.y - m.minY,
                prop.p.z - m.center.z
            );
            // convert to the root's local frame (root is yaw-rotated only)
            const inv = prop.root.getRotation().clone().invert();
            const ls = inv.transformVector(ws, new pc.Vec3());
            const lp = prop.model.getLocalPosition();
            prop.model.setLocalPosition(lp.x + ls.x, lp.y + ls.y, lp.z + ls.z);
            console.log('propSystem: recentered by', ws.x.toFixed(2), ws.y.toFixed(2), ws.z.toFixed(2));
            // register as a ball obstacle: cylinder around the statue
            const radius = Math.max(m.ext.x, m.ext.z) * 0.4;
            this.obstacles.length = 0;
            this.obstacles.push({
                x: prop.p.x, z: prop.p.z,
                radius,
                minY: prop.p.y, maxY: prop.p.y + prop.targetHeight
            });
            prop.fit = null;
            this.ready = true;
        }
    }
}

// ---- object labeling: place spheres, name them, remove the splats inside ----

const MAX_KILL_SPHERES = 16;

const KILL_CHUNK_GLSL = `
uniform vec4 uKillSpheres[${MAX_KILL_SPHERES}];
uniform float uKillCount;
void modifySplatCenter(inout vec3 center) {
}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    for (int i = 0; i < ${MAX_KILL_SPHERES}; i++) {
        if (float(i) >= uKillCount) break;
        vec3 d = originalCenter - uKillSpheres[i].xyz;
        float r = uKillSpheres[i].w;
        if (dot(d, d) < r * r) { scale = vec3(0.0); return; }
    }
}
void modifySplatColor(vec3 center, inout vec4 color) {
}
`;

const KILL_CHUNK_WGSL = `
uniform uKillSpheres: array<vec4f, ${MAX_KILL_SPHERES}>;
uniform uKillCount: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {
}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
    for (var i = 0; i < ${MAX_KILL_SPHERES}; i++) {
        if (f32(i) >= uniforms.uKillCount) { break; }
        let d = originalCenter - uniforms.uKillSpheres[i].xyz;
        let r = uniforms.uKillSpheres[i].w;
        if (dot(d, d) < r * r) { *scale = vec3f(0.0); return; }
    }
}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
}
`;

class LabelSystem {
    app: any;
    collision: any;
    cameraEntity: any;
    markers: any[] = [];
    labelsVisible = true;
    _splatEntity: any = null;
    _chunkInstalled = false;
    _screenPos: any;
    _origIsVoxelSolid: any = null;

    constructor(app: any, collision: any, cameraEntity: any) {
        this.app = app;
        this.collision = collision;
        this.cameraEntity = cameraEntity;
        this._screenPos = new pc.Vec3();

        // carve removed regions out of the collision by shadowing isVoxelSolid
        const col = collision;
        const orig = col.isVoxelSolid.bind(col);
        this._origIsVoxelSolid = orig;
        const markers = this.markers;
        col.isVoxelSolid = function (ix: number, iy: number, iz: number) {
            if (!orig(ix, iy, iz)) return false;
            const wx = col.gridMinX + (ix + 0.5) * col.voxelResolution;
            const wy = col.gridMinY + (iy + 0.5) * col.voxelResolution;
            const wz = col.gridMinZ + (iz + 0.5) * col.voxelResolution;
            for (let i = 0; i < markers.length; i++) {
                const m = markers[i];
                if (!m.removed) continue;
                const dx = wx - m.center.x, dy = wy - m.center.y, dz = wz - m.center.z;
                if (dx * dx + dy * dy + dz * dz < m.radius * m.radius) return false;
            }
            return true;
        };
    }

    _findSplatEntity() {
        if (this._splatEntity) return this._splatEntity;
        const names = ['University 3', 'splat'];
        for (const n of names) {
            const e = this.app.root.findByName(n);
            if (e && e.gsplat) { this._splatEntity = e; break; }
        }
        return this._splatEntity;
    }

    _installChunk() {
        if (this._chunkInstalled) return true;
        const splat = this._findSplatEntity();
        if (!splat || !splat.gsplat) return false;
        const mat = splat.gsplat.material;
        if (!mat) return false;
        try {
            const chunks = mat.shaderChunks;
            if (chunks && chunks.glsl) chunks.glsl.set('gsplatModifyVS', KILL_CHUNK_GLSL);
            if (chunks && chunks.wgsl) chunks.wgsl.set('gsplatModifyVS', KILL_CHUNK_WGSL);
            mat.update();
            this._chunkInstalled = true;
            this._pushUniforms();
            return true;
        } catch (e) {
            console.warn('labelSystem: shader chunk install failed', e);
            return false;
        }
    }

    /** world → splat local space (entity is rotated 180° around Z at origin) */
    _worldToSplatLocal(p: { x: number; y: number; z: number }) {
        const splat = this._findSplatEntity();
        if (!splat) return { x: p.x, y: p.y, z: p.z };
        const inv = splat.getWorldTransform().clone().invert();
        const v = inv.transformPoint(new pc.Vec3(p.x, p.y, p.z));
        return { x: v.x, y: v.y, z: v.z };
    }

    _pushUniforms() {
        const splat = this._findSplatEntity();
        if (!splat || !splat.gsplat || !splat.gsplat.material) return;
        const mat = splat.gsplat.material;
        const data = new Float32Array(MAX_KILL_SPHERES * 4);
        let n = 0;
        for (const m of this.markers) {
            if (!m.removed || n >= MAX_KILL_SPHERES) continue;
            const l = this._worldToSplatLocal(m.center);
            data[n * 4] = l.x;
            data[n * 4 + 1] = l.y;
            data[n * 4 + 2] = l.z;
            data[n * 4 + 3] = m.radius;
            n++;
        }
        mat.setParameter('uKillSpheres[0]', data);
        mat.setParameter('uKillCount', n);
        mat.update();
    }

    /** cast the aim ray, place (or return existing nearby) marker */
    aimHit(maxDist = 12) {
        const cam = this.cameraEntity;
        const p = cam.getPosition();
        const fwd = cam.forward;
        return this.collision.queryRay(p.x, p.y, p.z, fwd.x, fwd.y, fwd.z, maxDist);
    }

    nearestMarkerToAim(maxDist = 12) {
        const cam = this.cameraEntity;
        const p = cam.getPosition();
        const fwd = cam.forward;
        let best = null;
        let bestT = Infinity;
        for (const m of this.markers) {
            const dx = m.center.x - p.x, dy = m.center.y - p.y, dz = m.center.z - p.z;
            const t = dx * fwd.x + dy * fwd.y + dz * fwd.z;
            if (t < 0 || t > maxDist) continue;
            const px = p.x + fwd.x * t, py = p.y + fwd.y * t, pz = p.z + fwd.z * t;
            const ox = m.center.x - px, oy = m.center.y - py, oz = m.center.z - pz;
            const off = Math.sqrt(ox * ox + oy * oy + oz * oz);
            if (off < Math.max(m.radius, 0.5) && t < bestT) { bestT = t; best = m; }
        }
        return best;
    }

    placeMarker(label: string) {
        const hit = this.aimHit();
        if (!hit) return null;
        const marker = {
            center: { x: hit.x, y: hit.y, z: hit.z },
            radius: 0.5,
            label: label || `object ${this.markers.length + 1}`,
            removed: false,
            sphere: null as any,
            el: null as any
        };

        const sphere = new pc.Entity('label-sphere');
        sphere.addComponent('render', { type: 'sphere' });
        const mat = new pc.StandardMaterial();
        mat.diffuse.set(0.2, 0.7, 1.0);
        mat.emissive.set(0.05, 0.25, 0.4);
        mat.blendType = pc.BLEND_NORMAL;
        mat.opacity = 0.22;
        mat.depthWrite = false;
        mat.update();
        sphere.render!.meshInstances[0].material = mat;
        sphere.setPosition(hit.x, hit.y, hit.z);
        sphere.setLocalScale(1, 1, 1);
        this.app.root.addChild(sphere);
        marker.sphere = sphere;

        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;transform:translate(-50%,-140%);z-index:9998;color:#fff;background:rgba(20,110,220,0.85);font:12px monospace;padding:2px 8px;border-radius:10px;pointer-events:none;white-space:nowrap;';
        el.textContent = marker.label;
        document.body.appendChild(el);
        marker.el = el;

        this.markers.push(marker);
        this._syncMarker(marker);
        return marker;
    }

    _syncMarker(m: any) {
        if (m.sphere) {
            const d = m.radius * 2;
            m.sphere.setLocalScale(d, d, d);
            m.sphere.setPosition(m.center.x, m.center.y, m.center.z);
            m.sphere.enabled = !m.removed && this.labelsVisible;
        }
        if (m.el) {
            m.el.textContent = m.removed ? `${m.label} [removed]` : m.label;
            m.el.style.background = m.removed ? 'rgba(200,40,40,0.85)' : 'rgba(20,110,220,0.85)';
        }
    }

    setRadius(m: any, radius: number) {
        m.radius = Math.max(0.15, Math.min(3, radius));
        this._syncMarker(m);
        if (m.removed) this._pushUniforms();
    }

    toggleRemove(m: any) {
        m.removed = !m.removed;
        this._syncMarker(m);
        this._installChunk();
        this._pushUniforms();
    }

    deleteMarker(m: any) {
        const i = this.markers.indexOf(m);
        if (i < 0) return;
        this.markers.splice(i, 1);
        if (m.sphere) m.sphere.destroy();
        if (m.el) m.el.remove();
        this._pushUniforms();
    }

    toggleLabels() {
        this.labelsVisible = !this.labelsVisible;
        for (const m of this.markers) this._syncMarker(m);
    }

    update() {
        if (!this._chunkInstalled && this.markers.some((m: any) => m.removed)) {
            this._installChunk();
        }
        const camComp = this.cameraEntity.camera;
        const canvas = this.app.graphicsDevice.canvas;
        const sx = canvas.clientWidth / canvas.width;
        const sy = canvas.clientHeight / canvas.height;

        for (const m of this.markers) {
            if (!m.el) continue;
            if (!this.labelsVisible) { m.el.style.display = 'none'; continue; }
            camComp.worldToScreen(new pc.Vec3(m.center.x, m.center.y + m.radius, m.center.z), this._screenPos);
            if (this._screenPos.z < 0) { m.el.style.display = 'none'; continue; }
            m.el.style.display = 'block';
            m.el.style.left = `${this._screenPos.x * sx}px`;
            m.el.style.top = `${this._screenPos.y * sy}px`;
        }
    }
}

function makeHud() {
    let el = document.getElementById('uni3-hud') as HTMLDivElement | null;
    if (!el) {
        el = document.createElement('div');
        el.id = 'uni3-hud';
        el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;color:#0f0;background:rgba(0,0,0,0.6);font:12px monospace;padding:6px 8px;border-radius:4px;pointer-events:none;white-space:pre;';
        document.body.appendChild(el);
    }
    return el;
}

const WalkScript = pc.createScript('walkCollision');

WalkScript.prototype.initialize = function (this: any) {
    this._hud = makeHud();

    const data = (window as any).UNI3_VOXEL;
    if (!data) {
        this._hud.textContent = 'walkCollision: NO VOXEL DATA (voxel-data.js missing)';
        console.error('walkCollision: window.UNI3_VOXEL missing');
        return;
    }

    // decode base64 collision octree
    const bin = atob(data.binBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new Uint32Array(bytes.buffer);
    const meta = data.meta;
    const nodes = view.slice(0, meta.nodeCount);
    const leafData = view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount);
    const collision = new VoxelCollision(meta, nodes, leafData);
    this._collision = collision;

    // ---- gta6 controller, verbatim usage from its main.ts ----
    const controller = new WalkController();
    controller.collision = collision;
    controller.fov = 80;
    this._controller = controller;

    const walkCamera = new WalkCamera();
    walkCamera.position.set(
        collision.gridMinX + collision.numVoxelsX * collision.voxelResolution * 0.5,
        collision.gridMinY + collision.numVoxelsY * collision.voxelResolution * 0.5,
        collision.gridMinZ + collision.numVoxelsZ * collision.voxelResolution * 0.5
    );
    controller.onEnter(walkCamera);
    this._walkCamera = walkCamera;

    const InputFrameCls = pc.InputFrame || SimpleInputFrame;
    this._frame = new InputFrameCls({ move: [0, 0, 0], rotate: [0, 0, 0] });

    // ---- input (mirrors gta6 main.ts) ----
    const keys: any = {
        forward: false, backward: false, left: false, right: false,
        jump: false, run: false
    };
    this._keys = keys;
    this._flyMode = false;
    this._pitch = 0;
    this._yaw = 0;

    const canvas: HTMLCanvasElement = this.app.graphicsDevice.canvas;
    const self = this;

    const handleKey = (e: KeyboardEvent, down: boolean) => {
        switch (e.code) {
            case 'KeyW': case 'ArrowUp': keys.forward = down; break;
            case 'KeyS': case 'ArrowDown': keys.backward = down; break;
            case 'KeyA': case 'ArrowLeft': keys.left = down; break;
            case 'KeyD': case 'ArrowRight': keys.right = down; break;
            case 'Space': keys.jump = down; e.preventDefault(); break;
            case 'ShiftLeft': case 'ShiftRight': keys.run = down; break;
            case 'KeyQ': keys.down = down; break;
            case 'KeyE': keys.up = down; break;
            case 'KeyR':
                if (down) {
                    if (!self._flyMode) {
                        self._controller.resetToSpawn(self._walkCamera) ||
                            self._controller.onEnter(self._walkCamera);
                    }
                }
                break;
            case 'KeyG':
                if (down) {
                    const f = self.entity.forward;
                    const ep = self.entity.getPosition();
                    self._balls.throwBall(ep, { x: f.x, y: f.y, z: f.z });
                }
                break;
            case 'KeyC':
                if (down) self._balls.clear();
                break;
            case 'KeyX':
                if (down) {
                    document.exitPointerLock();
                    const name = window.prompt('Label this object:', 'object ' + (self._labels.markers.length + 1));
                    if (name !== null) {
                        const m = self._labels.placeMarker(name);
                        if (!m) console.warn('label: nothing hit under crosshair');
                    }
                }
                break;
            case 'KeyV':
                if (down) {
                    const m = self._labels.nearestMarkerToAim();
                    if (m) self._labels.toggleRemove(m);
                }
                break;
            case 'KeyL':
                if (down) self._labels.toggleLabels();
                break;
            case 'BracketLeft':
                if (down) {
                    const m = self._labels.nearestMarkerToAim() || self._labels.markers[self._labels.markers.length - 1];
                    if (m) self._labels.setRadius(m, m.radius - 0.1);
                }
                break;
            case 'BracketRight':
                if (down) {
                    const m = self._labels.nearestMarkerToAim() || self._labels.markers[self._labels.markers.length - 1];
                    if (m) self._labels.setRadius(m, m.radius + 0.1);
                }
                break;
            case 'Backspace':
                if (down) {
                    const m = self._labels.nearestMarkerToAim();
                    if (m) self._labels.deleteMarker(m);
                }
                break;
            case 'KeyY':
                if (down) {
                    self._flyMode = !self._flyMode;
                    if (!self._flyMode) {
                        // re-enter walk at the current fly position: teleport the
                        // controller there and let gravity settle
                        self._walkCamera.angles.set(self._pitch, self._yaw, 0);
                        self._controller.goto(self._walkCamera);
                    } else {
                        // seed fly angles from the walk camera
                        self._pitch = self._walkCamera.angles.x;
                        self._yaw = self._walkCamera.angles.y;
                    }
                }
                break;
            default: return;
        }
    };
    this._onKeyDown = (e: KeyboardEvent) => handleKey(e, true);
    this._onKeyUp = (e: KeyboardEvent) => handleKey(e, false);
    this._onBlur = () => {
        keys.forward = keys.backward = keys.left = keys.right = keys.jump = keys.run = false;
    };
    this._onClick = () => {
        if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    };
    this._onMouseMove = (e: MouseEvent) => {
        if (document.pointerLockElement !== canvas) return;
        if (self._flyMode) {
            self._yaw -= e.movementX * LOOK_SENSITIVITY;
            self._pitch -= e.movementY * LOOK_SENSITIVITY;
            self._pitch = Math.max(-89, Math.min(89, self._pitch));
        } else {
            self._frame.deltas.rotate.append([
                e.movementX * LOOK_SENSITIVITY,
                e.movementY * LOOK_SENSITIVITY,
                0
            ]);
        }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('click', this._onClick);
    window.addEventListener('mousemove', this._onMouseMove);

    this.on('destroy', () => {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);
        canvas.removeEventListener('click', this._onClick);
        window.removeEventListener('mousemove', this._onMouseMove);
    });

    // the scene has no lights; meshes render black without one
    try {
        if (!this.app.root.findByName('walk-light')) {
            const light = new pc.Entity('walk-light');
            light.addComponent('light', { type: 'directional', intensity: 1.4, castShadows: false });
            light.setEulerAngles(50, 30, 0);
            this.app.root.addChild(light);
            this.app.scene.ambientLight = new pc.Color(0.45, 0.45, 0.5);
        }
    } catch (e) { /* headless */ }

    this._balls = new BallPhysics(this.app, collision);
    this._labels = new LabelSystem(this.app, collision, this.entity);
    try {
        this._npcs = new NpcSystem(this.app, collision, this.entity);
    } catch (e) {
        console.error('npc system init failed', e);
        this._npcs = null;
    }
    try {
        this._props = new PropSystem(this.app, collision);
    } catch (e) {
        console.error('prop system init failed', e);
        this._props = null;
    }

    (window as any).walk = { controller, camera: walkCamera, collision, script: this, balls: this._balls, labels: this._labels, npcs: this._npcs, props: this._props };
    this._hudT = 0;
};

WalkScript.prototype.update = function (this: any, dt: number) {
    if (!this._controller) return;

    if (this._props) {
        this._props.step(Math.min(dt, 0.05));
        if (this._balls && this._props.ready && this._balls.obstacles.length === 0) {
            this._balls.obstacles = this._props.obstacles;
        }
    }
    if (this._balls) this._balls.step(Math.min(dt, 0.05));
    if (this._npcs) this._npcs.step(Math.min(dt, 0.05), this._balls ? this._balls.balls : []);
    if (this._labels) this._labels.update();

    const keys = this._keys;

    if (this._flyMode) {
        const mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        const mz = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0);
        const my = (keys.up || keys.jump ? 1 : 0) - (keys.down ? 1 : 0);
        const speed = keys.run ? 10 : 5;

        const yawRad = this._yaw * Math.PI / 180;
        const pitchRad = this._pitch * Math.PI / 180;
        const sy = Math.sin(yawRad), cy = Math.cos(yawRad);
        const sp = Math.sin(pitchRad), cp = Math.cos(pitchRad);

        const p = this._walkCamera.position;
        p.x += ((-sy * cp) * mz + cy * mx) * speed * dt;
        p.y += (sp * mz + my) * speed * dt;
        p.z += ((-cy * cp) * mz + (-sy) * mx) * speed * dt;

        this.entity.setPosition(p.x, p.y, p.z);
        this.entity.setEulerAngles(this._pitch, this._yaw, 0);

        this._hudT += dt;
        if (this._hudT > 0.25 && this._hud) {
            this._hudT = 0;
            this._hud.textContent = `FLY  pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}` +
                '\nY = walk mode | WASD + E/Q up/down | Shift fast';
        }
        return;
    }

    // ---- walk mode: identical input feed to gta6 main.ts ----
    const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const z = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0);
    if (x || z) {
        const scale = MOVE_SPEED * dt * (keys.run ? RUN_MULTIPLIER : 1);
        this._frame.deltas.move.append([x * scale, 0, z * scale]);
    }
    if (keys.jump) {
        this._frame.deltas.move.append([0, 1, 0]);
    }

    this._controller.update(dt, this._frame, this._walkCamera);

    const wp = this._walkCamera.position;
    const wa = this._walkCamera.angles;
    this.entity.setPosition(wp.x, wp.y, wp.z);
    this.entity.setEulerAngles(wa.x, wa.y, 0);

    this._hudT += dt;
    if (this._hudT > 0.25 && this._hud) {
        this._hudT = 0;
        this._hud.textContent = `pos ${wp.x.toFixed(2)} ${wp.y.toFixed(2)} ${wp.z.toFixed(2)}` +
            '\nWASD Space Shift | Y fly | R respawn | G ball | C clear balls' +
            '\nX label object | V remove/restore | [ ] size | L labels | Backspace delete';
    }
};
