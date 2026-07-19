# NPC Pipeline — photo → T-pose GLB

Turn phone photos of a person into a game-ready **T-pose GLB** (4K PBR) via the Meshy API,
with a browser demo that requisitions the character in the background and drops it into an arena.

## Setup
```bash
pip install -r requirements.txt
cp .env.example .env        # then paste your Meshy API key (meshy.ai → API)
# or: export MESHY_API_KEY=msy_...
```

## Use it — 3 ways

**1. CLI** — a folder of photosets (each subfolder = one person) → GLBs in `out/`:
```bash
python meshy/batch.py path/to/photos      # or a single flat folder of one person's photos
```

**2. Library** — call it from code:
```python
from meshy.ingest import generate
r = generate(["front.jpg", "left.jpg"], name="grunt_01")
# r -> {"status":"SUCCEEDED","glb":".../grunt_01.glb","credits":30, ...}
```

**3. HTTP service + browser demo** (one port):
```bash
python meshy/server.py 8799          # serves the game at /  and the API at /npc/*
# open http://localhost:8799/  → "Requisition Unit" → pick photos → drops in when ready
```
The game's "Add NPC" flow = `POST /npc/generate` (multipart `name` + `images`) → poll
`GET /npc/status/<id>` → `GET /npc/download/<id>` (the .glb).

## Config (top of `meshy/batch.py`)
| Knob | Default | Meaning |
|---|---|---|
| `N_IMAGES` | `1` | **solo** (best/cleanest). 2–4 = multi-image (360° coverage, riskier texture) |
| `POSE_MODE` | `t-pose` | `""` keeps captured pose; `a-pose`/`t-pose` |
| `HD_TEXTURE` | `True` | 4K base color (API max) |
| `SHOULD_REMESH` | `False` | keep max polycount |
| `ENHANCE_INPUTS` | `False` | local de-shadow/CLAHE (only helps multi-image; solo needs none) |
| `TEXTURE_PROMPT` | `""` | optional color anchor |

`meshy/enhance_photo.py` is the standalone lighting-fix toolkit (used only when `ENHANCE_INPUTS=True`).

## Notes
- **Solo (1 photo) gives the cleanest result** — multi-image fusion is what introduces darkening/artifacts.
- Preview a GLB from 4 angles: `python meshy/render_glb.py model.glb out.png` (needs a CUDA GPU: `torch` + `nvdiffrast`).
- Backend is swappable: `generate()` could call a **local** model (TRELLIS/Hunyuan3D) instead of Meshy for offline/free.
- `meshy/webhook_server.py` is an optional event-driven receiver (Meshy `webhook_url`) for when you don't want to poll.

## Files
```
meshy/batch.py          CLI + core (select → [enhance] → submit → poll → download)
meshy/ingest.py         generate() library entrypoint
meshy/server.py         HTTP service (serves game + API)
meshy/enhance_photo.py  local lighting/de-shadow toolkit
meshy/render_glb.py     4-angle GLB preview (GPU)
meshy/webhook_server.py optional webhook receiver
demo/                   three.js arena + SIEGE/Helldivers requisition HUD
```
