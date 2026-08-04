# Z-Image Studio — Claude engineering guide

Read this before changing code in this repository. This file describes the design intent, system
boundaries, invariants, and verification contract that keep Z-Image Studio working.

The project is a local creative application, not a generic ComfyUI graph editor. The React client
collects beginner-friendly settings. The Node server validates them, chooses an architecture-specific
workflow, submits it to the private ComfyUI installation, and persists application-owned state.

## Prime directive

Make additive, scoped changes. Preserve working model paths, architecture-specific workflows,
dataset history, and user-created media. Do not “simplify” code by merging systems that are separate
for compatibility reasons.

Before editing:

1. Read `AGENTS.md`, this file, and the relevant section of `docs/ARCHITECTURE.md`.
2. Inspect the actual component, server route, schema, and tests involved.
3. Treat files under `data`, `lora`, `training-models`, and model roots as user data.
4. Prefer a narrow extension over replacing a verified workflow or state model.

After editing:

```powershell
Set-Location "Z:\codex app"
npm run build
npm test
```

The current verified baseline is 64 passing tests plus a successful frontend/backend production
build. For visible UI work, reload `http://127.0.0.1:3199` and inspect desktop and 390px layouts.
Do not claim runtime or visual verification that was not performed.

## Non-negotiable safety rules

- Never overwrite, rename, move, or delete model files.
- Never modify `ComfyUI`, `ComfyUI\models`, its virtual environment, or custom nodes without explicit
  user approval.
- Preserve official reference workflows. Extend API-format builders and copies only.
- Keep services bound to localhost: Studio `127.0.0.1:3199`, ComfyUI `127.0.0.1:8188`.
- Never accept or execute user-supplied workflow JSON.
- Validate filenames and paths before filesystem access. Continue using `safeOutputPath`.
- Do not delete generated media when removing a Gallery record. Dataset deletion is a separate,
  explicitly confirmed destructive workflow.
- Do not expose secrets or store `.env` contents in documentation or application state.
- Use PowerShell-compatible commands and explicit Windows paths.

## System map

```text
React/Vite client (app/src)
        │ local HTTP + WebSocket
        ▼
Express server (server/src/index.ts)
        │ validation + workflow construction + monitoring
        ▼
Private ComfyUI (127.0.0.1:8188)
        │
        ├─ Photo: Z-Image, Krea 2, or Illustrious XL
        ├─ Video: SCAIL-2
        ├─ Dataset image generation
        └─ Local output/history

Separate training process:
Studio server → training-engine/Musubi Tuner → installed LoRA → Photo mode
```

### Runtime responsibilities

| Layer | Owns | Must not own |
| --- | --- | --- |
| React client | Draft UI state, uploads, user feedback, responsive layout | Workflow topology, trusted paths |
| Express server | Schemas, model routing, graph creation, persistence, monitoring | Rendering controls |
| ComfyUI | Model execution, queue, history, output files | Product UI or app business rules |
| Musubi environment | LoRA caching/training/conversion | ComfyUI Python dependencies |

## Repository structure

| Path | Purpose |
| --- | --- |
| `app/src/main.tsx` | Main four-mode shell, Photo workspace, gallery, queue, diagnostics |
| `app/src/DatasetBuilder.tsx` | Dataset creation, extension, review, captions, lightbox, deletion |
| `app/src/TrainingControls.tsx` | LoRA Lab readiness, pictures, preflight, training history |
| `app/src/CharacterProfiles.tsx` | Reusable local character identity profiles |
| `app/src/PhotoPromptPanel.tsx` | Global/character prompt tabs, owned references, LoRA-backed Style tab |
| `app/src/PhotoReferences.tsx` | Face/Pose/Direct references and Character Consistency controls |
| `app/src/VideoControls.tsx` | SCAIL-2 video mode |
| `app/src/LoraRegistryManager.tsx` | Architecture compatibility correction/verification |
| `app/src/styles.css` | Shared UI system plus scoped mode-specific overrides |
| `server/src/index.ts` | HTTP API, persistence, generation and job monitors |
| `server/src/workflow.ts` | Photo schemas, safe paths, Z-Image/Krea workflow construction |
| `server/src/dataset.ts` | Dataset schema and deterministic directed shot plan |
| `server/src/dataset-review.ts` | Review state, captions, checks, exports |
| `server/src/musubi-training.ts` | Architecture-aware training commands/configuration |
| `server/src/model-adapters.ts` | Model-family boundary and required training assets |
| `server/src/prompt-composition.ts` | Ordered multi-character prompt/negative composition |
| `server/src/prompt-engine.ts` | Prompt library serialization, LoRA proposals, and conflict validation |
| `server/src/character-presets.ts` | Reference-based preset records and Dataset Builder handoff |
| `server/src/lora-registry.ts` | Persistent LoRA architecture/verification metadata |
| `server/src/video.ts` | Independent SCAIL schemas and graph builder |
| `workflows` | Preserved reference/API workflow files |
| `data` | User/application state: jobs, profiles, registries, datasets |
| `lora` | User and Studio-installed adapters |
| `training-engine` | Isolated Python 3.10 Musubi environment |
| `training-models` | Dedicated training bases/encoders; never generation replacements |
| `video-models` | Isolated SCAIL assets |

## UI design system

The interface is a dark local creative workspace:

- Charcoal/near-black surfaces, restrained borders, lime active/primary state.
- Native controls use an explicit dark color scheme.
- Small uppercase eyebrows establish hierarchy; body copy stays subdued.
- Destructive actions use muted red, never the primary lime treatment.
- Important actions include text and icons; icon-only buttons require `aria-label` and `title`.
- Long filenames, model names, paths, captions, and errors must wrap safely.
- No horizontal page scrolling at desktop, tablet, or mobile widths.

### Layout intent

- Global header identifies the active mode and local-engine state.
- Persistent mode switch: Photo, Video, Dataset, LoRA Lab.
- Photo uses creation controls, canvas/recent work, and queue/details.
- Dataset creation uses setup, master preview/review, and Dataset History.
- LoRA Lab separates setup/preflight, pictures/captions, and job history.
- At intermediate widths, tertiary history/details move below.
- At mobile widths, layouts become one column.

### CSS rules for safe changes

`styles.css` contains legacy base rules followed by newer scoped overrides. Later rules intentionally
win. Avoid broad global rewrites.

- Scope Dataset rules under `.dataset-builder-workspace` or `.dataset-review`.
- Scope LoRA rules under `.training-workspace`.
- Scope lightbox rules under `.dataset-lightbox`.
- Use `minmax(0, 1fr)`, `min-width: 0`, and `overflow-wrap: anywhere` around user text.
- Match action heights and icon sizes inside the same action group.
- Use responsive breakpoints already present before adding another.
- For image previews, preserve aspect ratio with `object-fit: contain`.
- The Dataset lightbox calculates its card ratio from the active image. Do not return it to a fixed
  wide rectangle; that previously caused a 512×768 image to overflow and compress the controls.

## Model-family boundary

Z-Image, Krea 2, and Illustrious XL are not interchangeable checkpoints with different filenames.
They have different loaders, text encoders, VAEs, sampling patches, reference systems, and training
support. Illustrious is generation-only until a separate trainer is implemented and verified.

| Concern | Z-Image | Krea 2 | Illustrious XL |
| --- | --- | --- | --- |
| Generation model | `zImageTurbo_turbo.safetensors` | Krea 2 Turbo INT8 ConvRot | Cataloged SDXL checkpoint |
| Text encoding | Lumina2/Qwen path | Qwen3-VL Krea path | Checkpoint CLIP + `CLIPTextEncodeSDXL` |
| VAE | Flux AE | Qwen Image VAE | Checkpoint-baked VAE |
| Sampling | AuraFlow + `res_multistep` | Euler/simple | Per-checkpoint SDXL recipe |
| Direct identity | Structural fallback | Krea Identity Edit | Not installed |
| Pose | SDPose + ControlNet Union | Depth Anything + Krea Depth LoRA | One action LoRA at a time |
| Training base | Z-Image Base BF16 | Krea 2 Raw | Not enabled |
| Training module | `networks.lora_zimage` | `networks.lora_krea2` | Not enabled |

Use `modelArchitecture` and `model-adapters.ts`; never infer compatibility only from a display label.
Unknown models and LoRAs must remain disabled/unverified until classified.

## Photo workflow invariants

The verified Z-Image order is:

```text
UNET + CLIP + VAE
→ optional architecture-compatible LoRA chain
→ optional reference controls
→ ModelSamplingAuraFlow
→ sampler
→ VAE decode
→ optional face refinement
→ optional neural upscale
→ exact-size Lanczos scale
→ save
```

Krea uses its own builder and must not receive the AuraFlow patch or Z-Image controls.

Other constraints:

- Empty negative prompt retains the official zeroed negative conditioning.
- Exact output size happens after decoding. Do not assume latent dimensions preserve 1080×1920.
- Neural finishing is pixel-space and optional. Curated catalog: Real-ESRGAN (photo), UltraSharp
  (sharp product), Anime 6B (Illustrious/Anima), Remacri (illustration). Same stage for all Photo arches.
- Face polish is optional; when on, only the polished final image is saved (same SaveImage path as normal gens).
- Improve (img2img) is optional; default remains empty latent + denoise 1. Strength maps to denoise;
  Noise blends lightly into denoise. Do not conflate with Pose/Structure references.
- LoRAs are architecture-filtered through the registry before submission.
- Reference weights and LoRA strength solve different problems and remain separate controls.

## Dataset system: critical invariants

Dataset logic has mutable user collections layered over immutable generation history. Preserve that
distinction.

### Persistent job fields

| Field | Meaning | Mutation rule |
| --- | --- | --- |
| `promptIds` | Every Comfy prompt submitted for this dataset | Append only; never splice |
| `promptPlan` | Caption/tags/seed/variation slot for each submitted prompt | Append only; indexes are immutable |
| `completedPromptIds` | Prompts safely imported into the dataset | Append/dedupe |
| `failedPromptIds` | Per-image terminal Comfy failures | Append/dedupe |
| `promptErrors` | Failure reason keyed by prompt ID | Update by key |
| `images` | Current visible dataset collection | Add/delete allowed |
| `captionByImage` | Current caption keyed by visible filename | Add/update/delete by filename |
| `captions` | Legacy/submission history fallback | Do not use as mutable image-index truth |
| `variationOffset` | Prompt-planner input for the directed shot sequence | Initial jobs use 0; extensions derive it from immutable `promptIds.length` |

The real failure to remember: deleting image `007.png` once spliced `captions` while leaving
`promptIds` intact. A later extension requested prompt index 40, received an undefined caption, and
crashed `writeFileSync`. Caption import must use `datasetCaptionForPrompt` and immutable
`promptPlan[index]`, never the position of a mutable visible image.

### Directed variety plan

Default generation uses a deterministic 40-shot sequence:

- Forty distinct pose/action descriptions.
- Ordered close-up, medium, seated, moving, product-interaction, and full-body framing.
- Directed angles, expressions, scenes, lighting, outfits, and backgrounds.
- Explicit instruction for a distinct body arrangement and composition.

Extensions derive `variationOffset` from the immutable submitted-prompt count. A 12-image set
extended by 28 starts at shot 13.
Beyond 40, alternate passes change orientation, hand placement, camera height, stride, and gaze.
Custom Prompt Variety selections override only their corresponding default dimension.

Do not reset extensions to sequence index zero.

### Monitoring and interruption recovery

`monitorDataset` is intentionally idempotent and partial-result-safe:

- Copy an output only when its target is absent.
- Add visible filenames and completed prompt IDs only once.
- Isolate a Comfy execution failure to that prompt.
- Preserve completed images when another prompt fails.
- Mark temporary Comfy/network failures `paused`; continue polling.
- Resume `pending`, `active`, and `paused` jobs after a Studio restart.
- Allow a failed partial job to use the History **Recover** action.
- When all prompts are terminal and at least one image exists, make the dataset reviewable and show
  a warning for missing images rather than discarding the set.

Do not change transient engine failures back into a whole-dataset destructive failure.

### Review semantics

These actions are intentionally different:

- **Keep for training:** approved for LoRA handoff.
- **Unsure:** preserved but blocked from training.
- **Remove from training:** reversible review state; source file remains.
- **Delete image:** confirmed permanent removal of image, caption, and review entry.
- **Delete dataset:** confirmed permanent removal of the dataset-owned directory and record.

Review captions auto-save. New generated or imported images enter as Unsure. LoRA Lab receives only
Keep items with the latest rendered captions, and requires at least three.

Thumbnail clicks open the aspect-aware lightbox; users should not have to scroll to the main preview.
Deletion must immediately reconcile review items, counts, selection, thumbnails, and parent History.

## LoRA Lab invariants

Training is isolated from ComfyUI:

- Python: `training-engine\.venv\Scripts\python.exe`
- Musubi: `training-engine\musubi-tuner`
- Job state/logs: `data\training-jobs\<id>`
- Installed adapters: `lora\<slug>.safetensors`
- Compatibility registry: `data\lora-registry.json`

The Start action stays disabled until:

- Name and trigger are valid.
- At least three pictures exist.
- Every caption is nonempty.
- Selected architecture is trainable.
- Preflight succeeds.
- Safety confirmation is checked.
- No job is running.

Presets:

| Preset | Resolution | Steps | Rank |
| --- | ---: | ---: | ---: |
| Quick | 512 | 250 | 8 |
| Balanced | 512 | 500 | 16 |
| Detailed | 768 | 800 | 32 |

Quick rank 8 is the verified 12 GB starting point. One training job at a time. Do not generate on the
GPU during training. Never use a Z-Image adapter on Krea or vice versa.

## State and user-data files

| File/folder | Purpose |
| --- | --- |
| `data/dataset-jobs.json` | Dataset job history and recovery state |
| `data/datasets/<id>` | Dataset images, review, captions, exports |
| `data/training-jobs.json` | LoRA job history |
| `data/training-jobs/<id>` | Training logs/configuration |
| `data/lora-registry.json` | Adapter compatibility metadata |
| `data/character-profiles.json` | Saved character profiles |
| `ComfyUI/input/z-image-studio` | Validated uploaded generation inputs |
| `ComfyUI/input/lora-training` | Per-job training datasets |

These are not disposable test fixtures. Tests should use temporary directories. Live browser checks
must not queue expensive generation or delete real datasets/images unless the user explicitly asks.

## API behavior worth preserving

Major route groups:

- `/api/diagnostics`, `/api/settings`, `/api/jobs`
- `/api/generate`, Gallery/media proxy routes
- `/api/video/*`
- `/api/characters/*`
- `/api/loras`, `/api/loras/registry/*`
- `/api/datasets`, `/api/datasets/:id`
- `/api/datasets/:id/extend`, `/resume`, `/review`, `/analyze`, `/export`
- `/api/datasets/:id/images/*`
- `/api/training/*`

Server routes must:

1. Validate with Zod or an equivalent explicit schema.
2. Check model/node availability when execution depends on it.
3. Restrict filesystem targets to application-owned directories.
4. Return a clear user-facing error.
5. Persist before reporting a durable state transition.
6. Keep in-memory and client state synchronized in the response.

## Common mistakes to avoid

- Splicing prompt-indexed arrays when deleting a visible image.
- Restarting dataset variety at shot one during extension.
- Treating all Comfy interruptions as terminal dataset failure.
- Applying Z-Image nodes or LoRAs to Krea.
- Moving models to match documentation filenames.
- Editing the official reference graph instead of the API builder/copy.
- Adding a broad CSS rule that overrides Photo, Dataset, and LoRA controls together.
- Using fixed preview dimensions that distort portrait/landscape assets.
- Removing review sources when the user only chose Remove from training.
- Starting a real 40-image generation merely to test a button.
- Modifying the ComfyUI Python environment to solve a Musubi training issue.

## Change workflow

For normal implementation:

1. Identify the owning component/module and persistent state involved.
2. Write or update the smallest focused test for logic/invariants.
3. Implement the server/state change.
4. Implement the UI with immediate feedback and safe disabled states.
5. Run `npm run build`.
6. Run `npm test`.
7. For UI changes, inspect the actual local app at desktop and 390px.
8. For server changes, **rebuild `server/dist` AND restart** the Studio backend
   (`node server/dist/index.js` on port 3199). Node does **not** hot-reload dist.
   Lesson 2026-08-04: a process started earlier kept re-merging master gallery LoRAs
   (e.g. 5 including TextFusion Refusal) and ignored Dataset Builder LoRA edits;
   symptom cue was warning text like `merged form LoRAs`. Vault:
   `ClaudeBrain/.../LESSON-SERVER-DIST-RESTART.md` and
   `FEEDBACK-zimage-server-dist-restart.md`. Restart ComfyUI only if Comfy itself changed.
9. Verify existing data remains present.
10. Update relevant documentation when a durable invariant changes.
11. **Dataset / generation changes — modular and backwards compatible:**
    - Prefer pure helpers (`dataset.ts`, etc.) + thin route wiring; optional schema fields with
      resolve-defaults so old jobs in `data/dataset-jobs.json` still work.
    - Do not require new fields on historical records; do not break standard mode when adding
      Instagram/list features.
    - Always **preflight master image on disk** before enqueueing N Comfy graphs
      (`requireDatasetMasterImage`). Missing `z-image-studio/<uuid>.png` causes mass LoadImage
      failures. Vault: `LESSON-DATASET-MASTER-PREFLIGHT.md` /
      `FEEDBACK-zimage-dataset-master-preflight.md`.
    - On mid-batch submit failure, cancel already-queued prompt IDs; fail with a clear user error.

Maintenance commands:

- `npm run smoke` submits one real 512×512 default-model generation and skips clearly if Studio is
  stopped.
- `npm run prune` removes only old `outputs/*.json` sidecars and rotates oversized `logs/*.log`.
- `VERSIONS.md` records the last fully verified local dependency stack.

## Documentation sources

- `docs/CLAUDE-HANDOFF.md`: short canonical reading map to give another Claude session.
- This file: operational guardrails for Claude.
- `AGENTS.md`: repository safety rules.
- `README.md`: user-facing features and setup.
- `docs/ARCHITECTURE.md`: technical architecture.
- `docs/UI-INVENTORY.md`: current screen inventory, accumulated UI changes, and cleanup guardrails.
- `docs/UGC-QUICK-GUIDE.md`: short user workflow from reference image through multi-LoRA generation and publishing.
- `docs/PROMPT-LIBRARY.md`: pointer to the formal vault prompt library and LoRA association map.
- `docs/AUTOMATION-API.md`: localhost Prompt Engine and character-preset API contract.
- `docs/RESEARCH.md`: compatibility and upstream research.
- `docs/DRAG-DROP-UPLOAD-DESIGN.md`: proposed additive library upload (LoRA/model/checkpoint) for generation use.
- `docs/DRAG-DROP-UPLOAD-SETUP.md`: implementation source map and coding handoff for that feature (not built until implemented).
- `workflows/*-reference.json`: preserved official references.
- `C:\Users\losth\Documents\ClaudeBrain\02 Projects\Z-Image Studio`: formal project/UGC/LoRA notes.

If documentation and executable behavior disagree, inspect the code and tests, verify locally, then
update the stale documentation. Never “fix” working behavior solely to match an outdated sentence.
