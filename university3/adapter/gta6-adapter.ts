// Editor adapter around gta6's exact WalkController + VoxelCollision.
// Registers the classic script 'walkCollision' (same name the Camera entity
// already references). Voxel data comes from window.UNI3_VOXEL (voxel-data.js).

import { WalkController } from './vendor/cameras/walk-controller';
import { Camera as WalkCamera } from './vendor/cameras/camera';
import { VoxelCollision } from './vendor/collision/voxel-collision';

const pc: any = (globalThis as any).pc;

const BUILD_TAG = 'v11-shadcn';
console.log('[walk-collision] build', BUILD_TAG);

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

// ---- sound kit: thin wrapper over pc.SoundInstance + preloaded audio assets ----

class SoundKit {
    app: any;
    muted = false;

    constructor(app: any) {
        this.app = app;
    }

    _asset(name: string) {
        const a = this.app.assets.find(name);
        if (a && !a.resource && !a.loading) this.app.assets.load(a);
        return a && a.resource ? a : null;
    }

    /** play a one-shot; returns the instance or null */
    play(name: string, opts: any = {}) {
        if (this.muted) return null;
        try {
            const a = this._asset(name);
            if (!a) return null;
            const inst = new pc.SoundInstance(this.app.systems.sound.manager, a.resource, {
                volume: opts.volume ?? 0.7,
                pitch: opts.pitch ?? 1,
                loop: !!opts.loop
            });
            inst.play();
            return inst;
        } catch (e) {
            return null;
        }
    }

    playRandom(names: string[], opts: any = {}) {
        return this.play(names[Math.floor(Math.random() * names.length)], opts);
    }
}

// ---- physics playground: bouncy balls colliding with the splat's voxel world ----

const BALL_RADIUS = 0.12;
const BALL_RESTITUTION = 0.55;
const BALL_FRICTION = 0.985;
const BALL_GRAVITY = 9.8;
const MAX_BALLS = 48;
/** balls vanish after this many solid impacts (soft touches don't count) */
const BALL_MAX_BOUNCES = 3;
/** minimum impact speed (m/s along the normal) for a bounce to count */
const BALL_BOUNCE_MIN_SPEED = 1.0;
const THROW_SPEED = 8;

class BallPhysics {
    app: any;
    collision: any;
    balls: any[] = [];
    obstacles: any[] = [];
    /** target practice: balls die on first surface impact instead of bouncing */
    noBounce = false;
    _push = { x: 0, y: 0, z: 0 };

    constructor(app: any, collision: any) {
        this.app = app;
        this.collision = collision;
    }

    throwBall(origin: any, dir: { x: number; y: number; z: number }, speed: number = THROW_SPEED, radius: number = BALL_RADIUS) {
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
            e.setLocalScale(radius * 2, radius * 2, radius * 2);
            const off = radius * 1.5;
            e.setPosition(origin.x + dir.x * off, origin.y + dir.y * off, origin.z + dir.z * off);
            this.app.root.addChild(e);
        } catch (err) {
            e = null; // headless (tests): simulate without visuals
        }

        this.balls.push({
            entity: e,
            r: radius,
            bounces: 0,
            p: { x: origin.x + dir.x * radius * 1.5, y: origin.y + dir.y * radius * 1.5, z: origin.z + dir.z * radius * 1.5 },
            v: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }
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
            // substepped swept integration: a ball never advances more than
            // ~3/4 of its radius per collision check, and each substep also
            // raycasts its path — so it can't cross the (often 1-voxel-thin)
            // scan walls no matter the speed or framerate
            const speed = Math.sqrt(b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z);
            const frameMove = speed * dt;
            const steps = Math.min(10, Math.max(1, Math.ceil(frameMove / Math.max(b.r * 0.75, 0.03))));
            const sdt = dt / steps;

            for (let s = 0; s < steps; s++) {
                b.v.y -= BALL_GRAVITY * sdt;

                const px = b.p.x, py = b.p.y, pz = b.p.z;
                const mx = b.v.x * sdt, my = b.v.y * sdt, mz = b.v.z * sdt;
                const moveDist = Math.sqrt(mx * mx + my * my + mz * mz);

                b.p.x += mx;
                b.p.y += my;
                b.p.z += mz;

                if (moveDist > 1e-6) {
                    const inv = 1 / moveDist;
                    const hit = col.queryRay(px, py, pz, mx * inv, my * inv, mz * inv, moveDist + b.r);
                    if (hit) {
                        const hx = hit.x - px, hy = hit.y - py, hz = hit.z - pz;
                        const hitDist = Math.sqrt(hx * hx + hy * hy + hz * hz);
                        if (hitDist < moveDist + b.r) {
                            const t = Math.max(0, hitDist - b.r) * inv;
                            b.p.x = px + mx * t;
                            b.p.y = py + my * t;
                            b.p.z = pz + mz * t;
                        }
                    }
                }

                if (col.querySphere(b.p.x, b.p.y, b.p.z, b.r, push)) {
                    b.p.x += push.x; b.p.y += push.y; b.p.z += push.z;
                    const len = Math.sqrt(push.x * push.x + push.y * push.y + push.z * push.z);
                    if (len > 1e-9) {
                        const nx = push.x / len, ny = push.y / len, nz = push.z / len;
                        const vn = b.v.x * nx + b.v.y * ny + b.v.z * nz;
                        if (vn < 0) {
                            if (this.noBounce && vn < -BALL_BOUNCE_MIN_SPEED * 0.5) {
                                // practice mode: dead on impact
                                b.bounces = BALL_MAX_BOUNCES + 1;
                                b.v.x = 0; b.v.y = 0; b.v.z = 0;
                                break;
                            }
                            if (vn < -BALL_BOUNCE_MIN_SPEED) b.bounces++;
                            b.v.x -= (1 + BALL_RESTITUTION) * vn * nx;
                            b.v.y -= (1 + BALL_RESTITUTION) * vn * ny;
                            b.v.z -= (1 + BALL_RESTITUTION) * vn * nz;
                            b.v.x *= BALL_FRICTION; b.v.y *= BALL_FRICTION; b.v.z *= BALL_FRICTION;
                        }
                        if (ny > 0.5 && Math.abs(b.v.y) < 0.3 && (b.v.x * b.v.x + b.v.z * b.v.z) < 0.04) {
                            b.v.y = 0;
                        }
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
                if (b.p.y < o.minY - b.r || b.p.y > o.maxY + b.r) continue;
                const dx = b.p.x - o.x, dz = b.p.z - o.z;
                const d2 = dx * dx + dz * dz;
                const minD = o.radius + b.r;
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
                const minD = a.r + c.r;
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

        // spent balls vanish
        for (let i = balls.length - 1; i >= 0; i--) {
            if (balls[i].bounces > BALL_MAX_BOUNCES) {
                if (balls[i].entity) balls[i].entity.destroy();
                balls.splice(i, 1);
            }
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

/** trimmed personality set from the original npc-ai.js */
const NPC_PERSONALITIES = [
    { name: 'Sgt. Havoc', aggression: 0.9, randomness: 0.2 },
    { name: 'Ghost', aggression: 0.3, randomness: 0.1 },
    { name: 'Captain Valor', aggression: 0.7, randomness: 0.1 },
    { name: 'Chaos', aggression: 0.5, randomness: 0.8 },
    { name: 'Strategist', aggression: 0.5, randomness: 0.05 },
    { name: 'Grumps', aggression: 0.6, randomness: 0.2 }
];

/** combat tuning (from npc-controller.js / npc-ai.js, rebalanced for gameplay) */
const NPC_SIGHT_RANGE = 22;
/** soldiers must be this close before they open fire (they advance otherwise) */
const NPC_FIRE_RANGE = 11;
const NPC_HEARING_RANGE = 3;
const NPC_LKP_MEMORY_MS = 10000;
const NPC_SHOT_DAMAGE = 8;
const NPC_BASE_HIT_CHANCE = 0.35;
const NPC_MAG = 30;
const NPC_RELOAD_TIME = 3.0;

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
    walkSpeedMul = 1;
    combatEnabled = false;
    /** true while a scene switch is in flight — freezes all NPC activity */
    suspended = false;
    /** per-scene pinned soldier floor band [minY, maxY]; null = player-relative */
    floorRange: any = null;
    /** authoritative player position (walk controller state); falls back to
     *  the camera entity, which lags one frame behind teleports */
    getPlayerPos: any = null;
    playerDead = false;
    onKill: any = null;
    onPlayerDamage: any = null;
    sounds: any = null;
    _lastSeeYou = 0;
    _desiredCount = 0;
    _push = { x: 0, y: 0, z: 0 };
    _screenPos: any;

    constructor(app: any, collision: any, cameraEntity: any) {
        this.app = app;
        this.collision = collision;
        this.cameraEntity = cameraEntity;
        this._screenPos = new pc.Vec3();
        this._loadAssets();
    }

    _playerPos() {
        return this.getPlayerPos ? this.getPlayerPos() : this.cameraEntity.getPosition();
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

    /**
     * Measure the model by walking its node/bone hierarchy in world space.
     * Skinned-mesh AABBs are only refreshed when the model is actually
     * rendered, so off-screen soldiers report garbage bounds (which once
     * collapsed the auto-scale to zero); bone transforms always update.
     */
    _measureModel(model: any) {
        // measure ONLY real skeleton bones (mixamorig:*): rigs carry helper
        // nodes (IK poles, nulls) parked at extreme coordinates that poison
        // any all-nodes bound; fall back to all nodes if no rig found
        const collect = (rigOnly: boolean) => {
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            let count = 0;
            const stack = [model];
            while (stack.length) {
                const n = stack.pop();
                const ch = n.children;
                for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
                if (rigOnly && (!n.name || n.name.indexOf('mixamorig') === -1)) continue;
                const p = n.getPosition();
                if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) continue;
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.z < minZ) minZ = p.z;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
                if (p.z > maxZ) maxZ = p.z;
                count++;
            }
            if (count < 3) return null;
            return { minY, ext: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ } };
        };
        return collect(true) || collect(false);
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
        for (let i = 0; i < 200 && clearances.length < 25; i++) {
            const x = col.gridMinX + 0.5 + Math.random() * (gMaxX - col.gridMinX - 1);
            const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
            const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
            const up = col.queryRay(x, midY, z, 0, 1, 0, 30);
            if (!down || !up) continue;
            const c = up.y - down.y;
            // rays that start inside solid geometry report ~0 clearance —
            // most of a sparse scan's grid is uncarved, so filter those out
            if (c > 0.8) clearances.push(c);
        }
        this.npcHeight = NPC_HEIGHT;
        if (clearances.length >= 5) {
            clearances.sort((a, b) => a - b);
            const median = clearances[Math.floor(clearances.length / 2)];
            this.npcHeight = Math.min(NPC_HEIGHT, Math.max(0.9, median * 0.85));
            console.log('npcSystem: corridor clearance', median.toFixed(2), '→ soldier height', this.npcHeight.toFixed(2));
        } else {
            console.warn('npcSystem: too few clearance samples — using default height', NPC_HEIGHT);
        }
        this.npcRadius = this.npcHeight * 0.18;
    }

    _onAssetsReady() {
        try {
            this._measureHallway();
            this.ready = true;
            if (this._desiredCount > 0) this._fillPopulation();
            console.log('npcSystem: ready (population', this._desiredCount + ')');
        } catch (e) {
            console.error('npcSystem spawn failed', e);
            this.failed = true;
        }
    }

    _fillPopulation() {
        while (this.aliveCount() < this._desiredCount) {
            const before = this.npcs.length;
            this._spawnNpc(this.npcs.length);
            if (this.npcs.length === before) break; // no spawn spot found
        }
    }

    aliveCount() {
        let n = 0;
        for (const npc of this.npcs) {
            if (npc.state !== 'dying' && npc.state !== 'dead') n++;
        }
        return n;
    }

    /** set the live soldier population (waves) */
    setPopulation(count: number, speedMul: number = 1) {
        this._desiredCount = count;
        this.walkSpeedMul = speedMul;
        if (this.ready) this._fillPopulation();
    }

    /** remove every soldier immediately (restart) */
    reset() {
        for (const npc of this.npcs) {
            try { npc.root.destroy(); } catch (e) { /* already gone */ }
            if (npc.el) npc.el.remove();
        }
        this.npcs.length = 0;
        this._desiredCount = 0;
        this._reach = null;
        this._reachFrom = { x: 1e9, z: 1e9 };
    }

    _reach: any = null;
    _reachFrom = { x: 1e9, z: 1e9 };

    /**
     * Flood-fill the walkable region around the player on a 0.4m lattice.
     * A neighbor cell is walkable if its floor is within a 0.45m step of the
     * current cell (rails, ledges and balcony gaps fail this) and there is
     * free space at torso height. This is true reachability: anything the
     * player could walk to — and nothing they couldn't.
     */
    _computeReachable() {
        const col = this.collision;
        const pp = this._playerPos();
        const STEP = 0.4;
        const MAX_CELLS = 9000;
        const MAX_R = 30;

        const startDown = col.queryRay(pp.x, pp.y, pp.z, 0, -1, 0, 4);
        if (!startDown) { this._reach = null; return; }

        const key = (x: number, z: number) => `${Math.round(x / STEP)}|${Math.round(z / STEP)}`;
        const seen = new Set<string>();
        const cells: any[] = [];
        const queue: any[] = [{ x: pp.x, z: pp.z, floor: startDown.y }];
        seen.add(key(pp.x, pp.z));

        while (queue.length && cells.length < MAX_CELLS) {
            const c = queue.shift();
            cells.push(c);
            for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
                const nx = c.x + dx, nz = c.z + dz;
                const k = key(nx, nz);
                if (seen.has(k)) continue;
                seen.add(k);
                const ddx = nx - pp.x, ddz = nz - pp.z;
                if (ddx * ddx + ddz * ddz > MAX_R * MAX_R) continue;
                const down = col.queryRay(nx, c.floor + 1.0, nz, 0, -1, 0, 3);
                if (!down) continue;
                const nf = down.y;
                if (Math.abs(nf - c.floor) > 0.45) continue; // rail / ledge / gap
                if (!col.isFreeAt(nx, nf + 0.9, nz)) continue;
                queue.push({ x: nx, z: nz, floor: nf });
            }
        }
        this._reach = cells;
        this._reachFrom = { x: pp.x, z: pp.z };
    }

    _randomFloorSpot() {
        const col = this.collision;
        const pp = this._playerPos();

        // refresh the reachable region if the player moved meaningfully
        const mdx = pp.x - this._reachFrom.x, mdz = pp.z - this._reachFrom.z;
        if (!this._reach || mdx * mdx + mdz * mdz > 9) this._computeReachable();
        if (!this._reach || this._reach.length < 10) return null;

        for (let attempt = 0; attempt < 60; attempt++) {
            const c = this._reach[(Math.random() * this._reach.length) | 0];
            const x = c.x + (Math.random() - 0.5) * 0.3;
            const z = c.z + (Math.random() - 0.5) * 0.3;

            const ddx = x - pp.x, ddz = z - pp.z;
            const dd = Math.sqrt(ddx * ddx + ddz * ddz);
            if (dd < 4 || dd > 28) continue;

            const floor = c.floor;
            if (this.floorRange &&
                (floor < this.floorRange[0] - 0.05 || floor > this.floorRange[1] + 0.05)) continue;

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

        // skinned mesh world AABBs can lag/misreport after runtime scaling,
        // getting the whole model frustum-culled away from the world origin —
        // never cull soldiers (there are at most a handful)
        for (const r of model.findComponents('render')) {
            for (const mi of r.meshInstances) mi.cull = false;
        }

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
        el.className = 'sg sg-mono';
        el.style.cssText = 'position:fixed;transform:translate(-50%,-100%);z-index:9997;font-family:var(--font);font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;background:rgba(9,9,11,0.9);pointer-events:none;white-space:nowrap;color:#f87171;border:1px solid rgba(239,68,68,0.4);letter-spacing:1px;';
        document.body.appendChild(el);

        const pers = NPC_PERSONALITIES[Math.floor(Math.random() * NPC_PERSONALITIES.length)];
        const npc = {
            root, model,
            p: { x: spot.x, y: spot.y, z: spot.z },
            target: null as any,
            state: 'idle',           // idle | walk | attack | dying | dead
            stateTime: 1 + Math.random() * 3,
            hp: NPC_HP,
            hitCooldown: 0,
            yaw: Math.random() * 360,
            fit: { phase: 'orient', wait: 3, idx: 0, results: [] as number[] },
            pers,
            canSee: false,
            percT: Math.random() * 0.2,
            lkp: null as any,
            lkpTime: 0,
            shootT: 1 + Math.random(),
            bullets: NPC_MAG,
            reloadT: 0,
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
            npc.el.textContent = '☠';
            npc.el.style.background = 'rgba(120,20,20,0.8)';
        } else {
            npc.el.textContent = '♥'.repeat(Math.max(0, npc.hp));
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

    /**
     * Apply one point of damage. (nx, nz) points from the npc toward the
     * damage source; used to pick the death animation direction.
     */
    applyHit(npc: any, nx: number, nz: number) {
        if (npc.state === 'dying' || npc.state === 'dead' || npc.hitCooldown > 0) return;
        npc.hp--;
        npc.hitCooldown = NPC_HIT_COOLDOWN;
        if (npc.hp <= 0) {
            npc.state = 'dying';
            npc.stateTime = NPC_CORPSE_TIME;
            const camFwd = { x: -nx, z: -nz };
            const facing = { x: -Math.sin(npc.yaw * Math.PI / 180), z: -Math.cos(npc.yaw * Math.PI / 180) };
            const frontal = camFwd.x * facing.x + camFwd.z * facing.z < 0;
            this._setAnim(npc, frontal ? 'DeathB' : 'DeathF');
            if (npc.muzzleLight) npc.muzzleLight.intensity = 0;
            if (this.onKill) this.onKill(npc);
        }
        this._syncTag(npc);
    }

    /** pure raycast line of sight from npc chest to the player eye */
    _clearShot(npc: any) {
        const pp = this._playerPos();
        const fx = npc.p.x, fy = npc.p.y + this.npcHeight * 0.75, fz = npc.p.z;
        const dx = pp.x - fx, dy = pp.y - fy, dz = pp.z - fz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > NPC_SIGHT_RANGE * 1.2) return false;
        if (dist < 0.5) return true;
        const hit = this.collision.queryRay(fx, fy, fz, dx / dist, dy / dist, dz / dist, dist);
        if (!hit) return true;
        const hx = hit.x - fx, hy = hit.y - fy, hz = hit.z - fz;
        return Math.sqrt(hx * hx + hy * hy + hz * hz) > dist * 0.92;
    }

    /** awareness: clear shot OR point-blank hearing (walls don't block ears) */
    _hasLineOfSight(npc: any) {
        if (this._clearShot(npc)) return true;
        const pp = this._playerPos();
        const dx = pp.x - npc.p.x, dy = pp.y - (npc.p.y + this.npcHeight * 0.75), dz = pp.z - npc.p.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) < NPC_HEARING_RANGE;
    }

    /** nearest live npc intersected by the ray (vertical-capsule approximation) */
    raycastNpcs(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number) {
        let best: any = null;
        let bestT = maxDist;
        for (const npc of this.npcs) {
            if (npc.state === 'dying' || npc.state === 'dead') continue;
            // closest approach of the ray to the npc's vertical axis (XZ only)
            const rx = npc.p.x - ox, rz = npc.p.z - oz;
            const dLen2 = dx * dx + dz * dz;
            if (dLen2 < 1e-9) continue;
            const t = (rx * dx + rz * dz) / dLen2;
            if (t < 0 || t > bestT) continue;
            const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
            const ddx = px - npc.p.x, ddz = pz - npc.p.z;
            if (ddx * ddx + ddz * ddz > this.npcRadius * this.npcRadius * 1.44) continue;
            if (py < npc.p.y || py > npc.p.y + this.npcHeight) continue;
            best = npc;
            bestT = t;
        }
        return best ? { npc: best, dist: bestT } : null;
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
            const withinY = Math.abs(dy) < this.npcHeight * 0.5 + ball.r;
            if (xz < this.npcRadius + ball.r && withinY) {
                // bounce the ball back off the soldier
                const nx = xz > 1e-6 ? dx / xz : 1, nz = xz > 1e-6 ? dz / xz : 0;
                const vn = ball.v.x * nx + ball.v.z * nz;
                if (vn < 0) {
                    ball.v.x -= 1.6 * vn * nx;
                    ball.v.z -= 1.6 * vn * nz;
                }
                this.applyHit(npc, nx, nz);
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
            // bone span reads joint-to-joint; pad ~8% for skull/sole volume
            let scale = cur * (this.npcHeight * 0.93 / m.ext.y);
            // hard sanity clamp: mixamo rigs are ~180 raw units for ~1.7m,
            // so a correct scale is ~0.009 — a wild value means the
            // measurement was poisoned; use the known-good fallback
            if (!isFinite(scale) || scale < 0.0005 || scale > 1) {
                console.warn('npcSystem: implausible scale', scale, 'span', m.ext.y.toFixed(2), '— using fallback');
                scale = (this.npcHeight / 180);
            }
            npc.model.setLocalScale(scale, scale, scale);
            console.log('npcSystem: bone span', m.ext.y.toFixed(2), '→ scale', scale.toFixed(4));
            fit.phase = 'ground';
            fit.wait = 2;
        } else if (fit.phase === 'ground') {
            const dy = npc.p.y - m.minY;
            if (isFinite(dy) && Math.abs(dy) < 50) {
                const lp = npc.model.getLocalPosition();
                npc.model.setLocalPosition(lp.x, lp.y + dy, lp.z);
            }
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
            for (const r of gun.findComponents('render')) {
                for (const mi of r.meshInstances) mi.cull = false;
            }
            hand.addChild(gun);
            gun.setLocalPosition(GUN_LOCAL_POS[0], GUN_LOCAL_POS[1], GUN_LOCAL_POS[2]);
            gun.setLocalEulerAngles(GUN_LOCAL_EULER[0], GUN_LOCAL_EULER[1], GUN_LOCAL_EULER[2]);
            // local scale is relative to the hand bone (inherits the rig scale),
            // so the old project's value keeps the same gun:body proportion
            gun.setLocalScale(GUN_LOCAL_SCALE, GUN_LOCAL_SCALE, GUN_LOCAL_SCALE);
            npc.gun = gun;

            // muzzle flash: light blink only — the flash mesh's texture doesn't
            // survive the GLB import and renders as a flashing gray plane
            npc.flash = null;
            npc.flashOn = 0;
            try {
                const lightEnt = new pc.Entity('muzzle-light');
                gun.addChild(lightEnt);
                lightEnt.setLocalPosition(FLASH_LOCAL_POS[0], FLASH_LOCAL_POS[1], FLASH_LOCAL_POS[2]);
                lightEnt.addComponent('light', {
                    type: 'omni',
                    color: new pc.Color(1, 0.85, 0.4),
                    intensity: 0,
                    range: 4,
                    castShadows: false
                });
                npc.muzzleLight = lightEnt.light;
            } catch (e) { /* headless */ }
            console.log('npcSystem: m16 attached to', npc.root.name, 'scale', GUN_LOCAL_SCALE);
        } catch (e) {
            console.warn('npcSystem: weapon attach failed', e);
        }
    }

    _refillT = 0;

    step(dt: number, balls: any[]) {
        if (!this.ready || this.suspended) return;
        const col = this.collision;

        // keep trying to reach the desired population as the player moves —
        // spawn spots are strictly same-storey, so early attempts can fail
        this._refillT -= dt;
        if (this._refillT <= 0) {
            this._refillT = 2;
            if (this.aliveCount() < this._desiredCount) this._fillPopulation();
        }

        for (const b of balls) this.hitTest(b, dt);

        for (const npc of this.npcs) {
            if (npc.fit && npc.state !== 'dead') this._fitStep(npc);
            if (npc.hitCooldown > 0) npc.hitCooldown -= dt;

            // muzzle flash decay
            if (npc.flashOn > 0) {
                npc.flashOn -= dt;
                if (npc.flashOn <= 0) {
                    if (npc.flash) npc.flash.enabled = false;
                    if (npc.muzzleLight) npc.muzzleLight.intensity = 0;
                }
            }
            if (npc.reloadT > 0) {
                npc.reloadT -= dt;
                if (npc.reloadT <= 0) npc.bullets = NPC_MAG;
            }

            // perception: LOS to the player eye a few times a second
            // (raycast against the voxel world; hearing at point-blank —
            //  ported from npc-controller.js/_checkLineOfSight)
            if (this.combatEnabled && !this.playerDead &&
                npc.state !== 'dying' && npc.state !== 'dead') {
                npc.percT -= dt;
                if (npc.percT <= 0) {
                    npc.percT = 0.15;
                    npc.clearShot = this._clearShot(npc);
                    npc.canSee = npc.clearShot || this._hasLineOfSight(npc);
                }
                const pp = this._playerPos();
                const pdx = pp.x - npc.p.x, pdz = pp.z - npc.p.z;
                const pdist = Math.sqrt(pdx * pdx + pdz * pdz);

                if (npc.canSee && pdist < NPC_SIGHT_RANGE) {
                    npc.lkp = { x: pp.x, y: pp.y, z: pp.z };
                    npc.lkpTime = performance.now();
                    if (npc.state !== 'attack') {
                        npc.state = 'attack';
                        npc.target = null;
                        this._setAnim(npc, 'Idle');
                        // "I see you" callout, shared cooldown (npc-controller.js)
                        const nowSy = performance.now();
                        if (this.sounds && nowSy - this._lastSeeYou > 1500) {
                            this._lastSeeYou = nowSy;
                            this.sounds.playRandom(['seeyou1.mp3', 'seeyou2.mp3', 'seeyou3.mp3'], { volume: 0.8, pitch: 0.95 + Math.random() * 0.1 });
                        }
                    }
                } else if (npc.state === 'attack') {
                    // lost sight: chase the last-known position if fresh and
                    // the personality is aggressive enough (npc-ai.js engageEnemy)
                    const stale = performance.now() - npc.lkpTime > NPC_LKP_MEMORY_MS;
                    if (!stale && npc.lkp && npc.pers.aggression > 0.4) {
                        const floor = this.collision.queryRay(npc.lkp.x, npc.lkp.y, npc.lkp.z, 0, -1, 0, 5);
                        npc.target = { x: npc.lkp.x, y: floor ? floor.y : npc.p.y, z: npc.lkp.z };
                        npc.state = 'walk';
                        this._setAnim(npc, 'Walk');
                    } else {
                        npc.state = 'idle';
                        npc.stateTime = 1;
                        this._setAnim(npc, 'Idle');
                    }
                }
            } else if (npc.state === 'attack') {
                npc.state = 'idle';
                npc.stateTime = 2;
                this._setAnim(npc, 'Idle');
            }

            if (npc.state === 'dying') {
                npc.stateTime -= dt;
                if (npc.stateTime <= 0) {
                    npc.state = 'dead';
                    npc.root.destroy();
                    if (npc.el) npc.el.remove();
                }
                continue;
            }
            if (npc.state === 'dead') continue;

            if (npc.state === 'attack') {
                const pp = this._playerPos();
                const dx = pp.x - npc.p.x, dz = pp.z - npc.p.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                // face the player (same smoothing as walking)
                const targetYaw = Math.atan2(-dx / (dist || 1), -dz / (dist || 1)) * 180 / Math.PI;
                let dyaw = targetYaw - npc.yaw;
                while (dyaw > 180) dyaw -= 360;
                while (dyaw < -180) dyaw += 360;
                npc.yaw += Math.max(-360 * dt, Math.min(360 * dt, dyaw));

                // advance until inside firing range; aggressive personalities
                // keep pushing to point-blank (npc-ai.js _pushing)
                const holdDist = npc.pers.aggression > 0.6 ? 6 : NPC_FIRE_RANGE * 0.85;
                if (dist > holdDist) {
                    const nx = dx / dist, nz = dz / dist;
                    npc.p.x += nx * NPC_WALK_SPEED * this.walkSpeedMul * dt;
                    npc.p.z += nz * NPC_WALK_SPEED * this.walkSpeedMul * dt;
                    const down = this.collision.queryRay(npc.p.x, npc.p.y + 1.2, npc.p.z, 0, -1, 0, 3);
                    if (down) npc.p.y += (down.y - npc.p.y) * Math.min(1, dt * 10);
                    const ccy = npc.p.y + this.npcHeight * 0.5;
                    if (this.collision.queryCapsule(npc.p.x, ccy, npc.p.z, this.npcHeight * 0.5 - this.npcRadius, this.npcRadius, this._push)) {
                        npc.p.x += this._push.x;
                        npc.p.z += this._push.z;
                    }
                    this._setAnim(npc, 'Walk');
                } else {
                    this._setAnim(npc, 'Idle');
                }

                // burst fire when roughly on target (npc-controller.js firing rules)
                npc.shootT -= dt;
                if (npc.shootT <= 0 && Math.abs(dyaw) < 15 && npc.reloadT <= 0 && dist <= NPC_FIRE_RANGE && npc.clearShot) {
                    npc.shootT = 0.45 + Math.random() * 0.4 * (1 + npc.pers.randomness);
                    npc.bullets--;
                    if (npc.bullets <= 0) npc.reloadT = NPC_RELOAD_TIME;
                    npc.flashOn = 0.05;
                    if (npc.muzzleLight) npc.muzzleLight.intensity = 3;
                    if (this.sounds) {
                        this.sounds.play('shoot.mp3', {
                            volume: 0.5 * Math.max(0.15, 1 - dist / 25),
                            pitch: 0.9 + Math.random() * 0.2
                        });
                    }
                    // distance-based hit chance
                    const chance = NPC_BASE_HIT_CHANCE * Math.max(0.25, 1 - dist / (NPC_SIGHT_RANGE * 1.4));
                    if (Math.random() < chance && this.onPlayerDamage) {
                        this.onPlayerDamage(NPC_SHOT_DAMAGE - 2 + Math.random() * 4, npc);
                    }
                }
            } else if (npc.state === 'idle') {
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
                    npc.p.x += nx * NPC_WALK_SPEED * this.walkSpeedMul * dt;
                    npc.p.z += nz * NPC_WALK_SPEED * this.walkSpeedMul * dt;

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

// ---- first-person viewmodel: arms + carbine, hitscan shooting ----

const VM_ASSET: [number, string] = [298983917, 'fps-carbine.glb'];
/** transform under the camera, from the original FPS project */
const VM_POS: [number, number, number] = [0.239, -0.563, -0.201];
const VM_ROT: [number, number, number] = [90, 2.89, 180];
const VM_SCALE = 0.02077540010213852;
/** player muzzle flash local transform inside the carbine (original project) */
const VM_FLASH_POS: [number, number, number] = [-1.9255, -69.4615, 15.0755];
const VM_FLASH_ROT: [number, number, number] = [90, 0, -87.11];
const VM_FLASH_SCALE = 100;
/** sub-clips inside the single 'allanims' track (original animActions map) */
const VM_CLIPS: any = {
    shoot: { start: 0, end: 0.25, loop: false, speed: 2 },
    reload: { start: 0.25, end: 2.25, loop: false, speed: 1 },
    idle: { start: 6, end: 6.8, loop: true, speed: 0.2 }
};
const VM_FIRE_INTERVAL = 0.16;
const VM_BALL_SPEED = 16;
const VM_BALL_RADIUS = 0.055;
const VM_MAG_SIZE = 30;
const VM_RANGE = 60;

class ViewmodelSystem {
    app: any;
    collision: any;
    cameraEntity: any;
    npcs: any;
    entity: any = null;
    anim: any = null;
    flash: any = null;
    ready = false;
    shooting = false;
    reloading = false;
    ammo = VM_MAG_SIZE;
    _current: any = null;
    _currentName = '';
    _cooldown = 0;
    _flashOn = 0;
    _ammoDiv: any = null;

    balls: any = null;
    sounds: any = null;
    onShoot: any = null;
    _dryT = 0;

    constructor(app: any, collision: any, cameraEntity: any, npcs: any, balls: any) {
        this.app = app;
        this.collision = collision;
        this.cameraEntity = cameraEntity;
        this.npcs = npcs;
        this.balls = balls;
        this._load();
        this._makeUi();
    }

    _url(id: number, fname: string) {
        let q = '';
        try {
            const cfg = (window as any).config;
            const bid = (cfg && (cfg.self?.branch?.id || cfg.self?.branchId)) || '87d9f884-5657-4343-887e-e823e912488f';
            q = `?branchId=${bid}`;
        } catch (e) { /* default */ }
        return `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
    }

    _load() {
        const [id, fname] = VM_ASSET;
        const asset = new pc.Asset(fname, 'container', { url: this._url(id, fname), filename: fname });
        asset.on('load', () => this._build(asset));
        asset.on('error', (err: string) => console.error('viewmodel asset failed:', err));
        this.app.assets.add(asset);
        this.app.assets.load(asset);
    }

    _build(asset: any) {
        try {
            const vm = asset.resource.instantiateRenderEntity();
            this.cameraEntity.addChild(vm);
            vm.setLocalPosition(VM_POS[0], VM_POS[1], VM_POS[2]);
            vm.setLocalEulerAngles(VM_ROT[0], VM_ROT[1], VM_ROT[2]);
            vm.setLocalScale(VM_SCALE, VM_SCALE, VM_SCALE);
            this.entity = vm;

            vm.addComponent('anim', { activate: true });
            const anims = asset.resource.animations;
            if (anims && anims.length) {
                vm.anim.assignAnimation('All', anims[0].resource);
            }
            this.anim = vm.anim;

            this.ready = true;
            this.play('idle');
            console.log('viewmodel: carbine attached');
            this._loadFlash(vm);
        } catch (e) {
            console.error('viewmodel build failed', e);
        }
    }

    /** loads its own muzzle-flash container (name-sharing with the npc asset
     *  can resolve to the editor's raw copy, which is not a container) */
    _loadFlash(vm: any) {
        try {
            const [id, fname] = NPC_ASSET_IDS.flash;
            const asset = new pc.Asset('vm-muzzle-flash', 'container', { url: this._url(id, fname), filename: fname });
            asset.on('load', () => {
                try {
                    if (!asset.resource || typeof asset.resource.instantiateRenderEntity !== 'function') {
                        console.warn('viewmodel: flash resource is not a container, skipping');
                        return;
                    }
                    const fl = asset.resource.instantiateRenderEntity();
                    vm.addChild(fl);
                    fl.setLocalPosition(VM_FLASH_POS[0], VM_FLASH_POS[1], VM_FLASH_POS[2]);
                    fl.setLocalEulerAngles(VM_FLASH_ROT[0], VM_FLASH_ROT[1], VM_FLASH_ROT[2]);
                    fl.setLocalScale(VM_FLASH_SCALE, VM_FLASH_SCALE, VM_FLASH_SCALE);
                    fl.enabled = false;
                    this.flash = fl;
                } catch (e) {
                    console.warn('viewmodel: flash attach failed', e);
                }
            });
            asset.on('error', (err: string) => console.warn('viewmodel: flash load failed', err));
            this.app.assets.add(asset);
            this.app.assets.load(asset);
        } catch (e) {
            console.warn('viewmodel: flash setup failed', e);
        }
    }

    _makeUi() {
        this._ammoDiv = document.createElement('div');
        this._ammoDiv.className = 'sg sg-panel';
        this._ammoDiv.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:9999;padding:10px 14px;pointer-events:none;';
        document.body.appendChild(this._ammoDiv);
        this._updateAmmo();

        const ret = document.createElement('div');
        ret.className = 'fs-reticle';
        document.body.appendChild(ret);
    }

    _updateAmmo() {
        if (!this._ammoDiv) return;
        const pct = Math.max(0, Math.min(100, (this.ammo / VM_MAG_SIZE) * 100));
        const label = this.reloading
            ? '<span style="color:var(--muted-fg)">Reloading…</span>'
            : `<b style="color:var(--foreground);font-size:16px;font-weight:600">${this.ammo}</b><span style="color:var(--muted-fg)"> / ${VM_MAG_SIZE}</span>`;
        this._ammoDiv.innerHTML =
            `<div style="font-size:11px;font-weight:500;color:var(--muted-fg);display:flex;justify-content:space-between;align-items:baseline;gap:18px;margin-bottom:6px"><span>Ammo</span><span class="sg-mono">${label}</span></div>` +
            `<div class="sg-progress" style="width:132px"><div style="width:${pct}%;${this.reloading ? 'opacity:0.25' : ''}"></div></div>`;
    }

    play(name: string) {
        const c = VM_CLIPS[name];
        if (!c || !this.anim || !this.anim.baseLayer) return;
        this._current = c;
        this._currentName = name;
        this.anim.baseLayer.activeStateCurrentTime = c.start;
        this.anim.speed = c.speed;
        this.anim.baseLayer.playing = true;
    }

    setShooting(on: boolean) {
        this.shooting = on;
    }

    reload() {
        if (!this.ready || this.reloading || this.ammo === VM_MAG_SIZE) return;
        this.reloading = true;
        this.play('reload');
        if (this.sounds) this.sounds.playRandom(['carbineReloadA.wav', 'carbineReloadB.wav'], { volume: 0.7 });
        this._updateAmmo();
    }

    _fire() {
        this.ammo--;
        this._cooldown = VM_FIRE_INTERVAL;
        this.play('shoot');
        if (this.sounds) this.sounds.play('shoot3.wav', { volume: 0.55, pitch: 0.92 + Math.random() * 0.16 });

        // launch a physics ball from the gun muzzle, aimed at the crosshair
        if (this.balls) {
            const f = this.cameraEntity.forward;
            let ox, oy, oz;
            if (this.flash) {
                // the (invisible) muzzle-flash node marks the barrel tip
                const mp = this.flash.getPosition();
                ox = mp.x; oy = mp.y; oz = mp.z;
            } else {
                // fallback: offset toward the lower-right where the gun sits
                const p = this.cameraEntity.getPosition();
                const r = this.cameraEntity.right;
                const u = this.cameraEntity.up;
                ox = p.x + r.x * 0.22 - u.x * 0.18 + f.x * 0.3;
                oy = p.y + r.y * 0.22 - u.y * 0.18 + f.y * 0.3;
                oz = p.z + r.z * 0.22 - u.z * 0.18 + f.z * 0.3;
            }
            // if a wall sits between the camera and the muzzle (player hugging
            // geometry), clamp the spawn to the near side of that wall
            const cp = this.cameraEntity.getPosition();
            const sx = ox - cp.x, sy = oy - cp.y, sz = oz - cp.z;
            const sd = Math.sqrt(sx * sx + sy * sy + sz * sz);
            if (sd > 1e-6) {
                const wallHit = this.collision.queryRay(cp.x, cp.y, cp.z, sx / sd, sy / sd, sz / sd, sd + VM_BALL_RADIUS);
                if (wallHit) {
                    const wx = wallHit.x - cp.x, wy = wallHit.y - cp.y, wz = wallHit.z - cp.z;
                    const wd = Math.sqrt(wx * wx + wy * wy + wz * wz);
                    if (wd < sd + VM_BALL_RADIUS) {
                        const t = Math.max(0, (wd - VM_BALL_RADIUS * 2) / sd);
                        ox = cp.x + sx * t; oy = cp.y + sy * t; oz = cp.z + sz * t;
                    }
                }
            }
            // converge on the crosshair: aim the ball from the muzzle at the
            // exact point the camera ray hits (or a far point if nothing hit)
            let tx = cp.x + f.x * VM_RANGE, ty = cp.y + f.y * VM_RANGE, tz = cp.z + f.z * VM_RANGE;
            const aimHit = this.collision.queryRay(cp.x, cp.y, cp.z, f.x, f.y, f.z, VM_RANGE);
            if (aimHit) {
                const ax = aimHit.x - cp.x, ay = aimHit.y - cp.y, az = aimHit.z - cp.z;
                if (ax * ax + ay * ay + az * az > 1) { // ignore point-blank hits
                    tx = aimHit.x; ty = aimHit.y; tz = aimHit.z;
                }
            }
            let dx = tx - ox, dy = ty - oy, dz = tz - oz;
            const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dl > 1e-6) { dx /= dl; dy /= dl; dz /= dl; }
            else { dx = f.x; dy = f.y; dz = f.z; }
            this.balls.throwBall({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }, VM_BALL_SPEED, VM_BALL_RADIUS);
            if (this.onShoot) this.onShoot(ox, oy, oz, dx, dy, dz);
        }

        this._updateAmmo();
        if (this.ammo <= 0) this.reload();
    }

    step(dt: number) {
        if (!this.ready) return;

        if (this._cooldown > 0) this._cooldown -= dt;

        // sub-clip end handling on the shared timeline
        const layer = this.anim && this.anim.baseLayer;
        if (layer && this._current) {
            const t = layer.activeStateCurrentTime;
            const c = this._current;
            if (t >= c.end) {
                if (c.loop) {
                    layer.activeStateCurrentTime = c.start;
                } else if (this._currentName === 'reload') {
                    this.reloading = false;
                    this.ammo = VM_MAG_SIZE;
                    this._updateAmmo();
                    this.play('idle');
                } else {
                    this.play('idle');
                }
            }
        }

        if (this.shooting && !this.reloading && this._cooldown <= 0 && this.ammo > 0) {
            this._fire();
        } else if (this.shooting && this.reloading) {
            this._dryT -= dt;
            if (this._dryT <= 0 && this.sounds) {
                this._dryT = 0.4;
                this.sounds.play('dryfire.wav', { volume: 0.45 });
            }
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
        el.className = 'sg sg-mono';
        el.style.cssText = 'position:fixed;transform:translate(-50%,-140%);z-index:9998;font-family:var(--font);font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;background:rgba(9,9,11,0.9);pointer-events:none;white-space:nowrap;color:var(--foreground);border:1px solid var(--border);';
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

// ---- target practice: archery targets along the hallway ----

const TARGET_ASSET: [number, string] = [298986925, 'target-archery.glb'];
const TARGET_COUNT = 6;
/** target height range as fractions of corridor clearance (small → medium) */
const TARGET_HEIGHT_MIN = 0.3;   // metres
const TARGET_HEIGHT_MAX = 0.6;   // metres
/** chance a target sits on the floor instead of floating */
const TARGET_FLOOR_CHANCE = 0.35;
/** every target faces this yaw (all identical, tweak via walk.targets.setYaw) */
const TARGET_YAW = 0;

class TargetSystem {
    app: any;
    collision: any;
    sounds: any;
    onHit: any = null;
    active = false;
    ready = false;
    yaw = TARGET_YAW;
    targets: any[] = [];
    _asset: any = null;
    _stats: any = null;

    constructor(app: any, collision: any, sounds: any) {
        this.app = app;
        this.collision = collision;
        this.sounds = sounds;
        this._load();
    }

    _url(id: number, fname: string) {
        let q = '';
        try {
            const cfg = (window as any).config;
            const bid = (cfg && (cfg.self?.branch?.id || cfg.self?.branchId)) || '87d9f884-5657-4343-887e-e823e912488f';
            q = `?branchId=${bid}`;
        } catch (e) { /* default */ }
        return `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
    }

    _load() {
        const [id, fname] = TARGET_ASSET;
        const asset = new pc.Asset(fname, 'container', { url: this._url(id, fname), filename: fname });
        asset.on('load', () => {
            this._asset = asset;
            this.ready = true;
            if (this.active) this._spawnAll();
        });
        asset.on('error', (err: string) => console.error('target asset failed:', err));
        this.app.assets.add(asset);
        this.app.assets.load(asset);
    }

    _corridorStats() {
        if (this._stats) return this._stats;
        const col = this.collision;
        const res = col.voxelResolution;
        const midY = col.gridMinY + col.numVoxelsY * res * 0.5;
        const gMaxX = col.gridMinX + col.numVoxelsX * res;
        const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;
        const cs: number[] = [];
        const floors: number[] = [];
        for (let i = 0; i < 200 && cs.length < 30; i++) {
            const x = col.gridMinX + 0.5 + Math.random() * (gMaxX - col.gridMinX - 1);
            const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
            const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
            const up = col.queryRay(x, midY, z, 0, 1, 0, 30);
            if (!down || !up) continue;
            const c = up.y - down.y;
            if (c > 0.8) { cs.push(c); floors.push(down.y); }
        }
        cs.sort((a, b) => a - b);
        floors.sort((a, b) => a - b);
        this._stats = cs.length >= 5 ?
            { clearance: cs[Math.floor(cs.length / 2)], floor: floors[Math.floor(floors.length / 2)] } :
            { clearance: 2.4, floor: col.gridMinY };
        return this._stats;
    }

    _validSpot(x: number, z: number, height: number) {
        const col = this.collision;
        const res = col.voxelResolution;
        const midY = col.gridMinY + col.numVoxelsY * res * 0.5;
        const stats = this._corridorStats();
        const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
        if (!down) return null;
        if (Math.abs(down.y - stats.floor) > 0.4) return null;
        const up = col.queryRay(x, down.y + 0.2, z, 0, 1, 0, 30);
        const ceil = up ? up.y : down.y + stats.clearance;
        if (ceil - down.y < height + 0.15) return null;
        if (!col.isFreeAt(x, down.y + 0.5, z)) return null;
        return { x, y: down.y, z, ceil };
    }

    _randomSpot(height: number, avoid: any[]) {
        const col = this.collision;
        const res = col.voxelResolution;
        const gMaxX = col.gridMinX + col.numVoxelsX * res;
        const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;
        for (let i = 0; i < 120; i++) {
            const x = col.gridMinX + 0.4 + Math.random() * (gMaxX - col.gridMinX - 0.8);
            const z = col.gridMinZ + 1.5 + Math.random() * (gMaxZ - col.gridMinZ - 3);
            const s = this._validSpot(x, z, height);
            if (!s) continue;
            // keep targets spread out
            let tooClose = false;
            for (const t of avoid) {
                const dx = t.p.x - s.x, dz = t.p.z - s.z;
                if (dx * dx + dz * dz < 2.25) { tooClose = true; break; }
            }
            if (!tooClose) return s;
        }
        return null;
    }

    enter() {
        this.active = true;
        if (this.ready) this._spawnAll();
    }

    exit() {
        this.active = false;
        for (const t of this.targets) {
            try { t.root.destroy(); } catch (e) { /* gone */ }
        }
        this.targets.length = 0;
    }

    _spawnAll() {
        while (this.targets.length < TARGET_COUNT) {
            if (!this._spawnOne()) break;
        }
        console.log('targetSystem:', this.targets.length, 'targets up');
    }

    _spawnOne() {
        const stats = this._corridorStats();
        // varied sizes: absolute metric range, capped by the corridor
        const height = Math.min(
            stats.clearance * 0.45,
            TARGET_HEIGHT_MIN + Math.random() * (TARGET_HEIGHT_MAX - TARGET_HEIGHT_MIN)
        );
        const spot = this._randomSpot(height, this.targets);
        if (!spot || !this._asset) return false;

        // varied elevation: some on the floor, the rest floating at random
        // heights — but always fully inside the room
        const headroom = (spot.ceil ?? (spot.y + stats.clearance)) - spot.y - height - 0.25;
        const hover = (Math.random() < TARGET_FLOOR_CHANCE || headroom <= 0)
            ? 0
            : Math.random() * Math.max(0, headroom);
        const baseY = spot.y + hover;

        const root = new pc.Entity('target');
        const model = this._asset.resource.instantiateRenderEntity();
        root.addChild(model);
        this.app.root.addChild(root);
        root.setPosition(spot.x, baseY, spot.z);
        // identical orientation for every target
        root.setEulerAngles(0, this.yaw, 0);

        this.targets.push({
            root, model,
            p: { x: spot.x, y: baseY, z: spot.z },
            height,
            hitR: height * 0.55,
            fit: { phase: 'scale', wait: 3 }
        });
        return true;
    }

    setYaw(deg: number) {
        this.yaw = deg;
        for (const t of this.targets) t.root.setEulerAngles(0, deg, 0);
    }

    _measure(model: any) {
        let min: any = null, max: any = null;
        for (const r of model.findComponents('render')) {
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

    step(dt: number, balls: any[]) {
        if (!this.active) return;

        for (const t of this.targets) {
            if (!t.fit) continue;
            const fit = t.fit;
            if (fit.wait > 0) { fit.wait--; continue; }
            const m = this._measure(t.model);
            if (!m || !isFinite(m.ext.y) || m.ext.y <= 0.005) { fit.wait = 3; continue; }
            if (fit.phase === 'scale') {
                const cur = t.model.getLocalScale().x;
                const s = cur * (t.height / m.ext.y);
                t.model.setLocalScale(s, s, s);
                fit.phase = 'ground';
                fit.wait = 2;
            } else if (fit.phase === 'ground') {
                const ws = new pc.Vec3(t.p.x - m.center.x, t.p.y - m.minY, t.p.z - m.center.z);
                const inv = t.root.getRotation().clone().invert();
                const ls = inv.transformVector(ws, new pc.Vec3());
                const lp = t.model.getLocalPosition();
                t.model.setLocalPosition(lp.x + ls.x, lp.y + ls.y, lp.z + ls.z);
                t.fit = null;
            }
        }

        // ball hits: center of the target board is at ~2/3 height
        for (let i = this.targets.length - 1; i >= 0; i--) {
            const t = this.targets[i];
            if (t.fit) continue;
            const cy = t.p.y + t.height * 0.6;
            for (const b of balls) {
                const sp = b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z;
                if (sp < 4) continue;
                const dx = b.p.x - t.p.x, dy = b.p.y - cy, dz = b.p.z - t.p.z;
                if (dx * dx + dy * dy + dz * dz < (t.hitR + b.r) * (t.hitR + b.r)) {
                    if (this.sounds) this.sounds.play('shoot-end.wav', { volume: 0.7, pitch: 1.1 + Math.random() * 0.2 });
                    if (this.onHit) this.onHit(t);
                    try { t.root.destroy(); } catch (e) { /* gone */ }
                    this.targets.splice(i, 1);
                    this._spawnOne(); // pop up somewhere else
                    break;
                }
            }
        }
    }
}

// ---- voxel debug view: visualize the collision grid around the player ----

const VOXVIEW_RADIUS = 9;       // metres around the camera
const VOXVIEW_REBUILD_DIST = 2.5;
const VOXVIEW_MAX_FACES = 150000;

class VoxelDebugView {
    app: any;
    collision: any;
    enabled = false;
    entity: any = null;
    _lastPos = { x: 1e9, y: 1e9, z: 1e9 };

    _gridTex: any = null;

    constructor(app: any, collision: any) {
        this.app = app;
        this.collision = collision;
    }

    /** 64x64 canvas texture: translucent white fill, dark cell border */
    _gridTexture() {
        if (this._gridTex) return this._gridTex;
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const g = c.getContext('2d')!;
        g.clearRect(0, 0, 64, 64);
        g.fillStyle = 'rgba(255,255,255,0.30)';
        g.fillRect(0, 0, 64, 64);
        g.strokeStyle = 'rgba(25,25,30,0.9)';
        g.lineWidth = 5;
        g.strokeRect(0, 0, 64, 64);
        const tex = new pc.Texture(this.app.graphicsDevice, {
            width: 64, height: 64,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: true
        });
        tex.setSource(c);
        tex.minFilter = pc.FILTER_LINEAR_MIPMAP_LINEAR;
        tex.magFilter = pc.FILTER_LINEAR;
        this._gridTex = tex;
        return tex;
    }

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled) this._clear();
        else this._lastPos.x = 1e9; // force rebuild on next update
        return this.enabled;
    }

    _clear() {
        if (this.entity) {
            this.entity.destroy();
            this.entity = null;
        }
    }

    update(entity: any) {
        if (!this.enabled) return;
        const camPos = entity.getPosition();
        const dx = camPos.x - this._lastPos.x;
        const dy = camPos.y - this._lastPos.y;
        const dz = camPos.z - this._lastPos.z;
        if (dx * dx + dy * dy + dz * dz < VOXVIEW_REBUILD_DIST * VOXVIEW_REBUILD_DIST) return;
        this._lastPos = { x: camPos.x, y: camPos.y, z: camPos.z };
        this._rebuild(camPos);
    }

    _rebuild(camPos: any) {
        const col = this.collision;
        const res = col.voxelResolution;

        const ix0 = Math.max(0, Math.floor((camPos.x - VOXVIEW_RADIUS - col.gridMinX) / res));
        const iy0 = Math.max(0, Math.floor((camPos.y - VOXVIEW_RADIUS - col.gridMinY) / res));
        const iz0 = Math.max(0, Math.floor((camPos.z - VOXVIEW_RADIUS - col.gridMinZ) / res));
        const ix1 = Math.min(col.numVoxelsX - 1, Math.floor((camPos.x + VOXVIEW_RADIUS - col.gridMinX) / res));
        const iy1 = Math.min(col.numVoxelsY - 1, Math.floor((camPos.y + VOXVIEW_RADIUS - col.gridMinY) / res));
        const iz1 = Math.min(col.numVoxelsZ - 1, Math.floor((camPos.z + VOXVIEW_RADIUS - col.gridMinZ) / res));

        // exposed-face quads: [dx,dy,dz, 4 corner offsets]
        const FACES = [
            [1, 0, 0, [1,0,0], [1,1,0], [1,1,1], [1,0,1]],
            [-1, 0, 0, [0,0,1], [0,1,1], [0,1,0], [0,0,0]],
            [0, 1, 0, [0,1,0], [0,1,1], [1,1,1], [1,1,0]],
            [0, -1, 0, [0,0,0], [1,0,0], [1,0,1], [0,0,1]],
            [0, 0, 1, [1,0,1], [1,1,1], [0,1,1], [0,0,1]],
            [0, 0, -1, [0,0,0], [0,1,0], [1,1,0], [1,0,0]]
        ];

        const positions: number[] = [];
        const uvs: number[] = [];
        const normals: number[] = [];
        const indices: number[] = [];
        const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
        let faces = 0;

        outer:
        for (let iz = iz0; iz <= iz1; iz++) {
            for (let iy = iy0; iy <= iy1; iy++) {
                for (let ix = ix0; ix <= ix1; ix++) {
                    if (!col.isVoxelSolid(ix, iy, iz)) continue;
                    for (const f of FACES) {
                        if (col.isVoxelSolid(ix + (f[0] as number), iy + (f[1] as number), iz + (f[2] as number))) continue;
                        const base = positions.length / 3;
                        for (let c = 3; c < 7; c++) {
                            const o = f[c] as number[];
                            positions.push(
                                col.gridMinX + (ix + o[0]) * res,
                                col.gridMinY + (iy + o[1]) * res,
                                col.gridMinZ + (iz + o[2]) * res
                            );
                            uvs.push(CORNER_UV[c - 3][0], CORNER_UV[c - 3][1]);
                            normals.push(f[0] as number, f[1] as number, f[2] as number);
                        }
                        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
                        if (++faces >= VOXVIEW_MAX_FACES) break outer;
                    }
                }
            }
        }

        this._clear();
        if (!positions.length) return;

        try {
            const mesh = new pc.Mesh(this.app.graphicsDevice);
            mesh.setPositions(positions);
            mesh.setNormals(normals);
            mesh.setUvs(0, uvs);
            mesh.setIndices(indices);
            mesh.update(pc.PRIMITIVE_TRIANGLES);

            // supersplat-style: translucent white cells with dark grid edges
            const mat = new pc.StandardMaterial();
            mat.diffuse.set(0, 0, 0);
            mat.emissive.set(1, 1, 1);
            mat.emissiveMap = this._gridTexture();
            mat.opacityMap = this._gridTexture();
            mat.opacityMapChannel = 'a';
            mat.blendType = pc.BLEND_NORMAL;
            mat.depthWrite = false;
            mat.cull = pc.CULLFACE_NONE;
            mat.update();

            const mi = new pc.MeshInstance(mesh, mat);
            const e = new pc.Entity('voxel-debug');
            e.addComponent('render', { meshInstances: [mi] });
            this.app.root.addChild(e);
            this.entity = e;
            console.log('voxelView:', faces, 'faces');
        } catch (e) {
            console.warn('voxelView rebuild failed', e);
        }
    }
}

// ---- scene manager: switch between scanned locations (splat + collision) ----

const SCENES: any[] = [
    {
        name: 'Bahen 5F',
        gsplatId: 298979100,
        voxel: 'embedded',
        spawn: { x: -0.22, y: 0.75, z: 0.05 },
        rot: [0, 0, 180],
        faceTarget: { x: -0.1, z: -10 } // spawn/respawn looking down the hallway
    },
    {
        name: 'Myhal',
        gsplatId: 298987089,
        voxelJson: [298987090, 'myhal.voxel.json'],
        voxelBin: [298987091, 'myhal.voxel.bin'],
        spawn: null, // grid center
        rot: [0, 0, 180]
    },
    {
        name: 'Bahen Front',
        gsplatId: 298987672,
        voxelJson: [298987673, 'bahen-front.voxel.json'],
        voxelBin: [298987674, 'bahen-front.voxel.bin'],
        spawn: null, // grid center
        rot: [0, 0, 180],
        noSoldiers: true,
        faceTarget: { x: 2.64, z: 7.08 }, // spawn facing the door portal
        portals: [
            { x: 2.64, y: 1.65, z: 7.08, radius: 1.4, to: 5, spawnAt: { x: 0.04, y: 0.21, z: 1.22 }, label: '→ Bahen Stairs' }
        ]
    },
    {
        name: 'Bahen Classroom',
        gsplatId: 298987763,
        voxelJson: [298987764, 'classroom.voxel.json'],
        voxelBin: [298987765, 'classroom.voxel.bin'],
        spawn: { x: -1.54, y: 0.3, z: -6.26 },
        rot: [0, 0, 180],
        faceTarget: { x: 0.8, z: 1.5 }, // spawn facing into the room (the tables)
        portals: [
            { x: -1.54, y: 0.3, z: -6.26, radius: 1.4, to: 4, spawnAt: { x: 9.46, y: 0.42, z: 7.25 }, label: '→ Bahen Hallway' }
        ]
    },
    {
        name: 'Bahen Hallway',
        gsplatId: 298988208,
        voxelJson: [298988209, 'bahen-hallway.voxel.json'],
        voxelBin: [298988210, 'bahen-hallway.voxel.bin'],
        spawn: { x: -1.26, y: 0.36, z: -2.72 },
        rot: [0, 0, 180],
        faceTarget: { x: 9.46, z: 7.25 }, // spawn/respawn facing the classroom door
        portals: [
            { x: 9.46, y: 0.42, z: 7.25, radius: 1.4, to: 3, label: '→ Classroom' },
            { x: 1.67, y: 0.45, z: 0.77, radius: 1.4, to: 0, label: '→ Bahen 5F' }
        ]
    },
    {
        name: 'Bahen Stairs',
        gsplatId: 298999341,
        voxelJson: [298999343, 'bahen-stairs.voxel.json'],
        voxelBin: [298999344, 'bahen-stairs.voxel.bin'],
        spawn: { x: 0.04, y: 0.21, z: 1.22 },
        rot: [0, 0, 180],
        noSoldiers: true,
        noNpcs: true, // no friends / requisitioned units either
        portals: [
            { x: -3.58, y: 4.35, z: 16.07, radius: 1.4, to: 4, spawnAt: { x: 8.55, y: 0.49, z: 11.71 }, label: '→ Bahen Hallway' }
        ]
    }
];

class SceneManager {
    app: any;
    collision: any;
    controller: any;
    walkCamera: any;
    script: any;
    current = 0;
    _busy = false;
    _queued: any = null;
    _select: any = null;
    _portals: any[] = [];
    _screenPos: any = null;

    constructor(app: any, collision: any, controller: any, walkCamera: any, script: any) {
        this.app = app;
        this.collision = collision;
        this.controller = controller;
        this.walkCamera = walkCamera;
        this.script = script;
        this._makeDropdown();
    }

    _cards: any[] = [];
    _thumbs: any = {};
    _sidebar: any = null;
    _cardsWrap: any = null;

    _makeDropdown() {
        injectUiCss();
        const sb = document.createElement('div');
        sb.id = 'sg-sidebar';
        sb.className = 'sg sg-panel hidden';
        sb.innerHTML = '<h3>Locations <span>M to close</span></h3>';
        const wrap = document.createElement('div');
        wrap.id = 'sg-cards';
        sb.appendChild(wrap);

        const dz = document.createElement('div');
        dz.id = 'sg-dropzone';
        dz.innerHTML = '<span style="color:var(--foreground);font-weight:500">Drop a scan .zip</span><br><span style="font-size:10px">.sog + voxel data becomes a new location</span>';
        dz.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = '.zip';
            inp.onchange = () => {
                const f = inp.files && inp.files[0];
                const drops = (this.script as any)._drops;
                if (f && drops) drops._import(f);
            };
            inp.click();
        });
        dz.addEventListener('dragover', (e: any) => { e.preventDefault(); dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', (e: any) => {
            e.preventDefault();
            dz.classList.remove('over');
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            const drops = (this.script as any)._drops;
            if (f && drops) drops._import(f);
        });
        sb.appendChild(dz);

        const req = (this.script as any)._requisition;
        if (req) req.makeCard(sb);

        document.body.appendChild(sb);
        this._sidebar = sb;
        this._cardsWrap = wrap;
        SCENES.forEach((_, i) => this.addCard(i));
        this._setActive(this.current);
    }

    addCard(i: number) {
        const s = SCENES[i];
        const card = document.createElement('div');
        card.className = 'sg-card';

        let thumb = this._thumbs[s.name];
        try { thumb = thumb || localStorage.getItem('sg-thumb-' + s.name); } catch (e) { /* private */ }
        if (thumb) {
            this._thumbs[s.name] = thumb;
            card.innerHTML = `<img class="sg-thumb" src="${thumb}">`;
        } else {
            const initials = s.name.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 3);
            card.innerHTML = `<div class="sg-thumb-ph">${initials}</div>`;
        }

        const chip = s.gsplatAsset ? '<span class="sg-chip drop">Imported</span>'
            : s.noSoldiers ? '<span class="sg-chip safe">Safe</span>'
            : '<span class="sg-chip combat">Combat</span>';
        const row = document.createElement('div');
        row.className = 'sg-card-row';
        row.innerHTML = `<span><span style="color:var(--muted-fg)" class="sg-mono">${String(i + 1).padStart(2, '0')}&nbsp;&nbsp;</span>${s.name}</span>${chip}`;
        card.appendChild(row);

        card.addEventListener('click', () => {
            this.toggleSidebar(false);
            this.switchTo(i);
        });
        this._cardsWrap.appendChild(card);
        this._cards[i] = card;
    }

    _setActive(i: number) {
        this._cards.forEach((c, idx) => {
            if (c) c.classList.toggle('active', idx === i);
        });
    }

    toggleSidebar(force?: boolean) {
        if (!this._sidebar) return;
        const show = force !== undefined ? force : this._sidebar.classList.contains('hidden');
        this._sidebar.classList.toggle('hidden', !show);
        if (show) {
            try { document.exitPointerLock(); } catch (e) { /* noop */ }
        }
    }

    _setThumb(name: string, url: string) {
        this._thumbs[name] = url;
        try { localStorage.setItem('sg-thumb-' + name, url); } catch (e) { /* full */ }
        const i = SCENES.findIndex(s => s.name === name);
        const card = this._cards[i];
        if (card) {
            const ph = card.querySelector('.sg-thumb-ph');
            if (ph) {
                const img = document.createElement('img');
                img.className = 'sg-thumb';
                img.src = url;
                ph.replaceWith(img);
            } else {
                const img = card.querySelector('.sg-thumb');
                if (img) img.src = url;
            }
        }
    }

    /** capture the framebuffer shortly after arriving in a scene */
    _maybeCapture() {
        const scene = SCENES[this.current];
        if (!scene || this._thumbs[scene.name]) return;
        const dev = this.app.graphicsDevice;
        const gl = dev.gl;
        if (!gl) return;
        const handler = () => {
            this.app.off('postrender', handler);
            try {
                const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
                const px = new Uint8Array(w * h * 4);
                gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
                // blank check: sample a few pixels
                let lum = 0;
                for (let i = 0; i < 40; i++) {
                    const o = ((Math.random() * w * h) | 0) * 4;
                    lum += px[o] + px[o + 1] + px[o + 2];
                }
                if (lum < 200) return; // black frame — skip, retry next visit
                const full = document.createElement('canvas');
                full.width = w; full.height = h;
                const fctx: any = full.getContext('2d');
                const img = fctx.createImageData(w, h);
                for (let y = 0; y < h; y++) {
                    img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
                }
                fctx.putImageData(img, 0, 0);
                const t = document.createElement('canvas');
                t.width = 256; t.height = 110;
                (t.getContext('2d') as any).drawImage(full, 0, 0, 256, 110);
                this._setThumb(scene.name, t.toDataURL('image/jpeg', 0.65));
            } catch (e) { /* capture is best-effort */ }
        };
        this.app.on('postrender', handler);
    }

    _assetUrl(id: number, fname: string) {
        let q = '';
        try {
            const cfg = (window as any).config;
            const bid = (cfg && (cfg.self?.branch?.id || cfg.self?.branchId)) || '87d9f884-5657-4343-887e-e823e912488f';
            q = `?branchId=${bid}`;
        } catch (e) { /* default */ }
        return `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
    }

    async _loadVoxel(scene: any) {
        if (scene.voxelData) return scene.voxelData;
        if (scene.voxel === 'embedded') {
            const data = (window as any).UNI3_VOXEL;
            const bin = atob(data.binBase64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const view = new Uint32Array(bytes.buffer);
            const meta = data.meta;
            return {
                meta,
                nodes: view.slice(0, meta.nodeCount),
                leafData: view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount)
            };
        }
        const metaResp = await fetch(this._assetUrl(scene.voxelJson[0], scene.voxelJson[1]));
        const meta = await metaResp.json();
        const binResp = await fetch(this._assetUrl(scene.voxelBin[0], scene.voxelBin[1]));
        const buffer = await binResp.arrayBuffer();
        const view = new Uint32Array(buffer);
        scene.voxelData = {
            meta,
            nodes: view.slice(0, meta.nodeCount),
            leafData: view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount)
        };
        return scene.voxelData;
    }

    /** doorway-blink: fade the world to black and back */
    _fadeEl: any = null;
    _fade(to: number, ms: number) {
        try {
            if (!this._fadeEl) {
                const f = document.createElement('div');
                f.style.cssText = 'position:fixed;inset:0;z-index:10003;background:#000;opacity:0;pointer-events:none;';
                document.body.appendChild(f);
                this._fadeEl = f;
            }
            const f = this._fadeEl;
            f.style.transition = `opacity ${ms}ms ease`;
            f.style.opacity = String(to);
        } catch (e) { /* headless */ }
        return new Promise(r => setTimeout(r, ms + 20));
    }

    _applyCollision(meta: any, nodes: any, leafData: any) {
        const c: any = this.collision;
        const res = meta.voxelResolution;
        c._gridMinX = meta.gridBounds.min[0];
        c._gridMinY = meta.gridBounds.min[1];
        c._gridMinZ = meta.gridBounds.min[2];
        c._numVoxelsX = Math.round((meta.gridBounds.max[0] - meta.gridBounds.min[0]) / res);
        c._numVoxelsY = Math.round((meta.gridBounds.max[1] - meta.gridBounds.min[1]) / res);
        c._numVoxelsZ = Math.round((meta.gridBounds.max[2] - meta.gridBounds.min[2]) / res);
        c._voxelResolution = res;
        c._leafSize = meta.leafSize;
        c._treeDepth = meta.treeDepth;
        c._nodes = nodes;
        c._leafData = leafData;
    }

    _clearPortals() {
        for (const pt of this._portals) {
            if (pt.ent) { try { pt.ent.destroy(); } catch (e) { /* gone */ } }
            if (pt.el) pt.el.remove();
        }
        this._portals.length = 0;
    }

    _buildPortals(scene: any) {
        this._clearPortals();
        if (!scene.portals) return;
        for (const cfg of scene.portals) {
            let ent: any = null;
            try {
                ent = new pc.Entity('portal');
                ent.addComponent('render', { type: 'sphere' });
                const mat = new pc.StandardMaterial();
                mat.diffuse.set(0.1, 0.4, 1);
                mat.emissive.set(0.2, 0.5, 1);
                mat.blendType = pc.BLEND_NORMAL;
                mat.opacity = 0.35;
                mat.depthWrite = false;
                mat.update();
                ent.render.meshInstances[0].material = mat;
                ent.setLocalScale(cfg.radius * 1.4, cfg.radius * 1.4, cfg.radius * 1.4);
                ent.setPosition(cfg.x, cfg.y, cfg.z);
                this.app.root.addChild(ent);
            } catch (e) { ent = null; }

            const el = document.createElement('div');
            el.className = 'sg sg-mono';
            el.style.cssText = 'position:fixed;transform:translate(-50%,-120%);z-index:9998;font-family:var(--font);font-size:11px;font-weight:600;padding:3px 12px;border-radius:9999px;background:var(--primary);color:var(--primary-fg);pointer-events:none;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.5);';
            el.textContent = '⌖ ' + (cfg.label || 'portal').replace('→ ', '');
            document.body.appendChild(el);

            this._portals.push({ cfg, ent, el, armed: false });
        }
        if (!this._screenPos) this._screenPos = new pc.Vec3();
    }

    /** per-frame: project portal labels, trigger teleport on contact */
    update() {
        if (!this._portals.length || this._busy) return;
        const camEnt = this.script.entity;
        const camComp = camEnt.camera;
        const canvas = this.app.graphicsDevice.canvas;
        const p = this.walkCamera.position;

        for (const pt of this._portals) {
            const c = pt.cfg;
            if (pt.el && camComp && canvas) {
                camComp.worldToScreen(new pc.Vec3(c.x, c.y + 0.6, c.z), this._screenPos);
                if (this._screenPos.z < 0) {
                    pt.el.style.display = 'none';
                } else {
                    pt.el.style.display = 'block';
                    pt.el.style.left = `${this._screenPos.x * (canvas.clientWidth / canvas.width)}px`;
                    pt.el.style.top = `${this._screenPos.y * (canvas.clientHeight / canvas.height)}px`;
                }
            }
            const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (!pt.armed) {
                // arms once the player steps clear (prevents instant
                // bounce-back when a portal sits on the arrival spawn)
                if (d2 > c.radius * c.radius * 2.6) pt.armed = true;
                continue;
            }
            if (d2 < c.radius * c.radius) {
                this.switchTo(c.to, c.spawnAt || null);
                return;
            }
        }
    }

    /** warm the voxel grid + splat for every scene a portal here leads to */
    _prefetchDestinations(scene: any) {
        if (!scene.portals) return;
        for (const cfg of scene.portals) {
            const dest = SCENES[cfg.to];
            if (!dest) continue;
            if (!dest.voxelData && dest.voxel !== 'embedded') {
                this._loadVoxel(dest).catch(() => { /* retried on switch */ });
            }
            try {
                const a = dest.gsplatAsset || this.app.assets.get(dest.gsplatId);
                if (a && !a.resource && !a.loading) this.app.assets.load(a);
            } catch (e) { /* headless */ }
        }
    }

    async switchTo(i: number, spawnAt: any = null) {
        if (this._busy) {
            // never drop a request — run it as soon as the current one lands
            this._queued = { i, spawnAt };
            return;
        }
        if (i === this.current) return;
        this._busy = true;
        const scene = SCENES[i];
        const s: any = this.script;
        try {
            // soldiers vanish the moment the switch starts and the whole NPC
            // system freezes until the new scene is fully in place
            if (s._npcs) {
                s._npcs.suspended = true;
                s._npcs.reset();
                s._npcs.floorRange = scene.npcFloorY || null;
            }
            // blink shut like passing a doorway — everything below happens
            // behind black (destination data is usually prefetched already)
            await this._fade(1, 130);

            // 1) collision data
            const v = await this._loadVoxel(scene);
            this._applyCollision(v.meta, v.nodes, v.leafData);

            // 2) splat swap
            const splat = this.app.root.findByName('University 3');
            if (splat) {
                splat.setEulerAngles(scene.rot[0], scene.rot[1], scene.rot[2]);
                const asset = scene.gsplatAsset || this.app.assets.get(scene.gsplatId);
                if (asset) {
                    if (!asset.resource && !asset.loading) this.app.assets.load(asset);
                    splat.gsplat.asset = asset;
                }
            }

            // 3) clear scene-bound state
            if (s._balls) s._balls.clear();
            if (s._labels) {
                while (s._labels.markers.length) s._labels.deleteMarker(s._labels.markers[0]);
            }
            if (s._voxelView) {
                s._voxelView._lastPos = { x: 1e9, y: 1e9, z: 1e9 };
                if (s._voxelView.entity) { s._voxelView.entity.destroy(); s._voxelView.entity = null; }
            }
            if (s._npcs) {
                s._npcs.reset();
                s._npcs._measureHallway();
            }
            if (s._targets) {
                const wasActive = s._targets.active;
                if (wasActive) s._targets.exit();
                s._targets._stats = null;
                if (wasActive) s._targets.enter();
            }

            // 4) respawn the player
            const col = this.collision;
            const sp = spawnAt || scene.spawn || {
                x: col.gridMinX + col.numVoxelsX * col.voxelResolution * 0.5,
                y: col.gridMinY + col.numVoxelsY * col.voxelResolution * 0.5,
                z: col.gridMinZ + col.numVoxelsZ * col.voxelResolution * 0.5
            };
            this.walkCamera.position.set(sp.x, sp.y, sp.z);
            if (scene.faceTarget) {
                const fdx = scene.faceTarget.x - sp.x;
                const fdz = scene.faceTarget.z - sp.z;
                const yaw = Math.atan2(-fdx, -fdz) * 180 / Math.PI;
                this.walkCamera.angles.set(0, yaw, 0);
            }
            this.controller.onEnter(this.walkCamera);
            s._flyMode = false;

            // 5) game mode continuity (no-soldier zones stay quiet)
            const d = s._director;
            if (s._npcs) s._npcs.combatEnabled = !scene.noSoldiers && !!(d && (d.state === 'playing' || d.state === 'intermission'));
            if (d && (d.state === 'playing' || d.state === 'intermission')) {
                if (scene.noSoldiers) {
                    d.state = 'playing';
                    d._waveDelay = 0;
                    if (s._npcs) s._npcs.setPopulation(0);
                } else {
                    // fresh wave, spawned shortly AFTER the player has landed
                    d.wave = 0;
                    d.state = 'playing';
                    d._waveDelay = 0.6;
                }
            }

            // 6) portals for this scene, and prefetch wherever they lead
            this._buildPortals(scene);
            this._prefetchDestinations(scene);

            this._setActive(i);
            this.current = i;
            setTimeout(() => this._maybeCapture(), 1800);
            console.log('sceneManager: switched to', scene.name);
        } catch (e) {
            console.error('sceneManager switch failed', e);
        }
        // hold black a beat so the splat sorter has frames ready, then open up
        await new Promise(r => setTimeout(r, 140));
        this._fade(0, 300);
        if (s._npcs) s._npcs.suspended = false;
        this._busy = false;
        if (s._net && s._net.enabled) s._net.sendStateNow();
        const canvas = this.app.graphicsDevice.canvas;
        if (canvas) canvas.requestPointerLock();

        // run any switch that was requested while this one was loading
        if (this._queued) {
            const q = this._queued;
            this._queued = null;
            if (q.i !== this.current) this.switchTo(q.i, q.spawnAt);
        }
    }
}

// ---- UI kit: one stylesheet, one visual language ----

const UI_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
:root{
  --background:#09090b; --foreground:#fafafa;
  --card:rgba(9,9,11,0.92); --border:#27272a; --input:#27272a;
  --muted:#27272a; --muted-fg:#a1a1aa;
  --primary:#fafafa; --primary-fg:#18181b;
  --destructive:#ef4444; --ring:#d4d4d8;
  --ok:#34d399; --info:#60a5fa; --warn:#fbbf24;
  --radius:8px; --radius-md:6px; --radius-sm:4px;
  --font:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
}
.sg{font-family:var(--font);color:var(--foreground);font-feature-settings:'tnum';}
.sg-mono{font-family:var(--font);font-variant-numeric:tabular-nums;}
.sg-h{font-weight:600;letter-spacing:-0.01em;}
.sg-panel{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 1px 2px rgba(0,0,0,0.4);}
.sg-chip{display:inline-flex;align-items:center;padding:1px 8px;border-radius:9999px;font-size:10px;font-weight:600;border:1px solid var(--border);background:transparent;}
.sg-chip.safe{color:var(--ok);border-color:rgba(52,211,153,0.35);}
.sg-chip.combat{color:var(--destructive);border-color:rgba(239,68,68,0.35);}
.sg-chip.drop{color:var(--info);border-color:rgba(96,165,250,0.35);}
.sg-btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 18px;border-radius:var(--radius-md);background:var(--primary);color:var(--primary-fg);font-size:13px;font-weight:600;border:none;cursor:pointer;transition:opacity 0.15s;}
.sg-btn:hover{opacity:0.9;}
.sg-sep{height:1px;background:var(--border);}
#sg-sidebar{position:fixed;top:16px;right:16px;bottom:16px;width:256px;z-index:10007;display:flex;flex-direction:column;padding:16px;gap:12px;overflow:hidden;transition:transform 0.2s ease,opacity 0.2s ease;}
#sg-sidebar.hidden{transform:translateX(300px);opacity:0;pointer-events:none;}
#sg-sidebar h3{margin:0;font-size:13px;font-weight:600;letter-spacing:-0.01em;color:var(--foreground);display:flex;justify-content:space-between;align-items:baseline;}
#sg-sidebar h3 span{color:var(--muted-fg);font-weight:400;font-size:11px;}
#sg-cards{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px;}
#sg-cards::-webkit-scrollbar{width:4px;} #sg-cards::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}
.sg-card{border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;cursor:pointer;background:rgba(255,255,255,0.02);transition:border-color 0.15s,box-shadow 0.15s;flex-shrink:0;}
.sg-card:hover{border-color:#3f3f46;}
.sg-card.active{border-color:var(--ring);box-shadow:0 0 0 1px var(--ring);}
.sg-thumb{width:100%;height:92px;object-fit:cover;display:block;background:#18181b;}
.sg-thumb-ph{width:100%;height:92px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;letter-spacing:2px;color:#52525b;background:#18181b;}
.sg-card-row{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;font-size:12px;font-weight:500;}
#sg-dropzone,#sg-requisition{border:1px dashed #3f3f46;border-radius:var(--radius-md);padding:14px 10px;text-align:center;font-size:11px;color:var(--muted-fg);cursor:pointer;transition:border-color 0.15s,color 0.15s,background 0.15s;flex-shrink:0;}
#sg-dropzone:hover,#sg-dropzone.over,#sg-requisition:hover{border-color:var(--ring);color:var(--foreground);background:rgba(255,255,255,0.03);}
.fs-reticle{position:fixed;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;z-index:9998;pointer-events:none;border-radius:9999px;background:rgba(250,250,250,0.9);box-shadow:0 0 0 1px rgba(9,9,11,0.6);}
.sg-progress{height:8px;border-radius:9999px;background:var(--muted);overflow:hidden;}
.sg-progress>div{height:100%;border-radius:9999px;background:var(--primary);transition:width 0.15s;}
`;

function injectUiCss() {
    if (document.getElementById('sg-css')) return;
    const st = document.createElement('style');
    st.id = 'sg-css';
    st.textContent = UI_CSS;
    document.head ? document.head.appendChild(st) : document.body.appendChild(st);
}

// ---- zip reader: minimal, dependency-free (native DecompressionStream) ----

async function unzip(buffer: ArrayBuffer): Promise<{ name: string; data: Uint8Array }[]> {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);

    // find End Of Central Directory (scan back over max comment length)
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);

    const out: { name: string; data: Uint8Array }[] = [];
    const td = new TextDecoder();

    for (let n = 0; n < count; n++) {
        if (dv.getUint32(off, true) !== 0x02014b50) break;
        const method = dv.getUint16(off + 10, true);
        const compSize = dv.getUint32(off + 20, true);
        const nameLen = dv.getUint16(off + 28, true);
        const extraLen = dv.getUint16(off + 30, true);
        const commentLen = dv.getUint16(off + 32, true);
        const localOff = dv.getUint32(off + 42, true);
        const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
        off += 46 + nameLen + extraLen + commentLen;

        if (name.endsWith('/')) continue; // directory
        const lNameLen = dv.getUint16(localOff + 26, true);
        const lExtraLen = dv.getUint16(localOff + 28, true);
        const dataStart = localOff + 30 + lNameLen + lExtraLen;
        const comp = u8.subarray(dataStart, dataStart + compSize);

        let data: Uint8Array;
        if (method === 0) {
            data = comp.slice();
        } else if (method === 8) {
            const stream = new Blob([comp.slice()]).stream()
                .pipeThrough(new (globalThis as any).DecompressionStream('deflate-raw'));
            data = new Uint8Array(await new Response(stream).arrayBuffer());
        } else {
            continue; // unsupported compression
        }
        out.push({ name, data });
    }
    return out;
}

// ---- drag & drop: turn any scan zip (sog + voxel json/bin) into a scene ----

class DropSystem {
    app: any;
    script: any;
    _dropCount = 0;

    constructor(app: any, script: any) {
        this.app = app;
        this.script = script;
        window.addEventListener('dragover', (e: any) => e.preventDefault());
        window.addEventListener('drop', (e: any) => {
            e.preventDefault();
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) this._import(f);
        });
    }

    _banner(text: string, secs: number) {
        const d = this.script._director;
        if (d) d._showBanner(text, secs);
        console.log('[drop]', text);
    }

    async _import(file: any) {
        try {
            if (!/\.zip$/i.test(file.name)) {
                this._banner('DROP A .ZIP (sog + voxel json/bin)', 4);
                return;
            }
            this._banner(`IMPORTING ${file.name.toUpperCase()}…`, 8);
            const entries = await unzip(await file.arrayBuffer());

            let sog: any = null, metaEntry: any = null, bin: any = null;
            const td = new TextDecoder();
            for (const en of entries) {
                const base = en.name.split('/').pop() || en.name;
                if (/\.sog$/i.test(base)) sog = en;
                else if (/\.bin$/i.test(base)) bin = en;
                else if (/\.json$/i.test(base)) {
                    try {
                        const j = JSON.parse(td.decode(en.data));
                        if (j.gridBounds && j.nodeCount) { metaEntry = en; (en as any).meta = j; }
                    } catch (err) { /* not the voxel meta */ }
                }
            }
            if (!sog || !metaEntry || !bin) {
                this._banner('ZIP NEEDS: .sog + voxel .json + voxel .bin', 5);
                return;
            }

            const meta = (metaEntry as any).meta;
            const view = new Uint32Array(bin.data.buffer, bin.data.byteOffset, Math.floor(bin.data.length / 4));
            const nodes = view.slice(0, meta.nodeCount);
            const leafData = view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount);

            // gsplat asset from the in-memory sog (filename hint drives the parser)
            const blobUrl = URL.createObjectURL(new Blob([sog.data], { type: 'application/zip' }));
            const asset = new pc.Asset(`drop-${++this._dropCount}.sog`, 'gsplat', { url: blobUrl, filename: 'drop.sog' });
            this.app.assets.add(asset);

            const sceneName = file.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 24) || 'dropped scan';
            const scenes = this.script._scenes;
            const idx = SCENES.length;
            SCENES.push({
                name: sceneName,
                gsplatAsset: asset,
                voxelData: { meta, nodes, leafData },
                spawn: null,
                rot: [0, 0, 180]
            });
            if (scenes) scenes.addCard(idx);

            this._banner(`SCAN READY — ENTERING ${sceneName.toUpperCase()}`, 4);
            if (scenes) scenes.switchTo(idx);
        } catch (e: any) {
            console.error('drop import failed', e);
            this._banner('IMPORT FAILED: ' + (e && e.message || e), 5);
        }
    }
}

// ---- multiplayer: presence + shots over a PartyKit relay ----

/** fallback relay base URL; the live URL is read from the relay-url.json
 *  asset (id below) so a tunnel restart only needs an asset update, not a
 *  game rebuild. Override per-session with ?party=... */
const PARTY_URL = 'wss://roland-obligations-futures-collections.trycloudflare.com';
const RELAY_URL_ASSET: [number, string] = [298997427, 'relay-url.json'];
const NET_SEND_INTERVAL = 1 / 12;

class NetSystem {
    app: any;
    script: any;
    npcs: any;
    balls: any;
    scenes: any;
    director: any;
    walkCamera: any;
    enabled = false;
    ws: any = null;
    myId: string = '';
    myName: string = '';
    room = 'hack6';
    peers: Map<string, any> = new Map();
    _sendT = 0;
    _retry = 0;
    _destroyed = false;
    _screenPos: any = null;

    constructor(app: any, script: any, refs: any) {
        this.app = app;
        this.script = script;
        this.npcs = refs.npcs;
        this.balls = refs.balls;
        this.scenes = refs.scenes;
        this.director = refs.director;
        this.walkCamera = refs.walkCamera;

        let param = '';
        try {
            const q = new URLSearchParams(window.location.search);
            param = q.get('party') || '';
            this.room = q.get('room') || 'hack6';
        } catch (e) { /* headless */ }

        const finish = (base: string) => {
            if (!base) {
                console.log('net: multiplayer off (no relay url)');
                return;
            }
            base = base.replace(/^http/, 'ws').replace(/\/+$/, '');
            this._url = `${base}/parties/main/${encodeURIComponent(this.room)}`;
            this._connect();
        };

        if (param) {
            this._resolveUrl = () => finish(param);
        } else {
            // live indirection: read the current relay URL from the asset
            this._resolveUrl = async () => {
                let base = PARTY_URL;
                try {
                    const cfg = (window as any).config;
                    const bid = (cfg && (cfg.self?.branch?.id || cfg.self?.branchId)) || '87d9f884-5657-4343-887e-e823e912488f';
                    const r = await fetch(`${window.location.origin}/api/assets/${RELAY_URL_ASSET[0]}/file/${RELAY_URL_ASSET[1]}?branchId=${bid}`);
                    if (r.ok) {
                        const j = await r.json();
                        if (j && j.url) base = j.url;
                    }
                } catch (e) { /* use fallback */ }
                finish(base);
            };
        }

        try {
            this.myName = localStorage.getItem('siege-name') || '';
        } catch (e) { /* private mode */ }
        if (!this.myName) {
            try {
                this.myName = (window.prompt('Player name for multiplayer:', 'player') || 'player').slice(0, 16);
                localStorage.setItem('siege-name', this.myName);
            } catch (e) {
                this.myName = 'player' + Math.floor(Math.random() * 1000);
            }
        }

        this.enabled = true;
        this._screenPos = new pc.Vec3();
        this._resolveUrl();
    }

    _url = '';
    _resolveUrl: any = null;

    _connect() {
        if (this._destroyed || !this._url) return;
        try {
            const ws = new WebSocket(this._url);
            this.ws = ws;
            ws.onopen = () => {
                this._retry = 0;
                console.log('net: connected to', this._url, 'as', this.myName);
                this.sendStateNow();
            };
            ws.onmessage = (ev: any) => {
                try { this._onMsg(JSON.parse(ev.data)); } catch (e) { /* bad msg */ }
            };
            ws.onclose = () => {
                this.ws = null;
                if (this._destroyed) return;
                const wait = Math.min(10000, 1500 * ++this._retry);
                setTimeout(() => this._connect(), wait);
            };
            ws.onerror = () => { try { ws.close(); } catch (e) { /* noop */ } };
        } catch (e) {
            console.warn('net: connect failed', e);
        }
    }

    _send(obj: any) {
        if (this.ws && this.ws.readyState === 1) {
            try { this.ws.send(JSON.stringify(obj)); } catch (e) { /* drop */ }
        }
    }

    sendStateNow() {
        if (!this.enabled) return;
        const p = this.walkCamera.position;
        const a = this.walkCamera.angles;
        this._send({
            t: 'state', name: this.myName,
            scene: this.scenes ? this.scenes.current : 0,
            x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
            yaw: +a.y.toFixed(1), pitch: +a.x.toFixed(1),
            crouch: !!this.script._crouched
        });
    }

    sendShot(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
        this._send({
            t: 'shoot', scene: this.scenes ? this.scenes.current : 0,
            ox: +ox.toFixed(3), oy: +oy.toFixed(3), oz: +oz.toFixed(3),
            dx: +dx.toFixed(4), dy: +dy.toFixed(4), dz: +dz.toFixed(4)
        });
    }

    _onMsg(m: any) {
        if (m.t === 'hello') { this.myId = m.id; return; }
        if (m.t === 'leave') {
            const peer = this.peers.get(m.id);
            if (peer) {
                if (peer.ent) { try { peer.ent.destroy(); } catch (e) { /* gone */ } }
                if (peer.el) peer.el.remove();
                if (this.director) this.director._feedMsg(`${peer.name || 'player'} left`);
                this.peers.delete(m.id);
                this._syncOnline();
            }
            return;
        }
        if (m.t === 'state') {
            let peer = this.peers.get(m.id);
            if (!peer) {
                peer = { name: m.name, scene: m.scene, cur: null, prev: null, t: 0, ent: null, model: null, el: null, animState: '' };
                this.peers.set(m.id, peer);
                if (this.director) this.director._feedMsg(`${m.name || 'player'} joined`);
                this._syncOnline();
            }
            peer.name = m.name || peer.name;
            peer.scene = m.scene;
            peer.prev = peer.cur || { x: m.x, y: m.y, z: m.z, yaw: m.yaw, crouch: m.crouch };
            peer.cur = { x: m.x, y: m.y, z: m.z, yaw: m.yaw, crouch: m.crouch };
            peer.t = 0;
            return;
        }
        if (m.t === 'shoot') {
            if (this.scenes && m.scene !== this.scenes.current) return;
            if (this.balls) {
                this.balls.throwBall({ x: m.ox, y: m.oy, z: m.oz }, { x: m.dx, y: m.dy, z: m.dz }, VM_BALL_SPEED, VM_BALL_RADIUS);
            }
            return;
        }
    }

    _syncOnline() {
        if (this.director) {
            this.director.online = this.peers.size + 1;
            this.director._syncHud();
        }
    }

    _ensureAvatar(peer: any) {
        if (peer.ent || !this.npcs || !this.npcs.ready || !this.npcs.assets.model) return;
        try {
            const root = new pc.Entity('net-player');
            const model = this.npcs.assets.model.resource.instantiateRenderEntity();
            root.addChild(model);
            this.app.root.addChild(root);
            for (const r of model.findComponents('render')) {
                for (const mi of r.meshInstances) mi.cull = false;
            }
            const s = this.npcs.npcHeight / 180;
            model.setLocalScale(s, s, s);
            model.setLocalEulerAngles(0, 180, 0);
            model.addComponent('anim', { activate: true });
            const idle = this.npcs._track('idle');
            const walk = this.npcs._track('walk');
            if (idle) model.anim.assignAnimation('Idle', idle);
            if (walk) model.anim.assignAnimation('Walk', walk);
            peer.ent = root;
            peer.model = model;

            const el = document.createElement('div');
            el.className = 'sg sg-mono';
            el.style.cssText = 'position:fixed;transform:translate(-50%,-100%);z-index:9997;font-family:var(--font);font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;background:rgba(9,9,11,0.9);pointer-events:none;white-space:nowrap;color:var(--info);border:1px solid rgba(96,165,250,0.4);';
            el.textContent = peer.name || 'player';
            document.body.appendChild(el);
            peer.el = el;
        } catch (e) {
            console.warn('net: avatar failed', e);
        }
    }

    _setPeerAnim(peer: any, state: string) {
        if (peer.animState === state || !peer.model || !peer.model.anim) return;
        try {
            if (peer.model.anim.baseLayer) {
                peer.model.anim.baseLayer.transition(state, 0.2);
                peer.animState = state;
            }
        } catch (e) { /* not ready */ }
    }

    step(dt: number) {
        if (!this.enabled) return;

        this._sendT -= dt;
        if (this._sendT <= 0) {
            this._sendT = NET_SEND_INTERVAL;
            this.sendStateNow();
        }

        const camComp = this.script.entity.camera;
        const canvas = this.app.graphicsDevice.canvas;

        for (const peer of this.peers.values()) {
            if (!peer.cur) continue;
            this._ensureAvatar(peer);
            if (!peer.ent) continue;

            const sameScene = !this.scenes || peer.scene === this.scenes.current;
            peer.ent.enabled = sameScene;
            if (!sameScene) {
                if (peer.el) peer.el.style.display = 'none';
                continue;
            }

            peer.t += dt;
            const alpha = Math.min(1, peer.t / NET_SEND_INTERVAL);
            const a = peer.prev || peer.cur, b = peer.cur;
            const x = a.x + (b.x - a.x) * alpha;
            const y = a.y + (b.y - a.y) * alpha;
            const z = a.z + (b.z - a.z) * alpha;
            let dyaw = b.yaw - a.yaw;
            while (dyaw > 180) dyaw -= 360;
            while (dyaw < -180) dyaw += 360;
            const yaw = a.yaw + dyaw * alpha;

            // state y is the eye position; avatar root stands on the floor
            const floorY = y - (b.crouch ? 0.95 : 1.5);
            peer.ent.setPosition(x, floorY, z);
            peer.ent.setEulerAngles(0, yaw, 0);

            if (peer.model) {
                const s = this.npcs.npcHeight / 180;
                peer.model.setLocalScale(s, b.crouch ? s * 0.72 : s, s);
            }

            const spd = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z)) / NET_SEND_INTERVAL;
            this._setPeerAnim(peer, spd > 0.3 ? 'Walk' : 'Idle');

            if (peer.el && camComp && canvas) {
                camComp.worldToScreen(new pc.Vec3(x, floorY + (this.npcs ? this.npcs.npcHeight : 1.7) + 0.15, z), this._screenPos);
                if (this._screenPos.z < 0) {
                    peer.el.style.display = 'none';
                } else {
                    peer.el.style.display = 'block';
                    peer.el.style.left = `${this._screenPos.x * (canvas.clientWidth / canvas.width)}px`;
                    peer.el.style.top = `${this._screenPos.y * (canvas.clientHeight / canvas.height)}px`;
                }
            }
        }
    }
}

// ---- friends: rigged teammates wandering every location ----

const FRIENDS: any[] = [
    { name: 'Larry', assetId: 298997648, fname: 'friend-larry.glb' },
    { name: 'Aditya', assetId: 298997653, fname: 'friend-aditya.glb' },
    { name: 'Akash', assetId: 298998118, fname: 'friend-akash.glb' },
    { name: 'Kelly', assetId: 298998127, fname: 'friend-kelly.glb' }
];
const FRIEND_HEIGHT = 1.72;
const FRIEND_SPEED = 1.0;

class FriendSystem {
    app: any;
    collision: any;
    npcs: any;      // reused for floor-spot search + camera ref
    scenes: any;
    friends: any[] = [];
    _lastScene = -1;
    _screenPos: any;

    constructor(app: any, collision: any, npcs: any) {
        this.app = app;
        this.collision = collision;
        this.npcs = npcs;
        this._screenPos = new pc.Vec3();
        for (const cfg of FRIENDS) this._load(cfg);
    }

    _url(id: number, fname: string) {
        let q = '';
        try {
            const cfg = (window as any).config;
            const bid = (cfg && (cfg.self?.branch?.id || cfg.self?.branchId)) || '87d9f884-5657-4343-887e-e823e912488f';
            q = `?branchId=${bid}`;
        } catch (e) { /* default */ }
        return `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
    }

    _load(cfg: any) {
        const asset = new pc.Asset(cfg.fname, 'container', { url: this._url(cfg.assetId, cfg.fname), filename: cfg.fname });
        asset.on('load', () => {
            cfg.asset = asset;
            this._spawn(cfg);
        });
        asset.on('error', (err: string) => console.error('friend asset failed:', cfg.name, err));
        this.app.assets.add(asset);
        this.app.assets.load(asset);
    }

    _spawn(cfg: any) {
        const sc = this.scenes ? SCENES[this.scenes.current] : null;
        if (sc && sc.noNpcs) return;
        try {
            const spot = this.npcs._randomFloorSpot();
            if (!spot) { setTimeout(() => this._spawn(cfg), 2500); return; }

            const root = new pc.Entity('friend-' + cfg.name);
            const model = cfg.asset.resource.instantiateRenderEntity();
            root.addChild(model);
            this.app.root.addChild(root);
            for (const r of model.findComponents('render')) {
                for (const mi of r.meshInstances) mi.cull = false;
            }
            model.setLocalEulerAngles(0, 180, 0);
            const anims = cfg.asset.resource.animations;
            if (anims && anims.length) {
                model.addComponent('anim', { activate: true });
                model.anim.assignAnimation('Walk', anims[0].resource);
            }
            root.setPosition(spot.x, spot.y, spot.z);

            const el = document.createElement('div');
            el.className = 'sg sg-mono';
            el.style.cssText = 'position:fixed;transform:translate(-50%,-100%);z-index:9997;font-family:var(--font);font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;background:rgba(9,9,11,0.9);pointer-events:none;white-space:nowrap;color:var(--ok);border:1px solid rgba(52,211,153,0.4);';
            el.textContent = cfg.name;
            document.body.appendChild(el);

            this.friends.push({
                cfg, root, model, el,
                p: { x: spot.x, y: spot.y, z: spot.z },
                target: null,
                static: !!cfg.generated, // T-pose units stand at attention
                yaw: Math.random() * 360,
                fit: { phase: 'scale', wait: 4 },
                _push: { x: 0, y: 0, z: 0 }
            });
        } catch (e) {
            console.warn('friend spawn failed', cfg.name, e);
        }
    }

    _measure(model: any) {
        let minY = Infinity, maxY = -Infinity, cx = 0, cz = 0, n = 0;
        const stack = [model];
        while (stack.length) {
            const nd = stack.pop();
            const ch = nd.children;
            for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
            const pos = nd.getPosition();
            if (!isFinite(pos.y)) continue;
            minY = Math.min(minY, pos.y);
            maxY = Math.max(maxY, pos.y);
            cx += pos.x; cz += pos.z; n++;
        }
        if (n < 3) return null;
        return { minY, ext: maxY - minY, cx: cx / n, cz: cz / n };
    }

    /** spawn a freshly generated (T-pose, unrigged) unit near the player */
    spawnGenerated(name: string, asset: any) {
        const cfg = { name, asset, generated: true };
        FRIENDS.push(cfg);
        this._spawn(cfg);
    }

    /** respawn everyone when the location changes */
    resetForScene() {
        for (const f of this.friends) {
            try { f.root.destroy(); } catch (e) { /* gone */ }
            if (f.el) f.el.remove();
        }
        this.friends.length = 0;
        const sc = this.scenes ? SCENES[this.scenes.current] : null;
        if (sc && sc.noNpcs) return;
        for (const cfg of FRIENDS) {
            if (cfg.asset) this._spawn(cfg);
        }
    }

    step(dt: number) {
        if (this.scenes && this.scenes.current !== this._lastScene) {
            this._lastScene = this.scenes.current;
            this.resetForScene();
        }

        const camComp = this.npcs.cameraEntity.camera;
        const canvas = this.app.graphicsDevice.canvas;

        for (const f of this.friends) {
            // deferred fit: scale by bone span, then snap feet to the floor
            if (f.fit) {
                if (f.fit.wait > 0) { f.fit.wait--; continue; }
                const m = this._measure(f.model);
                if (!m || !isFinite(m.ext) || m.ext <= 0.05) { f.fit.wait = 4; continue; }
                if (f.fit.phase === 'scale') {
                    const cur = f.model.getLocalScale().x;
                    let s = cur * (FRIEND_HEIGHT * 0.95 / m.ext);
                    if (!isFinite(s) || s < 0.0005 || s > 10) s = 1;
                    f.model.setLocalScale(s, s, s);
                    f.fit.phase = 'ground';
                    f.fit.wait = 3;
                } else {
                    const dy = f.p.y - m.minY;
                    if (isFinite(dy) && Math.abs(dy) < 50) {
                        const lp = f.model.getLocalPosition();
                        f.model.setLocalPosition(lp.x, lp.y + dy, lp.z);
                    }
                    f.fit = null;
                }
                continue;
            }

            // generated units stand at attention, facing the player
            if (f.static) {
                const pp = this.npcs._playerPos();
                const fdx = pp.x - f.p.x, fdz = pp.z - f.p.z;
                const fd = Math.sqrt(fdx * fdx + fdz * fdz);
                if (fd > 0.5) {
                    const targetYaw = Math.atan2(-fdx / fd, -fdz / fd) * 180 / Math.PI;
                    let dyaw = targetYaw - f.yaw;
                    while (dyaw > 180) dyaw -= 360;
                    while (dyaw < -180) dyaw += 360;
                    f.yaw += Math.max(-120 * dt, Math.min(120 * dt, dyaw));
                }
                f.root.setPosition(f.p.x, f.p.y, f.p.z);
                f.root.setEulerAngles(0, f.yaw, 0);
            } else
            // perpetual wandering — they're just out for a walk
            if (!f.target) {
                const spot = this.npcs._randomFloorSpot();
                if (spot) f.target = spot;
            }
            if (f.target) {
                const dx = f.target.x - f.p.x;
                const dz = f.target.z - f.p.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < 0.5) {
                    f.target = null;
                } else {
                    const nx = dx / dist, nz = dz / dist;
                    f.p.x += nx * FRIEND_SPEED * dt;
                    f.p.z += nz * FRIEND_SPEED * dt;

                    const targetYaw = Math.atan2(-nx, -nz) * 180 / Math.PI;
                    let dyaw = targetYaw - f.yaw;
                    while (dyaw > 180) dyaw -= 360;
                    while (dyaw < -180) dyaw += 360;
                    f.yaw += Math.max(-240 * dt, Math.min(240 * dt, dyaw));

                    const down = this.collision.queryRay(f.p.x, f.p.y + 1.2, f.p.z, 0, -1, 0, 3);
                    if (down) f.p.y += (down.y - f.p.y) * Math.min(1, dt * 10);

                    const cy = f.p.y + FRIEND_HEIGHT * 0.5;
                    if (this.collision.queryCapsule(f.p.x, cy, f.p.z, FRIEND_HEIGHT * 0.5 - 0.3, 0.3, f._push)) {
                        f.p.x += f._push.x;
                        f.p.z += f._push.z;
                        if (Math.abs(f._push.x) + Math.abs(f._push.z) > 0.03) f.target = null;
                    }
                }
            }

            f.root.setPosition(f.p.x, f.p.y, f.p.z);
            f.root.setEulerAngles(0, f.yaw, 0);

            if (f.el && camComp && canvas) {
                camComp.worldToScreen(new pc.Vec3(f.p.x, f.p.y + FRIEND_HEIGHT + 0.15, f.p.z), this._screenPos);
                if (this._screenPos.z < 0) {
                    f.el.style.display = 'none';
                } else {
                    f.el.style.display = 'block';
                    f.el.style.left = `${this._screenPos.x * (canvas.clientWidth / canvas.width)}px`;
                    f.el.style.top = `${this._screenPos.y * (canvas.clientHeight / canvas.height)}px`;
                }
            }
        }
    }
}

// ---- requisition: photos → T-pose character via the npc-pipeline server ----

const NPC_PIPELINE_URL = 'http://localhost:8799';

class RequisitionSystem {
    app: any;
    script: any;
    base: string;
    _cardStatus: any = null;

    constructor(app: any, script: any) {
        this.app = app;
        this.script = script;
        let base = NPC_PIPELINE_URL;
        try {
            const q = new URLSearchParams(window.location.search);
            base = q.get('npc') || base;
        } catch (e) { /* headless */ }
        this.base = base.replace(/\/+$/, '');
    }

    /** sidebar hook: build the "requisition" card */
    makeCard(container: any) {
        const card = document.createElement('div');
        card.id = 'sg-requisition';
        card.style.cssText = '';
        card.innerHTML = '<span style="color:var(--foreground);font-weight:500">Create an NPC</span><br><span style="font-size:10px">photos of a person become a unit</span>';
        const status = document.createElement('div');
        status.style.cssText = 'font-size:10px;margin-top:6px;color:#93c5fd;display:none;';
        card.appendChild(status);
        this._cardStatus = status;

        card.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = 'image/*';
            inp.multiple = true;
            inp.onchange = () => {
                const files = inp.files;
                if (files && files.length) this.requisition(Array.from(files));
            };
            inp.click();
        });
        container.appendChild(card);
    }

    _status(text: string) {
        if (this._cardStatus) {
            this._cardStatus.style.display = 'block';
            this._cardStatus.textContent = text;
        }
        const d = this.script._director;
        if (d) d._feedMsg(text);
    }

    async requisition(files: any[]) {
        const name = (window.prompt('Name this unit:', 'recruit') || 'recruit').slice(0, 16);
        try {
            this._status(`${name}: uploading ${files.length} photo(s)…`);
            const fd = new FormData();
            fd.append('name', name);
            for (const f of files) fd.append('images', f);
            const r = await fetch(`${this.base}/npc/generate`, { method: 'POST', body: fd });
            if (!r.ok) throw new Error(`server ${r.status}`);
            const { job_id } = await r.json();
            this._poll(job_id, name);
        } catch (e: any) {
            this._status(`${name}: pipeline offline (${e && e.message || e})`);
        }
    }

    async _poll(jobId: string, name: string) {
        try {
            const r = await fetch(`${this.base}/npc/status/${jobId}`);
            const st = await r.json();
            if (st.status === 'SUCCEEDED' || st.download_url) {
                this._status(`${name}: downloading…`);
                const g = await fetch(`${this.base}/npc/download/${jobId}`);
                if (!g.ok) throw new Error(`download ${g.status}`);
                const blob = await g.blob();
                this._materialize(name, blob);
                return;
            }
            if (st.status === 'FAILED' || st.error) {
                this._status(`${name}: generation failed (${st.error || 'unknown'})`);
                return;
            }
            this._status(`${name}: ${st.stage || 'generating'} ${st.progress != null ? st.progress + '%' : ''}`);
            setTimeout(() => this._poll(jobId, name), 4000);
        } catch (e: any) {
            this._status(`${name}: lost pipeline (${e && e.message || e})`);
        }
    }

    _materialize(name: string, blob: any) {
        try {
            const url = URL.createObjectURL(blob);
            const asset = new pc.Asset(`req-${name}.glb`, 'container', { url, filename: 'unit.glb' });
            asset.on('load', () => {
                const friends = this.script._friends;
                if (friends) {
                    friends.spawnGenerated(name, asset);
                    this._status(`${name}: unit deployed ✓`);
                } else {
                    this._status(`${name}: no friend system`);
                }
            });
            asset.on('error', (err: string) => this._status(`${name}: model failed (${err})`));
            this.app.assets.add(asset);
            this.app.assets.load(asset);
        } catch (e: any) {
            this._status(`${name}: materialize failed`);
        }
    }
}

// ---- CAMPUS SIEGE: game director (waves, score, player HP, UofT skin) ----

const THEME_BG = '#0d1117';
const WAVE_INTERMISSION = 5;
const PLAYER_MAX_HP = 100;
const HP_REGEN_DELAY = 5;
const HP_REGEN_RATE = 6;

class GameDirector {
    state = 'title'; // title | playing | intermission | gameover | practice
    targets: any = null;
    practiceHits = 0;
    wave = 0;
    score = 0;
    kills = 0;
    hp = PLAYER_MAX_HP;
    _regenT = 0;
    _interT = 0;
    _waveDelay = 0;
    npcs: any;
    sceneMgr: any = null;
    sounds: any = null;
    onRestart: any = null;
    _ambient: any = null;
    _lastPain = 0;
    _overlay: any; _banner: any; _hud: any; _hpFill: any; _vignette: any; _feed: any;

    constructor(npcs: any) {
        this.npcs = npcs;
        this._makeDom();
        this._showTitle();

        npcs.onKill = () => {
            this.kills++;
            this.score += 100;
            this._feedMsg('soldier eliminated  +100');
            this._syncHud();
        };
        npcs.onPlayerDamage = (dmg: number) => this._damage(dmg);
    }

    _makeDom() {
        const mk = (css: string) => {
            const d = document.createElement('div');
            d.style.cssText = css;
            document.body.appendChild(d);
            return d;
        };
        injectUiCss();
        this._overlay = mk('position:fixed;inset:0;z-index:10005;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(9,9,11,0.94);color:var(--foreground);text-align:center;cursor:pointer;');
        this._overlay.className = 'sg';
        this._banner = mk('position:fixed;top:14%;left:50%;transform:translateX(-50%);z-index:10004;display:none;padding:12px 28px;font-size:13px;font-weight:600;letter-spacing:0.04em;white-space:nowrap;');
        this._banner.className = 'sg sg-panel';
        this._hud = mk('position:fixed;top:16px;left:16px;z-index:10001;pointer-events:none;padding:10px 16px;min-width:180px;');
        this._hud.className = 'sg sg-panel';
        this._feed = mk('position:fixed;top:112px;left:16px;z-index:10001;pointer-events:none;font-family:var(--font);font-size:11px;color:var(--muted-fg);display:flex;flex-direction:column;gap:3px;');
        this._feed.className = 'sg sg-mono';
        const hpWrap = mk('position:fixed;bottom:20px;left:16px;z-index:10001;width:230px;padding:10px 14px;pointer-events:none;');
        hpWrap.className = 'sg sg-panel';
        hpWrap.innerHTML = '<div style="font-size:11px;font-weight:500;color:var(--muted-fg);margin-bottom:6px;display:flex;justify-content:space-between"><span>Health</span></div>';
        const hpBar = document.createElement('div');
        hpBar.className = 'sg-progress';
        hpBar.style.cssText = 'width:188px;';
        this._hpFill = document.createElement('div');
        this._hpFill.style.cssText = 'height:100%;width:100%;border-radius:9999px;background:var(--primary);transition:width 0.15s,background 0.15s;';
        hpBar.appendChild(this._hpFill);
        hpWrap.appendChild(hpBar);
        this._vignette = mk('position:fixed;inset:0;z-index:10000;pointer-events:none;background:radial-gradient(ellipse at center, transparent 55%, rgba(200,30,40,0.5) 100%);opacity:0;transition:opacity 0.12s;');

        this._overlay.addEventListener('click', () => {
            if (this.state === 'title') this._start();
            else if (this.state === 'gameover') this._restart();
        });
        this._syncHud();
    }

    enterPractice() {
        if (this.targets == null) return;
        // leave any siege state cleanly
        this.npcs.reset();
        this.npcs.combatEnabled = false;
        this.npcs.playerDead = false;
        this.state = 'practice';
        this.practiceHits = 0;
        this._overlay.style.display = 'none';
        this.targets.enter();
        const w = (window as any).walk;
        if (w && w.balls) { w.balls.noBounce = true; w.balls.clear(); }
        this._showBanner('TARGET PRACTICE — T to return', 4);
        this._syncHud();
        const canvas = (window as any).walk?.script?.app?.graphicsDevice?.canvas;
        if (canvas && document.pointerLockElement !== canvas) canvas.requestPointerLock();
    }

    exitPractice() {
        if (this.state !== 'practice') return;
        this.targets.exit();
        const w = (window as any).walk;
        if (w && w.balls) { w.balls.noBounce = false; w.balls.clear(); }
        this._showTitle();
    }

    practiceHit() {
        this.practiceHits++;
        this.score = this.practiceHits * 50;
        this._feedMsg('target hit  +50');
        this._syncHud();
    }

    _showTitle() {
        this.state = 'title';
        this._overlay.style.display = 'flex';
        this._overlay.innerHTML =
            '<div style="font-size:12px;font-weight:500;color:var(--muted-fg);margin-bottom:16px">University of Toronto · 43.6596° N, 79.3976° W</div>' +
            '<div style="font-size:72px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:var(--foreground)">SIEGE</div>' +
            '<div style="font-size:14px;color:var(--muted-fg);margin:16px 0 36px;max-width:420px;line-height:1.6">Reality, scanned. Now defend it — a wave shooter inside real Gaussian-splat scans of campus.</div>' +
            '<div class="sg-panel" style="padding:14px 22px;font-size:12px;line-height:2.1;color:var(--muted-fg);text-align:left">' +
              '<span style="color:var(--foreground);font-weight:500">WASD</span> move · <span style="color:var(--foreground);font-weight:500">Shift</span> run · <span style="color:var(--foreground);font-weight:500">Space</span> jump · <span style="color:var(--foreground);font-weight:500">C</span> crouch<br>' +
              '<span style="color:var(--foreground);font-weight:500">LMB</span> fire · <span style="color:var(--foreground);font-weight:500">R</span> reload · <span style="color:var(--foreground);font-weight:500">T</span> targets · <span style="color:var(--foreground);font-weight:500">M</span> locations · <span style="color:var(--foreground);font-weight:500">B</span> voxels' +
            '</div>' +
            '<div class="sg-btn" style="margin-top:36px">Click to start</div>' +
            '<div style="margin-top:14px;font-size:11px;color:var(--muted-fg)">Drop a scan .zip anywhere — any room becomes a level</div>';
    }

    _start() {
        this.state = 'playing';
        this.wave = 0;
        this.score = 0;
        this.kills = 0;
        this.hp = PLAYER_MAX_HP;
        this._overlay.style.display = 'none';
        this.npcs.playerDead = false;
        this.npcs.combatEnabled = true;
        if (this.sounds && !this._ambient) {
            this._ambient = this.sounds.play('room.mp3', { volume: 0.3, loop: true });
        }
        if (this.sounds) this.sounds.play('carbineReady.wav', { volume: 0.6 });
        this._nextWave();
        const canvas = (window as any).walk?.script?.app?.graphicsDevice?.canvas;
        if (canvas) canvas.requestPointerLock();
    }

    _restart() {
        if (this.onRestart) this.onRestart();
        this._start();
    }

    _nextWave() {
        // no-soldier zones (e.g. Bahen Front) never spawn waves
        const sc = this.sceneMgr ? SCENES[this.sceneMgr.current] : null;
        if (sc && sc.noSoldiers) {
            this.npcs.reset();
            this.npcs.setPopulation(0);
            this.npcs.combatEnabled = false;
            this._showBanner('SAFE ZONE — no hostiles here', 3);
            this._syncHud();
            return;
        }
        this.wave++;
        const count = Math.min(2 + this.wave, 8);
        const speedMul = Math.min(1 + (this.wave - 1) * 0.12, 1.8);
        this.npcs.reset();
        this.npcs.combatEnabled = true;
        this.npcs.setPopulation(count, speedMul);
        this._showBanner(`— WAVE ${this.wave} INCOMING —`, 3);
        this._syncHud();
    }

    _showBanner(text: string, secs: number) {
        this._banner.textContent = text;
        this._banner.style.display = 'block';
        clearTimeout((this as any)._bannerTo);
        (this as any)._bannerTo = setTimeout(() => {
            this._banner.style.display = 'none';
        }, secs * 1000);
    }

    _feedMsg(text: string) {
        const line = document.createElement('div');
        line.textContent = '» ' + text;
        this._feed.prepend(line);
        setTimeout(() => line.remove(), 4000);
        while (this._feed.children.length > 4) this._feed.lastChild.remove();
    }

    _damage(dmg: number) {
        if (this.state !== 'playing') return;
        this.hp = Math.max(0, this.hp - dmg);
        this._regenT = HP_REGEN_DELAY;
        const nowP = performance.now();
        if (this.sounds && nowP - this._lastPain > 300) {
            this._lastPain = nowP;
            this.sounds.playRandom(['pain1.mp3', 'pain2.mp3', 'pain3.mp3', 'pain4.mp3'], { volume: 0.7, pitch: 0.9 + Math.random() * 0.2 });
        }
        this._vignette.style.opacity = '1';
        setTimeout(() => { this._vignette.style.opacity = '0'; }, 160);
        this._syncHud();
        if (this.hp <= 0) this._gameOver();
    }

    _gameOver() {
        this.state = 'gameover';
        this.npcs.playerDead = true;
        document.exitPointerLock();
        this._overlay.style.display = 'flex';
        this._overlay.innerHTML =
            '<div style="font-size:12px;font-weight:500;color:var(--destructive);margin-bottom:14px">Signal lost</div>' +
            '<div style="font-size:56px;font-weight:700;letter-spacing:-0.03em;color:var(--foreground)">Eliminated</div>' +
            `<div style="font-size:13px;color:var(--muted-fg);margin:22px 0 0" class="sg-mono">Score <b style="color:var(--foreground)">${this.score}</b> &nbsp;·&nbsp; Waves <b style="color:var(--foreground)">${this.wave}</b> &nbsp;·&nbsp; Kills <b style="color:var(--foreground)">${this.kills}</b></div>` +
            '<div class="sg-btn" style="margin-top:36px">Click to restart</div>';
    }

    _syncHud() {
        const online = (this as any).online > 1 ? ` &nbsp;·&nbsp; Online <b style="color:var(--info)">${(this as any).online}</b>` : '';
        const title = this.state === 'practice' ? 'Target Practice' : 'SIEGE';
        const stats = this.state === 'practice'
            ? `Hits <b style="color:var(--foreground)">${this.practiceHits}</b> &nbsp;·&nbsp; Score <b style="color:var(--foreground)">${this.practiceHits * 50}</b>`
            : `Wave <b style="color:var(--foreground)">${this.wave}</b> &nbsp;·&nbsp; Score <b style="color:var(--foreground)">${this.score}</b> &nbsp;·&nbsp; Kills <b style="color:var(--foreground)">${this.kills}</b>`;
        this._hud.innerHTML =
            `<div class="sg-h" style="font-size:13px;color:var(--foreground)">${title}</div>` +
            `<div class="sg-sep" style="margin:8px 0"></div>` +
            `<div class="sg-mono" style="font-size:12px;color:var(--muted-fg)">${stats}${online}</div>`;
        this._hpFill.style.width = `${(this.hp / PLAYER_MAX_HP) * 100}%`;
    }

    update(dt: number) {
        if (this._waveDelay > 0 && this.state === 'playing') {
            this._waveDelay -= dt;
            if (this._waveDelay <= 0) this._nextWave();
        }
        if (this.state === 'playing') {
            if (this._regenT > 0) {
                this._regenT -= dt;
            } else if (this.hp < PLAYER_MAX_HP) {
                this.hp = Math.min(PLAYER_MAX_HP, this.hp + HP_REGEN_RATE * dt);
                this._syncHud();
            }
            const scNow = this.sceneMgr ? SCENES[this.sceneMgr.current] : null;
            if (this._waveDelay <= 0 && !(scNow && scNow.noSoldiers) &&
                this.npcs.ready && this.npcs.npcs.length > 0 && this.npcs.aliveCount() === 0) {
                this.state = 'intermission';
                this._interT = WAVE_INTERMISSION;
                this._showBanner(`WAVE ${this.wave} CLEARED`, WAVE_INTERMISSION);
            }
        } else if (this.state === 'intermission') {
            this._interT -= dt;
            if (this._interT <= 0) {
                this.state = 'playing';
                this._nextWave();
            }
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
    this._hud.style.display = 'none';
    this._hudHidden = true;

    // always-visible coordinate readout
    this._coordBox = document.getElementById('coord-box');
    if (!this._coordBox) {
        this._coordBox = document.createElement('div');
        this._coordBox.id = 'coord-box';
        this._coordBox.className = 'sg sg-panel sg-mono';
        this._coordBox.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10001;font-size:11px;color:var(--muted-fg);padding:5px 16px;border-radius:9999px;pointer-events:none;';
        document.body.appendChild(this._coordBox);
    }
    this._coordT = 0;

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
    // Bahen 5F spawn (scene 0); other scenes set theirs on switch
    const spawn0 = SCENES[0].spawn;
    walkCamera.position.set(spawn0.x, spawn0.y, spawn0.z);
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
    this._crouched = false;
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
            case 'KeyF':
                if (down) {
                    if (!self._flyMode) {
                        self._controller.resetToSpawn(self._walkCamera) ||
                            self._controller.onEnter(self._walkCamera);
                    }
                }
                break;
            case 'KeyE': keys.up = down; break;
            case 'KeyR':
                if (down && self._viewmodel) self._viewmodel.reload();
                break;
            case 'KeyG':
                if (down) {
                    const f = self.entity.forward;
                    const ep = self.entity.getPosition();
                    self._balls.throwBall(ep, { x: f.x, y: f.y, z: f.z });
                }
                break;
            case 'KeyC':
                keys.crouch = down;
                break;
            case 'KeyN':
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
            case 'KeyT':
                if (down && self._director) {
                    if (self._director.state === 'practice') self._director.exitPractice();
                    else self._director.enterPractice();
                }
                break;
            case 'KeyM':
                if (down && self._scenes) self._scenes.toggleSidebar();
                break;
            case 'KeyB':
                if (down && self._voxelView) {
                    const on = self._voxelView.toggle();
                    console.log('voxel view', on ? 'ON' : 'OFF');
                }
                break;
            case 'Backquote':
                if (down && self._hud) {
                    self._hudHidden = !self._hudHidden;
                    self._hud.style.display = self._hudHidden ? 'none' : 'block';
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
    this._onClick = (e: MouseEvent) => {
        if (document.pointerLockElement !== canvas) {
            canvas.requestPointerLock();
        } else if (e.button === 0 && self._viewmodel) {
            self._viewmodel.setShooting(true);
        }
    };
    this._onMouseUp = (e: MouseEvent) => {
        if (e.button === 0 && self._viewmodel) self._viewmodel.setShooting(false);
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
    canvas.addEventListener('mousedown', this._onClick);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);

    this.on('destroy', () => {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);
        canvas.removeEventListener('mousedown', this._onClick);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('mousemove', this._onMouseMove);
    });

    // register the Ammo (Bullet) physics engine with the wasm module loader so
    // rigidbody/collision components work if used; loads in the background
    try {
        if (pc.WasmModule && !(window as any).__ammoConfigured) {
            (window as any).__ammoConfigured = true;
            const bq = (() => {
                try {
                    const cfg = (window as any).config;
                    const bid = (cfg && (cfg.self?.branch?.id || cfg.self?.branchId)) || '87d9f884-5657-4343-887e-e823e912488f';
                    return `?branchId=${bid}`;
                } catch (e) { return ''; }
            })();
            const au = (id: number, f: string) => `${window.location.origin}/api/assets/${id}/file/${f}${bq}`;
            pc.WasmModule.setConfig('Ammo', {
                glueUrl: au(298984312, 'ammo.wasm.js'),
                wasmUrl: au(298984313, 'ammo.wasm.wasm'),
                fallbackUrl: au(298984311, 'ammo.js')
            });
            pc.WasmModule.getInstance('Ammo', () => console.log('ammo: physics engine loaded'));
        }
    } catch (e) {
        console.warn('ammo setup failed', e);
    }

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

    this._sounds = new SoundKit(this.app);
    this._voxelView = new VoxelDebugView(this.app, collision);
    this._balls = new BallPhysics(this.app, collision);
    this._labels = new LabelSystem(this.app, collision, this.entity);
    try {
        this._npcs = new NpcSystem(this.app, collision, this.entity);
    } catch (e) {
        console.error('npc system init failed', e);
        this._npcs = null;
    }
    // mega knight prop disabled by request; re-enable by restoring PropSystem here
    this._props = null;
    try {
        this._viewmodel = new ViewmodelSystem(this.app, collision, this.entity, this._npcs, this._balls);
    } catch (e) {
        console.error('viewmodel init failed', e);
        this._viewmodel = null;
    }
    if (this._npcs) {
        this._npcs.sounds = this._sounds;
        this._npcs.getPlayerPos = () => walkCamera.position;
    }
    try {
        this._friends = this._npcs ? new FriendSystem(this.app, collision, this._npcs) : null;
    } catch (e) {
        console.error('friend system init failed', e);
        this._friends = null;
    }
    if (this._viewmodel) this._viewmodel.sounds = this._sounds;
    try {
        this._targets = new TargetSystem(this.app, collision, this._sounds);
    } catch (e) {
        console.error('target system init failed', e);
        this._targets = null;
    }
    try {
        this._drops = new DropSystem(this.app, this);
    } catch (e) {
        console.error('drop system init failed', e);
        this._drops = null;
    }
    try {
        this._requisition = new RequisitionSystem(this.app, this);
    } catch (e) {
        console.error('requisition init failed', e);
        this._requisition = null;
    }
    try {
        this._scenes = new SceneManager(this.app, collision, controller, walkCamera, this);
        // the game opens outside the building
        this._scenes.switchTo(2);
        setTimeout(() => { if (this._scenes) this._scenes._maybeCapture(); }, 6000);
    } catch (e) {
        console.error('scene manager init failed', e);
        this._scenes = null;
    }
    try {
        this._director = this._npcs ? new GameDirector(this._npcs) : null;
        if (this._director) this._director.sounds = this._sounds;
        if (this._director && this._targets) {
            this._director.targets = this._targets;
            this._targets.onHit = () => this._director.practiceHit();
        }
        if (this._director && this._scenes) this._director.sceneMgr = this._scenes;
        if (this._friends) this._friends.scenes = this._scenes;
        try {
            this._net = new NetSystem(this.app, this, {
                npcs: this._npcs, balls: this._balls, scenes: this._scenes,
                director: this._director, walkCamera: walkCamera
            });
            if (this._net.enabled && this._viewmodel) {
                this._viewmodel.onShoot = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) =>
                    this._net.sendShot(ox, oy, oz, dx, dy, dz);
            }
        } catch (e) {
            console.error('net init failed', e);
            this._net = null;
        }
        if (this._director) {
            this._director.onRestart = () => {
                if (this._balls) this._balls.clear();
                if (this._viewmodel) {
                    this._viewmodel.ammo = 30;
                    this._viewmodel.reloading = false;
                    this._viewmodel._updateAmmo();
                    if (this._viewmodel.ready) this._viewmodel.play('idle');
                }
                this._flyMode = false;
                this._controller.resetToSpawn(this._walkCamera) || this._controller.onEnter(this._walkCamera);
            };
        }
    } catch (e) {
        console.error('game director init failed', e);
        this._director = null;
    }

    (window as any).walk = { controller, camera: walkCamera, collision, script: this, balls: this._balls, labels: this._labels, npcs: this._npcs, props: this._props, viewmodel: this._viewmodel, director: this._director, targets: this._targets, scenes: this._scenes, net: this._net, friends: this._friends };
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
    this._coordT = (this._coordT || 0) + dt;
    if (this._coordT > 0.1 && this._coordBox && typeof this.entity.getPosition === 'function') {
        this._coordT = 0;
        const cp = this.entity.getPosition();
        const si = this._scenes ? this._scenes.current : 0;
        const sceneName = this._scenes ? SCENES[si].name : '?';
        this._coordBox.innerHTML = `<span style="color:var(--foreground);font-weight:500">${sceneName}</span> &nbsp;·&nbsp; ${cp.x.toFixed(2)}, ${cp.y.toFixed(2)}, ${(-cp.z).toFixed(2)}`;
    }

    if (this._balls) this._balls.step(Math.min(dt, 0.05));
    if (this._npcs) this._npcs.step(Math.min(dt, 0.05), this._balls ? this._balls.balls : []);
    if (this._viewmodel) this._viewmodel.step(dt);
    if (this._director) this._director.update(dt);
    if (this._targets) this._targets.step(dt, this._balls ? this._balls.balls : []);
    if (this._scenes) this._scenes.update();
    if (this._net) this._net.step(dt);
    if (this._friends) this._friends.step(dt);
    if (this._voxelView) this._voxelView.update(this.entity);
    if (this._labels) this._labels.update();

    const keys = this._keys;

    if (this._flyMode) {
        if (this._stepsInst) { this._stepsInst.stop(); this._stepsInst = null; this._stepsMode = 'none'; }
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

    // ---- crouch: shrink the capsule/eye while C is held ----
    const wantCrouch = !!keys.crouch;
    if (wantCrouch !== this._crouched) {
        const c = this._controller;
        if (wantCrouch) {
            c.capsuleHeight = 0.9;
            c.eyeHeight = 0.75;
            c.moveGroundSpeed = 3;
            this._crouched = true;
        } else {
            // only stand if there's headroom above the head
            const p = this._walkCamera.position;
            const up = this._collision.queryRay(p.x, p.y + 0.1, p.z, 0, 1, 0, 0.85);
            if (!up) {
                c.capsuleHeight = 1.5;
                c.eyeHeight = 1.3;
                c.moveGroundSpeed = 7;
                this._crouched = false;
            }
        }
    }

    // ---- walk mode: identical input feed to gta6 main.ts ----
    const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const z = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0);

    // footstep loop (walk vs run)
    const stepMode = (x !== 0 || z !== 0) ? (keys.run ? 'run' : 'walk') : 'none';
    if (stepMode !== this._stepsMode) {
        if (this._stepsInst) { this._stepsInst.stop(); this._stepsInst = null; }
        this._stepsMode = stepMode;
        if (stepMode !== 'none' && this._sounds) {
            this._stepsInst = this._sounds.play(stepMode === 'run' ? 'steps-running.mp3' : 'steps.mp3', { volume: 0.4, loop: true });
        }
    }
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
            '\nLMB shoot | R reload | C crouch | WASD Space Shift | Y fly | F respawn | G ball | N clear' +
            '\nX label | V remove | [ ] size | L labels | Backspace delete | B voxels';
    }
};
