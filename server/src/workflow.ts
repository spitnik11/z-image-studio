import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const generationSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  negativePrompt: z.string().trim().max(2000).default(""),
  width: z.number().int().min(256).max(2048),
  height: z.number().int().min(256).max(2048),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  steps: z.number().int().min(1).max(60).default(8),
  guidance: z.number().min(0).max(10).default(1),
  batchSize: z.number().int().min(1).max(4).default(1),
  priority: z.enum(["next", "normal", "low"]).default("normal"),
  outputFormat: z.enum(["png", "webp"]).default("png"),
  sampler: z.enum(["res_multistep", "euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde"]).default("res_multistep"),
  scheduler: z.enum(["simple", "karras", "sgm_uniform"]).default("simple"),
  outputName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default("z-image"),
  neuralUpscale: z.boolean().default(false),
  upscaleModel: z.string().max(260).refine(v => !path.isAbsolute(v) && !v.includes(".."), "Invalid upscale model").default("RealESRGAN_x4plus.pth"),
  /** Opt-in Impact Pack face detect + low-denoise polish after decode (all Photo architectures). */
  faceRefinement: z.boolean().default(false),
  /**
   * NovelAI-style Improve / classic img2img source (Comfy input-relative path, e.g. z-image-studio/foo.png).
   * When set with img2imgStrength &lt; 1, latent comes from VAEEncode instead of EmptyLatentImage.
   */
  /** Comfy input-relative path (e.g. z-image-studio/foo.png). Empty/omitted = txt2img. */
  initImage: z.string().max(260).optional().transform(v => (v && v.trim() ? v.trim() : undefined)),
  /** NovelAI Strength → KSampler denoise. 1 = pure txt2img (default). */
  img2imgStrength: z.number().min(0.05).max(1).default(1),
  /** NovelAI Noise → extra detail freedom blended into effective denoise (see effectiveImg2ImgDenoise). */
  img2imgNoise: z.number().min(0).max(1).default(0),
  /**
   * refine = low-denoise fine-tune (anatomy/face/detail, preserve pose).
   * rewrite = freer reinterpret (old Medium/Strong style).
   */
  img2imgMode: z.enum(["refine", "rewrite"]).default("refine"),
  /** When true with init image, re-feed source as structure control (Canny/depth/LLLite). */
  img2imgLockStructure: z.boolean().default(true),
  diffusionModel: z.string().min(1),
  textEncoder: z.string().min(1),
  vae: z.string().min(1),
  loras: z.array(z.object({
    name: z.string().min(1).max(260).refine(v => !path.isAbsolute(v) && !v.includes(".."), "Invalid LoRA filename"),
    strength: z.number().min(-2).max(2)
  })).max(8).default([]),
  references: z.array(z.object({
    image: z.string().min(1).max(260).refine(v => !path.isAbsolute(v) && !v.includes("..") && /^[a-zA-Z0-9_./-]+$/.test(v), "Invalid reference image path"),
    mode: z.enum(["pose", "direct", "face"]),
    strength: z.number().min(0).max(2)
  })).max(4).default([])
}).superRefine((value, ctx) => {
  if (value.initImage) {
    if (path.isAbsolute(value.initImage) || value.initImage.includes("..") || !/^[a-zA-Z0-9_./-]+$/.test(value.initImage)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid init image path", path: ["initImage"] });
    }
  }
  if (value.img2imgStrength < 1 && !value.initImage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Improve / img2img requires a source image when Strength is below 1.",
      path: ["initImage"]
    });
  }
});

export type Generation = z.infer<typeof generationSchema>;

/**
 * NovelAI Strength + Noise → KSampler denoise.
 * Refine mode uses a lighter noise blend and hard-caps denoise so pose/layout stay stable
 * (Comfy community fine-tune range is typically ~0.15–0.35).
 */
export function effectiveImg2ImgDenoise(
  strength: number,
  noise = 0,
  mode: "refine" | "rewrite" = "rewrite"
): number {
  const noiseWeight = mode === "refine" ? 0.08 : 0.2;
  const raw = Math.min(1, Math.max(0.05, strength + noise * noiseWeight));
  if (mode === "refine") return Math.min(0.38, raw);
  return raw;
}

/** Recommended control strength when locking structure from the init image. */
export function structureLockControlStrength(mode: "refine" | "rewrite" = "refine"): number {
  return mode === "refine" ? 0.82 : 0.55;
}

/**
 * Wire init image → latent for KSampler (NovelAI Enhance / img2img).
 * Replaces EmptyLatentImage node "6" with LoadImage → ImageScale → VAEEncode.
 * Nodes 40–41 reserved for source; structure lock may use 43–47.
 */
export function applyImg2ImgLatent(
  workflow: ApiWorkflow,
  ctx: {
    initImage: string;
    vae: GraphRef;
    width: number;
    height: number;
    batchSize: number;
    strength: number;
    noise?: number;
    mode?: "refine" | "rewrite";
  }
) {
  const denoise = effectiveImg2ImgDenoise(ctx.strength, ctx.noise ?? 0, ctx.mode ?? "rewrite");
  workflow["40"] = {
    class_type: "LoadImage",
    inputs: { image: ctx.initImage },
    _meta: { title: "[Improve] Source Image" }
  };
  workflow["41"] = {
    class_type: "ImageScale",
    inputs: {
      image: ["40", 0],
      upscale_method: "lanczos",
      width: ctx.width,
      height: ctx.height,
      crop: "center"
    },
    _meta: { title: "[Improve] Fit Canvas" }
  };
  workflow["6"] = {
    class_type: "VAEEncode",
    inputs: { pixels: ["41", 0], vae: ctx.vae },
    _meta: { title: "[Improve] Encode Latent" }
  };
  if (workflow["8"]?.inputs) {
    workflow["8"].inputs.latent_image = ["6", 0];
    workflow["8"].inputs.denoise = denoise;
  }
  return denoise;
}

/**
 * Re-apply the init canvas as structure control so low-denoise refine improves
 * face/anatomy/lighting without drifting pose/layout (Canny / depth / LLLite).
 * Requires applyImg2ImgLatent first (nodes 40–41).
 */
export function applyInitStructureLock(
  workflow: ApiWorkflow,
  ctx: {
    architecture: "z-image" | "krea2" | "illustrious" | "anima";
    model: GraphRef;
    positive?: GraphRef;
    negative?: GraphRef;
    vae?: GraphRef;
    mode?: "refine" | "rewrite";
    width: number;
    height: number;
  }
): { model: GraphRef; positive?: GraphRef; negative?: GraphRef } {
  if (!workflow["41"]) return { model: ctx.model, positive: ctx.positive, negative: ctx.negative };
  const lock = structureLockControlStrength(ctx.mode ?? "refine");
  const scaled: GraphRef = ["41", 0];

  if (ctx.architecture === "z-image") {
    if (!workflow["90"]) {
      workflow["90"] = {
        class_type: "ModelPatchLoader",
        inputs: { name: POSE_FILES.controlnet },
        _meta: { title: "[Improve] Z-Image ControlNet Patch" }
      };
    }
    workflow["43"] = {
      class_type: "Canny",
      inputs: { image: scaled, low_threshold: 0.35, high_threshold: 0.75 },
      _meta: { title: "[Improve] Structure edges" }
    };
    workflow["44"] = {
      class_type: "QwenImageDiffsynthControlnet",
      inputs: {
        model: ctx.model,
        model_patch: ["90", 0],
        vae: ctx.vae || ["3", 0],
        image: ["43", 0],
        strength: lock
      },
      _meta: { title: "[Improve] Lock structure" }
    };
    const model: GraphRef = ["44", 0];
    if (workflow["7"]?.inputs) workflow["7"].inputs.model = model;
    if (workflow["8"]?.inputs) workflow["8"].inputs.model = model;
    return { model, positive: ctx.positive, negative: ctx.negative };
  }

  if (ctx.architecture === "illustrious") {
    if (!workflow["91"]) {
      workflow["91"] = {
        class_type: "ControlNetLoader",
        inputs: { control_net_name: ILLUSTRIOUS_REFERENCE_FILES.canny },
        _meta: { title: "[Improve] SDXL Canny ControlNet" }
      };
    }
    workflow["43"] = {
      class_type: "Canny",
      inputs: { image: scaled, low_threshold: 0.35, high_threshold: 0.75 },
      _meta: { title: "[Improve] Structure edges" }
    };
    const positive = ctx.positive || (workflow["8"]?.inputs?.positive as GraphRef) || (["4", 0] as GraphRef);
    const negative = ctx.negative || (workflow["8"]?.inputs?.negative as GraphRef) || (["5", 0] as GraphRef);
    workflow["44"] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive,
        negative,
        control_net: ["91", 0],
        image: ["43", 0],
        strength: lock,
        start_percent: 0,
        end_percent: 0.85,
        vae: ctx.vae || ["1", 2]
      },
      _meta: { title: "[Improve] Lock structure" }
    };
    const nextPos: GraphRef = ["44", 0];
    const nextNeg: GraphRef = ["44", 1];
    if (workflow["8"]?.inputs) {
      workflow["8"].inputs.positive = nextPos;
      workflow["8"].inputs.negative = nextNeg;
    }
    return { model: ctx.model, positive: nextPos, negative: nextNeg };
  }

  if (ctx.architecture === "anima") {
    workflow["47"] = {
      class_type: "ModelPatchLoader",
      inputs: { name: ANIMA_REFERENCE_FILES.structure },
      _meta: { title: "[Improve] Anima lineart LLLite" }
    };
    workflow["43"] = {
      class_type: "Canny",
      inputs: { image: scaled, low_threshold: 0.35, high_threshold: 0.75 },
      _meta: { title: "[Improve] Structure edges" }
    };
    workflow["44"] = {
      class_type: "AnimaLLLiteApply",
      inputs: {
        model: ctx.model,
        model_patch: ["47", 0],
        image: ["43", 0],
        strength: lock,
        start_percent: 0,
        end_percent: 0.9
      },
      _meta: { title: "[Improve] Lock structure" }
    };
    const model: GraphRef = ["44", 0];
    if (workflow["8"]?.inputs) workflow["8"].inputs.model = model;
    return { model, positive: ctx.positive, negative: ctx.negative };
  }

  // Krea 2: depth from the same canvas locks body/layout while identity stays in the latent.
  workflow["43"] = {
    class_type: "DepthAnythingV2Preprocessor",
    inputs: {
      image: scaled,
      ckpt_name: KREA_REFERENCE_FILES.depthModel,
      resolution: Math.min(1024, Math.max(ctx.width, ctx.height))
    },
    _meta: { title: "[Improve] Depth structure" }
  };
  workflow["45"] = {
    class_type: "Krea2ControlImageEncode",
    inputs: {
      control_image: ["43", 0],
      vae: ctx.vae || ["3", 0],
      latent: ["6", 0],
      resize: "match_latent_size",
      upscale_method: "lanczos",
      crop: "center",
      channel_mode: "grayscale",
      normalize: "per_image_minmax",
      invert: false,
      batch_mode: "independent_images"
    },
    _meta: { title: "[Improve] Encode depth control" }
  };
  workflow["46"] = {
    class_type: "Krea2ControlLoRALoader",
    inputs: {
      model: ctx.model,
      lora_name: KREA_REFERENCE_FILES.depthLora,
      strength: lock
    },
    _meta: { title: "[Improve] Depth control LoRA" }
  };
  workflow["47"] = {
    class_type: "Krea2ControlApply",
    inputs: { model: ["46", 0], control_latent: ["45", 0] },
    _meta: { title: "[Improve] Lock structure" }
  };
  const model: GraphRef = ["47", 0];
  if (workflow["8"]?.inputs) workflow["8"].inputs.model = model;
  return { model, positive: ctx.positive, negative: ctx.negative };
}

/** Shared post-hook: img2img latent + optional structure lock for Improve/Refine. */
export function applyImprovePass(
  workflow: ApiWorkflow,
  p: Generation,
  ctx: {
    architecture: "z-image" | "krea2" | "illustrious" | "anima";
    vae: GraphRef;
    model: GraphRef;
    positive?: GraphRef;
    negative?: GraphRef;
  }
) {
  if (!p.initImage || p.img2imgStrength >= 1) return ctx.model;
  applyImg2ImgLatent(workflow, {
    initImage: p.initImage,
    vae: ctx.vae,
    width: p.width,
    height: p.height,
    batchSize: p.batchSize,
    strength: p.img2imgStrength,
    noise: p.img2imgNoise,
    mode: p.img2imgMode
  });
  if (p.img2imgLockStructure) {
    const locked = applyInitStructureLock(workflow, {
      architecture: ctx.architecture,
      model: ctx.model,
      positive: ctx.positive,
      negative: ctx.negative,
      vae: ctx.vae,
      mode: p.img2imgMode,
      width: p.width,
      height: p.height
    });
    return locked.model;
  }
  return ctx.model;
}
export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }>;
export const TILED_VAE_PIXEL_THRESHOLD = 1080 * 1920;

function configureVaeDecode(node: ApiWorkflow[string], width: number, height: number) {
  if (width * height < TILED_VAE_PIXEL_THRESHOLD) return;
  node.class_type = "VAEDecodeTiled";
  Object.assign(node.inputs, { tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 });
  node._meta = { title: "[Decode] Tiled VAE" };
}

export type GraphRef = [string, number];

export type FacePolishContext = {
  image: GraphRef;
  model: GraphRef;
  clip: GraphRef;
  vae: GraphRef;
  positive: unknown;
  negative: unknown;
  sampler_name: string;
  scheduler: string;
  steps: number;
  cfg: number;
  seed: number;
  denoise?: number;
  outputName: string;
  width: number;
  height: number;
  neuralUpscale?: boolean;
  upscaleModel?: string;
};

export const FACE_POLISH_DEFAULT_DENOISE = 0.4;
export const FACE_POLISH_DETECTOR = "bbox/face_yolov8m.pt";

/**
 * Architecture-agnostic face detect + FaceDetailer polish after VAE decode.
 * Callers supply the correct MODEL / CLIP / VAE / conditioning for the graph.
 * Output is a single final image (same SaveImage path as normal generation) — no side-by-side original.
 */
export function applyFacePolish(workflow: ApiWorkflow, ctx: FacePolishContext) {
  const denoise = Math.min(0.55, Math.max(0.2, ctx.denoise ?? FACE_POLISH_DEFAULT_DENOISE));
  workflow["189"] = {
    class_type: "UltralyticsDetectorProvider",
    inputs: { model_name: FACE_POLISH_DETECTOR },
    _meta: { title: "[Refinement] Face Detector" }
  };
  workflow["190"] = {
    class_type: "FaceDetailer",
    inputs: {
      image: ctx.image,
      model: ctx.model,
      clip: ctx.clip,
      vae: ctx.vae,
      guide_size: 512,
      guide_size_for: true,
      max_size: 768,
      seed: ctx.seed + 10_000,
      steps: Math.max(8, ctx.steps),
      cfg: ctx.cfg,
      sampler_name: ctx.sampler_name,
      scheduler: ctx.scheduler,
      positive: ctx.positive,
      negative: ctx.negative,
      denoise,
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: 0.5,
      bbox_dilation: 10,
      bbox_crop_factor: 3,
      sam_detection_hint: "none",
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: "False",
      drop_size: 10,
      bbox_detector: ["189", 0],
      wildcard: "",
      cycle: 1
    },
    _meta: { title: "[Refinement] Face Detailer" }
  };

  // Single final output path only: polish → optional neural upscale → exact canvas scale → SaveImage.
  if (ctx.neuralUpscale) {
    if (!workflow["300"]) {
      addNeuralUpscale(workflow, ["190", 0], ctx.upscaleModel || "RealESRGAN_x4plus.pth");
    } else {
      if (workflow["301"]) workflow["301"].inputs.image = ["190", 0];
      if (workflow["11"]) workflow["11"].inputs.image = ["301", 0];
    }
  } else if (workflow["11"]) {
    workflow["11"].inputs.image = ["190", 0];
  }
}

/** @deprecated Prefer applyFacePolish with explicit clip/vae. Kept for any external imports. */
function addApproximateFaceRefinement(workflow: ApiWorkflow, p: Generation, model: GraphRef, strength: number) {
  applyFacePolish(workflow, {
    image: ["9", 0],
    model,
    clip: ["2", 0],
    vae: ["3", 0],
    positive: workflow["8"]?.inputs?.positive,
    negative: workflow["8"]?.inputs?.negative,
    sampler_name: "res_multistep",
    scheduler: "simple",
    steps: p.steps,
    cfg: p.guidance,
    seed: p.seed,
    denoise: Math.min(0.55, Math.max(0.2, 0.2 + strength * 0.2)),
    outputName: p.outputName,
    width: p.width,
    height: p.height,
    neuralUpscale: p.neuralUpscale,
    upscaleModel: p.upscaleModel
  });
}

function addNeuralUpscale(workflow: ApiWorkflow, imageSource: GraphRef, modelName: string) {
  workflow["300"] = {
    class_type: "UpscaleModelLoader",
    inputs: { model_name: modelName },
    _meta: { title: "[Upscale] Load Neural Model" }
  };
  workflow["301"] = {
    class_type: "ImageUpscaleWithModel",
    inputs: { upscale_model: ["300", 0], image: imageSource },
    _meta: { title: "[Upscale] Neural Detail Pass" }
  };
  workflow["11"].inputs.image = ["301", 0];
}

export type ConsistentCharacterInput = Omit<Generation, "references"> & {
  characterRefPath: string;
  poseRefPath?: string;
  environmentPrompt?: string;
  ipAdapterWeight?: number;
  controlnetWeight?: number;
  controlnetEnd?: number;
  faceRefinement?: boolean;
};

export const POSE_FILES = {
  controlnet: "Z-Image-Turbo-Fun-Controlnet-Union.safetensors",
  detector: "sdpose_wholebody_fp16.safetensors"
} as const;

export const POSE_NODES = [
  "LoadImage", "ImageScale", "Canny", "CheckpointLoaderSimple", "SDPoseKeypointExtractor",
  "SDPoseDrawKeypoints", "ModelPatchLoader", "QwenImageDiffsynthControlnet"
] as const;

export const KREA_REFERENCE_FILES = {
  depthLora: "depth-control-lora.safetensors",
  identityLora: "krea2_identity_edit_v1_2.safetensors",
  depthModel: "depth_anything_v2_vitl.pth"
} as const;

export const KREA_REFERENCE_NODES = [
  "LoadImage", "VAEEncode", "DepthAnythingV2Preprocessor", "Krea2ControlLoRALoader",
  "Krea2ControlImageEncode", "Krea2ControlApply", "Krea2EditModelPatch", "Krea2EditGroundedEncode"
] as const;

/** SDXL ControlNets for Illustrious / Pony-family checkpoints (standard ControlNetApplyAdvanced). */
export const ILLUSTRIOUS_REFERENCE_FILES = {
  openpose: "controlnet-openpose-sdxl-1.0.safetensors",
  canny: "controlnet-canny-sdxl-1.0.safetensors"
} as const;

export const ILLUSTRIOUS_REFERENCE_NODES = [
  "LoadImage", "ImageScale", "OpenposePreprocessor", "Canny",
  "ControlNetLoader", "ControlNetApplyAdvanced"
] as const;

/** Anima ControlNet-LLLite patches (Comfy-Org / kohya) applied via AnimaLLLiteApply. */
export const ANIMA_REFERENCE_FILES = {
  pose: "anima-lllite-pose-1.safetensors",
  structure: "anima-lllite-lineart-1.safetensors"
} as const;

export const ANIMA_REFERENCE_NODES = [
  "LoadImage", "ImageScale", "OpenposePreprocessor", "Canny",
  "ModelPatchLoader", "AnimaLLLiteApply"
] as const;

export type ImageModelArchitecture = "z-image" | "krea2" | "illustrious" | "anima" | "unknown";

/** Official Anima companion files (ComfyUI docs / circlestone-labs). */
export const ANIMA_FILES = {
  textEncoder: "qwen_3_06b_base.safetensors",
  vae: "qwen_image_vae.safetensors"
} as const;

export const ANIMA_DEFAULT_NEGATIVE =
  "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia";

export function modelArchitecture(filename: string): ImageModelArchitecture {
  if (/illustrious/i.test(filename)) return "illustrious";
  // AutismMix Confetti is an SDXL/Pony checkpoint. It uses the same checkpoint
  // loader/SDXL encoder graph as Illustrious, while its LoRA ecosystem remains isolated.
  if (/autismmix.*sdxl/i.test(filename)) return "illustrious";
  if (/krea[\s_.-]*2/i.test(filename)) return "krea2";
  if (/z[\s_.-]*image/i.test(filename)) return "z-image";
  // CircleStone / Comfy Org Anima (Cosmos-Predict2 2B anime). Match "anima" in the
  // diffusion filename only — companion TE/VAE names must stay out of the picker.
  if (/anima/i.test(filename) && !/qwen_3_06b|qwen_image_vae|text.?encoder/i.test(filename)) return "anima";
  return "unknown";
}

/**
 * Native Anima text-to-image graph (ComfyUI tutorial / blueprint).
 * UNET + Qwen3-0.6B TE (auto-detected as Anima TE) + Qwen Image VAE + EmptyLatentImage
 * + model-only LoRA chain + KSampler. No AuraFlow patch; references deferred.
 */
export function buildAnimaWorkflow(raw: unknown): ApiWorkflow {
  const p = generationSchema.parse(raw);
  if (modelArchitecture(p.diffusionModel) !== "anima") {
    throw new Error("The Anima workflow requires an Anima diffusion model filename.");
  }
  const negative = p.negativePrompt.trim() || ANIMA_DEFAULT_NEGATIVE;
  const workflow: ApiWorkflow = {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: p.diffusionModel, weight_dtype: "default" },
      _meta: { title: "[Model] Anima Diffusion" }
    },
    "2": {
      // type stable_diffusion: Comfy auto-detects QWEN3_06B → Anima TE (see comfy/sd.py).
      class_type: "CLIPLoader",
      inputs: { clip_name: p.textEncoder, type: "stable_diffusion", device: "default" },
      _meta: { title: "[Prompt] Anima Qwen3-0.6B" }
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: p.vae },
      _meta: { title: "[Decode] Qwen Image VAE" }
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: p.prompt, clip: ["2", 0] },
      _meta: { title: "[Prompt] Positive" }
    },
    "12": {
      class_type: "CLIPTextEncode",
      inputs: { text: negative, clip: ["2", 0] },
      _meta: { title: "[Prompt] Negative" }
    },
    "6": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: p.batchSize },
      _meta: { title: "[Canvas] Anima Latent" }
    }
  };
  let modelSource: [string, number] = ["1", 0];
  p.loras.forEach((lora, index) => {
    const id = String(20 + index);
    workflow[id] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: modelSource, lora_name: lora.name, strength_model: lora.strength },
      _meta: { title: `[LoRA] ${lora.name}` }
    };
    modelSource = [id, 0];
  });

  // Anima LLLite: pose stick figure → pose patch; structure/direct/face → canny + lineart patch.
  if (p.references.length) {
    const needsPose = p.references.some(reference => reference.mode === "pose");
    const needsStructure = p.references.some(reference => reference.mode !== "pose");
    if (needsPose) {
      workflow["90"] = {
        class_type: "ModelPatchLoader",
        inputs: { name: ANIMA_REFERENCE_FILES.pose },
        _meta: { title: "[Ref] Anima LLLite Pose" }
      };
    }
    if (needsStructure) {
      workflow["91"] = {
        class_type: "ModelPatchLoader",
        inputs: { name: ANIMA_REFERENCE_FILES.structure },
        _meta: { title: "[Ref] Anima LLLite Lineart" }
      };
    }
    p.references.forEach((reference, index) => {
      const base = 100 + index * 10;
      workflow[String(base)] = {
        class_type: "LoadImage",
        inputs: { image: reference.image },
        _meta: { title: `[Ref ${index + 1}] Load` }
      };
      workflow[String(base + 1)] = {
        class_type: "ImageScale",
        inputs: {
          image: [String(base), 0], upscale_method: "lanczos",
          width: p.width, height: p.height, crop: "center"
        },
        _meta: { title: `[Ref ${index + 1}] Fit canvas` }
      };
      let controlImage: [string, number];
      const patchNode = reference.mode === "pose" ? "90" : "91";
      if (reference.mode === "pose") {
        workflow[String(base + 2)] = {
          class_type: "OpenposePreprocessor",
          inputs: {
            image: [String(base + 1), 0],
            detect_hand: "enable", detect_body: "enable", detect_face: "enable",
            resolution: Math.min(1024, Math.max(p.width, p.height))
          },
          _meta: { title: `[Ref ${index + 1}] OpenPose` }
        };
        controlImage = [String(base + 2), 0];
      } else {
        workflow[String(base + 2)] = {
          class_type: "Canny",
          inputs: { image: [String(base + 1), 0], low_threshold: 0.35, high_threshold: 0.75 },
          _meta: { title: `[Ref ${index + 1}] Canny structure` }
        };
        controlImage = [String(base + 2), 0];
      }
      workflow[String(base + 4)] = {
        class_type: "AnimaLLLiteApply",
        inputs: {
          model: modelSource,
          model_patch: [patchNode, 0],
          image: controlImage,
          strength: reference.strength,
          start_percent: 0,
          end_percent: 1
        },
        _meta: { title: `[Ref ${index + 1}] Anima LLLite` }
      };
      modelSource = [String(base + 4), 0];
    });
  }

  workflow["8"] = {
    class_type: "KSampler",
    inputs: {
      model: modelSource,
      seed: p.seed,
      steps: p.steps,
      cfg: p.guidance,
      sampler_name: p.sampler === "res_multistep" ? "euler" : p.sampler,
      scheduler: p.scheduler,
      positive: ["4", 0],
      negative: ["12", 0],
      latent_image: ["6", 0],
      denoise: 1
    },
    _meta: { title: "[Sampling] Anima" }
  };
  if (p.initImage && p.img2imgStrength < 1) {
    modelSource = applyImprovePass(workflow, p, {
      architecture: "anima",
      vae: ["3", 0],
      model: modelSource
    });
    workflow["8"].inputs.model = modelSource;
  }
  workflow["9"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["8", 0], vae: ["3", 0] },
    _meta: { title: "[Decode] Anima VAE" }
  };
  configureVaeDecode(workflow["9"], p.width, p.height);
  workflow["11"] = {
    class_type: "ImageScale",
    inputs: { image: ["9", 0], upscale_method: "lanczos", width: p.width, height: p.height, crop: "disabled" },
    _meta: { title: "[Output] Exact Canvas" }
  };
  workflow["10"] = p.outputFormat === "webp"
    ? {
        class_type: "SaveAnimatedWEBP",
        inputs: {
          images: ["11", 0], filename_prefix: p.outputName,
          fps: 1, lossless: false, quality: 90, method: "default"
        }
      }
    : { class_type: "SaveImage", inputs: { filename_prefix: p.outputName, images: ["11", 0] } };

  if (p.faceRefinement) {
    if (p.neuralUpscale) addNeuralUpscale(workflow, ["9", 0], p.upscaleModel);
    applyFacePolish(workflow, {
      image: ["9", 0],
      model: modelSource,
      clip: ["2", 0],
      vae: ["3", 0],
      positive: workflow["8"].inputs.positive,
      negative: workflow["8"].inputs.negative,
      sampler_name: p.sampler === "res_multistep" ? "euler" : p.sampler,
      scheduler: p.scheduler,
      steps: p.steps,
      cfg: p.guidance,
      seed: p.seed,
      denoise: FACE_POLISH_DEFAULT_DENOISE,
      outputName: p.outputName,
      width: p.width,
      height: p.height,
      neuralUpscale: p.neuralUpscale,
      upscaleModel: p.upscaleModel
    });
  } else if (p.neuralUpscale) {
    addNeuralUpscale(workflow, ["9", 0], p.upscaleModel);
  }
  return workflow;
}

export function buildIllustriousWorkflow(raw: unknown): ApiWorkflow {
  const p = generationSchema.parse(raw);
  if (modelArchitecture(p.diffusionModel) !== "illustrious") {
    throw new Error("The checkpoint workflow requires a registered Illustrious or compatible SDXL checkpoint.");
  }
  const workflow: ApiWorkflow = {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: p.diffusionModel },
      _meta: { title: "[Model] Illustrious Checkpoint" }
    },
    "6": {
      class_type: "EmptyLatentImage",
      inputs: { width: p.width, height: p.height, batch_size: p.batchSize },
      _meta: { title: "[Canvas] SDXL Latent" }
    }
  };
  let modelSource: [string, number] = ["1", 0];
  let clipSource: [string, number] = ["1", 1];
  p.loras.forEach((lora, index) => {
    const id = String(20 + index);
    workflow[id] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelSource, clip: clipSource, lora_name: lora.name,
        strength_model: lora.strength, strength_clip: lora.strength
      },
      _meta: { title: `[LoRA] ${lora.name}` }
    };
    modelSource = [id, 0];
    clipSource = [id, 1];
  });
  workflow["30"] = {
    class_type: "CLIPSetLastLayer",
    inputs: { clip: clipSource, stop_at_clip_layer: -2 },
    _meta: { title: "[Prompt] Clip Skip 2" }
  };
  const encode = (text: string) => ({
    clip: ["30", 0], width: p.width, height: p.height, crop_w: 0, crop_h: 0,
    target_width: p.width, target_height: p.height, text_g: text, text_l: text
  });
  workflow["4"] = {
    class_type: "CLIPTextEncodeSDXL",
    inputs: encode(p.prompt),
    _meta: { title: "[Prompt] Positive SDXL" }
  };
  workflow["5"] = {
    class_type: "CLIPTextEncodeSDXL",
    inputs: encode(p.negativePrompt),
    _meta: { title: "[Prompt] Negative SDXL" }
  };

  // SDXL ControlNet: pose → OpenPose CN; structure/direct/face → Canny CN (identity is approximate).
  let positive: [string, number] = ["4", 0];
  let negative: [string, number] = ["5", 0];
  if (p.references.length) {
    const needsPose = p.references.some(reference => reference.mode === "pose");
    const needsCanny = p.references.some(reference => reference.mode !== "pose");
    if (needsPose) {
      workflow["90"] = {
        class_type: "ControlNetLoader",
        inputs: { control_net_name: ILLUSTRIOUS_REFERENCE_FILES.openpose },
        _meta: { title: "[Ref] SDXL OpenPose ControlNet" }
      };
    }
    if (needsCanny) {
      workflow["91"] = {
        class_type: "ControlNetLoader",
        inputs: { control_net_name: ILLUSTRIOUS_REFERENCE_FILES.canny },
        _meta: { title: "[Ref] SDXL Canny ControlNet" }
      };
    }
    p.references.forEach((reference, index) => {
      const base = 100 + index * 10;
      workflow[String(base)] = {
        class_type: "LoadImage",
        inputs: { image: reference.image },
        _meta: { title: `[Ref ${index + 1}] Load` }
      };
      workflow[String(base + 1)] = {
        class_type: "ImageScale",
        inputs: {
          image: [String(base), 0], upscale_method: "lanczos",
          width: p.width, height: p.height, crop: "center"
        },
        _meta: { title: `[Ref ${index + 1}] Fit canvas` }
      };
      let controlImage: [string, number];
      const controlNetNode = reference.mode === "pose" ? "90" : "91";
      if (reference.mode === "pose") {
        workflow[String(base + 2)] = {
          class_type: "OpenposePreprocessor",
          inputs: {
            image: [String(base + 1), 0],
            detect_hand: "enable", detect_body: "enable", detect_face: "enable",
            resolution: Math.min(1024, Math.max(p.width, p.height))
          },
          _meta: { title: `[Ref ${index + 1}] OpenPose` }
        };
        controlImage = [String(base + 2), 0];
      } else {
        workflow[String(base + 2)] = {
          class_type: "Canny",
          inputs: { image: [String(base + 1), 0], low_threshold: 0.35, high_threshold: 0.75 },
          _meta: { title: `[Ref ${index + 1}] Canny structure` }
        };
        controlImage = [String(base + 2), 0];
      }
      workflow[String(base + 4)] = {
        class_type: "ControlNetApplyAdvanced",
        inputs: {
          positive,
          negative,
          control_net: [controlNetNode, 0],
          image: controlImage,
          strength: reference.strength,
          start_percent: 0,
          end_percent: 1,
          vae: ["1", 2]
        },
        _meta: { title: `[Ref ${index + 1}] Apply ControlNet` }
      };
      positive = [String(base + 4), 0];
      negative = [String(base + 4), 1];
    });
  }

  workflow["8"] = {
    class_type: "KSampler",
    inputs: {
      model: modelSource, seed: p.seed, steps: p.steps, cfg: p.guidance,
      sampler_name: p.sampler, scheduler: p.scheduler,
      positive, negative, latent_image: ["6", 0], denoise: 1
    },
    _meta: { title: "[Sampling] Illustrious SDXL" }
  };
  if (p.initImage && p.img2imgStrength < 1) {
    modelSource = applyImprovePass(workflow, p, {
      architecture: "illustrious",
      vae: ["1", 2],
      model: modelSource,
      positive: workflow["8"].inputs.positive as GraphRef,
      negative: workflow["8"].inputs.negative as GraphRef
    });
    workflow["8"].inputs.model = modelSource;
  }
  workflow["9"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["8", 0], vae: ["1", 2] },
    _meta: { title: "[Decode] Checkpoint VAE" }
  };
  configureVaeDecode(workflow["9"], p.width, p.height);
  workflow["11"] = {
    class_type: "ImageScale",
    inputs: {
      image: ["9", 0],
      upscale_method: "lanczos", width: p.width, height: p.height, crop: "disabled"
    },
    _meta: { title: "[Output] Exact Canvas" }
  };
  workflow["10"] = p.outputFormat === "webp"
    ? { class_type: "SaveAnimatedWEBP", inputs: { images: ["11", 0], filename_prefix: p.outputName, fps: 1, lossless: false, quality: 90, method: "default" } }
    : { class_type: "SaveImage", inputs: { filename_prefix: p.outputName, images: ["11", 0] } };

  if (p.faceRefinement) {
    if (p.neuralUpscale) addNeuralUpscale(workflow, ["9", 0], p.upscaleModel);
    applyFacePolish(workflow, {
      image: ["9", 0],
      model: modelSource,
      clip: ["30", 0],
      vae: ["1", 2],
      positive: workflow["8"].inputs.positive,
      negative: workflow["8"].inputs.negative,
      sampler_name: p.sampler,
      scheduler: p.scheduler,
      steps: p.steps,
      cfg: p.guidance,
      seed: p.seed,
      denoise: FACE_POLISH_DEFAULT_DENOISE,
      outputName: p.outputName,
      width: p.width,
      height: p.height,
      neuralUpscale: p.neuralUpscale,
      upscaleModel: p.upscaleModel
    });
  } else if (p.neuralUpscale) {
    addNeuralUpscale(workflow, ["9", 0], p.upscaleModel);
  }
  return workflow;
}

export function buildWorkflow(template: ApiWorkflow, raw: unknown): ApiWorkflow {
  const p = generationSchema.parse(raw);
  const w = structuredClone(template);
  const architecture = modelArchitecture(p.diffusionModel);
  w["1"].inputs.unet_name = p.diffusionModel;
  w["2"].inputs.clip_name = p.textEncoder;
  w["2"].inputs.type = architecture === "krea2" ? "krea2" : "lumina2";
  w["3"].inputs.vae_name = p.vae;
  w["4"].inputs.text = p.prompt;
  w["12"].inputs.text = p.negativePrompt;
  w["8"].inputs.negative = p.negativePrompt ? ["12", 0] : ["5", 0];
  w["6"].inputs.width = p.width;
  w["6"].inputs.height = p.height;
  w["6"].inputs.batch_size = p.batchSize;
  w["8"].inputs.seed = p.seed;
  w["8"].inputs.steps = p.steps;
  w["8"].inputs.cfg = p.guidance;
  w["8"].inputs.sampler_name = architecture === "krea2" ? "euler" : p.sampler;
  w["8"].inputs.scheduler = p.scheduler;
  w["11"].inputs.width = p.width;
  w["11"].inputs.height = p.height;
  configureVaeDecode(w["9"], p.width, p.height);
  if (p.outputFormat === "webp") {
    w["10"] = {
      class_type: "SaveAnimatedWEBP",
      inputs: {
        images: ["11", 0], filename_prefix: p.outputName,
        fps: 1, lossless: false, quality: 90, method: "default"
      }
    };
  } else {
    w["10"] = { class_type: "SaveImage", inputs: { filename_prefix: p.outputName, images: ["11", 0] } };
  }
  if (architecture === "krea2") {
    w["6"].class_type = "EmptyLatentImage";
    delete w["7"];
  }
  let modelSource: [string, number] = ["1", 0];
  p.loras.forEach((lora, index) => {
    const id = String(20 + index);
    w[id] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: modelSource, lora_name: lora.name, strength_model: lora.strength }
    };
    modelSource = [id, 0];
  });
  if (p.references.length && architecture === "z-image") {
    w["90"] = { class_type: "ModelPatchLoader", inputs: { name: POSE_FILES.controlnet } };
    if (p.references.some(reference => reference.mode === "pose")) {
      w["91"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: POSE_FILES.detector } };
    }
    p.references.forEach((reference, index) => {
      const base = 100 + index * 10;
      w[String(base)] = { class_type: "LoadImage", inputs: { image: reference.image } };
      w[String(base + 1)] = {
        class_type: "ImageScale",
        inputs: {
          image: [String(base), 0], upscale_method: "lanczos",
          width: p.width, height: p.height, crop: "center"
        }
      };
      let controlImage: [string, number];
      if (reference.mode === "pose") {
        w[String(base + 2)] = {
          class_type: "SDPoseKeypointExtractor",
          inputs: { model: ["91", 0], vae: ["91", 2], image: [String(base + 1), 0], batch_size: 1 }
        };
        w[String(base + 3)] = {
          class_type: "SDPoseDrawKeypoints",
          inputs: {
            keypoints: [String(base + 2), 0], draw_body: true, draw_hands: true,
            draw_face: true, draw_feet: true, stick_width: 4, face_point_size: 2,
            score_threshold: 0.3, draw_head: true
          }
        };
        controlImage = [String(base + 3), 0];
      } else {
        w[String(base + 2)] = {
          class_type: "Canny",
          inputs: { image: [String(base + 1), 0], low_threshold: 0.35, high_threshold: 0.75 }
        };
        controlImage = [String(base + 2), 0];
      }
      w[String(base + 4)] = {
        class_type: "QwenImageDiffsynthControlnet",
        inputs: {
          model: modelSource, model_patch: ["90", 0], vae: ["3", 0],
          image: controlImage, strength: reference.strength
        }
      };
      modelSource = [String(base + 4), 0];
    });
  }
  if (p.references.length && architecture === "krea2") {
    const poseReferences = p.references.filter(reference => reference.mode === "pose" && reference.strength > 0);
    const directReferences = p.references.filter(reference => ["direct", "face"].includes(reference.mode) && reference.strength > 0);
    if (poseReferences.length > 1) throw new Error("Krea 2 supports one Pose reference at a time.");
    if (directReferences.length > 2) throw new Error("Krea 2 supports up to two Direct Copy references at a time.");

    const images: Array<[string, number]> = [];
    directReferences.forEach((reference, index) => {
      const imageId = String(160 + index * 2);
      const latentId = String(161 + index * 2);
      w[imageId] = { class_type: "LoadImage", inputs: { image: reference.image } };
      w[latentId] = { class_type: "VAEEncode", inputs: { pixels: [imageId, 0], vae: ["3", 0] } };
      images.push([imageId, 0]);
    });
    if (directReferences.length) {
      w["170"] = {
        class_type: "LoraLoaderModelOnly",
        inputs: { model: modelSource, lora_name: KREA_REFERENCE_FILES.identityLora, strength_model: 1 }
      };
      w["171"] = {
        class_type: "Krea2EditModelPatch",
        inputs: {
          model: ["170", 0], source_latent: ["161", 0],
          ...(directReferences.length > 1 ? { source_latent_b: ["163", 0] } : {}),
          ref_boost: directReferences.at(-1)!.strength,
          ref_boost_a: directReferences[0].strength,
          fit_mode: "fit", vae: ["3", 0], source_image: images[0],
          ...(directReferences.length > 1 ? { source_image_b: images[1] } : {})
        }
      };
      const groundedInputs = {
        clip: ["2", 0], prompt: p.prompt, image: images[0],
        ...(directReferences.length > 1 ? { image_b: images[1] } : {}),
        grounding_px: 768, system_prompt: ""
      };
      w["172"] = { class_type: "Krea2EditGroundedEncode", inputs: groundedInputs };
      w["173"] = {
        class_type: "Krea2EditGroundedEncode",
        inputs: { ...groundedInputs, prompt: p.negativePrompt }
      };
      w["8"].inputs.positive = ["172", 0];
      w["8"].inputs.negative = ["173", 0];
      modelSource = ["171", 0];
    }
    if (poseReferences.length) {
      const reference = poseReferences[0];
      w["180"] = { class_type: "LoadImage", inputs: { image: reference.image } };
      w["181"] = {
        class_type: "ImageScale",
        inputs: {
          image: ["180", 0], upscale_method: "lanczos",
          width: p.width, height: p.height, crop: "center"
        }
      };
      w["182"] = {
        class_type: "DepthAnythingV2Preprocessor",
        inputs: { image: ["181", 0], ckpt_name: KREA_REFERENCE_FILES.depthModel, resolution: 1024 }
      };
      w["183"] = {
        class_type: "Krea2ControlImageEncode",
        inputs: {
          control_image: ["182", 0], vae: ["3", 0], latent: ["6", 0],
          resize: "match_latent_size", upscale_method: "lanczos", crop: "center",
          channel_mode: "grayscale", normalize: "per_image_minmax",
          invert: false, batch_mode: "independent_images"
        }
      };
      w["184"] = {
        class_type: "Krea2ControlLoRALoader",
        inputs: { model: modelSource, lora_name: KREA_REFERENCE_FILES.depthLora, strength: reference.strength }
      };
      w["185"] = {
        class_type: "Krea2ControlApply",
        inputs: { model: ["184", 0], control_latent: ["183", 0] }
      };
      modelSource = ["185", 0];
    }
  }
  if (architecture === "krea2") w["8"].inputs.model = modelSource;
  else w["7"].inputs.model = modelSource;
  if (p.initImage && p.img2imgStrength < 1) {
    const arch = architecture === "krea2" ? "krea2" : "z-image";
    modelSource = applyImprovePass(w, p, {
      architecture: arch,
      vae: ["3", 0],
      model: modelSource
    });
    if (architecture === "krea2") w["8"].inputs.model = modelSource;
    else w["7"].inputs.model = modelSource;
  }
  const zFace = architecture === "z-image" ? p.references.find(reference => reference.mode === "face" && reference.strength > 0) : undefined;
  const wantPolish = p.faceRefinement || Boolean(zFace);
  if (wantPolish) {
    if (p.neuralUpscale) addNeuralUpscale(w, ["9", 0], p.upscaleModel);
    const model = (architecture === "krea2" ? w["8"].inputs.model : w["7"].inputs.model) as GraphRef;
    applyFacePolish(w, {
      image: ["9", 0],
      model,
      clip: ["2", 0],
      vae: ["3", 0],
      positive: w["8"].inputs.positive,
      negative: w["8"].inputs.negative,
      sampler_name: architecture === "krea2" ? "euler" : p.sampler,
      scheduler: p.scheduler,
      steps: p.steps,
      cfg: architecture === "krea2" ? 1 : p.guidance,
      seed: p.seed,
      denoise: p.faceRefinement
        ? FACE_POLISH_DEFAULT_DENOISE
        : Math.min(0.55, Math.max(0.2, 0.2 + (zFace?.strength ?? 1) * 0.2)),
      outputName: p.outputName,
      width: p.width,
      height: p.height,
      neuralUpscale: p.neuralUpscale,
      upscaleModel: p.upscaleModel
    });
  } else if (p.neuralUpscale) {
    addNeuralUpscale(w, ["9", 0], p.upscaleModel);
  }
  return w;
}

/**
 * Opt-in character workflow. The installed architectures do not share SD/SDXL IP-Adapter weights,
 * so "identity" is mapped to Krea 2 Identity Edit or Z-Image's structural reference adapter.
 * Existing base workflows remain untouched.
 */
export function buildConsistentCharacterWorkflow(template: ApiWorkflow, raw: ConsistentCharacterInput): ApiWorkflow {
  const architecture = modelArchitecture(raw.diffusionModel);
  const identityWeight = Math.max(0, Math.min(2, raw.ipAdapterWeight ?? 0.7));
  const poseWeight = Math.max(0, Math.min(2, raw.controlnetWeight ?? 0.8));
  const prompt = [raw.prompt, raw.environmentPrompt].filter(Boolean).join(", ");
  const references: Generation["references"] = [
    { image: raw.characterRefPath, mode: "direct", strength: identityWeight }
  ];
  if (raw.poseRefPath) references.push({ image: raw.poseRefPath, mode: "pose", strength: poseWeight });
  const workflow = buildWorkflow(template, { ...raw, prompt, references });
  const characterNode = architecture === "krea2" ? "160" : "100";
  if (workflow[characterNode]) workflow[characterNode]._meta = { title: "[Identity] Master Reference" };
  const poseNode = architecture === "krea2" ? "180" : "110";
  if (workflow[poseNode]) workflow[poseNode]._meta = { title: "[Pose] Target Reference" };
  if (workflow["8"]) workflow["8"]._meta = { title: "[Sampling] Character + Pose" };
  // Face polish is applied inside buildWorkflow when faceRefinement is true on the generation payload.
  return workflow;
}

export function safeOutputPath(root: string, filename: string, subfolder = "") {
  if (path.isAbsolute(filename) || path.isAbsolute(subfolder)) throw new Error("Absolute output paths are not allowed");
  const base = path.resolve(root);
  const resolved = path.resolve(base, subfolder, filename);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error("Output path leaves the configured folder");
  return resolved;
}

export function saveMetadata(root: string, id: string, value: unknown) {
  fs.mkdirSync(root, { recursive: true });
  const target = safeOutputPath(root, `${id}.json`);
  fs.writeFileSync(target, JSON.stringify(value, null, 2), { flag: "wx" });
  return target;
}
