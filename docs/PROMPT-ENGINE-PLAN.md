# Z-Image Studio — Prompt Generation & UGC Automation Engine (for Codex)

Status: native engine, seeded store/importer, resolver, metadata-backed conflict validation, dynamic
Photo application, localhost automation API, Character Library UI, managed preset uploads, and real
Dataset prefill implemented 2026-07-30. Live prompt generate→validate→submit acceptance passed.

Project: `Z:\codex app`. React/TS + Node/Express driving stock local ComfyUI. **Does not recreate inference.**
Read `docs/CLAUDE-HANDOFF.md` first, then `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/UI-INVENTORY.md`,
`docs/PROMPT-LIBRARY.md`. Treat `data/lora-registry.json` + `data/model-catalog.json` as runtime truth.

## What this is
Repurpose PromptLens's *generation brain* as a native Z-Image subsystem: generate model-aware prompts,
index them by complexity/style, auto-select LoRAs from keywords, resolve conflicts, and expose a headless
API for UGC automation — all aimed at consistent character generation. **We port the concepts, NOT the
PromptLens Python service.** No second server, no Florence/JoyCaption, no Python. Reuse Z-Image's existing
`LoraRegistry`, `applyLoraActivations`, `prompt-composition.ts`, `CharacterProfileStore`, and the Part B/C/D
face/pose/multi-character systems.

## Global guardrails (same as REFACTOR-PLAN + these)
- Additive/reversible only; `npm test` (62) + `npm run build` stay green; one item per commit; revert on red.
- Architecture-aware everywhere. Never mix architecture-specific graphs. Never expose a control the active
  architecture can't back.
- **Registry is truth.** Never infer triggers/compatibility from filenames when registry metadata exists.
- **Never auto-select unresolved/uninstalled LoRAs** — mark them, never substitute (per vault contract).
- Strip pasted `<lora:name:weight>` syntax before submission (Studio manages LoRAs separately).
- Reuse the existing atomic-write + `.bak` helper for all new `data/*.json` stores.

---

## PART 1 — Prompt Library store + importer
- New store `data/prompt-library.json`. Each entry follows the vault **automation contract**:
  `{ id, sourceRange, architecture, category, complexity: "simple"|"standard"|"detailed", style,
     promptTemplate, activationWords[], poseVariants[], requiredLora?: filename, startWeight?,
     negativePresetId?, safetyNotes[], resolved: boolean }`.
- Importer (`server/src/prompt-library.ts` + a one-shot `npm run import-prompt-library`) parses the vault
  markdown (`docs/PROMPT-LIBRARY.md` and the mirrored vault files) into the store. Idempotent, re-runnable,
  **reads vault read-only, writes only `data/`**. Entries whose LoRA is on the unresolved list get
  `resolved: false` and are excluded from auto-selection.
- Indexes (in-memory, built on load): by architecture, category, complexity, style, and associated LoRA filename.
- Seed negatives from the 7 deduplicated negative presets; reference by `negativePresetId`.
- Acceptance: importing produces N entries with correct architecture/LoRA links; unresolved LoRAs flagged;
  re-running doesn't duplicate; a unit test covers one wrestling (Illustrious/tags) and one character
  (Krea/prose) entry.

## PART 2 — Prompt generator + LoRA auto-resolver
- `generatePrompt(input)` where input = `{ architecture, modelName?, entryIds[]?, keywords[], complexity,
  style?, characters?, references? }`.
- Assemble the positive prompt from selected library templates + free keywords; pick the **serializer by
  architecture**: prose for Z-Image/Krea 2, danbooru tags for Illustrious (this is the one PromptLens concept
  worth porting — small, high value).
- **LoRA auto-resolve:** match `keywords` and entry links against registry `activationWords`/`triggerToken`;
  return *proposed* LoRAs with a confidence and reason — **do not blind-add** (keyword matching over-triggers).
  User/automation confirms; then insert activations via the existing `applyLoraActivations` and set weights
  from registry `startWeight`.
- Output a structured `GenerationRequest` (prompt, negative, loras[{filename,weight}], references, characters)
  ready for `/api/generate`. Reuse Part C composition for multi-character.
- Acceptance: a scenario pick yields a valid request; Illustrious entries emit tags, Krea entries emit prose;
  proposed LoRAs are architecture-matched and never include unresolved ones.

## PART 3 — Conflict & validation engine (the core of "add/remove params without conflicts")
- `validateRequest(request)` returns `{ ok, blocks[], warnings[], normalized }`. Runs on every add/remove so
  automation converges safely.
- **Hard blocks:** cross-architecture LoRA; unresolved/uninstalled LoRA; ambiguous-age character prompt not
  recast as adult; `<lora:...>` syntax present; weight outside registry clamp.
- **Soft warnings:** more than one major action LoRA (vault rule: only one in the first generation); total LoRA
  count/summed-weight over budget; duplicate/contradictory triggers; style LoRA fighting the target aesthetic.
- Normalization strips `<lora:>` syntax, dedups triggers, clamps weights.
- Acceptance: adding a second action LoRA warns; adding an Illustrious LoRA on a Z-Image request blocks;
  an unresolved name is refused with a clear message; tests cover each rule.

## PART 4 — Dynamic model + LoRA switching
- Selecting a library entry or character preset sets the target architecture → switch the selected model to a
  compatible one and filter the LoRA offering to `registry.compatible(architecture)`. Reuse Part D's
  model→LoRA ordering. No new switching engine — drive the existing pickers from the generated request.
- Acceptance: choosing a Krea FameGrid entry flips the model to a Krea model and hides Illustrious LoRAs.

## PART 5 — Automation API (leave open for AI hooking)
- Thin REST surface over Parts 1–3, JSON in/out, stateless: `GET /api/prompt-library` (search by
  arch/category/complexity/style/keyword), `POST /api/prompt/generate`, `POST /api/prompt/resolve-loras`,
  `POST /api/prompt/validate`, then the existing `POST /api/generate` to submit. Document request/response
  shapes in `docs/AUTOMATION-API.md`.
- This is the UGC automation entry point — an external agent can generate → validate → submit headlessly.
  No auth beyond the existing localhost binding; note that explicitly.
- Acceptance: a scripted generate→validate→submit round-trip produces an image; documented shapes match.

## PART 6 — Character presets / mini-LoRA on-ramp (the "side job")
- New store `data/character-presets.json`: `{ id, name, architecture, keywords[], triggers[], preferredLoras[],
  referenceImages: [{ path, tag: "face"|"body"|"pose" }], notes }`. Images saved under
  `data/character-presets/<id>/`, reusable across generations.
- Selecting a preset auto-populates the generator: prompt keywords, LoRA stack (via Parts 2–3), and attaches
  its face/body/pose images to the Part B (face) and pose reference systems.
- **Promote to LoRA:** one action hands the preset's reference images to the existing Dataset Builder →
  LoRA Lab pipeline. Do NOT build a new trainer.
- **Honesty (surface in UI):** presets give *reference-based* consistency — strong on Krea (identity edit),
  approximate on Z-Image. A trained LoRA is the only true identity lock. The preset is the on-ramp, not a
  substitute.
- Acceptance: save a preset from keywords + images; selecting it fills prompt/LoRAs/references; promote hands
  off to Dataset Builder; existing profiles/dataset/LoRA flows unchanged.

## UI
- New "Prompt Studio" panel reusing Part D's tabbed layout: library browse/search (by complexity/style/
  category/LoRA), scenario picker, proposed-LoRA confirm list with conflicts inline, and the optional
  face/pose/multi-character tabs from Parts B–D. Character-preset picker at the top. Keep scoped CSS per
  `docs/UI-INVENTORY.md`; verify 1440 + 390px.

## Ceilings & out of scope
- Keyword→LoRA matching over-triggers → always propose-and-confirm, never blind-add (`// ponytail:` note).
- Architecture conflict is the #1 automation failure → hard block, not warning.
- Presets ≠ identity lock (see Part 6 honesty).
- `complexity` is a fixed enum, not an AI grader (YAGNI).
- OUT: porting PromptLens Python/service, running a second server, Florence/JoyCaption analysis, real
  regional multi-character (still deferred).

## Regional-conditioning research decision (2026-07-30)

Core `ConditioningSetAreaPercentage` can spatially limit conditioning, but a verified common regional
graph was not found for all three Studio architectures. Current stronger Attention Couple/Regional
LoRA options are custom-node projects and advertise different model-family coverage. No node or model
was downloaded: the project prohibits speculative custom-node changes, and a generic switch would
overpromise attribute isolation. A future research spike must prove each architecture separately.

## Order
1 (library) → 2 (generator) → 3 (conflicts) → 4 (switching) → 5 (API) → 6 (presets). 1–3 are the engine;
land them before the API and UI. Part 6 can proceed in parallel after Part 3.
