# Design Spec — Drag-and-Drop Upload for LoRAs & Models/Checkpoints

Status: **built 2026-07-31** · Verified with unit tests (77) + live multipart smoke + `npm run build`.
Implementation handoff / rollback: `docs/DRAG-DROP-UPLOAD-SETUP.md` and `docs/_rollback/drag-drop-upload-*`.
Project: Z-Image Studio (`Z:\codex app`) · React/Vite client + Express/TS server → local ComfyUI.

## Purpose (why this exists)

Let the user drag-and-drop `.safetensors` **LoRAs and diffusion models/checkpoints** into the app so
they become **usable for generation inside Z-Image Studio** — not merely stored. The end state after a
drop is: the file lands in the correct ComfyUI-registered folder, is picked up by the existing
auto-index, and then **appears as a selectable option in the Photo generation controls** (diffusion-
model picker for models/checkpoints; LoRA stack for LoRAs) and is submitted through the normal
generation pipeline. Uploading a checkpoint means the user can then pick it as the generation model;
uploading a LoRA means they can add it to the LoRA stack at a working strength and generate with it.
This is the whole point — installation is only the means; **generation use is the goal.**

**Additive only.** Must not alter or interfere with existing generation, discovery, the auto-index,
or the default UI for users who never touch the drop zone.

## Prime directive

Read `AGENTS.md`, `CLAUDE.md`, and `docs/UI-INVENTORY.md` first. Do not modify the generation
pipeline, the existing discovery routes' behavior, `extra_model_paths.yaml`, the ComfyUI environment,
or any existing file. Verification: `npm run build` + `npm test` from `Z:\codex app` must stay green
(currently **70 tests**), and the default UI must be unchanged when the feature is unused.

## How auto-index works today (route into it; do NOT change it)

ComfyUI is pointed at these folders via `ComfyUI/extra_model_paths.yaml` (base `Z:/codex app`):

| Kind | Folder | Discovered by | Used in generation by |
| --- | --- | --- | --- |
| Diffusion models (Z-Image, Krea 2) | project root `.` | `GET /api/models` | Model picker → `/api/generate` |
| Checkpoints (Illustrious XL) | `checkpoints/` | `GET /api/models` | Model picker → `/api/generate` |
| LoRAs | `lora/` | `GET /api/loras` | LoRA stack → `/api/generate` |
| Text encoders / VAE | root `.` | (out of scope) | — |

- `GET /api/models` (`server/src/index.ts` ~L300) queries ComfyUI `object_info`, merges
  diffusion_models + CheckpointLoaderSimple checkpoints, classifies each filename with
  **`modelArchitecture(name)`** (`workflow.ts`) → `z-image | krea2 | illustrious | unknown`.
  Unknown stays **disabled** in the picker (not selectable for generation).
- `GET /api/loras` (~L228) lists ComfyUI LoRAs, architecture-filtered, merged with metadata in
  **`data/lora-registry.json`** (managed by `LoraRegistryManager.tsx` + `PUT /api/loras/registry/:filename`).
- The picker already has a **Refresh** button that re-queries these routes and picks up new files —
  so the correct post-upload step is: drop the file into the right folder, then re-fetch, exactly
  like Refresh. There is no separate index to rebuild.

The consequence for this feature: as long as the uploaded file lands in the correct folder with a
name that classifies (or is classified via the registry), it flows into generation through the
**existing** picker → `/api/generate` path with **zero pipeline changes**.

## Backend (additive)

Add **one** new route group; reuse the existing `multer` disk-storage + path-validation pattern
already in `index.ts` (`trainingUpload`, `photoUpload`, `safeOutputPath`).

`POST /api/library/upload` (multipart): field `files[]` + a `kind` field.
- `kind` ∈ `"lora" | "diffusion" | "checkpoint"` → destination = `lora/` | root `.` | `checkpoints/`.
- Validation (hard):
  - Extension allowlist `.safetensors` (optionally `.pt`/`.pth` for LoRA).
  - Sanitize filename; reject separators, `..`, absolute paths; `safeOutputPath`-style guard so the
    resolved path stays inside the target folder.
  - **Reject if the name already exists — never overwrite** (CLAUDE.md rule); return 409.
  - Enforce max size, check free disk; stream to a temp name then atomically rename into place so a
    partial upload never appears as a real model.
- Response: after the file lands, run the same discovery the Refresh button uses and return the
  updated `/api/models` or `/api/loras` payload so the client can immediately offer it for generation.
- LoRA registry seeding (safe): pre-seed `data/lora-registry.json` with
  `architecture = modelArchitecture(filename)` and **status = unverified**, activation words empty.
  Do **not invent** activation words or force a classification — the user confirms via the existing
  `LoraRegistryManager`. Unknown-architecture files remain unclassified/disabled exactly as today.

Localhost-only. Never accept workflow JSON.

## Frontend (additive)

- A drop zone that does not disturb the three-column shell — e.g. a full-window drag overlay shown
  only on `dragenter` with files, plus an "Upload model/LoRA" button in the existing Model and LoRA
  sections.
- On drop: small modal to choose **kind** (LoRA / Diffusion model / Checkpoint) — required because a
  `.safetensors` LoRA and checkpoint are indistinguishable by extension. Client-side validate
  extension + size before POST; per-file progress; clear success/error (duplicate, wrong type, size).
- On success: call the existing model/LoRA refresh functions (same ones the Refresh buttons use) so
  the new item is immediately selectable for generation. If a LoRA is `unknown` architecture, nudge
  the user to classify it in the LoRA compatibility manager so architecture filtering lets them use
  it.

## Explicit "do NOT"

- Don't overwrite/rename/move existing model or LoRA files.
- Don't edit `extra_model_paths.yaml`, ComfyUI, its venv, or custom nodes.
- Don't change `/api/models`, `/api/loras`, `modelArchitecture`, or the generation flow — only add
  the upload route and read back the existing discovery.
- Don't auto-invent LoRA architecture/activation words; leave unverified for user confirmation.
- Don't block generation UI; uploads are independent file I/O (optionally warn during active jobs).

## Verification

1. `npm run build` + `npm test` — keep 70 tests green.
2. One focused unit test for the upload validator: rejects bad extension, path traversal, duplicate
   name; accepts a valid `.safetensors` and routes each `kind` to the correct folder.
3. Manual end-to-end proving the **generation** goal: drop a LoRA → appears in `lora/` and the LoRA
   stack after refresh → add it and generate. Drop a checkpoint → `checkpoints/` → select it in the
   model picker and generate. Confirm the default UI is unchanged when the feature is unused.
