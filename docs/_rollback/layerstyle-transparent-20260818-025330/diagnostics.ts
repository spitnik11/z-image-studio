import fs from "node:fs";
import path from "node:path";
import {
  ANIMA_REFERENCE_FILES,
  ANIMA_REFERENCE_NODES,
  ILLUSTRIOUS_REFERENCE_FILES,
  ILLUSTRIOUS_REFERENCE_NODES,
  KREA_REFERENCE_FILES,
  KREA_REFERENCE_NODES,
  POSE_FILES,
  POSE_NODES
} from "./workflow.js";
import { listUpscaleCatalog, parseInstalledUpscaleModels } from "./upscale-catalog.js";

export type ReferenceCapability = "identity" | "face" | "pose" | "depth" | "structure" | "face-refinement" | "upscale";
export type Architecture = "z-image" | "krea2" | "illustrious" | "anima";

export type CapabilityStatus = {
  id: ReferenceCapability;
  available: boolean;
  provider?: string;
  message: string;
  missing: string[];
};

export type ManifestItem = {
  id: string;
  label: string;
  architecture: Architecture | "shared";
  role: "generation" | "training" | "reference" | "refinement" | "upscale";
  installed: boolean;
  location: string;
  filename?: string;
  required: boolean;
  license?: string;
  gated?: boolean;
};

const choiceValues = (node: any): string[] => {
  const values: string[] = [];
  const walk = (value: any) => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(node?.input);
  return values;
};

const hasChoice = (info: any, node: string, filename: string) =>
  choiceValues(info[node]).some(value => value === filename || value.endsWith(`/${filename}`) || value.endsWith(`\\${filename}`));

const missingNodes = (info: any, nodes: readonly string[]) => nodes.filter(node => !(node in info));

function result(id: ReferenceCapability, provider: string, missing: string[], available: string, unavailable: string): CapabilityStatus {
  return { id, available: missing.length === 0, provider, missing, message: missing.length ? unavailable : available };
}

export function detectReferenceCapabilities(info: any): Record<Architecture, CapabilityStatus[]> {
  const faceMissing = [
    ...missingNodes(info, ["FaceDetailer", "UltralyticsDetectorProvider"]),
    ...(hasChoice(info, "UltralyticsDetectorProvider", "bbox/face_yolov8m.pt") ? [] : ["bbox/face_yolov8m.pt"])
  ];
  const upscaleModels = parseInstalledUpscaleModels(info);
  const upscaleMissing = [
    ...missingNodes(info, ["UpscaleModelLoader", "ImageUpscaleWithModel"]),
    ...(Array.isArray(upscaleModels) && upscaleModels.length ? [] : ["compatible upscale model"])
  ];
  const zStructureNodes = missingNodes(info, ["LoadImage", "ImageScale", "Canny", "ModelPatchLoader", "QwenImageDiffsynthControlnet"]);
  const zPoseNodes = missingNodes(info, POSE_NODES);
  const zControl = hasChoice(info, "ModelPatchLoader", POSE_FILES.controlnet) ? [] : [POSE_FILES.controlnet];
  const zPose = hasChoice(info, "CheckpointLoaderSimple", POSE_FILES.detector) ? [] : [POSE_FILES.detector];
  const kIdentityNodes = missingNodes(info, ["LoadImage", "VAEEncode", "LoraLoaderModelOnly", "Krea2EditModelPatch", "Krea2EditGroundedEncode"]);
  const kPoseNodes = missingNodes(info, ["LoadImage", "ImageScale", "DepthAnythingV2Preprocessor", "Krea2ControlLoRALoader", "Krea2ControlImageEncode", "Krea2ControlApply"]);
  const kIdentity = hasChoice(info, "Krea2ControlLoRALoader", KREA_REFERENCE_FILES.identityLora) ? [] : [KREA_REFERENCE_FILES.identityLora];
  const kDepthLora = hasChoice(info, "Krea2ControlLoRALoader", KREA_REFERENCE_FILES.depthLora) ? [] : [KREA_REFERENCE_FILES.depthLora];
  const kDepthModel = hasChoice(info, "DepthAnythingV2Preprocessor", KREA_REFERENCE_FILES.depthModel) ? [] : [KREA_REFERENCE_FILES.depthModel];
  const ilNodes = missingNodes(info, ILLUSTRIOUS_REFERENCE_NODES);
  const ilOpenpose = hasChoice(info, "ControlNetLoader", ILLUSTRIOUS_REFERENCE_FILES.openpose) ? [] : [ILLUSTRIOUS_REFERENCE_FILES.openpose];
  const ilCanny = hasChoice(info, "ControlNetLoader", ILLUSTRIOUS_REFERENCE_FILES.canny) ? [] : [ILLUSTRIOUS_REFERENCE_FILES.canny];
  const animaNodes = missingNodes(info, ANIMA_REFERENCE_NODES);
  const animaPosePatch = hasChoice(info, "ModelPatchLoader", ANIMA_REFERENCE_FILES.pose) ? [] : [ANIMA_REFERENCE_FILES.pose];
  const animaStructurePatch = hasChoice(info, "ModelPatchLoader", ANIMA_REFERENCE_FILES.structure) ? [] : [ANIMA_REFERENCE_FILES.structure];
  const face = result("face-refinement", "Impact Pack FaceDetailer", faceMissing,
    "Available with the local YOLO face detector.", "Face polish stays disabled until Impact Pack and its face detector are available.");
  const upscale = result("upscale", "ComfyUI neural upscale", upscaleMissing,
    "A local neural upscale model is available.", "Neural upscale is unavailable. Canvas resizing still uses core Lanczos scaling.");

  return {
    "z-image": [
      { id: "identity", available: false, missing: ["architecture-compatible identity adapter"], message: "True identity-only guidance is not installed for Z-Image. Structure mode can preserve silhouette and composition, but it is not IP-Adapter identity.", provider: "Z-Image native adapters" },
      result("face", "Z-Image structure + Impact Pack FaceDetailer", [...zStructureNodes, ...zControl, ...faceMissing],
        "Approximate face preservation is available through structural guidance and a low-denoise Face Detailer pass. For a true identity lock, use a trained face LoRA.",
        "Approximate face preservation requires the Z-Image ControlNet, Impact Pack, and face_yolov8m.pt. A face LoRA remains the recommended true identity lock."),
      result("pose", "SDPose + Z-Image ControlNet", [...zPoseNodes, ...zControl, ...zPose],
        "Whole-body pose guidance is available.", "Pose mode stays disabled until the native Z-Image ControlNet and SDPose detector are available."),
      { id: "depth", available: false, missing: ["Z-Image depth adapter"], message: "No architecture-compatible Z-Image depth adapter is installed.", provider: "Z-Image native adapters" },
      result("structure", "Canny + Z-Image ControlNet", [...zStructureNodes, ...zControl],
        "Structural reference guidance is available.", "Structure mode stays disabled until the native Z-Image ControlNet nodes and model are available."),
      face,
      upscale
    ],
    krea2: [
      result("identity", "Krea 2 Identity Edit v1.2", [...kIdentityNodes, ...kIdentity],
        "Native Krea 2 identity editing is available.", "Identity mode stays disabled until the Krea 2 Identity Edit adapter and nodes are available."),
      result("face", "Krea 2 Identity Edit v1.2", [...kIdentityNodes, ...kIdentity],
        "Native Krea 2 Identity Edit provides strong face and identity preservation.",
        "Face preservation stays disabled until the Krea 2 Identity Edit adapter and nodes are available."),
      result("pose", "Krea 2 Depth guidance", [...kPoseNodes, ...kDepthLora, ...kDepthModel],
        "Pose/composition guidance is available through Krea 2 depth control.", "Krea 2 has no OpenPose adapter here; pose mode requires its native depth-control components."),
      result("depth", "Depth Anything V2 + Krea 2 Control LoRA", [...kPoseNodes, ...kDepthLora, ...kDepthModel],
        "Native Krea 2 depth conditioning is available.", "Depth conditioning stays disabled until Depth Anything and the Krea 2 depth adapter are available."),
      { id: "structure", available: false, missing: ["Krea 2 structural adapter"], message: "Krea 2 uses Identity Edit or Depth guidance; the Z-Image Canny ControlNet is incompatible.", provider: "Krea 2 native adapters" },
      face,
      upscale
    ],
    illustrious: [
      { id: "identity", available: false, missing: ["Illustrious IP-Adapter"], provider: "Illustrious XL", message: "True identity IP-Adapter is not installed for Illustrious. Use Face/Structure (Canny) plus a character LoRA for likeness." },
      result("face", "SDXL Canny structure", [...ilNodes, ...ilCanny],
        "Approximate face/composition guidance via SDXL Canny ControlNet. Prefer a character LoRA for a true identity lock.",
        "Face/structure mode needs SDXL Canny ControlNet weights and OpenPose/Canny nodes."),
      result("pose", "OpenPose + SDXL ControlNet", [...ilNodes, ...ilOpenpose],
        "Whole-body pose guidance via OpenPose preprocessor and SDXL OpenPose ControlNet.",
        "Pose mode needs SDXL OpenPose ControlNet weights and OpenposePreprocessor."),
      { id: "depth", available: false, missing: ["Illustrious depth ControlNet"], message: "No dedicated Illustrious depth ControlNet is installed.", provider: "Illustrious XL" },
      result("structure", "Canny + SDXL ControlNet", [...ilNodes, ...ilCanny],
        "Structural / Direct silhouette guidance via SDXL Canny ControlNet.",
        "Structure mode needs SDXL Canny ControlNet weights."),
      face,
      upscale
    ],
    anima: [
      { id: "identity", available: false, missing: ["Anima identity adapter"], provider: "Anima LLLite", message: "Anima has no IP-Adapter path here. Use Structure/Face (lineart LLLite) plus a character LoRA." },
      result("face", "Anima LLLite lineart", [...animaNodes, ...animaStructurePatch],
        "Approximate face/composition via Canny + Anima lineart LLLite. Prefer a face LoRA for identity lock.",
        "Face mode needs Anima lineart LLLite patch and AnimaLLLiteApply."),
      result("pose", "OpenPose + Anima LLLite pose", [...animaNodes, ...animaPosePatch],
        "Pose guidance via OpenPose stick figure and Anima pose LLLite.",
        "Pose mode needs anima-lllite-pose patch and OpenposePreprocessor."),
      { id: "depth", available: false, missing: ["Anima depth LLLite"], message: "Optional depth LLLite is not wired; pose and lineart are available.", provider: "Anima LLLite" },
      result("structure", "Canny + Anima LLLite lineart", [...animaNodes, ...animaStructurePatch],
        "Structural / Direct guidance via Canny + Anima lineart LLLite.",
        "Structure mode needs anima-lllite-lineart patch."),
      face,
      upscale
    ]
  };
}

export function buildModelManifest(info: any, root: string): ManifestItem[] {
  const entry = (item: Omit<ManifestItem, "installed">, node?: string): ManifestItem => ({
    ...item,
    installed: item.filename
      ? (node ? hasChoice(info, node, item.filename) : fs.existsSync(path.join(root, item.location, item.filename)))
      : Boolean(node && info[node])
  });
  return [
    entry({ id: "z-image-controlnet", label: "Z-Image ControlNet Union", architecture: "z-image", role: "reference", filename: POSE_FILES.controlnet, location: "ComfyUI models/model_patches", required: false }, "ModelPatchLoader"),
    entry({ id: "z-image-sdpose", label: "SDPose Wholebody", architecture: "z-image", role: "reference", filename: POSE_FILES.detector, location: "ComfyUI models/checkpoints", required: false }, "CheckpointLoaderSimple"),
    entry({ id: "krea-identity", label: "Krea 2 Identity Edit", architecture: "krea2", role: "reference", filename: KREA_REFERENCE_FILES.identityLora, location: "ComfyUI models/loras", required: false }, "Krea2ControlLoRALoader"),
    entry({ id: "krea-depth", label: "Krea 2 Depth Control", architecture: "krea2", role: "reference", filename: KREA_REFERENCE_FILES.depthLora, location: "ComfyUI models/loras", required: false }, "Krea2ControlLoRALoader"),
    entry({ id: "depth-anything", label: "Depth Anything V2 Large", architecture: "krea2", role: "reference", filename: KREA_REFERENCE_FILES.depthModel, location: "ComfyUI models/depthanything", required: false }, "DepthAnythingV2Preprocessor"),
    entry({ id: "illustrious-openpose", label: "SDXL OpenPose ControlNet", architecture: "illustrious", role: "reference", filename: ILLUSTRIOUS_REFERENCE_FILES.openpose, location: "ComfyUI models/controlnet", required: false }, "ControlNetLoader"),
    entry({ id: "illustrious-canny", label: "SDXL Canny ControlNet", architecture: "illustrious", role: "reference", filename: ILLUSTRIOUS_REFERENCE_FILES.canny, location: "ComfyUI models/controlnet", required: false }, "ControlNetLoader"),
    entry({ id: "anima-lllite-pose", label: "Anima LLLite Pose", architecture: "anima", role: "reference", filename: ANIMA_REFERENCE_FILES.pose, location: "ComfyUI models/model_patches", required: false }, "ModelPatchLoader"),
    entry({ id: "anima-lllite-lineart", label: "Anima LLLite Lineart", architecture: "anima", role: "reference", filename: ANIMA_REFERENCE_FILES.structure, location: "ComfyUI models/model_patches", required: false }, "ModelPatchLoader"),
    entry({ id: "face-detector", label: "YOLO Face Detector", architecture: "shared", role: "refinement", filename: "bbox/face_yolov8m.pt", location: "ComfyUI models/ultralytics", required: false }, "UltralyticsDetectorProvider"),
    entry({ id: "krea-raw", label: "Krea 2 Raw training base", architecture: "krea2", role: "training", filename: "raw.safetensors", location: "training-models", required: false, gated: true, license: "Krea 2 Community License" }),
    entry({ id: "krea-training-encoder", label: "Krea 2 training text encoder (BF16)", architecture: "krea2", role: "training", filename: "qwen3vl_4b_bf16.safetensors", location: "training-models", required: false, license: "Apache-2.0" }),
    entry({ id: "z-image-base", label: "Z-Image Base training checkpoint", architecture: "z-image", role: "training", filename: "z_image_bf16.safetensors", location: "training-models", required: false }),
    {
      id: "neural-upscale", label: "Neural upscale model", architecture: "shared",
      role: "upscale", location: "upscale_models + ComfyUI models/upscale_models", required: false,
      installed: parseInstalledUpscaleModels(info).length > 0
    }
  ];
}

/** Curated upscaler catalog with install status from Comfy object_info. */
export function detectUpscaleCatalog(info: any) {
  return listUpscaleCatalog(parseInstalledUpscaleModels(info));
}
