(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // ../../../../../../../private/tmp/claude-501/-Users-larry-hackthe6project--claude-worktrees-university-hallway-walking-collision-ef254f/63d0550f-16ce-48c9-bf7b-e60eeb946264/scratchpad/pc-shim.js
  var _pc = globalThis.pc;
  var math = _pc.math;
  var Vec3 = _pc.Vec3;
  var Quat = _pc.Quat;
  var Mat4 = _pc.Mat4;
  var Asset = _pc.Asset;
  var INDEXFORMAT_UINT32 = _pc.INDEXFORMAT_UINT32;
  var SEMANTIC_POSITION = _pc.SEMANTIC_POSITION;

  // ../../../../../gta6/src/core/math.ts
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

  // ../../../../../gta6/src/cameras/camera-utils.ts
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

  // ../../../../../gta6/src/cameras/spawn-state.ts
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

  // ../../../../../gta6/src/collision/find-spawn.ts
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

  // ../../../../../gta6/src/cameras/walk-controller.ts
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

  // ../../../../../gta6/src/cameras/camera.ts
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

  // ../../../../../gta6/src/collision/collision.ts
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

  // ../../../../../gta6/src/collision/voxel-collision.ts
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

  // ../../../../../../../private/tmp/claude-501/-Users-larry-hackthe6project--claude-worktrees-university-hallway-walking-collision-ef254f/63d0550f-16ce-48c9-bf7b-e60eeb946264/scratchpad/gta6-adapter.ts
  var pc = globalThis.pc;
  var BUILD_TAG = "v11-shadcn";
  console.log("[walk-collision] build", BUILD_TAG);
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
  var SoundKit = class {
    constructor(app) {
      __publicField(this, "app");
      __publicField(this, "muted", false);
      this.app = app;
    }
    _asset(name) {
      const a = this.app.assets.find(name);
      if (a && !a.resource && !a.loading) this.app.assets.load(a);
      return a && a.resource ? a : null;
    }
    /** play a one-shot; returns the instance or null */
    play(name, opts = {}) {
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
    playRandom(names, opts = {}) {
      return this.play(names[Math.floor(Math.random() * names.length)], opts);
    }
  };
  var BALL_RADIUS = 0.12;
  var BALL_RESTITUTION = 0.55;
  var BALL_FRICTION = 0.985;
  var BALL_GRAVITY = 9.8;
  var MAX_BALLS = 48;
  var BALL_MAX_BOUNCES = 3;
  var BALL_BOUNCE_MIN_SPEED = 1;
  var THROW_SPEED = 8;
  var BallPhysics = class {
    constructor(app, collision) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "balls", []);
      __publicField(this, "obstacles", []);
      /** target practice: balls die on first surface impact instead of bouncing */
      __publicField(this, "noBounce", false);
      __publicField(this, "_push", { x: 0, y: 0, z: 0 });
      this.app = app;
      this.collision = collision;
    }
    throwBall(origin, dir, speed = THROW_SPEED, radius = BALL_RADIUS) {
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
        e.setLocalScale(radius * 2, radius * 2, radius * 2);
        const off = radius * 1.5;
        e.setPosition(origin.x + dir.x * off, origin.y + dir.y * off, origin.z + dir.z * off);
        this.app.root.addChild(e);
      } catch (err) {
        e = null;
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
    step(dt) {
      const col = this.collision;
      const push = this._push;
      const balls = this.balls;
      for (const b of balls) {
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
            b.p.x += push.x;
            b.p.y += push.y;
            b.p.z += push.z;
            const len = Math.sqrt(push.x * push.x + push.y * push.y + push.z * push.z);
            if (len > 1e-9) {
              const nx = push.x / len, ny = push.y / len, nz = push.z / len;
              const vn = b.v.x * nx + b.v.y * ny + b.v.z * nz;
              if (vn < 0) {
                if (this.noBounce && vn < -BALL_BOUNCE_MIN_SPEED * 0.5) {
                  b.bounces = BALL_MAX_BOUNCES + 1;
                  b.v.x = 0;
                  b.v.y = 0;
                  b.v.z = 0;
                  break;
                }
                if (vn < -BALL_BOUNCE_MIN_SPEED) b.bounces++;
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
        }
        if (b.p.y < col.gridMinY - 10) {
          b.v.x = b.v.y = b.v.z = 0;
          b.p.y = col.gridMinY + col.numVoxelsY * col.voxelResolution * 0.5;
        }
      }
      for (const o of this.obstacles) {
        for (const b of balls) {
          if (b.p.y < o.minY - b.r || b.p.y > o.maxY + b.r) continue;
          const dx = b.p.x - o.x, dz = b.p.z - o.z;
          const d2 = dx * dx + dz * dz;
          const minD = o.radius + b.r;
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
          const minD = a.r + c.r;
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
      for (let i = balls.length - 1; i >= 0; i--) {
        if (balls[i].bounces > BALL_MAX_BOUNCES) {
          if (balls[i].entity) balls[i].entity.destroy();
          balls.splice(i, 1);
        }
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
  var NPC_PERSONALITIES = [
    { name: "Sgt. Havoc", aggression: 0.9, randomness: 0.2 },
    { name: "Ghost", aggression: 0.3, randomness: 0.1 },
    { name: "Captain Valor", aggression: 0.7, randomness: 0.1 },
    { name: "Chaos", aggression: 0.5, randomness: 0.8 },
    { name: "Strategist", aggression: 0.5, randomness: 0.05 },
    { name: "Grumps", aggression: 0.6, randomness: 0.2 }
  ];
  var NPC_SIGHT_RANGE = 22;
  var NPC_FIRE_RANGE = 11;
  var NPC_HEARING_RANGE = 3;
  var NPC_LKP_MEMORY_MS = 1e4;
  var NPC_SHOT_DAMAGE = 8;
  var NPC_BASE_HIT_CHANCE = 0.35;
  var NPC_MAG = 30;
  var NPC_RELOAD_TIME = 3;
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
      __publicField(this, "walkSpeedMul", 1);
      __publicField(this, "combatEnabled", false);
      /** true while a scene switch is in flight — freezes all NPC activity */
      __publicField(this, "suspended", false);
      /** per-scene pinned soldier floor band [minY, maxY]; null = player-relative */
      __publicField(this, "floorRange", null);
      /** authoritative player position (walk controller state); falls back to
       *  the camera entity, which lags one frame behind teleports */
      __publicField(this, "getPlayerPos", null);
      __publicField(this, "playerDead", false);
      __publicField(this, "onKill", null);
      __publicField(this, "onPlayerDamage", null);
      __publicField(this, "sounds", null);
      __publicField(this, "_lastSeeYou", 0);
      __publicField(this, "_desiredCount", 0);
      __publicField(this, "_push", { x: 0, y: 0, z: 0 });
      __publicField(this, "_screenPos");
      __publicField(this, "_reach", null);
      __publicField(this, "_reachFrom", { x: 1e9, z: 1e9 });
      __publicField(this, "_refillT", 0);
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
    /**
     * Measure the model by walking its node/bone hierarchy in world space.
     * Skinned-mesh AABBs are only refreshed when the model is actually
     * rendered, so off-screen soldiers report garbage bounds (which once
     * collapsed the auto-scale to zero); bone transforms always update.
     */
    _measureModel(model) {
      const collect = (rigOnly) => {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let count = 0;
        const stack = [model];
        while (stack.length) {
          const n = stack.pop();
          const ch = n.children;
          for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
          if (rigOnly && (!n.name || n.name.indexOf("mixamorig") === -1)) continue;
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
      for (let i = 0; i < 200 && clearances.length < 25; i++) {
        const x = col.gridMinX + 0.5 + Math.random() * (gMaxX - col.gridMinX - 1);
        const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
        const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
        const up = col.queryRay(x, midY, z, 0, 1, 0, 30);
        if (!down || !up) continue;
        const c = up.y - down.y;
        if (c > 0.8) clearances.push(c);
      }
      this.npcHeight = NPC_HEIGHT;
      if (clearances.length >= 5) {
        clearances.sort((a, b) => a - b);
        const median = clearances[Math.floor(clearances.length / 2)];
        this.npcHeight = Math.min(NPC_HEIGHT, Math.max(0.9, median * 0.85));
        console.log("npcSystem: corridor clearance", median.toFixed(2), "\u2192 soldier height", this.npcHeight.toFixed(2));
      } else {
        console.warn("npcSystem: too few clearance samples \u2014 using default height", NPC_HEIGHT);
      }
      this.npcRadius = this.npcHeight * 0.18;
    }
    _onAssetsReady() {
      try {
        this._measureHallway();
        this.ready = true;
        if (this._desiredCount > 0) this._fillPopulation();
        console.log("npcSystem: ready (population", this._desiredCount + ")");
      } catch (e) {
        console.error("npcSystem spawn failed", e);
        this.failed = true;
      }
    }
    _fillPopulation() {
      while (this.aliveCount() < this._desiredCount) {
        const before = this.npcs.length;
        this._spawnNpc(this.npcs.length);
        if (this.npcs.length === before) break;
      }
    }
    aliveCount() {
      let n = 0;
      for (const npc of this.npcs) {
        if (npc.state !== "dying" && npc.state !== "dead") n++;
      }
      return n;
    }
    /** set the live soldier population (waves) */
    setPopulation(count, speedMul = 1) {
      this._desiredCount = count;
      this.walkSpeedMul = speedMul;
      if (this.ready) this._fillPopulation();
    }
    /** remove every soldier immediately (restart) */
    reset() {
      for (const npc of this.npcs) {
        try {
          npc.root.destroy();
        } catch (e) {
        }
        if (npc.el) npc.el.remove();
      }
      this.npcs.length = 0;
      this._desiredCount = 0;
      this._reach = null;
      this._reachFrom = { x: 1e9, z: 1e9 };
    }
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
      const MAX_CELLS = 9e3;
      const MAX_R = 30;
      const startDown = col.queryRay(pp.x, pp.y, pp.z, 0, -1, 0, 4);
      if (!startDown) {
        this._reach = null;
        return;
      }
      const key = (x, z) => `${Math.round(x / STEP)}|${Math.round(z / STEP)}`;
      const seen = /* @__PURE__ */ new Set();
      const cells = [];
      const queue = [{ x: pp.x, z: pp.z, floor: startDown.y }];
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
          const down = col.queryRay(nx, c.floor + 1, nz, 0, -1, 0, 3);
          if (!down) continue;
          const nf = down.y;
          if (Math.abs(nf - c.floor) > 0.45) continue;
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
      const mdx = pp.x - this._reachFrom.x, mdz = pp.z - this._reachFrom.z;
      if (!this._reach || mdx * mdx + mdz * mdz > 9) this._computeReachable();
      if (!this._reach || this._reach.length < 10) return null;
      for (let attempt = 0; attempt < 60; attempt++) {
        const c = this._reach[Math.random() * this._reach.length | 0];
        const x = c.x + (Math.random() - 0.5) * 0.3;
        const z = c.z + (Math.random() - 0.5) * 0.3;
        const ddx = x - pp.x, ddz = z - pp.z;
        const dd = Math.sqrt(ddx * ddx + ddz * ddz);
        if (dd < 4 || dd > 28) continue;
        const floor = c.floor;
        if (this.floorRange && (floor < this.floorRange[0] - 0.05 || floor > this.floorRange[1] + 0.05)) continue;
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
      for (const r of model.findComponents("render")) {
        for (const mi of r.meshInstances) mi.cull = false;
      }
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
      el.className = "sg sg-mono";
      el.style.cssText = "position:fixed;transform:translate(-50%,-100%);z-index:9997;font-family:var(--font);font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;background:rgba(9,9,11,0.9);pointer-events:none;white-space:nowrap;color:#f87171;border:1px solid rgba(239,68,68,0.4);letter-spacing:1px;";
      document.body.appendChild(el);
      const pers = NPC_PERSONALITIES[Math.floor(Math.random() * NPC_PERSONALITIES.length)];
      const npc = {
        root,
        model,
        p: { x: spot.x, y: spot.y, z: spot.z },
        target: null,
        state: "idle",
        // idle | walk | attack | dying | dead
        stateTime: 1 + Math.random() * 3,
        hp: NPC_HP,
        hitCooldown: 0,
        yaw: Math.random() * 360,
        fit: { phase: "orient", wait: 3, idx: 0, results: [] },
        pers,
        canSee: false,
        percT: Math.random() * 0.2,
        lkp: null,
        lkpTime: 0,
        shootT: 1 + Math.random(),
        bullets: NPC_MAG,
        reloadT: 0,
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
        npc.el.textContent = "\u2620";
        npc.el.style.background = "rgba(120,20,20,0.8)";
      } else {
        npc.el.textContent = "\u2665".repeat(Math.max(0, npc.hp));
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
    /**
     * Apply one point of damage. (nx, nz) points from the npc toward the
     * damage source; used to pick the death animation direction.
     */
    applyHit(npc, nx, nz) {
      if (npc.state === "dying" || npc.state === "dead" || npc.hitCooldown > 0) return;
      npc.hp--;
      npc.hitCooldown = NPC_HIT_COOLDOWN;
      if (npc.hp <= 0) {
        npc.state = "dying";
        npc.stateTime = NPC_CORPSE_TIME;
        const camFwd = { x: -nx, z: -nz };
        const facing = { x: -Math.sin(npc.yaw * Math.PI / 180), z: -Math.cos(npc.yaw * Math.PI / 180) };
        const frontal = camFwd.x * facing.x + camFwd.z * facing.z < 0;
        this._setAnim(npc, frontal ? "DeathB" : "DeathF");
        if (npc.muzzleLight) npc.muzzleLight.intensity = 0;
        if (this.onKill) this.onKill(npc);
      }
      this._syncTag(npc);
    }
    /** pure raycast line of sight from npc chest to the player eye */
    _clearShot(npc) {
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
    _hasLineOfSight(npc) {
      if (this._clearShot(npc)) return true;
      const pp = this._playerPos();
      const dx = pp.x - npc.p.x, dy = pp.y - (npc.p.y + this.npcHeight * 0.75), dz = pp.z - npc.p.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < NPC_HEARING_RANGE;
    }
    /** nearest live npc intersected by the ray (vertical-capsule approximation) */
    raycastNpcs(ox, oy, oz, dx, dy, dz, maxDist) {
      let best = null;
      let bestT = maxDist;
      for (const npc of this.npcs) {
        if (npc.state === "dying" || npc.state === "dead") continue;
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
        const withinY = Math.abs(dy) < this.npcHeight * 0.5 + ball.r;
        if (xz < this.npcRadius + ball.r && withinY) {
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
        let scale = cur * (this.npcHeight * 0.93 / m.ext.y);
        if (!isFinite(scale) || scale < 5e-4 || scale > 1) {
          console.warn("npcSystem: implausible scale", scale, "span", m.ext.y.toFixed(2), "\u2014 using fallback");
          scale = this.npcHeight / 180;
        }
        npc.model.setLocalScale(scale, scale, scale);
        console.log("npcSystem: bone span", m.ext.y.toFixed(2), "\u2192 scale", scale.toFixed(4));
        fit.phase = "ground";
        fit.wait = 2;
      } else if (fit.phase === "ground") {
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
        for (const r of gun.findComponents("render")) {
          for (const mi of r.meshInstances) mi.cull = false;
        }
        hand.addChild(gun);
        gun.setLocalPosition(GUN_LOCAL_POS[0], GUN_LOCAL_POS[1], GUN_LOCAL_POS[2]);
        gun.setLocalEulerAngles(GUN_LOCAL_EULER[0], GUN_LOCAL_EULER[1], GUN_LOCAL_EULER[2]);
        gun.setLocalScale(GUN_LOCAL_SCALE, GUN_LOCAL_SCALE, GUN_LOCAL_SCALE);
        npc.gun = gun;
        npc.flash = null;
        npc.flashOn = 0;
        try {
          const lightEnt = new pc.Entity("muzzle-light");
          gun.addChild(lightEnt);
          lightEnt.setLocalPosition(FLASH_LOCAL_POS[0], FLASH_LOCAL_POS[1], FLASH_LOCAL_POS[2]);
          lightEnt.addComponent("light", {
            type: "omni",
            color: new pc.Color(1, 0.85, 0.4),
            intensity: 0,
            range: 4,
            castShadows: false
          });
          npc.muzzleLight = lightEnt.light;
        } catch (e) {
        }
        console.log("npcSystem: m16 attached to", npc.root.name, "scale", GUN_LOCAL_SCALE);
      } catch (e) {
        console.warn("npcSystem: weapon attach failed", e);
      }
    }
    step(dt, balls) {
      if (!this.ready || this.suspended) return;
      const col = this.collision;
      this._refillT -= dt;
      if (this._refillT <= 0) {
        this._refillT = 2;
        if (this.aliveCount() < this._desiredCount) this._fillPopulation();
      }
      for (const b of balls) this.hitTest(b, dt);
      for (const npc of this.npcs) {
        if (npc.fit && npc.state !== "dead") this._fitStep(npc);
        if (npc.hitCooldown > 0) npc.hitCooldown -= dt;
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
        if (this.combatEnabled && !this.playerDead && npc.state !== "dying" && npc.state !== "dead") {
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
            if (npc.state !== "attack") {
              npc.state = "attack";
              npc.target = null;
              this._setAnim(npc, "Idle");
              const nowSy = performance.now();
              if (this.sounds && nowSy - this._lastSeeYou > 1500) {
                this._lastSeeYou = nowSy;
                this.sounds.playRandom(["seeyou1.mp3", "seeyou2.mp3", "seeyou3.mp3"], { volume: 0.8, pitch: 0.95 + Math.random() * 0.1 });
              }
            }
          } else if (npc.state === "attack") {
            const stale = performance.now() - npc.lkpTime > NPC_LKP_MEMORY_MS;
            if (!stale && npc.lkp && npc.pers.aggression > 0.4) {
              const floor = this.collision.queryRay(npc.lkp.x, npc.lkp.y, npc.lkp.z, 0, -1, 0, 5);
              npc.target = { x: npc.lkp.x, y: floor ? floor.y : npc.p.y, z: npc.lkp.z };
              npc.state = "walk";
              this._setAnim(npc, "Walk");
            } else {
              npc.state = "idle";
              npc.stateTime = 1;
              this._setAnim(npc, "Idle");
            }
          }
        } else if (npc.state === "attack") {
          npc.state = "idle";
          npc.stateTime = 2;
          this._setAnim(npc, "Idle");
        }
        if (npc.state === "dying") {
          npc.stateTime -= dt;
          if (npc.stateTime <= 0) {
            npc.state = "dead";
            npc.root.destroy();
            if (npc.el) npc.el.remove();
          }
          continue;
        }
        if (npc.state === "dead") continue;
        if (npc.state === "attack") {
          const pp = this._playerPos();
          const dx = pp.x - npc.p.x, dz = pp.z - npc.p.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const targetYaw = Math.atan2(-dx / (dist || 1), -dz / (dist || 1)) * 180 / Math.PI;
          let dyaw = targetYaw - npc.yaw;
          while (dyaw > 180) dyaw -= 360;
          while (dyaw < -180) dyaw += 360;
          npc.yaw += Math.max(-360 * dt, Math.min(360 * dt, dyaw));
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
            this._setAnim(npc, "Walk");
          } else {
            this._setAnim(npc, "Idle");
          }
          npc.shootT -= dt;
          if (npc.shootT <= 0 && Math.abs(dyaw) < 15 && npc.reloadT <= 0 && dist <= NPC_FIRE_RANGE && npc.clearShot) {
            npc.shootT = 0.45 + Math.random() * 0.4 * (1 + npc.pers.randomness);
            npc.bullets--;
            if (npc.bullets <= 0) npc.reloadT = NPC_RELOAD_TIME;
            npc.flashOn = 0.05;
            if (npc.muzzleLight) npc.muzzleLight.intensity = 3;
            if (this.sounds) {
              this.sounds.play("shoot.mp3", {
                volume: 0.5 * Math.max(0.15, 1 - dist / 25),
                pitch: 0.9 + Math.random() * 0.2
              });
            }
            const chance = NPC_BASE_HIT_CHANCE * Math.max(0.25, 1 - dist / (NPC_SIGHT_RANGE * 1.4));
            if (Math.random() < chance && this.onPlayerDamage) {
              this.onPlayerDamage(NPC_SHOT_DAMAGE - 2 + Math.random() * 4, npc);
            }
          }
        } else if (npc.state === "idle") {
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
            npc.p.x += nx * NPC_WALK_SPEED * this.walkSpeedMul * dt;
            npc.p.z += nz * NPC_WALK_SPEED * this.walkSpeedMul * dt;
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
  var VM_ASSET = [298983917, "fps-carbine.glb"];
  var VM_POS = [0.239, -0.563, -0.201];
  var VM_ROT = [90, 2.89, 180];
  var VM_SCALE = 0.02077540010213852;
  var VM_FLASH_POS = [-1.9255, -69.4615, 15.0755];
  var VM_FLASH_ROT = [90, 0, -87.11];
  var VM_FLASH_SCALE = 100;
  var VM_CLIPS = {
    shoot: { start: 0, end: 0.25, loop: false, speed: 2 },
    reload: { start: 0.25, end: 2.25, loop: false, speed: 1 },
    idle: { start: 6, end: 6.8, loop: true, speed: 0.2 }
  };
  var VM_FIRE_INTERVAL = 0.16;
  var VM_BALL_SPEED = 16;
  var VM_BALL_RADIUS = 0.055;
  var VM_MAG_SIZE = 30;
  var VM_RANGE = 60;
  var ViewmodelSystem = class {
    constructor(app, collision, cameraEntity, npcs, balls) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "cameraEntity");
      __publicField(this, "npcs");
      __publicField(this, "entity", null);
      __publicField(this, "anim", null);
      __publicField(this, "flash", null);
      __publicField(this, "ready", false);
      __publicField(this, "shooting", false);
      __publicField(this, "reloading", false);
      __publicField(this, "ammo", VM_MAG_SIZE);
      __publicField(this, "_current", null);
      __publicField(this, "_currentName", "");
      __publicField(this, "_cooldown", 0);
      __publicField(this, "_flashOn", 0);
      __publicField(this, "_ammoDiv", null);
      __publicField(this, "balls", null);
      __publicField(this, "sounds", null);
      __publicField(this, "onShoot", null);
      __publicField(this, "_dryT", 0);
      this.app = app;
      this.collision = collision;
      this.cameraEntity = cameraEntity;
      this.npcs = npcs;
      this.balls = balls;
      this._load();
      this._makeUi();
    }
    _url(id, fname) {
      let q = "";
      try {
        const cfg = window.config;
        const bid = cfg && (cfg.self?.branch?.id || cfg.self?.branchId) || "87d9f884-5657-4343-887e-e823e912488f";
        q = `?branchId=${bid}`;
      } catch (e) {
      }
      return `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
    }
    _load() {
      const [id, fname] = VM_ASSET;
      const asset = new pc.Asset(fname, "container", { url: this._url(id, fname), filename: fname });
      asset.on("load", () => this._build(asset));
      asset.on("error", (err) => console.error("viewmodel asset failed:", err));
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    }
    _build(asset) {
      try {
        const vm = asset.resource.instantiateRenderEntity();
        this.cameraEntity.addChild(vm);
        vm.setLocalPosition(VM_POS[0], VM_POS[1], VM_POS[2]);
        vm.setLocalEulerAngles(VM_ROT[0], VM_ROT[1], VM_ROT[2]);
        vm.setLocalScale(VM_SCALE, VM_SCALE, VM_SCALE);
        this.entity = vm;
        vm.addComponent("anim", { activate: true });
        const anims = asset.resource.animations;
        if (anims && anims.length) {
          vm.anim.assignAnimation("All", anims[0].resource);
        }
        this.anim = vm.anim;
        this.ready = true;
        this.play("idle");
        console.log("viewmodel: carbine attached");
        this._loadFlash(vm);
      } catch (e) {
        console.error("viewmodel build failed", e);
      }
    }
    /** loads its own muzzle-flash container (name-sharing with the npc asset
     *  can resolve to the editor's raw copy, which is not a container) */
    _loadFlash(vm) {
      try {
        const [id, fname] = NPC_ASSET_IDS.flash;
        const asset = new pc.Asset("vm-muzzle-flash", "container", { url: this._url(id, fname), filename: fname });
        asset.on("load", () => {
          try {
            if (!asset.resource || typeof asset.resource.instantiateRenderEntity !== "function") {
              console.warn("viewmodel: flash resource is not a container, skipping");
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
            console.warn("viewmodel: flash attach failed", e);
          }
        });
        asset.on("error", (err) => console.warn("viewmodel: flash load failed", err));
        this.app.assets.add(asset);
        this.app.assets.load(asset);
      } catch (e) {
        console.warn("viewmodel: flash setup failed", e);
      }
    }
    _makeUi() {
      this._ammoDiv = document.createElement("div");
      this._ammoDiv.className = "sg sg-panel";
      this._ammoDiv.style.cssText = "position:fixed;bottom:20px;right:16px;z-index:9999;padding:10px 14px;pointer-events:none;";
      document.body.appendChild(this._ammoDiv);
      this._updateAmmo();
      const ret = document.createElement("div");
      ret.className = "fs-reticle";
      document.body.appendChild(ret);
    }
    _updateAmmo() {
      if (!this._ammoDiv) return;
      const pct = Math.max(0, Math.min(100, this.ammo / VM_MAG_SIZE * 100));
      const label = this.reloading ? '<span style="color:var(--muted-fg)">Reloading\u2026</span>' : `<b style="color:var(--foreground);font-size:16px;font-weight:600">${this.ammo}</b><span style="color:var(--muted-fg)"> / ${VM_MAG_SIZE}</span>`;
      this._ammoDiv.innerHTML = `<div style="font-size:11px;font-weight:500;color:var(--muted-fg);display:flex;justify-content:space-between;align-items:baseline;gap:18px;margin-bottom:6px"><span>Ammo</span><span class="sg-mono">${label}</span></div><div class="sg-progress" style="width:132px"><div style="width:${pct}%;${this.reloading ? "opacity:0.25" : ""}"></div></div>`;
    }
    play(name) {
      const c = VM_CLIPS[name];
      if (!c || !this.anim || !this.anim.baseLayer) return;
      this._current = c;
      this._currentName = name;
      this.anim.baseLayer.activeStateCurrentTime = c.start;
      this.anim.speed = c.speed;
      this.anim.baseLayer.playing = true;
    }
    setShooting(on) {
      this.shooting = on;
    }
    reload() {
      if (!this.ready || this.reloading || this.ammo === VM_MAG_SIZE) return;
      this.reloading = true;
      this.play("reload");
      if (this.sounds) this.sounds.playRandom(["carbineReloadA.wav", "carbineReloadB.wav"], { volume: 0.7 });
      this._updateAmmo();
    }
    _fire() {
      this.ammo--;
      this._cooldown = VM_FIRE_INTERVAL;
      this.play("shoot");
      if (this.sounds) this.sounds.play("shoot3.wav", { volume: 0.55, pitch: 0.92 + Math.random() * 0.16 });
      if (this.balls) {
        const f = this.cameraEntity.forward;
        let ox, oy, oz;
        if (this.flash) {
          const mp = this.flash.getPosition();
          ox = mp.x;
          oy = mp.y;
          oz = mp.z;
        } else {
          const p = this.cameraEntity.getPosition();
          const r = this.cameraEntity.right;
          const u = this.cameraEntity.up;
          ox = p.x + r.x * 0.22 - u.x * 0.18 + f.x * 0.3;
          oy = p.y + r.y * 0.22 - u.y * 0.18 + f.y * 0.3;
          oz = p.z + r.z * 0.22 - u.z * 0.18 + f.z * 0.3;
        }
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
              ox = cp.x + sx * t;
              oy = cp.y + sy * t;
              oz = cp.z + sz * t;
            }
          }
        }
        let tx = cp.x + f.x * VM_RANGE, ty = cp.y + f.y * VM_RANGE, tz = cp.z + f.z * VM_RANGE;
        const aimHit = this.collision.queryRay(cp.x, cp.y, cp.z, f.x, f.y, f.z, VM_RANGE);
        if (aimHit) {
          const ax = aimHit.x - cp.x, ay = aimHit.y - cp.y, az = aimHit.z - cp.z;
          if (ax * ax + ay * ay + az * az > 1) {
            tx = aimHit.x;
            ty = aimHit.y;
            tz = aimHit.z;
          }
        }
        let dx = tx - ox, dy = ty - oy, dz = tz - oz;
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dl > 1e-6) {
          dx /= dl;
          dy /= dl;
          dz /= dl;
        } else {
          dx = f.x;
          dy = f.y;
          dz = f.z;
        }
        this.balls.throwBall({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }, VM_BALL_SPEED, VM_BALL_RADIUS);
        if (this.onShoot) this.onShoot(ox, oy, oz, dx, dy, dz);
      }
      this._updateAmmo();
      if (this.ammo <= 0) this.reload();
    }
    step(dt) {
      if (!this.ready) return;
      if (this._cooldown > 0) this._cooldown -= dt;
      const layer = this.anim && this.anim.baseLayer;
      if (layer && this._current) {
        const t = layer.activeStateCurrentTime;
        const c = this._current;
        if (t >= c.end) {
          if (c.loop) {
            layer.activeStateCurrentTime = c.start;
          } else if (this._currentName === "reload") {
            this.reloading = false;
            this.ammo = VM_MAG_SIZE;
            this._updateAmmo();
            this.play("idle");
          } else {
            this.play("idle");
          }
        }
      }
      if (this.shooting && !this.reloading && this._cooldown <= 0 && this.ammo > 0) {
        this._fire();
      } else if (this.shooting && this.reloading) {
        this._dryT -= dt;
        if (this._dryT <= 0 && this.sounds) {
          this._dryT = 0.4;
          this.sounds.play("dryfire.wav", { volume: 0.45 });
        }
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
      el.className = "sg sg-mono";
      el.style.cssText = "position:fixed;transform:translate(-50%,-140%);z-index:9998;font-family:var(--font);font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;background:rgba(9,9,11,0.9);pointer-events:none;white-space:nowrap;color:var(--foreground);border:1px solid var(--border);";
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
  var TARGET_ASSET = [298986925, "target-archery.glb"];
  var TARGET_COUNT = 6;
  var TARGET_HEIGHT_MIN = 0.3;
  var TARGET_HEIGHT_MAX = 0.6;
  var TARGET_FLOOR_CHANCE = 0.35;
  var TARGET_YAW = 0;
  var TargetSystem = class {
    constructor(app, collision, sounds) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "sounds");
      __publicField(this, "onHit", null);
      __publicField(this, "active", false);
      __publicField(this, "ready", false);
      __publicField(this, "yaw", TARGET_YAW);
      __publicField(this, "targets", []);
      __publicField(this, "_asset", null);
      __publicField(this, "_stats", null);
      this.app = app;
      this.collision = collision;
      this.sounds = sounds;
      this._load();
    }
    _url(id, fname) {
      let q = "";
      try {
        const cfg = window.config;
        const bid = cfg && (cfg.self?.branch?.id || cfg.self?.branchId) || "87d9f884-5657-4343-887e-e823e912488f";
        q = `?branchId=${bid}`;
      } catch (e) {
      }
      return `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
    }
    _load() {
      const [id, fname] = TARGET_ASSET;
      const asset = new pc.Asset(fname, "container", { url: this._url(id, fname), filename: fname });
      asset.on("load", () => {
        this._asset = asset;
        this.ready = true;
        if (this.active) this._spawnAll();
      });
      asset.on("error", (err) => console.error("target asset failed:", err));
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
      const cs = [];
      const floors = [];
      for (let i = 0; i < 200 && cs.length < 30; i++) {
        const x = col.gridMinX + 0.5 + Math.random() * (gMaxX - col.gridMinX - 1);
        const z = col.gridMinZ + 1 + Math.random() * (gMaxZ - col.gridMinZ - 2);
        const down = col.queryRay(x, midY, z, 0, -1, 0, 30);
        const up = col.queryRay(x, midY, z, 0, 1, 0, 30);
        if (!down || !up) continue;
        const c = up.y - down.y;
        if (c > 0.8) {
          cs.push(c);
          floors.push(down.y);
        }
      }
      cs.sort((a, b) => a - b);
      floors.sort((a, b) => a - b);
      this._stats = cs.length >= 5 ? { clearance: cs[Math.floor(cs.length / 2)], floor: floors[Math.floor(floors.length / 2)] } : { clearance: 2.4, floor: col.gridMinY };
      return this._stats;
    }
    _validSpot(x, z, height) {
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
    _randomSpot(height, avoid) {
      const col = this.collision;
      const res = col.voxelResolution;
      const gMaxX = col.gridMinX + col.numVoxelsX * res;
      const gMaxZ = col.gridMinZ + col.numVoxelsZ * res;
      for (let i = 0; i < 120; i++) {
        const x = col.gridMinX + 0.4 + Math.random() * (gMaxX - col.gridMinX - 0.8);
        const z = col.gridMinZ + 1.5 + Math.random() * (gMaxZ - col.gridMinZ - 3);
        const s = this._validSpot(x, z, height);
        if (!s) continue;
        let tooClose = false;
        for (const t of avoid) {
          const dx = t.p.x - s.x, dz = t.p.z - s.z;
          if (dx * dx + dz * dz < 2.25) {
            tooClose = true;
            break;
          }
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
        try {
          t.root.destroy();
        } catch (e) {
        }
      }
      this.targets.length = 0;
    }
    _spawnAll() {
      while (this.targets.length < TARGET_COUNT) {
        if (!this._spawnOne()) break;
      }
      console.log("targetSystem:", this.targets.length, "targets up");
    }
    _spawnOne() {
      const stats = this._corridorStats();
      const height = Math.min(
        stats.clearance * 0.45,
        TARGET_HEIGHT_MIN + Math.random() * (TARGET_HEIGHT_MAX - TARGET_HEIGHT_MIN)
      );
      const spot = this._randomSpot(height, this.targets);
      if (!spot || !this._asset) return false;
      const headroom = (spot.ceil ?? spot.y + stats.clearance) - spot.y - height - 0.25;
      const hover = Math.random() < TARGET_FLOOR_CHANCE || headroom <= 0 ? 0 : Math.random() * Math.max(0, headroom);
      const baseY = spot.y + hover;
      const root = new pc.Entity("target");
      const model = this._asset.resource.instantiateRenderEntity();
      root.addChild(model);
      this.app.root.addChild(root);
      root.setPosition(spot.x, baseY, spot.z);
      root.setEulerAngles(0, this.yaw, 0);
      this.targets.push({
        root,
        model,
        p: { x: spot.x, y: baseY, z: spot.z },
        height,
        hitR: height * 0.55,
        fit: { phase: "scale", wait: 3 }
      });
      return true;
    }
    setYaw(deg) {
      this.yaw = deg;
      for (const t of this.targets) t.root.setEulerAngles(0, deg, 0);
    }
    _measure(model) {
      let min = null, max = null;
      for (const r of model.findComponents("render")) {
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
    step(dt, balls) {
      if (!this.active) return;
      for (const t of this.targets) {
        if (!t.fit) continue;
        const fit = t.fit;
        if (fit.wait > 0) {
          fit.wait--;
          continue;
        }
        const m = this._measure(t.model);
        if (!m || !isFinite(m.ext.y) || m.ext.y <= 5e-3) {
          fit.wait = 3;
          continue;
        }
        if (fit.phase === "scale") {
          const cur = t.model.getLocalScale().x;
          const s = cur * (t.height / m.ext.y);
          t.model.setLocalScale(s, s, s);
          fit.phase = "ground";
          fit.wait = 2;
        } else if (fit.phase === "ground") {
          const ws = new pc.Vec3(t.p.x - m.center.x, t.p.y - m.minY, t.p.z - m.center.z);
          const inv = t.root.getRotation().clone().invert();
          const ls = inv.transformVector(ws, new pc.Vec3());
          const lp = t.model.getLocalPosition();
          t.model.setLocalPosition(lp.x + ls.x, lp.y + ls.y, lp.z + ls.z);
          t.fit = null;
        }
      }
      for (let i = this.targets.length - 1; i >= 0; i--) {
        const t = this.targets[i];
        if (t.fit) continue;
        const cy = t.p.y + t.height * 0.6;
        for (const b of balls) {
          const sp = b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z;
          if (sp < 4) continue;
          const dx = b.p.x - t.p.x, dy = b.p.y - cy, dz = b.p.z - t.p.z;
          if (dx * dx + dy * dy + dz * dz < (t.hitR + b.r) * (t.hitR + b.r)) {
            if (this.sounds) this.sounds.play("shoot-end.wav", { volume: 0.7, pitch: 1.1 + Math.random() * 0.2 });
            if (this.onHit) this.onHit(t);
            try {
              t.root.destroy();
            } catch (e) {
            }
            this.targets.splice(i, 1);
            this._spawnOne();
            break;
          }
        }
      }
    }
  };
  var VOXVIEW_RADIUS = 9;
  var VOXVIEW_REBUILD_DIST = 2.5;
  var VOXVIEW_MAX_FACES = 15e4;
  var VoxelDebugView = class {
    constructor(app, collision) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "enabled", false);
      __publicField(this, "entity", null);
      __publicField(this, "_lastPos", { x: 1e9, y: 1e9, z: 1e9 });
      __publicField(this, "_gridTex", null);
      this.app = app;
      this.collision = collision;
    }
    /** 64x64 canvas texture: translucent white fill, dark cell border */
    _gridTexture() {
      if (this._gridTex) return this._gridTex;
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const g = c.getContext("2d");
      g.clearRect(0, 0, 64, 64);
      g.fillStyle = "rgba(255,255,255,0.30)";
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = "rgba(25,25,30,0.9)";
      g.lineWidth = 5;
      g.strokeRect(0, 0, 64, 64);
      const tex = new pc.Texture(this.app.graphicsDevice, {
        width: 64,
        height: 64,
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
      else this._lastPos.x = 1e9;
      return this.enabled;
    }
    _clear() {
      if (this.entity) {
        this.entity.destroy();
        this.entity = null;
      }
    }
    update(entity) {
      if (!this.enabled) return;
      const camPos = entity.getPosition();
      const dx = camPos.x - this._lastPos.x;
      const dy = camPos.y - this._lastPos.y;
      const dz = camPos.z - this._lastPos.z;
      if (dx * dx + dy * dy + dz * dz < VOXVIEW_REBUILD_DIST * VOXVIEW_REBUILD_DIST) return;
      this._lastPos = { x: camPos.x, y: camPos.y, z: camPos.z };
      this._rebuild(camPos);
    }
    _rebuild(camPos) {
      const col = this.collision;
      const res = col.voxelResolution;
      const ix0 = Math.max(0, Math.floor((camPos.x - VOXVIEW_RADIUS - col.gridMinX) / res));
      const iy0 = Math.max(0, Math.floor((camPos.y - VOXVIEW_RADIUS - col.gridMinY) / res));
      const iz0 = Math.max(0, Math.floor((camPos.z - VOXVIEW_RADIUS - col.gridMinZ) / res));
      const ix1 = Math.min(col.numVoxelsX - 1, Math.floor((camPos.x + VOXVIEW_RADIUS - col.gridMinX) / res));
      const iy1 = Math.min(col.numVoxelsY - 1, Math.floor((camPos.y + VOXVIEW_RADIUS - col.gridMinY) / res));
      const iz1 = Math.min(col.numVoxelsZ - 1, Math.floor((camPos.z + VOXVIEW_RADIUS - col.gridMinZ) / res));
      const FACES = [
        [1, 0, 0, [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
        [-1, 0, 0, [0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
        [0, 1, 0, [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
        [0, -1, 0, [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
        [0, 0, 1, [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
        [0, 0, -1, [0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]
      ];
      const positions = [];
      const uvs = [];
      const normals = [];
      const indices = [];
      const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
      let faces = 0;
      outer:
        for (let iz = iz0; iz <= iz1; iz++) {
          for (let iy = iy0; iy <= iy1; iy++) {
            for (let ix = ix0; ix <= ix1; ix++) {
              if (!col.isVoxelSolid(ix, iy, iz)) continue;
              for (const f of FACES) {
                if (col.isVoxelSolid(ix + f[0], iy + f[1], iz + f[2])) continue;
                const base = positions.length / 3;
                for (let c = 3; c < 7; c++) {
                  const o = f[c];
                  positions.push(
                    col.gridMinX + (ix + o[0]) * res,
                    col.gridMinY + (iy + o[1]) * res,
                    col.gridMinZ + (iz + o[2]) * res
                  );
                  uvs.push(CORNER_UV[c - 3][0], CORNER_UV[c - 3][1]);
                  normals.push(f[0], f[1], f[2]);
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
        const mat = new pc.StandardMaterial();
        mat.diffuse.set(0, 0, 0);
        mat.emissive.set(1, 1, 1);
        mat.emissiveMap = this._gridTexture();
        mat.opacityMap = this._gridTexture();
        mat.opacityMapChannel = "a";
        mat.blendType = pc.BLEND_NORMAL;
        mat.depthWrite = false;
        mat.cull = pc.CULLFACE_NONE;
        mat.update();
        const mi = new pc.MeshInstance(mesh, mat);
        const e = new pc.Entity("voxel-debug");
        e.addComponent("render", { meshInstances: [mi] });
        this.app.root.addChild(e);
        this.entity = e;
        console.log("voxelView:", faces, "faces");
      } catch (e) {
        console.warn("voxelView rebuild failed", e);
      }
    }
  };
  var SCENES = [
    {
      name: "Bahen 5F",
      gsplatId: 298979100,
      voxel: "embedded",
      spawn: { x: -0.22, y: 0.75, z: 0.05 },
      rot: [0, 0, 180],
      faceTarget: { x: -0.1, z: -10 }
      // spawn/respawn looking down the hallway
    },
    {
      name: "Myhal",
      gsplatId: 298987089,
      voxelJson: [298987090, "myhal.voxel.json"],
      voxelBin: [298987091, "myhal.voxel.bin"],
      spawn: null,
      // grid center
      rot: [0, 0, 180]
    },
    {
      name: "Bahen Front",
      gsplatId: 298987672,
      voxelJson: [298987673, "bahen-front.voxel.json"],
      voxelBin: [298987674, "bahen-front.voxel.bin"],
      spawn: null,
      // grid center
      rot: [0, 0, 180],
      noSoldiers: true,
      faceTarget: { x: 2.64, z: 7.08 },
      // spawn facing the door portal
      portals: [
        { x: 2.64, y: 1.65, z: 7.08, radius: 1.4, to: 4, label: "\u2192 Bahen Hallway" }
      ]
    },
    {
      name: "Bahen Classroom",
      gsplatId: 298987763,
      voxelJson: [298987764, "classroom.voxel.json"],
      voxelBin: [298987765, "classroom.voxel.bin"],
      spawn: { x: -1.54, y: 0.3, z: -6.26 },
      rot: [0, 0, 180],
      faceTarget: { x: 0.8, z: 1.5 },
      // spawn facing into the room (the tables)
      portals: [
        { x: -1.54, y: 0.3, z: -6.26, radius: 1.4, to: 4, spawnAt: { x: 9.46, y: 0.42, z: 7.25 }, label: "\u2192 Bahen Hallway" }
      ]
    },
    {
      name: "Bahen Hallway",
      gsplatId: 298988208,
      voxelJson: [298988209, "bahen-hallway.voxel.json"],
      voxelBin: [298988210, "bahen-hallway.voxel.bin"],
      spawn: { x: -1.26, y: 0.36, z: -2.72 },
      rot: [0, 0, 180],
      faceTarget: { x: 9.46, z: 7.25 },
      // spawn/respawn facing the classroom door
      portals: [
        { x: 9.46, y: 0.42, z: 7.25, radius: 1.4, to: 3, label: "\u2192 Classroom" }
      ]
    }
  ];
  var SceneManager = class {
    constructor(app, collision, controller, walkCamera, script) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "controller");
      __publicField(this, "walkCamera");
      __publicField(this, "script");
      __publicField(this, "current", 0);
      __publicField(this, "_busy", false);
      __publicField(this, "_queued", null);
      __publicField(this, "_select", null);
      __publicField(this, "_portals", []);
      __publicField(this, "_screenPos", null);
      __publicField(this, "_cards", []);
      __publicField(this, "_thumbs", {});
      __publicField(this, "_sidebar", null);
      __publicField(this, "_cardsWrap", null);
      this.app = app;
      this.collision = collision;
      this.controller = controller;
      this.walkCamera = walkCamera;
      this.script = script;
      this._makeDropdown();
    }
    _makeDropdown() {
      injectUiCss();
      const sb = document.createElement("div");
      sb.id = "sg-sidebar";
      sb.className = "sg sg-panel hidden";
      sb.innerHTML = "<h3>Locations <span>M to close</span></h3>";
      const wrap = document.createElement("div");
      wrap.id = "sg-cards";
      sb.appendChild(wrap);
      const dz = document.createElement("div");
      dz.id = "sg-dropzone";
      dz.innerHTML = '<span style="color:var(--foreground);font-weight:500">Drop a scan .zip</span><br><span style="font-size:10px">.sog + voxel data becomes a new location</span>';
      dz.addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".zip";
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          const drops = this.script._drops;
          if (f && drops) drops._import(f);
        };
        inp.click();
      });
      dz.addEventListener("dragover", (e) => {
        e.preventDefault();
        dz.classList.add("over");
      });
      dz.addEventListener("dragleave", () => dz.classList.remove("over"));
      dz.addEventListener("drop", (e) => {
        e.preventDefault();
        dz.classList.remove("over");
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        const drops = this.script._drops;
        if (f && drops) drops._import(f);
      });
      sb.appendChild(dz);
      const req = this.script._requisition;
      if (req) req.makeCard(sb);
      document.body.appendChild(sb);
      this._sidebar = sb;
      this._cardsWrap = wrap;
      SCENES.forEach((_, i) => this.addCard(i));
      this._setActive(this.current);
    }
    addCard(i) {
      const s = SCENES[i];
      const card = document.createElement("div");
      card.className = "sg-card";
      let thumb = this._thumbs[s.name];
      try {
        thumb = thumb || localStorage.getItem("sg-thumb-" + s.name);
      } catch (e) {
      }
      if (thumb) {
        this._thumbs[s.name] = thumb;
        card.innerHTML = `<img class="sg-thumb" src="${thumb}">`;
      } else {
        const initials = s.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3);
        card.innerHTML = `<div class="sg-thumb-ph">${initials}</div>`;
      }
      const chip = s.gsplatAsset ? '<span class="sg-chip drop">Imported</span>' : s.noSoldiers ? '<span class="sg-chip safe">Safe</span>' : '<span class="sg-chip combat">Combat</span>';
      const row = document.createElement("div");
      row.className = "sg-card-row";
      row.innerHTML = `<span><span style="color:var(--muted-fg)" class="sg-mono">${String(i + 1).padStart(2, "0")}&nbsp;&nbsp;</span>${s.name}</span>${chip}`;
      card.appendChild(row);
      card.addEventListener("click", () => {
        this.toggleSidebar(false);
        this.switchTo(i);
      });
      this._cardsWrap.appendChild(card);
      this._cards[i] = card;
    }
    _setActive(i) {
      this._cards.forEach((c, idx) => {
        if (c) c.classList.toggle("active", idx === i);
      });
    }
    toggleSidebar(force) {
      if (!this._sidebar) return;
      const show = force !== void 0 ? force : this._sidebar.classList.contains("hidden");
      this._sidebar.classList.toggle("hidden", !show);
      if (show) {
        try {
          document.exitPointerLock();
        } catch (e) {
        }
      }
    }
    _setThumb(name, url) {
      this._thumbs[name] = url;
      try {
        localStorage.setItem("sg-thumb-" + name, url);
      } catch (e) {
      }
      const i = SCENES.findIndex((s) => s.name === name);
      const card = this._cards[i];
      if (card) {
        const ph = card.querySelector(".sg-thumb-ph");
        if (ph) {
          const img = document.createElement("img");
          img.className = "sg-thumb";
          img.src = url;
          ph.replaceWith(img);
        } else {
          const img = card.querySelector(".sg-thumb");
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
        this.app.off("postrender", handler);
        try {
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let lum = 0;
          for (let i = 0; i < 40; i++) {
            const o = (Math.random() * w * h | 0) * 4;
            lum += px[o] + px[o + 1] + px[o + 2];
          }
          if (lum < 200) return;
          const full = document.createElement("canvas");
          full.width = w;
          full.height = h;
          const fctx = full.getContext("2d");
          const img = fctx.createImageData(w, h);
          for (let y = 0; y < h; y++) {
            img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
          }
          fctx.putImageData(img, 0, 0);
          const t = document.createElement("canvas");
          t.width = 256;
          t.height = 110;
          t.getContext("2d").drawImage(full, 0, 0, 256, 110);
          this._setThumb(scene.name, t.toDataURL("image/jpeg", 0.65));
        } catch (e) {
        }
      };
      this.app.on("postrender", handler);
    }
    _assetUrl(id, fname) {
      let q = "";
      try {
        const cfg = window.config;
        const bid = cfg && (cfg.self?.branch?.id || cfg.self?.branchId) || "87d9f884-5657-4343-887e-e823e912488f";
        q = `?branchId=${bid}`;
      } catch (e) {
      }
      return `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
    }
    async _loadVoxel(scene) {
      if (scene.voxelData) return scene.voxelData;
      if (scene.voxel === "embedded") {
        const data = window.UNI3_VOXEL;
        const bin = atob(data.binBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const view2 = new Uint32Array(bytes.buffer);
        const meta2 = data.meta;
        return {
          meta: meta2,
          nodes: view2.slice(0, meta2.nodeCount),
          leafData: view2.slice(meta2.nodeCount, meta2.nodeCount + meta2.leafDataCount)
        };
      }
      const metaResp = await fetch(this._assetUrl(scene.voxelJson[0], scene.voxelJson[1]));
      const meta = await metaResp.json();
      const binResp = await fetch(this._assetUrl(scene.voxelBin[0], scene.voxelBin[1]));
      const buffer = await binResp.arrayBuffer();
      const view = new Uint32Array(buffer);
      return {
        meta,
        nodes: view.slice(0, meta.nodeCount),
        leafData: view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount)
      };
    }
    _applyCollision(meta, nodes, leafData) {
      const c = this.collision;
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
        if (pt.ent) {
          try {
            pt.ent.destroy();
          } catch (e) {
          }
        }
        if (pt.el) pt.el.remove();
      }
      this._portals.length = 0;
    }
    _buildPortals(scene) {
      this._clearPortals();
      if (!scene.portals) return;
      for (const cfg of scene.portals) {
        let ent = null;
        try {
          ent = new pc.Entity("portal");
          ent.addComponent("render", { type: "sphere" });
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
        } catch (e) {
          ent = null;
        }
        const el = document.createElement("div");
        el.className = "sg sg-mono";
        el.style.cssText = "position:fixed;transform:translate(-50%,-120%);z-index:9998;font-family:var(--font);font-size:11px;font-weight:600;padding:3px 12px;border-radius:9999px;background:var(--primary);color:var(--primary-fg);pointer-events:none;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.5);";
        el.textContent = "\u2316 " + (cfg.label || "portal").replace("\u2192 ", "");
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
            pt.el.style.display = "none";
          } else {
            pt.el.style.display = "block";
            pt.el.style.left = `${this._screenPos.x * (canvas.clientWidth / canvas.width)}px`;
            pt.el.style.top = `${this._screenPos.y * (canvas.clientHeight / canvas.height)}px`;
          }
        }
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (!pt.armed) {
          if (d2 > c.radius * c.radius * 2.6) pt.armed = true;
          continue;
        }
        if (d2 < c.radius * c.radius) {
          this.switchTo(c.to, c.spawnAt || null);
          return;
        }
      }
    }
    async switchTo(i, spawnAt = null) {
      if (this._busy) {
        this._queued = { i, spawnAt };
        return;
      }
      if (i === this.current) return;
      this._busy = true;
      const scene = SCENES[i];
      const s = this.script;
      try {
        if (s._npcs) {
          s._npcs.suspended = true;
          s._npcs.reset();
          s._npcs.floorRange = scene.npcFloorY || null;
        }
        if (s._director) s._director._showBanner(`TELEPORTING \u2192 ${scene.name.toUpperCase()}\u2026`, 3);
        const v2 = await this._loadVoxel(scene);
        this._applyCollision(v2.meta, v2.nodes, v2.leafData);
        const splat = this.app.root.findByName("University 3");
        if (splat) {
          splat.setEulerAngles(scene.rot[0], scene.rot[1], scene.rot[2]);
          const asset = scene.gsplatAsset || this.app.assets.get(scene.gsplatId);
          if (asset) {
            if (!asset.resource && !asset.loading) this.app.assets.load(asset);
            splat.gsplat.asset = asset;
          }
        }
        if (s._balls) s._balls.clear();
        if (s._labels) {
          while (s._labels.markers.length) s._labels.deleteMarker(s._labels.markers[0]);
        }
        if (s._voxelView) {
          s._voxelView._lastPos = { x: 1e9, y: 1e9, z: 1e9 };
          if (s._voxelView.entity) {
            s._voxelView.entity.destroy();
            s._voxelView.entity = null;
          }
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
        const d2 = s._director;
        if (s._npcs) s._npcs.combatEnabled = !scene.noSoldiers && !!(d2 && (d2.state === "playing" || d2.state === "intermission"));
        if (d2 && (d2.state === "playing" || d2.state === "intermission")) {
          if (scene.noSoldiers) {
            d2.state = "playing";
            d2._waveDelay = 0;
            if (s._npcs) s._npcs.setPopulation(0);
          } else {
            d2.wave = 0;
            d2.state = "playing";
            d2._waveDelay = 0.6;
          }
        }
        this._buildPortals(scene);
        this._setActive(i);
        this.current = i;
        setTimeout(() => this._maybeCapture(), 1800);
        console.log("sceneManager: switched to", scene.name);
      } catch (e) {
        console.error("sceneManager switch failed", e);
      }
      if (s._npcs) s._npcs.suspended = false;
      this._busy = false;
      if (s._net && s._net.enabled) s._net.sendStateNow();
      const canvas = this.app.graphicsDevice.canvas;
      if (canvas) canvas.requestPointerLock();
      if (this._queued) {
        const q = this._queued;
        this._queued = null;
        if (q.i !== this.current) this.switchTo(q.i, q.spawnAt);
      }
    }
  };
  var UI_CSS = `
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
    if (document.getElementById("sg-css")) return;
    const st = document.createElement("style");
    st.id = "sg-css";
    st.textContent = UI_CSS;
    document.head ? document.head.appendChild(st) : document.body.appendChild(st);
  }
  async function unzip(buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 101010256) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("not a zip file");
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const out2 = [];
    const td = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 33639248) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
      off += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith("/")) continue;
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + compSize);
      let data;
      if (method === 0) {
        data = comp.slice();
      } else if (method === 8) {
        const stream = new Blob([comp.slice()]).stream().pipeThrough(new globalThis.DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } else {
        continue;
      }
      out2.push({ name, data });
    }
    return out2;
  }
  var DropSystem = class {
    constructor(app, script) {
      __publicField(this, "app");
      __publicField(this, "script");
      __publicField(this, "_dropCount", 0);
      this.app = app;
      this.script = script;
      window.addEventListener("dragover", (e) => e.preventDefault());
      window.addEventListener("drop", (e) => {
        e.preventDefault();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._import(f);
      });
    }
    _banner(text, secs) {
      const d2 = this.script._director;
      if (d2) d2._showBanner(text, secs);
      console.log("[drop]", text);
    }
    async _import(file) {
      try {
        if (!/\.zip$/i.test(file.name)) {
          this._banner("DROP A .ZIP (sog + voxel json/bin)", 4);
          return;
        }
        this._banner(`IMPORTING ${file.name.toUpperCase()}\u2026`, 8);
        const entries = await unzip(await file.arrayBuffer());
        let sog = null, metaEntry = null, bin = null;
        const td = new TextDecoder();
        for (const en of entries) {
          const base = en.name.split("/").pop() || en.name;
          if (/\.sog$/i.test(base)) sog = en;
          else if (/\.bin$/i.test(base)) bin = en;
          else if (/\.json$/i.test(base)) {
            try {
              const j = JSON.parse(td.decode(en.data));
              if (j.gridBounds && j.nodeCount) {
                metaEntry = en;
                en.meta = j;
              }
            } catch (err) {
            }
          }
        }
        if (!sog || !metaEntry || !bin) {
          this._banner("ZIP NEEDS: .sog + voxel .json + voxel .bin", 5);
          return;
        }
        const meta = metaEntry.meta;
        const view = new Uint32Array(bin.data.buffer, bin.data.byteOffset, Math.floor(bin.data.length / 4));
        const nodes = view.slice(0, meta.nodeCount);
        const leafData = view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount);
        const blobUrl = URL.createObjectURL(new Blob([sog.data], { type: "application/zip" }));
        const asset = new pc.Asset(`drop-${++this._dropCount}.sog`, "gsplat", { url: blobUrl, filename: "drop.sog" });
        this.app.assets.add(asset);
        const sceneName = file.name.replace(/\.zip$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 24) || "dropped scan";
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
        this._banner(`SCAN READY \u2014 ENTERING ${sceneName.toUpperCase()}`, 4);
        if (scenes) scenes.switchTo(idx);
      } catch (e) {
        console.error("drop import failed", e);
        this._banner("IMPORT FAILED: " + (e && e.message || e), 5);
      }
    }
  };
  var PARTY_URL = "wss://roland-obligations-futures-collections.trycloudflare.com";
  var RELAY_URL_ASSET = [298997427, "relay-url.json"];
  var NET_SEND_INTERVAL = 1 / 12;
  var NetSystem = class {
    constructor(app, script, refs) {
      __publicField(this, "app");
      __publicField(this, "script");
      __publicField(this, "npcs");
      __publicField(this, "balls");
      __publicField(this, "scenes");
      __publicField(this, "director");
      __publicField(this, "walkCamera");
      __publicField(this, "enabled", false);
      __publicField(this, "ws", null);
      __publicField(this, "myId", "");
      __publicField(this, "myName", "");
      __publicField(this, "room", "hack6");
      __publicField(this, "peers", /* @__PURE__ */ new Map());
      __publicField(this, "_sendT", 0);
      __publicField(this, "_retry", 0);
      __publicField(this, "_destroyed", false);
      __publicField(this, "_screenPos", null);
      __publicField(this, "_url", "");
      __publicField(this, "_resolveUrl", null);
      this.app = app;
      this.script = script;
      this.npcs = refs.npcs;
      this.balls = refs.balls;
      this.scenes = refs.scenes;
      this.director = refs.director;
      this.walkCamera = refs.walkCamera;
      let param = "";
      try {
        const q = new URLSearchParams(window.location.search);
        param = q.get("party") || "";
        this.room = q.get("room") || "hack6";
      } catch (e) {
      }
      const finish = (base) => {
        if (!base) {
          console.log("net: multiplayer off (no relay url)");
          return;
        }
        base = base.replace(/^http/, "ws").replace(/\/+$/, "");
        this._url = `${base}/parties/main/${encodeURIComponent(this.room)}`;
        this._connect();
      };
      if (param) {
        this._resolveUrl = () => finish(param);
      } else {
        this._resolveUrl = async () => {
          let base = PARTY_URL;
          try {
            const cfg = window.config;
            const bid = cfg && (cfg.self?.branch?.id || cfg.self?.branchId) || "87d9f884-5657-4343-887e-e823e912488f";
            const r = await fetch(`${window.location.origin}/api/assets/${RELAY_URL_ASSET[0]}/file/${RELAY_URL_ASSET[1]}?branchId=${bid}`);
            if (r.ok) {
              const j = await r.json();
              if (j && j.url) base = j.url;
            }
          } catch (e) {
          }
          finish(base);
        };
      }
      try {
        this.myName = localStorage.getItem("siege-name") || "";
      } catch (e) {
      }
      if (!this.myName) {
        try {
          this.myName = (window.prompt("Player name for multiplayer:", "player") || "player").slice(0, 16);
          localStorage.setItem("siege-name", this.myName);
        } catch (e) {
          this.myName = "player" + Math.floor(Math.random() * 1e3);
        }
      }
      this.enabled = true;
      this._screenPos = new pc.Vec3();
      this._resolveUrl();
    }
    _connect() {
      if (this._destroyed || !this._url) return;
      try {
        const ws = new WebSocket(this._url);
        this.ws = ws;
        ws.onopen = () => {
          this._retry = 0;
          console.log("net: connected to", this._url, "as", this.myName);
          this.sendStateNow();
        };
        ws.onmessage = (ev) => {
          try {
            this._onMsg(JSON.parse(ev.data));
          } catch (e) {
          }
        };
        ws.onclose = () => {
          this.ws = null;
          if (this._destroyed) return;
          const wait = Math.min(1e4, 1500 * ++this._retry);
          setTimeout(() => this._connect(), wait);
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch (e) {
          }
        };
      } catch (e) {
        console.warn("net: connect failed", e);
      }
    }
    _send(obj) {
      if (this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send(JSON.stringify(obj));
        } catch (e) {
        }
      }
    }
    sendStateNow() {
      if (!this.enabled) return;
      const p = this.walkCamera.position;
      const a = this.walkCamera.angles;
      this._send({
        t: "state",
        name: this.myName,
        scene: this.scenes ? this.scenes.current : 0,
        x: +p.x.toFixed(3),
        y: +p.y.toFixed(3),
        z: +p.z.toFixed(3),
        yaw: +a.y.toFixed(1),
        pitch: +a.x.toFixed(1),
        crouch: !!this.script._crouched
      });
    }
    sendShot(ox, oy, oz, dx, dy, dz) {
      this._send({
        t: "shoot",
        scene: this.scenes ? this.scenes.current : 0,
        ox: +ox.toFixed(3),
        oy: +oy.toFixed(3),
        oz: +oz.toFixed(3),
        dx: +dx.toFixed(4),
        dy: +dy.toFixed(4),
        dz: +dz.toFixed(4)
      });
    }
    _onMsg(m) {
      if (m.t === "hello") {
        this.myId = m.id;
        return;
      }
      if (m.t === "leave") {
        const peer = this.peers.get(m.id);
        if (peer) {
          if (peer.ent) {
            try {
              peer.ent.destroy();
            } catch (e) {
            }
          }
          if (peer.el) peer.el.remove();
          if (this.director) this.director._feedMsg(`${peer.name || "player"} left`);
          this.peers.delete(m.id);
          this._syncOnline();
        }
        return;
      }
      if (m.t === "state") {
        let peer = this.peers.get(m.id);
        if (!peer) {
          peer = { name: m.name, scene: m.scene, cur: null, prev: null, t: 0, ent: null, model: null, el: null, animState: "" };
          this.peers.set(m.id, peer);
          if (this.director) this.director._feedMsg(`${m.name || "player"} joined`);
          this._syncOnline();
        }
        peer.name = m.name || peer.name;
        peer.scene = m.scene;
        peer.prev = peer.cur || { x: m.x, y: m.y, z: m.z, yaw: m.yaw, crouch: m.crouch };
        peer.cur = { x: m.x, y: m.y, z: m.z, yaw: m.yaw, crouch: m.crouch };
        peer.t = 0;
        return;
      }
      if (m.t === "shoot") {
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
    _ensureAvatar(peer) {
      if (peer.ent || !this.npcs || !this.npcs.ready || !this.npcs.assets.model) return;
      try {
        const root = new pc.Entity("net-player");
        const model = this.npcs.assets.model.resource.instantiateRenderEntity();
        root.addChild(model);
        this.app.root.addChild(root);
        for (const r of model.findComponents("render")) {
          for (const mi of r.meshInstances) mi.cull = false;
        }
        const s = this.npcs.npcHeight / 180;
        model.setLocalScale(s, s, s);
        model.setLocalEulerAngles(0, 180, 0);
        model.addComponent("anim", { activate: true });
        const idle = this.npcs._track("idle");
        const walk = this.npcs._track("walk");
        if (idle) model.anim.assignAnimation("Idle", idle);
        if (walk) model.anim.assignAnimation("Walk", walk);
        peer.ent = root;
        peer.model = model;
        const el = document.createElement("div");
        el.className = "sg sg-mono";
        el.style.cssText = "position:fixed;transform:translate(-50%,-100%);z-index:9997;font-family:var(--font);font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;background:rgba(9,9,11,0.9);pointer-events:none;white-space:nowrap;color:var(--info);border:1px solid rgba(96,165,250,0.4);";
        el.textContent = peer.name || "player";
        document.body.appendChild(el);
        peer.el = el;
      } catch (e) {
        console.warn("net: avatar failed", e);
      }
    }
    _setPeerAnim(peer, state) {
      if (peer.animState === state || !peer.model || !peer.model.anim) return;
      try {
        if (peer.model.anim.baseLayer) {
          peer.model.anim.baseLayer.transition(state, 0.2);
          peer.animState = state;
        }
      } catch (e) {
      }
    }
    step(dt) {
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
          if (peer.el) peer.el.style.display = "none";
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
        const floorY = y - (b.crouch ? 0.95 : 1.5);
        peer.ent.setPosition(x, floorY, z);
        peer.ent.setEulerAngles(0, yaw, 0);
        if (peer.model) {
          const s = this.npcs.npcHeight / 180;
          peer.model.setLocalScale(s, b.crouch ? s * 0.72 : s, s);
        }
        const spd = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z)) / NET_SEND_INTERVAL;
        this._setPeerAnim(peer, spd > 0.3 ? "Walk" : "Idle");
        if (peer.el && camComp && canvas) {
          camComp.worldToScreen(new pc.Vec3(x, floorY + (this.npcs ? this.npcs.npcHeight : 1.7) + 0.15, z), this._screenPos);
          if (this._screenPos.z < 0) {
            peer.el.style.display = "none";
          } else {
            peer.el.style.display = "block";
            peer.el.style.left = `${this._screenPos.x * (canvas.clientWidth / canvas.width)}px`;
            peer.el.style.top = `${this._screenPos.y * (canvas.clientHeight / canvas.height)}px`;
          }
        }
      }
    }
  };
  var FRIENDS = [
    { name: "Larry", assetId: 298997648, fname: "friend-larry.glb" },
    { name: "Aditya", assetId: 298997653, fname: "friend-aditya.glb" },
    { name: "Akash", assetId: 298998118, fname: "friend-akash.glb" },
    { name: "Kelly", assetId: 298998127, fname: "friend-kelly.glb" }
  ];
  var FRIEND_HEIGHT = 1.72;
  var FRIEND_SPEED = 1;
  var FriendSystem = class {
    constructor(app, collision, npcs) {
      __publicField(this, "app");
      __publicField(this, "collision");
      __publicField(this, "npcs");
      // reused for floor-spot search + camera ref
      __publicField(this, "scenes");
      __publicField(this, "friends", []);
      __publicField(this, "_lastScene", -1);
      __publicField(this, "_screenPos");
      this.app = app;
      this.collision = collision;
      this.npcs = npcs;
      this._screenPos = new pc.Vec3();
      for (const cfg of FRIENDS) this._load(cfg);
    }
    _url(id, fname) {
      let q = "";
      try {
        const cfg = window.config;
        const bid = cfg && (cfg.self?.branch?.id || cfg.self?.branchId) || "87d9f884-5657-4343-887e-e823e912488f";
        q = `?branchId=${bid}`;
      } catch (e) {
      }
      return `${window.location.origin}/api/assets/${id}/file/${fname}${q}`;
    }
    _load(cfg) {
      const asset = new pc.Asset(cfg.fname, "container", { url: this._url(cfg.assetId, cfg.fname), filename: cfg.fname });
      asset.on("load", () => {
        cfg.asset = asset;
        this._spawn(cfg);
      });
      asset.on("error", (err) => console.error("friend asset failed:", cfg.name, err));
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    }
    _spawn(cfg) {
      try {
        const spot = this.npcs._randomFloorSpot();
        if (!spot) {
          setTimeout(() => this._spawn(cfg), 2500);
          return;
        }
        const root = new pc.Entity("friend-" + cfg.name);
        const model = cfg.asset.resource.instantiateRenderEntity();
        root.addChild(model);
        this.app.root.addChild(root);
        for (const r of model.findComponents("render")) {
          for (const mi of r.meshInstances) mi.cull = false;
        }
        model.setLocalEulerAngles(0, 180, 0);
        const anims = cfg.asset.resource.animations;
        if (anims && anims.length) {
          model.addComponent("anim", { activate: true });
          model.anim.assignAnimation("Walk", anims[0].resource);
        }
        root.setPosition(spot.x, spot.y, spot.z);
        const el = document.createElement("div");
        el.className = "sg sg-mono";
        el.style.cssText = "position:fixed;transform:translate(-50%,-100%);z-index:9997;font-family:var(--font);font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;background:rgba(9,9,11,0.9);pointer-events:none;white-space:nowrap;color:var(--ok);border:1px solid rgba(52,211,153,0.4);";
        el.textContent = cfg.name;
        document.body.appendChild(el);
        this.friends.push({
          cfg,
          root,
          model,
          el,
          p: { x: spot.x, y: spot.y, z: spot.z },
          target: null,
          static: !!cfg.generated,
          // T-pose units stand at attention
          yaw: Math.random() * 360,
          fit: { phase: "scale", wait: 4 },
          _push: { x: 0, y: 0, z: 0 }
        });
      } catch (e) {
        console.warn("friend spawn failed", cfg.name, e);
      }
    }
    _measure(model) {
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
        cx += pos.x;
        cz += pos.z;
        n++;
      }
      if (n < 3) return null;
      return { minY, ext: maxY - minY, cx: cx / n, cz: cz / n };
    }
    /** spawn a freshly generated (T-pose, unrigged) unit near the player */
    spawnGenerated(name, asset) {
      const cfg = { name, asset, generated: true };
      FRIENDS.push(cfg);
      this._spawn(cfg);
    }
    /** respawn everyone when the location changes */
    resetForScene() {
      for (const f of this.friends) {
        try {
          f.root.destroy();
        } catch (e) {
        }
        if (f.el) f.el.remove();
      }
      this.friends.length = 0;
      for (const cfg of FRIENDS) {
        if (cfg.asset) this._spawn(cfg);
      }
    }
    step(dt) {
      if (this.scenes && this.scenes.current !== this._lastScene) {
        this._lastScene = this.scenes.current;
        if (this.friends.length) this.resetForScene();
      }
      const camComp = this.npcs.cameraEntity.camera;
      const canvas = this.app.graphicsDevice.canvas;
      for (const f of this.friends) {
        if (f.fit) {
          if (f.fit.wait > 0) {
            f.fit.wait--;
            continue;
          }
          const m = this._measure(f.model);
          if (!m || !isFinite(m.ext) || m.ext <= 0.05) {
            f.fit.wait = 4;
            continue;
          }
          if (f.fit.phase === "scale") {
            const cur = f.model.getLocalScale().x;
            let s = cur * (FRIEND_HEIGHT * 0.95 / m.ext);
            if (!isFinite(s) || s < 5e-4 || s > 10) s = 1;
            f.model.setLocalScale(s, s, s);
            f.fit.phase = "ground";
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
        } else if (!f.target) {
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
            f.el.style.display = "none";
          } else {
            f.el.style.display = "block";
            f.el.style.left = `${this._screenPos.x * (canvas.clientWidth / canvas.width)}px`;
            f.el.style.top = `${this._screenPos.y * (canvas.clientHeight / canvas.height)}px`;
          }
        }
      }
    }
  };
  var NPC_PIPELINE_URL = "http://localhost:8799";
  var RequisitionSystem = class {
    constructor(app, script) {
      __publicField(this, "app");
      __publicField(this, "script");
      __publicField(this, "base");
      __publicField(this, "_cardStatus", null);
      this.app = app;
      this.script = script;
      let base = NPC_PIPELINE_URL;
      try {
        const q = new URLSearchParams(window.location.search);
        base = q.get("npc") || base;
      } catch (e) {
      }
      this.base = base.replace(/\/+$/, "");
    }
    /** sidebar hook: build the "requisition" card */
    makeCard(container) {
      const card = document.createElement("div");
      card.id = "sg-requisition";
      card.style.cssText = "";
      card.innerHTML = '<span style="color:var(--foreground);font-weight:500">Create an NPC</span><br><span style="font-size:10px">photos of a person become a unit</span>';
      const status = document.createElement("div");
      status.style.cssText = "font-size:10px;margin-top:6px;color:#93c5fd;display:none;";
      card.appendChild(status);
      this._cardStatus = status;
      card.addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "image/*";
        inp.multiple = true;
        inp.onchange = () => {
          const files = inp.files;
          if (files && files.length) this.requisition(Array.from(files));
        };
        inp.click();
      });
      container.appendChild(card);
    }
    _status(text) {
      if (this._cardStatus) {
        this._cardStatus.style.display = "block";
        this._cardStatus.textContent = text;
      }
      const d2 = this.script._director;
      if (d2) d2._feedMsg(text);
    }
    async requisition(files) {
      const name = (window.prompt("Name this unit:", "recruit") || "recruit").slice(0, 16);
      try {
        this._status(`${name}: uploading ${files.length} photo(s)\u2026`);
        const fd = new FormData();
        fd.append("name", name);
        for (const f of files) fd.append("images", f);
        const r = await fetch(`${this.base}/npc/generate`, { method: "POST", body: fd });
        if (!r.ok) throw new Error(`server ${r.status}`);
        const { job_id } = await r.json();
        this._poll(job_id, name);
      } catch (e) {
        this._status(`${name}: pipeline offline (${e && e.message || e})`);
      }
    }
    async _poll(jobId, name) {
      try {
        const r = await fetch(`${this.base}/npc/status/${jobId}`);
        const st = await r.json();
        if (st.status === "SUCCEEDED" || st.download_url) {
          this._status(`${name}: downloading\u2026`);
          const g = await fetch(`${this.base}/npc/download/${jobId}`);
          if (!g.ok) throw new Error(`download ${g.status}`);
          const blob = await g.blob();
          this._materialize(name, blob);
          return;
        }
        if (st.status === "FAILED" || st.error) {
          this._status(`${name}: generation failed (${st.error || "unknown"})`);
          return;
        }
        this._status(`${name}: ${st.stage || "generating"} ${st.progress != null ? st.progress + "%" : ""}`);
        setTimeout(() => this._poll(jobId, name), 4e3);
      } catch (e) {
        this._status(`${name}: lost pipeline (${e && e.message || e})`);
      }
    }
    _materialize(name, blob) {
      try {
        const url = URL.createObjectURL(blob);
        const asset = new pc.Asset(`req-${name}.glb`, "container", { url, filename: "unit.glb" });
        asset.on("load", () => {
          const friends = this.script._friends;
          if (friends) {
            friends.spawnGenerated(name, asset);
            this._status(`${name}: unit deployed \u2713`);
          } else {
            this._status(`${name}: no friend system`);
          }
        });
        asset.on("error", (err) => this._status(`${name}: model failed (${err})`));
        this.app.assets.add(asset);
        this.app.assets.load(asset);
      } catch (e) {
        this._status(`${name}: materialize failed`);
      }
    }
  };
  var WAVE_INTERMISSION = 5;
  var PLAYER_MAX_HP = 100;
  var HP_REGEN_DELAY = 5;
  var HP_REGEN_RATE = 6;
  var GameDirector = class {
    constructor(npcs) {
      __publicField(this, "state", "title");
      // title | playing | intermission | gameover | practice
      __publicField(this, "targets", null);
      __publicField(this, "practiceHits", 0);
      __publicField(this, "wave", 0);
      __publicField(this, "score", 0);
      __publicField(this, "kills", 0);
      __publicField(this, "hp", PLAYER_MAX_HP);
      __publicField(this, "_regenT", 0);
      __publicField(this, "_interT", 0);
      __publicField(this, "_waveDelay", 0);
      __publicField(this, "npcs");
      __publicField(this, "sceneMgr", null);
      __publicField(this, "sounds", null);
      __publicField(this, "onRestart", null);
      __publicField(this, "_ambient", null);
      __publicField(this, "_lastPain", 0);
      __publicField(this, "_overlay");
      __publicField(this, "_banner");
      __publicField(this, "_hud");
      __publicField(this, "_hpFill");
      __publicField(this, "_vignette");
      __publicField(this, "_feed");
      this.npcs = npcs;
      this._makeDom();
      this._showTitle();
      npcs.onKill = () => {
        this.kills++;
        this.score += 100;
        this._feedMsg("soldier eliminated  +100");
        this._syncHud();
      };
      npcs.onPlayerDamage = (dmg) => this._damage(dmg);
    }
    _makeDom() {
      const mk = (css) => {
        const d2 = document.createElement("div");
        d2.style.cssText = css;
        document.body.appendChild(d2);
        return d2;
      };
      injectUiCss();
      this._overlay = mk("position:fixed;inset:0;z-index:10005;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(9,9,11,0.94);color:var(--foreground);text-align:center;cursor:pointer;");
      this._overlay.className = "sg";
      this._banner = mk("position:fixed;top:14%;left:50%;transform:translateX(-50%);z-index:10004;display:none;padding:12px 28px;font-size:13px;font-weight:600;letter-spacing:0.04em;white-space:nowrap;");
      this._banner.className = "sg sg-panel";
      this._hud = mk("position:fixed;top:16px;left:16px;z-index:10001;pointer-events:none;padding:10px 16px;min-width:180px;");
      this._hud.className = "sg sg-panel";
      this._feed = mk("position:fixed;top:112px;left:16px;z-index:10001;pointer-events:none;font-family:var(--font);font-size:11px;color:var(--muted-fg);display:flex;flex-direction:column;gap:3px;");
      this._feed.className = "sg sg-mono";
      const hpWrap = mk("position:fixed;bottom:20px;left:16px;z-index:10001;width:230px;padding:10px 14px;pointer-events:none;");
      hpWrap.className = "sg sg-panel";
      hpWrap.innerHTML = '<div style="font-size:11px;font-weight:500;color:var(--muted-fg);margin-bottom:6px;display:flex;justify-content:space-between"><span>Health</span></div>';
      const hpBar = document.createElement("div");
      hpBar.className = "sg-progress";
      hpBar.style.cssText = "width:188px;";
      this._hpFill = document.createElement("div");
      this._hpFill.style.cssText = "height:100%;width:100%;border-radius:9999px;background:var(--primary);transition:width 0.15s,background 0.15s;";
      hpBar.appendChild(this._hpFill);
      hpWrap.appendChild(hpBar);
      this._vignette = mk("position:fixed;inset:0;z-index:10000;pointer-events:none;background:radial-gradient(ellipse at center, transparent 55%, rgba(200,30,40,0.5) 100%);opacity:0;transition:opacity 0.12s;");
      this._overlay.addEventListener("click", () => {
        if (this.state === "title") this._start();
        else if (this.state === "gameover") this._restart();
      });
      this._syncHud();
    }
    enterPractice() {
      if (this.targets == null) return;
      this.npcs.reset();
      this.npcs.combatEnabled = false;
      this.npcs.playerDead = false;
      this.state = "practice";
      this.practiceHits = 0;
      this._overlay.style.display = "none";
      this.targets.enter();
      const w = window.walk;
      if (w && w.balls) {
        w.balls.noBounce = true;
        w.balls.clear();
      }
      this._showBanner("TARGET PRACTICE \u2014 T to return", 4);
      this._syncHud();
      const canvas = window.walk?.script?.app?.graphicsDevice?.canvas;
      if (canvas && document.pointerLockElement !== canvas) canvas.requestPointerLock();
    }
    exitPractice() {
      if (this.state !== "practice") return;
      this.targets.exit();
      const w = window.walk;
      if (w && w.balls) {
        w.balls.noBounce = false;
        w.balls.clear();
      }
      this._showTitle();
    }
    practiceHit() {
      this.practiceHits++;
      this.score = this.practiceHits * 50;
      this._feedMsg("target hit  +50");
      this._syncHud();
    }
    _showTitle() {
      this.state = "title";
      this._overlay.style.display = "flex";
      this._overlay.innerHTML = '<div style="font-size:12px;font-weight:500;color:var(--muted-fg);margin-bottom:16px">University of Toronto \xB7 43.6596\xB0 N, 79.3976\xB0 W</div><div style="font-size:72px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:var(--foreground)">SIEGE</div><div style="font-size:14px;color:var(--muted-fg);margin:16px 0 36px;max-width:420px;line-height:1.6">Reality, scanned. Now defend it \u2014 a wave shooter inside real Gaussian-splat scans of campus.</div><div class="sg-panel" style="padding:14px 22px;font-size:12px;line-height:2.1;color:var(--muted-fg);text-align:left"><span style="color:var(--foreground);font-weight:500">WASD</span> move \xB7 <span style="color:var(--foreground);font-weight:500">Shift</span> run \xB7 <span style="color:var(--foreground);font-weight:500">Space</span> jump \xB7 <span style="color:var(--foreground);font-weight:500">C</span> crouch<br><span style="color:var(--foreground);font-weight:500">LMB</span> fire \xB7 <span style="color:var(--foreground);font-weight:500">R</span> reload \xB7 <span style="color:var(--foreground);font-weight:500">T</span> targets \xB7 <span style="color:var(--foreground);font-weight:500">M</span> locations \xB7 <span style="color:var(--foreground);font-weight:500">B</span> voxels</div><div class="sg-btn" style="margin-top:36px">Click to start</div><div style="margin-top:14px;font-size:11px;color:var(--muted-fg)">Drop a scan .zip anywhere \u2014 any room becomes a level</div>';
    }
    _start() {
      this.state = "playing";
      this.wave = 0;
      this.score = 0;
      this.kills = 0;
      this.hp = PLAYER_MAX_HP;
      this._overlay.style.display = "none";
      this.npcs.playerDead = false;
      this.npcs.combatEnabled = true;
      if (this.sounds && !this._ambient) {
        this._ambient = this.sounds.play("room.mp3", { volume: 0.3, loop: true });
      }
      if (this.sounds) this.sounds.play("carbineReady.wav", { volume: 0.6 });
      this._nextWave();
      const canvas = window.walk?.script?.app?.graphicsDevice?.canvas;
      if (canvas) canvas.requestPointerLock();
    }
    _restart() {
      if (this.onRestart) this.onRestart();
      this._start();
    }
    _nextWave() {
      const sc = this.sceneMgr ? SCENES[this.sceneMgr.current] : null;
      if (sc && sc.noSoldiers) {
        this.npcs.reset();
        this.npcs.setPopulation(0);
        this.npcs.combatEnabled = false;
        this._showBanner("SAFE ZONE \u2014 no hostiles here", 3);
        this._syncHud();
        return;
      }
      this.wave++;
      const count = Math.min(2 + this.wave, 8);
      const speedMul = Math.min(1 + (this.wave - 1) * 0.12, 1.8);
      this.npcs.reset();
      this.npcs.combatEnabled = true;
      this.npcs.setPopulation(count, speedMul);
      this._showBanner(`\u2014 WAVE ${this.wave} INCOMING \u2014`, 3);
      this._syncHud();
    }
    _showBanner(text, secs) {
      this._banner.textContent = text;
      this._banner.style.display = "block";
      clearTimeout(this._bannerTo);
      this._bannerTo = setTimeout(() => {
        this._banner.style.display = "none";
      }, secs * 1e3);
    }
    _feedMsg(text) {
      const line = document.createElement("div");
      line.textContent = "\xBB " + text;
      this._feed.prepend(line);
      setTimeout(() => line.remove(), 4e3);
      while (this._feed.children.length > 4) this._feed.lastChild.remove();
    }
    _damage(dmg) {
      if (this.state !== "playing") return;
      this.hp = Math.max(0, this.hp - dmg);
      this._regenT = HP_REGEN_DELAY;
      const nowP = performance.now();
      if (this.sounds && nowP - this._lastPain > 300) {
        this._lastPain = nowP;
        this.sounds.playRandom(["pain1.mp3", "pain2.mp3", "pain3.mp3", "pain4.mp3"], { volume: 0.7, pitch: 0.9 + Math.random() * 0.2 });
      }
      this._vignette.style.opacity = "1";
      setTimeout(() => {
        this._vignette.style.opacity = "0";
      }, 160);
      this._syncHud();
      if (this.hp <= 0) this._gameOver();
    }
    _gameOver() {
      this.state = "gameover";
      this.npcs.playerDead = true;
      document.exitPointerLock();
      this._overlay.style.display = "flex";
      this._overlay.innerHTML = `<div style="font-size:12px;font-weight:500;color:var(--destructive);margin-bottom:14px">Signal lost</div><div style="font-size:56px;font-weight:700;letter-spacing:-0.03em;color:var(--foreground)">Eliminated</div><div style="font-size:13px;color:var(--muted-fg);margin:22px 0 0" class="sg-mono">Score <b style="color:var(--foreground)">${this.score}</b> &nbsp;\xB7&nbsp; Waves <b style="color:var(--foreground)">${this.wave}</b> &nbsp;\xB7&nbsp; Kills <b style="color:var(--foreground)">${this.kills}</b></div><div class="sg-btn" style="margin-top:36px">Click to restart</div>`;
    }
    _syncHud() {
      const online = this.online > 1 ? ` &nbsp;\xB7&nbsp; Online <b style="color:var(--info)">${this.online}</b>` : "";
      const title = this.state === "practice" ? "Target Practice" : "SIEGE";
      const stats = this.state === "practice" ? `Hits <b style="color:var(--foreground)">${this.practiceHits}</b> &nbsp;\xB7&nbsp; Score <b style="color:var(--foreground)">${this.practiceHits * 50}</b>` : `Wave <b style="color:var(--foreground)">${this.wave}</b> &nbsp;\xB7&nbsp; Score <b style="color:var(--foreground)">${this.score}</b> &nbsp;\xB7&nbsp; Kills <b style="color:var(--foreground)">${this.kills}</b>`;
      this._hud.innerHTML = `<div class="sg-h" style="font-size:13px;color:var(--foreground)">${title}</div><div class="sg-sep" style="margin:8px 0"></div><div class="sg-mono" style="font-size:12px;color:var(--muted-fg)">${stats}${online}</div>`;
      this._hpFill.style.width = `${this.hp / PLAYER_MAX_HP * 100}%`;
    }
    update(dt) {
      if (this._waveDelay > 0 && this.state === "playing") {
        this._waveDelay -= dt;
        if (this._waveDelay <= 0) this._nextWave();
      }
      if (this.state === "playing") {
        if (this._regenT > 0) {
          this._regenT -= dt;
        } else if (this.hp < PLAYER_MAX_HP) {
          this.hp = Math.min(PLAYER_MAX_HP, this.hp + HP_REGEN_RATE * dt);
          this._syncHud();
        }
        const scNow = this.sceneMgr ? SCENES[this.sceneMgr.current] : null;
        if (this._waveDelay <= 0 && !(scNow && scNow.noSoldiers) && this.npcs.ready && this.npcs.npcs.length > 0 && this.npcs.aliveCount() === 0) {
          this.state = "intermission";
          this._interT = WAVE_INTERMISSION;
          this._showBanner(`WAVE ${this.wave} CLEARED`, WAVE_INTERMISSION);
        }
      } else if (this.state === "intermission") {
        this._interT -= dt;
        if (this._interT <= 0) {
          this.state = "playing";
          this._nextWave();
        }
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
    this._hud.style.display = "none";
    this._hudHidden = true;
    this._coordBox = document.getElementById("coord-box");
    if (!this._coordBox) {
      this._coordBox = document.createElement("div");
      this._coordBox.id = "coord-box";
      this._coordBox.className = "sg sg-panel sg-mono";
      this._coordBox.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10001;font-size:11px;color:var(--muted-fg);padding:5px 16px;border-radius:9999px;pointer-events:none;";
      document.body.appendChild(this._coordBox);
    }
    this._coordT = 0;
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
    const spawn0 = SCENES[0].spawn;
    walkCamera.position.set(spawn0.x, spawn0.y, spawn0.z);
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
    this._crouched = false;
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
        case "KeyF":
          if (down) {
            if (!self._flyMode) {
              self._controller.resetToSpawn(self._walkCamera) || self._controller.onEnter(self._walkCamera);
            }
          }
          break;
        case "KeyE":
          keys.up = down;
          break;
        case "KeyR":
          if (down && self._viewmodel) self._viewmodel.reload();
          break;
        case "KeyG":
          if (down) {
            const f = self.entity.forward;
            const ep = self.entity.getPosition();
            self._balls.throwBall(ep, { x: f.x, y: f.y, z: f.z });
          }
          break;
        case "KeyC":
          keys.crouch = down;
          break;
        case "KeyN":
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
        case "KeyT":
          if (down && self._director) {
            if (self._director.state === "practice") self._director.exitPractice();
            else self._director.enterPractice();
          }
          break;
        case "KeyM":
          if (down && self._scenes) self._scenes.toggleSidebar();
          break;
        case "KeyB":
          if (down && self._voxelView) {
            const on = self._voxelView.toggle();
            console.log("voxel view", on ? "ON" : "OFF");
          }
          break;
        case "Backquote":
          if (down && self._hud) {
            self._hudHidden = !self._hudHidden;
            self._hud.style.display = self._hudHidden ? "none" : "block";
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
    this._onClick = (e) => {
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      } else if (e.button === 0 && self._viewmodel) {
        self._viewmodel.setShooting(true);
      }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0 && self._viewmodel) self._viewmodel.setShooting(false);
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
    canvas.addEventListener("mousedown", this._onClick);
    window.addEventListener("mouseup", this._onMouseUp);
    window.addEventListener("mousemove", this._onMouseMove);
    this.on("destroy", () => {
      window.removeEventListener("keydown", this._onKeyDown);
      window.removeEventListener("keyup", this._onKeyUp);
      window.removeEventListener("blur", this._onBlur);
      canvas.removeEventListener("mousedown", this._onClick);
      window.removeEventListener("mouseup", this._onMouseUp);
      window.removeEventListener("mousemove", this._onMouseMove);
    });
    try {
      if (pc.WasmModule && !window.__ammoConfigured) {
        window.__ammoConfigured = true;
        const bq = (() => {
          try {
            const cfg = window.config;
            const bid = cfg && (cfg.self?.branch?.id || cfg.self?.branchId) || "87d9f884-5657-4343-887e-e823e912488f";
            return `?branchId=${bid}`;
          } catch (e) {
            return "";
          }
        })();
        const au = (id, f) => `${window.location.origin}/api/assets/${id}/file/${f}${bq}`;
        pc.WasmModule.setConfig("Ammo", {
          glueUrl: au(298984312, "ammo.wasm.js"),
          wasmUrl: au(298984313, "ammo.wasm.wasm"),
          fallbackUrl: au(298984311, "ammo.js")
        });
        pc.WasmModule.getInstance("Ammo", () => console.log("ammo: physics engine loaded"));
      }
    } catch (e) {
      console.warn("ammo setup failed", e);
    }
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
    this._sounds = new SoundKit(this.app);
    this._voxelView = new VoxelDebugView(this.app, collision);
    this._balls = new BallPhysics(this.app, collision);
    this._labels = new LabelSystem(this.app, collision, this.entity);
    try {
      this._npcs = new NpcSystem(this.app, collision, this.entity);
    } catch (e) {
      console.error("npc system init failed", e);
      this._npcs = null;
    }
    this._props = null;
    try {
      this._viewmodel = new ViewmodelSystem(this.app, collision, this.entity, this._npcs, this._balls);
    } catch (e) {
      console.error("viewmodel init failed", e);
      this._viewmodel = null;
    }
    if (this._npcs) {
      this._npcs.sounds = this._sounds;
      this._npcs.getPlayerPos = () => walkCamera.position;
    }
    try {
      this._friends = this._npcs ? new FriendSystem(this.app, collision, this._npcs) : null;
    } catch (e) {
      console.error("friend system init failed", e);
      this._friends = null;
    }
    if (this._viewmodel) this._viewmodel.sounds = this._sounds;
    try {
      this._targets = new TargetSystem(this.app, collision, this._sounds);
    } catch (e) {
      console.error("target system init failed", e);
      this._targets = null;
    }
    try {
      this._drops = new DropSystem(this.app, this);
    } catch (e) {
      console.error("drop system init failed", e);
      this._drops = null;
    }
    try {
      this._requisition = new RequisitionSystem(this.app, this);
    } catch (e) {
      console.error("requisition init failed", e);
      this._requisition = null;
    }
    try {
      this._scenes = new SceneManager(this.app, collision, controller, walkCamera, this);
      this._scenes.switchTo(2);
      setTimeout(() => {
        if (this._scenes) this._scenes._maybeCapture();
      }, 6e3);
    } catch (e) {
      console.error("scene manager init failed", e);
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
          npcs: this._npcs,
          balls: this._balls,
          scenes: this._scenes,
          director: this._director,
          walkCamera
        });
        if (this._net.enabled && this._viewmodel) {
          this._viewmodel.onShoot = (ox, oy, oz, dx, dy, dz) => this._net.sendShot(ox, oy, oz, dx, dy, dz);
        }
      } catch (e) {
        console.error("net init failed", e);
        this._net = null;
      }
      if (this._director) {
        this._director.onRestart = () => {
          if (this._balls) this._balls.clear();
          if (this._viewmodel) {
            this._viewmodel.ammo = 30;
            this._viewmodel.reloading = false;
            this._viewmodel._updateAmmo();
            if (this._viewmodel.ready) this._viewmodel.play("idle");
          }
          this._flyMode = false;
          this._controller.resetToSpawn(this._walkCamera) || this._controller.onEnter(this._walkCamera);
        };
      }
    } catch (e) {
      console.error("game director init failed", e);
      this._director = null;
    }
    window.walk = { controller, camera: walkCamera, collision, script: this, balls: this._balls, labels: this._labels, npcs: this._npcs, props: this._props, viewmodel: this._viewmodel, director: this._director, targets: this._targets, scenes: this._scenes, net: this._net };
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
    this._coordT = (this._coordT || 0) + dt;
    if (this._coordT > 0.1 && this._coordBox && typeof this.entity.getPosition === "function") {
      this._coordT = 0;
      const cp = this.entity.getPosition();
      const si = this._scenes ? this._scenes.current : 0;
      const sceneName = this._scenes ? SCENES[si].name : "?";
      this._coordBox.innerHTML = `<span style="color:var(--foreground);font-weight:500">${sceneName}</span> &nbsp;\xB7&nbsp; ${cp.x.toFixed(2)}, ${cp.y.toFixed(2)}, ${(-cp.z).toFixed(2)}`;
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
      if (this._stepsInst) {
        this._stepsInst.stop();
        this._stepsInst = null;
        this._stepsMode = "none";
      }
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
    const wantCrouch = !!keys.crouch;
    if (wantCrouch !== this._crouched) {
      const c = this._controller;
      if (wantCrouch) {
        c.capsuleHeight = 0.9;
        c.eyeHeight = 0.75;
        c.moveGroundSpeed = 3;
        this._crouched = true;
      } else {
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
    const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const z = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0);
    const stepMode = x !== 0 || z !== 0 ? keys.run ? "run" : "walk" : "none";
    if (stepMode !== this._stepsMode) {
      if (this._stepsInst) {
        this._stepsInst.stop();
        this._stepsInst = null;
      }
      this._stepsMode = stepMode;
      if (stepMode !== "none" && this._sounds) {
        this._stepsInst = this._sounds.play(stepMode === "run" ? "steps-running.mp3" : "steps.mp3", { volume: 0.4, loop: true });
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
      this._hud.textContent = `pos ${wp.x.toFixed(2)} ${wp.y.toFixed(2)} ${wp.z.toFixed(2)}
LMB shoot | R reload | C crouch | WASD Space Shift | Y fly | F respawn | G ball | N clear
X label | V remove | [ ] size | L labels | Backspace delete | B voxels`;
    }
  };
})();
