import { describe, expect, it } from "vitest";
import { buildTrainingWorkflow, trainingSchema } from "./training.js";

const valid = {
  name: "My Person", trigger: "photo of zperson", model: "zImageTurbo_turbo.safetensors",
  resolution: 512, steps: 500, rank: 16 as const, learningRate: 0.0001,
  gradAccumulation: 4, seed: 42
};

describe("LoRA training workflow", () => {
  it("builds a memory-conscious native ComfyUI training graph", () => {
    const workflow = buildTrainingWorkflow(valid, "lora-training/job", "lora-training/job/my-person");
    expect(workflow["4"].inputs.folder).toBe("lora-training/job");
    expect(workflow["5"].inputs).toMatchObject({ width: 512, height: 512, crop: "center" });
    expect(workflow["7"].inputs).toMatchObject({
      batch_size: 1, grad_accumulation_steps: 4, rank: 16,
      offloading: true, gradient_checkpointing: true
    });
    expect(workflow["8"].inputs.steps).toEqual(["7", 2]);
  });

  it("rejects unsafe names and excessive settings", () => {
    expect(() => trainingSchema.parse({ ...valid, name: "../bad" })).toThrow();
    expect(() => trainingSchema.parse({ ...valid, resolution: 1152 })).toThrow();
    expect(() => trainingSchema.parse({ ...valid, steps: 5000 })).toThrow();
  });

  it("requires Krea Raw instead of training a distilled Turbo checkpoint", () => {
    expect(() => buildTrainingWorkflow({ ...valid, model: "krea2TurboINT8.safetensors" }, "data", "out")).toThrow(/Raw/);
  });
});
