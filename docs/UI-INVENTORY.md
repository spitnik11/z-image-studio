# Z-Image Studio UI Inventory

Use this document when reviewing, reorganizing, or extending the interface. It describes what the
current UI contains, why its major sections exist, and which distinctions must survive cleanup.
For system architecture and data invariants, read `CLAUDE.md` and `docs/ARCHITECTURE.md`.

This is an inventory, not a request to rebuild the interface. Confirm behavior in the components
and tests before treating a sentence here as executable truth.

## Product shell

Z-Image Studio's default interface is again the original dark local workspace with four persistent modes:

- **Image** — image generation, prompt/model/LoRA/reference controls, canvas, queue, and gallery.
- **Video** — SCAIL-2 animation and character replacement.
- **Dataset** — Dataset Builder and review.
- **LoRA Lab** — local adapter training.

The unfinished Create/Library/Train/Activity shell is retained only at `/?modern=1` and is not the
normal application experience.

Shared presentation:

- Charcoal surfaces, restrained borders, lime primary/active states, and muted-red destructive states.
- Global engine status and diagnostics.
- Card-based control groups with readable hierarchy and subdued helper copy.
- Text-and-icon primary actions; labeled icon-only actions.
- Safe wrapping for filenames, paths, captions, model names, and errors.
- Desktop multi-column layouts that collapse to one column at mobile widths.
- No horizontal page scrolling.
- Branded app icon, favicon, desktop shortcut, reconnect handling, and an error-recovery screen.

## Photo workspace

### Prompt and output

- Collapsible Prompt Studio browses the indexed library by architecture, complexity, style/category
  text, and scenario keywords. It previews generated text, proposes LoRAs for explicit confirmation,
  validates conflicts, then applies the normalized result through the existing model and LoRA pickers.
- Prompt Studio uses the app's dark graphite/lime visual system. Its filters stack at narrow panel
  widths, long library/proposal text wraps safely, and actions stay inside the panel without overflow.
- Library → Prompt Generator opens the same Prompt Engine as an expanded full-page workflow; applying
  a validated draft returns to Image Create and updates the shared Photo draft rather than creating
  competing prompt state.
- Prompt Studio separates library search from scenario details and exposes architecture, complexity,
  negative preset, category, style, and required-LoRA facets.
- Character Library opens as a page-like Photo overlay without adding a fifth global mode. It manages
  local presets, compatible LoRAs, and tagged Face/Body/Pose references, then applies them to the shared
  Photo draft or pre-fills Dataset Builder.
- The Photo prompt panel is scope-aware: Global plus ordered Character blocks.
- Each scope has Prompt, Negative, Face, Pose, and Style tabs. Style is explicitly LoRA-backed; it is
  not an image-style adapter.
- Add/remove Character reindexes blocks in display order. Character reference ownership is preserved.
- Model selection follows the prompt panel; the architecture-filtered LoRA stack follows the model.
- Seed input with Randomize and Clear; cleared seed means automatic random seed. The seed clears
  after every successful submission by default so consecutive runs vary. **Keep seed after
  generation** is the explicit opt-in for controlled comparisons.
- Steps, CFG scale, images per run, independent runs to queue, queue priority, and
  PNG/animated-WebP output. Independent runs are capped at 20, become separate ComfyUI jobs, and
  receive consecutive unique seeds. The UI shows the resulting total image count before submission.
- A non-blocking GPU working-set advisory appears only for heavy model, canvas, quantity, finishing,
  and LoRA combinations; it never disables Generate.
- Sticky Generate action with per-run queueing progress and partial-submission feedback.
- Canvas presets include 1080×1350 social portrait, 1080×1920 vertical, 1920×1080 cinema, and
  custom dimensions.
- Full-image preview follows the selected output ratio and uses contained, uncropped rendering.
- Dedicated canvas toolbar and collapsible generation details.

### Model selection

- Refreshable ComfyUI-backed diffusion-model picker.
- Z-Image, Krea 2, and Illustrious XL are routed through separate architecture-specific workflows.
- Illustrious checkpoint selection applies its cataloged sampler recipe, filters the LoRA picker to
  verified Illustrious adapters, shows source/license guidance, and disables incompatible image
  references. The finished Photo still can be reused as the source for existing SCAIL Video.
- Pony checkpoints use the same SDXL graph but receive a separate Pony-only LoRA picker; Pony and
  Illustrious adapters cannot cross into each other's stacks.
- LoRAs and support files are excluded from the diffusion-model list.
- Unknown/unclassified models stay disabled until classified.
- Previous compatible selections can be reused.

### Civitai metadata import

Raw pasted metadata can populate:

- Prompt
- Steps and CFG
- Seed
- Width and height
- Priority and quantity
- PNG or WebP format

Unsupported sampler values are reported and skipped rather than replacing verified sampling.

### LoRA stack

- Add/remove up to eight adapters.
- Independent strength from -2 to 2.
- Architecture compatibility filtering and persistent registry metadata.
- Applied LoRAs and strengths are retained with generation metadata.
- Krea exposes an expandable Character LoRA composer grouped by character, body, realism, style,
  action, concept, and utility roles.
- Catalog cards show activation words, concise creator guidance, and the recommended starting
  strength. Adding a card adds the adapter to the normal stack and immediately inserts its required
  activation words into the visible global prompt, deduplicated case-insensitively. The backend
  repeats the same deduplicated activation pass at submission as a safety net.
- The initial Krea catalog contains BloomGirls UltraRealism, Krea2 Realism V2, Cutifyier,
  Realism Engine v3, TextFusion Refusal Reduction, and SBBT.

Do not merge LoRA strength with reference weight; they control different conditioning systems.

### Character profiles and references

- Reusable local Character profiles.
- Dataset-only appearance adjustments do not overwrite the saved Character profile.
- Multiple weighted references can be added or removed.
- Reference modes include Face, Pose, Direct Copy, and Character Consistency.
- Z-Image supports up to four weighted references. Its Face mode is approximate structural guidance
  plus a low-denoise Face Detailer pass and must recommend a face LoRA for a true identity lock.
- Krea uses native Identity Edit for Face/Direct and depth guidance for Pose.
- Illustrious reference tabs stay unavailable; use its verified pose/action and style LoRAs.
- Character Consistency combines a master identity image, pose image, architecture-matched guidance,
  and optional face refinement.

Keep architecture differences visible. Krea and Z-Image references are not interchangeable node
chains, even when the controls share a visual language.

### Finishing, queue, and gallery

- Optional Face Detailer polish.
- Face polish is optional; only the polished final image is saved and shown.
- Optional Real-ESRGAN neural upscale for both supported model families.
- Exact requested dimensions are restored after pixel-space finishing.
- Live progress, queue cancellation, Comfy interruption, history, recent work, and settings reuse.
- Removing a Gallery record does not delete the source ComfyUI image.

## Video workspace

- Separate Photo and Video drafts.
- SCAIL-2 Animation and Character Replacement tasks.
- Reference/input image controls.
- Automatic SAM3 or supplied semantic masks.
- Workload presets and model-valid dimensions/frame cadence.
- Queue integration, diagnostics, progress, MP4 preview, download, history, and safe input reuse.
- One active video job at a time.

Do not fold Video controls into Photo generation; the schemas, models, and execution constraints are
intentionally independent.

## Dataset workspace

### Setup and generation

- Master character image, dataset name, model architecture, and identity/trigger information.
- Standard 12, 24, or 40-image builds.
- Fill an existing set to 40 or add an exact 1–40 images.
- Optional dataset-level hair, body-proportion, and other stable-trait adjustments.
- Prompt-variety controls that selectively override defaults.
- Fixed/sticky Build action with immediate click feedback and live progress.

Default variety is a deterministic 40-shot directed sequence covering distinct:

- Poses and actions
- Headshots, close-ups, medium shots, seated/moving/product shots, and full-body frames
- Camera angles, expressions, scenes, lighting, outfits, and backgrounds

Extensions continue at the next immutable prompt slot. Beyond 40, later passes vary orientation,
hands, camera height, stride, and gaze. Never restart an extension at shot one.

### Recovery behavior surfaced in UI

- Individual prompt failures do not discard completed images.
- Temporary ComfyUI/network interruption pauses rather than destroys a job.
- Pending, active, and paused jobs resume after Studio restart.
- Failed partial jobs expose Recover.
- A partial set with at least one image remains reviewable with a missing-image warning.

### Dataset History

- Refresh, reopen, extend, recover, send to LoRA Lab, and permanently delete.
- Permanent dataset deletion requires confirmation.
- History immediately reflects review and collection changes.

### Review

Review states have deliberately different meanings:

- **Keep for training** — eligible for LoRA handoff.
- **Unsure** — preserved but blocked from training.
- **Remove from training** — reversible exclusion; source remains.
- **Delete image** — confirmed physical removal of the image, caption, and review entry.

Review also provides:

- Auto-saving per-image captions.
- Local-image import; new files begin as Unsure.
- Select all images in the active review filter, then bulk Keep, Unsure, or Remove from training.
- Changing review filters clears bulk selection so hidden images are not changed accidentally.
- Immediate count, selection, thumbnail, and History reconciliation after deletion.
- Explicit Refresh.
- Aspect-aware lightbox with previous/next navigation.
- Contained portrait and landscape previews without scrolling back to a master preview.
- Advisory duplicate/blur analysis, statistics, and versioned export.

Only Keep images with their latest rendered captions are handed to LoRA Lab.

## LoRA Lab

### Setup and pictures

- Target architecture and matching training base.
- LoRA name and trigger phrase.
- Individual-image, folder, or reviewed-dataset import.
- Duplicate-import prevention.
- Per-image captions and caption-completeness feedback.
- Fill-empty, remove-one, and remove-all draft actions.

### Presets

| Preset | Resolution | Steps | Rank |
| --- | ---: | ---: | ---: |
| Quick | 512 | 250 | 8 |
| Balanced | 512 | 500 | 16 |
| Detailed | 768 | 800 | 32 |

Quick is the verified starting profile for the local 12 GB GPU.

### Readiness and training

The sticky Start action remains disabled until:

- Name and trigger are valid.
- At least three pictures exist.
- Every caption is nonempty.
- The selected architecture is trainable.
- Preflight passes.
- Safety confirmation is checked.
- No other training job is active.

The UI displays architecture/base/target, estimated storage, active local configuration, live logs,
progress, stopping state, history, and recommended inference strength. While training is active, a
compact telemetry grid reports GPU utilization and VRAM, system CPU usage, elapsed time, estimated
time remaining, current step, and seconds per iteration. Metrics that are not available yet render
as initializing/unavailable instead of blocking the job. A completed adapter is installed into the
project LoRA folder, registered with its architecture, and becomes selectable in Photo mode.

## Major additions since the original generator

- Four-mode application shell and responsive visual system.
- Negative prompts, exact sizes, priority, quantity, output format, and clear/random seed controls.
- Full-ratio canvas preview (legacy original/refined pairs still display if present in history).
- Model switching with isolated Z-Image and Krea workflows.
- Raw Civitai metadata import.
- Multiple architecture-filtered LoRAs.
- Character profiles, weighted pose/direct references, and Character Consistency.
- Face refinement and local Real-ESRGAN finishing.
- SCAIL-2 local video generation.
- Dataset Builder with deterministic 40-shot variety and additive extension.
- Partial/interrupted dataset recovery.
- Dataset History deletion, immediate review synchronization, and aspect-aware lightbox.
- Architecture-aware local Z-Image and Krea LoRA training.
- Mobile viewport correction, reconnect handling, and frontend error recovery.

## UI cleanup guardrails

- Preserve the four mode boundaries.
- Do not remove an action merely because a similar-looking action exists elsewhere; verify whether
  it means reversible exclusion, record removal, physical deletion, cancellation, or interruption.
- Keep architecture compatibility visible and actionable.
- Keep primary creation actions easy to find without letting them obscure review content.
- Preserve sticky actions only within their owning workspace.
- Use `object-fit: contain` and active-image aspect ratios for previews/lightboxes.
- Scope Dataset CSS to `.dataset-builder-workspace`/`.dataset-review`, LoRA CSS to
  `.training-workspace`, and lightbox CSS to `.dataset-lightbox`.
- Validate desktop and 390px layouts after visible changes.
- Do not perform broad rewrites of the legacy-plus-override stylesheet without a focused regression
  plan.
## Create surface layout contract (studio-shell) — REMOVED 2026-07-30

> **This shell no longer exists.** The `?modern=1` / `studio-shell` / `destination-*` interface was
> deleted; `main.tsx` is now a single four-mode workspace using the base `.shell` three-column grid
> (`.controls` / `.stage` / `.queue`). The section below is retained only as history for anyone
> reading old `.destination-create` CSS that is still present but dead. Do not build against it.

The former default shell (`newShell`, i.e. no `?legacy=1`) rendered Create as
`main.destination-create`, a CSS grid with this structure:

- Columns: `minmax(360px,420px)` (controls) + `minmax(0,1fr)` (stage).
- Rows: `auto` (switch) + `minmax(0,1fr)` (body).
- Areas: `"switch stage" / "controls stage"`.
- `.create-mode-switch` occupies the non-scrolling `switch` row above the controls column.
  `.controls` and `.stage` are the two independent internal scroll regions
  (`overflow:auto; min-height:0`). `.stage` spans both rows for full height.

Rules:

- **Desktop (>900px): the switcher must be a grid-area item (`grid-area: switch; position: static`),
  never `position: fixed`.** A prior fixed switcher used a hardcoded `376px` width that desynced from
  the `minmax(360px,420px)` column and forced a `padding-top` compensation on `.controls` — that was
  the cause of the switcher scroll/overlap bug. A grid-area item tracks the column automatically.
- Each column scrolls internally; `main` and the page must not scroll. Do not introduce a second,
  page-level scrollbar.
- Mobile (≤900px) uses a separate `display:block` surface system (Compose/Result/Activity tabs +
  its own fixed switcher). It is isolated from desktop and must declare its own `position`
  explicitly rather than inheriting the desktop base rule.

### Mobile scope (assessment)

Z-Image Studio is a localhost desktop app that drives a local ComfyUI on the **same machine**;
phone/small-screen use is a non-goal. Keep mobile handling deliberately minimal — a simple
single-column stack is preferable to elaborate app-like surface switching. Do not add mobile-only
hacks (e.g. fixed-position controls) that leak into and complicate the desktop layout. If the mobile
surface system is ever simplified, the desktop grid contract above must remain independent of it.

## Source map for review

| UI area | Primary file |
| --- | --- |
| Shell, Photo, queue, gallery, diagnostics | `app/src/main.tsx` |
| Dataset creation and review | `app/src/DatasetBuilder.tsx` |
| LoRA Lab | `app/src/TrainingControls.tsx` |
| Character profiles | `app/src/CharacterProfiles.tsx` |
| References and consistency | `app/src/PhotoReferences.tsx` |
| Video | `app/src/VideoControls.tsx` |
| LoRA compatibility manager | `app/src/LoraRegistryManager.tsx` |
| Shared styling and responsive overrides | `app/src/styles.css` |

Current verified baseline at the time of this inventory: 69 tests pass and frontend/backend
production builds pass.
