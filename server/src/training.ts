import path from "node:path";
import { z } from "zod";
import { modelArchitecture, type ApiWorkflow } from "./workflow.js";

export const trainingSchema = z.object({
  name: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/),
  trigger: z.string().trim().min(2).max(80),
  model: z.string().min(1).max(260).refine(value => !path.isAbsolute(value) && !value.includes("..")),
  resolution: z.number().int().min(384).max(1024).multipleOf(64).default(512),
  steps: z.number().int().min(1).max(2000).default(500),
  rank: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).default(16),
  learningRate: z.number().min(0.000001).max(0.001).default(0.0001),
  gradAccumulation: z.number().int().min(1).max(16).default(4),
  // Optional tuning knobs. Left undefined they reproduce the previous hardcoded behavior
  // (alpha=rank, block swap 28 z-image / 26 krea, adamw8bit, constant LR, 1 repeat).
  alpha: z.number().int().min(1).max(128).optional(),
  blocksToSwap: z.number().int().min(0).max(40).optional(),
  optimizer: z.enum(["adamw8bit", "adamw"]).optional(),
  lrScheduler: z.enum(["constant", "cosine", "cosine_with_restarts"]).optional(),
  repeats: z.number().int().min(1).max(20).optional(),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(42)
});

export type TrainingInput = z.infer<typeof trainingSchema>;

export const TRAINING_NODES = [
  "UNETLoader", "CLIPLoader", "VAELoader", "LoadImageTextDataSetFromFolder",
  "ImageScale", "MakeTrainingDataset", "TrainLoraNode", "SaveLoRA", "LossGraphNode"
] as const;

export function trainingProfile(model: string) {
  const architecture = modelArchitecture(model);
  if (architecture === "z-image") {
    return { architecture, textEncoder: "qwen3_4b.safetensors", vae: "flux1AE_v10.safetensors", clipType: "lumina2" };
  }
  if (architecture === "krea2") {
    return { architecture, textEncoder: "qwen3vl_4b_fp8_scaled.safetensors", vae: "qwen_image_vae.safetensors", clipType: "krea2" };
  }
  throw new Error("This model architecture cannot be trained in Z-Image Studio.");
}

export function buildTrainingWorkflow(input: TrainingInput, datasetFolder: string, outputPrefix: string): ApiWorkflow {
  const profile = trainingProfile(input.model);
  if (profile.architecture === "krea2" && /turbo/i.test(input.model)) {
    throw new Error("Krea 2 LoRAs should be trained on a Krea 2 Raw model, then used with Turbo.");
  }
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: input.model, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: profile.textEncoder, type: profile.clipType, device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: profile.vae } },
    "4": { class_type: "LoadImageTextDataSetFromFolder", inputs: { folder: datasetFolder } },
    "5": {
      class_type: "ImageScale",
      inputs: { image: ["4", 0], upscale_method: "lanczos", width: input.resolution, height: input.resolution, crop: "center" }
    },
    "6": { class_type: "MakeTrainingDataset", inputs: { images: ["5", 0], vae: ["3", 0], clip: ["2", 0], texts: ["4", 1] } },
    "7": {
      class_type: "TrainLoraNode",
      inputs: {
        model: ["1", 0], latents: ["6", 0], positive: ["6", 1],
        batch_size: 1, grad_accumulation_steps: input.gradAccumulation,
        steps: input.steps, learning_rate: input.learningRate, rank: input.rank,
        optimizer: "AdamW", loss_function: "MSE", seed: input.seed,
        training_dtype: "bf16", lora_dtype: "bf16", quantized_backward: false,
        algorithm: "LoRA", gradient_checkpointing: true, checkpoint_depth: 1,
        offloading: true, existing_lora: "[None]", bucket_mode: false, bypass_mode: false
      }
    },
    "8": { class_type: "SaveLoRA", inputs: { lora: ["7", 0], prefix: outputPrefix, steps: ["7", 2] } },
    "9": { class_type: "LossGraphNode", inputs: { loss: ["7", 1], filename_prefix: `${outputPrefix}-loss` } }
  };
}
