# Agent review brief — Dataset stack, Improve/Refine, Instagram UGC (2026-08-03)

**Audience:** Other agents (Claude / Codex / Cursor / Grok) continuing Z-Image Studio.  
**Repo:** `Z:\codex app`  
**Vault project:** `02 Projects/Z-Image Studio/`  
**Canonical runtime handoff:** repo root `CLAUDE.md`  
**Project memory:** `00-Claude-Global-Memory/PROJECT-ZImageStudio.md`

Read this before changing Dataset Builder, master-image stack matching, Improve/Refine, or Instagram UGC mode.

---

## 1. What was built (this arc)

| Area | Status | One-line summary |
| --- | --- | --- |
| Face polish | Shipped | Optional; **single final image only** (no original/refined dual-save) |
| Neural upscale catalog | Shipped | RealESRGAN, UltraSharp, Anime 6B, Remacri + use-case copy |
| Improve / Enhance | Shipped | NovelAI-style img2img from gallery; **Refine** default vs **Rewrite** |
| Instagram UGC dataset mode | Shipped | Fixed **40-shot** lifestyle list for LoRA dataset training |
| Dataset hard stop | Shipped | Stop run cancels Comfy queue, keeps finished images |
| Master stack match | Shipped + hardened | Dataset gens use master’s **model + LoRAs**; PNG metadata on outputs |
| Manual LoRA picker (Dataset) | Shipped | Back-compat when master has no metadata / desktop PNGs |

---

## 2. Hard constraints (do not break)

1. **Additive only** to the generation pipeline. Do not rewrite ComfyUI venv, `extra_model_paths.yaml`, or official workflow JSON templates unless the user asks.
2. **Txt2img default remains empty latent + `denoise: 1`**. Improve is opt-in.
3. **Face polish ≠ identity lock.** Face Detailer is post-decode; face LoRA is the identity path.
4. **Dataset is not training.** Dataset Builder generates captioned images → Review → LoRA Lab. Don’t merge those UIs.
5. **One dataset run at a time** (server enforces).
6. **Never overwrite model/LoRA files** on upload.
7. **Master can be any local image** (desktop path is fine via browser upload). Stack auto-match is best-effort; manual model + LoRA pickers must always work.

---

## 3. Master stack matching (critical for review)

### Problem that was fixed
Dataset generation previously always submitted `loras: []` and ignored the master image’s model/LoRA stack. Desktop masters (e.g. `C:\Users\losth\Desktop\d\z-image_00240_.png`) also hard-failed inspect when Comfy was down or ffprobe was strict.

### Intended behavior
1. User picks a **master** image (upload from desktop/anywhere, or profile reference, or Studio path).
2. **Inspect** reads stack from:
   - Gallery generation record (by **original filename**, not multer UUID)
   - PNG `parameters` / `Comment` A1111 text (`Model:`, `<lora:name:strength>`)
   - Form selection as fallback
3. Every dataset sample uses that **diffusion model + LoRA list**.
4. Completed dataset PNGs get **Civitai-style parameters** metadata written in.

### Key code
| Piece | Path |
| --- | --- |
| Parse / embed PNG parameters | `server/src/civitai-metadata.ts` (`parseA1111Parameters`, `readGenerationMetaFromPng`, `matchModelFilename`, `matchLoraFilenames`, `embedCivitaiMetadataInPngFile`) |
| Stack resolve | `server/src/index.ts` → `resolveMasterGenerationStack`, `findGalleryStackByImageName`, local fallbacks |
| Inspect API (soft-fail) | `POST /api/datasets/inspect-master` |
| Dataset create | `POST /api/datasets` (uses stack; skips missing LoRAs with warning) |
| Embed on complete | `monitorDataset` → `embedCivitaiMetadataForDatasetImage` |
| UI pickers | `app/src/DatasetBuilder.tsx` (model + **LoRAs for dataset** + master-stack card) |
| Unit tests | `server/src/civitai-metadata.test.ts` |

### Soft-fail contract (back-compat)
- Inspect **must not block** dataset builds.
- If Comfy is down: discover models/LoRAs from disk folders.
- If no metadata: UI shows “Manual stack / no metadata”; user picks model + LoRAs.
- Missing LoRAs: **skip + warn**, don’t hard-crash the whole run (unless model itself missing).

### Verified sample master
`C:\Users\losth\Desktop\d\z-image_00240_.png` parses to Krea 2 INT8 + 5 LoRAs (bloomgirls, cutifier, realism_engine, TextFusion, SBBT). After restart, choose this as master and confirm stack card + LoRA list.

---

## 4. Instagram UGC dataset mode

### Behavior
- `datasetMode: "instagram-ugc"` in `server/src/dataset.ts`
- Fixed list `INSTAGRAM_UGC_SHOTS` (40): 10 close-up / 13 medium / 17 full-body
- Captions: `trigger + base identity + shot + Instagram lifestyle tags + same person…`
- Character adjustments still apply to every caption
- Extensions use `variationOffset` (same pattern as standard pose sequence)

### UI
Dataset Builder → **Dataset mode → Instagram UGC LoRA training**

### Related vault
- `UGC-WORKFLOW.md` (Option B)
- `IMAGE-TO-IMAGE-PLAN.md` / `ENHANCE-FROM-IMAGE-PLAN.md` are **Photo** finishing, not Dataset

### Verify script
```powershell
Set-Location "Z:\codex app"
npx --yes tsx scripts/verify-ig-prompts.mjs
```

---

## 5. Dataset stop run

- UI: history card → **Stop run**
- API: `POST /api/datasets/:id/stop`
- Cancels remaining Comfy queue items, interrupts running graph
- **Keeps** completed images; marks partial complete or cancelled if none

---

## 6. Improve / Refine (Photo, not Dataset)

| Mode | Denoise | Seed | Structure lock | Purpose |
| --- | --- | --- | --- | --- |
| **Refine** (default) | ≤ 0.38 | keep original | Canny/depth/LLLite from init | Fine-tune anatomy/face/detail without pose drift |
| **Rewrite** | higher | freer | off by default | Bigger changes |

Vault: `ENHANCE-FROM-IMAGE-PLAN.md`  
Code: `applyImg2ImgLatent`, `applyInitStructureLock`, `applyImprovePass` in `server/src/workflow.ts`

---

## 7. Verification contract (required after changes)

```powershell
Set-Location "Z:\codex app"
cd server; npm test; npm run build
cd ..\app; npm run build
```

Manual smoke:
1. Dataset + master from Desktop `d\z-image_00240_.png` → stack card shows Krea + LoRAs (or manual pick works).
2. Instagram mode 12-image test → captions contain shot text + trigger.
3. Stop run mid-build → finished images remain.
4. Photo Improve → Refine defaults → pose holds better than old Medium rewrite.

---

## 8. Known pitfalls for agents

| Pitfall | Correct behavior |
| --- | --- |
| Multer renames uploads to UUID | Match gallery by **originalFilename** |
| Desktop path never hits server filesystem | Browser **uploads** the file; server reads temp upload path |
| `ffprobe` on inspect | Soft validation only; don’t require probe for inspect |
| Comfy down during inspect | Disk fallback lists; don’t 400 the UI |
| Dataset `loras: []` regression | Always pass `datasetLoras` / matched stack into `generationSchema` |
| Face polish dual-save | Only polished final image |
| Illustrious vs Krea LoRA loaders | Architecture-aware availability + graph builders |

---

## 9. Suggested next work (not started)

- Live smoke of full 40 Instagram run + LoRA Lab handoff
- Optional “import stack from any gallery record” without re-upload
- Dataset count/size aligned to master aspect (master was 1080×1920; dataset default still 512×768)
- True NovelAI dual Noise inject (currently blended into denoise)

---

## 10. File index (touch list)

```
server/src/dataset.ts
server/src/dataset.test.ts
server/src/civitai-metadata.ts
server/src/civitai-metadata.test.ts
server/src/workflow.ts          # Improve/Refine, face polish single path
server/src/index.ts             # datasets routes, inspect, stop, stack resolve
app/src/DatasetBuilder.tsx
app/src/main.tsx                # Improve UI
app/src/upscale-catalog.ts
app/src/styles.css
scripts/verify-ig-prompts.mjs
docs/ENHANCE-FROM-IMAGE-PLAN.md
vault: UGC-WORKFLOW.md, STATUS.md, PROJECT-ZImageStudio.md, ENHANCE-FROM-IMAGE-PLAN.md
```

---

## 11. Paste pointer for other chats

Copy the block in the user-facing message (section below in chat). Keep this file as the long form.

**Last updated:** 2026-08-07 · Agent: Grok Build

## 13. Dataset Run seed (2026-08-03 evening)

See vault `STATUS.md` / `UGC-WORKFLOW.md`: Run seed under Dataset size; never hardcode 42; rebuild `app/dist` for UI on :3199.

## 14. Nyx latex fetish mode + dataset size (2026-08-07)

### What shipped
| Area | Detail |
| --- | --- |
| Mode | First-class `datasetMode: "nyx-latex-fetish"` (peer of Instagram UGC, **not** a sub-list) |
| Prompts | `data/dataset-prompt-lists/nyx-latex-fetish.json` — 10 preserved NSFW latex shots |
| Wrap | Any list length; `promptIndexForSlot` wraps for count 12/24/40 |
| Negative | `DEFAULT_NYX_LATEX_FETISH_NEGATIVE` — identity/quality only; **no anti-nudity** (X-friendly) |
| Size | Default still **512×768**; optional **1530×2048**; schema max **2048** (matches Photo) |

### Backwards compatibility (do not break)
1. **Modes** — `standard` and `instagram-ugc` unchanged. New mode is additive in the zod enum only.
2. **Stored jobs** — Records with missing/`standard`/`instagram-ugc` mode keep prior behavior. Phase labels and negatives still resolve by mode; unknown/empty → standard defaults.
3. **Instagram list** — Still `data/dataset-prompt-lists/instagram-ugc.json`. Nyx mode coerces list id so IG prompts never leak into Nyx builds (and vice versa via mode defaults).
4. **promptListId** — Default remains `instagram-ugc`. List modes set the correct id from the UI; server coerces by mode when mismatched.
5. **Size** — Default remains `512×768`. Only the **max** was raised (1024→2048) and `multipleOf(64)` was removed so Photo-class sizes like 1530×2048 work. Existing 512/768/1024 jobs still validate.
6. **API** — Same create/extend/stop/review paths. No new required fields; new mode is optional on create.
7. **Negatives** — Instagram clothing-aware default preserved. Nyx does **not** reuse that default.
8. **Ops** — After server change: `npm run build -w server` **and restart** `node server/dist/index.js`. After UI: `npm run build -w app` + hard-refresh.
