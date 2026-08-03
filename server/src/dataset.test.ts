import { describe, expect, it } from "vitest";
import { datasetCaptionForPrompt, datasetExtensionSchema, datasetPrompts, datasetSchema, DEFAULT_POSE_SEQUENCE } from "./dataset.js";

describe("Dataset Builder", () => {
  it("creates forty deterministic labelled character views", () => {
    const input = datasetSchema.parse({
      name: "Character Set", trigger: "photo of zperson", model: "krea2Turbo.safetensors",
      basePrompt: "same woman with red hair", count: 40, width: 512, height: 768, seed: 100
    });
    const prompts = datasetPrompts(input);
    expect(prompts).toHaveLength(40);
    expect(prompts[0].seed).toBe(100);
    expect(prompts[39].seed).toBe(139);
    expect(prompts.some(item => item.caption.includes("close-up"))).toBe(true);
    expect(prompts.some(item => item.caption.includes("full-body"))).toBe(true);
    expect(prompts.every(item => item.caption.includes("photo of zperson"))).toBe(true);
    expect(prompts[0].tags.angle).toBe("eye-level front");
    expect(new Set(prompts.map(item => item.tags.framing)).size).toBeGreaterThan(2);
    expect(new Set(prompts.map(item => item.tags.pose)).size).toBe(40);
    expect(prompts[39].tags.pose).not.toBe(prompts[0].tags.pose);
    expect(new Set(prompts.map(item => `${item.tags.pose}|${item.tags.angle}|${item.tags.framing}|${item.tags.lighting}`)).size).toBe(40);
  });
  it("continues the directed shot sequence when a dataset is extended", () => {
    const original = datasetSchema.parse({
      name: "Continued Set", trigger: "zperson", model: "krea2.safetensors",
      basePrompt: "same character", count: 12, width: 512, height: 768, seed: 100
    });
    const first = datasetPrompts(original);
    const more = datasetPrompts({ ...original, count: 5, seed: 112, variationOffset: 12 });
    expect(more[0].variationSlot).toBe(12);
    expect(more[0].tags.pose).not.toBe(first[0].tags.pose);
    expect(more[0].tags.pose).toBe(DEFAULT_POSE_SEQUENCE[12]);
    const afterForty = datasetPrompts({ ...original, count: 1, seed: 140, variationOffset: 40 });
    expect(afterForty[0].variationSlot).toBe(40);
    expect(afterForty[0].caption).toContain("alternate variation pass");
  });
  it("uses the selected prompt matrix and records its tags", () => {
    const input = datasetSchema.parse({
      name: "Focused Set", trigger: "zperson", model: "krea2.safetensors",
      basePrompt: "same character", count: 12, width: 512, height: 768, seed: 1,
      promptMatrix: {
        angles: ["profile"], framings: ["full-body"], expressions: ["angry"],
        poses: ["walking"], scenes: ["outdoor"], lighting: ["backlit"],
        varyOutfits: false, varyBackgrounds: false
      }
    });
    const prompts = datasetPrompts(input);
    expect(prompts.every(item => item.tags.angle === "profile" && item.tags.pose === "walking")).toBe(true);
    expect(prompts[0].caption).toContain("consistent outfit");
    expect(prompts[0].caption).toContain("simple uncluttered background");
  });
  it("adds deliberate character adjustments to every generated caption", () => {
    const input = datasetSchema.parse({
      name: "Adjusted Set", trigger: "zperson", model: "krea2.safetensors",
      basePrompt: "same adult character", count: 12, width: 512, height: 768, seed: 10,
      characterAdjustments: {
        hair: "copper-red shoulder-length hair",
        body: "tall athletic build",
        other: "faint freckles"
      }
    });
    const prompts = datasetPrompts(input);
    expect(prompts.every(item => item.caption.includes("intentional hair adjustment: copper-red shoulder-length hair"))).toBe(true);
    expect(prompts.every(item => item.caption.includes("intentional body proportion adjustment: tall athletic build"))).toBe(true);
    expect(prompts.every(item => item.caption.includes("intentional character adjustment: faint freckles"))).toBe(true);
  });
  it("accepts one to forty additional images for an existing dataset", () => {
    expect(datasetExtensionSchema.parse({ count: 1 }).count).toBe(1);
    expect(datasetExtensionSchema.parse({ count: 40 }).count).toBe(40);
    expect(() => datasetExtensionSchema.parse({ count: 41 })).toThrow();
  });
  it("keeps prompt captions aligned after a generated image is deleted", () => {
    const record = {
      captions: ["first", "second"],
      promptPlan: [
        { index: 0, caption: "planned first" },
        { index: 1, caption: "planned second" },
        { index: 2, caption: "recovery caption" }
      ],
      trigger: "zperson"
    };
    record.captions.splice(0, 1);
    expect(datasetCaptionForPrompt(record, 2)).toBe("recovery caption");
    expect(typeof datasetCaptionForPrompt({ captions: [], trigger: "zperson" }, 9)).toBe("string");
  });
});
