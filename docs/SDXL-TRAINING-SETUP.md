# SDXL / Illustrious LoRA training — toolchain setup

Z-Image and Krea 2 LoRAs train via **Musubi Tuner** (`training-engine/.venv`). SDXL/Illustrious
LoRAs train via **kohya `sd-scripts`** in a **separate, isolated venv** so it can never disturb
Musubi's verified Blackwell torch (2.13.0+cu130). `training-engine/` is gitignored — this file is
the reproducible setup.

Verified working 2026-08-03 on RTX 5070 (12 GB, sm_120): a real 1-step SDXL LoRA run against
`waiIllustriousSDXL_v110.safetensors` completed and saved a valid adapter.

## Install (PowerShell, from `Z:\codex app`)

```powershell
git clone --depth 1 https://github.com/kohya-ss/sd-scripts.git training-engine\sd-scripts
py -3.10 -m venv training-engine\sd-scripts\.venv
$py = "training-engine\sd-scripts\.venv\Scripts\python.exe"
& $py -m pip install --upgrade pip
# Same Blackwell-compatible build as Musubi (reuses pip cache); do NOT let requirements downgrade it:
& $py -m pip install torch==2.13.0 torchvision --index-url https://download.pytorch.org/whl/cu130
# sd-scripts requirements do NOT pin torch, so this keeps the cu130 build:
Push-Location training-engine\sd-scripts; & .venv\Scripts\python.exe -m pip install -r requirements.txt; Pop-Location
```

## How the app uses it

- `getTrainingPaths()` points at `training-engine/sd-scripts/.venv` + `sdxl_train_network.py`.
- `missingTrainingFiles(paths, "illustrious")` gates training on those files — the LoRA Lab shows a
  clear "engine incomplete" message listing what's missing until this install is done.
- Base model = the user-selected Illustrious checkpoint in `checkpoints/` (SDXL loads its own
  VAE + both CLIPs from the single file, so no separate TE/VAE).
- Command (built in `musubi-training.ts`): `accelerate launch … sdxl_train_network.py
  --pretrained_model_name_or_path <ckpt> --network_module networks.lora --network_train_unet_only
  --sdpa --cache_latents --gradient_checkpointing --no_half_vae …` — UNet-only + cached latents
  keep it inside 12 GB. No block-swap needed (SDXL is smaller than Z-Image BF16).
- Presets (POC/Balanced/Detailed) and all tuning knobs (rank, steps, LR, scheduler, optimizer,
  grad-accum, repeats) apply to SDXL exactly as they do to Z-Image/Krea.

## Notes / limits

- `triton not found` warnings are harmless on Windows (SDPA attention is used, not triton).
- First step is slow (checkpoint load + latent cache); steady-state s/it is much lower — judge
  speed from the telemetry after ~10 steps, not step 1.
- The saved LoRA is standard kohya SDXL format — directly usable in Photo mode / ComfyUI, no
  conversion step (unlike Z-Image, which runs `convert_lora.py`).
