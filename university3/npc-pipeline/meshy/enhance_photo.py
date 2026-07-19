#!/usr/bin/env python
"""Local, adaptive photo enhancement for 3D-capture inputs.
Fixes uneven/baked lighting AT THE SOURCE so the model doesn't come out dark:
  1. gray-world white balance (neutralize color cast)
  2. de-shadow: divide luminance by its large-blur (homomorphic flat-field) -> lifts
     local shadows (cap-brim on face, arm-ends) that global exposure match can't touch
  3. CLAHE on L (adaptive local contrast) -> even, punchy tone
  4. gentle gamma lift + saturation boost
Fast, CPU, no model. enhance_bgr(img)->img ; enhance_file(in,out).
"""
import cv2, numpy as np


def _grayworld(bgr):
    b, g, r = cv2.split(bgr.astype(np.float32))
    mb, mg, mr = b.mean() + 1e-6, g.mean() + 1e-6, r.mean() + 1e-6
    k = (mb + mg + mr) / 3.0
    out = cv2.merge([np.clip(b * k / mb, 0, 255),
                     np.clip(g * k / mg, 0, 255),
                     np.clip(r * k / mr, 0, 255)])
    return out.astype(np.uint8)


def enhance_bgr(bgr, deshadow=0.55, clahe_clip=1.2, gamma=0.9, sat=1.08, work=1400):
    # work at a bounded resolution so the illumination blur is fast & scale-invariant
    h0, w0 = bgr.shape[:2]
    if max(h0, w0) > work:
        s = work / max(h0, w0)
        bgr = cv2.resize(bgr, (round(w0 * s), round(h0 * s)), interpolation=cv2.INTER_AREA)
    bgr = _grayworld(bgr)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, A, B = cv2.split(lab)
    # de-shadow: illumination = blur of L computed on a tiny copy (fast), then upscaled
    small = cv2.resize(L, (0, 0), fx=0.12, fy=0.12, interpolation=cv2.INTER_AREA)
    illum = cv2.resize(cv2.GaussianBlur(small, (0, 0), sigmaX=small.shape[1] / 6.0),
                       (L.shape[1], L.shape[0]))
    Lf = L / (illum + 1e-6) * float(np.mean(illum))
    Lf = L * (1 - deshadow) + Lf * deshadow
    Lf = np.clip(Lf, 0, 255).astype(np.uint8)
    # CLAHE local contrast
    Lf = cv2.createCLAHE(clipLimit=clahe_clip, tileGridSize=(8, 8)).apply(Lf)
    # gentle gamma lift on shadows/mids
    Lf = np.clip(255.0 * (Lf / 255.0) ** gamma, 0, 255).astype(np.float32)
    out = cv2.cvtColor(cv2.merge([Lf, A, B]).astype(np.uint8), cv2.COLOR_LAB2BGR)
    # saturation boost
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def enhance_file(inp, outp, on_white=True):
    """Enhance; if on_white, rembg the subject onto white (Meshy bg-removes anyway)."""
    bgr = cv2.imread(inp)
    out = enhance_bgr(bgr)
    if on_white:
        try:
            from rembg import remove, new_session
            from PIL import Image
            if not hasattr(enhance_file, "_s"):
                enhance_file._s = new_session("u2net")
            rgb = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
            rgba = np.array(remove(Image.fromarray(rgb), session=enhance_file._s).convert("RGBA"))
            mask = rgba[..., 3:4] > 128
            comp = np.where(mask, rgba[..., :3], np.uint8(255))
            out = cv2.cvtColor(comp, cv2.COLOR_RGB2BGR)
        except Exception:
            pass
    cv2.imwrite(outp, out)
    return outp


if __name__ == "__main__":
    import sys
    enhance_file(sys.argv[1], sys.argv[2], on_white=("--nowhite" not in sys.argv))
    print("enhanced ->", sys.argv[2])
