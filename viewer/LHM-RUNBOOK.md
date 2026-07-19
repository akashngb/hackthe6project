# LHM run guide (image → animatable gaussian avatar)

## Reality check first

- **LHM is CUDA-only.** Needs an NVIDIA GPU on **Linux or Windows**. Not macOS, not
  Apple Silicon. A "Mac with an NVIDIA GPU" will NOT run CUDA — confirm it's a
  Linux/Windows PC.
- **VRAM:** LHM-MINI ~16GB · LHM-500M ~24GB · LHM-1B ~24GB (memory-saving variant ~14GB).
- **Output is NOT a .glb.** LHM produces an animatable **3D Gaussian Splatting**
  avatar (`.ply` gaussians bound to a SMPL-X rig) + a rendered **video**. To view on
  the web you need a gaussian-splat renderer, not the GLB viewer in this folder.
  A rigged .glb would require a separate gaussian→mesh + rig step.

---

## Path A — Fastest, no install (browser)

Hosted demo, runs on their GPU:

- **HF Space:** https://huggingface.co/spaces/3DAIGC/LHM
  Upload a photo (half- or full-body), pick a driving motion, run.
  Note: this Space needs **paid GPU credits** (not free tier).
- **ModelScope Space (free-ish, 500M model only):** search "LHM" on modelscope.cn.

Use this to judge quality before committing to a full local run.

---

## Path B — Full run on an NVIDIA Linux box (verbatim commands)

```bash
# 1. clone
git clone git@github.com:aigc3d/LHM.git
cd LHM

# 2. install (tested with python3.10, CUDA 11.8 or 12.1)
sh ./install_cu121.sh

# 3. weights — auto-download on first run, or fetch manually:
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='3DAIGC/LHM-1B-HF', cache_dir='./pretrained_models/huggingface')"
# prior model (required):
wget https://virutalbuy-public.oss-cn-hangzhou.aliyuncs.com/share/aigc3d/data/LHM/LHM_prior_model.tar
tar -xvf LHM_prior_model.tar

# 4. inference: single image + motion sequence -> animated avatar
#    MODEL_NAME one of: LHM-MINI | LHM-500M | LHM-500M-HF | LHM-1B | LHM-1B-HF
bash inference.sh LHM-1B-HF ${IMAGE_PATH_OR_FOLDER} ${MOTION_SEQ}
# example with bundled data:
bash inference.sh LHM-1B-HF ./train_data/example_imgs/ ./train_data/motion_video/mimo1/smplx_params

# 5. mesh export (undocumented format — inspect the output; likely OBJ/PLY, not rigged GLB)
bash ./inference_mesh.sh LHM-1B-HF
```

### Notes
- `-HF` variants (LHM-500M-HF / LHM-1B-HF) support **half-body** photo input and are
  more stable. That's the one on Hugging Face you found.
- To make your own `MOTION_SEQ` from a video:
  `python ./engine/pose_estimation/video2motion.py --video_path VIDEO --output_path OUT`
- First run downloads several GB of weights — expect a slow first pass.

---

## After you have output

- Gaussian `.ply` → view with a web gaussian-splat renderer (e.g. a Three.js /
  PlayCanvas splat viewer, or the SuperSplat / gsplat web viewers).
- If you decide you need a **.glb** for the standard three.js viewer in this folder,
  that's a separate conversion (gaussian → mesh → SMPL-X rig). Decide whether the
  web target is splats or GLB before investing in that.
