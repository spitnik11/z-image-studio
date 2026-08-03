# Illustrious XL local catalog

This catalog records the exact locally installed Illustrious assets, their ComfyUI role, creator
guidance, activation words, and distribution limits. Runtime metadata lives in
`data/model-catalog.json` and `data/lora-registry.json`; this document is the readable reference.

## Compatibility boundary

- Illustrious XL is a third Photo architecture. It does not share the Z-Image, Krea 2, or SCAIL
  conditioning graph.
- Photo uses `CheckpointLoaderSimple`, full `LoraLoader` model+CLIP chaining, Clip Skip 2,
  `CLIPTextEncodeSDXL`, the checkpoint's baked VAE, and an SDXL sampler.
- These LoRAs include text-encoder weights. Do not replace full `LoraLoader` with
  `LoraLoaderModelOnly`.
- Illustrious reference-image guidance is intentionally unavailable. Use one action LoRA for pose,
  generate the still in Photo, then animate that finished image in SCAIL Video.
- Dataset building and LoRA training remain disabled for Illustrious until a compatible trainer is
  separately implemented and verified.

## Checkpoints

| Studio name | Exact source | Recommended starting recipe | License summary |
|---|---|---|---|
| Illustrious Realism v1.0 + VAE | [model 1412827, version 1643845](https://civitai.red/models/1412827?modelVersionId=1643845) | 28 steps, CFG 4, DPM++ SDE, Karras | Credit required; commercial permission limited to Civitai rental; derivatives prohibited. |
| IllustriousNXT XL v2.0 | [model 1629360, version 2069051](https://civitai.red/models/1629360?modelVersionId=2069051) | 30 steps, CFG 5, Euler A, SGM Uniform | Credit required; commercial permission limited to Civitai rental; derivatives prohibited. |
| WAI Illustrious SDXL v11 | [model 827184, version 1612720](https://civitai.com/models/827184?modelVersionId=1612720) | 20 steps, CFG 5, Euler A, Simple | Integrated VAE and Clip Skip 2; review the current source page before commercial distribution. |
| Prefect Illustrious XL v1 | [model 992378, version 1111838](https://civitai.com/models/992378?modelVersionId=1111838) | 24 steps, CFG 5.5, DPM++ 2M, Karras | Integrated VAE and Clip Skip 2; review the current source page before commercial distribution. |

All four installed files include a VAE. Realism favors natural-language photography prompts. NXT
accepts both Danbooru-style tags and natural language and is the stronger starting point for the
action/style LoRA catalog.

## Compatible SDXL/Pony checkpoint

AutismMix SDXL Confetti is installed as a separate Pony XL / SDXL family. It uses the same
checkpoint/SDXL ComfyUI graph, but it does **not** share the Illustrious LoRA ecosystem. Studio
labels it `Pony XL / SDXL`, hides Prompt Studio's Illustrious serializer, clears the LoRA stack, and
rejects a submitted LoRA stack until Pony-compatible adapters are explicitly registered. Start with
28 steps, CFG 7, Euler ancestral, Simple and Pony quality tags such as
`score_9, score_8_up, source_anime`.

## Action and pose LoRAs

Use one major submission-hold LoRA at a time. State that all subjects are adults, specify the
number and gender of subjects, describe clothing, then add one creator pose variant. The Studio
automatically inserts the primary trigger when the LoRA is active.

| LoRA | Trigger | Start | Useful variants | Exact source |
|---|---:|---:|---|---|
| Back Choke / Sleeper Hold | `back_chokehold` | 0.80 creator value | `strangling`, `sleeperhold`, `leg lock`, `Sideview`, `Topview`; `maledom, male focus` reverses the femdom bias | [v2499103](https://civitai.red/models/495010?modelVersionId=2499103) |
| Banana Split | `bananaspl` | 0.75 Studio default | `frontupsidedown, backonfloor`; `frontseated`; `backbanana`; `bananasideview` is less reliable | [v1884996](https://civitai.red/models/1665406?modelVersionId=1884996) |
| Headscissor / Figure Four | `headsciss` | 0.75 Studio default | Choose `animee` or `realistic`; `legstrangle` is strongest; `strlegs` and `reversehead` are less reliable | [v1291825](https://civitai.red/models/1148581?modelVersionId=1291825) |
| Armbar Concept v3 | `armbar` | 0.75 Studio default | `leglock`, `submission hold`, `straight arm`, `arm trapped`, `SideView`, `topview`, `Closeup` | [v2496261](https://civitai.red/models/792762?modelVersionId=2496261) |
| Boston Crab | `BostCrab` | 0.75 Studio default | `FrontHold, squatting`; `SideHold, sitting on person`; `BackHold, on Stomach` | [v1761981](https://civitai.red/models/1557082?modelVersionId=1761981) |
| Camel Clutch | `camelclutch` | 0.75 Studio default | `Sidehold, Sitting on person` is strongest; `FrontHold, on stomach`; `Closeuphold` | [v1761607](https://civitai.red/models/1556757?modelVersionId=1761607) |
| Body Scissors + Back Choke | `BodySciss, legaroundbody` | 0.75 Studio default | `SideScissor`; `BackScissior` is experimental; `Assview`; `frontviewscissor` is experimental | [v1762704](https://civitai.red/models/1557710?modelVersionId=1762704) |
| Head Between Breasts / Breast Smother | `breast smother`, `head between breasts` | 0.75 Studio default | Specify two adults, subject count, clothing, angle, and one clear pose. Use separately from other major action LoRAs. | Local file; source/license not supplied |

Only Back Choke publishes a creator numeric weight. The 0.75 values above are clearly labeled
Studio defaults and should be adjusted by visual testing.

## Style and finishing LoRAs

| LoRA | Trigger | Start | Guidance | Exact source |
|---|---:|---:|---|---|
| Some Styles — NoobAI / Illustrious | none | 0.60 Studio default | Describe the intended style explicitly; lower when stacking another style adapter. | [v1027964](https://civitai.red/models/918427?modelVersionId=1027964) |
| Moriimee Gothic Niji | `artist:moriimee` | 0.70 Studio default | Add explicit gothic palette, lighting, and composition terms. | [v1244133](https://civitai.red/models/915918?modelVersionId=1244133) |
| Smooth Detailer Booster v2 | none | 0.50 | Creator range is about 0.25–0.80; reduce it in multi-LoRA stacks. | [v1470544](https://civitai.red/models/1145743?modelVersionId=1470544) |

Creator license flags differ by file. The complete per-file summaries are stored beside each
registry record and shown in the Studio management UI. In particular, Smooth Booster requires
credit, while Some Styles prohibits derivatives.

## Upscaler

[4× Remacri version 164821](https://civitai.red/models/147759?modelVersionId=164821) is available in
Photo as an optional post-decode neural detail pass. Studio then scales back to the exact requested
canvas. It is licensed CC BY-NC-SA 4.0, so it is noncommercial and share-alike; do not use it in a
commercial workflow without separate permission.

## Verified local installation

- Checkpoints: `Z:\codex app\checkpoints`
- LoRAs: `Z:\codex app\lora`
- Upscalers: `Z:\codex app\upscale_models`
- All previously installed assets plus AutismMix Confetti, WAI v11, and Prefect v1 were SHA-256
  checked against their supplied originals on 2026-07-30.
- Live 512×512 PNG smokes completed with all four Illustrious checkpoints and AutismMix; NXT also
  completed with Armbar + Smooth Booster and the Remacri stage.
- `Breast_Smother_IL.safetensors` completed an IllustriousNXT load/render smoke at 0.75. The older
  `breasts_smother_v0.1.safetensors` remains uninstalled because its metadata identifies an
  NAI/SD1.5 base, which the Studio does not support.
- `scripts/checkpoint-smoke.mjs` can verify named registered checkpoints sequentially.
- ComfyUI's full `/object_info` catalog may exceed ten seconds after a model swap with this library
  size. Studio allows 30 seconds only for that catalog request; queue/history calls remain at ten.
