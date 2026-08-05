import { describe, expect, it } from "vitest";
import {
  buildVideoWorkflow,
  isHeavyVideoWorkload,
  scailFrameCountForSeconds,
  VIDEO_CANVAS_PRESETS,
  VIDEO_MOTION_PRESETS,
  videoGenerationSchema,
  videoSeconds
} from "./video.js";

const valid = {
  prompt: "A woman in a red jacket dances in a softly lit studio.",
  task: "animation", width: 512, height: 512, frameCount: 17, fps: 16,
  seed: 42, steps: 40, guidance: 5, priority: "normal", poseStrength: 1,
  poseStart: 0, poseEnd: 1, automaticPreprocessing: true, outputName: "test-video",
  model: "wan2.1_14B_SCAIL_2_mxfp8.safetensors",
  referenceImage: "z-image-studio/ref.png", drivingVideo: "z-image-studio/drive.mp4"
};

describe("video contract", () => {
  it("requires dimensions divisible by 32", () => {
    expect(() => videoGenerationSchema.parse({ ...valid, width: 500 })).toThrow(/divisible by 32/);
  });
  it("limits frame count and FPS", () => {
    expect(() => videoGenerationSchema.parse({ ...valid, frameCount: 18 })).toThrow(/Frame count/);
    expect(() => videoGenerationSchema.parse({ ...valid, fps: 60 })).toThrow();
  });
  it("requires paired masks when automatic preprocessing is off", () => {
    expect(() => videoGenerationSchema.parse({ ...valid, automaticPreprocessing: false })).toThrow(/both a reference mask/);
  });
  it("rejects unsafe upload paths", () => {
    expect(() => videoGenerationSchema.parse({ ...valid, referenceImage: "../secret.png" })).toThrow(/Invalid upload/);
  });
});

describe("SCAIL workflow", () => {
  it("constructs automatic semantic masks and MP4 output", () => {
    const workflow = buildVideoWorkflow(valid);
    expect(workflow["15"].class_type).toBe("SAM3_VideoTrack");
    expect(workflow["17"].class_type).toBe("SCAIL2ColoredMask");
    expect(workflow["18"].inputs.replacement_mode).toBe(false);
    expect(workflow["20"].inputs.sampler_name).toBe("euler");
    expect(workflow["23"].inputs.format).toBe("mp4");
  });
  it("connects supplied manual masks without SAM3", () => {
    const workflow = buildVideoWorkflow({
      ...valid, automaticPreprocessing: false,
      referenceMask: "z-image-studio/ref-mask.png", drivingMask: "z-image-studio/drive-mask.mp4"
    });
    expect(workflow["13"].class_type).toBe("LoadImage");
    expect(workflow["17"].class_type).toBe("ImageScale");
    expect(workflow["18"].inputs.reference_image_mask).toEqual(["13", 0]);
    expect(Object.values(workflow).some(node => node.class_type === "SAM3_VideoTrack")).toBe(false);
  });
  it("builds 9:16 ~720p (704×1280) at 30 fps with valid frame counts", () => {
    const social = videoGenerationSchema.parse({
      ...valid, width: 704, height: 1280, fps: 30, frameCount: 29
    });
    expect(social.width % 32).toBe(0);
    expect(social.height % 32).toBe(0);
    expect(social.fps).toBe(30);
    const workflow = buildVideoWorkflow(social);
    expect(workflow["18"].inputs.width).toBe(704);
    expect(workflow["18"].inputs.height).toBe(1280);
    expect(workflow["18"].inputs.length).toBe(29);
    expect(workflow["22"].inputs.fps).toBe(30);
  });
});

describe("video presets helpers", () => {
  it("exposes 9:16 and 704p canvas presets with ÷32 dimensions", () => {
    const tall = VIDEO_CANVAS_PRESETS.find(item => item.id === "9-16-704");
    expect(tall).toMatchObject({ width: 704, height: 1280 });
    for (const preset of VIDEO_CANVAS_PRESETS) {
      expect(preset.width % 32).toBe(0);
      expect(preset.height % 32).toBe(0);
    }
  });
  it("maps durations to SCAIL 4n+1 frame counts and 30 fps presets", () => {
    expect(scailFrameCountForSeconds(1, 30)).toBe(29);
    expect(scailFrameCountForSeconds(2, 30)).toBe(61);
    expect(VIDEO_MOTION_PRESETS.some(item => item.fps === 30 && item.frameCount === 29)).toBe(true);
    expect(videoSeconds(29, 30)).toBeCloseTo(0.966, 2);
  });
  it("flags heavy 704p long clips for 12 GB guidance", () => {
    expect(isHeavyVideoWorkload(704, 1280, 61, 40)).toBe(true);
    expect(isHeavyVideoWorkload(512, 512, 17, 40)).toBe(false);
  });
});
