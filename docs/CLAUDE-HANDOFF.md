# Z-Image Studio — Claude starting point

Claude should begin every Z-Image Studio task here:

1. Read `Z:\codex app\AGENTS.md`.
2. Read `Z:\codex app\CLAUDE.md` completely. It is the canonical engineering handoff and invariant
   list.
3. Read only the task-relevant source-of-truth document:
   - Architecture and model routing: `Z:\codex app\docs\ARCHITECTURE.md`
   - UI structure and responsive guardrails: `Z:\codex app\docs\UI-INVENTORY.md`
   - Latest UI, generation-state, seed, LoRA prompt, and launcher changes:
     `Z:\codex app\docs\RECENT-CHANGES-HANDOFF.md`
   - Krea LoRA triggers, weights, hashes, and guidance: `Z:\codex app\docs\KREA-LORA-CATALOG.md`
   - Illustrious models/LoRAs/triggers/licenses: `Z:\codex app\docs\ILLUSTRIOUS-CATALOG.md`
   - LoRA training: `Z:\codex app\docs\LORA-LAB.md`
   - UGC workflow: `Z:\codex app\docs\UGC-QUICK-GUIDE.md`
   - Wrestling/action, character, and negative prompt library:
     `Z:\codex app\docs\PROMPT-LIBRARY.md`
4. Treat `Z:\codex app\data\lora-registry.json` and `data\model-catalog.json` as the runtime catalog
   truth. Do not infer compatibility or triggers from filenames when registry metadata exists.
5. Read the shared project memory at
   `C:\Users\losth\Documents\ClaudeBrain\00-Claude-Global-Memory\PROJECT-ZImageStudio.md`, then open
   formal vault notes under `C:\Users\losth\Documents\ClaudeBrain\02 Projects\Z-Image Studio` only
   as needed.

Current verified baseline: 70 server tests and clean frontend/backend production builds. The
original four-workspace UI is the stable default; the unfinished shell is opt-in at `/?modern=1`.
Live Face + Pose generations passed on Z-Image and Krea 2. Illustrious image references remain
gated; its supported pose/style route is the verified LoRA catalog.

Never move or rewrite model/LoRA files to match documentation. Never merge architecture-specific
graphs. Preserve verified workflow defaults and update stale documentation only after checking code,
tests, and local runtime state.
