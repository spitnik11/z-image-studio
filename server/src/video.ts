import path from "node:path";
import { z } from "zod";
import type { ApiWorkflow } from "./workflow.js";

const safeUploadName = z.string().min(1).max(260).refine(
  value => !path.isAbsolute(value) && !value.includes("..") && /^[a-zA-Z0-9_./-]+$/.test(value),
  "Invalid upload filename"
);

export const videoGenerationSchema = z.object({
  prompt: z.string().trim().min(10, "Use a detailed prompt describing the finished video.").max(4000),
  task: z.enum(["animation", "replacement"]).default("animation"),
  width: z.number().int().min(256).max(1280).refine(value => value % 32 === 0, "Width must be divisible by 32."),
  height: z.number().int().min(256).max(1280).refine(value => value % 32 === 0, "Height must be divisible by 32."),
  frameCount: z.number().int().min(9).max(81).refine(value => (value - 1) % 4 === 0, "Frame count must be 9, 13, 17… up to 81."),
  fps: z.number().int().min(4).max(30).default(16),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  steps: z.number().int().min(1).max(60).default(40),
  guidance: z.number().min(0).max(10).default(5),
  priority: z.enum(["next", "normal", "low"]).default("normal"),
  poseStrength: z.number().min(0).max(3).default(1),
  poseStart: z.number().min(0).max(1).default(0),
  poseEnd: z.number().min(0).max(1).default(1),
  automaticPreprocessing: z.boolean().default(true),
  outputName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default("scail-video"),
  model: z.string().min(1).default("wan2.1_14B_SCAIL_2_mxfp8.safetensors"),
  referenceImage: safeUploadName,
  drivingVideo: safeUploadName,
  referenceMask: safeUploadName.optional(),
  drivingMask: safeUploadName.optional()
}).superRefine((value, context) => {
  if (value.poseStart > value.poseEnd) context.addIssue({ code: "custom", path: ["poseStart"], message: "Pose start must be before pose end." });
  if (!value.automaticPreprocessing && (!value.referenceMask || !value.drivingMask)) {
    context.addIssue({ code: "custom", path: ["automaticPreprocessing"], message: "Manual preprocessing requires both a reference mask and a driving-mask video." });
  }
});

export type VideoGeneration = z.infer<typeof videoGenerationSchema>;

/**
 * Canvas presets for SCAIL-2. Official training/docs use 512p and 704p; both W and H must be ÷32.
 * True 720p height (720) is NOT divisible by 32 — use 704×1280 as the near-720p 9:16 class.
 * True 9:16 ÷32 options: 576×1024, 640×1152, 704×1248 (we prefer 704×1280 for 704p class).
 */
export const VIDEO_CANVAS_PRESETS = [
  { id: "safe-square", label: "Safe square", width: 512, height: 512, note: "12 GB start" },
  { id: "512-tall", label: "512p tall", width: 512, height: 896, note: "portrait" },
  { id: "9-16-576", label: "9:16 576p", width: 576, height: 1024, note: "exact 9:16" },
  { id: "9-16-640", label: "9:16 640p", width: 640, height: 1152, note: "exact 9:16" },
  { id: "9-16-704", label: "9:16 ~720p", width: 704, height: 1280, note: "704p class · social" },
  { id: "512-wide", label: "512p wide", width: 896, height: 512, note: "landscape" },
  { id: "704-wide", label: "704p wide", width: 1280, height: 704, note: "landscape HD" }
] as const;

/** Social / duration shortcuts: frameCount is always 4n+1 in [9, 81]. */
export const VIDEO_MOTION_PRESETS = [
  { id: "16fps-short", label: "16 fps · short", fps: 16, frameCount: 17, note: "~1.1 s · light" },
  { id: "30fps-1s", label: "30 fps · ~1 s", fps: 30, frameCount: 29, note: "social short" },
  { id: "30fps-2s", label: "30 fps · ~2 s", fps: 30, frameCount: 61, note: "heavier" },
  { id: "30fps-max", label: "30 fps · max", fps: 30, frameCount: 81, note: "~2.7 s · max length" }
] as const;

/** Nearest valid SCAIL frame count (9, 13, … 81) for a target duration at fps. */
export function scailFrameCountForSeconds(seconds: number, fps: number): number {
  const target = Math.max(1, seconds) * Math.max(1, fps);
  let best = 9;
  for (let frames = 9; frames <= 81; frames += 4) {
    if (Math.abs(frames - target) < Math.abs(best - target)) best = frames;
  }
  return best;
}

export function videoSeconds(frameCount: number, fps: number): number {
  return frameCount / Math.max(1, fps);
}

/** Rough 12 GB workload flag: pixels × frames × steps. */
export function isHeavyVideoWorkload(width: number, height: number, frameCount: number, steps: number): boolean {
  return width * height * frameCount * steps > 512 * 896 * 33 * 40;
}

export const SCAIL_FILES = {
  model: "wan2.1_14B_SCAIL_2_mxfp8.safetensors",
  textEncoder: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  vae: "Wan2_1_VAE_bf16.safetensors",
  clipVision: "clip_vision_h.safetensors",
  sam3: "sam3.1_multiplex_fp16.safetensors"
} as const;

export const SCAIL_NODES = [
  "UNETLoader", "CLIPLoader", "VAELoader", "CLIPVisionLoader", "LoadImage", "LoadVideo",
  "GetVideoComponents", "ImageFromBatch", "ImageScale", "CLIPTextEncode", "CLIPVisionEncode",
  "WanSCAILToVideo", "ModelSamplingSD3", "KSampler", "VAEDecode", "CreateVideo", "SaveVideo",
  "CheckpointLoaderSimple", "SAM3_VideoTrack", "SCAIL2ColoredMask"
] as const;

export function buildVideoWorkflow(raw: unknown): ApiWorkflow {
  const input = videoGenerationSchema.parse(raw);
  const workflow: ApiWorkflow = {
    "1": { class_type: "LoadImage", inputs: { image: input.referenceImage } },
    "2": { class_type: "LoadVideo", inputs: { file: input.drivingVideo } },
    "3": { class_type: "GetVideoComponents", inputs: { video: ["2", 0] } },
    "4": { class_type: "ImageFromBatch", inputs: { image: ["3", 0], batch_index: 0, length: input.frameCount } },
    "5": { class_type: "ImageScale", inputs: { image: ["4", 0], upscale_method: "lanczos", width: input.width, height: input.height, crop: "center" } },
    "6": { class_type: "UNETLoader", inputs: { unet_name: input.model, weight_dtype: "default" } },
    "7": { class_type: "CLIPLoader", inputs: { clip_name: SCAIL_FILES.textEncoder, type: "wan", device: "default" } },
    "8": { class_type: "VAELoader", inputs: { vae_name: SCAIL_FILES.vae } },
    "9": { class_type: "CLIPVisionLoader", inputs: { clip_name: SCAIL_FILES.clipVision } },
    "10": { class_type: "CLIPTextEncode", inputs: { text: input.prompt, clip: ["7", 0] } },
    "11": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["7", 0] } },
    "12": { class_type: "CLIPVisionEncode", inputs: { clip_vision: ["9", 0], image: ["1", 0], crop: "none" } }
  };

  let poseMask: [string, number];
  let referenceMask: [string, number];
  if (input.automaticPreprocessing) {
    workflow["13"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: SCAIL_FILES.sam3 } };
    workflow["14"] = { class_type: "CLIPTextEncode", inputs: { text: "person", clip: ["13", 1] } };
    workflow["15"] = { class_type: "SAM3_VideoTrack", inputs: { images: ["5", 0], model: ["13", 0], conditioning: ["14", 0], detection_threshold: 0.5, max_objects: 4, detect_interval: 1 } };
    workflow["16"] = { class_type: "SAM3_VideoTrack", inputs: { images: ["1", 0], model: ["13", 0], conditioning: ["14", 0], detection_threshold: 0.5, max_objects: 4, detect_interval: 1 } };
    workflow["17"] = {
      class_type: "SCAIL2ColoredMask",
      inputs: { driving_track_data: ["15", 0], ref_track_data: ["16", 0], object_indices: "", sort_by: "left_to_right", replacement_mode: input.task === "replacement" }
    };
    poseMask = ["17", 0];
    referenceMask = ["17", 1];
  } else {
    workflow["13"] = { class_type: "LoadImage", inputs: { image: input.referenceMask! } };
    workflow["14"] = { class_type: "LoadVideo", inputs: { file: input.drivingMask! } };
    workflow["15"] = { class_type: "GetVideoComponents", inputs: { video: ["14", 0] } };
    workflow["16"] = { class_type: "ImageFromBatch", inputs: { image: ["15", 0], batch_index: 0, length: input.frameCount } };
    workflow["17"] = { class_type: "ImageScale", inputs: { image: ["16", 0], upscale_method: "nearest-exact", width: input.width, height: input.height, crop: "center" } };
    poseMask = ["17", 0];
    referenceMask = ["13", 0];
  }

  workflow["18"] = {
    class_type: "WanSCAILToVideo",
    inputs: {
      positive: ["10", 0], negative: ["11", 0], vae: ["8", 0],
      width: input.width, height: input.height, length: input.frameCount, batch_size: 1,
      pose_strength: input.poseStrength, pose_start: input.poseStart, pose_end: input.poseEnd,
      video_frame_offset: 0, previous_frame_count: 5,
      pose_video: ["5", 0], pose_video_mask: poseMask, replacement_mode: input.task === "replacement",
      reference_image: ["1", 0], reference_image_mask: referenceMask, clip_vision_output: ["12", 0]
    }
  };
  workflow["19"] = { class_type: "ModelSamplingSD3", inputs: { model: ["6", 0], shift: 5 } };
  workflow["20"] = {
    class_type: "KSampler",
    inputs: {
      model: ["19", 0], seed: input.seed, steps: input.steps, cfg: input.guidance,
      sampler_name: "euler", scheduler: "simple", positive: ["18", 0], negative: ["18", 1],
      latent_image: ["18", 2], denoise: 1
    }
  };
  workflow["21"] = { class_type: "VAEDecode", inputs: { samples: ["20", 0], vae: ["8", 0] } };
  workflow["22"] = { class_type: "CreateVideo", inputs: { images: ["21", 0], fps: input.fps, audio: ["3", 1], bit_depth: 8 } };
  workflow["23"] = { class_type: "SaveVideo", inputs: { video: ["22", 0], filename_prefix: `video/${input.outputName}`, format: "mp4", codec: "h264" } };
  return workflow;
}
