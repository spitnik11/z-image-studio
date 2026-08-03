import { modelArchitecture, type ApiWorkflow, type Generation } from "./workflow.js";

export type ImageArchitecture = "z-image" | "krea2" | "illustrious" | "anima";

export type ModelAdapter = {
  id: ImageArchitecture;
  displayName: string;
  architecture: ImageArchitecture;
  matches: (filename: string) => boolean;
  defaults: { steps: number; guidance: number; sampler: string; scheduler: string };
  trainingBase?: string;
  trainable: boolean;
  loaderKind: "split" | "checkpoint";
  referenceModes: Array<"pose" | "direct" | "face">;
};

export const modelAdapters: Record<ImageArchitecture, ModelAdapter> = {
  "z-image": {
    id: "z-image",
    displayName: "Z-Image Turbo",
    architecture: "z-image",
    matches: filename => modelArchitecture(filename) === "z-image",
    defaults: { steps: 8, guidance: 1, sampler: "res_multistep", scheduler: "simple" },
    trainingBase: "Z-Image Base", trainable: true, loaderKind: "split",
    referenceModes: ["pose", "direct", "face"]
  },
  krea2: {
    id: "krea2",
    displayName: "Krea 2 Turbo",
    architecture: "krea2",
    matches: filename => modelArchitecture(filename) === "krea2",
    defaults: { steps: 8, guidance: 1, sampler: "euler", scheduler: "simple" },
    trainingBase: "Krea 2 Raw", trainable: true, loaderKind: "split",
    referenceModes: ["pose", "direct", "face"]
  },
  illustrious: {
    id: "illustrious",
    displayName: "Illustrious XL",
    architecture: "illustrious",
    matches: filename => modelArchitecture(filename) === "illustrious",
    defaults: { steps: 28, guidance: 4, sampler: "dpmpp_sde", scheduler: "karras" },
    trainingBase: "SDXL checkpoint", trainable: true,
    loaderKind: "checkpoint",
    referenceModes: ["pose", "direct", "face"]
  },
  anima: {
    id: "anima",
    displayName: "Anima",
    architecture: "anima",
    matches: filename => modelArchitecture(filename) === "anima",
    // ComfyUI Anima Base v1 defaults: ~30 steps, CFG 4, euler/simple (turbo LoRA uses 8/1).
    defaults: { steps: 30, guidance: 4, sampler: "euler", scheduler: "simple" },
    trainable: false,
    loaderKind: "split",
    referenceModes: ["pose", "direct", "face"]
  }
};

export function adapterForModel(filename: string): ModelAdapter | undefined {
  const architecture = modelArchitecture(filename);
  return architecture === "unknown" ? undefined : modelAdapters[architecture];
}

export function buildWithAdapter(
  filename: string,
  input: Generation,
  builders: Record<ImageArchitecture, (input: Generation) => ApiWorkflow>
) {
  const adapter = adapterForModel(filename);
  if (!adapter) throw new Error(`Unsupported image-model architecture: ${filename}`);
  return builders[adapter.id](input);
}
