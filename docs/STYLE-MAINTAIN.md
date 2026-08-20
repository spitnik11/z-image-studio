# Style Maintain (Keep look · change pose)

Default-**off** Photo composer that reuses existing Direct/Identity + Pose ControlNet paths so you can change a character’s pose while keeping appearance.

Inspired by NovelAI’s character-reuse pattern (look reference + prompt/pose change), but **explicitly separates** look and pose so look strength does not glue the old pose (a common Vibe Transfer issue).

## Use

1. Generate or select a Photo in the gallery.
2. Click **Keep look · change pose** (next to Improve).
3. Optionally upload a **Pose** reference (photo or stick figure).
4. Rewrite the main prompt for the new pose / camera / scene.
5. Generate.

Or enable **Style Maintain** in the Photo controls and upload Look + Pose manually.

## vs Improve

| | Style Maintain | Improve |
|---|---|---|
| Intent | New pose, same look | Same pose, polish/refine |
| Mechanism | Direct/Identity + Pose refs | Img2img + structure lock |
| Default | Off | Off |

## Architecture notes

| Model family | Look path | Pose path | Consistency |
|---|---|---|---|
| Krea 2 | Identity Edit (best) | Depth | On |
| Z-Image | Structure/Canny (approximate) | SDPose | On |
| Illustrious | Canny Direct | OpenPose | Off — use Direct+Pose + character LoRA |
| Anima | Lineart Direct | OpenPose LLLite | Off — use Direct+Pose + character LoRA |

## Rollback

`docs/_rollback/style-maintain-*`

## Ops

Studio-only feature. Rebuild app/server and restart port **3199** only. Do not restart Comfy for this change.
