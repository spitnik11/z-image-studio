import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTrainingPaths, trainingCommands, trainingPreview, writeDatasetConfig } from "./musubi-training.js";

describe("Musubi Z-Image training", () => {
  it("writes a batch-one bucketed image dataset", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zimage-training-"));
    const config = writeDatasetConfig(directory, path.join(directory, "pictures"), 512);
    const text = fs.readFileSync(config, "utf8");
    expect(text).toContain("resolution = [512, 512]");
    expect(text).toContain("batch_size = 1");
    expect(text).toContain("enable_bucket = true");
    expect(text).toContain('caption_extension = ".txt"');
  });

  it("uses Base, low-memory flags, and the requested settings", () => {
    const root = "Z:\\studio";
    const paths = getTrainingPaths(root);
    const commands = trainingCommands(paths, {
      name: "Test", trigger: "zperson", model: "zImageTurbo_turbo.safetensors",
      resolution: 512, steps: 500, rank: 16, learningRate: 0.0001,
      gradAccumulation: 4, seed: 42
    }, path.join(root, "job"), path.join(root, "job", "dataset.toml"), "test");
    const args = commands[2].args;
    expect(args).toContain(paths.baseModel);
    expect(args).toContain("--fp8_scaled");
    expect(args).toContain("--gradient_checkpointing_cpu_offload");
    expect(args.slice(args.indexOf("--blocks_to_swap"), args.indexOf("--blocks_to_swap") + 2)).toEqual(["--blocks_to_swap", "28"]);
    expect(args.slice(args.indexOf("--max_train_steps"), args.indexOf("--max_train_steps") + 2)).toEqual(["--max_train_steps", "500"]);
  });
  it("uses the Raw checkpoint and Krea-specific LoRA network for Turbo selections", () => {
    const paths = getTrainingPaths("Z:\\studio");
    const commands = trainingCommands(paths, {
      name: "Krea Test", trigger: "zperson", model: "krea2TurboINT8.safetensors",
      resolution: 512, steps: 250, rank: 32, learningRate: 0.0001,
      gradAccumulation: 4, seed: 42
    }, "Z:\\studio\\job", "Z:\\studio\\job\\dataset.toml", "krea-test");
    expect(commands[0].args[0]).toContain("krea2_cache_latents.py");
    expect(commands[2].args).toContain(paths.kreaRawModel);
    expect(commands[2].args).toContain("networks.lora_krea2");
    expect(commands[2].args.slice(commands[2].args.indexOf("--blocks_to_swap"), commands[2].args.indexOf("--blocks_to_swap") + 2)).toEqual(["--blocks_to_swap", "26"]);
  });
  it("previews architecture, disk budget, and all local command phases", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zimage-preview-"));
    const preview = trainingPreview(getTrainingPaths(root), {
      name: "Krea Person", trigger: "kperson", model: "krea2Turbo.safetensors",
      resolution: 512, steps: 500, rank: 16, learningRate: 0.0001, gradAccumulation: 4, seed: 42
    }, 40, path.join(root, "job"));
    expect(preview).toMatchObject({ architecture: "krea2", trainingBase: "Krea 2 Raw", imageCount: 40, recommendedStrength: 1 });
    expect(preview.estimatedWorkingGb).toBeGreaterThanOrEqual(4.5);
    expect(preview.commands.map(command => command.phase)).toEqual(["Encoding pictures", "Encoding captions", "Training Krea 2 LoRA"]);
  });
});
