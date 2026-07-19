# GLB + Splat Viewers

Standalone three.js (r185) test harnesses for inspecting the two output types the
pipeline produces, before wiring them into anything:

- **`index.html`** — GLB rig viewer. Confirms an asset is genuinely riggable
  (skinned mesh + bones) and plays its animation clips. For mesh models
  (TRELLIS / PSHuman / Meshy → GLB).
- **`splat.html`** — Gaussian splat viewer (`.ply` / `.splat` / `.ksplat`, via
  @mkkellogg/gaussian-splats-3d). For gaussian models (LHM / TRELLIS → `.ply`).

Independent of the PlayCanvas project in the repo root — touches nothing there.

> **Splat viewer note:** built but not browser-tested in this environment. If a
> `.ply` won't render, drag it onto **https://superspl.at** instead — PlayCanvas's
> hosted splat viewer/editor, zero setup and matches the engine you're using.

## Run

ES modules need to be served over HTTP (not `file://`). From the repo root:

```
python3 -m http.server 8000
# then open http://localhost:8000/viewer/
```

or with Node:

```
npx serve .
# open the printed URL, then /viewer/
```

On open it auto-loads a sample rig from the repo (`files/assets/.../soldier2.glb`)
so you can confirm the harness works before touching your own output. Serve from
the **repo root** (not `viewer/`) so that relative path resolves.

## Use

- **Drag a `.glb` / `.gltf` onto the window**, or use the file picker.
- `?url=<path-or-URL>` auto-loads a file, e.g.
  `http://localhost:8000/viewer/?url=https://models.readyplayer.me/<id>.glb`
- The panel reports the acceptance checklist for a movable human:
  - **skinned mesh** — `yes` means it will deform. `no` = static, not riggable as-is.
  - **bones** — skeleton joint count.
  - **animations** — clip count; pick clips from the dropdown.
  - **morph targets** — for facial/blendshape animation.
- Buttons: play/pause, show skeleton (SkeletonHelper overlay), wireframe, reframe.

## What to look for with LHM / TRELLIS output

- **LHM** should come out with `skinned mesh: yes` and a bone count — that's the
  win (image → rigged human in one shot).
- **TRELLIS / PSHuman** will show `skinned mesh: no` — expected, they produce a
  static mesh. That's the input to the SMPL-X rigging step, not the final asset.

Compression (DRACO, KTX2, meshopt) is handled via CDN decoders, so compressed
exports load without extra setup.
