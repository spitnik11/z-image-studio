import { describe, expect, it } from "vitest";
import {
  generationSchema,
  isImageRemixGeneration,
  REMIX_NEUTRAL_PROMPT,
  resolveGenerationPrompt
} from "./workflow.js";

const base = {
  width: 512,
  height: 512,
  seed: 1,
  diffusionModel: "zImageTurbo_turbo.safetensors",
  textEncoder: "qwen_3_4b.safetensors",
  vae: "ae.safetensors"
};

describe("image remix prompt rules", () => {
  it("rejects empty prompt for pure txt2img", () => {
    expect(() => generationSchema.parse({ ...base, prompt: "" })).toThrow(/prompt/i);
  });

  it("allows empty prompt when initImage + strength < 1", () => {
    const parsed = generationSchema.parse({
      ...base,
      prompt: "",
      initImage: "z-image-studio/remix.png",
      img2imgStrength: 0.45
    });
    expect(parsed.prompt).toBe("");
    expect(isImageRemixGeneration(parsed)).toBe(true);
    expect(resolveGenerationPrompt(parsed)).toBe(REMIX_NEUTRAL_PROMPT);
  });

  it("keeps user prompt when provided on remix", () => {
    const parsed = generationSchema.parse({
      ...base,
      prompt: "soft lighting, new outfit",
      initImage: "z-image-studio/remix.png",
      img2imgStrength: 0.5
    });
    expect(resolveGenerationPrompt(parsed)).toBe("soft lighting, new outfit");
  });

  it("still requires source image when strength < 1", () => {
    expect(() => generationSchema.parse({ ...base, prompt: "x", img2imgStrength: 0.4 })).toThrow(/source image/i);
  });
});
