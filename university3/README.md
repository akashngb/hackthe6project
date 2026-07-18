# University 3 — walkable Gaussian splat hallway

Everything that powers the "Hack the 6ix" PlayCanvas project
(editor scene **2551548**): first-person walking with real collision inside
the University 3 Gaussian splat scan, a ball-physics playground, object
labeling/removal, animated soldier NPCs, and the Mega Knight prop.

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
| click | grab mouse (look) |
| WASD / arrows | walk · Shift run · Space jump |
| R | respawn |
| Y | toggle fly mode (E/Q up/down, Shift fast) |
| G | throw a physics ball · C clear balls |
| X | label object under crosshair |
| V | remove/restore aimed labeled object (splats vanish + collision carved) |
| [ / ] | shrink / grow aimed label sphere |
| L | toggle labels · Backspace delete label |

Soldiers wander with idle/walk animations, hold M16s with periodic muzzle
flashes, take 3 ball hits to kill (directional death animation), respawn
after ~6s. NPC and prop sizes are derived at runtime from the corridor's
measured floor-to-ceiling clearance, so they adapt to the scan's scale.
