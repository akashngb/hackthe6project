#!/usr/bin/env python
"""Render a textured GLB from 4 orbit views (front/right/back/left) with a
common orthographic camera, so different models are directly comparable.
Usage: render_glb.py <in.glb> <out_strip.png> [label]
"""
import sys, numpy as np, torch, trimesh
import nvdiffrast.torch as dr
from PIL import Image, ImageDraw

GLB, OUT = sys.argv[1], sys.argv[2]
LABEL = sys.argv[3] if len(sys.argv) > 3 else ""
DEV = "cuda"; RES = 512

sc = trimesh.load(GLB, process=False)
geom = list(sc.geometry.values())[0] if isinstance(sc, trimesh.Scene) else sc
V = np.asarray(geom.vertices, np.float32)
F = np.asarray(geom.faces, np.int32)
UV = np.asarray(geom.visual.uv, np.float32)
tex = np.asarray(geom.visual.material.baseColorTexture.convert("RGB"), np.float32) / 255.

# normalize: center X/Z, put feet at 0, scale to unit height
c = (V.max(0) + V.min(0)) / 2
V[:, 0] -= c[0]; V[:, 2] -= c[2]; V[:, 1] -= V[:, 1].min()
V /= (V[:, 1].max() + 1e-6)

UV = UV.copy(); UV[:, 1] = 1.0 - UV[:, 1]        # GLB uv origin is top-left -> flip v
Vt = torch.tensor(V, device=DEV); Ft = torch.tensor(F, device=DEV)
UVt = torch.tensor(UV, device=DEV); Tt = torch.tensor(tex, device=DEV)[None]
# per-vertex normals for shading
vn = torch.zeros_like(Vt); tri = Vt[Ft]
fn = torch.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0], dim=1)
for k in range(3):
    vn.index_add_(0, Ft[:, k], fn)
vn = torch.nn.functional.normalize(vn, dim=1)
glctx = dr.RasterizeCudaContext()


def render(azim_deg):
    a = np.radians(azim_deg)
    ca, sa = np.cos(a), np.sin(a)
    Ry = torch.tensor([[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]], device=DEV, dtype=torch.float32)
    p = (Vt - torch.tensor([0, 0.5, 0], device=DEV)) @ Ry.T   # center height, rotate
    n = vn @ Ry.T
    # ortho: x->clip x, y->clip y (scale 0.62 to fit arms/height), view along -Z
    sx = p[:, 0] / 0.62; sy = p[:, 1] / 0.62; sz = p[:, 2] / 2
    clip = torch.stack([sx, sy, sz, torch.ones_like(sx)], 1)[None].contiguous()
    rast, _ = dr.rasterize(glctx, clip, Ft, resolution=[RES, RES])
    uvi, _ = dr.interpolate(UVt[None], rast, Ft)
    alb = dr.texture(Tt, uvi, filter_mode='linear')[0]
    ni, _ = dr.interpolate(n[None], rast, Ft); ni = ni[0]
    shade = (0.45 + 0.55 * ni[..., 2].clamp(-1, 1).abs())[..., None]   # simple front-lit
    col = (alb * shade).clamp(0, 1)
    mask = (rast[0, ..., 3] > 0).float()[..., None]
    img = (col * mask + (1 - mask))  # white bg
    out = (img.cpu().numpy() * 255).astype(np.uint8)
    return np.flipud(out)             # nvdiffrast +y is up -> flip rows so head is up


views = [render(a) for a in (0, 90, 180, 270)]
strip = np.concatenate(views, axis=1)
im = Image.fromarray(strip)
if LABEL:
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 220, 22], fill=(0, 0, 0)); d.text((4, 5), LABEL, fill=(255, 255, 255))
im.save(OUT)
print(f"rendered {OUT}  ({LABEL})")
