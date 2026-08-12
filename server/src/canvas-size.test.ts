import { describe, expect, it } from "vitest";
import {
  CANVAS_DEFAULT_HEIGHT,
  CANVAS_DEFAULT_WIDTH,
  CANVAS_MAX_EDGE,
  CANVAS_MIN_EDGE,
  PHOTO_CANVAS_PRESETS,
  isCanvasEdgeInRange
} from "./canvas-size.js";
import { generationSchema } from "./workflow.js";

const valid = {
  prompt: "test",
  seed: 1,
  diffusionModel: "krea2.safetensors",
  textEncoder: "te.safetensors",
  vae: "vae.safetensors"
};

describe("canvas size catalog", () => {
  it("keeps Photo default 1024 and max edge at least QHD width", () => {
    expect(CANVAS_DEFAULT_WIDTH).toBe(1024);
    expect(CANVAS_DEFAULT_HEIGHT).toBe(1024);
    expect(CANVAS_MIN_EDGE).toBe(256);
    expect(CANVAS_MAX_EDGE).toBe(2560);
  });

  it("includes QHD 16:9 2560×1440 among modular presets", () => {
    const qhd = PHOTO_CANVAS_PRESETS.find(p => p.id === "qhd-16-9");
    expect(qhd).toEqual({ id: "qhd-16-9", label: "QHD 16:9", width: 2560, height: 1440 });
    // All presets stay inside allowed range
    for (const preset of PHOTO_CANVAS_PRESETS) {
      expect(isCanvasEdgeInRange(preset.width)).toBe(true);
      expect(isCanvasEdgeInRange(preset.height)).toBe(true);
    }
  });

  it("generation schema accepts QHD and rejects over-max", () => {
    expect(generationSchema.parse({ ...valid, width: 2560, height: 1440 })).toMatchObject({
      width: 2560,
      height: 1440
    });
    // Prior max 2048 still works (back-compat)
    expect(generationSchema.parse({ ...valid, width: 2048, height: 2048 }).width).toBe(2048);
    expect(() => generationSchema.parse({ ...valid, width: 2560, height: 2561 })).toThrow();
  });
});
