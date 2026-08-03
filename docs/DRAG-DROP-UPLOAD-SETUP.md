# Drag-Drop Upload — Implementation Setup & Source Map

**Status:** **implemented 2026-07-31**  
**Baseline after change:** `npm test` → **77 passed**; `npm run build` green; live smoke for lora/diffusion/checkpoint + 409 duplicate + 400 bad extension.  
**Spec:** `docs/DRAG-DROP-UPLOAD-DESIGN.md`  
**Rollback snapshots:** `docs/_rollback/drag-drop-upload-*` (pre-change copies of `index.ts`, `main.tsx`, `styles.css`, `CLAUDE.md`)

This document is the **coding handoff** for the additive library-upload feature. It confirms
environment access, freezes the verified baseline, maps every integration point to real code, and
defines the safe file plan so implementation does not touch generation or discovery behavior.

---

## 1. Access confirmation (verified 2026-07-31)

| Surface | Path | Access |
| --- | --- | --- |
| App repository | `Z:\codex app` | **Yes** — read/write |
| Obsidian vault | `C:\Users\losth\Documents\ClaudeBrain` | **Yes** — read/write |
| Formal project notes | `...\02 Projects\Z-Image Studio\` | **Yes** |
| Curated memory | `...\00-Claude-Global-Memory\PROJECT-ZImageStudio.md` | **Yes** |
| Studio API (runtime) | `http://127.0.0.1:3199` | start via desktop shortcut when needed |
| ComfyUI (runtime) | `http://127.0.0.1:8188` | required for live discovery after upload |

PowerShell working directory for all verify commands:

```powershell
Set-Location "Z:\codex app"
```

---

## 2. Verified baseline (do not regress)

| Check | Result |
| --- | --- |
| `npm test` | **70 passed** / 14 files (2026-07-31) |
| Design target | keep 70+ green; new validator unit test(s) expected to raise count |
| Production build | `npm run build` (app Vite + server tsc) must stay green after changes |
| Default UI | unchanged when drop zone is never used |

Prime docs before editing:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/UI-INVENTORY.md`
4. `docs/DRAG-DROP-UPLOAD-DESIGN.md` (purpose: **generation use**, not mere storage)

---

## 3. Purpose (one sentence)

Drop `.safetensors` into the correct Comfy-registered folder → existing auto-index (`GET /api/models` /
`GET /api/loras`) → selectable in Photo controls → normal `/api/generate` path. **Zero pipeline changes.**

---

## 4. Auto-index (read-only — route into it)

From `ComfyUI/extra_model_paths.yaml` (base `Z:/codex app`):

| Kind field | Destination folder | Discovered by | Used by |
| --- | --- | --- | --- |
| `lora` | `lora/` | `GET /api/loras` | LoRA stack → generate |
| `diffusion` | project root `.` | `GET /api/models` | Model picker → generate |
| `checkpoint` | `checkpoints/` | `GET /api/models` | Model picker → generate |

### Existing discovery (do not modify behavior)

| Route | File | Approx lines | Behavior |
| --- | --- | --- | --- |
| `GET /api/loras` | `server/src/index.ts` | ~228–238 | Comfy `LoraLoaderModelOnly` names + `LoraRegistry.list`; optional `?architecture=` filter requires verified |
| `PUT /api/loras/registry/:filename` | same | ~239–283 | User classification via `LoraRegistryManager` |
| `GET /api/models` | same | ~300–324 | UNET diffusion + Illustrious checkpoints; `adapterForModel` / architecture; unknown stays in list but UI disables |

Architecture helper (do not change):

- `modelArchitecture(filename)` — `server/src/workflow.ts` ~L117  
  Returns `z-image | krea2 | illustrious | unknown`.

Registry auto-seed already exists for newly discovered LoRA **names** from Comfy:

- `LoraRegistry.list()` — `server/src/lora-registry.ts` ~L93–102  
  Missing registry rows get `{ filename, architecture: inferArchitecture(metadata), verified: false }`.  
  Upload may optionally pre-seed the same shape; do **not** invent activation words or force verified.

### Client refresh hooks (reuse — do not invent a second index)

| Function | File | Role |
| --- | --- | --- |
| `refreshModels()` | `app/src/main.tsx` ~L96 | `GET /api/models` → `setModels` |
| `refreshLoras(modelName?)` | `app/src/main.tsx` ~L97 | architecture-aware `GET /api/loras` → stack filter |
| Model section UI | `app/src/main.tsx` ~L191 | `.model-section` + picker + Refresh |
| LoRA section UI | `app/src/main.tsx` ~L192 | `.lora-section` + stack + Refresh |

Post-upload success path:

1. `POST /api/library/upload` returns discovery payload  
2. Client calls the **same** `refreshModels` / `refreshLoras` the Refresh buttons use  
3. New item appears for selection when Comfy lists it and architecture rules allow

**Note:** ComfyUI must be running for discovery routes. After a large file lands, a Refresh may be
needed once so `object_info` lists the new name. Do not build a parallel filesystem-only model index.

---

## 5. Existing patterns to reuse (do not reinvent)

### Multer disk staging

`server/src/index.ts` ~L112–146:

| Uploader | Dest | Max size | Purpose |
| --- | --- | --- | --- |
| `upload` | `ComfyUI/input/z-image-studio` | 512 MB | video refs |
| `photoUpload` | same | 64 MB | image refs / masters |
| `trainingUpload` | `data/training-staging` | 25 MB | training/dataset images |

**New** library uploader should follow the same shape:

- `diskStorage` → dedicated staging dir under app-owned path, e.g. `data/library-upload-staging`
- UUID temp filename + original extension
- `fileFilter` allowlist `.safetensors` (optional LoRA `.pt`/`.pth` only if explicitly enabled)
- High but explicit size limit (models can be multi-GB; pick a documented cap, e.g. 20 GB, and
  fail clearly when exceeded)
- After validation: **atomic rename** into final folder (pattern already used when installing
  trained LoRAs and when adding dataset images ~L643–644)

### Path safety

| Helper | File | Use |
| --- | --- | --- |
| `safeOutputPath(root, filename, subfolder?)` | `workflow.ts` ~L458 | reject abs paths / `..` escape |
| `resolveInside(root, ...segments)` | `file-utils.ts` | same for dirs |
| `writeJsonAtomic` | `file-utils.ts` | registry writes only |

**Never overwrite:** if final path `fs.existsSync`, return **409**. Prefer `fs.constants.COPYFILE_EXCL`
or rename into a non-existing target only. Training already uses `COPYFILE_EXCL` for installed LoRAs
(~index.ts L1138).

### Root resolution

```ts
// server/src/index.ts ~L31–32
const root = path.resolve(here, "../.."); // Z:\codex app
```

Destination map for the new route:

```ts
const libraryDestinations = {
  lora: path.join(root, "lora"),
  diffusion: root,                    // UNET / split models at project root
  checkpoint: path.join(root, "checkpoints")
} as const;
```

Ensure `checkpoints/` exists (`fs.mkdirSync(..., { recursive: true })`) before rename; do **not**
create or edit `extra_model_paths.yaml`.

---

## 6. Recommended file plan (additive only)

### Create (preferred)

| File | Role |
| --- | --- |
| `server/src/library-upload.ts` | Pure validators + destination resolution + (optional) free-disk / size helpers — unit-testable without Express |
| `server/src/library-upload.test.ts` | Focused tests: bad extension, path traversal, duplicate name, valid `.safetensors`, kind → folder |
| `app/src/LibraryUpload.tsx` | Overlay drop zone + kind modal + progress + button trigger; props for `onUploaded` / refresh callbacks |
| CSS under existing `styles.css` | **Scoped** classes only (e.g. `.library-upload-overlay`, `.library-upload-modal`) — no shell rewrite |

### Touch lightly (wire-in only)

| File | Change |
| --- | --- |
| `server/src/index.ts` | Register multer + `POST /api/library/upload`; import helpers; **do not** edit `/api/models` or `/api/loras` bodies |
| `app/src/main.tsx` | Mount `<LibraryUpload />`; pass `refreshModels` / `refreshLoras`; add small “Upload model/LoRA” controls in model + LoRA section headers only |
| `app/src/styles.css` | Append scoped overlay/modal styles at end; follow UI-INVENTORY guardrails |

### Do not open for behavioral edits

- `server/src/workflow.ts` builders / `modelArchitecture` / `generationSchema`
- `server/src/comfy.ts`, video/dataset/training pipelines
- `ComfyUI/**`, `extra_model_paths.yaml`, venv, custom nodes
- Existing model / LoRA / checkpoint **files** on disk
- `/api/generate` and monitoring logic

---

## 7. API contract (to implement)

### `POST /api/library/upload`

- **Content-Type:** `multipart/form-data`
- **Fields:**
  - `kind`: `"lora" | "diffusion" | "checkpoint"` (required)
  - `files` or `files[]`: one or more binary files (match existing multer field naming carefully)
- **Validation:**
  1. kind allowlist  
  2. extension allowlist (default `.safetensors`)  
  3. sanitize `originalname` → basename only; reject `\`, `/`, `..`, absolute paths  
  4. `safeOutputPath(destDir, safeName)` must succeed  
  5. if `path.join(destDir, safeName)` exists → **409** `{ error: "..." }`  
  6. size / free-disk checks before or during stream  
  7. stream to staging temp → rename into place  
- **On LoRA success (optional seed):**  
  `loraRegistry.upsert({ filename, architecture: modelArchitecture(filename) or infer, verified: false, activationWords: [] })`  
  Prefer leaving activations empty; `list()` already soft-seeds from Comfy names.
- **Response 201 (suggested shape):**

```json
{
  "uploaded": [{ "filename": "example.safetensors", "kind": "lora", "pathKind": "lora" }],
  "models": [ /* same shape as GET /api/models, if kind is diffusion|checkpoint */ ],
  "loras":  [ /* same shape as GET /api/loras, if kind is lora */ ]
}
```

Reuse the **same code paths** that build the GET responses (extract tiny shared helpers if needed, but
prefer calling internal functions rather than rewriting discovery). Do not change GET semantics.

- **Errors:** 400 validation, 409 duplicate, 507/400 disk, 503 if discovery refresh fails (file still
  landed — report clearly so client can manual Refresh).

Localhost-only app already; never accept workflow JSON on this route.

---

## 8. Frontend contract (to implement)

### UX (additive, default shell unchanged)

1. **Full-window drag overlay** — visible only while dragging files over the window (`dragenter` /
   `dragleave` / `drop` with `dataTransfer.types` containing Files). Does not change three-column layout at rest.
2. **Buttons** — “Upload model/LoRA” (or Upload) in Model section and LoRA section headers beside Refresh.
3. **Kind modal** after drop/file-pick — required (LoRA vs diffusion vs checkpoint cannot be inferred
   from `.safetensors` alone).
4. Client pre-check extension + size; show per-file progress; surface 409/400 messages clearly.
5. On success → `refreshModels()` and/or `refreshLoras()`; if LoRA architecture unknown / unverified,
   short notice pointing at existing **LoRA compatibility manager** (`LoraRegistryManager`).
6. Do not hard-block Generate during upload; optional soft warn if jobs are active.

### Styling

- Charcoal surfaces, lime primary, restrained borders (see `CLAUDE.md` UI design system).
- Scope under `.library-upload-*`.
- `minmax(0,1fr)`, wrap long filenames with `overflow-wrap: anywhere`.
- No horizontal page scroll; test 1440 and 390 widths after UI work.

---

## 9. Test plan

### Automated (required)

New unit tests in `library-upload.test.ts` (names illustrative):

| Case | Expect |
| --- | --- |
| `.txt` / bad extension | reject |
| `../evil.safetensors` or absolute path | reject |
| duplicate basename in target folder | reject / 409 path |
| valid `foo.safetensors` + kind `lora` | dest under `.../lora` |
| kind `diffusion` | dest under project root |
| kind `checkpoint` | dest under `.../checkpoints` |

Keep existing 70 tests green. Run:

```powershell
Set-Location "Z:\codex app"
npm test
npm run build
```

### Manual end-to-end (generation goal)

With ComfyUI + Studio running:

1. Drop a LoRA `.safetensors` → kind LoRA → file in `lora/` → Refresh/list shows it (unverified) →
   classify if needed → add to stack → **Generate**.
2. Drop a checkpoint → kind Checkpoint → file in `checkpoints/` → selectable if architecture
   classifies (Illustrious-like name) → **Generate**.
3. Drop a diffusion model → kind Diffusion → root → appears when Comfy lists UNET name → select → **Generate**.
4. Confirm unused feature: no overlay at rest; layout matches previous shell.
5. Attempt re-upload of same name → 409; existing file untouched.

---

## 10. Explicit do-not list (repeat)

- Do not overwrite, rename, move, or delete existing model/LoRA/checkpoint files.
- Do not edit `extra_model_paths.yaml`, ComfyUI, venv, or custom nodes.
- Do not change behavior of `/api/models`, `/api/loras`, `modelArchitecture`, or `/api/generate`.
- Do not invent LoRA activation words or force `verified: true`.
- Do not block the generation UI on upload I/O.
- Do not accept user workflow JSON.
- Do not bind services off localhost.

---

## 11. Suggested implementation order

1. **`library-upload.ts` + unit tests** — pure validation/destination; prove green tests first.
2. **`POST /api/library/upload`** in `index.ts` — multer + rename + optional registry seed + discovery payload.
3. **`LibraryUpload.tsx` + scoped CSS** — overlay, modal, progress, errors.
4. **Wire in `main.tsx`** — buttons + callbacks only.
5. **`npm test` + `npm run build`** + manual generation smoke.
6. **Vault update** — mark design status built; note in `PROJECT-ZImageStudio.md` and formal STATUS.

---

## 12. Related memory locations

| Kind | Path |
| --- | --- |
| Design (vault) | `02 Projects\Z-Image Studio\DRAG-DROP-UPLOAD-DESIGN.md` |
| Design (repo) | `Z:\codex app\docs\DRAG-DROP-UPLOAD-DESIGN.md` |
| This setup | `Z:\codex app\docs\DRAG-DROP-UPLOAD-SETUP.md` |
| Curated identity | `00-Claude-Global-Memory\PROJECT-ZImageStudio.md` |
| Engineering rules | `Z:\codex app\CLAUDE.md` |
| UI inventory | `Z:\codex app\docs\UI-INVENTORY.md` |

---

## 13. Session checklist for the implementer

- [ ] Read design + this setup + CLAUDE.md UI/CSS rules  
- [ ] Confirm `npm test` still 70 before editing  
- [ ] Implement pure module + tests first  
- [ ] Add route only; leave discovery routes untouched  
- [ ] Add UI overlay that is invisible at rest  
- [ ] Verify build + tests  
- [ ] Manual: drop → pick → generate  
- [ ] Document completion in vault (`STATUS` + PROJECT memory)  

## 14. What shipped

| Piece | Location |
| --- | --- |
| Pure validator / install helpers | `server/src/library-upload.ts` |
| Unit tests (7) | `server/src/library-upload.test.ts` |
| `POST /api/library/upload` | `server/src/index.ts` (additive; discovery extracted to `discoverModels` / `discoverLoras` without behavior change) |
| Overlay + kind modal | `app/src/LibraryUpload.tsx` |
| Wire-in + Upload buttons | `app/src/main.tsx` Model/LoRA sections |
| Scoped CSS | end of `app/src/styles.css` |
| Live smoke script | `scripts/library-upload-smoke.mjs` (uses disposable `zstudio_upload_smoke_*` names only) |

### Rollback (no git repo in this project)

Pre-change file copies live under `docs/_rollback/drag-drop-upload-20260731-174054/` (or the latest sibling folder).

```powershell
Set-Location "Z:\codex app"
$src = "docs\_rollback\drag-drop-upload-20260731-174054"
Copy-Item "$src\index.ts" "server\src\index.ts" -Force
Copy-Item "$src\main.tsx" "app\src\main.tsx" -Force
Copy-Item "$src\styles.css" "app\src\styles.css" -Force
Remove-Item "server\src\library-upload.ts","server\src\library-upload.test.ts","app\src\LibraryUpload.tsx","scripts\library-upload-smoke.mjs" -ErrorAction SilentlyContinue
npm run build
# Restart Studio (desktop shortcut or node server/dist/index.js)
```

Do **not** bulk-delete anything in `lora/`, project-root models, or `checkpoints/` except disposable smoke names you created yourself.

### Live smoke (optional)

With Studio on `127.0.0.1:3199`:

```powershell
Set-Location "Z:\codex app"
node scripts/library-upload-smoke.mjs
```

Creates and then removes only `zstudio_upload_smoke_*` files.
