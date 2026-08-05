# Z-Image Studio

A local-first, beginner-friendly interface for generating Z-Image Turbo images and SCAIL-2 motion-driven videos through an existing ComfyUI installation.

## Quick start

Double-click the **Z-Image Studio** desktop shortcut. It starts the private ComfyUI backend and the Studio interface, waits for both to become ready, and opens the application.

The installed backend uses current ComfyUI, Python 3.13, PyTorch 2.13, and CUDA 13.0. Its private environment is under `ComfyUI\.venv`.

For a production-style local run:

```powershell
npm run build
npm start
```

Then open `http://127.0.0.1:3199`.

## Model placement

The supplied files remain at the project root. `ComfyUI\extra_model_paths.yaml` registers them in the correct loader categories without copying, renaming, or moving them:

```text
Z:\codex app\zImageTurbo_turbo.safetensors
Z:\codex app\qwen3_4b.safetensors
Z:\codex app\flux1AE_v10.safetensors
```

These names are the verified local Civitai releases. Official ComfyUI releases use different filenames for equivalent model types. Do not rename a file merely to match the example; select its actual name in Setup.

## What the connection test checks

- `/system_stats` and `/object_info` respond.
- All required core nodes are registered.
- The configured filenames appear in each loader's options.
- The stored API workflow is structurally ready.

The test deliberately does not submit a real generation: ComfyUI has no dry-run prompt endpoint, and submitting the 20+ GB workflow would begin an expensive generation. The first **Generate** action performs definitive server-side workflow validation.

## LoRA stack

Place Z-Image-compatible `.safetensors` adapters in `Z:\codex app\lora`, then restart Z-Image Studio so ComfyUI refreshes its loader list. The LoRA stack in the left sidebar can:

- Add any discovered adapter once.
- Apply several adapters in order.
- Set an independent model strength from `-2` to `2`.
- Remove an adapter without affecting the others.
- Restore the exact stack and strengths with **Reuse settings**.

The app uses ComfyUI's core `LoraLoaderModelOnly` node because the verified Z-Image adapters patch diffusion-model weights and contain no text-encoder weights. LoRAs are chained before `ModelSamplingAuraFlow`. Filenames are checked against ComfyUI's live loader list before every submission.

## LoRA Lab

Choose **Train LoRA** in the Studio to build an adapter from local pictures. You can select
individual images or an entire folder, remove images, and edit the caption for each one. Give the
concept a distinctive trigger phrase, select a compatible generation model, choose a
quality preset, and press **Start LoRA training**.

Training uses an isolated Musubi Tuner environment under `training-engine` and the dedicated
`training-models\z_image_bf16.safetensors` Base checkpoint. It does not change ComfyUI's Python
environment or replace any generation model. The pipeline automatically:

1. Fits images into aspect-ratio buckets and caches VAE latents.
2. Caches Qwen3 caption embeddings.
3. Trains with batch size 1, FP8 model loading, gradient checkpointing, CPU activation offload,
   and 28 swapped transformer blocks for the 12 GB GPU.
4. Converts the result to ComfyUI format and installs it in `Z:\codex app\lora`.

For a person or object, 12–30 clear, varied pictures is the practical starting point (three is
allowed for a quick test). For a broad style, use roughly 30–100 curated pictures. Avoid duplicates,
watermarks, heavy blur, and many nearly identical angles. Finished jobs have a **Use in Photo mode**
button and remain ordinary removable LoRA entries in the Photo stack.

Z-Image adapters train on Z-Image Base and are converted for ComfyUI. Krea 2 adapters train on
**Krea 2 Raw**, as required by the official Musubi workflow, and can then be used with Krea 2
Turbo. The local Krea pipeline was verified through caching, a real backward pass, adapter
installation, and Turbo inference. Its separate training files are:

```text
Z:\codex app\training-models\raw.safetensors
Z:\codex app\training-models\qwen3vl_4b_bf16.safetensors
```

The BF16 encoder is required because Musubi cannot use ComfyUI's scaled-FP8 `comfy_quant` layout.
The generation encoder remains unchanged. LoRA Lab shows architecture, training base, target
model, estimated working storage, the conservative 12 GB profile, exact local commands, and a
live log before and during training.

The LoRA compatibility manager records architecture and verification rather than relying on a
filename guess. Unknown and incompatible adapters remain visible for correction but cannot be
loaded until they are assigned and verified for the active model family.

## Character profiles

Photo mode can save reusable local character profiles containing a trigger token, stable identity,
hair, eyes, body traits, default outfit, changeable attributes, notes, preferred model, identity
weight, and Studio reference paths. Profiles can be reused in Photo mode and Dataset Builder.

## Dataset Builder

Choose **Build Dataset** to turn one master character image into a captioned 12, 24, or 40-image
training set. The 40-image plan covers close-ups, profiles, expressions, waist-up views, seated
and standing compositions, walking poses, and full-body shots. Results and matching captions are
saved under `Z:\codex app\data\datasets\<dataset-id>\images`.

Krea 2 Identity Edit is the strongest installed one-image identity path and is selected by default.
Z-Image can use its native structural ControlNet as a fallback, but it preserves identity less
reliably. A finished dataset opens in **Review and prepare dataset**; the review's Continue action
hands only approved images and current captions to LoRA Lab.

The prompt matrix can vary angles, framing, expressions, poses, scenes, lighting, outfits, and
backgrounds. The review workspace supports Keep/Reject/Uncertain states, bulk actions, keyboard
navigation, structured captions and caption strategies, manual warning tags, exact/perceptual
duplicate flags, blur/low-resolution flags, category statistics, and versioned local exports with
train/validation splits, bucket summaries, trainer configuration, and source metadata. Automated
checks only flag candidates; they never delete or silently reject an image.

Review is the required handoff to LoRA Lab. Caption changes save automatically. Local PNG, JPEG,
or WebP images can be added to a completed dataset and enter as **Unsure** until reviewed.
**Remove from training** is reversible and preserves the source image for audit. Only images marked
**Keep for training** and their latest saved captions enter LoRA Lab. At least three kept images
are required before continuing; 12–30 varied images are recommended.

## Fine Tune controls

- **CFG scale** maps to KSampler `cfg` and defaults to the official Z-Image Turbo value of `1`.
- **Quantity** maps to latent batch size. PNG saves each batch image separately.
- **Priority** maps to ComfyUI queue ordering: Next uses `front`, Normal uses default ordering, and Low uses a deferred queue number.
- **Output format** supports native PNG or native animated WebP. With WebP and quantity above one, the batch becomes frames in one animation.
- The high-quality Portrait preset is `1080 × 1920` (9:16), and Cinema is `1920 × 1080` (16:9). A core Lanczos `ImageScale` node after VAE decoding guarantees the exact saved size.
- **Neural detail upscale** runs a curated local 4× model after decoding, then uses Lanczos to
  return to the exact requested canvas. Shared by **all** Photo architectures (Z-Image, Krea 2,
  Illustrious, Anima). Off by default. Catalog:
  - **Real-ESRGAN x4 Plus** — photoreal portraits/products (default for Z-Image/Krea)
  - **4x UltraSharp** — sharper product/fabric texture
  - **Real-ESRGAN Anime 6B** — anime/cel (default for Illustrious/Anima)
  - **Remacri x4** — illustration polish (noncommercial license)

## Studio interface

The desktop workspace is organized around three clear areas: creation controls, the active canvas
and recent work, and queue/generation details. Photo, Video, Dataset, and LoRA Lab remain available
from one persistent mode switch. The Generate action stays visible at the bottom of the creation
panel while its longer model, character, reference, and fine-tune sections scroll independently.
At narrower widths the queue and details move below the canvas, and mobile layouts become a single
column without horizontal scrolling.

## Photo reference guidance

Photo mode accepts up to four reference images. Every reference can be removed independently, switched between two guidance modes, and weighted from `0` to `2`:

- **Pose only** runs the reference through native SDPose Wholebody, drawing body, hand, face, and foot keypoints. Clothing, identity, and background are not intentionally copied.
- **Direct copy** extracts Canny edge structure. It preserves more silhouette, framing, and composition while the prompt still determines the resulting subject and style.

Each reference is center-fitted to the selected output canvas before preprocessing. The app chains the weighted controls through the official Z-Image Turbo Fun ControlNet Union before AuraFlow sampling.

The Krea 2 profile uses a separate, architecture-matched reference path:

- **Pose only** runs Depth Anything V2 and the Krea 2 Depth Control LoRA. It follows body placement,
  camera angle, depth, and composition, but is less exact on hands than Z-Image SDPose.
- **Direct copy** runs Krea 2 Identity Edit v1.2 with grounded Qwen3-VL conditioning and aspect-ratio
  fitting. It supports one or two references and preserves identity and appearance more strongly.

Krea accepts one active Pose reference or up to two active Direct Copy references. These adapters are
applied only inside Krea generations and do not patch or replace the Z-Image workflow.

For reliable pose adherence, use the standard nine-step ControlNet setting and describe the desired pose in the prompt as well. Multiple references can compete when they describe incompatible poses, so use one strong pose reference and lower-weight structure references as the normal starting point.

Enable **Character Consistency** to opt into the modular character workflow while leaving normal
Photo generations unchanged. Use one Identity/Direct image as the master character and a Pose
reference for body placement. Optional **Face polish** sends the decoded image through Impact
Pack's Face Detailer at denoise `0.40`, using the installed YOLO face detector. When enabled, the
polished image is the only saved output (same SaveImage path as a normal generation).

The supplied IP-Adapter/OpenPose topology is an SD/SDXL convention and cannot safely be attached
unchanged to Z-Image or Krea 2. The Studio uses architecture-native equivalents: Krea Identity
Edit for identity, Krea Depth or Z-Image SDPose/ControlNet for pose, and Impact Pack for facial
refinement. Control strength is supported; these native adapters do not expose ControlNet's
SDXL-style ending-percent input.

## SCAIL-2 video mode (image → motion video)

Choose **Video** at the top of the Create panel — or open a completed Photo and click **Animate with SCAIL**.

### Recommended social path (30 fps · 9:16 ~720p)

1. **Photo** — generate your character (Krea/Z-Image) as a clear full-body or waist-up still.
2. **Animate with SCAIL** on that result (or Video → “Use selected photo as character”).
3. Upload a **driving motion video** (single subject, clear body motion).
4. Task: **Animation**. Masks: **automatic SAM 3.1** (default).
5. Canvas: **9:16 ~720p** (704×1280). SCAIL needs sides ÷32 — true 720 is invalid; 704p is the official HD class.
6. Motion: **30 fps · ~1 s** (29 frames) first; raise to 61/81 frames only if VRAM allows.
7. Prompt: describe the finished video (identity, clothes, action, place) — not “make her copy this dance.”
8. Generate MP4.

Animation preserves the reference character; Replacement places that character into the driving performance.

Automatic preprocessing uses the bundled SAM3 nodes to create identity-aware masks. Turn it off to upload a reference mask and driving-mask video yourself. Black removes background, white preserves it, and matching colors identify subjects.

Video models live separately from photo models:

```text
Z:\codex app\video-models\diffusion_models\wan2.1_14B_SCAIL_2_mxfp8.safetensors
Z:\codex app\video-models\text_encoders\umt5_xxl_fp8_e4m3fn_scaled.safetensors
Z:\codex app\video-models\vae\Wan2_1_VAE_bf16.safetensors
Z:\codex app\video-models\clip_vision\clip_vision_h.safetensors
Z:\codex app\video-models\checkpoints\sam3.1_multiplex_fp16.safetensors
```

Default model: official lower-memory **MXFP8**. On 12 GB VRAM, prefer 576×1024 or 512×896 before long 704×1280 clips. Keep the desktop shortcut as the normal launcher.

If Video says setup is incomplete, wait for the readiness panel refresh, verify ComfyUI at `http://127.0.0.1:8188`, then restart the desktop shortcut after adding models.

## Safety

The server binds to `127.0.0.1`. It accepts only local ComfyUI URLs, uses fixed application-owned workflows, validates dimensions and filenames, probes uploaded media before use, blocks output traversal, and never deletes ComfyUI outputs. “Delete app record” only removes the gallery record.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/RESEARCH.md](docs/RESEARCH.md) for implementation, compatibility, VRAM, API, licensing, and workflow findings.

For AI-assisted maintenance, [CLAUDE.md](CLAUDE.md) is the required engineering handoff. It records
the system boundaries, UI intent, dataset and LoRA invariants, destructive-action semantics, common
failure modes, and verification contract that must be preserved.

## Maintenance commands

Run these from `Z:\codex app`:

```powershell
# One real 512×512 generation; skips clearly when local services are stopped
npm run smoke

# Opt-in cleanup of old JSON sidecars and oversized logs
npm run prune
```

Pruning defaults to `outputs\*.json` older than 30 days and `logs\*.log` above 10 MB. Override
those limits with `Z_IMAGE_PRUNE_DAYS` and `Z_IMAGE_LOG_MAX_BYTES`. It never removes generated
images, datasets, LoRAs, or application state.
