# Plan — Improve / Enhance from a generated image (NovelAI-style)

Status: **MVP + Refine mode shipped** · Research grounded in NovelAI docs + ComfyUI core nodes.  
Project: Z-Image Studio (`Z:\codex app`) · 2026-08-01.  
Related: [[IMAGE-TO-IMAGE-PLAN]] (classic img2img substrate).

---

## What NovelAI does (source of truth)

From [Enhance](https://docs.novelai.net/en/image/enhance/) and [Strength & Noise](https://docs.novelai.net/en/image/strengthnoise/):

| Concept | NovelAI behavior |
| --- | --- |
| **Enhance** | Pass a **generated** image through diffusion a **second** time to improve it, still guided by the **text prompt**. Not the same as pure upscale. |
| **Magnitude** | Preset combinations of Strength + Noise; optional “individual settings.” |
| **Strength** | How much the AI may **change** the init image / obey the prompt rewrite. Low = stick to original; high = free reinterpret. |
| **Noise** | Extra freedom to **add detail** (e.g. fill empty regions). High noise can create artifacts if overused. |
| **Upscale amount** | Optional resolution increase **while** enhancing (separate from dedicated Upscale tool). |
| **Goose tip** | Strength+Noise at minimum ≈ near-copy of the image; Enhance still re-samples with prompt influence at normal values. |

Image2Image / upload path uses the same Strength & Noise pair; Enhance is the productized “select result → improve” UX on top of that engine.

---

## Studio mapping (honest ComfyUI)

True Enhance = **img2img** on the selected gallery PNG, not Pose/Structure refs and not Face polish alone.

```text
LoadImage (init = selected generation or upload)
  → ImageScale to target canvas (optionally larger for “upscale amount”)
  → VAEEncode (architecture-correct VAE)
  → KSampler(latent = encoded, denoise ≈ Strength)
  → VAEDecode → optional Face polish / neural upscale → exact Lanczos → SaveImage
```

| NovelAI | Studio / Comfy (MVP) |
| --- | --- |
| Strength | KSampler **`denoise`** (0.05–1.0). Default enhance presets ~0.25–0.55. |
| Noise | **Detail freedom** blended into effective denoise: `min(1, strength + noise * 0.2)` so high noise invites more rewrite/detail without a custom noise-inject node. Stored separately on the record for UI/reuse. |
| Magnitude | UI presets: Subtle / Mild / Medium / Strong → fixed (strength, noise) pairs. |
| Upscale amount | Phase 2: multiply width/height (cap 2048) before encode; MVP keeps same canvas. |
| Dedicated Upscale | Existing **Neural detail upscale** (ESRGAN catalog) — leave separate. |
| Face polish | Optional post-pass; not a substitute for Enhance. |

No new custom nodes. No edits to `extra_model_paths.yaml`. No cloud APIs.

### Per-architecture VAE for encode (same as decode)

| Family | VAE ref | Works? |
| --- | --- | --- |
| Z-Image | `["3", 0]` Flux AE | Yes |
| Krea 2 | `["3", 0]` Qwen Image VAE | Yes |
| Illustrious | `["1", 2]` checkpoint VAE | Yes |
| Anima | `["3", 0]` Qwen Image VAE | Yes |

All four already share KSampler + EmptyLatentImage node **`6`**. Img2img rewires **`6`** into LoadImage → Scale → VAEEncode and sets KSampler `denoise` from Strength.

Default **`denoise: 1`** + no init image remains pure txt2img.

---

## Product UX (NovelAI-like)

1. User generates normally (txt2img).
2. Selects a completed Photo result (canvas or gallery).
3. Clicks **Improve** (Enhance).
4. Studio:
   - Reuses prompt / negative / model / LoRAs / steps / CFG / sampler from that record.
   - Sets init image = that PNG (server copies Comfy **output** → `input/z-image-studio/` for LoadImage).
   - Shows **Magnitude** presets + optional Strength / Noise sliders.
   - New seed by default (or keep seed toggle later).
5. Generate produces a **new** gallery record (source + strength/noise stored).

Optional later: freeform Source image upload for classic img2img (IMAGE-TO-IMAGE-PLAN).

---

## Implementation checklist

### Schema (`generationSchema`)

- `initImage?: string` — safe relative path under Comfy input (`z-image-studio/...`).
- `img2imgStrength: number` default **1** (txt2img when 1 and no init required).
- `img2imgNoise: number` default **0**, range 0–1.
- Refine: if `img2imgStrength < 1` then `initImage` required; if `initImage` set and strength omitted, default strength **0.4**.

### Helper `applyImg2ImgLatent(workflow, ctx)`

- Node band **40–42** (avoid LoRA 20+, refs 90+/100+, face 189+, upscale 300+).
- `40` LoadImage, `41` ImageScale (lanczos, crop center, target w/h), `42` VAEEncode.
- Replace or repoint sampler latent: prefer rewrite node **`6`** as passthrough alias or set `KSampler.latent_image` → `["42",0]` and remove empty latent inputs.
- Effective denoise = `clamp(strength + noise * 0.2, 0.05, 1)`.

### Builders

Call helper at end of latent setup for Anima, Illustrious, Z-Image/Krea `buildWorkflow`, and consistent-character path if it reuses the same sampler.

### API `POST /api/generate`

- Accept `initImage` path and/or `sourceFilename` + `sourceSubfolder` + `sourceType=output` to copy gallery output into input.
- Accept `img2imgStrength`, `img2imgNoise` as numbers.
- Persist on record: `initImage`, `img2imgStrength`, `img2imgNoise`.

### UI

- **Improve** on selected completed photo.
- When init active: show Magnitude + Strength + Noise; disable or hide when pure txt2img.
- Clear copy: “Re-samples this image with your prompt (NovelAI-style Enhance). Not Pose/Structure reference.”

### Tests

- No init → EmptyLatentImage + denoise 1.
- Init + strength 0.4 → VAEEncode present, denoise effective ≈ 0.4.
- Strength 0.5 + noise 0.5 → denoise ≈ 0.6.
- Reject strength &lt; 1 without init.
- One smoke per architecture builder.

### Explicit do-not

- Don’t replace reference guidance with Improve.
- Don’t change default txt2img denoise away from 1.
- Don’t claim bit-identical NovelAI Noise (no proprietary dual-noise path).
- Don’t require custom nodes.
- Don’t overwrite model files.

---

## Modes (UI) — 2026-08-01 refine pass

User feedback: default Medium rewrite drifted pose without cleaning anatomy/detail.
**Default is now Refine**, not free rewrite.

| Mode | Intent | Strength range | Noise | Structure lock | Seed | Face polish |
| --- | --- | --- | --- | --- | --- | --- |
| **Refine** (default) | Fine-tune satisfactory images: face, anatomy, light, detail | Soft 0.18 / **Refine 0.25** / Polish 0.32 (hard-cap denoise ≤0.38) | ~0.02–0.08 | **On** (Canny/depth/LLLite from init) | **Keep original** | On by default |
| **Rewrite** | Freer reinterpret (old Enhance style) | Mild 0.35 / Medium 0.45 / Strong 0.60 | higher | Off by default | user choice | optional |

### Structure lock (why pose held)

Low denoise alone helps; pairing the **same canvas** as structure control is the Comfy/Civitai-style fix for “fix without moving limbs”:

| Architecture | Lock path |
| --- | --- |
| Z-Image | Canny → Fun ControlNet Union (`QwenImageDiffsynthControlnet`) |
| Illustrious | Canny → SDXL Canny ControlNet |
| Anima | Canny → LLLite lineart |
| Krea 2 | Depth Anything → depth ControlLoRA |

### Prompt principles (user-facing)

- Leave the **same prompt**; do not rewrite composition/pose tags.
- Prefer quality/anatomy wording only if you already use it in the family style.
- High Strength + new seed = pose lottery (Rewrite only).

---

## Verification

```powershell
Set-Location "Z:\codex app"
npm test
npm run build
```

Manual: txt2img unchanged; Improve on a completed Z-Image and one Illustrious result with Medium magnitude.

---

## Phase 2 (later)

- Enhance upscale amount (1.5× / 2× canvas cap 2048).
- True latent noise inject if a core-safe node appears.
- Freeform Source upload panel (full img2img without gallery).
- Inpaint (NovelAI Canvas) — separate plan.

---

## Sources

- https://docs.novelai.net/en/image/enhance/
- https://docs.novelai.net/en/image/strengthnoise/
- https://docs.novelai.net/en/image/controltools/
- ComfyUI core: `LoadImage`, `ImageScale`, `VAEEncode`, `KSampler` denoise
