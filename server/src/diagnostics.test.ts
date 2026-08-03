import { describe, expect, it } from "vitest";
import { buildModelManifest, detectReferenceCapabilities } from "./diagnostics.js";

const node = (key: string, values: string[]) => ({ input: { required: { [key]: [values] } } });
const base = {
  LoadImage: {}, ImageScale: {}, Canny: {}, CheckpointLoaderSimple: node("ckpt_name", ["sdpose_wholebody_fp16.safetensors"]),
  SDPoseKeypointExtractor: {}, SDPoseDrawKeypoints: {},
  ModelPatchLoader: node("name", [
    "Z-Image-Turbo-Fun-Controlnet-Union.safetensors",
    "anima-lllite-pose-1.safetensors",
    "anima-lllite-lineart-1.safetensors"
  ]),
  QwenImageDiffsynthControlnet: {}, VAEEncode: {}, DepthAnythingV2Preprocessor: node("model", ["depth_anything_v2_vitl.pth"]),
  Krea2ControlLoRALoader: node("lora_name", ["depth-control-lora.safetensors", "krea2_identity_edit_v1_2.safetensors"]),
  LoraLoaderModelOnly: {}, Krea2ControlImageEncode: {}, Krea2ControlApply: {}, Krea2EditModelPatch: {}, Krea2EditGroundedEncode: {},
  FaceDetailer: {}, UltralyticsDetectorProvider: node("model_name", ["bbox/face_yolov8m.pt"]),
  OpenposePreprocessor: {}, ControlNetApplyAdvanced: {},
  ControlNetLoader: node("control_net_name", [
    "controlnet-openpose-sdxl-1.0.safetensors",
    "controlnet-canny-sdxl-1.0.safetensors"
  ]),
  AnimaLLLiteApply: {}
};
const withUpscale = {
  ...base,
  UpscaleModelLoader: { input: { required: { model_name: ["COMBO", { options: ["RealESRGAN_x4plus.pth"] }] } } },
  ImageUpscaleWithModel: {}
};

describe("reference capability diagnostics", () => {
  it("reports native architecture capabilities and truthful incompatibilities", () => {
    const capabilities = detectReferenceCapabilities(base);
    expect(capabilities["z-image"].find(x => x.id === "pose")?.available).toBe(true);
    expect(capabilities["z-image"].find(x => x.id === "identity")?.available).toBe(false);
    expect(capabilities["z-image"].find(x => x.id === "face")?.available).toBe(true);
    expect(capabilities.krea2.find(x => x.id === "identity")?.available).toBe(true);
    expect(capabilities.krea2.find(x => x.id === "face")?.provider).toContain("Identity Edit");
    expect(capabilities.illustrious.find(x => x.id === "pose")?.available).toBe(true);
    expect(capabilities.illustrious.find(x => x.id === "structure")?.available).toBe(true);
    expect(capabilities.illustrious.find(x => x.id === "face")?.available).toBe(true);
    expect(capabilities.anima.find(x => x.id === "pose")?.available).toBe(true);
    expect(capabilities.anima.find(x => x.id === "structure")?.available).toBe(true);
    expect(capabilities.krea2.find(x => x.id === "structure")?.available).toBe(false);
    expect(capabilities.krea2.find(x => x.id === "upscale")?.available).toBe(false);
  });

  it("does not claim a capability when a model choice is missing", () => {
    const capabilities = detectReferenceCapabilities({ ...base, Krea2ControlLoRALoader: node("lora_name", []) });
    const identity = capabilities.krea2.find(x => x.id === "identity")!;
    expect(identity.available).toBe(false);
    expect(identity.missing).toContain("krea2_identity_edit_v1_2.safetensors");
  });

  it("detects the current ComfyUI COMBO option layout for neural upscalers", () => {
    expect(detectReferenceCapabilities(withUpscale).krea2.find(x => x.id === "upscale")?.available).toBe(true);
    expect(buildModelManifest(withUpscale, process.cwd()).find(x => x.id === "neural-upscale")?.installed).toBe(true);
  });

  it("detects local training bases without altering them", () => {
    const manifest = buildModelManifest(base, process.cwd());
    expect(manifest.find(x => x.id === "krea-raw")).toMatchObject({
      architecture: "krea2", role: "training", gated: true
    });
    expect(manifest.find(x => x.id === "face-detector")?.installed).toBe(true);
  });
});
