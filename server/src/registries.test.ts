import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adapterForModel } from "./model-adapters.js";
import { CharacterProfileStore } from "./character-profiles.js";
import { applyLoraActivations, LoraRegistry } from "./lora-registry.js";

describe("model adapter registry", () => {
  it("keeps Z-Image, Krea 2, and Illustrious separate", () => {
    expect(adapterForModel("zImageTurbo_turbo.safetensors")?.id).toBe("z-image");
    expect(adapterForModel("krea2TurboINT8ConvrotWorks_krea2TurboInt8.safetensors")?.id).toBe("krea2");
    expect(adapterForModel("illustriousRealismBy_v10VAE.safetensors")?.id).toBe("illustrious");
    expect(adapterForModel("illustriousRealismBy_v10VAE.safetensors")?.loaderKind).toBe("checkpoint");
    expect(adapterForModel("flux-dev.safetensors")).toBeUndefined();
  });
});

describe("LoRA registry", () => {
  it("only returns verified architecture matches", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "z-lora-"));
    const registry = new LoraRegistry(path.join(root, "registry.json"), root);
    registry.upsert({ filename: "z.safetensors", architecture: "z-image", verified: true });
    registry.upsert({ filename: "krea.safetensors", architecture: "krea2", verified: true });
    registry.upsert({ filename: "mystery.safetensors", architecture: "unknown", verified: false });
    expect(registry.compatible("z-image").map(item => item.filename)).toEqual(["z.safetensors"]);
    expect(registry.compatible("krea2").map(item => item.filename)).toEqual(["krea.safetensors"]);
  });
  it("preserves complete training and verification metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "z-lora-meta-"));
    const registry = new LoraRegistry(path.join(root, "registry.json"), root);
    registry.upsert({
      filename: "subject.safetensors", architecture: "krea2", verified: true,
      baseTrainingModel: "Krea 2 Raw", trainer: "Musubi Tuner", triggerToken: "zsubject",
      datasetId: "dataset-1", datasetVersion: "v2", trainingResolution: "1024px buckets",
      rank: 16, alpha: 16, steps: 1200, epochs: 10, learningRate: .0001,
      textEncoderLearningRate: .00001, recommendedStrength: .8,
      verifiedAdapters: ["krea2"], notes: "Inference smoke passed."
    });
    expect(registry.list()[0]).toMatchObject({
      datasetVersion: "v2", trainingResolution: "1024px buckets", steps: 1200,
      epochs: 10, learningRate: .0001, verifiedAdapters: ["krea2"]
    });
    expect(registry.compatible("z-image")).toEqual([]);
  });
  it("adds activation words for the selected LoRAs once", () => {
    const records = [
      { filename: "body.safetensors", architecture: "krea2" as const, verified: true, activationWords: ["SBBT"] },
      { filename: "style.safetensors", architecture: "krea2" as const, verified: true, activationWords: ["editorial realism"] }
    ];
    expect(applyLoraActivations("SBBT, portrait at a mall", [
      { name: "body.safetensors" }, { name: "style.safetensors" }
    ], records)).toBe("editorial realism, SBBT, portrait at a mall");
  });
});

describe("character profiles", () => {
  it("persists validated reusable profiles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "z-character-"));
    const store = new CharacterProfileStore(path.join(root, "characters.json"));
    const created = store.create({ name: "Ava", triggerToken: "zava", stableIdentity: "red hair", identityWeight: 0.8 });
    expect(store.get(created.id)?.stableIdentity).toBe("red hair");
    expect(store.update(created.id, { ...created, stableIdentity: "red hair, green eyes" })?.stableIdentity).toContain("green eyes");
    expect(store.remove(created.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
