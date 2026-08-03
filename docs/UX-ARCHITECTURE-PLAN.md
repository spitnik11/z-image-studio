# Z-Image Studio — Product Architecture and Workflow Overhaul

Status: rolled back from the default application, 2026-07-30. The original four-mode interface is
again served at `/`; the unfinished overhaul remains available only at `/?modern=1` for reference.

Read with `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `docs/UI-INVENTORY.md`. The goal is to simplify
how people move through the product without merging or rewriting verified ComfyUI workflows.

## Research basis

Current official documentation was reviewed for:

- [Midjourney Create](https://docs.midjourney.com/hc/en-us/articles/33390732264589-Creating-on-Web)
  and [Organize](https://docs.midjourney.com/hc/en-us/articles/33329462451469-Organizing-Your-Creations)
- [Adobe Firefly image generation](https://helpx.adobe.com/sg/firefly/web/work-with-images/generate-images/generate-images-from-text-descriptions.html)
  and [style references](https://helpx.adobe.com/firefly/web/work-with-images/generate-images/set-styles-for-image-generation.html)
- [Leonardo image generation](https://intercom.help/leonardo-ai/en/articles/8942360-how-to-generate-images-with-leonardo-ai),
  [image guidance](https://intercom.help/leonardo-ai/en/articles/8497988-image-guidance), and
  [dataset/Element training](https://intercom.help/leonardo-ai/en/articles/10501488-how-to-train-and-use-elements-loras-and-datasets-on-leonardo-ai)
- [Ideogram Style Reference](https://docs.ideogram.ai/using-ideogram/features-and-tools/reference-features/style-reference)
  and [image reuse](https://docs.ideogram.ai/using-ideogram/getting-started/generating-images)
- [ComfyUI APP mode](https://docs.comfy.org/interface/app-mode)

The recurring pattern is one dominant creation surface, model-aware controls, references grouped by
user intent, compact visibility of active conditioning, advanced settings behind disclosure, contextual
actions after generation, and separate destinations for organization, training, and administration.

## Current diagnosis

The backend/model architecture is sound. The navigation and information architecture create the
confusion.

1. Photo is one long left-sidebar document:
   Prompt Studio → prompt/character tabs → model → several LoRA surfaces → Character Profiles →
   metadata → canvas → fine tune → Generate.
2. Prompt Studio selects architecture before the actual model control and can silently cause a model
   switch when its draft is applied.
3. Character Profiles and Character Presets overlap as two reusable-character systems with different
   stores and different downstream consumers.
4. LoRAs appear through the basic stack, Character LoRA composer, Style tab, and Registry Manager.
5. Prompt Library, direct prompting, reference setup, and Civitai metadata are separated even though
   they all prepare the same Photo draft.
6. Character Library is a modal even though it is a primary asset workflow.
7. Queue and generation details permanently occupy the right rail, competing with the canvas.
8. Dataset and LoRA Lab show setup, active work, and history simultaneously instead of guiding the
   user through stages.
9. Mobile compresses desktop surfaces instead of switching between Compose, Result, and Activity.

## Target product map

Use four stable user-intent destinations. Keep Setup/System behind the existing header gear.

```text
Create
  ├─ Image
  └─ Video

Library
  ├─ Creations
  ├─ Characters
  ├─ Datasets
  ├─ LoRAs
  ├─ Models
  └─ Prompt Library

Train
  ├─ Dataset Builder
  └─ LoRA Lab

Activity
  ├─ Image and video jobs
  ├─ Dataset jobs
  └─ Training jobs
```

This is a presentation change, not a workflow merge. Photo, Video, Dataset, and LoRA schemas and
builders remain isolated.

## Target Create page

### Desktop

```text
┌────────────────────────────────────────────────────────────────────┐
│ Create  [Image] [Video]                    status · Activity · gear │
├──────────────────────────────┬─────────────────────────────────────┤
│ Composer                     │ Result                              │
│                              │                                     │
│ Model / recipe               │ Large live preview                  │
│ Prompt                       │                                     │
│ Character + guidance chips   │ Context actions after completion   │
│ LoRA / style chips           │                                     │
│ Output shape                 │ Recent generations                  │
│ Advanced ▸                   │                                     │
│                              │                                     │
│ [Generate / progress]        │                                     │
└──────────────────────────────┴─────────────────────────────────────┘
```

The permanent queue rail becomes an Activity button/drawer. Generation details live with the selected
result. The central canvas gains the recovered width.

### Composer order

1. **Model**
   - Model first because it determines every compatible control.
   - Show architecture badge and a short capability summary.
   - Reconcile incompatible active LoRAs/references before switching.
2. **Prompt**
   - Main prompt is the visual anchor.
   - Negative prompt is an adjacent tab/disclosure.
   - Prompt Library opens as an Inspire/build sheet.
   - Civitai metadata import is an action here, not a later unrelated section.
3. **Characters and guidance**
   - Select saved characters through a lightweight picker.
   - Active characters and references remain visible as compact cards/chips.
   - Add Image asks for its role: Identity/Face, Pose, or Composition/Direct.
   - Expanding a character edits that character's prompt and owned references.
4. **Style and LoRAs**
   - One visible active LoRA stack.
   - Browse opens one compatible LoRA drawer grouped by Character, Body, Action, Style, Realism,
     Concept, and Utility.
   - The existing Style tab becomes a filtered entry into this same drawer.
5. **Output**
   - Aspect ratio presets, then exact dimensions.
   - Quantity and format.
   - Memory/workload advisory.
6. **Advanced**
   - Seed, steps, CFG, sampler/scheduler where supported, queue priority, neural upscale, face polish,
     architecture-specific controls, and Reset to model defaults.
7. **Generate**
   - One sticky action with a compact summary such as `Krea 2 · 9:16 · 4 images`.
   - Validation appears directly above it.
   - Progress/Cancel occupies the same stable area during execution.

### Mobile

Use surface tabs:

- Compose
- Result
- Activity

Do not stack the entire result, gallery, and queue below a long form.

## Canonical feature ownership

| Feature | Canonical home | Selection/use inside Create |
| --- | --- | --- |
| Generated media | Library → Creations | Recent strip and current result |
| Character presets | Library → Characters | Compact character picker |
| Datasets/history | Library → Datasets | “Add to Dataset” result action |
| LoRA registry/admin | Library → LoRAs | Compatible LoRA drawer |
| Model catalog/health | Library → Models | Model picker |
| Prompt maintenance | Library → Prompt Library | Prompt Inspire sheet |
| Dataset construction | Train → Dataset Builder | Character/result handoff |
| LoRA training | Train → LoRA Lab | Dataset continuation |
| Queue/job monitoring | Activity | Compact status/drawer in Create |
| Connection/diagnostics | Header gear | Status indicator only |

## Character-system consolidation

Character Presets become the canonical reusable-character model because they already support keywords,
triggers, preferred LoRAs, and tagged Face/Body/Pose references.

Do not delete or directly rewrite legacy Character Profiles.

1. Add a tested read-only migration/import adapter.
2. Show legacy profiles in Library → Characters with an “Import to Character Library” action.
3. Update Dataset Builder to accept the canonical preset handoff.
4. Verify prompt, preferred model, references, and Dataset behavior.
5. Deprecate the embedded `CharacterProfiles` section only after parity and migration tests pass.

## LoRA consolidation

Create has one stack and one Browse action.

- Basic stack remains the visible selected state.
- Character Composer and Style selection become filters/views of the same Browse drawer.
- Registry Manager moves to Library → LoRAs and is no longer in the everyday generation form.
- Activation words, compatibility, recommended strength, and conflict warnings remain visible.
- Reference strength and LoRA strength remain distinct.

## Main user journeys

### Simple image

`Create → Image → Model → Prompt → Shape → Generate → Result`

Character, LoRA, metadata, and expert controls stay closed until requested.

### Consistent character

`Create → Image → Character picker → Face/Pose guidance → Prompt → Generate`

“Manage Characters” opens Library without duplicating preset state.

### Prompt Library

`Create → Prompt → Inspire → Select scenario → Review prompt/LoRA proposal → Apply → Generate`

Prompt Studio inherits the active model architecture; it does not own a competing architecture picker.

### Dataset to LoRA

`Train → Dataset Setup → Generate/Import → Review → Caption readiness → Continue to LoRA →
Pictures → Settings → Preflight → Train → Test in Create`

Each stage has one primary Next action.

### Post-generation

Only after an image exists, show:

- Use as reference
- Variation/refine
- Face refine
- Upscale
- Animate
- Add to character/dataset
- Download
- Remove app record

### Video

`Create → Video → Source/task → Motion/mask → Output → Generate → Result`

Video retains its independent schema and workflow but shares the same shell and result patterns.

## Migration phases

### Phase 0 — guardrails and route map

- Record route/view names, canonical state owners, and user-journey acceptance tests.
- Keep `main.tsx` as the current Photo draft owner.
- Add a feature flag/fallback for the old shell.
- No server or workflow changes.

### Phase 1 — navigation shell

- Add Create, Library, Train, and Activity navigation.
- Place Image/Video under Create; Dataset Builder/LoRA Lab under Train.
- Render existing components largely unchanged.
- Add internal route/view restoration.

Acceptance: every current workflow remains reachable; switching destinations preserves drafts and jobs.

### Phase 2 — unified Image Create layout

- Recompose existing state into Composer + Result.
- Move Model first.
- Add Prompt, Character/Guidance, Style/LoRA, Output, and Advanced sections.
- Replace permanent queue rail with Activity drawer.
- Keep one Generate action.

Acceptance: simple image requires only model, prompt, output, Generate; no server behavior changes.

### Phase 3 — Character Library route and migration

- Convert the current modal content into Library → Characters.
- Add a compact picker in Create.
- Add tested legacy Character Profile import.
- Preserve both stores until migration parity is proven.

### Phase 4 — LoRA consolidation

- Create one selected stack plus compatible Browse drawer.
- Route Style and Character filters into it.
- Move Registry Manager to Library → LoRAs.

### Phase 5 — staged Train workflows

- Dataset: Setup → Generate/Review → Captions/Readiness → Continue.
- LoRA Lab: Pictures → Settings → Preflight → Train/Monitor → Use in Create.
- Preserve job recovery, review semantics, telemetry, and safe deletion.

### Phase 6 — Activity and contextual result actions

- Unify image/video, dataset, and training job monitoring.
- Add filters by job type and status.
- Move generation details and actions beside the selected result.

### Phase 7 — responsive and usability acceptance

Verify at 1440px and 390px:

- Simple text-to-image
- Saved character + pose + LoRA
- Prompt Library → Apply → Generate
- Image → Dataset
- Dataset → LoRA → Test in Create
- Image → Video
- Model switch with incompatible active conditioning
- Keyboard focus, route restoration, no horizontal page scroll, full-ratio image previews

## Do not do during the overhaul

- Do not merge Photo, Video, Dataset, or training schemas/workflow builders.
- Do not create a second copy of Photo draft state inside routed pages.
- Do not delete legacy Character Profiles before a tested migration.
- Do not infer model/LoRA compatibility from display labels.
- Do not combine reference and LoRA strengths.
- Do not broadly rewrite `styles.css`; add scoped route/workspace layers.
- Do not expose ComfyUI provider/node names as the primary product language.
- Do not add another modal for routine creation.

## First implementation slice

Build only Phase 1 and the outer frame of Phase 2:

1. Add the four-destination shell.
2. Keep existing logic/components alive behind it.
3. Create the new Image Composer + Result layout using current main-owned state.
4. Move Model to the first visible decision.
5. Move queue to a collapsible Activity drawer.

Do not consolidate character stores or LoRA surfaces in the first slice. Those are separate migrations
with their own tests and rollback points.

## Implementation record — 2026-07-30

Implemented:

- Four-destination Create, Library, Train, and Activity shell with hash restoration and `?legacy=1`
  fallback.
- Create uses a two-surface Composer/Result layout, a desktop Activity drawer, and dedicated
  Compose/Result/Activity phone surfaces.
- The active model is the first architecture decision. Prompt Studio inherits that architecture.
- Advanced image settings are grouped behind one disclosure without changing verified defaults.
- Character Library is a routed Library page; applying a preset returns to Create and promotion opens
  Dataset Builder.
- The legacy embedded Character Profiles editor is hidden in the new shell but remains available in
  the legacy fallback. Its data store has not been deleted.
- LoRA registry administration moved to Library → LoRAs. Create retains the compatible active stack,
  strengths, activation handling, and character composer.
- Activity summarizes generation and LoRA-training jobs. The Create drawer still retains cancel,
  interrupt, reuse, details, and record-deletion behavior.
- Desktop and 390px checks confirmed no horizontal page scroll, one Generate action, routed Character
  Library behavior, and working mobile surface transitions.
- Production frontend/backend build and all 69 server tests pass.

Still deliberately staged:

- Tested read-only import of legacy Character Profiles into canonical Character Presets.
- Inner Dataset Builder and LoRA Lab stepper presentation; their current verified logic is preserved.
- Dataset job aggregation and Activity filters/actions.
- Contextual post-generation actions beyond the existing copy, folder, download, reuse, and delete
  controls.
- Full end-to-end ComfyUI generation/training acceptance requires the local engine and installed models
  to be online; automated unit/build validation does not substitute for that run.

## Rollback record — 2026-07-30

The user requested restoration to the interface that existed before this plan was implemented.
Because this project has no Git repository/history, a commit rollback was unavailable. The existing
legacy branch was promoted back to the default instead:

- `/` now renders the original three-column Photo/Video workspace and four-mode
  Image/Video/Dataset/LoRA Lab selector.
- The inline Prompt Studio, Character Profiles, LoRA Registry Manager, permanent queue/details rail,
  gallery, Dataset Builder, and LoRA Lab remain reachable.
- The Create/Library/Train/Activity shell and routed Library pages are retained only behind
  `/?modern=1`; no backend, model, dataset, LoRA, workflow, or stored user data was removed.
- Production frontend/backend build and all 69 server tests pass.
- Browser verification at 1440px confirmed no horizontal overflow and successful access to Image,
  Video, Dataset, and LoRA Lab.
