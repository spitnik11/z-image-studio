# Z-Image Studio — Recent Changes Design Handoff

Last updated: 2026-07-30  
Project root: `Z:\codex app`

## Purpose

This document explains the most recent UI and generation-pipeline changes. Read it before modifying
Photo generation, the result preview, seed behavior, LoRA selection, queue monitoring, or startup
scripts.

Also read:

1. `Z:\codex app\AGENTS.md`
2. `Z:\codex app\CLAUDE.md`
3. `Z:\codex app\docs\ARCHITECTURE.md`
4. `Z:\codex app\docs\UI-INVENTORY.md`

## Current product baseline

The original four-workspace interface is the stable default:

- Image
- Video
- Dataset
- LoRA Lab

**Update (2026-07-30): the unfinished `?modern=1` shell was deleted.** `main.tsx` is now a single
four-mode interface; `WorkspacePages.tsx` was removed, and the `newShell`/destination/mobile-surface
state, functions, and render branches are gone. `?modern=1` no longer does anything. If a
product-architecture migration is wanted later, build it fresh rather than resurrecting the old
branch. Dead `.studio-shell`/`.destination-*`/`.create-mobile-tabs` CSS still lives in `styles.css`
and is harmless, but it is **interleaved with shared legacy rules** (e.g. `.fine-tune-section`
summary, `.queue-head > div:last-child`) — remove it selector-by-selector, never as a wholesale
block. `CharacterPresetManager.tsx` is now unreferenced (was modern-only); keep or delete
deliberately.

The default desktop Image workspace uses three columns:

```text
┌──────────────────────┬──────────────────────────────┬──────────────────┐
│ Controls             │ Result preview              │ Activity         │
│ prompt/model/LoRAs   │ full contained image        │ queue/details    │
└──────────────────────┴──────────────────────────────┴──────────────────┘
```

At the verified 1280×720 viewport, the columns were `380px 590px 310px`. The page had no horizontal
overflow. A 1080×1920 result rendered with `object-fit: contain` inside the center preview.

## 1. Stable UI restoration

### Decision

The incomplete navigation overhaul was removed from the default launch path without deleting its
code.

### Implementation

In `app/src/main.tsx`: the `newShell` flag and the entire modern shell were **removed** on
2026-07-30. There is now one interface — the four-mode workspace at `/`.

### Guardrail

Do not treat old comments or CSS that describe `newShell`/`studio-shell`/`destination-*` as
authoritative — that shell no longer exists. Runtime behavior and `docs/UI-INVENTORY.md` define the
current baseline.

## 2. Side result preview

### User intent

Keep the generated-image preview visible beside the controls instead of forcing generation and
review into separate pages or windows.

### Current behavior

- Controls remain on the left.
- The main result canvas remains in the center.
- Activity and generation details remain on the right.
- Portrait and landscape images use their active output aspect ratio.
- Images are contained and never cropped.
- Completing or reconciling a Photo job selects its result automatically.

### Owning files

- `app/src/main.tsx`
- `app/src/styles.css`

### Guardrails

- Preserve `object-fit: contain`.
- Do not introduce fixed square preview dimensions.
- Do not remove the center `.stage` from the legacy three-column layout.
- Preserve the original/refined comparison branch.
- Do not claim a visual check unless the running application was inspected.

## 3. Generation hang diagnosis

### Observed failure

A real job displayed:

- Status: `active`
- Progress: `100`
- Current node: `null`
- Saved image: present
- ComfyUI queue: empty
- ComfyUI history: successful

The image existed, but the job stayed in Activity and was excluded from the completed gallery.

### Root cause A: terminal-state regression

The Studio monitors each generation with:

1. ComfyUI WebSocket events for immediate progress.
2. A two-second ComfyUI history poll for terminal reconciliation.

A history poll could mark a record completed and close the socket, but a socket message already
queued in Node could still run afterward. The `executing` handler set the record to `active` before
checking whether `node === null`. That late event could overwrite the completed state.

The progress handler also accepted progress events without verifying that the event belonged to the
record monitored by that socket handler.

### Fix

In `server/src/index.ts`:

- Ignore socket events after a record becomes terminal.
- Accept progress only when `msg.data.prompt_id === record.promptId`.
- For an `executing` event with `node === null`, check history before changing the record state.
- Set `active` only for a real non-null executing node.

Terminal records must remain immutable to later progress/executing events.

### Root cause B: ComfyUI restart clears history

ComfyUI prompt history is held in memory. A full ComfyUI restart can erase the history entry needed
to reconcile an older Studio record.

The affected Studio record already contained:

- A validated saved media filename.
- `progress: 100`.
- A recorded duration.

### Fix

`server/src/generation-history.ts` now exports `persistedGenerationOutcome(record)`.

Studio may recover a persisted pending/active record only when:

1. At least one saved image or video filename is already stored.
2. The record has terminal evidence: progress is at least 100 or duration is positive.

It does not infer completion from an empty ComfyUI queue. This distinction prevents a queued or
interrupted job from being falsely marked completed.

On backend startup, records satisfying that rule are finalized from their persisted media. Other
pending/active records continue through normal ComfyUI history monitoring.

### Client reconciliation

While at least one generation is pending or active, `app/src/main.tsx` refreshes `/api/gallery`
every two seconds.

This is a fallback for:

- A missed Studio WebSocket broadcast.
- A reconnect delay.
- A completion repaired by the durable server monitor.

The poll stops when no active jobs remain. It does not replace the WebSocket or the server-side
ComfyUI history monitor.

## 4. Seed lifecycle

### Previous behavior

When the seed field was empty/zero, Studio generated a random seed and then wrote that resolved seed
back into the form. Clicking Generate again reused it unintentionally.

### New default

After a successful Photo submission:

- The exact resolved seed remains stored in the generation record.
- The form seed returns to `0`.
- `0` means choose a new random seed on the next submission.

This prevents accidental duplicate-seed generations.

### Preserve option

Advanced settings now contains:

**Keep seed after generation**

- Off by default.
- When enabled, the resolved seed remains in the field after submission.
- Use it for controlled comparisons such as LoRA weight, prompt, sampler, or CFG changes.

The seed clears only after a successful submission. A rejected or failed submission preserves the
user's input so they can correct the error and retry.

### Owning files

- `app/src/main.tsx`
- `app/src/styles.css`

## 5. Independent Photo batch runs

Advanced settings separates two concepts:

- **Images per run** keeps the existing one-workflow latent batch behavior.
- **Independent runs to queue** submits 1–20 distinct ComfyUI jobs.

Every independent run receives a unique consecutive seed. A cleared seed chooses a fresh random
base; an explicit preserved seed makes the whole run sequence reproducible. Output prefixes include
`-run-N`, the Generate dock previews the total image count, and submission feedback reports both
per-run progress and partial success if a later request fails. Reference uploads are stored only by
the first submission and their resolved paths are reused for later runs.

The server briefly caches and deduplicates its expensive ComfyUI `/object_info` read, allowing the
additional batch submissions to reuse the same validated catalog without weakening architecture,
model, LoRA, or reference checks.

Live acceptance on 2026-07-30 queued and completed two Z-Image runs as separate records:
seeds `7588445542541725` and `7588445542541726`, outputs `z-image-run-1_00001_.png` and
`z-image-run-2_00001_.png`. The control was also checked at 390px without horizontal overflow.

## 6. LoRA Composer and visible prompt activations

### Previous behavior

The backend already used `applyLoraActivations(...)` to add required activation words to the
submitted prompt. LoRA Composer showed the activations, but the visible Photo prompt did not change.
This made the UI disagree with the prompt ComfyUI actually received.

### New behavior

Adding a registered LoRA through the standard picker or LoRA Composer now:

1. Adds the LoRA at its recommended strength.
2. Reads `activationWords` from the active architecture's registry record.
3. Inserts missing activation words into the visible global Photo prompt.
4. Deduplicates keywords case-insensitively.

Example:

```text
Selected LoRA: FameGrid Krea 2 Standard v1
Registry activation: famegrid
Visible prompt after selection: famegrid
```

The backend activation pass remains in place as a safety net. Do not remove it merely because the
frontend now inserts visible words.

### Removal decision

Removing a LoRA does not automatically delete words from the prompt. The same word may be intentional
prompt content or required by another selected LoRA. Automatically deleting user text would be more
destructive than leaving a visible, editable keyword.

### Owning files

- `app/src/main.tsx`
- `app/src/LoraCharacterComposer.tsx`
- `server/src/lora-registry.ts`
- `server/src/index.ts`
- `data/lora-registry.json`

### Guardrails

- Never invent activation words.
- Use only indexed registry metadata.
- Keep architecture filtering.
- Preserve server-side activation deduplication.
- LoRA strength and reference-image strength remain separate concepts.

## 7. Startup/shutdown script correction

### Observed failure

`scripts/stop-z-image-studio.ps1` checked whether a process command line contained:

```text
Z:\codex app
```

The backend is launched with the relative command:

```text
node.exe server/dist/index.js
```

The absolute path was absent, so the stop script silently left the old backend alive. A subsequent
start appeared successful but continued serving the old backend process.

### Fix

The stop script now validates exact known service signatures:

- Port 3199: `node.exe` with `server/dist/index.js`.
- Port 8188: project ComfyUI Python or `main.py` explicitly using port 8188.

Only matching local Studio services are stopped.

### Owning file

- `scripts/stop-z-image-studio.ps1`

## 8. License advisory display

The Civitai license warning beneath the selected Illustrious model was removed from the everyday
generation interface.

The license metadata remains stored in the model/LoRA registries for later review. Generation,
architecture validation, and compatibility checks were not changed.

Do not delete license metadata from registry records.

## 9. Verification performed

Current verified baseline:

- Frontend production build: passed.
- Backend TypeScript build: passed.
- Server tests: 70 passed across 14 files.
- Studio backend: ready.
- ComfyUI: ready.
- Studio active jobs: 0.
- ComfyUI running jobs: 0.
- ComfyUI pending jobs: 0.
- Previously stuck record: recovered to `completed`.
- Side preview: visible with latest result.
- Preview image: 1080×1920 source, contained without cropping.
- Browser viewport checked: 1280×720.
- Horizontal page overflow: none.
- Seed preserve control: visible and off by default.
- LoRA prompt insertion: `famegrid` visibly inserted without submitting a generation.

No expensive generation was submitted solely for UI verification.

## 10. Tests and expected commands

Run from:

```text
Z:\codex app
```

Required:

```powershell
npm run build
npm test
```

After backend changes, restart through the project scripts or desktop launcher and confirm the
backend process ID changed. Then verify:

```powershell
Invoke-RestMethod http://127.0.0.1:3199/api/gallery
Invoke-RestMethod http://127.0.0.1:8188/queue
```

Do not submit a real high-resolution generation merely to test controls. If a live acceptance render
is necessary, use the smallest architecture-valid smoke that can prove the changed behavior.

## 11. Files changed in this pass

| File | Purpose |
| --- | --- |
| `app/src/main.tsx` | Stable shell default, client reconciliation, seed lifecycle, visible LoRA activations |
| `app/src/styles.css` | Seed preserve control styling and existing preview layout |
| `server/src/index.ts` | Prompt-scoped events, immutable terminal state, startup recovery |
| `server/src/generation-history.ts` | Comfy history outcome and persisted-media recovery |
| `server/src/generation-history.test.ts` | Lost-history recovery acceptance coverage |
| `scripts/stop-z-image-studio.ps1` | Reliable identification and stopping of both local services |
| `docs/ARCHITECTURE.md` | Runtime completion/reconciliation contract |
| `docs/UI-INVENTORY.md` | Seed and visible activation UI contract |

## 12. Safe next improvements

Potential follow-ups that fit the current architecture:

1. Add a small “Finalizing output” state between 100% sampling and durable gallery completion.
2. Cache or separate heavy diagnostics so startup `object_info` timeouts do not briefly show
   “Engine offline” while ComfyUI is warming.
3. Add a focused integration test that simulates history completion followed by a late executing
   event and proves the terminal record cannot regress.
4. Add a lightweight preview image load-error state with Retry, without changing media ownership.
5. Persist the Keep-seed preference only if the user wants it remembered across application restarts.

Do not add custom ComfyUI memory management, free-memory calls, custom execution routers, or
architecture-agnostic model graphs.
