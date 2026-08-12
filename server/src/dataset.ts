import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  DEFAULT_PROMPT_LIST_ID,
  loadPromptListSafe,
  promptIndexForSlot
} from "./dataset-prompt-lists.js";
import {
  cycleNotesForFamily,
  getDatasetModeEntry
} from "./dataset-mode-catalog.js";

const projectRootFromHere = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Dataset modes:
 * - "standard" = directed pose matrix
 * - any other id = prompt-list mode using data/dataset-prompt-lists/<id>.json
 *
 * Open string (not closed zod enum) so new JSON lists work without a schema redeploy.
 * Known UI/copy/negatives live in dataset-mode-catalog.ts (add one entry per new set).
 */
export const DATASET_MODE_STANDARD = "standard" as const;
export const DATASET_MODE_INSTAGRAM_UGC = "instagram-ugc" as const;
export const DATASET_MODE_NYX_LATEX_FETISH = "nyx-latex-fetish" as const;
export const DATASET_MODE_NYX_DOMINATION = "nyx-domination" as const;
export const DATASET_MODE_NYX_CHOKE = "nyx-choke" as const;
export const NYX_PROMPT_LIST_ID = "nyx-latex-fetish";
export const NYX_DOMINATION_LIST_ID = "nyx-domination";
export const NYX_CHOKE_LIST_ID = "nyx-choke";

/** Known first-class modes (docs/UI). Runtime accepts any list-id-shaped mode string. */
export type DatasetModeId =
  | typeof DATASET_MODE_STANDARD
  | typeof DATASET_MODE_INSTAGRAM_UGC
  | typeof DATASET_MODE_NYX_LATEX_FETISH
  | typeof DATASET_MODE_NYX_DOMINATION
  | typeof DATASET_MODE_NYX_CHOKE
  | (string & {});

/** NSFW list modes (X-friendly negatives; not Instagram clothing-coverage). */
export function isNsfwDatasetMode(mode?: string | null): boolean {
  const entry = getDatasetModeEntry(mode);
  if (entry.nsfw) return true;
  const m = String(mode || "").trim();
  return m.startsWith("nyx-");
}

const datasetModeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, "Invalid dataset mode id.")
  .default(DATASET_MODE_STANDARD);

/** Modes that pull shots from data/dataset-prompt-lists/*.json (any length, wraps). */
export function isPromptListDatasetMode(mode?: string | null): boolean {
  const m = String(mode || "").trim();
  return Boolean(m) && m !== DATASET_MODE_STANDARD;
}

/**
 * Default JSON list id for a list-based mode.
 * Mode id IS the list id (instagram-ugc → instagram-ugc.json, nyx-latex-fetish → …).
 * Never force Instagram when the mode is a different set.
 */
export function defaultPromptListIdForMode(mode?: string | null): string {
  if (!mode || mode === DATASET_MODE_STANDARD) return DEFAULT_PROMPT_LIST_ID;
  return mode;
}

/**
 * Resolve list prompts from data/dataset-prompt-lists/<id>.json
 * (editable) or an optional per-run custom list. Do not hardcode long prompts here.
 */
export function resolveInstagramPrompts(
  projectRoot = projectRootFromHere,
  options?: { promptListId?: string; customPrompts?: string[]; datasetMode?: string }
): string[] {
  if (options?.customPrompts?.length) {
    return options.customPrompts.map(item => item.trim()).filter(Boolean);
  }
  const mode = options?.datasetMode;
  const defaultId = defaultPromptListIdForMode(mode);
  // Prefer explicit promptListId when it matches the mode family; otherwise mode wins so
  // Instagram/Nyx never cross-wire if the client sends a stale default list id.
  let id = options?.promptListId || defaultId;
  if (isPromptListDatasetMode(mode)) {
    const explicit = String(options?.promptListId || "").trim();
    // If client still sends the global default (instagram-ugc) while mode is another set, coerce.
    if (!explicit || (explicit === DEFAULT_PROMPT_LIST_ID && mode !== DATASET_MODE_INSTAGRAM_UGC)) {
      id = defaultId;
    } else {
      id = explicit;
    }
  }
  const list = loadPromptListSafe(projectRoot, id);
  if (!list?.prompts?.length) {
    throw new Error(
      `Prompt list "${id}" is missing or empty. ` +
        `Edit data/dataset-prompt-lists/${id}.json or use Dataset Builder → Edit prompt list.`
    );
  }
  return list.prompts;
}

/** Load current Instagram UGC shots (from editable JSON). */
export function getInstagramUgcShots(projectRoot = projectRootFromHere): string[] {
  return resolveInstagramPrompts(projectRoot);
}

/** Current list length (dynamic — do not hardcode 40 in call sites). */
export function getInstagramUgcShotCount(projectRoot = projectRootFromHere): number {
  return resolveInstagramPrompts(projectRoot).length;
}

/** @deprecated Prefer getInstagramUgcShots() — snapshot for older imports. */
export const INSTAGRAM_UGC_SHOTS = getInstagramUgcShots();
/** @deprecated Prefer getInstagramUgcShotCount() */
export const INSTAGRAM_UGC_SHOT_COUNT = INSTAGRAM_UGC_SHOTS.length;

const DEFAULT_MATRIX = {
  angles: ["front", "three-quarter", "profile", "back three-quarter"],
  framings: ["close-up headshot", "waist-up", "three-quarter body", "full-body"],
  expressions: ["neutral", "smiling", "angry", "surprised", "thoughtful"],
  poses: ["standing", "walking", "sitting", "simple action"],
  scenes: ["studio", "indoor", "outdoor"],
  lighting: ["soft daylight", "evening light", "backlit"],
  varyOutfits: true, varyBackgrounds: true
};
export const DEFAULT_POSE_SEQUENCE = [
  "standing relaxed with both arms naturally at the sides",
  "standing with one hand resting lightly on the hip",
  "standing with both hands on the hips and shoulders open",
  "standing with arms loosely crossed",
  "standing with hands gently clasped in front",
  "standing while adjusting one sleeve",
  "standing while tucking hair behind one ear",
  "standing with one hand touching the collarbone",
  "looking back over one shoulder with torso turned",
  "side-on stance with weight shifted onto the back leg",
  "taking a natural step toward the camera",
  "walking across the frame in profile",
  "walking away while glancing back",
  "mid-stride with one arm swinging forward",
  "leaning lightly against a wall with one knee bent",
  "resting one shoulder against a wall with hands relaxed",
  "sitting upright on the front edge of a chair",
  "sitting with ankles crossed and hands on the lap",
  "sitting sideways on a chair with torso facing camera",
  "sitting with one elbow resting lightly on one knee",
  "perched on a stool with one foot slightly forward",
  "kneeling upright with hands resting on the thighs",
  "low crouch with balanced posture and face toward camera",
  "reaching naturally toward an object beside the camera",
  "holding a small product at chest height with one hand",
  "presenting a small product with both hands",
  "gesturing conversationally with one open hand",
  "laughing naturally with one hand near the face",
  "placing both hands briefly behind the head",
  "stretching both arms gently upward",
  "turning mid-motion with hair moving naturally",
  "three-quarter stance while adjusting the waistband",
  "hands placed in trouser pockets with relaxed shoulders",
  "one hand in a pocket and the other arm relaxed",
  "holding a phone casually at waist height",
  "looking down at a phone held in both hands",
  "lifting a cup toward the mouth in a candid moment",
  "resting forearms on a counter while leaning slightly forward",
  "close conversational gesture with fingertips near the chin",
  "symmetrical beauty pose with face forward and hands out of frame"
] as const;
const directedAngles = [
  "eye-level front", "slightly high front", "low front", "eye-level three-quarter left",
  "eye-level three-quarter right", "high three-quarter left", "low three-quarter right",
  "left profile", "right profile", "back three-quarter left", "back three-quarter right",
  "overhead diagonal", "low diagonal", "shoulder-height candid", "waist-height upward",
  "tight eye-level front", "tight three-quarter left", "tight three-quarter right",
  "distant eye-level front", "distant side angle"
];
const directedFramings = [
  "tight facial close-up", "head-and-shoulders portrait", "chest-up portrait", "waist-up portrait",
  "three-quarter body view", "full-body view", "wide full-body environmental view",
  "seated three-quarter view", "candid medium shot", "detail-oriented beauty close-up"
];
const directedExpressions = [
  "neutral and relaxed", "soft closed-mouth smile", "bright natural smile", "mid-laugh",
  "thoughtful", "confident", "curious", "friendly conversational", "calm serious", "pleasantly surprised"
];
const directedScenes = [
  "clean studio", "minimal indoor room", "window-side interior", "modern kitchen",
  "casual living room", "covered outdoor walkway", "open outdoor setting", "simple urban exterior",
  "neutral textured wall", "uncluttered lifestyle setting"
];
const directedLighting = [
  "soft frontal daylight", "window light from camera left", "window light from camera right",
  "soft overhead daylight", "diffused studio key light", "gentle side light with soft fill",
  "bright overcast outdoor light", "warm late-afternoon light", "subtle backlight with facial fill",
  "even neutral beauty lighting", "soft morning light", "cool indirect daylight",
  "warm indoor practical light", "high-key studio light", "low-contrast editorial light",
  "rim light with soft front fill", "open-shade outdoor light", "golden-hour side light",
  "balanced mixed ambient light", "clean direct-but-soft flash"
];
const cycleDirectives = [
  "",
  "alternate variation pass with reversed body orientation and different hand placement",
  "third variation pass with a changed camera height, stride, and gaze direction"
];
const matrixSchema = z.object({
  angles: z.array(z.string().max(80)).min(1).max(8).default(DEFAULT_MATRIX.angles),
  framings: z.array(z.string().max(80)).min(1).max(8).default(DEFAULT_MATRIX.framings),
  expressions: z.array(z.string().max(80)).min(1).max(8).default(DEFAULT_MATRIX.expressions),
  poses: z.array(z.string().max(100)).min(1).max(10).default(DEFAULT_MATRIX.poses),
  scenes: z.array(z.string().max(100)).min(1).max(10).default(DEFAULT_MATRIX.scenes),
  lighting: z.array(z.string().max(100)).min(1).max(8).default(DEFAULT_MATRIX.lighting),
  varyOutfits: z.boolean().default(true),
  varyBackgrounds: z.boolean().default(true)
});

export const characterAdjustmentsSchema = z.object({
  hair: z.string().trim().max(240).default(""),
  body: z.string().trim().max(240).default(""),
  other: z.string().trim().max(500).default("")
}).default({ hair: "", body: "", other: "" });

export const datasetSchema = z.object({
  name: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/),
  trigger: z.string().trim().min(2).max(80),
  model: z.string().min(1).max(260).refine(value => !path.isAbsolute(value) && !value.includes("..")),
  basePrompt: z.string().trim().min(2).max(1800),
  count: z.number().int().min(12).max(40).default(40),
  /**
   * Output canvas size. Default stays 512×768 for fast LoRA datasets.
   * Optional hi-res matches Photo (e.g. 1530×2048, 2560×1440 QHD).
   * Not forced to multiples of 64 — same rules as generationSchema / Photo mode.
   * Default remains 512×768 for fast LoRA datasets.
   */
  width: z.number().int().min(256).max(2560).default(512),
  height: z.number().int().min(256).max(2560).default(768),
  /**
   * Base seed for this dataset run.
   * - Image N uses Comfy seed = base + N
   * - Instagram shuffle permutation is seeded by base (deterministic for reproducibility)
   * Dataset Builder sends a fresh random seed each Build unless "Lock seed" is on.
   * Do not hardcode 42 in the UI — that made every consecutive run identical.
   */
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(42),
  variationOffset: z.number().int().min(0).max(1000).default(0),
  characterProfileId: z.string().uuid().optional(),
  masterReference: z.string().max(500).refine(value => !path.isAbsolute(value) && !value.includes("..")).optional(),
  characterAdjustments: characterAdjustmentsSchema,
  captionStrategy: z.enum(["identity-focused", "flexible-character", "outfit-concept", "style", "custom"]).default("flexible-character"),
  /**
   * standard = directed pose/angle matrix.
   * Any other id = prompt-list mode (loads data/dataset-prompt-lists/<id or promptListId>.json).
   * Open string (not closed enum) so new custom sets work without schema redeploy.
   * First-class UI options: instagram-ugc, nyx-latex-fetish.
   */
  datasetMode: datasetModeIdSchema,
  /**
   * Which JSON under data/dataset-prompt-lists/ for list modes.
   * Defaults from mode id; server coerces when mode is a set and client sent a stale default.
   */
  promptListId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i).default(DEFAULT_PROMPT_LIST_ID),
  /**
   * sequential = prompts[0], prompts[1], … in list order (default).
   * shuffle = deterministic permutation per full cycle (seeded by seed + cycle).
   */
  promptOrder: z.enum(["sequential", "shuffle"]).default("sequential"),
  /**
   * Optional one-run override: full prompt strings (replaces file list for this build only).
   * Prefer editing the JSON list via API for permanent updates.
   */
  customPrompts: z.array(z.string().trim().min(8).max(4000)).max(200).optional(),
  /**
   * Negative prompt for every shot in this build (editable in Dataset Builder).
   * Empty string falls back to mode defaults via resolveDatasetNegativePrompt.
   * Instagram UGC defaults include clothing-coverage / anti-nude terms (not only identity).
   */
  negativePrompt: z.string().trim().max(2500).optional(),
  /**
   * Master image identity / Direct reference strength (Krea ref_boost, Z-Image structural ref, etc.).
   * Editable in Dataset Builder. Omitted → mode + architecture defaults via resolveMasterIdentityStrength.
   * Higher = lock face/body closer to master (may copy pose/outfit). Lower = freer list-driven variety.
   */
  masterIdentityStrength: z.number().min(0).max(2).optional(),
  /** Generation LoRAs from the Dataset Builder list (authoritative on create). Applied during sampling. */
  loras: z.array(z.object({
    name: z.string().min(1).max(260).refine(v => !path.isAbsolute(v) && !v.includes("..")),
    strength: z.number().min(-2).max(2).default(1)
  })).max(8).default([]),
  /** True when model/LoRAs were resolved from master PNG or gallery metadata. */
  stackMatchedFromMaster: z.boolean().default(false),
  /** Optional project root override (tests). */
  projectRoot: z.string().optional(),
  promptMatrix: matrixSchema.default(DEFAULT_MATRIX)
});

export type DatasetInput = z.infer<typeof datasetSchema>;

/** Standard directed-matrix negative (identity + variety). */
export const DEFAULT_STANDARD_DATASET_NEGATIVE =
  "different person, changed identity, duplicate person, repeated generic pose, static pose, same camera framing, distorted face, malformed hands";

/**
 * Instagram UGC negative: identity + quality + clothing coverage.
 * Diffusion is weak at "no nudity" in the positive; push coverage from the negative side.
 * Editable in Dataset Builder; this is the mode default only.
 */
export const DEFAULT_INSTAGRAM_UGC_NEGATIVE = [
  "different person, changed identity, male, group photo, crowd",
  "deformed face, malformed hands, extra limbs, fused fingers, blurry face",
  "heavy beauty filter, watermark, text overlay, logo, low resolution",
  "nude, naked, fully nude, topless, bottomless, unclothed, no clothes, removed clothes",
  "exposed breasts, nipples, areola, genitals, pubic hair",
  "see-through, transparent clothing, sheer fabric, lingerie only, underwear only",
  "bikini only, wardrobe malfunction, clothing pulled down, missing clothes"
].join(", ");

/**
 * Nyx latex fetish / solo X NSFW negative: identity + quality only.
 * Intentionally does NOT ban nudity, latex, or intimate framing (X / adult content OK).
 * Keeps "male" out for solo-woman character sets.
 */
export const DEFAULT_NYX_LATEX_FETISH_NEGATIVE = [
  "different person, changed identity, male, group photo, crowd",
  "deformed face, malformed hands, extra limbs, fused fingers, blurry face",
  "watermark, text overlay, logo, low resolution, cartoon, anime, 3d render"
].join(", ");

/**
 * Nyx domination / femdom set: NSFW OK and the male sub must remain in-frame.
 * Do NOT include "male" here — that would fight the shot list.
 */
export const DEFAULT_NYX_DOMINATION_NEGATIVE = [
  "different person, changed identity, group photo, crowd, extra people",
  "deformed face, malformed hands, extra limbs, fused fingers, blurry face",
  "watermark, text overlay, logo, low resolution, cartoon, anime, 3d render"
].join(", ");

/** Resolve negative for a dataset mode; custom non-empty string wins. */
export function resolveDatasetNegativePrompt(
  datasetMode: DatasetModeId | string | undefined,
  custom?: string | null
): string {
  const trimmed = String(custom ?? "").trim();
  if (trimmed) return trimmed.slice(0, 2500);
  const profile = getDatasetModeEntry(datasetMode).negativeProfile;
  if (profile === "nsfw-with-male") return DEFAULT_NYX_DOMINATION_NEGATIVE;
  if (profile === "nsfw-solo") return DEFAULT_NYX_LATEX_FETISH_NEGATIVE;
  if (profile === "instagram-ugc") return DEFAULT_INSTAGRAM_UGC_NEGATIVE;
  return DEFAULT_STANDARD_DATASET_NEGATIVE;
}

/**
 * Dataset Builder editable LoRA list is authoritative on create.
 * Master PNG/gallery LoRAs only seed inspect-master when form is not authoritative.
 */
export function resolveDatasetLoraHints(options: {
  formLoras?: Array<{ name: string; strength: number }> | null;
  masterLoras?: Array<{ name: string; strength: number }> | null;
  /** true = use form list exactly (adds, removes, strengths). false = master-first merge for inspect. */
  formAuthoritative: boolean;
}): { loras: Array<{ name: string; strength: number }>; sources: string[] } {
  const form = Array.isArray(options.formLoras) ? options.formLoras : [];
  const master = Array.isArray(options.masterLoras) ? options.masterLoras : [];
  const sources: string[] = [];
  if (options.formAuthoritative) {
    if (form.length) sources.push(`form LoRAs ×${form.length} (edited stack)`);
    else sources.push("form LoRAs cleared (no stack LoRAs)");
    return { loras: form.map(l => ({ name: l.name, strength: Number(l.strength) || 1 })), sources };
  }
  const loraMap = new Map<string, { name: string; strength: number }>();
  const keyOf = (n: string) => path.basename(n).replace(/\.safetensors$/i, "").toLowerCase();
  for (const lora of master) loraMap.set(keyOf(lora.name), lora);
  for (const lora of form) {
    const k = keyOf(lora.name);
    if (!loraMap.has(k)) loraMap.set(k, lora);
  }
  if (master.length) sources.push(`master LoRAs ×${master.length}`);
  if (form.length && master.length) sources.push("merged form extras");
  else if (form.length && !master.length) sources.push("form LoRAs");
  return { loras: [...loraMap.values()], sources };
}

export const datasetExtensionSchema = z.object({
  count: z.number().int().min(1).max(40),
  characterAdjustments: characterAdjustmentsSchema.optional()
});

const outfits = ["casual neutral outfit", "simple fitted outfit", "layered everyday outfit", "clean monochrome outfit"];
const backgrounds = ["plain neutral background", "minimal interior background", "uncluttered urban background", "soft natural background"];
function usesDefault(values: string[], defaults: readonly string[]) {
  return values.length === defaults.length && values.every((value, index) => value === defaults[index]);
}

function listShotTags(
  shot: string,
  listIndex: number,
  cycle: number,
  order: string,
  datasetMode: string
) {
  const lower = shot.toLowerCase();
  const framing = lower.includes("close-up") || lower.includes("lips")
    ? "close-up headshot"
    : lower.includes("medium shot")
      ? "waist-up medium shot"
      : lower.includes("full-body") || lower.includes("full body") || lower.includes("smother") || lower.includes("kneeling") || lower.includes("standing")
        ? "full-body view"
        : "lifestyle shot";
  const angle = lower.includes("side profile") || lower.includes("sideways")
    ? "profile"
    : lower.includes("over shoulder") || lower.includes("looking back")
      ? "three-quarter over-shoulder"
      : lower.includes("low angle") || lower.includes("looking up")
        ? "low angle"
        : lower.includes("mirror")
          ? "mirror selfie front"
          : "eye-level front";
  const scene = lower.includes("bedroom") || lower.includes("bed")
    ? "bedroom"
    : lower.includes("creator room") || lower.includes("luxury")
      ? "creator room"
      : lower.includes("window")
        ? "window-side interior"
        : lower.includes("wall") || lower.includes("floor")
          ? "indoor lifestyle"
          : "casual indoor lifestyle";
  const lighting = lower.includes("pink") || lower.includes("magenta") || lower.includes("crimson") || lower.includes("goth")
    ? "moody colored light"
    : lower.includes("side light") || lower.includes("window")
      ? "soft window side light"
      : "soft natural indoor light";
  const expression =
    datasetMode === DATASET_MODE_NYX_DOMINATION
      ? "commanding femdom expression"
      : datasetMode === DATASET_MODE_NYX_LATEX_FETISH || String(datasetMode).startsWith("nyx-")
        ? "dominant teasing expression"
        : "instagram lifestyle expression";
  return {
    angle,
    framing,
    expression,
    /** Short pose key for uniqueness checks — full shot lives in tags.shot */
    pose: `list#${listIndex}`,
    shot,
    scene,
    lighting,
    outfit: "outfit as described in shot",
    background: scene,
    mode: datasetMode,
    order,
    cycle: String(cycle),
    shotIndex: String(listIndex)
  };
}

function characterAdjustmentText(input: DatasetInput) {
  return [
    input.characterAdjustments.hair && `intentional hair adjustment: ${input.characterAdjustments.hair}`,
    input.characterAdjustments.body && `intentional body proportion adjustment: ${input.characterAdjustments.body}`,
    input.characterAdjustments.other && `intentional character adjustment: ${input.characterAdjustments.other}`
  ].filter(Boolean).join(", ");
}

/**
 * Build character half from Dataset Builder fields (saved profile → basePrompt + optional adjustments).
 *
 * Sources allowed: form `basePrompt`, character adjustments, trigger (handled separately).
 * Sources never used here: master PNG A1111 positive text, gallery job prompt, stack metadata prompt.
 */
export function composeCharacterFeatureBlock(input: DatasetInput): string {
  const base = String(input.basePrompt || "").trim();
  const adjustments = characterAdjustmentText(input);
  return [base, adjustments].filter(Boolean).join(", ");
}

/**
 * Default master-image identity strength by architecture + dataset mode.
 *
 * Master image is only an identity lock (Krea Identity / structural ref) — NOT a prompt source.
 * High ref_boost (e.g. 1.15) copies the master's pose, outfit, and framing and fights the shot list.
 * List modes (Instagram / Nyx) default lower so list prompts (pose/outfit/camera) can win.
 */
export function datasetIdentityReferenceStrength(
  architecture: string,
  datasetMode: DatasetModeId | string = "standard"
): number {
  if (isPromptListDatasetMode(datasetMode)) {
    return architecture === "krea2" ? 0.72 : architecture === "illustrious" ? 0.55 : 0.55;
  }
  return architecture === "krea2" ? 0.85 : architecture === "illustrious" ? 0.65 : 0.65;
}

/**
 * Resolve strength applied to master Direct reference for every dataset shot.
 * Custom value (from Dataset Builder) wins when finite; otherwise mode/architecture default.
 * Clamped to generationSchema references.strength [0, 2].
 */
export function resolveMasterIdentityStrength(
  architecture: string,
  datasetMode: DatasetModeId | string = "standard",
  custom?: number | null
): number {
  if (custom !== undefined && custom !== null && Number.isFinite(Number(custom))) {
    return Math.min(2, Math.max(0, Number(custom)));
  }
  return datasetIdentityReferenceStrength(architecture, datasetMode);
}

/**
 * Instagram UGC caption structure (training + generation):
 *   [1] list prompt (one of the 40 editable shots — pose/outfit/camera)
 *   [2] character features (chosen character description for this dataset)
 * Optional cycle note + same-person anchors at the end.
 *
 * Never inject master-image generation text. Caption = list + form character only.
 */
export function composeInstagramDatasetCaption(options: {
  listPrompt: string;
  characterFeatures: string;
  trigger?: string;
  cycleDirective?: string;
}): { caption: string; listHalf: string; characterHalf: string } {
  const listHalf = String(options.listPrompt || "").trim();
  const characterHalf = String(options.characterFeatures || "").trim();
  const trigger = String(options.trigger || "").trim();
  const triggerToken = trigger.replace(/^photo of\s+/i, "").trim();
  const hasTrigger =
    !trigger ||
    listHalf.toLowerCase().includes(trigger.toLowerCase()) ||
    (triggerToken.length > 1 && listHalf.toLowerCase().includes(triggerToken.toLowerCase())) ||
    (characterHalf && characterHalf.toLowerCase().includes(triggerToken.toLowerCase()));

  // First half: optional trigger (if missing) + list prompt
  const firstHalf = [hasTrigger ? "" : trigger, listHalf].filter(Boolean).join(", ");
  // Second half: character features from the selected dataset character
  const secondHalf = characterHalf
    ? `character features: ${characterHalf}`
    : "";

  const caption = [
    firstHalf,
    options.cycleDirective?.trim() || "",
    secondHalf,
    "same person",
    "consistent identity across dataset"
  ]
    .filter(Boolean)
    .join(", ");

  return { caption, listHalf: firstHalf, characterHalf: secondHalf };
}

/**
 * List-based modes (Instagram UGC, Nyx latex fetish): one list prompt per image + character half.
 * sequential = list order; shuffle = unique permuted order each full cycle.
 * Any list length wraps (slot % length) so 10-prompt sets work with 12/24/40 counts.
 */
function listBasedDatasetPrompts(input: DatasetInput) {
  const mode = String(input.datasetMode || DATASET_MODE_INSTAGRAM_UGC);
  const root = input.projectRoot || projectRootFromHere;
  const shots = resolveInstagramPrompts(root, {
    promptListId: input.promptListId,
    customPrompts: input.customPrompts,
    datasetMode: mode
  });
  const listLen = shots.length;
  const characterFeatures = composeCharacterFeatureBlock(input);
  const order = input.promptOrder || "sequential";
  const cycleNotes = cycleNotesForFamily(getDatasetModeEntry(mode).cycleFamily);

  return Array.from({ length: input.count }, (_, index) => {
    const slot = input.variationOffset + index;
    const { listIndex, cycle, positionInCycle } = promptIndexForSlot(slot, listLen, order, input.seed);
    const shot = shots[listIndex];
    const tags = listShotTags(shot, listIndex, cycle, order, mode);
    const cycleDirective = cycleNotes[Math.min(cycle, cycleNotes.length - 1)];
    const composed = composeInstagramDatasetCaption({
      listPrompt: shot,
      characterFeatures,
      trigger: input.trigger,
      cycleDirective
    });

    return {
      index,
      seed: input.seed + index,
      variationSlot: slot,
      listIndex,
      positionInCycle,
      tags: {
        ...tags,
        listHalf: composed.listHalf,
        characterHalf: composed.characterHalf
      },
      caption: composed.caption,
      listHalf: composed.listHalf,
      characterHalf: composed.characterHalf
    };
  });
}

export function datasetPrompts(input: DatasetInput) {
  if (isPromptListDatasetMode(input.datasetMode)) return listBasedDatasetPrompts(input);

  const matrix = input.promptMatrix;
  const adjustmentText = characterAdjustmentText(input);
  return Array.from({ length: input.count }, (_, index) => {
    const slot = input.variationOffset + index;
    const sequenceIndex = slot % DEFAULT_POSE_SEQUENCE.length;
    const cycle = Math.floor(slot / DEFAULT_POSE_SEQUENCE.length);
    const defaultPose = usesDefault(matrix.poses, DEFAULT_MATRIX.poses);
    const defaultAngle = usesDefault(matrix.angles, DEFAULT_MATRIX.angles);
    const defaultFraming = usesDefault(matrix.framings, DEFAULT_MATRIX.framings);
    const defaultExpression = usesDefault(matrix.expressions, DEFAULT_MATRIX.expressions);
    const defaultScene = usesDefault(matrix.scenes, DEFAULT_MATRIX.scenes);
    const defaultLighting = usesDefault(matrix.lighting, DEFAULT_MATRIX.lighting);
    const tags = {
      angle: defaultAngle ? directedAngles[slot % directedAngles.length] : matrix.angles[slot % matrix.angles.length],
      framing: defaultFraming ? directedFramings[slot % directedFramings.length] : matrix.framings[slot % matrix.framings.length],
      expression: defaultExpression ? directedExpressions[(slot * 3) % directedExpressions.length] : matrix.expressions[(slot * 3) % matrix.expressions.length],
      pose: defaultPose ? DEFAULT_POSE_SEQUENCE[sequenceIndex] : matrix.poses[slot % matrix.poses.length],
      scene: defaultScene ? directedScenes[(slot * 7) % directedScenes.length] : matrix.scenes[(slot * 7) % matrix.scenes.length],
      lighting: defaultLighting ? directedLighting[(slot * 11) % directedLighting.length] : matrix.lighting[(slot * 11) % matrix.lighting.length],
      outfit: matrix.varyOutfits ? outfits[slot % outfits.length] : "consistent outfit",
      background: matrix.varyBackgrounds ? backgrounds[(slot * 3) % backgrounds.length] : "simple uncluttered background"
    };
    const cycleDirective = cycleDirectives[Math.min(cycle, cycleDirectives.length - 1)];
    const shot = `${tags.framing}, ${tags.angle} camera angle, ${tags.expression} expression, ${tags.pose}, ${tags.scene}, ${tags.lighting}, ${tags.outfit}, ${tags.background}${cycleDirective ? `, ${cycleDirective}` : ""}, clearly distinct body arrangement and camera composition`;
    const caption = `${input.trigger}, ${input.basePrompt}${adjustmentText ? `, ${adjustmentText}` : ""}, ${shot}, same person, consistent facial features, consistent hair, realistic anatomy`;
    return {
      index,
      seed: input.seed + index,
      variationSlot: slot,
      listIndex: sequenceIndex,
      positionInCycle: sequenceIndex,
      tags,
      caption,
      listHalf: shot,
      characterHalf: `character features: ${[input.basePrompt, adjustmentText].filter(Boolean).join(", ")}`
    };
  });
}

export type DatasetPromptPlanItem = ReturnType<typeof datasetPrompts>[number];

export function datasetCaptionForPrompt(record: {
  promptPlan?: Array<{ index?: number; caption?: string }>;
  captions?: string[];
  trigger?: string;
}, index: number) {
  const planned = record.promptPlan?.find(item => item.index === index)?.caption;
  return String(planned ?? record.captions?.[index] ?? record.trigger ?? "").trim();
}
