(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // pc-shim.js
  var _pc = globalThis.pc;
  var math = _pc.math;
  var Vec3 = _pc.Vec3;
  var Quat = _pc.Quat;
  var Mat4 = _pc.Mat4;
  var Asset = _pc.Asset;
  var INDEXFORMAT_UINT32 = _pc.INDEXFORMAT_UINT32;
  var SEMANTIC_POSITION = _pc.SEMANTIC_POSITION;

  // vendor/core/math.ts
  var damp = (damping, dt) => 1 - Math.pow(damping, dt * 1e3);
  var mod = (n, m) => (n % m + m) % m;
  var vecToAngles = (result, vec) => {
    const radToDeg = 180 / Math.PI;
    const horizLenSq = vec.x * vec.x + vec.z * vec.z;
    result.x = Math.asin(Math.max(-1, Math.min(1, vec.y))) * radToDeg;
    result.y = horizLenSq > 1e-8 ? Math.atan2(-vec.x, -vec.z) * radToDeg : 0;
    result.z = 0;
    return result;
  };

  // vendor/cameras/camera-utils.ts
  var DEFAULT_CONTROLLER_DAMPING = 0.95;
  var rotation = new Quat();
  var applyFrameRotation = (angles, rotate, minPitch = -90, maxPitch = 90) => {
    angles.x -= rotate[1];
    angles.y -= rotate[0];
    angles.z = 0;
    angles.x = math.clamp(angles.x, minPitch, maxPitch);
    return angles;
  };
  var setYawBasis = (yaw, forward2, right2) => {
    rotation.setFromEulerAngles(0, yaw, 0);
    rotation.transformVector(Vec3.FORWARD, forward2);
    rotation.transformVector(Vec3.RIGHT, right2);
  };
  var setBasisOffset = (out2, x, y, z, forward2, right2, up) => {
    out2.set(
      right2.x * x + up.x * y + forward2.x * z,
      right2.y * x + up.y * y + forward2.y * z,
      right2.z * x + up.z * y + forward2.z * z
    );
    return out2;
  };
  var dampAngles = (angles, target, damping, dt) => {
    if (dt <= 0) {
      return angles;
    }
    const t = damp(damping, dt);
    angles.y = mod(angles.y, 360);
    angles.z = mod(angles.z, 360);
    target.y = mod(target.y, 360);
    target.z = mod(target.z, 360);
    angles.x = math.lerpAngle(angles.x, target.x, t);
    angles.y = math.lerpAngle(angles.y, target.y, t);
    angles.z = math.lerpAngle(angles.z, target.z, t);
    return angles;
  };

  // vendor/cameras/spawn-state.ts
  var SpawnState = class {
    constructor() {
      __publicField(this, "_position", new Vec3());
      __publicField(this, "_angles", new Vec3());
      __publicField(this, "_distance", 1);
      __publicField(this, "_has", false);
    }
    /**
     * True once `store` has been called at least once.
     *
     * @returns Whether a spawn pose has been captured.
     */
    get has() {
      return this._has;
    }
    /**
     * Capture the given pose as the spawn state.
     *
     * @param position - World-space position to remember.
     * @param angles - Euler angles to remember.
     * @param distance - Camera distance (orbit-style) to remember.
     */
    store(position, angles, distance) {
      this._position.copy(position);
      this._angles.copy(angles);
      this._distance = distance;
      this._has = true;
    }
    /**
     * Forget any previously-stored spawn pose so a subsequent `has` check
     * reports false. Used by controllers that scope spawn to a single mode
     * entry (e.g. walk).
     */
    clear() {
      this._has = false;
    }
    /**
     * Copy the captured pose into the supplied targets. Caller must check
     * `has` first; calling `restore` before `store` returns the field
     * defaults (position and angles zeroed, distance `1`).
     *
     * @param position - Mutated with the stored world position.
     * @param angles - Mutated with the stored Euler angles.
     * @returns The stored camera distance.
     */
    restore(position, angles) {
      position.copy(this._position);
      angles.copy(this._angles);
      return this._distance;
    }
  };

  // vendor/collision/find-spawn.ts
  var SEARCH_RADIUS = 5;
  var SEARCH_RADIUS_SQ = SEARCH_RADIUS * SEARCH_RADIUS;
  var RAY_MAX_DIST = 1e3;
  var findCylinderSpawn = (collision, ox, oy, oz, halfHeight, radius, out2) => {
    const step = collision.voxelResolution;
    const maxCells = Math.ceil(SEARCH_RADIUS / step);
    const footCells = Math.ceil(radius / step);
    const radiusSq = radius * radius;
    let bestDistSq = Infinity;
    let found = false;
    for (let r = 0; r <= maxCells; r++) {
      const shellMinDistSq = r * step * (r * step);
      if (shellMinDistSq >= bestDistSq) break;
      for (let dy = -r; dy <= r; dy++) {
        const absDy = dy < 0 ? -dy : dy;
        for (let dz = -r; dz <= r; dz++) {
          const absDz = dz < 0 ? -dz : dz;
          for (let dx = -r; dx <= r; dx++) {
            const absDx = dx < 0 ? -dx : dx;
            if (absDx < r && absDy < r && absDz < r) continue;
            const distSq = (dx * dx + dy * dy + dz * dz) * step * step;
            if (distSq >= bestDistSq || distSq > SEARCH_RADIUS_SQ) continue;
            const cx = ox + dx * step;
            const cy = oy + dy * step;
            const cz = oz + dz * step;
            if (!collision.isFreeAt(cx, cy, cz)) continue;
            let floor = -Infinity;
            let ceiling = Infinity;
            let supported = true;
            for (let i = -footCells; i <= footCells && supported; i++) {
              const fxOff = i * step;
              const fxOffSq = fxOff * fxOff;
              for (let j = -footCells; j <= footCells; j++) {
                const fzOff = j * step;
                if (fxOffSq + fzOff * fzOff > radiusSq) continue;
                const fx = cx + fxOff;
                const fz = cz + fzOff;
                const down = collision.queryRay(fx, cy, fz, 0, -1, 0, RAY_MAX_DIST);
                if (!down) {
                  supported = false;
                  break;
                }
                if (down.y > floor) floor = down.y;
                const up = collision.queryRay(fx, cy, fz, 0, 1, 0, RAY_MAX_DIST);
                if (up && up.y < ceiling) ceiling = up.y;
              }
            }
            if (!supported) continue;
            if (floor + 2 * halfHeight > ceiling) continue;
            bestDistSq = distSq;
            out2.x = cx;
            out2.y = floor;
            out2.z = cz;
            found = true;
          }
        }
      }
    }
    return found;
  };

  // vendor/cameras/walk-controller.ts
  var FIXED_DT = 1 / 60;
  var MAX_SUBSTEPS = 10;
  var out = { x: 0, y: 0, z: 0 };
  var v = new Vec3();
  var d = new Vec3();
  var forward = new Vec3();
  var right = new Vec3();
  var moveStep = [0, 0, 0];
  var offset = new Vec3();
  var spawnProbe = new Vec3();
  var WalkController = class {
    constructor() {
      /**
       * Optional collision for capsule collision with sliding
       */
      __publicField(this, "collision", null);
      /**
       * Field of view in degrees for walk mode.
       */
      __publicField(this, "fov", 90);
      /**
       * Total capsule height in meters (default: human proportion)
       */
      __publicField(this, "capsuleHeight", 1.5);
      /**
       * Capsule radius in meters
       */
      __publicField(this, "capsuleRadius", 0.2);
      /**
       * Camera height from the bottom of the capsule in meters
       */
      __publicField(this, "eyeHeight", 1.3);
      /**
       * Gravity acceleration in m/s^2
       */
      __publicField(this, "gravity", 9.8);
      /**
       * Jump velocity in m/s
       */
      __publicField(this, "jumpSpeed", 4);
      /**
       * Movement speed in m/s when grounded
       */
      __publicField(this, "moveGroundSpeed", 7);
      /**
       * Movement speed in m/s when in the air (for air control)
       */
      __publicField(this, "moveAirSpeed", 1);
      /**
       * Rotation damping factor (0 = no damping, 1 = full damping)
       */
      __publicField(this, "rotateDamping", DEFAULT_CONTROLLER_DAMPING);
      /**
       * Velocity damping factor when grounded (0 = no damping, 1 = full damping)
       */
      __publicField(this, "velocityDampingGround", 0.99);
      /**
       * Velocity damping factor when in the air (0 = no damping, 1 = full damping)
       */
      __publicField(this, "velocityDampingAir", 0.998);
      /**
       * Target clearance from capsule bottom to ground surface in meters.
       * The capsule hovers this far above terrain to avoid bouncing on noisy surfaces.
       */
      __publicField(this, "hoverHeight", 0.2);
      /**
       * Spring stiffness for ground-following suspension (higher = stiffer tracking).
       */
      __publicField(this, "springStiffness", 800);
      /**
       * Damping coefficient for ground-following suspension.
       * Critical damping is approximately 2 * sqrt(springStiffness).
       */
      __publicField(this, "springDamping", 57);
      /**
       * Maximum downward raycast distance to search for ground below the capsule.
       */
      __publicField(this, "groundProbeRange", 1);
      __publicField(this, "_position", new Vec3());
      __publicField(this, "_prevPosition", new Vec3());
      __publicField(this, "_angles", new Vec3());
      __publicField(this, "_targetAngles", new Vec3());
      __publicField(this, "_distance", 1);
      __publicField(this, "_spawn", new SpawnState());
      __publicField(this, "_spawnGrounded", false);
      __publicField(this, "_velocity", new Vec3());
      __publicField(this, "_pendingMove", [0, 0, 0]);
      __publicField(this, "_accumulator", 0);
      __publicField(this, "_grounded", false);
      __publicField(this, "_jumping", false);
      __publicField(this, "_jumpHeld", false);
    }
    onEnter(camera) {
      this.goto(camera);
      if (this.collision) {
        this._spawn.clear();
        if (findCylinderSpawn(
          this.collision,
          camera.position.x,
          camera.position.y,
          camera.position.z,
          (this.capsuleHeight + this.hoverHeight) * 0.5,
          this.capsuleRadius,
          spawnProbe
        )) {
          this._position.set(
            spawnProbe.x,
            spawnProbe.y + this.hoverHeight + this.eyeHeight,
            spawnProbe.z
          );
          this._grounded = true;
          this._velocity.y = 0;
          this._storeSpawn();
        }
        this._prevPosition.copy(this._position);
      }
    }
    update(deltaTime, inputFrame, camera) {
      const { move, rotate } = inputFrame.read();
      applyFrameRotation(this._targetAngles, rotate);
      dampAngles(this._angles, this._targetAngles, this.rotateDamping, deltaTime);
      this._pendingMove[0] += move[0];
      this._pendingMove[1] = this._pendingMove[1] || move[1];
      this._pendingMove[2] += move[2];
      this._accumulator = Math.min(this._accumulator + deltaTime, MAX_SUBSTEPS * FIXED_DT);
      const numSteps = Math.floor(this._accumulator / FIXED_DT);
      if (numSteps > 0) {
        const invSteps = 1 / numSteps;
        moveStep[0] = this._pendingMove[0] * invSteps;
        moveStep[1] = this._pendingMove[1];
        moveStep[2] = this._pendingMove[2] * invSteps;
        for (let i = 0; i < numSteps; i++) {
          this._prevPosition.copy(this._position);
          this._step(FIXED_DT, moveStep);
          this._accumulator -= FIXED_DT;
        }
        this._pendingMove[0] = 0;
        this._pendingMove[1] = 0;
        this._pendingMove[2] = 0;
      }
      const alpha = this._accumulator / FIXED_DT;
      camera.position.lerp(this._prevPosition, this._position, alpha);
      camera.angles.set(this._angles.x, this._angles.y, 0);
      camera.distance = this._distance;
      camera.fov = this.fov;
    }
    _step(dt, move) {
      const groundY = this._probeGround(this._position);
      const hasGround = groundY !== null;
      if (this._velocity.y < 0) {
        this._jumping = false;
      }
      if (move[1] && !this._jumping && this._grounded && !this._jumpHeld) {
        this._jumping = true;
        this._velocity.y = this.jumpSpeed;
        this._grounded = false;
      }
      this._jumpHeld = !!move[1];
      if (hasGround && !this._jumping) {
        const targetY = groundY + this.hoverHeight + this.eyeHeight;
        const displacement = this._position.y - targetY;
        if (displacement > 0.1) {
          this._velocity.y -= this.gravity * dt;
          const nextY = this._position.y + this._velocity.y * dt;
          if (nextY <= targetY) {
            this._position.y = targetY;
            this._velocity.y = 0;
          }
          this._grounded = false;
        } else {
          const springForce = -this.springStiffness * displacement - this.springDamping * this._velocity.y;
          this._velocity.y += springForce * dt;
          this._grounded = true;
        }
      } else {
        this._velocity.y -= this.gravity * dt;
        this._grounded = false;
      }
      setYawBasis(this._angles.y, forward, right);
      setBasisOffset(offset, move[0], 0, move[2], forward, right, Vec3.UP);
      this._velocity.add(offset.mulScalar(this._grounded ? this.moveGroundSpeed : this.moveAirSpeed));
      const dampFactor = this._grounded ? this.velocityDampingGround : this.velocityDampingAir;
      const alpha = damp(dampFactor, dt);
      this._velocity.x = math.lerp(this._velocity.x, 0, alpha);
      this._velocity.z = math.lerp(this._velocity.z, 0, alpha);
      this._position.add(v.copy(this._velocity).mulScalar(dt));
      this._checkCollision(this._position, d);
    }
    onExit(_camera) {
    }
    /**
     * Teleport the controller to a given camera state (used for transitions).
     *
     * @param camera - The camera state to jump to.
     */
    goto(camera) {
      this._position.copy(camera.position);
      this._prevPosition.copy(this._position);
      this._angles.set(camera.angles.x, camera.angles.y, 0);
      this._targetAngles.copy(this._angles);
      this._distance = camera.distance;
      this._resetMotion();
    }
    /**
     * Reset the controller to the spawn pose captured on the last walk-mode entry.
     *
     * @param camera - Camera state to update with the spawn pose.
     * @returns True if a spawn pose was available.
     */
    resetToSpawn(camera) {
      if (!this._spawn.has) {
        return false;
      }
      this._distance = this._spawn.restore(this._position, this._angles);
      this._prevPosition.copy(this._position);
      this._targetAngles.copy(this._angles);
      this._resetMotion();
      this._grounded = this._spawnGrounded;
      camera.position.copy(this._position);
      camera.angles.copy(this._angles);
      camera.distance = this._distance;
      camera.fov = this.fov;
      return true;
    }
    _storeSpawn() {
      this._spawn.store(this._position, this._angles, this._distance);
      this._spawnGrounded = this._grounded;
    }
    _resetMotion() {
      this._velocity.set(0, 0, 0);
      this._grounded = false;
      this._jumping = false;
      this._jumpHeld = false;
      this._pendingMove[0] = 0;
      this._pendingMove[1] = 0;
      this._pendingMove[2] = 0;
      this._accumulator = 0;
    }
    /**
     * Cast multiple rays downward to find the average ground surface height.
     * Uses 5 rays (center + 4 cardinal at capsule radius) to spatially filter
     * noisy collision heights, giving the spring a smoother target.
     *
     * @param pos - Eye position in PlayCanvas world space.
     * @returns Average ground surface Y in PlayCanvas space, or null if no ground found.
     */
    _probeGround(pos) {
      if (!this.collision) return null;
      const oy = pos.y - this.eyeHeight;
      const r = this.capsuleRadius;
      const range = this.groundProbeRange;
      let totalY = 0;
      let hitCount = 0;
      for (let i = 0; i < 5; i++) {
        let ox = pos.x;
        let oz = pos.z;
        if (i === 1) ox -= r;
        else if (i === 2) ox += r;
        else if (i === 3) oz += r;
        else if (i === 4) oz -= r;
        const hit = this.collision.queryRay(ox, oy, oz, 0, -1, 0, range);
        if (hit) {
          totalY += hit.y;
          hitCount++;
        }
      }
      return hitCount > 0 ? totalY / hitCount : null;
    }
    /**
     * Check for capsule collision and apply push-out displacement.
     * Handles walls, ceiling hits, and fallback floor contact when airborne.
     *
     * @param pos - Eye position in PlayCanvas world space.
     * @param disp - Pre-allocated vector to receive the collision push-out displacement.
     */
    _checkCollision(pos, disp) {
      const center = pos.y - this.eyeHeight + this.capsuleHeight * 0.5;
      const half = this.capsuleHeight * 0.5 - this.capsuleRadius;
      if (this.collision.queryCapsule(pos.x, center, pos.z, half, this.capsuleRadius, out)) {
        disp.set(out.x, out.y, out.z);
        pos.add(disp);
        if (disp.y < 0 && this._velocity.y > 0) {
          this._velocity.y = 0;
        }
        if (!this._grounded && disp.y > 0 && this._velocity.y < 0) {
          this._velocity.y = 0;
          this._grounded = true;
        }
      }
    }
  };

  // vendor/cameras/camera.ts
  var rotation2 = new Quat();
  var avec = new Vec3();
  var bvec = new Vec3();
  var Camera = class {
    constructor(other) {
      __publicField(this, "position", new Vec3());
      __publicField(this, "angles", new Vec3());
      __publicField(this, "distance", 1);
      __publicField(this, "fov", 65);
      if (other) {
        this.copy(other);
      }
    }
    copy(source) {
      this.position.copy(source.position);
      this.angles.copy(source.angles);
      this.distance = source.distance;
      this.fov = source.fov;
    }
    lerp(a, b, t) {
      a.calcFocusPoint(avec);
      b.calcFocusPoint(bvec);
      this.position.lerp(a.position, b.position, t);
      avec.lerp(avec, bvec, t).sub(this.position);
      this.distance = avec.length();
      vecToAngles(this.angles, avec.mulScalar(1 / this.distance));
      this.fov = math.lerp(a.fov, b.fov, t);
    }
    look(from, to) {
      this.position.copy(from);
      this.distance = from.distance(to);
      const dir = avec.sub2(to, from).normalize();
      vecToAngles(this.angles, dir);
    }
    calcFocusPoint(result) {
      rotation2.setFromEulerAngles(this.angles).transformVector(Vec3.FORWARD, result).mulScalar(this.distance).add(this.position);
    }
  };

  // vendor/collision/collision.ts
  var PENETRATION_EPSILON = 1e-4;
  var MAX_RESOLVE_ITERATIONS = 4;
  function resolveIterative(cx, cy, cz, findPenetration, constraintNormals, scratch, out2) {
    let resolvedX = cx;
    let resolvedY = cy;
    let resolvedZ = cz;
    let totalPushX = 0;
    let totalPushY = 0;
    let totalPushZ = 0;
    let hadCollision = false;
    let numNormals = 0;
    for (let iter = 0; iter < MAX_RESOLVE_ITERATIONS; iter++) {
      if (!findPenetration(resolvedX, resolvedY, resolvedZ, scratch)) break;
      hadCollision = true;
      let px = scratch.x;
      let py = scratch.y;
      let pz = scratch.z;
      for (let i = 0; i < numNormals; i++) {
        const n = constraintNormals[i];
        const dot = px * n.x + py * n.y + pz * n.z;
        if (dot < 0) {
          px -= dot * n.x;
          py -= dot * n.y;
          pz -= dot * n.z;
        }
      }
      const len = Math.sqrt(scratch.x * scratch.x + scratch.y * scratch.y + scratch.z * scratch.z);
      if (len > PENETRATION_EPSILON && numNormals < 3) {
        const invLen = 1 / len;
        const n = constraintNormals[numNormals];
        n.x = scratch.x * invLen;
        n.y = scratch.y * invLen;
        n.z = scratch.z * invLen;
        numNormals++;
      }
      resolvedX += px;
      resolvedY += py;
      resolvedZ += pz;
      totalPushX += px;
      totalPushY += py;
      totalPushZ += pz;
    }
    const totalPushSq = totalPushX * totalPushX + totalPushY * totalPushY + totalPushZ * totalPushZ;
    const hasSignificantPush = hadCollision && totalPushSq > PENETRATION_EPSILON * PENETRATION_EPSILON;
    if (hasSignificantPush) {
      out2.x = totalPushX;
      out2.y = totalPushY;
      out2.z = totalPushZ;
    }
    return hasSignificantPush;
  }

  // vendor/collision/voxel-collision.ts
  var SOLID_LEAF_MARKER = 4278190080 >>> 0;
  var FLAT_R = 2;
  var INV_SQRT2 = 1 / Math.sqrt(2);
  var SURFACE_CANDIDATES = [
    // Axis-aligned
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0, 0, 0, 1, 0],
    // XZ diagonals (vertical walls at 45 degrees)
    [1, 0, 1, 0, 1, 0, -1, 0, 1],
    [1, 0, -1, 0, 1, 0, 1, 0, 1],
    // XY diagonals (walls tilted from vertical)
    [1, 1, 0, 0, 0, 1, -1, 1, 0],
    [1, -1, 0, 0, 0, 1, 1, 1, 0],
    // YZ diagonals (sloped floors/ceilings)
    [0, 1, 1, 1, 0, 0, 0, -1, 1],
    [0, 1, -1, 1, 0, 0, 0, 1, 1]
  ];
  function scoreSurfaceCandidate(collision, ix, iy, iz, sx, sy, sz, t1x, t1y, t1z, t2x, t2y, t2z) {
    let best = 0;
    for (let depth = 1; depth >= -1; depth--) {
      let s = 0;
      for (let da = -FLAT_R; da <= FLAT_R; da++) {
        for (let db = -FLAT_R; db <= FLAT_R; db++) {
          const px = ix + da * t1x + db * t2x - sx * depth;
          const py = iy + da * t1y + db * t2y - sy * depth;
          const pz = iz + da * t1z + db * t2z - sz * depth;
          if (collision.isVoxelSolid(px, py, pz) && !collision.isVoxelSolid(px + sx, py + sy, pz + sz)) {
            s++;
          }
        }
      }
      if (s > best) best = s;
    }
    return best;
  }
  function popcount(n) {
    n >>>= 0;
    n -= n >>> 1 & 1431655765;
    n = (n & 858993459) + (n >>> 2 & 858993459);
    return (n + (n >>> 4) & 252645135) * 16843009 >>> 24;
  }
  var VoxelCollision = class {
    constructor(metadata, nodes, leafData) {
      /** Grid-aligned bounds (min xyz) */
      __publicField(this, "_gridMinX");
      __publicField(this, "_gridMinY");
      __publicField(this, "_gridMinZ");
      /** Number of voxels along each axis */
      __publicField(this, "_numVoxelsX");
      __publicField(this, "_numVoxelsY");
      __publicField(this, "_numVoxelsZ");
      /** Size of each voxel in world units */
      __publicField(this, "_voxelResolution");
      /** Voxels per leaf dimension (always 4) */
      __publicField(this, "_leafSize");
      /** Maximum tree depth (number of octree levels above the leaf level) */
      __publicField(this, "_treeDepth");
      /** Flat Laine-Karras node array */
      __publicField(this, "_nodes");
      /** Leaf voxel masks: pairs of (lo, hi) Uint32 per mixed leaf */
      __publicField(this, "_leafData");
      /** Pre-allocated scratch push-out vector to avoid per-frame allocations */
      __publicField(this, "_push", { x: 0, y: 0, z: 0 });
      /** Pre-allocated result for querySurfaceNormal to avoid per-call allocation */
      __publicField(this, "_normalResult", { nx: 0, ny: 0, nz: 0 });
      /** Pre-allocated constraint normals for iterative corner resolution (max 3 walls) */
      __publicField(this, "_constraintNormals", [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 }
      ]);
      this._gridMinX = metadata.gridBounds.min[0];
      this._gridMinY = metadata.gridBounds.min[1];
      this._gridMinZ = metadata.gridBounds.min[2];
      const res = metadata.voxelResolution;
      this._numVoxelsX = Math.round((metadata.gridBounds.max[0] - metadata.gridBounds.min[0]) / res);
      this._numVoxelsY = Math.round((metadata.gridBounds.max[1] - metadata.gridBounds.min[1]) / res);
      this._numVoxelsZ = Math.round((metadata.gridBounds.max[2] - metadata.gridBounds.min[2]) / res);
      this._voxelResolution = res;
      this._leafSize = metadata.leafSize;
      this._treeDepth = metadata.treeDepth;
      this._nodes = nodes;
      this._leafData = leafData;
    }
    /**
     * Grid-aligned bounds minimum X in world units.
     *
     * @returns {number} The minimum X coordinate.
     */
    get gridMinX() {
      return this._gridMinX;
    }
    /**
     * Grid-aligned bounds minimum Y in world units.
     *
     * @returns {number} The minimum Y coordinate.
     */
    get gridMinY() {
      return this._gridMinY;
    }
    /**
     * Grid-aligned bounds minimum Z in world units.
     *
     * @returns {number} The minimum Z coordinate.
     */
    get gridMinZ() {
      return this._gridMinZ;
    }
    /**
     * Number of voxels along the X axis.
     *
     * @returns {number} The voxel count on X.
     */
    get numVoxelsX() {
      return this._numVoxelsX;
    }
    /**
     * Number of voxels along the Y axis.
     *
     * @returns {number} The voxel count on Y.
     */
    get numVoxelsY() {
      return this._numVoxelsY;
    }
    /**
     * Number of voxels along the Z axis.
     *
     * @returns {number} The voxel count on Z.
     */
    get numVoxelsZ() {
      return this._numVoxelsZ;
    }
    /**
     * Size of each voxel in world units.
     *
     * @returns {number} The voxel resolution.
     */
    get voxelResolution() {
      return this._voxelResolution;
    }
    /**
     * Voxels per leaf dimension (always 4).
     *
     * @returns {number} The leaf size.
     */
    get leafSize() {
      return this._leafSize;
    }
    /**
     * Maximum tree depth (number of octree levels above the leaf level).
     *
     * @returns {number} The tree depth.
     */
    get treeDepth() {
      return this._treeDepth;
    }
    /**
     * Flat Laine-Karras node array (read-only access for GPU upload).
     *
     * @returns {Uint32Array} The node array.
     */
    get nodes() {
      return this._nodes;
    }
    /**
     * Leaf voxel masks: pairs of (lo, hi) Uint32 per mixed leaf (read-only access for GPU upload).
     *
     * @returns {Uint32Array} The leaf data array.
     */
    get leafData() {
      return this._leafData;
    }
    /**
     * Whether this data requires X/Y negation (legacy v1.0 format).
     *
     * @returns {boolean} True if coordinates need flipping.
     */
    get flipXY() {
      return false;
    }
    isFreeAt(x, y, z) {
      if (this._nodes.length === 0) {
        return false;
      }
      const res = this._voxelResolution;
      const ix = Math.floor((x - this._gridMinX) / res);
      const iy = Math.floor((y - this._gridMinY) / res);
      const iz = Math.floor((z - this._gridMinZ) / res);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= this._numVoxelsX || iy >= this._numVoxelsY || iz >= this._numVoxelsZ) {
        return false;
      }
      return !this.isVoxelSolid(ix, iy, iz);
    }
    querySurfaceNormal(x, y, z, rdx, rdy, rdz) {
      const nudge = this._voxelResolution * 0.25;
      const ix = Math.floor((x + Math.sign(rdx) * nudge - this._gridMinX) / this._voxelResolution);
      const iy = Math.floor((y + Math.sign(rdy) * nudge - this._gridMinY) / this._voxelResolution);
      const iz = Math.floor((z + Math.sign(rdz) * nudge - this._gridMinZ) / this._voxelResolution);
      const result = this._normalResult;
      let bestScore = -1;
      let bestNx = 0;
      let bestNy = 1;
      let bestNz = 0;
      for (let c = 0; c < SURFACE_CANDIDATES.length; c++) {
        const cand = SURFACE_CANDIDATES[c];
        const dx = cand[0];
        const dy = cand[1];
        const dz = cand[2];
        const dot = rdx * dx + rdy * dy + rdz * dz;
        if (Math.abs(dot) < 1e-6) continue;
        const sign = dot < 0 ? 1 : -1;
        const sx = dx * sign;
        const sy = dy * sign;
        const sz = dz * sign;
        const score = scoreSurfaceCandidate(
          this,
          ix,
          iy,
          iz,
          sx,
          sy,
          sz,
          cand[3],
          cand[4],
          cand[5],
          cand[6],
          cand[7],
          cand[8]
        );
        if (score > bestScore) {
          bestScore = score;
          const mag = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1 ? INV_SQRT2 : 1;
          bestNx = sx * mag;
          bestNy = sy * mag;
          bestNz = sz * mag;
        }
      }
      result.nx = bestNx;
      result.ny = bestNy;
      result.nz = bestNz;
      return result;
    }
    queryRay(ox, oy, oz, dx, dy, dz, maxDist) {
      if (this._nodes.length === 0) {
        return null;
      }
      const res = this._voxelResolution;
      const gMinX = this._gridMinX;
      const gMinY = this._gridMinY;
      const gMinZ = this._gridMinZ;
      const gMaxX = gMinX + this._numVoxelsX * res;
      const gMaxY = gMinY + this._numVoxelsY * res;
      const gMaxZ = gMinZ + this._numVoxelsZ * res;
      const EPS = 1e-12;
      let tNear = 0;
      let tFar = maxDist;
      if (Math.abs(dx) > EPS) {
        let t1 = (gMinX - ox) / dx;
        let t2 = (gMaxX - ox) / dx;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tNear) {
          tNear = t1;
        }
        tFar = Math.min(tFar, t2);
        if (tNear > tFar) return null;
      } else if (ox < gMinX || ox >= gMaxX) {
        return null;
      }
      if (Math.abs(dy) > EPS) {
        let t1 = (gMinY - oy) / dy;
        let t2 = (gMaxY - oy) / dy;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tNear) {
          tNear = t1;
        }
        tFar = Math.min(tFar, t2);
        if (tNear > tFar) return null;
      } else if (oy < gMinY || oy >= gMaxY) {
        return null;
      }
      if (Math.abs(dz) > EPS) {
        let t1 = (gMinZ - oz) / dz;
        let t2 = (gMaxZ - oz) / dz;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tNear) {
          tNear = t1;
        }
        tFar = Math.min(tFar, t2);
        if (tNear > tFar) return null;
      } else if (oz < gMinZ || oz >= gMaxZ) {
        return null;
      }
      const entryX = ox + dx * tNear;
      const entryY = oy + dy * tNear;
      const entryZ = oz + dz * tNear;
      let ix = Math.max(0, Math.min(Math.floor((entryX - gMinX) / res), this._numVoxelsX - 1));
      let iy = Math.max(0, Math.min(Math.floor((entryY - gMinY) / res), this._numVoxelsY - 1));
      let iz = Math.max(0, Math.min(Math.floor((entryZ - gMinZ) / res), this._numVoxelsZ - 1));
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
      const invDx = Math.abs(dx) > EPS ? 1 / dx : 0;
      const invDy = Math.abs(dy) > EPS ? 1 / dy : 0;
      const invDz = Math.abs(dz) > EPS ? 1 / dz : 0;
      let tMaxX = Math.abs(dx) > EPS ? (gMinX + (ix + (dx > 0 ? 1 : 0)) * res - ox) * invDx : Infinity;
      let tMaxY = Math.abs(dy) > EPS ? (gMinY + (iy + (dy > 0 ? 1 : 0)) * res - oy) * invDy : Infinity;
      let tMaxZ = Math.abs(dz) > EPS ? (gMinZ + (iz + (dz > 0 ? 1 : 0)) * res - oz) * invDz : Infinity;
      const tDeltaX = Math.abs(dx) > EPS ? res * Math.abs(invDx) : Infinity;
      const tDeltaY = Math.abs(dy) > EPS ? res * Math.abs(invDy) : Infinity;
      const tDeltaZ = Math.abs(dz) > EPS ? res * Math.abs(invDz) : Infinity;
      let currentT = tNear;
      const maxSteps = this._numVoxelsX + this._numVoxelsY + this._numVoxelsZ;
      for (let step = 0; step < maxSteps; step++) {
        if (this.isVoxelSolid(ix, iy, iz)) {
          return {
            x: ox + dx * currentT,
            y: oy + dy * currentT,
            z: oz + dz * currentT
          };
        }
        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) {
            currentT = tMaxX;
            ix += stepX;
            tMaxX += tDeltaX;
          } else {
            currentT = tMaxZ;
            iz += stepZ;
            tMaxZ += tDeltaZ;
          }
        } else if (tMaxY < tMaxZ) {
          currentT = tMaxY;
          iy += stepY;
          tMaxY += tDeltaY;
        } else {
          currentT = tMaxZ;
          iz += stepZ;
          tMaxZ += tDeltaZ;
        }
        if (ix < 0 || iy < 0 || iz < 0 || ix >= this._numVoxelsX || iy >= this._numVoxelsY || iz >= this._numVoxelsZ || currentT > maxDist) {
          return null;
        }
      }
      return null;
    }
    querySphere(cx, cy, cz, radius, out2) {
      if (this.nodes.length === 0) {
        return false;
      }
      return resolveIterative(
        cx,
        cy,
        cz,
        (rx, ry, rz, push) => this.resolveDeepestPenetration(rx, ry, rz, radius, push),
        this._constraintNormals,
        this._push,
        out2
      );
    }
    queryCapsule(cx, cy, cz, halfHeight, radius, out2) {
      if (this.nodes.length === 0) {
        return false;
      }
      return resolveIterative(
        cx,
        cy,
        cz,
        (rx, ry, rz, push) => this.resolveDeepestPenetrationCapsule(rx, ry, rz, halfHeight, radius, push),
        this._constraintNormals,
        this._push,
        out2
      );
    }
    /**
     * Find the single deepest penetrating voxel for the given sphere.
     *
     * @param cx - Sphere center X.
     * @param cy - Sphere center Y.
     * @param cz - Sphere center Z.
     * @param radius - Sphere radius.
     * @param out - Receives the push-out vector on success.
     * @returns True if a penetrating voxel was found.
     */
    resolveDeepestPenetration(cx, cy, cz, radius, out2) {
      const { voxelResolution, gridMinX, gridMinY, gridMinZ } = this;
      const radiusSq = radius * radius;
      const ixMin = Math.floor((cx - radius - gridMinX) / voxelResolution);
      const iyMin = Math.floor((cy - radius - gridMinY) / voxelResolution);
      const izMin = Math.floor((cz - radius - gridMinZ) / voxelResolution);
      const ixMax = Math.floor((cx + radius - gridMinX) / voxelResolution);
      const iyMax = Math.floor((cy + radius - gridMinY) / voxelResolution);
      const izMax = Math.floor((cz + radius - gridMinZ) / voxelResolution);
      let bestPushX = 0;
      let bestPushY = 0;
      let bestPushZ = 0;
      let bestPenetration = PENETRATION_EPSILON;
      let found = false;
      for (let iz = izMin; iz <= izMax; iz++) {
        for (let iy = iyMin; iy <= iyMax; iy++) {
          for (let ix = ixMin; ix <= ixMax; ix++) {
            if (!this.isVoxelSolid(ix, iy, iz)) {
              continue;
            }
            const vMinX = gridMinX + ix * voxelResolution;
            const vMinY = gridMinY + iy * voxelResolution;
            const vMinZ = gridMinZ + iz * voxelResolution;
            const vMaxX = vMinX + voxelResolution;
            const vMaxY = vMinY + voxelResolution;
            const vMaxZ = vMinZ + voxelResolution;
            const nearX = Math.max(vMinX, Math.min(cx, vMaxX));
            const nearY = Math.max(vMinY, Math.min(cy, vMaxY));
            const nearZ = Math.max(vMinZ, Math.min(cz, vMaxZ));
            const dx = cx - nearX;
            const dy = cy - nearY;
            const dz = cz - nearZ;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq >= radiusSq) {
              continue;
            }
            let px;
            let py;
            let pz;
            let penetration;
            if (distSq > 1e-12) {
              const dist = Math.sqrt(distSq);
              penetration = radius - dist;
              const invDist = 1 / dist;
              px = dx * invDist * penetration;
              py = dy * invDist * penetration;
              pz = dz * invDist * penetration;
            } else {
              const distNegX = cx - vMinX;
              const distPosX = vMaxX - cx;
              const distNegY = cy - vMinY;
              const distPosY = vMaxY - cy;
              const distNegZ = cz - vMinZ;
              const distPosZ = vMaxZ - cz;
              const escapeX = distNegX < distPosX ? -(distNegX + radius) : distPosX + radius;
              const escapeY = distNegY < distPosY ? -(distNegY + radius) : distPosY + radius;
              const escapeZ = distNegZ < distPosZ ? -(distNegZ + radius) : distPosZ + radius;
              const absX = Math.abs(escapeX);
              const absY = Math.abs(escapeY);
              const absZ = Math.abs(escapeZ);
              px = 0;
              py = 0;
              pz = 0;
              if (absX <= absY && absX <= absZ) {
                px = escapeX;
                penetration = absX;
              } else if (absY <= absZ) {
                py = escapeY;
                penetration = absY;
              } else {
                pz = escapeZ;
                penetration = absZ;
              }
            }
            if (penetration > bestPenetration) {
              bestPenetration = penetration;
              bestPushX = px;
              bestPushY = py;
              bestPushZ = pz;
              found = true;
            }
          }
        }
      }
      if (found) {
        out2.x = bestPushX;
        out2.y = bestPushY;
        out2.z = bestPushZ;
      }
      return found;
    }
    /**
     * Find the single deepest penetrating voxel for the given vertical capsule.
     * The capsule is a line segment from (cx, cy - halfHeight, cz) to (cx, cy + halfHeight, cz)
     * swept by radius. For each voxel, the closest point on the segment to the AABB is found,
     * then a sphere-AABB penetration test is performed from that point.
     *
     * @param cx - Capsule center X.
     * @param cy - Capsule center Y.
     * @param cz - Capsule center Z.
     * @param halfHeight - Half-height of the capsule's inner line segment.
     * @param radius - Capsule radius.
     * @param out - Receives the push-out vector on success.
     * @returns True if a penetrating voxel was found.
     */
    resolveDeepestPenetrationCapsule(cx, cy, cz, halfHeight, radius, out2) {
      const { voxelResolution, gridMinX, gridMinY, gridMinZ } = this;
      const radiusSq = radius * radius;
      const segBottomY = cy - halfHeight;
      const segTopY = cy + halfHeight;
      const ixMin = Math.floor((cx - radius - gridMinX) / voxelResolution);
      const iyMin = Math.floor((segBottomY - radius - gridMinY) / voxelResolution);
      const izMin = Math.floor((cz - radius - gridMinZ) / voxelResolution);
      const ixMax = Math.floor((cx + radius - gridMinX) / voxelResolution);
      const iyMax = Math.floor((segTopY + radius - gridMinY) / voxelResolution);
      const izMax = Math.floor((cz + radius - gridMinZ) / voxelResolution);
      let bestPushX = 0;
      let bestPushY = 0;
      let bestPushZ = 0;
      let bestPenetration = PENETRATION_EPSILON;
      let found = false;
      for (let iz = izMin; iz <= izMax; iz++) {
        for (let iy = iyMin; iy <= iyMax; iy++) {
          for (let ix = ixMin; ix <= ixMax; ix++) {
            if (!this.isVoxelSolid(ix, iy, iz)) {
              continue;
            }
            const vMinX = gridMinX + ix * voxelResolution;
            const vMinY = gridMinY + iy * voxelResolution;
            const vMinZ = gridMinZ + iz * voxelResolution;
            const vMaxX = vMinX + voxelResolution;
            const vMaxY = vMinY + voxelResolution;
            const vMaxZ = vMinZ + voxelResolution;
            let segY;
            if (segTopY < vMinY) {
              segY = segTopY;
            } else if (segBottomY > vMaxY) {
              segY = segBottomY;
            } else {
              const aabbCenterY = (vMinY + vMaxY) * 0.5;
              segY = Math.max(segBottomY, Math.min(segTopY, aabbCenterY));
            }
            const nearX = Math.max(vMinX, Math.min(cx, vMaxX));
            const nearY = Math.max(vMinY, Math.min(segY, vMaxY));
            const nearZ = Math.max(vMinZ, Math.min(cz, vMaxZ));
            const dx = cx - nearX;
            const dy = segY - nearY;
            const dz = cz - nearZ;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq >= radiusSq) {
              continue;
            }
            let px;
            let py;
            let pz;
            let penetration;
            if (distSq > 1e-12) {
              const dist = Math.sqrt(distSq);
              penetration = radius - dist;
              const invDist = 1 / dist;
              px = dx * invDist * penetration;
              py = dy * invDist * penetration;
              pz = dz * invDist * penetration;
            } else {
              const distNegX = cx - vMinX;
              const distPosX = vMaxX - cx;
              const distNegY = segY - vMinY;
              const distPosY = vMaxY - segY;
              const distNegZ = cz - vMinZ;
              const distPosZ = vMaxZ - cz;
              const escapeX = distNegX < distPosX ? -(distNegX + radius) : distPosX + radius;
              const escapeY = distNegY < distPosY ? -(distNegY + radius) : distPosY + radius;
              const escapeZ = distNegZ < distPosZ ? -(distNegZ + radius) : distPosZ + radius;
              const absX = Math.abs(escapeX);
              const absY = Math.abs(escapeY);
              const absZ = Math.abs(escapeZ);
              px = 0;
              py = 0;
              pz = 0;
              if (absX <= absY && absX <= absZ) {
                px = escapeX;
                penetration = absX;
              } else if (absY <= absZ) {
                py = escapeY;
                penetration = absY;
              } else {
                pz = escapeZ;
                penetration = absZ;
              }
            }
            if (penetration > bestPenetration) {
              bestPenetration = penetration;
              bestPushX = px;
              bestPushY = py;
              bestPushZ = pz;
              found = true;
            }
          }
        }
      }
      if (found) {
        out2.x = bestPushX;
        out2.y = bestPushY;
        out2.z = bestPushZ;
      }
      return found;
    }
    /**
     * Test whether a voxel at the given grid indices is solid.
     *
     * @param ix - Global voxel X index.
     * @param iy - Global voxel Y index.
     * @param iz - Global voxel Z index.
     * @returns True if the voxel is solid.
     */
    isVoxelSolid(ix, iy, iz) {
      if (this.nodes.length === 0 || ix < 0 || iy < 0 || iz < 0 || ix >= this.numVoxelsX || iy >= this.numVoxelsY || iz >= this.numVoxelsZ) {
        return false;
      }
      const { leafSize, treeDepth } = this;
      const blockX = Math.floor(ix / leafSize);
      const blockY = Math.floor(iy / leafSize);
      const blockZ = Math.floor(iz / leafSize);
      let nodeIndex = 0;
      for (let level = treeDepth - 1; level >= 0; level--) {
        const node2 = this.nodes[nodeIndex] >>> 0;
        if (node2 === SOLID_LEAF_MARKER) {
          return true;
        }
        const childMask = node2 >>> 24 & 255;
        if (childMask === 0) {
          return this.checkLeafByIndex(node2, ix, iy, iz);
        }
        const bitX = blockX >>> level & 1;
        const bitY = blockY >>> level & 1;
        const bitZ = blockZ >>> level & 1;
        const octant = bitZ << 2 | bitY << 1 | bitX;
        if ((childMask & 1 << octant) === 0) {
          return false;
        }
        const baseOffset = node2 & 16777215;
        const prefix = (1 << octant) - 1;
        const childOffset = popcount(childMask & prefix);
        nodeIndex = baseOffset + childOffset;
      }
      const node = this.nodes[nodeIndex] >>> 0;
      if (node === SOLID_LEAF_MARKER) {
        return true;
      }
      return this.checkLeafByIndex(node, ix, iy, iz);
    }
    /**
     * Check a mixed leaf node using voxel grid indices.
     * The solid leaf sentinel must be checked before calling this method.
     *
     * @param node - The mixed leaf node value (lower 24 bits = leafData index).
     * @param ix - Global voxel X index.
     * @param iy - Global voxel Y index.
     * @param iz - Global voxel Z index.
     * @returns True if the voxel is solid.
     */
    checkLeafByIndex(node, ix, iy, iz) {
      const leafDataIndex = node & 16777215;
      const vx = ix & 3;
      const vy = iy & 3;
      const vz = iz & 3;
      const bitIndex = vz * 16 + vy * 4 + vx;
      if (bitIndex < 32) {
        const lo = this.leafData[leafDataIndex * 2] >>> 0;
        return (lo >>> bitIndex & 1) === 1;
      }
      const hi = this.leafData[leafDataIndex * 2 + 1] >>> 0;
      return (hi >>> bitIndex - 32 & 1) === 1;
    }
  };

  // gta6-adapter.ts
  var pc = globalThis.pc;
  var MOVE_SPEED = 4;
  var RUN_MULTIPLIER = 2;
  var LOOK_SENSITIVITY = 0.15;
  var SimpleInputFrame = class {
    constructor(shape) {
      __publicField(this, "deltas", {});
      for (const k of Object.keys(shape)) {
        const value = shape[k].map(() => 0);
        this.deltas[k] = {
          value,
          append(a) {
            for (let i = 0; i < a.length; i++) value[i] += a[i];
          }
        };
      }
    }
    read() {
      const out2 = {};
      for (const k of Object.keys(this.deltas)) {
        out2[k] = this.deltas[k].value.slice();
        this.deltas[k].value.fill(0);
      }
      return out2;
    }
  };
  var BALL_RADIUS = 0.12;
  var BALL_RESTITUTION = 0.55;
  var BALL_FRICTION = 0.985;
  var BALL_GRAVITY = 9.8;
  var MAX_BALLS = 48;
  var THROW_SPEED = 8;
  var BallPhysics = class {
    constructor(app, collision) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "balls", []);
      __publicField(this, "obstacles", []);
      __publicField(this, "_push", { x: 0, y: 0, z: 0 });
      this.app = app;
      this.collision = collision;
    }
    throwBall(origin, dir) {
      if (this.balls.length >= MAX_BALLS) {
        const oldest = this.balls.shift();
        if (oldest.entity) oldest.entity.destroy();
      }
      let e = null;
      try {
        e = new pc.Entity("ball");
        e.addComponent("render", { type: "sphere" });
        const mat = new pc.StandardMaterial();
        const h = Math.random();
        mat.diffuse.set(0.4 + 0.6 * Math.abs(Math.sin(h * 12.9)), 0.4 + 0.6 * Math.abs(Math.sin(h * 78.2 + 2)), 0.4 + 0.6 * Math.abs(Math.sin(h * 39.4 + 4)));
        mat.update();
        e.render.meshInstances[0].material = mat;
        e.setLocalScale(BALL_RADIUS * 2, BALL_RADIUS * 2, BALL_RADIUS * 2);
        e.setPosition(origin.x + dir.x * 0.4, origin.y + dir.y * 0.4, origin.z + dir.z * 0.4);
        this.app.root.addChild(e);
      } catch (err) {
        e = null;
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
    step(dt) {
      const col = this.collision;
      const push = this._push;
      const balls = this.balls;
      for (const b of balls) {
        b.v.y -= BALL_GRAVITY * dt;
        b.p.x += b.v.x * dt;
        b.p.y += b.v.y * dt;
        b.p.z += b.v.z * dt;
        if (col.querySphere(b.p.x, b.p.y, b.p.z, BALL_RADIUS, push)) {
          b.p.x += push.x;
          b.p.y += push.y;
          b.p.z += push.z;
          const len = Math.sqrt(push.x * push.x + push.y * push.y + push.z * push.z);
          if (len > 1e-9) {
            const nx = push.x / len, ny = push.y / len, nz = push.z / len;
            const vn = b.v.x * nx + b.v.y * ny + b.v.z * nz;
            if (vn < 0) {
              b.v.x -= (1 + BALL_RESTITUTION) * vn * nx;
              b.v.y -= (1 + BALL_RESTITUTION) * vn * ny;
              b.v.z -= (1 + BALL_RESTITUTION) * vn * nz;
              b.v.x *= BALL_FRICTION;
              b.v.y *= BALL_FRICTION;
              b.v.z *= BALL_FRICTION;
            }
            if (ny > 0.5 && Math.abs(b.v.y) < 0.3 && b.v.x * b.v.x + b.v.z * b.v.z < 0.04) {
              b.v.y = 0;
            }
          }
        }
        if (b.p.y < col.gridMinY - 10) {
          b.v.x = b.v.y = b.v.z = 0;
          b.p.y = col.gridMinY + col.numVoxelsY * col.voxelResolution * 0.5;
        }
      }
      for (const o of this.obstacles) {
        for (const b of balls) {
          if (b.p.y < o.minY - BALL_RADIUS || b.p.y > o.maxY + BALL_RADIUS) continue;
          const dx = b.p.x - o.x, dz = b.p.z - o.z;
          const d2 = dx * dx + dz * dz;
          const minD = o.radius + BALL_RADIUS;
          if (d2 > 1e-12 && d2 < minD * minD) {
            const d3 = Math.sqrt(d2);
            const nx = dx / d3, nz = dz / d3;
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
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i], c = balls[j];
          const dx = c.p.x - a.p.x, dy = c.p.y - a.p.y, dz = c.p.z - a.p.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const minD = BALL_RADIUS * 2;
          if (d2 > 1e-12 && d2 < minD * minD) {
            const d3 = Math.sqrt(d2);
            const nx = dx / d3, ny = dy / d3, nz = dz / d3;
            const overlap = (minD - d3) * 0.5;
            a.p.x -= nx * overlap;
            a.p.y -= ny * overlap;
            a.p.z -= nz * overlap;
            c.p.x += nx * overlap;
            c.p.y += ny * overlap;
            c.p.z += nz * overlap;
            const rvx = c.v.x - a.v.x, rvy = c.v.y - a.v.y, rvz = c.v.z - a.v.z;
            const vn = rvx * nx + rvy * ny + rvz * nz;
            if (vn < 0) {
              const imp = -(1 + BALL_RESTITUTION) * vn * 0.5;
              a.v.x -= imp * nx;
              a.v.y -= imp * ny;
              a.v.z -= imp * nz;
              c.v.x += imp * nx;
              c.v.y += imp * ny;
              c.v.z += imp * nz;
            }
          }
        }
      }
      for (const b of balls) {
        if (b.entity) b.entity.setPosition(b.p.x, b.p.y, b.p.z);
      }
    }
  };
  var NPC_ASSET_IDS = {
    model: [298980993, "npc-soldier2.glb"],
    idle: [298980995, "npc-idle.glb"],
    walk: [298980998, "npc-walk-forward.glb"],
    run: [298980999, "npc-run-forward.glb"],
    deathFront: [298981004, "npc-death-from-the-front.glb"],
    deathBack: [298981007, "npc-death-from-the-back.glb"],
    gun: [298983884, "npc-m16.glb"],
    flash: [298983886, "npc-muzzle-flash.glb"]
  };
  var GUN_LOCAL_POS = [-0.01, 0.1, 0.01];
  var GUN_LOCAL_EULER = [160, 0, 105];
  var GUN_LOCAL_SCALE = 50;
  var FLASH_LOCAL_POS = [0.9191, 0.1532, -64e-4];
  var FLASH_LOCAL_SCALE = 100;
  var NPC_COUNT = 3;
  var NPC_HP = 3;
  var NPC_HEIGHT = 1.7;
  var NPC_RADIUS = 0.3;
  var NPC_WALK_SPEED = 1.1;
  var NPC_HIT_COOLDOWN = 0.35;
  var NPC_CORPSE_TIME = 6;
  var NPC_MIN_BALL_SPEED = 2;
  var NpcSystem = class {
    constructor(app, collision, cameraEntity) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "cameraEntity");
      __publicField(this, "npcs", []);
      __publicField(this, "assets", {});
      __publicField(this, "ready", false);
      __publicField(this, "failed", false);
      __publicField(this, "npcHeight", NPC_HEIGHT);
      __publicField(this, "npcRadius", NPC_RADIUS);
      __publicField(this, "_push", { x: 0, y: 0, z: 0 });
      __publicField(this, "_screenPos");
      this.app = app;
      this.collision = collision;
      this.cameraEntity = cameraEntity;
      this._screenPos = new pc.Vec3();
      this._loadAssets();
    }
    _branchQuery() {
      try {
        const cfg = window.config;
        const bid = cfg && (cfg.self?.branch?.id || cfg.self?.branchId) || "87d9f884-5657-4343-887e-e823e912488f";
        return `?branchId=${bid}`;
      } catch (e) {
        return "";
      }
    }
    _loadAssets() {
      const names = Object.keys(NPC_ASSET_IDS);
      let remaining = names.length;
      const q = this._branchQuery();
      for (const key of names) {
        const [id, fname] = NPC_ASSET_IDS[key];
        const url = `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
        const asset = new pc.Asset(fname, "container", { url, filename: fname });
        asset.on("load", () => {
          this.assets[key] = asset;
          if (--remaining === 0) this._onAssetsReady();
        });
        asset.on("error", (err) => {
          console.error("npc asset failed:", fname, err);
          this.failed = true;
        });
        this.app.assets.add(asset);
        this.app.assets.load(asset);
      }
    }
    _measureModel(model) {
      let min = null, max = null;
      const rs = model.findComponents("render");
      for (const r of rs) {
        for (const mi of r.meshInstances) {
          const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
          if (!min) {
            min = { x: mn.x, y: mn.y, z: mn.z };
            max = { x: mx.x, y: mx.y, z: mx.z };
          } else {
            min.x = Math.min(min.x, mn.x);
            min.y = Math.min(min.y, mn.y);
            min.z = Math.min(min.z, mn.z);
            max.x = Math.max(max.x, mx.x);
            max.y = Math.max(max.y, mx.y);
            max.z = Math.max(max.z, mx.z);
          }
        }
      }
      if (!min) return null;
      return { minY: min.y, ext: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } };
    }
    _track(key) {
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
      const clearances = [];
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
        this.npcHeight = Math.max(0.5, Math.min(2.2, median * 0.55));
        this.npcRadius = this.npcHeight * 0.18;
        console.log("npcSystem: corridor clearance", median.toFixed(2), "\u2192 soldier height", this.npcHeight.toFixed(2));
      }
    }
    _onAssetsReady() {
      try {
        this._measureHallway();
        for (let i = 0; i < NPC_COUNT; i++) this._spawnNpc(i);
        this.ready = true;
        console.log("npcSystem: spawned", this.npcs.length, "soldiers");
      } catch (e) {
        console.error("npcSystem spawn failed", e);
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
        const up = col.queryRay(x, floor + 0.2, z, 0, 1, 0, 20);
        if (up && up.y - floor < this.npcHeight + 0.1) continue;
        if (!col.isFreeAt(x, floor + 0.9, z)) continue;
        return { x, y: floor, z };
      }
      return null;
    }
    _spawnNpc(seed) {
      const spot = this._randomFloorSpot();
      if (!spot) return;
      const root = new pc.Entity("npc");
      const model = this.assets.model.resource.instantiateRenderEntity();
      root.addChild(model);
      this.app.root.addChild(root);
      model.setLocalEulerAngles(0, 180, 0);
      model.addComponent("anim", { activate: true });
      const idle = this._track("idle");
      const walk = this._track("walk");
      const deathF = this._track("deathFront");
      const deathB = this._track("deathBack");
      if (idle) model.anim.assignAnimation("Idle", idle);
      if (walk) model.anim.assignAnimation("Walk", walk);
      if (deathF) model.anim.assignAnimation("DeathF", deathF, void 0, 1, false);
      if (deathB) model.anim.assignAnimation("DeathB", deathB, void 0, 1, false);
      root.setPosition(spot.x, spot.y, spot.z);
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;transform:translate(-50%,-100%);z-index:9997;color:#fff;background:rgba(30,30,30,0.75);font:11px monospace;padding:1px 7px;border-radius:9px;pointer-events:none;white-space:nowrap;";
      document.body.appendChild(el);
      const npc = {
        root,
        model,
        p: { x: spot.x, y: spot.y, z: spot.z },
        target: null,
        state: "idle",
        // idle | walk | dying | dead
        stateTime: 1 + Math.random() * 3,
        hp: NPC_HP,
        hitCooldown: 0,
        yaw: Math.random() * 360,
        fit: { phase: "orient", wait: 3, idx: 0, results: [] },
        el
      };
      this._setAnim(npc, "Idle");
      this._syncTag(npc);
      this.npcs.push(npc);
    }
    _setAnim(npc, stateName) {
      try {
        const anim = npc.model.anim;
        if (anim && anim.baseLayer && npc._animState !== stateName) {
          anim.baseLayer.transition(stateName, 0.2);
          npc._animState = stateName;
        }
      } catch (e) {
      }
    }
    _syncTag(npc) {
      if (!npc.el) return;
      if (npc.state === "dying" || npc.state === "dead") {
        npc.el.textContent = "soldier \u2620";
        npc.el.style.background = "rgba(120,20,20,0.8)";
      } else {
        npc.el.textContent = `soldier ${"\u2665".repeat(npc.hp)}`;
        npc.el.style.background = "rgba(30,30,30,0.75)";
      }
    }
    _pickTarget(npc) {
      const spot = this._randomFloorSpot();
      if (spot) {
        npc.target = spot;
        npc.state = "walk";
        this._setAnim(npc, "Walk");
      } else {
        npc.state = "idle";
        npc.stateTime = 2;
      }
    }
    hitTest(ball, dt) {
      if (!this.ready) return;
      const speedSq = ball.v.x * ball.v.x + ball.v.y * ball.v.y + ball.v.z * ball.v.z;
      if (speedSq < NPC_MIN_BALL_SPEED * NPC_MIN_BALL_SPEED) return;
      for (const npc of this.npcs) {
        if (npc.state === "dying" || npc.state === "dead" || npc.hitCooldown > 0) continue;
        const dx = ball.p.x - npc.p.x;
        const dz = ball.p.z - npc.p.z;
        const dy = ball.p.y - (npc.p.y + this.npcHeight * 0.5);
        const xz = Math.sqrt(dx * dx + dz * dz);
        const withinY = Math.abs(dy) < this.npcHeight * 0.5 + BALL_RADIUS;
        if (xz < this.npcRadius + BALL_RADIUS && withinY) {
          npc.hp--;
          npc.hitCooldown = NPC_HIT_COOLDOWN;
          const nx = xz > 1e-6 ? dx / xz : 1, nz = xz > 1e-6 ? dz / xz : 0;
          const vn = ball.v.x * nx + ball.v.z * nz;
          if (vn < 0) {
            ball.v.x -= 1.6 * vn * nx;
            ball.v.z -= 1.6 * vn * nz;
          }
          if (npc.hp <= 0) {
            npc.state = "dying";
            npc.stateTime = NPC_CORPSE_TIME;
            const camFwd = { x: -nx, z: -nz };
            const facing = { x: -Math.sin(npc.yaw * Math.PI / 180), z: -Math.cos(npc.yaw * Math.PI / 180) };
            const frontal = camFwd.x * facing.x + camFwd.z * facing.z < 0;
            this._setAnim(npc, frontal ? "DeathB" : "DeathF");
          }
          this._syncTag(npc);
        }
      }
    }
    /** world-space Y of a skeleton bone whose name contains `part` */
    _boneY(model, part) {
      const stack = [model];
      while (stack.length) {
        const n = stack.pop();
        if (n.name && n.name.indexOf(part) !== -1) return n.getPosition().y;
        const ch = n.children;
        for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
      }
      return null;
    }
    _fitStep(npc) {
      const CANDS = [[0, 180, 0], [-90, 180, 0], [90, 180, 0], [180, 180, 0], [180, 0, 0]];
      const fit = npc.fit;
      if (fit.wait > 0) {
        fit.wait--;
        return;
      }
      const m = this._measureModel(npc.model);
      if (!m || !isFinite(m.ext.y) || m.ext.y <= 0.01) {
        fit.wait = 3;
        return;
      }
      if (fit.phase === "orient") {
        const headY = this._boneY(npc.model, "Head");
        const hipsY = this._boneY(npc.model, "Hips");
        const upright = headY !== null && hipsY !== null ? headY - hipsY : 0;
        fit.results.push({ yExt: m.ext.y, upright });
        fit.idx++;
        if (fit.idx < CANDS.length) {
          const c = CANDS[fit.idx];
          npc.model.setLocalEulerAngles(c[0], c[1], c[2]);
          fit.wait = 2;
        } else {
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
          console.log(
            "npcSystem: orientation",
            JSON.stringify(c),
            "candidates",
            fit.results.map((r) => `${r.yExt.toFixed(2)}${r.upright > 0 ? "\u2191" : "\u2193"}`).join("/")
          );
          fit.phase = "scale";
          fit.wait = 2;
        }
      } else if (fit.phase === "scale") {
        const cur = npc.model.getLocalScale().x;
        const scale = cur * (this.npcHeight / m.ext.y);
        npc.model.setLocalScale(scale, scale, scale);
        console.log("npcSystem: model height", m.ext.y.toFixed(2), "\u2192 scale", scale.toFixed(4));
        fit.phase = "ground";
        fit.wait = 2;
      } else if (fit.phase === "ground") {
        const lp = npc.model.getLocalPosition();
        npc.model.setLocalPosition(lp.x, lp.y + (npc.p.y - m.minY), lp.z);
        npc.fit = null;
        this._attachWeapon(npc);
      }
    }
    /** clone m16 + muzzle flash into the right-hand bone (recipe from the old FPS project) */
    _attachWeapon(npc) {
      try {
        if (!this.assets.gun || npc.gun) return;
        let hand = npc.model.findByName("mixamorig:RightHand");
        if (!hand) {
          const all = npc.model.find((n) => n.name && n.name.indexOf("RightHand") !== -1);
          hand = all && all.length ? all[0] : null;
        }
        if (!hand) {
          console.warn("npcSystem: RightHand bone not found");
          return;
        }
        const gun = this.assets.gun.resource.instantiateRenderEntity();
        hand.addChild(gun);
        gun.setLocalPosition(GUN_LOCAL_POS[0], GUN_LOCAL_POS[1], GUN_LOCAL_POS[2]);
        gun.setLocalEulerAngles(GUN_LOCAL_EULER[0], GUN_LOCAL_EULER[1], GUN_LOCAL_EULER[2]);
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
        console.log("npcSystem: m16 attached to", npc.root.name, "scale", GUN_LOCAL_SCALE);
      } catch (e) {
        console.warn("npcSystem: weapon attach failed", e);
      }
    }
    step(dt, balls) {
      if (!this.ready) return;
      const col = this.collision;
      for (const b of balls) this.hitTest(b, dt);
      for (const npc of this.npcs) {
        if (npc.fit && npc.state !== "dead") this._fitStep(npc);
        if (npc.hitCooldown > 0) npc.hitCooldown -= dt;
        if (npc.flash && npc.state !== "dying" && npc.state !== "dead") {
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
        if (npc.state === "dying") {
          npc.stateTime -= dt;
          if (npc.stateTime <= 0) {
            npc.state = "dead";
            npc.root.destroy();
            if (npc.el) npc.el.remove();
            this._spawnNpc(0);
          }
          continue;
        }
        if (npc.state === "dead") continue;
        if (npc.state === "idle") {
          npc.stateTime -= dt;
          if (npc.stateTime <= 0) this._pickTarget(npc);
        } else if (npc.state === "walk" && npc.target) {
          const dx = npc.target.x - npc.p.x;
          const dz = npc.target.z - npc.p.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 0.4) {
            npc.target = null;
            npc.state = "idle";
            npc.stateTime = 1.5 + Math.random() * 3.5;
            this._setAnim(npc, "Idle");
          } else {
            const nx = dx / dist, nz = dz / dist;
            npc.p.x += nx * NPC_WALK_SPEED * dt;
            npc.p.z += nz * NPC_WALK_SPEED * dt;
            const targetYaw = Math.atan2(-nx, -nz) * 180 / Math.PI;
            let dyaw = targetYaw - npc.yaw;
            while (dyaw > 180) dyaw -= 360;
            while (dyaw < -180) dyaw += 360;
            npc.yaw += Math.max(-360 * dt, Math.min(360 * dt, dyaw));
            const down = col.queryRay(npc.p.x, npc.p.y + 1.2, npc.p.z, 0, -1, 0, 3);
            if (down) npc.p.y += (down.y - npc.p.y) * Math.min(1, dt * 10);
            const cy = npc.p.y + this.npcHeight * 0.5;
            if (col.queryCapsule(npc.p.x, cy, npc.p.z, this.npcHeight * 0.5 - this.npcRadius, this.npcRadius, this._push)) {
              npc.p.x += this._push.x;
              npc.p.z += this._push.z;
              const pushMag = Math.abs(this._push.x) + Math.abs(this._push.z);
              if (pushMag > 0.03) {
                npc.target = null;
                npc.state = "idle";
                npc.stateTime = 0.5;
                this._setAnim(npc, "Idle");
              }
            }
          }
        }
        npc.root.setPosition(npc.p.x, npc.p.y, npc.p.z);
        npc.root.setEulerAngles(0, npc.yaw, 0);
      }
      const camComp = this.cameraEntity.camera;
      const canvas = this.app.graphicsDevice.canvas;
      if (camComp && canvas) {
        const sx = canvas.clientWidth / canvas.width;
        const sy = canvas.clientHeight / canvas.height;
        for (const npc of this.npcs) {
          if (!npc.el || npc.state === "dead") continue;
          camComp.worldToScreen(new pc.Vec3(npc.p.x, npc.p.y + this.npcHeight + 0.15, npc.p.z), this._screenPos);
          if (this._screenPos.z < 0) {
            npc.el.style.display = "none";
            continue;
          }
          npc.el.style.display = "block";
          npc.el.style.left = `${this._screenPos.x * sx}px`;
          npc.el.style.top = `${this._screenPos.y * sy}px`;
        }
      }
    }
  };
  var PROP_ASSET = [298983207, "prop-mega-knight.glb"];
  var PROP_HEIGHT_FACTOR = 0.65;
  var PropSystem = class {
    constructor(app, collision) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "ready", false);
      __publicField(this, "prop", null);
      /** cylinder obstacles for BallPhysics: {x, z, radius, minY, maxY} */
      __publicField(this, "obstacles", []);
      this.app = app;
      this.collision = collision;
      this._load();
    }
    _load() {
      const [id, fname] = PROP_ASSET;
      let q = "";
      try {
        const cfg = window.config;
        const bid = cfg && (cfg.self?.branch?.id || cfg.self?.branchId) || "87d9f884-5657-4343-887e-e823e912488f";
        q = `?branchId=${bid}`;
      } catch (e) {
      }
      const url = `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
      const asset = new pc.Asset(fname, "container", { url, filename: fname });
      asset.on("load", () => this._spawn(asset));
      asset.on("error", (err) => console.error("prop asset failed:", fname, err));
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    }
    _corridorStats() {
      const col = this.collision;
      const res = col.voxelResolution;
      const midY = col.gridMinY + col.numVoxelsY * res * 0.5;
      const gMaxX = col.gridMinX + col.numVoxelsX * res;
      const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;
      const cs = [];
      const floors = [];
      for (let i = 0; i < 80 && cs.length < 30; i++) {
        const x = col.gridMinX + 0.5 + Math.random() * (gMaxX - col.gridMinX - 1);
        const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
        const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
        const up = col.queryRay(x, midY, z, 0, 1, 0, 30);
        if (down && up) {
          cs.push(up.y - down.y);
          floors.push(down.y);
        }
      }
      if (cs.length < 5) return { clearance: 2.4, floor: col.gridMinY };
      cs.sort((a, b) => a - b);
      floors.sort((a, b) => a - b);
      return {
        clearance: cs[Math.floor(cs.length / 2)],
        floor: floors[Math.floor(floors.length / 2)]
      };
    }
    _validSpot(x, z, stats, targetHeight) {
      const col = this.collision;
      const res = col.voxelResolution;
      const midY = col.gridMinY + col.numVoxelsY * res * 0.5;
      const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
      if (!down) return null;
      if (Math.abs(down.y - stats.floor) > 0.4) return null;
      const up = col.queryRay(x, down.y + 0.2, z, 0, 1, 0, 30);
      if (up && up.y - down.y < targetHeight + 0.15) return null;
      if (!col.isFreeAt(x, down.y + 0.6, z)) return null;
      if (!col.isFreeAt(x, down.y + 1.2, z)) return null;
      return { x, y: down.y, z };
    }
    _spawn(asset) {
      const col = this.collision;
      const res = col.voxelResolution;
      const midX = col.gridMinX + col.numVoxelsX * res * 0.5;
      const midZ = col.gridMinZ + col.numVoxelsZ * res * 0.5;
      const gMaxX = col.gridMinX + col.numVoxelsX * res;
      const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;
      const stats = this._corridorStats();
      const targetHeight = stats.clearance * PROP_HEIGHT_FACTOR;
      let spot = null;
      for (const dz of [-4, 4, -6, 6, -2, 2, 0, -8, 8]) {
        spot = this._validSpot(midX, midZ + dz, stats, targetHeight);
        if (spot) break;
      }
      for (let i = 0; !spot && i < 150; i++) {
        const x = col.gridMinX + 0.4 + Math.random() * (gMaxX - col.gridMinX - 0.8);
        const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
        spot = this._validSpot(x, z, stats, targetHeight);
      }
      if (!spot) {
        console.warn("prop: no floor spot found");
        return;
      }
      console.log("propSystem: placing at", spot.x.toFixed(2), spot.y.toFixed(2), spot.z.toFixed(2), "floor median", stats.floor.toFixed(2));
      const root = new pc.Entity("mega-knight");
      const model = asset.resource.instantiateRenderEntity();
      root.addChild(model);
      this.app.root.addChild(root);
      root.setPosition(spot.x, spot.y, spot.z);
      root.setEulerAngles(0, spot.z < midZ ? 0 : 180, 0);
      this.prop = {
        root,
        model,
        p: spot,
        targetHeight,
        fit: { phase: "scale", wait: 3 }
      };
    }
    _measure(model) {
      let min = null, max = null;
      const rs = model.findComponents("render");
      for (const r of rs) {
        for (const mi of r.meshInstances) {
          const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
          if (!min) {
            min = { x: mn.x, y: mn.y, z: mn.z };
            max = { x: mx.x, y: mx.y, z: mx.z };
          } else {
            min.x = Math.min(min.x, mn.x);
            min.y = Math.min(min.y, mn.y);
            min.z = Math.min(min.z, mn.z);
            max.x = Math.max(max.x, mx.x);
            max.y = Math.max(max.y, mx.y);
            max.z = Math.max(max.z, mx.z);
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
    step(dt) {
      const prop = this.prop;
      if (!prop || !prop.fit) return;
      const fit = prop.fit;
      if (fit.wait > 0) {
        fit.wait--;
        return;
      }
      const m = this._measure(prop.model);
      if (!m || !isFinite(m.ext.y) || m.ext.y <= 0.01) {
        fit.wait = 3;
        return;
      }
      if (fit.phase === "scale") {
        const cur = prop.model.getLocalScale().x;
        const scale = cur * (prop.targetHeight / m.ext.y);
        prop.model.setLocalScale(scale, scale, scale);
        console.log("propSystem: mega knight height", m.ext.y.toFixed(2), "\u2192 scale", scale.toFixed(4), "target", prop.targetHeight.toFixed(2));
        fit.phase = "ground";
        fit.wait = 2;
      } else if (fit.phase === "ground") {
        const ws = new pc.Vec3(
          prop.p.x - m.center.x,
          prop.p.y - m.minY,
          prop.p.z - m.center.z
        );
        const inv = prop.root.getRotation().clone().invert();
        const ls = inv.transformVector(ws, new pc.Vec3());
        const lp = prop.model.getLocalPosition();
        prop.model.setLocalPosition(lp.x + ls.x, lp.y + ls.y, lp.z + ls.z);
        console.log("propSystem: recentered by", ws.x.toFixed(2), ws.y.toFixed(2), ws.z.toFixed(2));
        const radius = Math.max(m.ext.x, m.ext.z) * 0.4;
        this.obstacles.length = 0;
        this.obstacles.push({
          x: prop.p.x,
          z: prop.p.z,
          radius,
          minY: prop.p.y,
          maxY: prop.p.y + prop.targetHeight
        });
        prop.fit = null;
        this.ready = true;
      }
    }
  };
  var MAX_KILL_SPHERES = 16;
  var KILL_CHUNK_GLSL = `
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
  var KILL_CHUNK_WGSL = `
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
  var LabelSystem = class {
    constructor(app, collision, cameraEntity) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "cameraEntity");
      __publicField(this, "markers", []);
      __publicField(this, "labelsVisible", true);
      __publicField(this, "_splatEntity", null);
      __publicField(this, "_chunkInstalled", false);
      __publicField(this, "_screenPos");
      __publicField(this, "_origIsVoxelSolid", null);
      this.app = app;
      this.collision = collision;
      this.cameraEntity = cameraEntity;
      this._screenPos = new pc.Vec3();
      const col = collision;
      const orig = col.isVoxelSolid.bind(col);
      this._origIsVoxelSolid = orig;
      const markers = this.markers;
      col.isVoxelSolid = function(ix, iy, iz) {
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
      const names = ["University 3", "splat"];
      for (const n of names) {
        const e = this.app.root.findByName(n);
        if (e && e.gsplat) {
          this._splatEntity = e;
          break;
        }
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
        if (chunks && chunks.glsl) chunks.glsl.set("gsplatModifyVS", KILL_CHUNK_GLSL);
        if (chunks && chunks.wgsl) chunks.wgsl.set("gsplatModifyVS", KILL_CHUNK_WGSL);
        mat.update();
        this._chunkInstalled = true;
        this._pushUniforms();
        return true;
      } catch (e) {
        console.warn("labelSystem: shader chunk install failed", e);
        return false;
      }
    }
    /** world → splat local space (entity is rotated 180° around Z at origin) */
    _worldToSplatLocal(p) {
      const splat = this._findSplatEntity();
      if (!splat) return { x: p.x, y: p.y, z: p.z };
      const inv = splat.getWorldTransform().clone().invert();
      const v2 = inv.transformPoint(new pc.Vec3(p.x, p.y, p.z));
      return { x: v2.x, y: v2.y, z: v2.z };
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
      mat.setParameter("uKillSpheres[0]", data);
      mat.setParameter("uKillCount", n);
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
        if (off < Math.max(m.radius, 0.5) && t < bestT) {
          bestT = t;
          best = m;
        }
      }
      return best;
    }
    placeMarker(label) {
      const hit = this.aimHit();
      if (!hit) return null;
      const marker = {
        center: { x: hit.x, y: hit.y, z: hit.z },
        radius: 0.5,
        label: label || `object ${this.markers.length + 1}`,
        removed: false,
        sphere: null,
        el: null
      };
      const sphere = new pc.Entity("label-sphere");
      sphere.addComponent("render", { type: "sphere" });
      const mat = new pc.StandardMaterial();
      mat.diffuse.set(0.2, 0.7, 1);
      mat.emissive.set(0.05, 0.25, 0.4);
      mat.blendType = pc.BLEND_NORMAL;
      mat.opacity = 0.22;
      mat.depthWrite = false;
      mat.update();
      sphere.render.meshInstances[0].material = mat;
      sphere.setPosition(hit.x, hit.y, hit.z);
      sphere.setLocalScale(1, 1, 1);
      this.app.root.addChild(sphere);
      marker.sphere = sphere;
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;transform:translate(-50%,-140%);z-index:9998;color:#fff;background:rgba(20,110,220,0.85);font:12px monospace;padding:2px 8px;border-radius:10px;pointer-events:none;white-space:nowrap;";
      el.textContent = marker.label;
      document.body.appendChild(el);
      marker.el = el;
      this.markers.push(marker);
      this._syncMarker(marker);
      return marker;
    }
    _syncMarker(m) {
      if (m.sphere) {
        const d2 = m.radius * 2;
        m.sphere.setLocalScale(d2, d2, d2);
        m.sphere.setPosition(m.center.x, m.center.y, m.center.z);
        m.sphere.enabled = !m.removed && this.labelsVisible;
      }
      if (m.el) {
        m.el.textContent = m.removed ? `${m.label} [removed]` : m.label;
        m.el.style.background = m.removed ? "rgba(200,40,40,0.85)" : "rgba(20,110,220,0.85)";
      }
    }
    setRadius(m, radius) {
      m.radius = Math.max(0.15, Math.min(3, radius));
      this._syncMarker(m);
      if (m.removed) this._pushUniforms();
    }
    toggleRemove(m) {
      m.removed = !m.removed;
      this._syncMarker(m);
      this._installChunk();
      this._pushUniforms();
    }
    deleteMarker(m) {
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
      if (!this._chunkInstalled && this.markers.some((m) => m.removed)) {
        this._installChunk();
      }
      const camComp = this.cameraEntity.camera;
      const canvas = this.app.graphicsDevice.canvas;
      const sx = canvas.clientWidth / canvas.width;
      const sy = canvas.clientHeight / canvas.height;
      for (const m of this.markers) {
        if (!m.el) continue;
        if (!this.labelsVisible) {
          m.el.style.display = "none";
          continue;
        }
        camComp.worldToScreen(new pc.Vec3(m.center.x, m.center.y + m.radius, m.center.z), this._screenPos);
        if (this._screenPos.z < 0) {
          m.el.style.display = "none";
          continue;
        }
        m.el.style.display = "block";
        m.el.style.left = `${this._screenPos.x * sx}px`;
        m.el.style.top = `${this._screenPos.y * sy}px`;
      }
    }
  };
  function makeHud() {
    let el = document.getElementById("uni3-hud");
    if (!el) {
      el = document.createElement("div");
      el.id = "uni3-hud";
      el.style.cssText = "position:fixed;top:8px;left:8px;z-index:9999;color:#0f0;background:rgba(0,0,0,0.6);font:12px monospace;padding:6px 8px;border-radius:4px;pointer-events:none;white-space:pre;";
      document.body.appendChild(el);
    }
    return el;
  }
  var WalkScript = pc.createScript("walkCollision");
  WalkScript.prototype.initialize = function() {
    this._hud = makeHud();
    const data = window.UNI3_VOXEL;
    if (!data) {
      this._hud.textContent = "walkCollision: NO VOXEL DATA (voxel-data.js missing)";
      console.error("walkCollision: window.UNI3_VOXEL missing");
      return;
    }
    const bin = atob(data.binBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new Uint32Array(bytes.buffer);
    const meta = data.meta;
    const nodes = view.slice(0, meta.nodeCount);
    const leafData = view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount);
    const collision = new VoxelCollision(meta, nodes, leafData);
    this._collision = collision;
    const controller = new WalkController();
    controller.collision = collision;
    controller.fov = 80;
    this._controller = controller;
    const walkCamera = new Camera();
    walkCamera.position.set(
      collision.gridMinX + collision.numVoxelsX * collision.voxelResolution * 0.5,
      collision.gridMinY + collision.numVoxelsY * collision.voxelResolution * 0.5,
      collision.gridMinZ + collision.numVoxelsZ * collision.voxelResolution * 0.5
    );
    controller.onEnter(walkCamera);
    this._walkCamera = walkCamera;
    const InputFrameCls = pc.InputFrame || SimpleInputFrame;
    this._frame = new InputFrameCls({ move: [0, 0, 0], rotate: [0, 0, 0] });
    const keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      run: false
    };
    this._keys = keys;
    this._flyMode = false;
    this._pitch = 0;
    this._yaw = 0;
    const canvas = this.app.graphicsDevice.canvas;
    const self = this;
    const handleKey = (e, down) => {
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          keys.forward = down;
          break;
        case "KeyS":
        case "ArrowDown":
          keys.backward = down;
          break;
        case "KeyA":
        case "ArrowLeft":
          keys.left = down;
          break;
        case "KeyD":
        case "ArrowRight":
          keys.right = down;
          break;
        case "Space":
          keys.jump = down;
          e.preventDefault();
          break;
        case "ShiftLeft":
        case "ShiftRight":
          keys.run = down;
          break;
        case "KeyQ":
          keys.down = down;
          break;
        case "KeyE":
          keys.up = down;
          break;
        case "KeyR":
          if (down) {
            if (!self._flyMode) {
              self._controller.resetToSpawn(self._walkCamera) || self._controller.onEnter(self._walkCamera);
            }
          }
          break;
        case "KeyG":
          if (down) {
            const f = self.entity.forward;
            const ep = self.entity.getPosition();
            self._balls.throwBall(ep, { x: f.x, y: f.y, z: f.z });
          }
          break;
        case "KeyC":
          if (down) self._balls.clear();
          break;
        case "KeyX":
          if (down) {
            document.exitPointerLock();
            const name = window.prompt("Label this object:", "object " + (self._labels.markers.length + 1));
            if (name !== null) {
              const m = self._labels.placeMarker(name);
              if (!m) console.warn("label: nothing hit under crosshair");
            }
          }
          break;
        case "KeyV":
          if (down) {
            const m = self._labels.nearestMarkerToAim();
            if (m) self._labels.toggleRemove(m);
          }
          break;
        case "KeyL":
          if (down) self._labels.toggleLabels();
          break;
        case "BracketLeft":
          if (down) {
            const m = self._labels.nearestMarkerToAim() || self._labels.markers[self._labels.markers.length - 1];
            if (m) self._labels.setRadius(m, m.radius - 0.1);
          }
          break;
        case "BracketRight":
          if (down) {
            const m = self._labels.nearestMarkerToAim() || self._labels.markers[self._labels.markers.length - 1];
            if (m) self._labels.setRadius(m, m.radius + 0.1);
          }
          break;
        case "Backspace":
          if (down) {
            const m = self._labels.nearestMarkerToAim();
            if (m) self._labels.deleteMarker(m);
          }
          break;
        case "KeyY":
          if (down) {
            self._flyMode = !self._flyMode;
            if (!self._flyMode) {
              self._walkCamera.angles.set(self._pitch, self._yaw, 0);
              self._controller.goto(self._walkCamera);
            } else {
              self._pitch = self._walkCamera.angles.x;
              self._yaw = self._walkCamera.angles.y;
            }
          }
          break;
        default:
          return;
      }
    };
    this._onKeyDown = (e) => handleKey(e, true);
    this._onKeyUp = (e) => handleKey(e, false);
    this._onBlur = () => {
      keys.forward = keys.backward = keys.left = keys.right = keys.jump = keys.run = false;
    };
    this._onClick = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    };
    this._onMouseMove = (e) => {
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
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    canvas.addEventListener("click", this._onClick);
    window.addEventListener("mousemove", this._onMouseMove);
    this.on("destroy", () => {
      window.removeEventListener("keydown", this._onKeyDown);
      window.removeEventListener("keyup", this._onKeyUp);
      window.removeEventListener("blur", this._onBlur);
      canvas.removeEventListener("click", this._onClick);
      window.removeEventListener("mousemove", this._onMouseMove);
    });
    try {
      if (!this.app.root.findByName("walk-light")) {
        const light = new pc.Entity("walk-light");
        light.addComponent("light", { type: "directional", intensity: 1.4, castShadows: false });
        light.setEulerAngles(50, 30, 0);
        this.app.root.addChild(light);
        this.app.scene.ambientLight = new pc.Color(0.45, 0.45, 0.5);
      }
    } catch (e) {
    }
    this._balls = new BallPhysics(this.app, collision);
    this._labels = new LabelSystem(this.app, collision, this.entity);
    try {
      this._npcs = new NpcSystem(this.app, collision, this.entity);
    } catch (e) {
      console.error("npc system init failed", e);
      this._npcs = null;
    }
    try {
      this._props = new PropSystem(this.app, collision);
    } catch (e) {
      console.error("prop system init failed", e);
      this._props = null;
    }
    window.walk = { controller, camera: walkCamera, collision, script: this, balls: this._balls, labels: this._labels, npcs: this._npcs, props: this._props };
    this._hudT = 0;
  };
  WalkScript.prototype.update = function(dt) {
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
      p.x += (-sy * cp * mz + cy * mx) * speed * dt;
      p.y += (sp * mz + my) * speed * dt;
      p.z += (-cy * cp * mz + -sy * mx) * speed * dt;
      this.entity.setPosition(p.x, p.y, p.z);
      this.entity.setEulerAngles(this._pitch, this._yaw, 0);
      this._hudT += dt;
      if (this._hudT > 0.25 && this._hud) {
        this._hudT = 0;
        this._hud.textContent = `FLY  pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}
Y = walk mode | WASD + E/Q up/down | Shift fast`;
      }
      return;
    }
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
      this._hud.textContent = `pos ${wp.x.toFixed(2)} ${wp.y.toFixed(2)} ${wp.z.toFixed(2)}
WASD Space Shift | Y fly | R respawn | G ball | C clear balls
X label object | V remove/restore | [ ] size | L labels | Backspace delete`;
    }
  };
})();
