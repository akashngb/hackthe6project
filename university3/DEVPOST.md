# Splat-the-6ix

## Inspiration

We walk through Bahen and Myhal every day. Gaussian splatting can capture those spaces photorealistically from a phone scan — but every splat viewer treats the result as a museum piece: orbit, zoom, look, don't touch. We wanted the opposite. What if a scan of your school wasn't something you look *at*, but a level you play *in*? Scan a hallway between workshops, drop the file into the game, and be fighting waves of soldiers inside it minutes later — that's the whole thesis.

## What it does

Splat-the-6ix is **SIEGE**: a first-person wave shooter played inside real Gaussian-splat scans of the University of Toronto.

- **Six real campus locations** — Bahen's front entrance, main stairwell, second-floor hallway, a classroom, the 5th floor, and Myhal — connected by in-world portals, so you physically walk from the front door, up the stairs, and into the fight with seamless doorway-blink transitions.
- **Real collision inside the splats.** Every scene has a sparse-voxel-octree carve of the scan, so you walk on the actual floors, climb the actual stairs, and your shots bounce off the actual walls.
- **A full FPS loop**: viewmodel arms + carbine that fires physics balls, 30-round magazines with reloads, waves of soldier NPCs with distinct personalities, voxel-raycast line-of-sight, last-known-position hunting, and burst fire — three hits and they drop with directional death animations.
- **Reality editing**: label any object in the splat with the crosshair and delete it — the splats vanish (shader kill-spheres) *and* its collision is carved out, so you can shoot through the space where a desk used to be.
- **Drag-and-drop worlds**: drop a `.zip` (splat + voxel data) onto the page and it becomes a playable location instantly — unzipped in the browser with zero libraries.
- **Multiplayer presence**: teammates appear as live avatars walking the same scans, with shots replicated through our own WebSocket relay.
- **Photo-to-NPC**: feed the game photos of a person and a Meshy-powered pipeline generates a rigged 3D model of them that spawns into the world. Our whole team wanders the hallways as NPCs.
- Plus target practice, a supersplat-style collision-grid visualizer, crouch/jump/sprint/fly, 20 sound effects, and a shadcn-styled HUD.

## How we built it

- **Capture**: phone scans of campus → Gaussian splats (`.sog`), then `splat-transform` to carve each scan into a sparse voxel octree (5cm resolution) for collision.
- **Engine**: PlayCanvas (WebGL/WebGPU gsplat renderer). The entire game is one TypeScript "classic script" bundled with esbuild — walk controller, ball physics, NPC AI, scene manager, portals, multiplayer, UI — hot-deployed to the editor via its REST API on every build.
- **Collision**: a Laine–Karras-style octree walk with DDA raycasts and iterative capsule/sphere push-out. Balls use substepped swept collision (max ¾-radius travel per step plus a raycast along each substep) so 16 m/s rounds can't tunnel through one-voxel-thick walls.
- **NPCs**: personality-driven AI ported from a previous project — aggression/randomness parameters, voxel-raycast perception, 10-second target memory — with runtime bone-measured scaling and a reachability flood-fill so soldiers only spawn on floor the player could actually walk to (no spawning beyond railings).
- **Scene switching**: portals hot-swap the gsplat asset and mutate the shared collision grid in place; destinations are prefetched the moment you enter a scene, so crossings hide behind a 130ms blink.
- **Multiplayer**: a ~60-line Node WebSocket relay (PartyKit protocol) exposed through a Cloudflare tunnel; peers exchange 12Hz interpolated state and shot events.
- **Photo→NPC**: a Flask pipeline that enhances photos and drives the Meshy API to produce a rigged, game-ready GLB.
- **Testing**: three headless Node suites run the real bundle against the real voxel data — walking/jumping/wall-strafing regression, a 40-ball containment fuzzer, and a scene-flow test that teleports through every location asserting spawn heights and NPC rules.

## Challenges we ran into

- **Making splats solid.** A splat is a soup of translucent blobs with no surfaces. Getting player capsules, jumping, stairs, and ricocheting balls to feel right against a voxelized carve — without tunneling through one-voxel walls — took swept substepped physics and a fuzzer to prove it.
- **NPCs inside scans are hostile territory.** Skinned model bounds are garbage until animation runs, IK helper nodes poison measurements, and corridor-clearance rays that start inside solid geometry return zero — we got soldiers that were 40 meters tall, invisible, walking on ceilings, and 0.00m tall before landing on a deferred bone-measured fit pipeline.
- **Every scan is its own coordinate universe.** Floors at different heights per storey, spawn points inside walls, portals that bounce you back instantly — solved with storey-aware floor probing, reachability flood-fills, portal arming, and pinned per-scene spawns.
- **Platform walls**: 65MB assets that couldn't upload through normal tooling, a deploy platform that had run out of custom domains the day we needed it (we wrote our own relay and tunneled it), and browser caching that gaslit us for an hour.

## Accomplishments that we're proud of

- The **drop-a-zip-get-a-level** pipeline — the demo moment where any scanned room becomes a playable arena in one gesture.
- Shots that ricochet believably around real hallways, proven by a fuzzer: 40 high-speed balls, zero escapes.
- Walking from Bahen's front door up the real stairwell into a firefight with **no visible loading** anywhere.
- Our own team walking around inside our own scans as generated NPCs.
- A headless test harness for a game that lives inside a proprietary editor — every mechanic verifiable from the command line.

## What we learned

- Gaussian splats can be a *medium for gameplay*, not just visualization — but you have to build the physicality (collision, occlusion, line-of-sight) yourself.
- Voxel octrees are a great dual representation: one carve gives you walking, raycasts, AI perception, projectile physics, and a debug visualizer.
- Real scans are adversarial: assume every measurement (bounds, clearance, floor height) can be wrong and design fitting/spawning to recover.
- Owning your infrastructure (a 60-line relay over a managed platform) is sometimes the fastest path at a hackathon.

## What's next for Splat-the-6ix

- **Scan-to-level in one step**: run the voxel carve in-browser so a raw phone scan — no preprocessing — becomes a level.
- **True co-op sieges**: synced enemy waves and shared health, not just presence.
- **Crossfade portals**: render both splats during a crossing so transitions aren't even a blink.
- **Campus-scale world**: stitch every UofT building into one continuous siege map, and let players contribute scans of their own schools.
- **Smarter requisitioned NPCs**: generated teammates that fight alongside you with voice lines.
