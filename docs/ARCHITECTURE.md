# Z-Image Studio architecture

## Local registries and character workflow

The native Prompt Engine is implemented in `server/src/prompt-engine.ts`. Its atomic
`data/prompt-library.json` store is seeded from the formal vault library and indexed through a thin
localhost REST surface. It serializes natural-language prose for Z-Image/Krea 2 and tag prompts for
Illustrious, proposes architecture-compatible LoRAs from library links/registry keywords, and
validates conflicts before the existing Photo submission path. It does not run a PromptLens Python
service or perform inference.

Character preset records live in `data/character-presets.json`. They point to tagged face/body/pose
references and confirmed LoRAs, then produce either Prompt Engine input or a Dataset Builder handoff.
They remain an on-ramp to existing LoRA training, not a replacement identity system.
Preset uploads use randomized filenames in the existing guarded Studio input directory and persist
only safe relative paths. Body references map to structural/direct guidance, not Face guidance.
Removing a preset association or preset record preserves the uploaded source image.

`server/src/model-adapters.ts` is the architecture boundary for Z-Image, Krea 2, and Illustrious XL defaults and
training bases. Existing workflow builders remain architecture-specific. `lora-registry.ts`
stores verified adapter compatibility; unknown legacy files are never offered to an active model
until the user classifies and verifies them. Catalog records may also store role/category, tags,
activation words, source/version/hash, licensing notes, prompt templates, creator guidance, and
recommended inference strength. The server derives required activation words from the selected
verified stack when a generation is submitted, keeping prompt behavior synchronized when adapters
are added or removed. `character-profiles.ts` persists reusable character
identity settings locally in application-owned JSON.

Illustrious XL is generation-only and uses a separate SDXL-family graph:
`CheckpointLoaderSimple` → full model+CLIP `LoraLoader` chain → `CLIPSetLastLayer` →
`CLIPTextEncodeSDXL` → `EmptyLatentImage` → `KSampler` → the checkpoint VAE → optional shared
pixel-space finishing. It never reuses the Z-Image/Krea split-model loaders or SCAIL video
conditioning. Illustrious action LoRAs control the Photo pose; the resulting still can then be
animated by the existing Video workspace. See `docs/ILLUSTRIOUS-CATALOG.md`.

Dataset generation stores its prompt-matrix plan and source model on every job. The review layer
in `dataset-review.ts` persists manual state, structured captions, warning tags, and local quality
analysis beside each dataset. Versioned exports copy only accepted images and include a manifest,
trainer configuration, split, bucket summary, and rejected/uncertain audit records.

Completed datasets may accept additional validated local images through the dataset-owned image
route. Added images receive unique filenames and enter review as `uncertain`. Caption edits
auto-save through the validated review update route. The LoRA Lab handoff loads the review record,
requires at least three `keep` items, and imports only those files with their current rendered
captions. Rejected and uncertain sources stay in the audit but cannot silently enter training.

Krea generation continues to use the scaled-FP8 ComfyUI Qwen3-VL file. Krea training deliberately
uses the separate BF16 Qwen3-VL file in `training-models`, because the Musubi loader does not accept
ComfyUI's scaled-FP8 quantization metadata.

## Runtime

The desktop shortcut starts one private ComfyUI process on `127.0.0.1:8188` and one Studio server on `127.0.0.1:3199`. The React client talks only to the Studio server. The server validates requests, owns workflow construction, submits prompts to ComfyUI, monitors history, and exposes saved media through guarded proxy routes.

Photo and video generation use WebSocket events for low-latency progress plus a Comfy history poll
for terminal reconciliation. This is required because a fully cached graph can finish before the
Studio attaches its socket listener. Pending/active generation records are also reconciled from
history after a Studio restart, so a missed event or temporary Comfy outage cannot leave a completed
image permanently stuck in the queue. Terminal records are immutable to later socket events:
progress is accepted only for the matching prompt, and an `executing` event with a null node checks
history before changing state. While any job is pending/active, the Photo client also refreshes the
durable gallery every two seconds. This closes the remaining socket/history race and makes the side
preview update promptly even when the terminal WebSocket message is missed. If a full ComfyUI
restart clears its in-memory history, Studio may recover only a pending/active record that already
contains saved media plus terminal evidence (100% progress or a recorded duration); it never infers
completion from an empty queue alone.

The launcher enables only ComfyUI's scoped `fp16_accumulation` fast option. ComfyUI retains full
ownership of model loading, offload, and memory cleanup. At 1080×1920 pixels and above, Photo
builders switch only the decode node to native `VAEDecodeTiled`; smaller canvases retain standard
`VAEDecode`. The client shows a non-blocking estimated GPU working-set warning for heavy
resolution/quantity/LoRA combinations.

Application JSON writes use a same-directory temporary file followed by atomic rename and preserve
the previous version as `.bak`. User-influenced Dataset and LoRA paths are resolved and required to
remain inside their application-owned roots before any write. Backend connection settings and
generation defaults persist in `data/settings.json`.

## Photo and video isolation

Photo mode continues to use `workflows/z-image-turbo-api.json` and the existing photo builder. Video mode has an independent typed request schema and graph builder in `server/src/video.ts`. Mode-specific draft state is preserved in the client, and completed gallery records are tagged as photo or video.

SCAIL assets are kept under `video-models` and registered by `ComfyUI/extra_model_paths.yaml`. No existing photo model is renamed, moved, or overwritten.

## Video request flow

1. The browser sends multipart form data with settings and up to four media files.
2. Multer writes randomized filenames only inside `ComfyUI/input/z-image-studio`.
3. FFprobe verifies that image inputs decode as images and driving inputs decode as videos. The typed schema validates safe paths, step-32 dimensions, frame cadence, settings, and manual-mask pairing.
4. Live diagnostics verify all required native ComfyUI nodes, exact model files, FFmpeg, GPU visibility, writable output, and free space.
5. The server builds the API graph. Automatic mode uses SAM3 video tracking and `SCAIL2ColoredMask`; manual mode loads the supplied semantic masks. Both feed `WanSCAILToVideo`, shifted Wan sampling, VAE decode, `CreateVideo`, and H.264 `SaveVideo`.
6. Existing queue priority, cancel, interrupt, WebSocket progress, history persistence, reuse, and delete-record behavior apply to both media types.
7. Completed MP4s appear in the responsive preview with native playback controls and a guarded download action.

The preserved official ComfyUI blueprint is `workflows/scail-2-reference.json`; the readable API reference is `workflows/scail-2-api.json`.

## Photo reference flow

Photo requests use multipart form data only when reference images are present. Uploaded files receive randomized names in the existing controlled ComfyUI input directory and are decoded before submission.

The Z-Image photo model and LoRA stack are loaded first. Each reference is then scaled and center-cropped to the requested canvas. Pose mode runs native `SDPoseKeypointExtractor` and `SDPoseDrawKeypoints`; Direct copy mode runs native `Canny`. Face mode is deliberately approximate on Z-Image: it uses structural guidance followed by the installed Impact Pack Face Detailer at low denoise. It is not presented as an identity lock; a trained face LoRA remains the reliable path. Weighted `QwenImageDiffsynthControlnet` nodes chain controls through the official Z-Image Turbo Fun ControlNet Union model patch. `ModelSamplingAuraFlow`, the sampler, VAE decode, and exact final Lanczos output scale remain in their verified order.

Krea 2 routes Face and Direct references through its native Identity Edit path and Pose through its
depth path. Illustrious image-reference controls remain unavailable and are hidden/disabled; its
verified pose/action and style LoRAs are the supported controls. Face + Pose may coexist in one
request on Z-Image and Krea 2.

Multi-character requests retain the global prompt plus ordered character prompt, negative, and
reference ownership in the generation record. The server composes one labeled, keyword-deduplicated
positive prompt and one merged negative prompt, then submits one ComfyUI graph. References are
flattened for the architecture workflow while their character ownership is persisted. This MVP can
exhibit attribute bleed; true subject separation requires future regional/attention-couple
conditioning and is intentionally outside the current graph.

## Improve / img2img (NovelAI-style Enhance)

Selecting a completed Photo result and clicking **Improve** re-runs diffusion on that image:

`LoadImage` (copy of Comfy output into `input/z-image-studio/`) → `ImageScale` → `VAEEncode`
(architecture VAE) → `KSampler` with `denoise ≈ Strength + Noise×0.2` → existing decode/finishing.

Default txt2img remains empty latent + `denoise: 1`. Improve is separate from Pose/Structure
references, Face polish, and neural upscale. See vault `ENHANCE-FROM-IMAGE-PLAN.md`.

## Shared image finishing

Neural upscaling is an opt-in, architecture-neutral pixel-space stage after VAE decoding. Core
`UpscaleModelLoader` loads a curated local model; `ImageUpscaleWithModel` performs its fixed 4×
pass; the existing Lanczos `ImageScale` returns the result to the exact requested dimensions.
The same stage is used by **all** Photo architectures (Z-Image, Krea 2, Illustrious, Anima) and
does not modify model-conditioning graphs.

Curated models (project `upscale_models/` + Comfy `models/upscale_models/`):

| Model | Use case |
|-------|----------|
| `RealESRGAN_x4plus.pth` | Default photoreal portraits/products (Z-Image, Krea 2) |
| `4x-UltraSharp.pth` | Extra edge/texture for product and fabric stills |
| `RealESRGAN_x4plus_anime_6B.pth` | Official anime/cel default (Illustrious, Anima) |
| `remacri_original.safetensors` | Illustration texture; noncommercial license |

Enabling neural upscale auto-selects the architecture-recommended default; the user can still pick any installed model. Catalog metadata is exported from `/api/diagnostics` as `upscalers`.

When Face polish is active, Face Detailer runs after VAE decode on the single output path:
polish → optional neural upscale → exact-size ImageScale → SaveImage. No separate original branch
is saved; the gallery shows one final image, same as a normal generation.

## Safety boundaries

The server accepts only localhost ComfyUI URLs. Output names and reused upload paths are restricted to safe relative names. File extensions and decoded media types are checked independently. User-supplied workflow JSON is never executed. App record deletion does not remove generated media.
