/**
 * Model-agnostic pose + prompt extraction via Comfy preprocessors already installed
 * (OpenPose + LayerStyle Florence2). Used by Remix / Style Maintain / agents.
 */

import fs from "node:fs";
import path from "node:path";
import type { ComfyClient } from "./comfy.js";

export type ApiWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export const EXTRACT_POSE_NODES = ["LoadImage", "OpenposePreprocessor", "SaveImage"] as const;
export const EXTRACT_PROMPT_NODES = [
  "LoadImage",
  "LayerMask: LoadFlorence2Model",
  "LayerUtility: Florence2Image2Prompt",
  "SaveText"
] as const;

export type PromptExtractMode = "caption" | "tags";

export function florenceTaskForMode(mode: PromptExtractMode): string {
  return mode === "tags" ? "mixed caption plus(PromptGen 2.0)" : "more detailed caption";
}

export function preferredFlorenceVersion(available: string[] | undefined): string {
  const preferred = [
    "base-PromptGen-v2.0",
    "large-PromptGen-v2.0",
    "base-PromptGen-v1.5",
    "base-PromptGen",
    "base"
  ];
  if (!available?.length) return "base-PromptGen-v2.0";
  for (const name of preferred) {
    if (available.includes(name)) return name;
  }
  return available[0];
}

/** Stick-figure OpenPose preview → SaveImage */
export function buildPoseExtractWorkflow(imagePath: string, prefix = "extract-pose"): ApiWorkflow {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: { image: imagePath },
      _meta: { title: "[Extract] Source" }
    },
    "2": {
      class_type: "OpenposePreprocessor",
      inputs: {
        image: ["1", 0],
        detect_hand: "enable",
        detect_body: "enable",
        detect_face: "enable",
        resolution: 512
      },
      _meta: { title: "[Extract] OpenPose" }
    },
    "3": {
      class_type: "SaveImage",
      inputs: { filename_prefix: prefix, images: ["2", 0] },
      _meta: { title: "[Extract] Pose stick figure" }
    }
  };
}

/** Florence2 caption/tags → SaveText */
export function buildPromptExtractWorkflow(
  imagePath: string,
  mode: PromptExtractMode,
  florenceVersion: string,
  prefix = "extract-prompt"
): ApiWorkflow {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: { image: imagePath },
      _meta: { title: "[Extract] Source" }
    },
    "2": {
      class_type: "LayerMask: LoadFlorence2Model",
      inputs: { version: florenceVersion },
      _meta: { title: "[Extract] Load Florence2" }
    },
    "3": {
      class_type: "LayerUtility: Florence2Image2Prompt",
      inputs: {
        florence2_model: ["2", 0],
        image: ["1", 0],
        task: florenceTaskForMode(mode),
        text_input: "",
        max_new_tokens: 512,
        num_beams: 3,
        do_sample: false,
        fill_mask: false
      },
      _meta: { title: "[Extract] Florence2 prompt" }
    },
    "4": {
      class_type: "SaveText",
      inputs: {
        text: ["3", 0],
        filename_prefix: prefix,
        format: "txt"
      },
      _meta: { title: "[Extract] Save prompt text" }
    }
  };
}

export function detectExtractCapabilities(info: any): {
  pose: boolean;
  prompt: boolean;
  florenceVersions: string[];
  missingPose: string[];
  missingPrompt: string[];
} {
  const missingPose = EXTRACT_POSE_NODES.filter(node => !(node in (info || {})));
  const missingPrompt = EXTRACT_PROMPT_NODES.filter(node => !(node in (info || {})));
  const versionInput = info?.["LayerMask: LoadFlorence2Model"]?.input?.required?.version;
  const florenceVersions: string[] = Array.isArray(versionInput?.[0]) ? versionInput[0] : [];
  return {
    pose: missingPose.length === 0,
    prompt: missingPrompt.length === 0,
    florenceVersions,
    missingPose,
    missingPrompt
  };
}

export async function waitForComfyHistory(
  comfy: ComfyClient,
  promptId: string,
  timeoutMs = 180_000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response: any = await comfy.history(promptId);
    const history = response?.[promptId];
    if (history) {
      if (history.status?.status_str === "error") {
        const message =
          history.status?.messages?.find((item: any[]) => item[0] === "execution_error")?.[1]?.exception_message ||
          "ComfyUI extract job failed.";
        throw new Error(message);
      }
      if (history.status?.completed) return history;
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(`Extract job timed out after ${Math.round(timeoutMs / 1000)}s.`);
}

export function firstHistoryImage(history: any): { filename: string; subfolder?: string; type?: string } | null {
  const media = Object.values(history?.outputs || {}).flatMap((output: any) => output.images || []);
  const image = media.find((item: any) => item?.filename);
  return image || null;
}

export function readSavedExtractText(outputRoot: string, history: any): string | null {
  // Prefer SaveText file on disk
  for (const output of Object.values(history?.outputs || {}) as any[]) {
    const texts = output?.text || output?.texts || output?.string || output?.strings;
    if (typeof texts === "string" && texts.trim()) return texts.trim();
    if (Array.isArray(texts) && texts[0]) return String(texts[0]).trim();
  }
  // Scan recent extract-prompt*.txt under output
  if (!fs.existsSync(outputRoot)) return null;
  const files = fs
    .readdirSync(outputRoot)
    .filter(name => /^extract-prompt.*\.txt$/i.test(name))
    .map(name => ({ name, mtime: fs.statSync(path.join(outputRoot, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files[0]) return null;
  return fs.readFileSync(path.join(outputRoot, files[0].name), "utf8").trim() || null;
}
