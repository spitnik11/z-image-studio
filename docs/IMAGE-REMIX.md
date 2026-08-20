# Image Remix (prompt-optional img2img)

Default-**off** Photo flow for NovelAI-style **Image2Image remix**:

- Base image required
- Prompt **optional** (empty → neutral placeholder on the server)
- Any Photo model + LoRA stack
- Strength / Noise / optional structure lock

## Use

1. Gallery → **Remix** on a completed Photo, **or** enable **Image Remix** and upload a base image.
2. Optionally clear or edit the prompt (steering only).
3. Switch model / LoRAs if desired.
4. Tune Strength (how far from the image) and Noise.
5. Generate.

## vs other tools

| Tool | Intent |
|------|--------|
| **Image Remix** | Same pixel lineage; reinterpret with model/LoRAs; prompt optional |
| **Improve / Refine** | Same pose; polish detail |
| **Style Maintain** | New pose; keep look via Direct + Pose refs |

## Server

- `POST /api/remix/prepare` — gallery copy or file upload → staged `z-image-studio/…` input
- `resolveGenerationPrompt()` — empty remix prompt → `REMIX_NEUTRAL_PROMPT`
- Txt2img still requires a non-empty prompt

## Rollback

`docs/_rollback/image-remix-*`
