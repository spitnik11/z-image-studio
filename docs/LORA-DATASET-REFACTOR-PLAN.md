# LoRA + Dataset Refactor Plan — organized outputs, timely POC training, retroactive models

Status: **PROPOSED (draft for review)** · Author: planning pass 2026-08-03 · Baseline: 102 tests green, build clean.

Goal (user's words, distilled):
1. Dataset **outputs** should be organized into their own labeled folders — the in-app sets are fine, the raw output folder is a flat mess.
2. LoRA training runs **too slowly** on this machine (RTX 5070, 12 GB). Make it produce a usable **proof-of-concept LoRA in a timely manner**, retuning the default toward a better speed/quality balance and rethinking "how much training" a POC needs.
3. Make training **retroactive to any model added** — dropping in a model should make it trainable where architecturally possible, without hand-editing code each time.
4. Reference: Civitai on-site LoRA trainer (small datasets 15–30 imgs, "rapid" sub-5-min runs are viable → our slowness is a settings/tier problem, not a hardware wall).

> **Scope note — "video LoRA":** the codebase has **no video-LoRA training**. SCAIL-2 is video *generation* only (`server/src/video.ts`); all LoRA training (`training.ts`, `musubi-training.ts`) is **image** LoRA for Z-Image / Krea 2. This plan improves that existing image-LoRA + dataset pipeline. If you actually want *video* LoRA training (Wan/SCAIL), that is a separate, larger feature — flagged as Phase 4, needs a decision.

---

## 0. Current state (verified by code recon, file:line)

**Dataset on-disk (4 locations, 3 organized, 1 not):**
- Organized copy: `data/datasets/<uuid>/images/NNN.png|.txt` — `index.ts:1530-1539`.
- Versioned export: `data/datasets/<uuid>/exports/<ISO-stamp>/images/*` + `manifest.json` — `dataset-review.ts:191-223`.
- Training input copy: `ComfyUI/input/lora-training/<jobId>/NNN.*` — `index.ts:574-580`.
- **Disorganized:** `ComfyUI/output/dataset-<uuid>-NNN_00001_.png` — flat root dump, all datasets + normal photos intermixed, keyed by UUID, never grouped or cleaned. Origin: `index.ts:901` & `index.ts:752` set `outputName: dataset-<id>-NNN` → `workflow.ts:718` `SaveImage.filename_prefix` (no `/` → writes to output root) → dir `index.ts:92`.

**Training (Musubi Tuner, the live path):**
- Args builder `musubi-training.ts:106-132` (Z-Image), `:79-105` (Krea 2). Hardcoded: `--optimizer_type adamw8bit`, `--blocks_to_swap 28` (Krea 26), `--fp8_base --fp8_scaled --fp8_llm`, `--gradient_checkpointing --gradient_checkpointing_cpu_offload`, `--max_data_loader_n_workers 1`, `--network_alpha == network_dim`.
- Config-driven today: `learningRate` (default 1e-4), `rank`, `steps`, `gradAccumulation` (default **4**), `resolution`, `seed` — schema `training.ts:9-14`.
- `num_repeats = 1` fixed (`musubi-training.ts:68`). Latent + text-encoder caching done **once** before training (`:107-113`) — already optimal, leave it.
- Presets (frontend only, `TrainingControls.tsx:35-38`): `quick` 512/250/r8 · `balanced` 512/500/r16 (default) · `detailed` 768/800/r32. **Presets set only res/steps/rank** — everything else is constant.
- Telemetry (sec/it, ETA) already parsed from the Musubi log: `training-telemetry.ts:34-52`, shown at `TrainingControls.tsx:302-307`.

**Model registry / retroactivity:**
- Arch detection is filename regex only: `workflow.ts:537-547`. Adapter/trainable table: `model-adapters.ts:17-57` (only `z-image` & `krea2` trainable). Trainer base/TE/VAE per arch hardcoded: `training.ts:24-33` (throws for anything else) + `musubi-training.ts:19-35`. Upload intake does **not** classify architecture: `library-upload.ts:38-52`.
- **A new architecture needs 6 edits** (regex, adapter entry, `trainingProfile` branch, `getTrainingPaths` paths, `trainingCommands` branch, matching Musubi train script). Nothing is automatic.

---

## 1. Dataset output organization  *(Phase 1 — low risk, high value)*

**Problem:** `ComfyUI/output/` is a flat dump keyed by UUID, no per-dataset grouping, no cleanup.

**Fix (primary):** put each dataset's raw generations in a labeled subfolder by giving `SaveImage.filename_prefix` a path with a `/` — ComfyUI auto-creates the subfolder.
- Compute a human slug once per dataset: `<sanitized-name-or-trigger>-<short-id>` (e.g. `emily-a1b2c3`). Store it on the dataset record so create + extend agree.
- Change `outputName` at `index.ts:901` (create) and `index.ts:752` (extend) to `datasets/<slug>/NNN`.
- `monitorDataset` already reads back via `safeOutputPath(outputDir, filename, image.subfolder)` (`index.ts:1530`) — ComfyUI reports the `subfolder` in history, so the copy step keeps working. **Verify in implementation** (add/confirm a test that the subfolder round-trips).

**Fix (secondary, opt-in):** after the successful copy to `data/datasets/<id>/images/` (`index.ts:1535`), a setting `pruneRawDatasetOutputs` (default off) deletes the now-duplicated raw file. Default off = non-destructive; on = keeps `ComfyUI/output/` clean for heavy users.

**Also:** align the create/extend prefix so extends land in the same `datasets/<slug>/` folder (continues numbering), matching the existing offset logic.

**Tests to keep green / add:** `dataset.test.ts` (6), `dataset-review.test.ts` (4), `workflow.test.ts` (SaveImage wiring, 34). Add: slug generation is filesystem-safe + stable across create/extend; subfolder round-trips through `safeOutputPath`.

---

## 2. Timely POC training + balanced default  *(Phase 2)*

**Root cause of slowness (ranked, from config):** per-step cost = `blocks_to_swap 28` host↔device traffic + CPU activation offload + fp8 quant, multiplied by **effective sample passes = steps × gradAccumulation × batch**. Current default `balanced` = 500 × 4 × 1 = **2000 passes**. Caching is already one-shot, so this is the whole cost.

**Key refactor:** lift the hardcoded knobs into the training config + presets so they can actually be tuned. Move `optimizer`, `blocks_to_swap`, `gradAccumulation`, `lrScheduler`, `networkAlpha` (decouple from rank), and `epochs` into `training.ts` schema (defaults = **current values**, so nothing regresses) and thread them through `musubi-training.ts`. Presets then override them.

**Retuned presets (starting points — benchmark to lock, see below):**

| Preset | res | steps | rank/alpha | gradAccum (eff. batch) | LR + sched | block swap | passes | intent |
|---|---:|---:|---:|---:|---|---:|---:|---|
| **POC / Quick** | 512 | 200 | 8 / 8 | 1 | 2e-4 cosine | try 20 (auto-fallback) | 200 | prove a LoRA works, minutes |
| **Balanced (default)** | 512 | 400 | 16 / 16 | 2 | 1e-4 cosine | 24 | 800 | good speed/quality on 12 GB |
| **Detailed / Quality** | 768 | 800 | 32 / 32 | 4 | 1e-4 cosine | 28 | 3200 | final runs |

Retuned balanced = **800 passes vs today's 2000** (~2.5× fewer) + lower block-swap → target a large wall-clock cut while cosine schedule + rank 16 hold quality. All numbers are hypotheses to confirm by benchmark, not guesses to ship blind.

**Dataset-size-aware steps (Civitai model):** offer an epochs mode where `steps = ceil(images × repeats × epochs / effectiveBatch)` so a 15-image POC and a 40-image set both land at a sensible amount of training instead of a fixed 200/400/800. Keep explicit-steps as an override.

**Block swap safety:** lower swap = faster but VRAM-risky. Make it a preset value with an **auto-fallback**: on CUDA OOM during the train step, bump `blocks_to_swap` up and retry once, and surface a note. Default per preset as in the table; never below what 12 GB tolerates at that res/rank.

**UI:** show each preset's expected wall-clock (derived from live `sec/it` telemetry after the first run, or a static estimate before). "POC" preset copy: "fastest, lower fidelity — use to confirm identity/coverage before a quality run."

**Benchmark step (part of Phase 2, single-job so sequential):** on one small dataset (15–20 imgs), run POC + balanced once each, record `sec/it`, total wall-clock, VRAM headroom, and a sample inference; lock the numbers from data. Record results back into this doc.

**Tests:** `training.test.ts` (schema defaults — update for new fields, keep old defaults), `musubi-training.test.ts` (arg builder — assert new knobs thread through), `training-telemetry.test.ts`. Add: preset→args mapping; OOM auto-fallback raises swap once.

---

## 3. Retroactive model support  *(Phase 3)*

**Reality check:** you cannot train a *genuinely new architecture* without an architecture-specific Musubi/kohya train script + base/VAE/TE weights — that is an upstream capability, not a config toggle. But two real wins are achievable:

**3a. New checkpoint of an already-supported arch = already works, make it visible.** LoRA training trains an adapter against the fixed `training-models/` base for that architecture, usable with *any* same-arch checkpoint. So dropping in another Z-Image or Krea 2 checkpoint is already trainable. The gap is the app doesn't *tell* you. On upload (`library-upload.ts`), classify architecture (reuse `modelArchitecture`/`inferArchitecture`) and record it + a `trainable` flag; surface "trainable ✓ / generation-only" in the UI.

**3b. Data-driven architecture registry (the real refactor).** Replace the 6 scattered hardcoded branches with **one** registry (`server/src/architectures.ts`), each entry: `{ id, detectRegex, generatable, trainable, trainingBase, vae, textEncoder, clipType, networkModule, musubiScripts, blocksToSwap, timestepSampling }`. Then `modelArchitecture`, `modelAdapters`, `trainingProfile`, `getTrainingPaths`, `trainingCommands` all read from it. **Adding a supported architecture becomes one registry entry + presence of its base files** (not 6 code edits). `missingTrainingFiles` extends to report "download X to enable training for arch Y."

**3c. (Phase 4 candidate) Illustrious/SDXL training.** You own 5 Illustrious checkpoints + many Illustrious LoRAs but can't train them locally. Illustrious = SDXL → trainable via kohya `sdxl_train_network.py`. Adding an SDXL registry entry + that script would unlock local training for your largest LoRA collection. Bigger lift (different trainer, base weights); decide separately.

**Tests:** `workflow.test.ts` (`modelArchitecture`), `registries.test.ts` (`inferArchitecture`), `library-upload.test.ts`. Add: registry-driven detection/trainability parity with the old hardcoded behavior (no regression), unknown-arch still rejected cleanly.

---

## 4. Phasing, safety, and open questions

**Phases (each: keep named tests green, add new tests, `npm test` + `npm run build`, commit as Gabriel Pina to the private repo — pre-commit secret hook already installed, weights already gitignored):**
1. Dataset output organization (Section 1) — smallest, safest, immediate quality-of-life.
2. Training config lift + retuned presets + dataset-size steps + benchmark (Section 2) — the "timely POC" payoff.
3. Data-driven architecture registry + upload classification (Section 3) — retroactivity.
4. *Optional/decision:* SDXL/Illustrious training profile; and/or true video-LoRA training.

**Skills for implementation:** `senior-backend` (Node/Express training + dataset services), `senior-frontend` (TrainingControls presets/UI), `code-reviewer` before each commit.

**Guardrails (from vault decisions):** stay local-first; preserve verified ComfyUI workflow defaults; don't build custom ComfyUI nodes; don't split `index.ts`/`styles.css`; keep BF16 default; training stays single-job. All new knobs are additive with current values as defaults.

**Open questions for you:**
- **Q1.** "Video LoRA" — did you mean the existing **image** LoRA training (what this plan improves), or do you want **new video (Wan/SCAIL) LoRA training** built (Phase 4, larger)?
- **Q2.** Phase 3c: worth adding **SDXL/Illustrious** local training so your Illustrious models/LoRAs become trainable? (bigger, but unlocks your largest collection)
- **Q3.** Dataset raw-output pruning (Section 1 secondary): default **off** (keep raw files, just organized) as proposed — OK?
