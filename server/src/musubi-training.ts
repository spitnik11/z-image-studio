import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { TrainingInput } from "./training.js";

export type TrainingPaths = {
  root: string;
  python: string;
  accelerate: string;
  musubi: string;
  baseModel: string;
  kreaRawModel: string;
  vae: string;
  kreaVae: string;
  textEncoder: string;
  kreaTextEncoder: string;
};

export function getTrainingPaths(root: string): TrainingPaths {
  return {
    root,
    python: path.join(root, "training-engine", ".venv", "Scripts", "python.exe"),
    accelerate: path.join(root, "training-engine", ".venv", "Scripts", "accelerate.exe"),
    musubi: path.join(root, "training-engine", "musubi-tuner"),
    baseModel: path.join(root, "training-models", "z_image_bf16.safetensors"),
    // Keep the official gated checkpoint filename in place; do not duplicate this 26 GB file.
    kreaRawModel: path.join(root, "training-models", "raw.safetensors"),
    vae: path.join(root, "flux1AE_v10.safetensors"),
    kreaVae: path.join(root, "qwen_image_vae.safetensors"),
    textEncoder: path.join(root, "qwen3_4b.safetensors"),
    // Musubi requires the BF16/standard key layout; ComfyUI's scaled-FP8 file
    // contains comfy_quant tensors and remains generation-only.
    kreaTextEncoder: path.join(root, "training-models", "qwen3vl_4b_bf16.safetensors")
  };
}

export function missingTrainingFiles(paths: TrainingPaths, architecture: "z-image" | "krea2" = "z-image") {
  const prefix = architecture === "krea2" ? "krea2" : "zimage";
  const files = [
    paths.python, paths.accelerate,
    architecture === "krea2" ? paths.kreaRawModel : paths.baseModel,
    architecture === "krea2" ? paths.kreaVae : paths.vae,
    architecture === "krea2" ? paths.kreaTextEncoder : paths.textEncoder,
    path.join(paths.musubi, "src", "musubi_tuner", `${prefix}_cache_latents.py`),
    path.join(paths.musubi, "src", "musubi_tuner", `${prefix}_cache_text_encoder_outputs.py`),
    path.join(paths.musubi, "src", "musubi_tuner", `${prefix}_train_network.py`)
  ];
  if (architecture === "z-image") files.push(path.join(paths.musubi, "src", "musubi_tuner", "convert_lora.py"));
  return files.filter(file => !fs.existsSync(file));
}

export function writeDatasetConfig(jobDirectory: string, imageDirectory: string, resolution: number, repeats = 1) {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/"/g, '\\"');
  const cacheDirectory = path.join(jobDirectory, "cache");
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const configPath = path.join(jobDirectory, "dataset.toml");
  fs.writeFileSync(configPath, [
    "[general]",
    `resolution = [${resolution}, ${resolution}]`,
    'caption_extension = ".txt"',
    "batch_size = 1",
    "enable_bucket = true",
    "bucket_no_upscale = false",
    "",
    "[[datasets]]",
    `image_directory = "${normalize(imageDirectory)}"`,
    `cache_directory = "${normalize(cacheDirectory)}"`,
    `num_repeats = ${Math.max(1, Math.floor(repeats))}`,
    ""
  ].join("\n"), "utf8");
  return configPath;
}

export function trainingCommands(paths: TrainingPaths, config: TrainingInput, jobDirectory: string, datasetConfig: string, slug: string) {
  const source = path.join(paths.musubi, "src", "musubi_tuner");
  const output = path.join(jobDirectory, "output");
  fs.mkdirSync(output, { recursive: true });
  const krea = /krea[\s_.-]*2/i.test(config.model);
  // Tuning knobs — undefined reproduces the previous hardcoded values exactly.
  const optimizer = config.optimizer ?? "adamw8bit";
  const alpha = String(config.alpha ?? config.rank);
  const blocksToSwap = String(config.blocksToSwap ?? (krea ? 26 : 28));
  const schedulerArgs = config.lrScheduler && config.lrScheduler !== "constant"
    ? ["--lr_scheduler", config.lrScheduler, "--lr_warmup_steps", String(Math.max(1, Math.ceil(config.steps * 0.05)))]
    : [];
  if (krea) return [
    {
      phase: "Encoding pictures", progress: 8, command: paths.python,
      args: [path.join(source, "krea2_cache_latents.py"), "--dataset_config", datasetConfig, "--vae", paths.kreaVae]
    },
    {
      phase: "Encoding captions", progress: 18, command: paths.python,
      args: [path.join(source, "krea2_cache_text_encoder_outputs.py"), "--dataset_config", datasetConfig, "--text_encoder", paths.kreaTextEncoder, "--batch_size", "1"]
    },
    {
      phase: "Training Krea 2 LoRA", progress: 28, command: paths.accelerate,
      args: [
        "launch", "--num_cpu_threads_per_process", "1", "--mixed_precision", "bf16",
        path.join(source, "krea2_train_network.py"),
        "--dit", paths.kreaRawModel, "--vae", paths.kreaVae,
        "--dataset_config", datasetConfig, "--sdpa", "--mixed_precision", "bf16",
        "--timestep_sampling", "krea2_shift", "--weighting_scheme", "none",
        "--optimizer_type", optimizer, "--learning_rate", String(config.learningRate), ...schedulerArgs,
        "--gradient_checkpointing", "--gradient_checkpointing_cpu_offload",
        "--blocks_to_swap", blocksToSwap, "--fp8_base", "--fp8_scaled",
        "--max_data_loader_n_workers", "1", "--network_module", "networks.lora_krea2",
        "--network_dim", String(config.rank), "--network_alpha", alpha,
        "--max_train_steps", String(config.steps), "--gradient_accumulation_steps", String(config.gradAccumulation),
        "--seed", String(config.seed), "--output_dir", output, "--output_name", `${slug}-musubi`
      ]
    }
  ];
  return [
    {
      phase: "Encoding pictures", progress: 8, command: paths.python,
      args: [path.join(source, "zimage_cache_latents.py"), "--dataset_config", datasetConfig, "--vae", paths.vae]
    },
    {
      phase: "Encoding captions", progress: 18, command: paths.python,
      args: [path.join(source, "zimage_cache_text_encoder_outputs.py"), "--dataset_config", datasetConfig, "--text_encoder", paths.textEncoder, "--batch_size", "1", "--fp8_llm"]
    },
    {
      phase: "Training LoRA", progress: 28, command: paths.accelerate,
      args: [
        "launch", "--num_cpu_threads_per_process", "1", "--mixed_precision", "bf16",
        path.join(source, "zimage_train_network.py"),
        "--dit", paths.baseModel, "--vae", paths.vae, "--text_encoder", paths.textEncoder,
        "--dataset_config", datasetConfig, "--sdpa", "--mixed_precision", "bf16",
        "--timestep_sampling", "shift", "--weighting_scheme", "none", "--discrete_flow_shift", "2.0",
        "--optimizer_type", optimizer, "--learning_rate", String(config.learningRate), ...schedulerArgs,
        "--gradient_checkpointing", "--gradient_checkpointing_cpu_offload",
        "--blocks_to_swap", blocksToSwap, "--fp8_base", "--fp8_scaled", "--fp8_llm",
        "--max_data_loader_n_workers", "1", "--network_module", "networks.lora_zimage",
        "--network_dim", String(config.rank), "--network_alpha", alpha,
        "--max_train_steps", String(config.steps), "--gradient_accumulation_steps", String(config.gradAccumulation),
        "--seed", String(config.seed), "--output_dir", output, "--output_name", `${slug}-musubi`
      ]
    }
  ];
}

export function trainingPreview(paths: TrainingPaths, config: TrainingInput, imageCount: number, jobDirectory: string) {
  const architecture = /krea[\s_.-]*2/i.test(config.model) ? "krea2" as const : "z-image" as const;
  const safeCount = Math.max(0, Math.min(100, Number(imageCount) || 0));
  const slug = config.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
  const commands = trainingCommands(paths, config, jobDirectory, path.join(jobDirectory, "dataset.toml"), slug).map(item => ({
    phase: item.phase,
    command: [item.command, ...item.args].map(value => /\s/.test(value) ? `"${value}"` : value).join(" ")
  }));
  return {
    architecture,
    trainingBase: architecture === "krea2" ? "Krea 2 Raw" : "Z-Image Base BF16",
    targetModel: config.model,
    imageCount: safeCount,
    estimatedWorkingGb: Number(Math.max(1.5, (safeCount * config.resolution * config.resolution * 20) / 1024 ** 3 + (architecture === "krea2" ? 4.5 : 3)).toFixed(1)),
    vramProfile: `12 GB conservative profile: batch 1, effective batch ${config.gradAccumulation}, gradient checkpointing, CPU activation offload, and block swap ${config.blocksToSwap ?? (architecture === "krea2" ? 26 : 28)}.`,
    recommendedStrength: 1,
    config,
    commands
  };
}

export async function runTrainingProcess(
  command: string, args: string[], cwd: string, logFile: string,
  onOutput: (text: string) => void, register: (process: ChildProcess | undefined) => void
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
    });
    register(child);
    const log = fs.createWriteStream(logFile, { flags: "a" });
    const receive = (chunk: Buffer) => { const text = chunk.toString(); log.write(text); onOutput(text); };
    child.stdout?.on("data", receive);
    child.stderr?.on("data", receive);
    child.on("error", reject);
    child.on("close", code => {
      log.end();
      register(undefined);
      code === 0 ? resolve() : reject(new Error(`Training engine stopped with code ${code}. See ${logFile}`));
    });
  });
}
