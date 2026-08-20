#!/usr/bin/env python3
"""Generate Desktop agent design MD from live Studio APIs."""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

STUDIO = "http://127.0.0.1:3199"
DEST = Path(r"C:\Users\losth\Desktop\Z-Image-Studio-Agent-Image-Gen-Design.md")
TODAY = "2026-08-18"


def fetch(url: str):
    with urllib.request.urlopen(url, timeout=45) as r:
        return json.loads(r.read().decode("utf-8"))


def esc(s) -> str:
    return str(s or "").replace("|", "/").replace("\r", "").replace("\n", " ").strip()


def main() -> None:
    models = fetch(f"{STUDIO}/api/models")
    lora_path = Path(os.environ["TEMP"]) / "zstudio-loras.json"
    if lora_path.exists():
        loras = json.loads(lora_path.read_text(encoding="utf-8"))
    else:
        loras = fetch(f"{STUDIO}/api/loras")
        # normalize activation field if API returns activationWords
        for x in loras:
            if not x.get("activation") and x.get("activationWords"):
                x["activation"] = ", ".join(x["activationWords"])
            if x.get("strength") in (None, "") and x.get("recommendedStrength") is not None:
                x["strength"] = x["recommendedStrength"]

    out: list[str] = []
    w = out.append

    w("# Z-Image Studio — Agent Image Generation Design Spec")
    w("")
    w(
        "> **Purpose:** Single source of truth for AI agents (and humans) driving local Z-Image Studio "
        "Photo generation: which model/LoRA to pick, how the transparent-asset suite works for logos/"
        "game assets, and how to call the app safely without breaking existing flows."
    )
    w(">")
    w("> **Audience:** Skill authors, coding agents, automation prompts.")
    w(">")
    w(
        "> **Studio:** `http://127.0.0.1:3199` · **ComfyUI:** `http://127.0.0.1:8188` · "
        "**Repo:** `Z:\\codex app` · **GitHub:** `spitnik11/z-image-studio`"
    )
    w(">")
    w(f"> **Snapshot date:** {TODAY} · Models: {len(models)} · LoRAs: {len(loras)}")
    w("")
    w("---")
    w("")
    w("## 0. How agents should use this document")
    w("")
    w("1. **Pick an architecture** from §1 (decision tree), never mix LoRA families across architectures.")
    w("2. **Pick a checkpoint** from §2 that matches that architecture.")
    w("3. **Pick 0–3 LoRAs** from §3 for that family (character/body/style/action). Prefer verified adapters.")
    w(
        "4. If the deliverable needs **alpha / cutout** (logo, sticker, sprite, UI icon, product on "
        "transparent), enable **Transparent PNG asset** (§4)."
    )
    w("5. Follow the **playbook** in §5 for the task type.")
    w("6. Obey **invariants** in §6 (default-off finishes, no Comfy restart for Studio-only edits, PNG for transparent).")
    w("7. Use §7–§8 for FormData/API contract and verification.")
    w("")
    w(
        "**Skill-author note:** Prefer linking sections by id (for example \"use §4 transparent suite\") "
        "rather than duplicating recipes inside multiple skills."
    )
    w("")
    w("---")
    w("")
    w("## 1. Architecture decision tree")
    w("")
    w("| Goal | Architecture | Why | Default recipe |")
    w("|---|---|---|---|")
    w(
        "| Photoreal / lifestyle / UGC / product photo | **krea2** | Krea 2 Turbo: fast 8-step "
        "distilled aesthetic model; strong realism + identity edit path | 8 steps, CFG 1, euler/simple |"
    )
    w(
        "| Fast photoreal alternative / Z-family | **z-image** | Z-Image Turbo: 8-step photoreal "
        "distilled; Lumina2 + AuraFlow | 8 steps, CFG 1, res_multistep/simple |"
    )
    w(
        "| Anime / illustration / Danbooru-tag look | **illustrious** | Illustrious / SDXL checkpoint "
        "graph; huge LoRA ecosystem | ~24–30 steps, CFG ~4–5.5, DPM++ / Euler A |"
    )
    w(
        "| Pixel / sprite / game tiles (SDXL pixel) | **illustrious** (+ pixel checkpoint/LoRA) | "
        "Pixel Art Diffusion XL + ArsMJ LoRA on Illustrious graph | ~20–30 steps, CFG ~5–7, square 1024 |"
    )
    w(
        "| Anima anime family | **anima** | Qwen3-0.6B TE + Qwen Image VAE; anime only | "
        "~30 steps, CFG 4, euler/simple |"
    )
    w(
        "| Video / motion | **SCAIL Video mode** (not Photo) | Wan 2.1 SCAIL-2 weights — do not use "
        "as Photo diffusion | Video UI |"
    )
    w("")
    w("### Hard rules")
    w("")
    w(
        "- **Never** load a Krea LoRA on Illustrious/Anima/Z-Image (and vice versa). Studio rejects "
        "unverified/mismatched LoRAs at generate."
    )
    w(
        "- **Pony** checkpoint (`AutismMix Confetti`) uses the Illustrious *graph* but **Pony LoRA "
        "ecosystem** — Illustrious LoRAs are hidden for it."
    )
    w("- **Unknown** entries in the picker are disabled for Photo.")
    w(
        "- Optional finishes (neural upscale, face polish, **transparent asset**) are **default OFF** "
        "and must not be assumed."
    )
    w("")
    w("---")
    w("")
    w("## 2. Diffusion model catalog (live)")
    w("")
    w("| Filename | Display | Arch | Purpose / best use | Recommended settings | Notes |")
    w("|---|---|---|---|---|---|")
    for m in sorted(models, key=lambda x: (str(x.get("architecture")), str(x.get("name")))):
        dn = m.get("displayName") or m["name"].replace(".safetensors", "")
        arch = m.get("architecture") or "unknown"
        fam = m.get("displayFamily") or m.get("loraArchitecture") or ""
        purpose = m.get("usageGuide") or ""
        name_l = m["name"].lower()
        if not purpose:
            if arch == "z-image":
                purpose = "Z-Image Turbo photoreal distilled checkpoint. Fast general photo gens."
            elif arch == "krea2":
                purpose = "Krea 2 Turbo INT8 — fast aesthetic photoreal / lifestyle; pair with Krea LoRAs only."
            elif arch == "anima":
                purpose = "Anima-family anime checkpoint. Anime/illustration only; Anima LoRAs only."
            elif arch == "illustrious":
                purpose = "Illustrious/SDXL-family checkpoint for anime or realism (see name)."
            if "wan" in name_l or "scail" in name_l:
                purpose = "SCAIL / video diffusion weight — use Video mode, not Photo picker."
            if "hyphoria" in name_l:
                purpose = "Unclassified in Studio (architecture unknown) — do not select for Photo until registered."
        rec = "—"
        r = m.get("recommended")
        if r:
            rec = f"{r.get('steps')} steps / CFG {r.get('guidance')} / {r.get('sampler')} / {r.get('scheduler')}"
        elif arch in ("krea2", "z-image"):
            rec = "8 / CFG 1"
        elif arch == "anima":
            rec = "~30 / CFG 4"
        elif arch == "illustrious":
            rec = "~24–30 / CFG 4–5.5"
        notes_parts = []
        if fam:
            notes_parts.append(f"family: {fam}")
        la = m.get("loraArchitecture")
        if la and la != arch:
            notes_parts.append(f"loraArch: {la}")
        notes = "; ".join(notes_parts) or "—"
        w(f"| `{m['name']}` | {esc(dn)} | {arch} | {esc(purpose)} | {esc(rec)} | {esc(notes)} |")
    w("")
    w("### Ecosystem context (external)")
    w("")
    w(
        "- **Z-Image Turbo:** Distilled high-speed photoreal; typically 8 NFE steps, CFG ~1. Base "
        "variant is for finetunes/LoRA training more than day-to-day gens."
    )
    w(
        "- **Krea 2:** Train LoRAs on **RAW**, run inference on **Turbo** (8 steps). Broad aesthetic "
        "range; strong for creative + photoreal UGC."
    )
    w(
        "- **Illustrious XL:** SDXL anime/illustration ecosystem with Danbooru-style tagging and large "
        "LoRA supply."
    )
    w("- **Anima:** Smaller anime stack in Studio with dedicated TE/VAE; no image-reference identity path yet.")
    w("")
    w("---")
    w("")
    w("## 3. LoRA catalog by architecture (live)")
    w("")
    w(
        "Columns: **Purpose** is the agent-facing use; **Activation** must appear in the prompt when "
        "*Insert LoRA keywords* is ON (default). When that toggle is OFF, still send the LoRA in "
        "`loras` JSON — weights apply, keywords are not auto-inserted."
    )
    w("")

    def table_for(arch: str, title: str, intro: str) -> None:
        xs = [x for x in loras if x.get("architecture") == arch]
        xs.sort(key=lambda x: (str(x.get("category") or "z"), str(x.get("displayName") or x.get("name"))))
        w(f"### {title} ({len(xs)})")
        w("")
        w(intro)
        w("")
        w("| Adapter | Category | Activation | Start strength | Purpose / how to use | Verified |")
        w("|---|---|---|---|---|---|")
        for x in xs:
            name = x.get("displayName") or x["name"].replace(".safetensors", "")
            act = x.get("activation") or "(none — describe in natural language)"
            if not x.get("activation") and x.get("activationWords"):
                act = ", ".join(x["activationWords"])
            st = x.get("strength")
            if st in (None, "") and x.get("recommendedStrength") is not None:
                st = x["recommendedStrength"]
            strength = "~0.7" if st in (None, "") else str(st)
            purpose = x.get("usageGuide") or f"Use as {x.get('category') or 'adapter'} for {arch}."
            purpose = esc(purpose)[:220]
            verified = "yes" if x.get("verified") else "no"
            w(
                f"| `{x['name']}` / {esc(name)} | {x.get('category') or 'other'} | {esc(act)} | "
                f"{strength} | {purpose} | {verified} |"
            )
        w("")

    table_for(
        "krea2",
        "Krea 2 LoRAs",
        "Use only with `architecture: krea2` checkpoints. Stack lightly: usually 1 body + 1 realism/style + optional character.",
    )
    table_for(
        "illustrious",
        "Illustrious / SDXL LoRAs",
        "Use with Illustrious checkpoints (not AutismMix/Pony unless LoRA is pony-compatible). Prefer one action LoRA at a time for pose holds.",
    )
    table_for("anima", "Anima LoRAs", "Anima checkpoints only.")
    table_for("z-image", "Z-Image LoRAs", "Sparse local set; keep strengths conservative.")
    table_for("pony", "Pony LoRAs", "For AutismMix / Pony ecosystem only.")
    table_for("unknown", "Support / non-Photo adapters", "Do not treat as Photo character LoRAs (control/video helpers).")

    w("### Stacking heuristics")
    w("")
    w("| Role | How many | Tip |")
    w("|---|---|---|")
    w("| Character identity | 0–1 | Prefer a trained face/character LoRA over hoping references alone lock identity |")
    w("| Body proportion | 0–1 | `SBBT`, PAWG, Flat Chested, breast_size — do not stack conflicting body LoRAs |")
    w("| Realism / polish | 0–1 | Realism Engine / Krea2 Realism / BloomGirls — lower when stacking |")
    w("| Style | 0–1 | FameGrid, pixel, gothic, etc. |")
    w("| Action / pose | 0–1 | Illustrious submission/action set — one primary action trigger |")
    w("| Utility | 0–1 | TextFusion Refusal at 1.0; Smooth Detailer low |")
    w("")
    w("**Max stack in Studio:** 8, but quality usually peaks at **2–4**.")
    w("")
    w("---")
    w("")
    w("## 4. Transparent asset suite (logos, stickers, game assets)")
    w("")
    w("### What it is")
    w("")
    w(
        "An **opt-in Photo finishing pass** that removes the background after the image is generated "
        "at the exact canvas size, then saves an **RGBA PNG**."
    )
    w("")
    w("- UI: Photo → **Advanced settings** → **Transparent PNG asset (remove background)**")
    w("- Form field: `transparentAsset=true|false` (default **false**)")
    w("- Capability id: `transparent-asset` (from `/api/diagnostics`)")
    w("- Comfy node: `LayerMask: RmBgUltra V2` (ComfyUI_LayerStyle)")
    w("- Graph node id: `310`")
    w(
        "- Installer: `scripts/install-layerstyle.ps1` (also installs Advance for future nodes; "
        "v1 UI only needs core RmBgUltra V2)"
    )
    w("")
    w("### Pipeline order (do not reorder in skills)")
    w("")
    w("```text")
    w("Prompt + LoRAs + refs")
    w("  → sample / decode (9)")
    w("  → optional face polish")
    w("  → optional neural upscale (300–301)")
    w("  → exact Lanczos ImageScale to canvas (11)")
    w("  → [IF transparentAsset] RmBgUltra V2 (310)  // GuidedFilter defaults")
    w("  → SaveImage PNG (10)   // WebP coerced to PNG when transparent")
    w("```")
    w("")
    w("When `transparentAsset` is false, node `310` is **absent** — graphs match pre-LayerStyle behavior.")
    w("")
    w("### When agents MUST enable it")
    w("")
    w("| Deliverable | Enable transparent? | Why |")
    w("|---|---|---|")
    w("| App/game **icon**, logo mark, sticker | **Yes** | Needs alpha for compositing |")
    w("| **Sprite** / character cutout / UI element | **Yes** | Engine expects transparent PNG |")
    w("| Product packshot on transparent | **Yes** | Catalog / shop overlays |")
    w("| Normal photo, UGC, portrait, scene | **No** | Opaque photo is correct; cutout harms full-bleed scenes |")
    w("| Animated WebP | **No** (forced PNG if enabled) | Transparent path is still PNG-only |")
    w("")
    w("### Prompting for clean cutouts")
    w("")
    w("1. Subject centered, **single clear silhouette**.")
    w(
        "2. Background: `plain white background`, `solid color backdrop`, `studio seamless`, or "
        "`simple flat background` — avoid busy scenes."
    )
    w("3. Avoid ground shadows you want to keep (cutout may remove soft contact shadows).")
    w("4. Prefer **Illustrious pixel** or **Krea product** prompts for icons; for sprites use pixel checkpoint + ArsMJ LoRA.")
    w("5. Keep LoRA stack short so edges stay readable.")
    w("")
    w("### Agent recipe — logo / mark")
    w("")
    w("```yaml")
    w("architecture: krea2  # or illustrious for graphic/anime marks")
    w("transparentAsset: true")
    w("outputFormat: png")
    w("width: 1024")
    w("height: 1024")
    w("neuralUpscale: false   # optional; usually off for crisp logos")
    w("faceRefinement: false")
    w("prompt: >")
    w("  minimal flat vector-style logo of a red fox head, centered,")
    w("  clean edges, solid shapes, plain white background, no text")
    w("loras: []  # or a style LoRA if needed")
    w("```")
    w("")
    w("### Agent recipe — game sprite / pixel asset")
    w("")
    w("```yaml")
    w("architecture: illustrious")
    w("diffusionModel: pixelArtDiffusionXL_spriteShaper.safetensors")
    w("transparentAsset: true")
    w("outputFormat: png")
    w("width: 1024")
    w("height: 1024")
    w("loras:")
    w("  - name: ArsMJStyleSDXL_-_Pixel_Art.safetensors")
    w("    strength: 0.8")
    w("insertLoraKeywords: true  # ensures arsmjstylepony, pixel art")
    w("prompt: >")
    w("  arsmjstylepony, pixel art, side-view character sprite of an adult")
    w("  adventurer, idle pose, clear outline, plain white background")
    w("```")
    w("")
    w("### Failure modes")
    w("")
    w("| Symptom | Cause | Fix |")
    w("|---|---|---|")
    w("| Toggle disabled | LayerStyle not in Comfy object_info | Run installer with Comfy **stopped**, then restart Comfy once |")
    w("| Generate error about RmBgUltra | Pack missing after update | Reinstall LayerStyle; confirm capability transparent-asset |")
    w("| Halo / fringing | Busy bg or hair vs bg | Reshoot prompt with flatter bg; optional future VitMatte path |")
    w("| Subject holes | Over-aggressive mask | Simplify subject; avoid tiny lace/mesh as first test |")
    w("| Pip freeze on install | Pip while Comfy holds onnxruntime DLL | Stop Comfy before install-layerstyle.ps1 |")
    w("")
    w("### Ops note for agents")
    w("")
    w("- **Studio code changes:** rebuild + restart **only** `node server/dist/index.js` on port 3199.")
    w("- **Do not restart Comfy** unless custom nodes/deps changed (restarts have hung this machine).")
    w("")
    w("---")
    w("")
    w("## 5. Task playbooks (agent-ready)")
    w("")
    w("### 5.1 Photoreal UGC / influencer still")
    w("")
    w("1. Model: Krea 2 Turbo.")
    w("2. LoRAs: FameGrid (`famegrid`) + optional body (SBBT/PAWG) + optional Realism Engine ≤0.7.")
    w("3. `transparentAsset: false`.")
    w("4. Prompt: natural language, 3–5 sentences; start with activation words.")
    w("5. Optional: Identity/Direct reference on Krea; face polish only if needed.")
    w("")
    w("### 5.2 Product / packshot")
    w("")
    w("1. Krea 2 or Z-Image Turbo.")
    w("2. Few or no character LoRAs.")
    w("3. If catalog needs alpha → `transparentAsset: true` + plain backdrop.")
    w("4. Square or 4:5 canvas; neural upscale optional after a good base.")
    w("")
    w("### 5.3 Anime character still")
    w("")
    w("1. Illustrious checkpoint (WAI / Prefect / NXT) **or** Anima for Anima LoRAs.")
    w("2. One character LoRA + optional style; Danbooru tags OK on Illustrious.")
    w("3. Transparent only for stickers/sprites, not full scenes.")
    w("")
    w("### 5.4 Action / pose concept (Illustrious)")
    w("")
    w("1. Illustrious checkpoint.")
    w("2. Exactly **one** action LoRA; put its activation early.")
    w("3. State adult subjects, count, camera (`SideView`, `Closeup`), clothing.")
    w("4. `transparentAsset: false` unless exporting a cutout sticker of the pose.")
    w("")
    w("### 5.5 Transparent logo → game UI kit")
    w("")
    w("1. Enable transparent suite (§4).")
    w("2. Generate several seeds at 1024².")
    w("3. Prefer flat lighting, no heavy bloom.")
    w("4. Do not enable WebP.")
    w("5. Downstream: import RGBA PNG into engine/Figma; do not re-JPG.")
    w("")
    w("---")
    w("")
    w("## 6. Invariants (must not break)")
    w("")
    w("1. `transparentAsset` default **false** — opaque gens bit-identical in finish graph.")
    w("2. LoRA keyword insert default **true**; when false, LoRAs still load by weight.")
    w("3. Architecture lock: LoRA `architecture` must match model family (or pony isolation).")
    w("4. Transparent forces **PNG** SaveImage.")
    w("5. Face polish / neural upscale / transparent are independent toggles.")
    w("6. Do not put LayerStyle nodes in core `required` diagnostics list.")
    w("7. Dataset / Video / Train modes do not auto-enable transparent.")
    w("8. After `server/dist` rebuild, restart Studio process — stale Node will ignore new fields.")
    w("")
    w("---")
    w("")
    w("## 7. Generate contract (Photo)")
    w("")
    w("### Endpoint")
    w("")
    w("`POST /api/generate` multipart FormData")
    w("")
    w("### Important fields")
    w("")
    w("| Field | Type | Notes |")
    w("|---|---|---|")
    w("| `prompt` | string | Required |")
    w("| `negativePrompt` | string | Optional |")
    w("| `diffusionModel` | filename | Must exist in Comfy |")
    w("| `width` / `height` | int | Canvas edges 256–2560 |")
    w("| `steps` / `guidance` / `seed` / `batchSize` | number | Family defaults above |")
    w("| `outputFormat` | `png` or `webp` | Forced png if transparent |")
    w("| `loras` | JSON string | `[{name,strength}]` max 8 |")
    w("| `insertLoraKeywords` | `true` or `false` | Default true |")
    w("| `transparentAsset` | `true` or `false` | Default false |")
    w("| `neuralUpscale` / `upscaleModel` | bool / file | Optional |")
    w("| `faceRefinement` | bool | Optional Impact FaceDetailer |")
    w("| `references` + `referenceSettings` | files + JSON | Pose/direct/face |")
    w("")
    w("### Diagnostics")
    w("")
    w("`GET /api/diagnostics` → `capabilities[arch]` includes:")
    w("")
    w("- `transparent-asset`")
    w("- `face-refinement`")
    w("- `upscale`")
    w("- identity/face/pose/depth/structure (arch-specific)")
    w("")
    w("Agents should **disable** UI-equivalent features when `available: false`.")
    w("")
    w("---")
    w("")
    w("## 8. Verification checklist (for skills / CI smoke)")
    w("")
    w("- [ ] `/api/diagnostics` connected + `workflowReady`")
    w("- [ ] Served `app/dist` hash matches running Studio (no stale UI)")
    w("- [ ] `transparent-asset.available === true` after LayerStyle install")
    w("- [ ] Generate with `transparentAsset=false` completes opaque PNG")
    w("- [ ] Generate payload with `transparentAsset=true` includes flag + png")
    w("- [ ] LoRA keyword toggle still present; off leaves prompt unchanged but LoRA listed")
    w("- [ ] Neural upscale + face polish toggles still present")
    w("- [ ] Unit: `layerstyle-postprocess` + `workflow` tests green")
    w("")
    w("---")
    w("")
    w("## 9. Skill scaffolding hints")
    w("")
    w("When turning this MD into a Grok/Claude skill:")
    w("")
    w("1. **Trigger:** logo, sticker, sprite, transparent PNG, game asset, UGC photo, which model/LoRA.")
    w("2. **Read order:** §1 → §2/§3 filtered by arch → §4 if alpha → matching §5 playbook.")
    w("3. **Emit:** a structured plan (model, loras[], flags, prompt) before calling tools.")
    w("4. **Never** invent LoRA filenames — only use §3 / live `/api/loras`.")
    w("5. **Refresh:** if catalog drifts, re-pull `/api/models` and `/api/loras` and update tables.")
    w("6. Keep one source of truth: this Desktop MD (or a vault copy) — do not fork conflicting catalogs.")
    w("")
    w("---")
    w("")
    w("## 10. Quick reference card")
    w("")
    w("| Need | Model family | Transparent? | Example LoRA |")
    w("|---|---|---|---|")
    w("| UGC photo | Krea 2 | No | FameGrid + SBBT |")
    w("| Realism boost | Krea 2 | No | Realism Engine / Krea2 Realism |")
    w("| Anime scene | Illustrious | No | style + character |")
    w("| Wrestling/action pose | Illustrious | No | one action LoRA |")
    w("| Pixel sprite | Pixel Art Diffusion XL | **Yes** | ArsMJ Pixel Art |")
    w("| Logo / icon | Krea or Illustrious | **Yes** | none or light style |")
    w("| Anima stylized anime | Anima | Rarely | @748cmstyle / Masterpiece |")
    w("| Video | SCAIL Video mode | n/a | n/a |")
    w("")
    w("---")
    w("")
    w(
        "*Generated from live Studio catalog + LayerStyle transparent-asset implementation. "
        "Keep this file next to skill work; re-snapshot APIs when adapters change.*"
    )
    w("")
    w("### Regenerate")
    w("")
    w("```powershell")
    w("cd \"Z:\\codex app\"")
    w("python scripts\\gen-agent-design-doc.py")
    w("```")

    DEST.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"Wrote {DEST} ({DEST.stat().st_size} bytes, {len(out)} lines)")


if __name__ == "__main__":
    main()
