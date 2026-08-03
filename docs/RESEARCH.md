# Research and implementation plan

Research checked 2026-07-27. “Confirmed” means verified from an official source, the Civitai API, or the local safetensors header/hash. Hardware behavior that could not be exercised because ComfyUI was offline is labeled accordingly.

## Confirmed model compatibility

| Role | Local file | Local inspection | Published identity | Result |
|---|---|---|---|---|
| Diffusion model | `zImageTurbo_turbo.safetensors` | 12,309,866,400 bytes; 453 BF16 tensors; Z-Image/S3-DiT-style keys | Civitai version 2442439 SHA-256 `240761…574A6` | Exact Civitai file; use `UNETLoader` |
| Text encoder | `qwen3_4b.safetensors` | 8,044,982,048 bytes; 398 BF16 Qwen3 tensors | Civitai Qwen3 4B SHA-256 `6C6714…FC5A` | Exact Civitai BF16 file; use `CLIPLoader` with type `lumina2` |
| VAE | `flux1AE_v10.safetensors` | 335,304,388 bytes; 244 FP32 tensors; embedded `Flux.1-AE` metadata | Civitai SHA-256 `AFC8E2…9E38` | Exact Civitai Flux.1 AE; use `VAELoader` |

The official filenames (`z_image_turbo_bf16.safetensors`, `qwen_3_4b.safetensors`, and `ae.safetensors`) and the local Civitai filenames differ. For the checked files, this is a packaging/naming difference, not a precision or architecture mismatch. The hashes match their stated Civitai versions exactly. The application therefore exposes filenames as settings and does not rename anything.

## Official workflow

The preserved reference is `workflows/z-image-turbo-reference.json`, downloaded from Comfy-Org’s current workflow-template repository. Its subgraph uses only these core nodes:

- `UNETLoader` with default weight dtype
- `CLIPLoader` with `lumina2` type and default device
- `VAELoader`
- `CLIPTextEncode`
- `ConditioningZeroOut` for negative conditioning (there is no negative-prompt control)
- `EmptySD3LatentImage`
- `ModelSamplingAuraFlow` with shift `3`
- `KSampler`: 8 steps, CFG 1, `res_multistep`, `simple`, denoise 1
- `VAEDecode` and `SaveImage`

The API copy adds no custom nodes. The UI intentionally does not expose sampler or scheduler selection because the current official workflow fixes these values. It exposes guidance because the underlying KSampler supports it, but defaults to the official value of 1.

ComfyUI’s documentation says to update ComfyUI and notes that missing core nodes can mean the stable release has not yet received them; in that case Nightly is required. The template itself identifies core version 0.3.73 for the subgraph nodes. Practical rule: stable is fine when diagnostics finds every node; otherwise update to a release containing those core nodes rather than installing unrelated custom nodes.

## VRAM assessment

Confirmed file weights total about 20.7 GB on disk before runtime overhead, exceeding 12 GB VRAM if simultaneously resident. ComfyUI’s official documentation says Z-Image Turbo fits within 16 GB consumer VRAM; that is not a promise for 12 GB with both BF16 diffusion and BF16 Qwen fully resident. On an RTX 5070 12 GB, ComfyUI will likely need CPU/RAM offload and may be substantially slower. This is an inference from verified sizes, not a local benchmark.

Do not replace models automatically. A trusted lower-memory route is ComfyUI-GGUF with quantized Z-Image and/or Qwen weights, but that adds custom nodes and quality/speed/compatibility tradeoffs and is not the official core workflow. Another option is a trusted FP8 text encoder (the referenced Civitai Qwen release lists an FP8 variant), reducing encoder memory at some quality/compatibility risk. Neither is substituted here. Try the verified files with current ComfyUI memory management first; consider quantization only after a real out-of-memory result.

## API behavior

Confirmed from ComfyUI’s server implementation and official example:

- Submit an API-format graph with `POST /prompt`, receiving `prompt_id`.
- Connect to `/ws?clientId=…`; watch `executing`, `progress`, and `execution_error`.
- Read completed outputs at `GET /history/{prompt_id}`.
- Retrieve an image with `GET /view?filename=…&subfolder=…&type=output`.
- Inspect nodes and model combo lists at `GET /object_info`; inspect hardware at `GET /system_stats`.
- Inspect queue at `GET /queue`.
- Cancel a queued prompt with `POST /queue` body `{ "delete": ["prompt-id"] }`.
- Interrupt current execution with `POST /interrupt`.

The backend proxies images so the browser never needs direct cross-origin access to ComfyUI. It reconnects on a new generation; a ComfyUI restart produces an actionable error and subsequent requests can recover.

## Local LoRA compatibility

The two files in `Z:\codex app\lora` were inspected without modification:

| File | Verified structure | Application behavior |
|---|---|---|
| `flat.safetensors` | 32 BF16 tensors; Z-Image metadata; selective standard LoRA A/B weights for transformer layers 20–21 | Model-only loader; useful as a targeted adapter |
| `nicegirls_Zimage.safetensors` | 480 FP16 tensors; Z-Image metadata; ai-toolkit standard LoRA A/B weights across the transformer | Model-only loader; full adapter |

Both use `diffusion_model.layers…lora_A/lora_B` keys. Neither contains text-encoder patches, so `LoraLoaderModelOnly` is more precise than the generic `LoraLoader`. ComfyUI's official node documentation supports extra model paths and exposes `model`, `lora_name`, and `strength_model`; multiple adapters are applied by chaining model outputs in the user-selected order.

Live validation on ComfyUI 0.28.0 loaded both adapters together at strengths `0.5` and `0.6`, completed a 512×512 generation in about 10 seconds, and emitted no unloaded-key or execution warnings. The stack is recorded in generation metadata and restored by **Reuse settings**.

## Licenses and usage

- The upstream Tongyi-MAI Z-Image-Turbo model card declares Apache-2.0.
- The Flux.1 AE local file embeds “Apache License 2.0”; its Civitai record allows image commercial use, derivatives, and different licensing.
- The Civitai Qwen3 record allows image commercial use, derivatives, and different licensing. Qwen3 upstream weights are Apache-2.0.
- Civitai model-page permissions describe use of the hosted files and generated images; retain source attribution and review the live model page before redistribution. This project contains no model weights in its package and makes no claim about third-party prompts or outputs.

## SCAIL-2 video findings

The official SCAIL-2 repository and ComfyUI blueprints were used as the source of truth. Current ComfyUI already contains the required native `WanSCAILToVideo`, `SCAIL2ColoredMask`, `SAM3_VideoTrack`, `CreateVideo`, and `SaveVideo` nodes, so no custom-node pack or separate Python environment is needed.

The installed official Comfy-Org assets are:

| Asset | Bytes | Purpose |
|---|---:|---|
| `wan2.1_14B_SCAIL_2_mxfp8.safetensors` | 17,150,733,432 | Lower-memory diffusion model |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6,735,906,897 | Wan text encoder |
| `Wan2_1_VAE_bf16.safetensors` | 253,806,278 | Video VAE |
| `clip_vision_h.safetensors` | 1,264,219,396 | Reference-image conditioning |
| `sam3.1_multiplex_fp16.safetensors` | 1,745,546,848 | Automatic subject masks |

The official blueprints use Wan SD3 model sampling with shift 5, Euler sampling and the simple scheduler. Base-model defaults are 40 steps and CFG 5. Dimensions are multiples of 32. Frame counts use Wan's `4n+1` cadence. The app limits normal clips to 9–81 frames and exposes 512p and 704p-oriented presets.

SCAIL masks are semantic rather than simple alpha masks: black excludes background, white preserves pixels, and matching colors identify corresponding people or objects across the reference and driving inputs. Prompts should describe the finished video, not instruct the model to “replace” or “animate.”

On the local RTX 5070 12 GB, the official MXFP8 model is the sensible first choice, but total weights still exceed VRAM and require ComfyUI offload. Short 512p clips are the recommended starting point; 704p and long clips are substantially more demanding.

## Z-Image photo pose and structure guidance

Current ComfyUI ships official native blueprints for `Pose to Image (Z-Image-Turbo)`, `ControlNet (Z-Image-Turbo)`, and SDPose image-to-pose workflows. The installed chain uses:

- `sdpose_wholebody_fp16.safetensors` from Comfy-Org/SDPose for body, hand, face, and foot keypoints.
- `Z-Image-Turbo-Fun-Controlnet-Union.safetensors` from Alibaba PAI as the Z-Image model patch.
- `ImageScale` before preprocessing so every guide matches the requested canvas.
- SDPose drawing for pose-only guidance or native Canny edges for more literal structure.
- One weighted ControlNet application per reference, chained before AuraFlow shift 3 and sampling.

Live tests passed on the RTX 5070. Pose-only guidance reproduced a crossed-arm reference at nine steps while changing appearance and clothing through the prompt. Direct-structure guidance preserved shoreline layout and body silhouette. A mixed two-reference stack with weights `1.15` and `0.35` completed successfully. The exact 1080×1920 portrait preset completed with pose guidance in 42 seconds without exhausting 12 GB VRAM. Lower four-step pose testing was materially weaker, so nine steps remains the recommended reference-guidance default.

## Implementation plan and status

1. Preserve and inspect user models without moving them — complete.
2. Store the official visual workflow and a minimal API graph — complete.
3. Build a localhost-only React interface and Node API bridge — complete.
4. Add setup diagnostics, generation queue, WebSocket progress, gallery, metadata, reuse, and record-only deletion — complete.
5. Validate workflow input replacement, seed/dimensions, metadata, and output paths — automated tests included.
6. Run live photo generation and tune memory behavior — complete.
7. Add native SCAIL-2 video mode, diagnostics, media validation, automatic/manual masks, MP4 history, reuse, and tests — complete.
8. Run real SCAIL-2 manual-mask and automatic-SAM generations plus browser playback/download acceptance — complete on RTX 5070 12 GB.
9. Add local Z-Image LoRA dataset import, captioning, low-memory training, Comfy conversion, progress,
   cancellation, history, and one-click Photo-mode loading — complete.
10. Add architecture-aware Krea 2 LoRA training, a separate consistent-character Dataset Builder,
    and an opt-in identity/pose/face-refinement graph — complete and live-verified.
11. Add local character profiles, persistent LoRA compatibility metadata, configurable dataset
    matrices, manual review/quality flags, structured caption strategies, and versioned export —
    complete.

## Local LoRA training findings

ComfyUI's native `TrainLoraNode` was tested first. It reached about 20 GB allocated during backward
and failed on the RTX 5070's 11.94 GB VRAM, so it is not the shipped training path. Training now
runs in a separate Python 3.10 Musubi Tuner environment; ComfyUI generation remains in its existing
Python 3.13 environment.

Musubi's current Z-Image guide recommends training on Z-Image Base rather than the distilled Turbo
checkpoint, then converting the adapter for ComfyUI. The installed pipeline follows its documented
pre-cache/train/convert order. Batch size is fixed at 1. The 12 GB profile enables FP8 Base and Qwen,
gradient checkpointing with CPU activation offload, SDPA, and the maximum 28 swapped blocks.
Resolution presets begin at 512; 768 is available after a successful lower-resolution run.

The complete compatibility smoke test passed: three images were cached with the existing Flux AE,
captions were cached with the existing Qwen3 encoder, a rank-8 one-step backward pass completed in
about one minute, the 70 MB test LoRA converted successfully, ComfyUI discovered it, and a real
256×256 Z-Image Turbo generation loaded that LoRA and completed successfully.

Musubi's official Krea 2 guide requires training on Krea 2 Raw and applying the adapter to Turbo.
The Studio now has an architecture-specific Krea cache/train path using its Krea latent, text
encoder, and network scripts; the Qwen Image VAE; Qwen3-VL; `krea2_shift`; and
`networks.lora_krea2`. The Raw checkpoint is about 26 GB and license-gated. An unauthenticated
download returned 401, so it was not bypassed or substituted. After the user accepted the license,
the official 26,283,332,608-byte `raw.safetensors` validated with 430 tensors.

The first live cache attempt identified that ComfyUI's scaled-FP8 Qwen3-VL contains `weight_scale`
and `comfy_quant` tensors rejected by Musubi. The official public BF16 single-file encoder
(`qwen3vl_4b_bf16.safetensors`, 8,875,719,384 bytes, 713 tensors) was installed separately under
`training-models`; the working ComfyUI generation encoder was not replaced.

A three-image, 384px, rank-8, one-step Krea acceptance run then completed latent caching, BF16
Qwen3-VL caption caching, loading all 430 Raw tensors with FP8 optimization and 26 swapped blocks,
creating 264 Krea LoRA modules, a real optimizer/backward step (loss 0.0312), and adapter
installation in 135 seconds. ComfyUI discovered the adapter, patched 263 Krea model layers, and
completed an eight-step 384×384 Turbo generation in 12.4 seconds.

## Character dataset and reference findings

The Dataset Builder creates a deterministic 40-shot plan from one master image and writes paired
image/caption files ready for LoRA Lab. A live 12-image acceptance run completed through Krea
Identity Edit, preserved the subject across varied framings and poses, wrote all captions, and
imported the set into LoRA Lab. The same queue path supports 24 and 40; the 40-shot plan is covered
by automated tests.

Dataset generation now accepts a configurable category matrix and stores per-image tags. Review
state, warning tags, and structured captions persist locally. Export manifest v2 contains source
workflow/model metadata, caption strategy, accepted/rejected/uncertain records, a 90/10 split,
aspect buckets, and trainer configuration. Exact SHA-256 duplicates, dHash near-duplicates,
low resolution, and Laplacian blur are advisory flags only.

Impact Pack and Impact Subpack are installed in ComfyUI's private environment with
`face_yolov8m.pt`. A live Krea character-consistency generation completed with Face Detailer at
denoise 0.40. Standard IP-Adapter weights target SD/SDXL and are not architecture-compatible with
the installed Z-Image/Krea 2 models. The implementation maps the requested concepts to native
mechanisms: Krea Identity Edit for identity, Krea Depth or Z-Image SDPose/ControlNet for pose, and
Impact Face Detailer for post-sampling polish. The extension is opt-in and the original builder
remains unchanged.

## Local finishing pass findings

Neural upscale is a shared post-decode stage (`UpscaleModelLoader` → `ImageUpscaleWithModel` →
Lanczos `ImageScale` to exact canvas). It is architecture-neutral and safe for Z-Image, Krea 2,
Illustrious, and Anima.

Installed curated set (2026-08-01):

| File | Bytes | SHA-256 prefix | Role |
|------|------:|----------------|------|
| `ComfyUI\models\upscale_models\RealESRGAN_x4plus.pth` | 67,040,989 | `4FA0D38905F7` | Official photoreal default |
| `upscale_models\4x-UltraSharp.pth` | 66,961,958 | `A5812231FC93` | Sharp product/texture (OpenModelDB / Kim2091) |
| `upscale_models\RealESRGAN_x4plus_anime_6B.pth` | 17,938,799 | `F872D837D3C9` | Official anime/cel (xinntao release) |
| `upscale_models\remacri_original.safetensors` | 66,864,028 | `AC3E6CC5B574` | Illustration texture (noncommercial) |

Earlier live checks: Real-ESRGAN completed exact-size Z-Image and Krea 2 renders at 256×256; combined
Krea Identity + Face Detailer + neural pass completed at 384×384. Remacri is already used on
Illustrious-style jobs in history. New UltraSharp and Anime 6B entries need a ComfyUI restart so
`object_info` lists them before the Studio will accept them at generate time.

Upscaling remains optional: it does not repair anatomy and may emphasize artifacts.

## Ranked local refinement backlog

1. Replace the static side-by-side comparison with a draggable before/after slider. ComfyUI's
   built-in `ImageCompare` establishes this inspection pattern; the Studio already has both assets,
   so this is a frontend-only, low-risk improvement.
2. Add finishing presets (`Off`, `Portrait`, `Product`, `Illustration`) that select conservative
   upscaler models and face polish without altering base-model sampling. Validate every added local
   model separately and keep architecture-specific controls isolated.
3. Add batch contact sheets and per-result Keep/Reject states to Photo history, reusing the Dataset
   Builder's established review vocabulary. This improves seed/LoRA/reference comparisons without
   adding inference dependencies.
4. Preserve/export the exact Studio request and generated ComfyUI graph beside each output. ComfyUI
   workflows are JSON graphs and PNG metadata can carry workflows; explicit sidecars would also
   cover WebP and make model/LoRA/reference experiments reproducible.
5. Add safe-zone overlays and crop previews for 9:16, 16:9, and platform delivery crops. Keep these
   as non-destructive UI guides rather than silently cropping generated masters.
6. ~~Consider a second, texture-specialized local upscaler~~ **Done (partial):** UltraSharp +
   Anime 6B + Remacri catalog with use-case copy. Still avoid creative cloud/API upscalers.
7. Optional finishing presets (`Off`, `Portrait`, `Product`, `Illustration`) can now map onto the
   curated catalog without new weights.

## Sources

- Official ComfyUI Z-Image Turbo guide: https://docs.comfy.org/tutorials/image/z-image/z-image-turbo
- Official workflow template: https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_z_image_turbo.json
- ComfyUI server overview: https://docs.comfy.org/development/comfyui-server/comms_overview
- ComfyUI WebSocket API example: https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/websockets_api_example.py
- Upstream Z-Image Turbo model card: https://huggingface.co/Tongyi-MAI/Z-Image-Turbo
- Supplied Civitai references: https://civitai.com/models/2168935?modelVersionId=2442439, https://civitai.com/models/2740928, https://civitai.com/models/2742977
- Official SCAIL-2 repository: https://github.com/zai-org/SCAIL-2
- Official SCAIL-2 model card: https://huggingface.co/zai-org/SCAIL-2
- Official ComfyUI SCAIL-2 weights: https://huggingface.co/Comfy-Org/SCAIL-2
- Native ComfyUI integration: https://github.com/Comfy-Org/ComfyUI/pull/14373
- Official ComfyUI pose guide: https://docs.comfy.org/tutorials/controlnet/pose-controlnet-2-pass
- Official Z-Image Turbo ControlNet workflow: https://comfy.org/workflows/image_z_image_turbo_fun_union_controlnet-7553d92529e0/
- Alibaba PAI Z-Image ControlNet Union: https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union
- Comfy-Org SDPose: https://huggingface.co/Comfy-Org/SDPose
- ComfyUI native LoRA training node: https://docs.comfy.org/built-in-nodes/TrainLoraNode
- ComfyUI LoRA loading guide: https://docs.comfy.org/tutorials/basic/lora
- Hugging Face Diffusers Z-Image DreamBooth guide: https://github.com/huggingface/diffusers/blob/main/examples/dreambooth/README_z_image.md
- Musubi Tuner Z-Image guide: https://github.com/kohya-ss/musubi-tuner/blob/main/docs/zimage.md
- Musubi Tuner Krea 2 guide: https://github.com/kohya-ss/musubi-tuner/blob/main/docs/krea2.md
- Official Krea 2 repository: https://github.com/krea-ai/krea-2
- Krea 2 Raw license-gated weights: https://huggingface.co/krea/Krea-2-Raw
- ComfyUI Impact Pack: https://github.com/ltdrdata/ComfyUI-Impact-Pack
- ComfyUI Impact Subpack: https://github.com/ltdrdata/ComfyUI-Impact-Subpack
- ComfyUI IP-Adapter: https://github.com/comfyorg/comfyui-ipadapter
- ComfyUI local image upscaling: https://docs.comfy.org/tutorials/utility/image-upscale
- ComfyUI UpscaleModelLoader: https://docs.comfy.org/built-in-nodes/UpscaleModelLoader
- ComfyUI ImageCompare: https://docs.comfy.org/built-in-nodes/ImageCompare
- Official Real-ESRGAN repository: https://github.com/xinntao/Real-ESRGAN
