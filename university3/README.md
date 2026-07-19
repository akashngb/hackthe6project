# SIEGE — wave shooter inside a Gaussian splat hallway

Everything that powers the "Hack the 6ix" PlayCanvas project
(editor scene **2551548**): a wave-based defense shooter ("SIEGE") played in
first person inside the University 3 Gaussian splat scan — real voxel
collision, a ball-launcher carbine, soldier NPCs with personalities and
line-of-sight combat, object labeling/removal, and the Mega Knight prop.

## Layout

```
adapter/                 source of the runtime script
  gta6-adapter.ts        classic-script wrapper: walk controller + balls +
                         labels + NPCs + props (script name: walkCollision)
  vendor/                supersplat-viewer ports (cameras/, collision/, core/)
                         — MIT, vendored from the gta6 reference app
  pc-shim.js             maps `import 'playcanvas'` onto the launch global `pc`
  build.sh               esbuild bundle command (npx esbuild)
scripts/                 what is actually deployed to the editor
  walk-collision.bundle.js   built bundle → editor asset 298979018 (walk-collision.js)
  voxel-data.js              collision octree embedded as base64 → asset 298979019
collision/               source voxel carve data (splat-transform v3.1.1)
  scene.voxel.json / .bin
test/
  test-bundle.mjs        headless regression: spawn, walk, strafe-into-walls,
                         jump, ball physics, label carve (node test/test-bundle.mjs)
```

The splat itself is `hallway.sog` at the repo root (= University 3 scan,
byte-identical carve to `collision/scene.voxel.bin`), uploaded as editor
gsplat asset **298979100**.

## Editor asset manifest (project 2551548, branch 87d9f884)

| Asset id  | Name                    | Purpose                          |
|-----------|-------------------------|----------------------------------|
| 298979018 | walk-collision.js       | the deployed bundle (all systems)|
| 298979019 | voxel-data.js           | embedded collision octree        |
| 298979100 | university-3.sog        | the splat (gsplat)               |
| 298980993 | npc-soldier2.glb        | soldier model                    |
| 298980995 | npc-idle.glb            | idle clip                        |
| 298980998 | npc-walk-forward.glb    | walk clip                        |
| 298980999 | npc-run-forward.glb     | run clip                         |
| 298981004 | npc-death-from-the-front.glb | death clip                  |
| 298981007 | npc-death-from-the-back.glb  | death clip                  |
| 298983884 | npc-m16.glb             | soldier weapon                   |
| 298983886 | npc-muzzle-flash.glb    | muzzle flash                     |
| 298983207 | prop-mega-knight.glb    | hallway statue                   |
| 298983917 | fps-carbine.glb         | first-person arms + carbine (textures + allanims) |
| 298984311 | ammo.js                 | Bullet physics fallback (asm.js) |
| 298984312 | ammo.wasm.js            | Bullet wasm glue                 |
| 298984313 | ammo.wasm.wasm          | Bullet wasm binary               |

Scene entities: `University 3` (gsplat, position **(0,0,0)**, rotation
**(0,0,180)** — must stay that way or rendering and collision diverge) and
`Camera` (fov 80, near 0.05, far 300, script `walkCollision`).

## Deploying a change

```sh
cd university3/adapter && ./build.sh
```

then update editor asset 298979018 with the new bundle — from a logged-in
editor tab:

```js
const blob = new Blob([/* bundle text */], { type: 'text/javascript' });
const fd = new FormData();
fd.append('file', new File([blob], 'walk-collision.js'));
fd.append('branchId', config.self.branch.id);
await fetch('/api/assets/298979018', { method: 'PUT', body: fd });
```

(or paste into the PlayCanvas code editor, or use the PlayCanvas MCP
`set_script_text`).

## Controls (launch page)

| Key | Action |
|-----|--------|
| click | start game / grab mouse; further clicks fire |
| LMB (hold) | full-auto: small physics balls from the carbine muzzle |
| R | reload (30-round magazine, auto-reload on empty) |
| WASD / arrows | walk · Shift run · Space jump |
| F | respawn |
| Y | toggle fly mode (E/Q up/down, Shift fast) |
| G | hand-throw a big slow ball · C clear balls |
| X | label object under crosshair |
| V | remove/restore aimed labeled object (splats vanish + collision carved) |
| [ / ] | shrink / grow aimed label sphere |
| L | toggle labels · Backspace delete label |
| B | toggle the collision voxel view (supersplat-style grid) |
| ` | toggle the green debug HUD |

## Physics & audio notes

Balls use substepped swept collision (max ~3/4 radius of travel per check +
a voxel raycast along each substep's path), so even 16 m/s carbine rounds
cannot tunnel through the scan's one-voxel-thin walls. Balls despawn after
3 solid impacts (soft/rolling contact doesn't count). 20 sound effects from
the original project are wired: carbine shots/reloads/dryfire, distance-
scaled NPC gunfire, "I see you" callouts, pain grunts, walk/run footsteps,
and room ambience. `test/test-containment.mjs` fires 40 random fast balls
at 30fps and asserts none leave the collision grid.

## Gameplay (SIEGE)

`GameDirector` runs `title → playing → intermission → gameover`. Wave N
spawns `2+N` soldiers (cap 8) with +12%/wave walk speed. +100 score per
kill; player has 100 HP with regen after 5s calm; death shows a restart
screen that fully resets the round.

Soldier combat is ported from the original project's `npc-ai.js` /
`npc-controller.js`: each soldier draws a personality (Sgt. Havoc, Ghost,
Captain Valor, Chaos, Strategist, Grumps) controlling aggression and aim
jitter; perception uses voxel-raycast line of sight (22m) with point-blank
hearing and 10s last-known-position memory; they advance until inside an
11m firing range (aggressive ones push to point-blank) and fire aim-aligned
bursts (30-round mags, 3s reloads, muzzle flash + light, ~8 damage with
distance-based hit chance). Three ball hits kill, with directional death
animations. NPC and prop sizes are derived at runtime from the corridor's
measured floor-to-ceiling clearance, so they adapt to the scan's scale.

The first-person viewmodel (arms + carbine) hangs under the camera with the
original FPS project's transform and time-slices its single `allanims`
track (idle / shoot / reload). Firing launches physics balls from the
barrel tip (the hidden muzzle-flash node marks the muzzle position). The
Ammo/Bullet wasm engine is registered via `pc.WasmModule` at startup so
rigidbody/collision components are usable.
