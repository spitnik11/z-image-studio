# Image Extract — pose + prompt from an uploaded image

Turn a staged image into:

1. **Pose stick figure** (OpenPose) → Style Maintain Pose ref / ControlNet pose  
2. **Caption or tags** (Florence2 PromptGen) → Photo prompt for txt2img / Remix steering  

Model-agnostic: does **not** depend on which diffusion checkpoint is selected.

## Requirements (already on this install)

| Extract | Comfy nodes |
|---------|-------------|
| Pose | `OpenposePreprocessor` (+ LoadImage / SaveImage) |
| Prompt | LayerStyle Advance: `LoadFlorence2Model`, `Florence2Image2Prompt`, `SaveText` |

No WD14 pack required. First Florence run may download PromptGen weights under `ComfyUI/models/florence2`.

## API

- `GET /api/extract/capabilities`
- `POST /api/extract/pose` — JSON gallery/input path or multipart `image`
- `POST /api/extract/prompt` — body `mode: caption|tags`

## UI

On **Image Remix** and **Style Maintain** (when a base/look image is staged):

- **Extract pose**
- **Extract caption** (natural language — good for Krea / Z-Image)
- **Extract tags** (PromptGen mixed caption — better for Illustrious)

## Agent flow

```text
prepare/remix image
  → POST /api/extract/prompt { mode: "caption"|"tags" }
  → optional POST /api/extract/pose
  → POST /api/generate (txt2img, Remix, or Style Maintain)
```

## Ops

Studio-only. Avoid Comfy restart unless Florence weights were just installed.
