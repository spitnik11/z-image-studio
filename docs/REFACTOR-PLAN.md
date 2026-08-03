# Z-Image Studio — Refactor & Feature Plan (for Codex)

Project: `Z:\codex app`. React/TS + Node/Express app driving stock local ComfyUI over HTTP/WebSocket
using the official Z-Image Turbo workflow. **The app does not recreate inference.**

Status: Parts A–D were completed and verified on 2026-07-30. This file is retained as implementation
history, not an open task list. Current behavior and guardrails live in `CLAUDE.md`,
`docs/ARCHITECTURE.md`, and `docs/UI-INVENTORY.md`.

---

## 0. Global guardrails — apply to EVERY item below

- Do NOT build custom ComfyUI Python nodes, execution routers, or memory-management nodes. Do NOT call
  `free_memory` / `unload_all_models` / manual `gc.collect`. ComfyUI owns memory management.
- Do NOT change verified workflow defaults: CFG 1.0, `res_multistep`, simple scheduler, 8 steps,
  zeroed negative conditioning, AuraFlow shift 3, Lanczos exact-size scale. BF16 stays the default/quality path.
- Do NOT move, rename, requantize, or delete any existing model, dataset, or LoRA. New models are added
  and selected, never swapped in place.
- Everything is **architecture-aware**. Z-Image and Krea 2 have different capabilities; gate features by
  the detected architecture and the existing `ReferenceCapability` availability model. Never expose a
  control that the active architecture can't back.
- Every change is additive, reversible, and behind existing patterns. After each item run `npm test`
  (in `server`) and `npm run build`; both stay green. One item per commit. If a test goes red, revert.

---

## PART A — Performance & maintenance (do first; lowest risk)

### A1. Performance (config/workflow only)
1. **Launcher flags** — `scripts/start-z-image-studio.ps1`: add `--fast fp16_accumulation`. Do NOT use
   bare `--fast` (toggles an fp8 matmul quality knob). Confirm async offload + pinned memory active on start.
2. **Tiled VAE decode above a size threshold** — in `server/src/workflow.ts` `buildWorkflow` (VAE decode
   node), use `VAEDecodeTiled` only when `width*height` ≥ 1080×1920; keep `VAEDecode` below that. Identical
   output at normal sizes.
3. **Pre-generation memory estimate/warning** — extend `app/src/memory-estimate.ts`: rough VRAM estimate
   from model + resolution × quantity × active LoRA count; non-blocking advisory when high. Read-only.

> fp8 selectable models (fp8 Z-Image Turbo ~6 GB + fp8 qwen3_4b ~4 GB) is a **model-file download, no
> code** — the picker already lists root `.safetensors` by architecture. Not a Codex task; user drops files in.

### A2. Maintenance / protect-work (repo-grounded — all 10 server tests are mocked; no live-Comfy smoke)
4. **`npm run smoke`** — submit ONE tiny real generation (512×512, 8 steps, current default model) to a
   running ComfyUI and assert a PNG returns within a timeout. Only guard against Comfy/dependency drift
   breaking the verified workflow. Skip cleanly with a clear message if ComfyUI isn't up.
5. **Atomic writes + `.bak` for user state** — for every write to `data/*.json` (character-profiles,
   lora-registry, model-catalog, generations, dataset-jobs, training-jobs): write temp → atomic rename over
   target, keep previous as `<name>.bak`. Protects irreplaceable work. Centralize in `server/src/file-utils.ts`.
6. **`npm run prune`** — trim `outputs/*.json` sidecars older than N days (default 30) and truncate/rotate
   `logs/*.log` above a size cap. Never touches images, datasets, or `data/` state.
7. **`VERSIONS.md`** — record the verified stack: ComfyUI 0.28.0, torch 2.13.0+cu130, CUDA 13.0, app
   Python 3.13 / training Python 3.10. Pure doc; makes an update-break diagnosable against a baseline.
8. **Durable settings** — persist app generation defaults (model, size, steps, CFG, format) to
   `data/settings.json`, loaded on start, written on change. Optional + defaulted → unchanged behavior when absent.

---

## PART B — Face-preservation subsystem (second reference system, coexists with pose/direct)

**Research conclusion (2026-07-30):** face-from-reference without training is architecture-split.
- **Krea 2** (Qwen-Image-Edit family): native identity preservation via **Krea Identity Edit v1.2** (already
  installed, strongest path). This is the real face lock.
- **Z-Image**: NO IP-Adapter/InstantID-FaceID equivalent. Reference-only options are (a) **face-swap /
  Face Detailer post-pass** (detect the reference's face → low-denoise inpaint onto the Z-Image output;
  approximate, not a true lock) using the already-installed Impact Pack + `face_yolov8m.pt`, or (b) a
  **face LoRA** via existing LoRA Lab (highest fidelity). Do NOT promise a Z-Image identity lock the model can't do.

**Design — extend, don't rebuild** (`app/src/PhotoReferences.tsx` + `server/src/workflow.ts` + `model-adapters.ts`):
- Add `"face"` to `PhotoReference.mode` (currently `"pose" | "direct"`). A Face reference is a distinct card
  type that coexists in the same up-to-4 stack, so **Face + Pose in one generation already works** through the
  existing multi-reference stack (this is what the current Character Consistency option approximates: identity
  master + pose target).
- Add a `"face"` (or reuse `"identity"`) entry to the `ReferenceCapability` model with an architecture-aware
  provider + availability message:
  - Krea 2 → provider = Krea Identity Edit; `available: true`.
  - Z-Image → provider = Face Detailer post-pass; message states it's an approximate swap, recommends a face
    LoRA for a true lock; `available: true` only if Impact Pack + `face_yolov8m.pt` present (already installed).
- `buildWorkflow` routes a `mode:"face"` reference to the architecture's identity path (Krea Identity Edit
  node chain) or, on Z-Image, appends the Face Detailer post-pass at denoise ~0.40 seeded from the reference face.
- Face reference has its own influence/strength slider (reuse existing `strength` range).

**Acceptance:** a single generation with one Face reference + one Pose reference completes on both
architectures; Z-Image shows the "approximate / LoRA for true lock" advisory; Krea uses native identity edit;
existing pose/direct/consistency behavior unchanged; tests + build green.

---

## PART C — Multi-character prompt composition (NovelAI-inspired)

**User model:** a base prompt, a negative prompt, then per-character blocks; the whole thing composes into a
single organized, additive output prompt, ordered by how many characters are added. Each character can carry
its own Face / Pose / Style reference.

**Honesty / ceiling (must be surfaced in UI):** concatenating multiple character prompts into one positive
prompt causes **attribute bleed** between characters (classic multi-subject failure). NovelAI V4 avoids it
with per-character cross-attention conditioning, not concatenation. Ship the additive-text version as the MVP;
mark regional conditioning as the real fix.

**MVP now (server-side compose — reuse existing keyword-dedup composition in `server/src/index.ts`):**
- Data model: `characters: [{ id, prompt, negative?, references: PhotoReference[] }]`, plus the existing
  global base prompt + global negative.
- Compose into one structured positive prompt: global block, then labeled per-character blocks in add-order
  (e.g. `1girl: …`, `1boy: …` style separators appropriate to the target family), deduping shared required
  keywords. Negatives merge global + per-character.
- Single ComfyUI submission; output is one image. Persist the character array in the generation record for reuse.
- `// ponytail:` comment on the compose function: naming the attribute-bleed ceiling and pointing at Part C-2.

**Phase 2 (later, heavier — do NOT build unless asked):** true per-character separation via regional
prompting / attention-couple / masks in ComfyUI. Flag as a follow-up; it's the only way to actually stop bleed.

**Acceptance (MVP):** adding 1–N characters produces one ordered composed prompt; removing a character
re-orders cleanly; each character's references attach to that character; single image out; tests + build green.

---

## PART D — UI restructure (workflow/ordering only, no logic change)

NovelAI (novelai.net/image) inspiration: a base prompt area, a separate "undesired content" (negative) area,
an **Add Character** action producing per-character prompt boxes, and distinct reference controls.

**Locate the Photo-mode control order in `app/src/main.tsx`** and restructure to:

1. **Prompt panel (tabbed, per character + global):** tabs `[Prompt] [Negative] [Face] [Pose] [Style]`.
   - Prompt = base positive. Negative = its own tab.
   - Face / Pose = the reference systems from Part B (each its own tab/system, not one mixed list).
   - **Style tab** routes to **style LoRA selection**, NOT an image adapter (Z-Image/Krea have no
     image→style adapter). Label it so the user knows it's LoRA-backed.
   - **Add Character** appends a character block (its own Prompt/Negative/Face/Pose/Style). Ordered, additive.
2. **Model selection.**
3. **LoRA selection — MOVED to directly AFTER model selection** (currently before it). Character/style LoRAs
   from `LoraCharacterComposer.tsx` / `LoraRegistryManager.tsx`.
4. Size/aspect, steps, CFG, seed, quantity, format.
5. Sticky Generate.

Compact the prompt-area functions (collapse the reference guidance and consistency options into the tabbed
panel so the prompt block reads top-to-bottom without the current scattered controls). Pure layout/state
reorganization — no change to `buildWorkflow`, submission, or defaults. Verify at 1440 and 390 widths per the
UI-INVENTORY guardrails; keep scoped CSS. Tests + build green.

**Acceptance:** new order renders and functions at desktop + 390px; LoRA sits after model; reference types are
separate tabs; Add Character works; no workflow-default or submission change.

---

## Suggested commit order
A1 → A2(5 first: protect data) → B → C(MVP) → D. B and C can land before D; D is the visible payoff that
ties them together. Regional multi-character (C-2) and fp8 downloads are explicitly out of scope here.
