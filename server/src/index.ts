import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import multer from "multer";
import { z } from "zod";
import { ComfyClient } from "./comfy.js";
import {
  ANIMA_FILES,
  ANIMA_REFERENCE_FILES,
  buildAnimaWorkflow,
  buildConsistentCharacterWorkflow,
  buildIllustriousWorkflow,
  buildWorkflow,
  generationSchema,
  ILLUSTRIOUS_REFERENCE_FILES,
  KREA_REFERENCE_FILES,
  modelArchitecture,
  POSE_FILES,
  safeOutputPath,
  saveMetadata,
  type ApiWorkflow
} from "./workflow.js";
import { buildVideoWorkflow, SCAIL_FILES, SCAIL_NODES, videoGenerationSchema } from "./video.js";
import { trainingProfile, trainingSchema } from "./training.js";
import { getTrainingPaths, missingTrainingFiles, runTrainingProcess, trainingCommands, trainingPreview, writeDatasetConfig, writeSdScriptsDatasetConfig } from "./musubi-training.js";
import {
  datasetCaptionForPrompt,
  datasetExtensionSchema,
  datasetIdentityReferenceStrength,
  datasetPrompts,
  datasetSchema,
  resolveDatasetLoraHints,
  resolveDatasetNegativePrompt
} from "./dataset.js";
import {
  DEFAULT_PROMPT_LIST_ID,
  listPromptLists,
  loadPromptList,
  replacePromptListPrompts,
  savePromptList
} from "./dataset-prompt-lists.js";
import { analyzeReview, exportReviewedDataset, loadReview, removeReviewItem, saveReview, updateReviewItem } from "./dataset-review.js";
import { buildModelManifest, detectReferenceCapabilities, detectUpscaleCatalog } from "./diagnostics.js";
import { adapterForModel, modelAdapters } from "./model-adapters.js";
import { applyLoraActivations, LoraRegistry, type LoraRecord } from "./lora-registry.js";
import { CharacterProfileStore } from "./character-profiles.js";
import { parseTrainingProgress, trainingTelemetry } from "./training-telemetry.js";
import {
  DISMISS_JOB_ERROR,
  generationOutcome,
  orphanGenerationOutcome,
  persistedGenerationOutcome,
  promptIdsInComfyQueue,
  type GenerationOutcome
} from "./generation-history.js";
import {
  collectResourceHashes,
  embedCivitaiMetadataInPngFile,
  matchLoraFilenames,
  matchModelFilename,
  readGenerationMetaFromPng
} from "./civitai-metadata.js";
import { findLibraryResource, resolveInside, writeJsonAtomic } from "./file-utils.js";
import { composeCharacterPrompts, generationCharacterSchema, type GenerationCharacter } from "./prompt-composition.js";
import { generatePrompt, PromptLibraryStore, validatePromptRequest } from "./prompt-engine.js";
import { CharacterPresetStore, presetDatasetHandoff, presetGenerationInput } from "./character-presets.js";
import {
  assertLibraryExtension,
  classifyLibraryModel,
  installLibraryFile,
  LIBRARY_MAX_FILE_BYTES,
  LibraryUploadError,
  sanitizeLibraryFilename,
  validateLibraryUpload,
  type LibraryKind
} from "./library-upload.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const workflowTemplate = JSON.parse(fs.readFileSync(path.join(root, "workflows/z-image-turbo-api.json"), "utf8")) as ApiWorkflow;
const recordsFile = path.join(root, "data/generations.json");
const uploadRoot = path.join(root, "ComfyUI/input/z-image-studio");
const trainingInputRoot = path.join(root, "ComfyUI/input/lora-training");
const trainingStagingRoot = path.join(root, "data/training-staging");
const trainingRecordsFile = path.join(root, "data/training-jobs.json");
const datasetRecordsFile = path.join(root, "data/dataset-jobs.json");
const modelCatalogFile = path.join(root, "data/model-catalog.json");
const settingsFile = path.join(root, "data/settings.json");
const datasetsRoot = path.join(root, "data/datasets");
// Group each dataset's raw ComfyUI generations under output/datasets/<slug>/ instead of dumping
// them flat in the output root. Slug is human-readable (name/trigger) + short id for uniqueness.
const datasetOutputSlug = (label: string | undefined, id: string) =>
  `${(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "dataset"}-${id.slice(0, 8)}`;
const datasetOutputName = (slug: string, oneBasedIndex: number) =>
  `datasets/${slug}/${String(oneBasedIndex).padStart(3, "0")}`;
const loraRegistry = new LoraRegistry(path.join(root, "data/lora-registry.json"), path.join(root, "lora"));
const characterProfiles = new CharacterProfileStore(path.join(root, "data/character-profiles.json"));
const promptLibrary = new PromptLibraryStore(path.join(root, "data/prompt-library.json"));
const characterPresets = new CharacterPresetStore(path.join(root, "data/character-presets.json"));
const trainingJobsRoot = path.join(root, "data/training-jobs");
const trainingPaths = getTrainingPaths(root);
let activeTrainingProcess: ChildProcess | undefined;
const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json({ limit: "128kb" }));
const clients = new Set<import("ws").WebSocket>();
const recentErrors: string[] = [];
const defaultSettings = {
  comfyUrl: process.env.COMFYUI_URL || "http://127.0.0.1:8188",
  outputDirectory: path.join(root, "ComfyUI", "output"),
  diffusionModel: "zImageTurbo_turbo.safetensors",
  textEncoder: "qwen3_4b.safetensors",
  vae: "flux1AE_v10.safetensors",
  pruneRawDatasetOutputs: false,
  generationDefaults: {
    width: 1024, height: 1024, steps: 8, guidance: 1, batchSize: 1,
    outputFormat: "png" as const, sampler: "res_multistep" as const, scheduler: "simple" as const
  }
};
const generationDefaultsSchema = z.object({
  width: z.number().int().min(256).max(2048),
  height: z.number().int().min(256).max(2048),
  steps: z.number().int().min(1).max(60),
  guidance: z.number().min(0).max(10),
  batchSize: z.number().int().min(1).max(4),
  outputFormat: z.enum(["png", "webp"]),
  sampler: z.enum(["res_multistep", "euler", "euler_ancestral", "dpmpp_2m", "dpmpp_sde"]),
  scheduler: z.enum(["simple", "karras", "sgm_uniform"])
});
const settingsSchema = z.object({
  comfyUrl: z.string().url(),
  outputDirectory: z.string().min(1).max(1000),
  diffusionModel: z.string().min(1).max(300),
  textEncoder: z.string().min(1).max(300),
  vae: z.string().min(1).max(300),
  pruneRawDatasetOutputs: z.boolean().default(false),
  generationDefaults: generationDefaultsSchema
});
let settings = settingsSchema.parse({
  ...defaultSettings,
  ...(fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")) : {})
});
type RecordItem = Record<string, unknown>;
let records: RecordItem[] = fs.existsSync(recordsFile) ? JSON.parse(fs.readFileSync(recordsFile, "utf8")) : [];
let trainingRecords: any[] = fs.existsSync(trainingRecordsFile) ? JSON.parse(fs.readFileSync(trainingRecordsFile, "utf8")) : [];
let datasetRecords: any[] = fs.existsSync(datasetRecordsFile) ? JSON.parse(fs.readFileSync(datasetRecordsFile, "utf8")) : [];
const modelCatalog: any[] = fs.existsSync(modelCatalogFile) ? JSON.parse(fs.readFileSync(modelCatalogFile, "utf8")) : [];
const persist = () => writeJsonAtomic(recordsFile, records);
const persistTraining = () => writeJsonAtomic(trainingRecordsFile, trainingRecords);
const persistDatasets = () => writeJsonAtomic(datasetRecordsFile, datasetRecords);
const activeDatasetMonitors = new Set<string>();
const activeGenerationMonitors = new Map<string, NodeJS.Timeout>();
const comfy = () => new ComfyClient(settings.comfyUrl);
const simplify = (e: unknown) => e instanceof Error ? e.message : String(e);
const required = ["UNETLoader","CLIPLoader","VAELoader","CLIPTextEncode","ConditioningZeroOut","EmptySD3LatentImage","ModelSamplingAuraFlow","LoraLoaderModelOnly","KSampler","VAEDecode","VAEDecodeTiled","ImageScale","SaveImage","SaveAnimatedWEBP"];
const krea2 = {
  textEncoder: "qwen3vl_4b_fp8_scaled.safetensors",
  vae: "qwen_image_vae.safetensors"
};
const anima = {
  textEncoder: ANIMA_FILES.textEncoder,
  vae: ANIMA_FILES.vae
};
fs.mkdirSync(uploadRoot, { recursive: true });
fs.mkdirSync(trainingInputRoot, { recursive: true });
fs.mkdirSync(trainingStagingRoot, { recursive: true });
fs.mkdirSync(trainingJobsRoot, { recursive: true });
fs.mkdirSync(datasetsRoot, { recursive: true });
const libraryStagingRoot = path.join(root, "data/library-upload-staging");
fs.mkdirSync(libraryStagingRoot, { recursive: true });
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const videoExtensions = new Set([".mp4", ".mov", ".webm", ".mkv"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename: (_request, file, done) => done(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 512 * 1024 * 1024, files: 4 },
  fileFilter: (_request, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const expected = ["reference", "referenceMask", "master"].includes(file.fieldname) ? imageExtensions : videoExtensions;
    if (!expected.has(extension)) return done(new Error(`Unsupported ${file.fieldname} file type.`));
    done(null, true);
  }
});
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename: (_request, file, done) => done(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 64 * 1024 * 1024, files: 4 },
  fileFilter: (_request, file, done) => {
    if (!imageExtensions.has(path.extname(file.originalname).toLowerCase())) return done(new Error("Reference images must be PNG, JPEG, or WebP."));
    done(null, true);
  }
});
const trainingUpload = multer({
  storage: multer.diskStorage({
    destination: trainingStagingRoot,
    filename: (_request, file, done) => done(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 100 },
  fileFilter: (_request, file, done) => {
    if (!imageExtensions.has(path.extname(file.originalname).toLowerCase())) return done(new Error("Training pictures must be PNG, JPEG, or WebP."));
    done(null, true);
  }
});
const libraryUpload = multer({
  storage: multer.diskStorage({
    destination: libraryStagingRoot,
    filename: (_request, file, done) =>
      done(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || ".bin"}`)
  }),
  limits: { fileSize: LIBRARY_MAX_FILE_BYTES, files: 8 },
  fileFilter: (_request, file, done) => {
    try {
      const name = sanitizeLibraryFilename(file.originalname);
      assertLibraryExtension(name);
      done(null, true);
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  }
});

app.get("/api/settings", (_q, r) => r.json(settings));
app.get("/api/prompt-library", (q, r) => {
  try {
    const entries = promptLibrary.list({
      architecture: typeof q.query.architecture === "string" ? q.query.architecture : undefined,
      category: typeof q.query.category === "string" ? q.query.category : undefined,
      complexity: typeof q.query.complexity === "string" ? q.query.complexity : undefined,
      style: typeof q.query.style === "string" ? q.query.style : undefined,
      keyword: typeof q.query.keyword === "string" ? q.query.keyword : undefined
    });
    r.json({ entries, negativePresets: promptLibrary.negatives() });
  } catch (error) { r.status(400).json({ error: simplify(error) }); }
});
app.post("/api/prompt/generate", (q, r) => {
  try {
    r.json(generatePrompt(q.body, promptLibrary, loraRegistry.list()));
  } catch (error) { r.status(400).json({ error: simplify(error) }); }
});
app.post("/api/prompt/resolve-loras", (q, r) => {
  try {
    const generated = generatePrompt({ ...q.body, confirmedLoras:[] }, promptLibrary, loraRegistry.list());
    r.json(generated.proposedLoras);
  } catch (error) { r.status(400).json({ error: simplify(error) }); }
});
app.post("/api/prompt/validate", (q, r) => {
  try {
    r.json(validatePromptRequest(q.body, loraRegistry.list()));
  } catch (error) { r.status(400).json({ error: simplify(error) }); }
});
app.get("/api/character-presets", (_q,r)=>r.json(characterPresets.list()));
app.post("/api/character-presets/images",photoUpload.array("images",4),(q,r)=>{
  const files=(q.files as Express.Multer.File[]|undefined)||[];
  if(!files.length)return r.status(400).json({error:"Choose at least one PNG, JPEG, or WebP image."});
  r.status(201).json(files.map(file=>({
    path:path.posix.join("z-image-studio",file.filename),
    name:file.originalname
  })));
});
app.post("/api/character-presets",(q,r)=>{try{r.status(201).json(characterPresets.create(q.body))}catch(error){r.status(400).json({error:simplify(error)})}});
app.put("/api/character-presets/:id",(q,r)=>{try{const item=characterPresets.update(q.params.id,q.body);item?r.json(item):r.status(404).json({error:"Character preset not found."})}catch(error){r.status(400).json({error:simplify(error)})}});
app.delete("/api/character-presets/:id",(q,r)=>characterPresets.remove(q.params.id)?r.status(204).end():r.status(404).json({error:"Character preset not found."}));
app.get("/api/character-presets/:id/generation",(q,r)=>{const item=characterPresets.get(q.params.id);item?r.json(presetGenerationInput(item)):r.status(404).json({error:"Character preset not found."})});
app.get("/api/character-presets/:id/promote",(q,r)=>{const item=characterPresets.get(q.params.id);item?r.json(presetDatasetHandoff(item)):r.status(404).json({error:"Character preset not found."})});
app.put("/api/settings", (q, r) => {
  try {
    const next = settingsSchema.parse({ ...settings, ...q.body });
    const u = new URL(next.comfyUrl);
    if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname)) return r.status(400).json({ error: "Only a local ComfyUI address is allowed." });
    settings = next;
    writeJsonAtomic(settingsFile, settings);
    r.json(settings);
  } catch (error: any) {
    r.status(400).json({ error: error?.issues?.[0]?.message || simplify(error) });
  }
});
app.put("/api/settings/defaults", (q, r) => {
  try {
    settings.generationDefaults = generationDefaultsSchema.parse(q.body);
    writeJsonAtomic(settingsFile, settings);
    r.json(settings.generationDefaults);
  } catch (error: any) {
    r.status(400).json({ error: error?.issues?.[0]?.message || simplify(error) });
  }
});
app.get("/api/diagnostics", async (_q, r) => {
  try {
    const [info, stats] = await Promise.all([comfy().objectInfo(), comfy().stats()]);
    const missingNodes = required.filter(n => !(n in info));
    const choices = (n: string, k: string) => info[n]?.input?.required?.[k]?.[0] || [];
    const models = {
      diffusion: choices("UNETLoader", "unet_name").includes(settings.diffusionModel),
      textEncoder: choices("CLIPLoader", "clip_name").includes(settings.textEncoder),
      vae: choices("VAELoader", "vae_name").includes(settings.vae)
    };
    const capabilities = detectReferenceCapabilities(info);
    const manifest = buildModelManifest(info, root);
    const upscalers = detectUpscaleCatalog(info);
    r.json({ connected: true, missingNodes, models, stats, capabilities, manifest, upscalers, workflowReady: !missingNodes.length && Object.values(models).every(Boolean), recentErrors, backendVersion: "0.2.0" });
  } catch (e) { const error = simplify(e); recentErrors.unshift(error); r.status(503).json({ connected: false, error: "ComfyUI is not reachable. Start it and verify the local address.", detail: error, recentErrors }); }
});
app.get("/api/jobs", async (_q, r) => { try { r.json(await comfy().queue()); } catch (e) { r.status(503).json({ error: simplify(e) }); } });
async function discoverLoras(architecture?: string) {
  const info: any = await comfy().objectInfo();
  const names = info.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [];
  const records = loraRegistry.list(names);
  return records
    .filter(item => !architecture || (item.architecture === architecture && item.verified))
    .map(item => {
      const resource = findLibraryResource(root, "lora", item.filename);
      return {
        name: item.filename,
        ...item,
        modifiedAt: resource ? new Date(resource.mtimeMs).toISOString() : undefined,
        sizeBytes: resource?.size
      };
    });
}
async function discoverModels() {
  const info: any = await comfy().objectInfo();
  const splitNames: string[] = info.UNETLoader?.input?.required?.unet_name?.[0] || [];
  const checkpointNames: string[] = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
  const names = [
    ...splitNames,
    ...checkpointNames.filter(name => modelArchitecture(name) === "illustrious")
  ];
  return [...new Set(names)]
    .filter(name =>
      /\.safetensors$/i.test(name)
      && !/[\\/]/.test(name)
      && name !== settings.textEncoder
      && name !== settings.vae
      && name !== krea2.textEncoder
      && name !== krea2.vae
      && name !== anima.textEncoder
      && name !== anima.vae
    )
    .map(name => {
      // Prefer exact filename match so diffusion catalog rows (e.g. Anima) enrich the picker.
      const catalog = modelCatalog.find(item => item.filename === name)
        || modelCatalog.find(item => item.type === "checkpoint" && item.filename === name);
      const architecture = adapterForModel(name)?.architecture || catalog?.architecture || "unknown";
      const resource = findLibraryResource(root, "model", name);
      return {
        name,
        ...catalog,
        architecture,
        modifiedAt: resource ? new Date(resource.mtimeMs).toISOString() : undefined,
        sizeBytes: resource?.size
      };
    })
    .sort((a, b) => Number(b.architecture !== "unknown") - Number(a.architecture !== "unknown") || a.name.localeCompare(b.name));
}
app.get("/api/loras", async (_q, r) => {
  try {
    const architecture = typeof _q.query.architecture === "string" ? _q.query.architecture : undefined;
    r.json(await discoverLoras(architecture));
  } catch (e) { r.status(503).json({ error: simplify(e) }); }
});
app.put("/api/loras/registry/:filename", (q, r) => {
  const architecture = String(q.body.architecture || "unknown");
  if (!["z-image", "krea2", "illustrious", "anima", "pony", "unknown"].includes(architecture)) return r.status(400).json({ error: "Invalid LoRA architecture." });
  const record: LoraRecord = {
    filename: q.params.filename,
    displayName: q.body.displayName,
    architecture: architecture as LoraRecord["architecture"],
    category: ["character", "body", "style", "realism", "action", "concept", "utility", "other"].includes(q.body.category)
      ? q.body.category : undefined,
    tags: Array.isArray(q.body.tags) ? q.body.tags.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 20) : [],
    aestheticTags: Array.isArray(q.body.aestheticTags) ? q.body.aestheticTags.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 20) : [],
    incompatibleWith: Array.isArray(q.body.incompatibleWith) ? q.body.incompatibleWith.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 20) : [],
    conflictingActivations: Array.isArray(q.body.conflictingActivations) ? q.body.conflictingActivations.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 20) : [],
    incompatibleAesthetics: Array.isArray(q.body.incompatibleAesthetics) ? q.body.incompatibleAesthetics.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 20) : [],
    exclusiveGroup: typeof q.body.exclusiveGroup === "string" ? q.body.exclusiveGroup.trim().slice(0,80) || undefined : undefined,
    activationWords: Array.isArray(q.body.activationWords) ? q.body.activationWords.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 20) : [],
    usageGuide: q.body.usageGuide,
    promptTemplate: q.body.promptTemplate,
    sourceUrl: q.body.sourceUrl,
    sourceModelId: Number.isFinite(Number(q.body.sourceModelId)) ? Number(q.body.sourceModelId) : undefined,
    sourceVersionId: Number.isFinite(Number(q.body.sourceVersionId)) ? Number(q.body.sourceVersionId) : undefined,
    sha256: q.body.sha256,
    licenseNotes: q.body.licenseNotes,
    baseTrainingModel: q.body.baseTrainingModel,
    trainer: q.body.trainer,
    triggerToken: q.body.triggerToken,
    datasetId: q.body.datasetId,
    datasetVersion: q.body.datasetVersion,
    trainingResolution: q.body.trainingResolution,
    rank: Number.isFinite(Number(q.body.rank)) ? Number(q.body.rank) : undefined,
    alpha: Number.isFinite(Number(q.body.alpha)) ? Number(q.body.alpha) : undefined,
    steps: Number.isFinite(Number(q.body.steps)) ? Number(q.body.steps) : undefined,
    epochs: Number.isFinite(Number(q.body.epochs)) ? Number(q.body.epochs) : undefined,
    learningRate: Number.isFinite(Number(q.body.learningRate)) ? Number(q.body.learningRate) : undefined,
    textEncoderLearningRate: Number.isFinite(Number(q.body.textEncoderLearningRate)) ? Number(q.body.textEncoderLearningRate) : undefined,
    createdAt: q.body.createdAt,
    recommendedStrength: Number.isFinite(Number(q.body.recommendedStrength)) ? Number(q.body.recommendedStrength) : undefined,
    verifiedAdapters: Array.isArray(q.body.verifiedAdapters)
      ? q.body.verifiedAdapters.filter((item: string) => ["z-image", "krea2", "illustrious", "anima", "pony"].includes(item))
      : [],
    verified: q.body.verified === true,
    notes: q.body.notes
  };
  r.json(loraRegistry.upsert(record));
});
app.get("/api/model-adapters", (_q, r) => r.json(Object.values(modelAdapters)));
app.get("/api/characters", (_q, r) => r.json(characterProfiles.list()));
app.post("/api/characters", (q, r) => {
  try { r.status(201).json(characterProfiles.create(q.body)); }
  catch (e: any) { r.status(400).json({ error: e?.issues?.[0]?.message || simplify(e) }); }
});
app.put("/api/characters/:id", (q, r) => {
  try {
    const profile = characterProfiles.update(q.params.id, q.body);
    if (!profile) return r.status(404).json({ error: "Character profile not found." });
    r.json(profile);
  } catch (e: any) { r.status(400).json({ error: e?.issues?.[0]?.message || simplify(e) }); }
});
app.delete("/api/characters/:id", (q, r) => characterProfiles.remove(q.params.id)
  ? r.status(204).end()
  : r.status(404).json({ error: "Character profile not found." }));
app.get("/api/models", async (_q, r) => {
  try {
    r.json(await discoverModels());
  } catch (e) { r.status(503).json({ error: simplify(e) }); }
});
/** Additive library install: drop .safetensors into lora/ | root | checkpoints/, never overwrite. */
app.post("/api/library/upload", (q, r) => {
  libraryUpload.array("files", 8)(q, r, async (multerError) => {
    const staged = ((q.files as Express.Multer.File[] | undefined) || []);
    const cleanupStaged = () => {
      for (const file of staged) if (file?.path && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch {}
      }
    };
    if (multerError) {
      cleanupStaged();
      const message = simplify(multerError);
      const status = /limit|large|File too large/i.test(message) ? 400 : 400;
      return r.status(status).json({ error: message });
    }
    try {
      const kindRaw = q.body?.kind;
      if (!staged.length) return r.status(400).json({ error: "Choose at least one .safetensors file." });
      const uploaded: Array<{ filename: string; kind: LibraryKind; bytes: number }> = [];
      for (const file of staged) {
        const freeBytes = getDiskFreeBytes(libraryStagingRoot);
        const target = validateLibraryUpload({
          projectRoot: root,
          kind: kindRaw,
          originalName: file.originalname,
          size: file.size,
          freeBytes
        });
        installLibraryFile(file.path, target.finalPath);
        if (target.kind === "lora") {
          // Seed unverified only — user confirms architecture/activations in LoraRegistryManager.
          const existing = loraRegistry.list().find(item => item.filename.toLowerCase() === target.filename.toLowerCase());
          if (!existing) {
            loraRegistry.upsert({
              filename: target.filename,
              architecture: modelArchitecture(target.filename),
              verified: false,
              activationWords: [],
              createdAt: new Date().toISOString(),
              notes: "Uploaded via Studio library drop. Classify and verify before generation use."
            });
          }
        }
        uploaded.push({ filename: target.filename, kind: target.kind, bytes: file.size, ...classifyLibraryModel(target.filename) });
      }
      const kind = uploaded[0]?.kind;
      let models: Awaited<ReturnType<typeof discoverModels>> | undefined;
      let loras: Awaited<ReturnType<typeof discoverLoras>> | undefined;
      let discoveryError: string | undefined;
      try {
        if (kind === "lora") loras = await discoverLoras();
        else if (kind === "diffusion" || kind === "checkpoint") models = await discoverModels();
      } catch (error) {
        discoveryError = simplify(error);
      }
      r.status(201).json({
        uploaded,
        models,
        loras,
        discoveryError,
        notice: discoveryError
          ? "File saved. ComfyUI discovery is offline — use Refresh after the engine is ready."
          : undefined
      });
    } catch (error) {
      cleanupStaged();
      if (error instanceof LibraryUploadError) {
        return r.status(error.status).json({ error: error.message, code: error.code });
      }
      r.status(400).json({ error: simplify(error) });
    }
  });
});
app.get("/api/training", async (_q, r) => {
  const active = trainingRecords.find(record => ["pending", "active"].includes(record.status));
  if (!active) return r.json(trainingRecords);
  const telemetry = await trainingTelemetry(active);
  r.json(trainingRecords.map(record => record.id === active.id ? { ...record, telemetry } : record));
});
app.get("/api/training/:id/log", (q, r) => {
  const record = trainingRecords.find(item => item.id === q.params.id);
  if (!record) return r.status(404).json({ error: "Training job not found." });
  const jobDirectory = path.resolve(String(record.jobDirectory || ""));
  if (!record.jobDirectory || (jobDirectory !== trainingJobsRoot && !jobDirectory.startsWith(`${trainingJobsRoot}${path.sep}`))) {
    return r.status(400).json({ error: "Training log path is invalid." });
  }
  const logFile = path.join(jobDirectory, "training.log");
  if (!fs.existsSync(logFile)) return r.json({ text: "", available: false });
  try {
    const size = fs.statSync(logFile).size;
    const length = Math.min(size, 32 * 1024);
    const buffer = Buffer.alloc(length);
    const handle = fs.openSync(logFile, "r");
    try { fs.readSync(handle, buffer, 0, length, Math.max(0, size - length)); }
    finally { fs.closeSync(handle); }
    r.json({ text: buffer.toString("utf8"), available: true, truncated: size > length });
  } catch (e) { r.status(500).json({ error: simplify(e) }); }
});
app.get("/api/training/diagnostics", async (_q, r) => {
  try {
    const info: any = await comfy().objectInfo();
    const zImageMissing = missingTrainingFiles(trainingPaths, "z-image");
    const kreaMissing = missingTrainingFiles(trainingPaths, "krea2");
    const models: string[] = info.UNETLoader?.input?.required?.unet_name?.[0] || [];
    const baseModels = models.filter(name =>
      /\.safetensors$/i.test(name) && !/[\\/]/.test(name)
      && name !== settings.textEncoder && name !== settings.vae
      && name !== krea2.textEncoder && name !== krea2.vae
    );
    r.json({
      ready: !zImageMissing.length,
      engine: "Musubi Tuner · architecture-aware",
      missingFiles: zImageMissing.map(file => path.relative(root, file)),
      models: baseModels.map(name => {
        const architecture = modelArchitecture(name);
        const missing = architecture === "krea2" ? kreaMissing : zImageMissing;
        return {
          name, architecture, trainable: architecture !== "unknown" && !missing.length,
          trainingBase: architecture === "krea2" ? "Krea 2 Raw" : "Z-Image Base",
          setupMessage: missing.length ? (architecture === "krea2"
            ? "Krea 2 Raw must be downloaded after accepting its community license."
            : `Missing: ${missing.map(file => path.basename(file)).join(", ")}`) : ""
        };
      })
        .filter(model => model.architecture !== "unknown"),
      recommendations: {
        subjectPictures: "3 minimum; 12–30 varied pictures recommended",
        stylePictures: "30–100 pictures recommended",
        batchSize: 1,
        effectiveBatch: 4,
        resolution: "512 is safest on this 12 GB GPU; 768 uses the same low-memory pipeline but is slower",
        trainingModel: "Z-Image Base (finished LoRAs can be applied to compatible Z-Image models)"
      }
    });
  } catch (e) { r.status(503).json({ ready: false, error: simplify(e) }); }
});
app.post("/api/training/preview", (q, r) => {
  try {
    const config = trainingSchema.parse(q.body?.config);
    r.json(trainingPreview(trainingPaths, config, q.body?.imageCount, resolveInside(trainingJobsRoot, "PREVIEW")));
  } catch (e: any) { r.status(400).json({ error: e?.issues?.[0]?.message || simplify(e) }); }
});
app.post("/api/training", trainingUpload.array("images", 100), async (q, r) => {
  const files = (q.files as Express.Multer.File[] | undefined) || [];
  let datasetDirectory = "";
  try {
    if (trainingRecords.some(record => ["pending", "active"].includes(record.status))) throw new Error("Only one LoRA training job can run at a time.");
    if (records.some(record => ["pending", "active"].includes(String(record.status)))) throw new Error("Wait for image and video generation to finish before training a LoRA.");
    if (files.length < 3) throw new Error("Add at least 3 training pictures. For better subject LoRAs, use 12–30 varied pictures.");
    const config = trainingSchema.parse(JSON.parse(String(q.body.config || "{}")));
    const captions = JSON.parse(String(q.body.captions || "[]"));
    if (!Array.isArray(captions) || captions.length !== files.length) throw new Error("Each training picture needs a matching caption.");
    const profile = trainingProfile(config.model);
    for (const file of files) await validateUploadedMedia(file);

    const info: any = await comfy().objectInfo();
    const missingFiles = missingTrainingFiles(trainingPaths, profile.architecture);
    if (missingFiles.length) throw new Error(`The local LoRA engine is incomplete: ${missingFiles.map(file => path.relative(root, file)).join(", ")}`);
    if (profile.architecture === "illustrious") {
      // Illustrious/SDXL checkpoints load via CheckpointLoaderSimple, not UNETLoader.
      const ckpts: string[] = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
      if (!ckpts.includes(config.model)) throw new Error(`Training checkpoint is not available: ${config.model}`);
    } else {
      const models: string[] = info.UNETLoader?.input?.required?.unet_name?.[0] || [];
      if (!models.includes(config.model)) throw new Error(`Training model is not available: ${config.model}`);
    }
    const id = crypto.randomUUID();
    const slug = config.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const installedPath = resolveInside(path.join(root, "lora"), `${slug}.safetensors`);
    if (fs.existsSync(installedPath)) throw new Error(`A LoRA named ${slug}.safetensors already exists. Choose a different name.`);
    datasetDirectory = resolveInside(trainingInputRoot, id);
    fs.mkdirSync(datasetDirectory, { recursive: true });
    files.forEach((file, index) => {
      const basename = String(index + 1).padStart(3, "0");
      const imageTarget = resolveInside(datasetDirectory, `${basename}${path.extname(file.filename).toLowerCase()}`);
      fs.renameSync(file.path, imageTarget);
      fs.writeFileSync(resolveInside(datasetDirectory, `${basename}.txt`), String(captions[index] || config.trigger).trim().slice(0, 2000), "utf8");
    });
    const datasetFolder = `lora-training/${id}`;
    const jobDirectory = resolveInside(trainingJobsRoot, id);
    fs.mkdirSync(jobDirectory, { recursive: true });
    const datasetConfig = profile.architecture === "illustrious"
      ? writeSdScriptsDatasetConfig(jobDirectory, datasetDirectory, config.resolution, config.repeats)
      : writeDatasetConfig(jobDirectory, datasetDirectory, config.resolution, config.repeats);
    const record = {
      id, promptId: "", status: "pending", progress: 0, phase: "Waiting to start",
      createdAt: new Date().toISOString(), started: Date.now(), imageCount: files.length,
      datasetFolder, jobDirectory, installedName: `${slug}.safetensors`,
      trainingBase: profile.architecture === "krea2" ? "Krea 2 Raw" : profile.architecture === "illustrious" ? "SDXL checkpoint" : "Z-Image Base BF16", ...config
    };
    trainingRecords.unshift(record); persistTraining();
    void runMusubiTraining(record, config, datasetConfig, slug, installedPath);
    r.status(202).json(record);
  } catch (e: any) {
    for (const file of files) if (fs.existsSync(file.path)) try { fs.unlinkSync(file.path); } catch {}
    const error = e?.issues?.[0]?.message || simplify(e);
    recentErrors.unshift(error);
    r.status(400).json({ error });
  }
});
app.post("/api/training/:id/cancel", (q, r) => {
  const record = trainingRecords.find(item => item.id === q.params.id);
  if (!record || !["pending", "active"].includes(record.status)) return r.status(404).json({ error: "No active training job was found." });
  record.status = "cancelled"; record.error = "Cancelled by user."; persistTraining();
  if (activeTrainingProcess?.pid) {
    execFile("taskkill", ["/PID", String(activeTrainingProcess.pid), "/T", "/F"], () => {});
  }
  r.json(record);
});
app.get("/api/video/diagnostics", async (_q, r) => {
  try {
    const [info, stats] = await Promise.all([comfy().objectInfo(), comfy().stats()]);
    const choices = (node: string, key: string): string[] => info[node]?.input?.required?.[key]?.[0] || info[node]?.input?.required?.[key]?.[1]?.options || [];
    const missingNodes = SCAIL_NODES.filter(node => !(node in info));
    const files = {
      model: choices("UNETLoader", "unet_name").includes(SCAIL_FILES.model),
      textEncoder: choices("CLIPLoader", "clip_name").includes(SCAIL_FILES.textEncoder),
      vae: choices("VAELoader", "vae_name").includes(SCAIL_FILES.vae),
      clipVision: choices("CLIPVisionLoader", "clip_name").includes(SCAIL_FILES.clipVision),
      sam3: choices("CheckpointLoaderSimple", "ckpt_name").includes(SCAIL_FILES.sam3)
    };
    let ffmpeg = false;
    try { await execFileAsync("ffmpeg", ["-version"], { timeout: 5_000 }); ffmpeg = true; } catch {}
    let writable = true;
    try { fs.accessSync(uploadRoot, fs.constants.W_OK); fs.accessSync(settings.outputDirectory, fs.constants.W_OK); } catch { writable = false; }
    const gpu = (stats.devices || []).some((device: any) => /cuda/i.test(`${device.type} ${device.name}`));
    r.json({
      ready: !missingNodes.length && Object.values(files).every(Boolean) && ffmpeg && writable && gpu,
      connected: true, version: stats.system?.comfyui_version, missingNodes, files, ffmpeg, ffprobe: ffmpeg,
      writable, gpu, uploadDirectory: "ComfyUI/input/z-image-studio", outputDirectory: "ComfyUI/output/video",
      automaticPreprocessing: !missingNodes.includes("SAM3_VideoTrack") && files.sam3,
      diskFreeBytes: getDiskFreeBytes(root)
    });
  } catch (e) { r.status(503).json({ ready: false, connected: false, error: simplify(e) }); }
});
app.get("/api/datasets", (_q, r) => r.json(datasetRecords));
/** Prompt lists must register before /api/datasets/:id or "prompt-lists" is captured as an id. */
app.get("/api/datasets/prompt-lists", (_q, r) => {
  try {
    r.json(listPromptLists(root));
  } catch (error) {
    r.status(500).json({ error: simplify(error) });
  }
});
app.get("/api/datasets/prompt-lists/:id", (q, r) => {
  try {
    r.json(loadPromptList(root, String(q.params.id || DEFAULT_PROMPT_LIST_ID)));
  } catch (error) {
    r.status(404).json({ error: simplify(error) });
  }
});
app.put("/api/datasets/prompt-lists/:id", (q, r) => {
  try {
    const id = String(q.params.id || DEFAULT_PROMPT_LIST_ID);
    let prompts: string[] = [];
    if (Array.isArray(q.body?.prompts)) {
      prompts = q.body.prompts.map((item: unknown) => String(item || "").trim()).filter(Boolean);
    } else if (typeof q.body?.promptsText === "string") {
      const text = q.body.promptsText.replace(/\r\n/g, "\n").trim();
      prompts = text.includes("\n\n")
        ? text.split(/\n\s*\n/).map((block: string) => block.replace(/\n/g, " ").trim()).filter(Boolean)
        : text.split("\n").map((line: string) => line.trim()).filter(Boolean);
    } else {
      throw new Error("Provide prompts: string[] or promptsText: string.");
    }
    if (prompts.length < 1) throw new Error("Prompt list must contain at least one prompt.");
    if (prompts.length > 200) throw new Error("Prompt list is limited to 200 entries.");
    const saved = replacePromptListPrompts(root, id, prompts, {
      name: q.body?.name ? String(q.body.name) : undefined,
      description: q.body?.description ? String(q.body.description) : undefined
    });
    r.json(saved);
  } catch (error: any) {
    r.status(400).json({ error: error?.issues?.[0]?.message || simplify(error) });
  }
});
app.post("/api/datasets/prompt-lists", (q, r) => {
  try {
    const saved = savePromptList(root, q.body);
    r.status(201).json(saved);
  } catch (error: any) {
    r.status(400).json({ error: error?.issues?.[0]?.message || simplify(error) });
  }
});
app.get("/api/datasets/:id", (q, r) => {
  const record = datasetRecords.find(item => item.id === q.params.id);
  if (!record) return r.status(404).json({ error: "Dataset not found." });
  r.json(record);
});
app.delete("/api/datasets/:id", (q, r) => {
  try {
    const index = datasetRecords.findIndex(item => item.id === q.params.id);
    if (index < 0) return r.status(404).json({ error: "Dataset not found." });
    const record = datasetRecords[index];
    if (["pending", "active", "paused"].includes(record.status)) throw new Error("Wait for dataset generation to finish before deleting it.");
    const target = resolveInside(datasetsRoot, String(record.id));
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    datasetRecords.splice(index, 1);
    persistDatasets();
    r.status(204).end();
  } catch (error) {
    r.status(400).json({ error: simplify(error) });
  }
});
app.get("/api/datasets/:id/images/:name", (q, r) => {
  const record = datasetRecords.find(item => item.id === q.params.id);
  if (!record || !record.images?.includes(q.params.name)) return r.status(404).json({ error: "Dataset image not found." });
  r.sendFile(safeOutputPath(resolveInside(datasetsRoot, String(record.id), "images"), q.params.name));
});
app.delete("/api/datasets/:id/images/:name", (q, r) => {
  try {
    const record = datasetRecords.find(item => item.id === q.params.id);
    if (!record) return r.status(404).json({ error: "Dataset not found." });
    if (record.status !== "completed") throw new Error("Wait for dataset generation to finish before deleting images.");
    const imageIndex = record.images?.indexOf(q.params.name) ?? -1;
    if (imageIndex < 0) return r.status(404).json({ error: "Dataset image not found." });
    const directory = resolveInside(datasetsRoot, String(record.id));
    const review = loadReview(directory, record);
    removeReviewItem(review, q.params.name);
    const imagePath = safeOutputPath(path.join(directory, "images"), q.params.name);
    const captionPath = safeOutputPath(path.join(directory, "images"), `${path.parse(q.params.name).name}.txt`);
    if (fs.existsSync(imagePath)) fs.rmSync(imagePath, { force: true });
    if (fs.existsSync(captionPath)) fs.rmSync(captionPath, { force: true });
    record.images.splice(imageIndex, 1);
    if (record.captionByImage) delete record.captionByImage[q.params.name];
    persistDatasets();
    saveReview(directory, review);
    r.json({ record, review });
  } catch (error) {
    r.status(400).json({ error: simplify(error) });
  }
});
app.get("/api/datasets/:id/review", (q, r) => {
  const record = datasetRecords.find(item => item.id === q.params.id);
  if (!record) return r.status(404).json({ error: "Dataset not found." });
  r.json(loadReview(resolveInside(datasetsRoot, String(record.id)), record));
});
/**
 * Hard-but-safe dataset stop: cancel remaining Comfy queue items, interrupt the running graph,
 * keep any images already copied into the dataset folder, and free the single-dataset lock.
 */
app.post("/api/datasets/:id/stop", async (q, r) => {
  try {
    const record = datasetRecords.find(item => item.id === q.params.id);
    if (!record) return r.status(404).json({ error: "Dataset not found." });
    if (!["pending", "active", "paused"].includes(String(record.status))) {
      return r.status(400).json({ error: "Only a pending, active, or paused dataset run can be stopped." });
    }
    record._stopRequested = true;
    record.phase = "Stopping dataset run…";
    persistDatasets();
    broadcast({ type: "dataset", record });

    const cancelledJobs = await cancelDatasetComfyJobs(record);
    stopDatasetMonitor(record.id);
    finalizeDatasetRecord(record, { stopped: true });
    delete record._stopRequested;
    persistDatasets();
    broadcast({ type: "dataset", record });
    r.json({
      record,
      cancelledJobs,
      keptImages: record.images?.length || 0,
      message: record.images?.length
        ? `Stopped. Kept ${record.images.length} completed image(s); cancelled ${cancelledJobs} remaining job(s).`
        : `Stopped before any images finished. Cancelled ${cancelledJobs} job(s).`
    });
  } catch (error) {
    r.status(400).json({ error: simplify(error) });
  }
});
app.post("/api/datasets/:id/resume", (q, r) => {
  try {
    const record = datasetRecords.find(item => item.id === q.params.id);
    if (!record) return r.status(404).json({ error: "Dataset not found." });
    const completed = new Set(record.completedPromptIds || []);
    const failed = new Set(record.failedPromptIds || []);
    const remaining = (record.promptIds || []).filter((id: string) => !completed.has(id) && !failed.has(id));
    if (!remaining.length) throw new Error("This dataset has no interrupted images left to recover.");
    record.status = "pending";
    record.phase = `Recovering ${remaining.length} interrupted image${remaining.length === 1 ? "" : "s"}`;
    record.error = undefined;
    record.warning = undefined;
    persistDatasets();
    monitorDataset(record);
    r.status(202).json(record);
  } catch (error) {
    r.status(400).json({ error: simplify(error) });
  }
});
app.post("/api/datasets/:id/extend", async (q, r) => {
  try {
    if (datasetRecords.some(item => ["pending", "active", "paused"].includes(item.status))) {
      throw new Error("Only one dataset can be built at a time.");
    }
    const record = datasetRecords.find(item => item.id === q.params.id);
    if (!record) throw new Error("Dataset not found.");
    if (record.status !== "completed") throw new Error("Wait for this dataset to finish before generating more images.");
    const extension = datasetExtensionSchema.parse({
      ...q.body,
      count: Number(q.body?.count)
    });
    const currentGenerated = record.promptIds?.length || 0;
    if (currentGenerated + extension.count > 100) {
      throw new Error(`This dataset can generate at most 100 images. Add no more than ${Math.max(0, 100 - currentGenerated)}.`);
    }
    const architecture = modelArchitecture(record.model);
    if (architecture === "unknown") throw new Error("This dataset's model architecture is no longer supported.");
    const profile = architecture === "krea2" ? krea2 : architecture === "illustrious"
      ? { textEncoder: "checkpoint", vae: "checkpoint" }
      : settings;
    const info: any = await comfy().objectInfo();
    const availableModels: string[] = info.UNETLoader?.input?.required?.unet_name?.[0] || [];
    if (!availableModels.includes(record.model)) throw new Error(`Image model is not available: ${record.model}`);
    const characterAdjustments = extension.characterAdjustments || record.characterAdjustments || { hair: "", body: "", other: "" };
    const stackLoras = Array.isArray(record.loras) ? record.loras : [];
    const prompts = datasetPrompts({
      ...record,
      datasetMode: record.datasetMode || "standard",
      count: extension.count,
      seed: Number(record.seed || 42) + currentGenerated,
      variationOffset: currentGenerated,
      characterAdjustments,
      loras: stackLoras
    });
    const clientId = crypto.randomUUID();
    const outputSlug = record.outputSlug || datasetOutputSlug(record.name || record.trigger, record.id);
    record.outputSlug = outputSlug;
    const nextPromptIds: string[] = [];
    const extendNegative = resolveDatasetNegativePrompt(record.datasetMode, record.negativePrompt);
    const registeredLoras = loraRegistry.list();
    // Generation text = promptPlan captions only (list + character). Never master PNG positive prompt.
    const identityStrength = datasetIdentityReferenceStrength(
      architecture,
      record.datasetMode === "instagram-ugc" ? "instagram-ugc" : "standard"
    );
    for (const item of prompts) {
      const globalIndex = currentGenerated + item.index;
      let promptText = item.caption;
      try { promptText = applyLoraActivations(promptText, stackLoras, registeredLoras); } catch { /* keep */ }
      const input = generationSchema.parse({
        prompt: promptText,
        negativePrompt: extendNegative,
        width: record.width, height: record.height, seed: item.seed,
        steps: record.steps || (architecture === "krea2" ? 8 : architecture === "illustrious" ? 28 : 9),
        guidance: record.guidance ?? (architecture === "illustrious" ? 4 : 1),
        batchSize: 1,
        priority: "low", outputFormat: "png",
        sampler: record.sampler || (architecture === "illustrious" ? "dpmpp_sde" : "res_multistep"),
        scheduler: record.scheduler || (architecture === "illustrious" ? "karras" : "simple"),
        outputName: datasetOutputName(outputSlug, globalIndex + 1),
        diffusionModel: record.model, textEncoder: profile.textEncoder, vae: profile.vae,
        loras: stackLoras,
        // Master image = identity lock only (lower strength so shot-list pose/outfit can vary).
        references: [{ image: record.referenceImage, mode: "direct", strength: identityStrength }]
      });
      const graph = architecture === "illustrious"
        ? buildIllustriousWorkflow(input)
        : architecture === "anima"
          ? buildAnimaWorkflow(input)
          : buildWorkflow(workflowTemplate, input);
      const result = await comfy().submit(graph, clientId, "low") as { prompt_id: string };
      nextPromptIds.push(result.prompt_id);
    }
    const globalPrompts = prompts.map(item => ({ ...item, index: currentGenerated + item.index }));
    record.promptIds.push(...nextPromptIds);
    record.captions.push(...prompts.map(item => item.caption));
    record.promptPlan = [...(record.promptPlan || []), ...globalPrompts];
    record.count = record.promptIds.length;
    record.characterAdjustments = characterAdjustments;
    record.status = "pending";
    record.phase = `Queued ${extension.count} more images`;
    record.progress = Math.round((record.completedPromptIds.length / record.promptIds.length) * 100);
    record.started = Date.now();
    record.error = undefined;
    persistDatasets();
    monitorDataset(record);
    r.status(202).json(record);
  } catch (error: any) {
    r.status(400).json({ error: error?.issues?.[0]?.message || simplify(error) });
  }
});
app.post("/api/datasets/:id/images", trainingUpload.array("images", 40), async (q, r) => {
  const files = (q.files as Express.Multer.File[] | undefined) || [];
  const moved: string[] = [];
  let changedRecord: any;
  let originalImageCount = 0;
  let originalCaptionCount = 0;
  try {
    const record = datasetRecords.find(item => item.id === q.params.id);
    if (!record) throw new Error("Dataset not found.");
    if (record.status !== "completed") throw new Error("Wait for dataset generation to finish before adding images.");
    if (!files.length) throw new Error("Choose at least one PNG, JPEG, or WebP image.");
    if ((record.images?.length || 0) + files.length > 100) throw new Error("A dataset can contain at most 100 images.");
    const captions = JSON.parse(String(q.body.captions || "[]"));
    if (!Array.isArray(captions) || (captions.length && captions.length !== files.length)) throw new Error("Added image captions did not match the selected files.");
    const datasetDirectory = resolveInside(datasetsRoot, String(record.id));
    const imageDirectory = resolveInside(datasetDirectory, "images");
    fs.mkdirSync(imageDirectory, { recursive: true });
    changedRecord = record;
    originalImageCount = record.images.length;
    originalCaptionCount = record.captions.length;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      await validateUploadedMedia(file);
      const targetName = `added-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
      const target = safeOutputPath(imageDirectory, targetName);
      fs.renameSync(file.path, target);
      moved.push(target);
      record.images.push(targetName);
      const caption = String(captions[index] || record.trigger || "").trim().slice(0, 2000);
      record.captions.push(caption);
      record.captionByImage ||= {};
      record.captionByImage[targetName] = caption;
    }
    persistDatasets();
    const directory = datasetDirectory;
    const review = loadReview(directory, record);
    saveReview(directory, review);
    r.status(201).json({ record, review });
  } catch (error) {
    for (const file of files) if (fs.existsSync(file.path)) try { fs.unlinkSync(file.path); } catch {}
    for (const target of moved) if (fs.existsSync(target)) try { fs.unlinkSync(target); } catch {}
    if (changedRecord) {
      changedRecord.images.length = originalImageCount;
      changedRecord.captions.length = originalCaptionCount;
    }
    r.status(400).json({ error: simplify(error) });
  }
});
app.put("/api/datasets/:id/review", (q, r) => {
  try {
    const record = datasetRecords.find(item => item.id === q.params.id);
    if (!record) return r.status(404).json({ error: "Dataset not found." });
    const directory = resolveInside(datasetsRoot, String(record.id));
    const review = loadReview(directory, record);
    const updates = Array.isArray(q.body?.updates) ? q.body.updates : [q.body];
    for (const update of updates) updateReviewItem(review, String(update.image || ""), update);
    saveReview(directory, review);
    r.json(review);
  } catch (error: any) { r.status(400).json({ error: error?.issues?.[0]?.message || simplify(error) }); }
});
app.post("/api/datasets/:id/analyze", async (q, r) => {
  try {
    const record = datasetRecords.find(item => item.id === q.params.id);
    if (!record) return r.status(404).json({ error: "Dataset not found." });
    const directory = resolveInside(datasetsRoot, String(record.id));
    const review = await analyzeReview(directory, loadReview(directory, record));
    saveReview(directory, review);
    r.json(review);
  } catch (error) { r.status(400).json({ error: simplify(error) }); }
});
app.post("/api/datasets/:id/export", (q, r) => {
  try {
    const record = datasetRecords.find(item => item.id === q.params.id);
    if (!record) return r.status(404).json({ error: "Dataset not found." });
    const directory = resolveInside(datasetsRoot, String(record.id));
    const review = loadReview(directory, record);
    if (!review.items.some(item => item.state === "keep")) throw new Error("Mark at least one image Keep before exporting.");
    const source = {
      name: record.name, trigger: record.trigger, architecture: record.architecture, model: record.model,
      width: record.width, height: record.height, seed: record.seed, createdAt: record.createdAt,
      promptIds: record.promptIds, promptPlan: record.promptPlan, characterProfileId: record.characterProfileId,
      captionStrategy: record.captionStrategy
    };
    const result = exportReviewedDataset(directory, review, source);
    r.json({ path: result.exportDirectory, summary: result.manifest.summary });
  } catch (error) { r.status(400).json({ error: simplify(error) }); }
});
/** Inspect master PNG / gallery for model + LoRA stack (Dataset Builder preview). Soft-fail safe. */
app.post("/api/datasets/inspect-master", photoUpload.single("master"), async (q, r) => {
  const file = q.file;
  try {
    const bodyPath = String(q.body?.masterReference || q.body?.path || "").trim();
    // Soft validation for inspect: do not require ffprobe (desktop PNGs must still work offline).
    if (file) {
      const ext = path.extname(file.originalname || file.filename).toLowerCase();
      if (!imageExtensions.has(ext)) throw new Error("Master image must be PNG, JPEG, or WebP.");
      if (!fs.existsSync(file.path)) throw new Error("Uploaded master image was not saved.");
    }
    const relative = file ? `z-image-studio/${file.filename}` : bodyPath;
    if (!file && (!relative || path.isAbsolute(relative) || relative.includes(".."))) {
      throw new Error("Provide a master image upload or a Studio input path.");
    }

    let availableModels: string[] = [];
    let availableLoras: string[] = [];
    let comfyOk = true;
    try {
      const info: any = await comfy().objectInfo();
      availableModels = [
        ...(info.UNETLoader?.input?.required?.unet_name?.[0] || []),
        ...(info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [])
      ];
      availableLoras = [
        ...(info.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || []),
        ...(info.LoraLoader?.input?.required?.lora_name?.[0] || [])
      ];
    } catch {
      comfyOk = false;
      // Back-compat offline: still parse PNG/gallery; user can pick model/LoRAs manually.
      availableModels = modelsFromLocalFallback();
      availableLoras = lorasFromLocalFallback();
    }

    let requestedLoras: Array<{ name: string; strength: number }> = [];
    try {
      requestedLoras = typeof q.body?.loras === "string" ? JSON.parse(q.body.loras) : (q.body?.loras || []);
      if (!Array.isArray(requestedLoras)) requestedLoras = [];
    } catch {
      requestedLoras = [];
    }

    const stack = resolveMasterGenerationStack({
      masterDiskPath: file?.path,
      masterRelative: relative,
      originalFilename: file?.originalname,
      requestedModel: String(q.body?.model || ""),
      requestedLoras,
      availableModels,
      availableLoras
    });

    r.json({
      model: stack.model,
      loras: stack.loras,
      detectedLoras: stack.detectedLoras,
      matchedFromMaster: stack.matchedFromMaster,
      sources: stack.sources,
      unmatchedLoras: stack.unmatchedLoras,
      note: stack.note,
      masterReference: relative,
      originalFilename: file?.originalname || path.basename(relative),
      comfyConnected: comfyOk,
      warning: comfyOk
        ? undefined
        : "ComfyUI was not reachable while inspecting. Model/LoRA lists may be incomplete — confirm the picker below before building."
    });
  } catch (error: any) {
    // Soft error payload so the UI can fall back to manual model/LoRA pickers.
    r.status(200).json({
      model: String(q.body?.model || "") || undefined,
      loras: [],
      detectedLoras: [],
      matchedFromMaster: false,
      sources: [],
      unmatchedLoras: [],
      note: "Could not fully inspect this master — pick model and LoRAs manually.",
      error: error?.issues?.[0]?.message || simplify(error),
      softFail: true
    });
  }
});
app.post("/api/datasets", photoUpload.single("master"), async (q, r) => {
  const file = q.file;
  try {
    if (datasetRecords.some(record => ["pending", "active", "paused"].includes(record.status))) throw new Error("Only one dataset can be built at a time.");
    const rawConfig = JSON.parse(String(q.body.config || "{}"));
    // Seed drives per-image Comfy noise (seed+index) and Instagram shuffle order.
    // Randomize when missing/invalid so consecutive builds never silently reuse the old hardcoded 42.
    const rawSeed = Number(rawConfig.seed);
    const randomizeSeed =
      rawConfig.randomizeSeed === true ||
      rawConfig.randomizeSeed === "true" ||
      rawConfig.seed === undefined ||
      rawConfig.seed === null ||
      rawConfig.seed === "" ||
      !Number.isFinite(rawSeed);
    const resolvedSeed = randomizeSeed
      ? crypto.randomInt(0, 2_147_483_647)
      : Math.max(0, Math.floor(rawSeed));
    const config = datasetSchema.parse({
      ...rawConfig, count: Number(rawConfig.count), width: Number(rawConfig.width),
      height: Number(rawConfig.height), seed: resolvedSeed,
      loras: Array.isArray(rawConfig.loras) ? rawConfig.loras : []
    });
    const characterProfile = config.characterProfileId ? characterProfiles.get(config.characterProfileId) : undefined;
    if (config.characterProfileId && !characterProfile) throw new Error("The selected character profile no longer exists.");
    if (file) await validateUploadedMedia(file);
    const profileReference = config.masterReference || characterProfile?.masterReferenceImages?.[0] || "";
    if (!file && (!profileReference || path.isAbsolute(profileReference) || profileReference.includes(".."))) {
      throw new Error("Choose a master image, or select a character profile with a saved Studio reference image.");
    }
    const referenceImage = file ? `z-image-studio/${file.filename}` : profileReference;
    const info: any = await comfy().objectInfo();
    const availableModels: string[] = [
      ...(info.UNETLoader?.input?.required?.unet_name?.[0] || []),
      ...(info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [])
    ];
    const availableLoras: string[] = [
      ...(info.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || []),
      ...(info.LoraLoader?.input?.required?.lora_name?.[0] || [])
    ];
    const stack = resolveMasterGenerationStack({
      masterDiskPath: file?.path,
      masterRelative: referenceImage,
      originalFilename: file?.originalname,
      requestedModel: config.model,
      requestedLoras: config.loras,
      availableModels,
      availableLoras,
      // Builder list is exact: removing a master LoRA or changing strength must stick.
      formLorasAuthoritative: true
    });
    const resolvedModel = stack.model || config.model;
    const modelOk =
      availableModels.includes(resolvedModel) ||
      Boolean(matchModelFilename(resolvedModel, availableModels));
    if (!resolvedModel || !modelOk) {
      throw new Error(`Image model is not available: ${resolvedModel || config.model}. Pick an installed model in Dataset Builder.`);
    }
    // Back-compat: skip missing LoRAs with a warning instead of hard-failing the whole dataset.
    const unmatchedNote = stack.unmatchedLoras.length
      ? `Skipped unavailable LoRAs: ${stack.unmatchedLoras.join(", ")}.`
      : "";
    const architecture = modelArchitecture(resolvedModel);
    if (architecture === "unknown") throw new Error("This image model is not supported by Dataset Builder.");
    const profile = architecture === "krea2" ? krea2 : architecture === "illustrious"
      ? { textEncoder: "checkpoint", vae: "checkpoint" }
      : architecture === "anima"
        ? anima
        : settings;
    if (architecture === "krea2") {
      const kreaLoras: string[] = info.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [];
      if (!kreaLoras.includes(KREA_REFERENCE_FILES.identityLora)) throw new Error(`Krea identity adapter is missing: ${KREA_REFERENCE_FILES.identityLora}`);
    }
    // Apply every matched/installed LoRA the user picked (or the master carried). Do NOT silently
    // drop by architecture: that made explicit picks vanish and the run report "no LoRAs" — the bug
    // this fixes. A verified LoRA whose registered architecture differs from the resolved model is
    // still applied, but flagged in the record warning so the user can re-verify if results look off.
    const registeredLoras = loraRegistry.list(availableLoras);
    const requiredFamily = architecture;
    const stackLoras = stack.loras;
    const mismatchedLoras = stackLoras
      .filter(lora => {
        const reg = registeredLoras.find(item => item.filename === lora.name);
        return Boolean(reg?.verified && reg.architecture && reg.architecture !== requiredFamily && reg.architecture !== "unknown");
      })
      .map(lora => lora.name);
    const configWithStack = {
      ...config,
      model: resolvedModel,
      loras: stackLoras,
      stackMatchedFromMaster: stack.matchedFromMaster
    };
    const id = crypto.randomUUID();
    // Captions come only from datasetPrompts (list + form basePrompt). Master PNG is never a text source.
    // LoRA stack = Dataset Builder list (authoritative). Model still matched from master metadata when present.
    const prompts = datasetPrompts(configWithStack);
    const clientId = crypto.randomUUID();
    const outputSlug = datasetOutputSlug(config.name || config.trigger, id);
    const promptIds: string[] = [];
    const datasetNegative = resolveDatasetNegativePrompt(config.datasetMode, config.negativePrompt);
    const identityStrength = datasetIdentityReferenceStrength(architecture, config.datasetMode);
    for (const item of prompts) {
      let promptText = item.caption;
      try {
        promptText = applyLoraActivations(promptText, stackLoras, registeredLoras);
      } catch { /* keep caption */ }
      const input = generationSchema.parse({
        prompt: promptText, negativePrompt: datasetNegative,
        width: config.width, height: config.height, seed: item.seed,
        steps: architecture === "krea2" ? 8 : architecture === "illustrious" ? 28 : 9,
        guidance: architecture === "illustrious" ? 4 : 1,
        batchSize: 1,
        priority: "low", outputFormat: "png",
        sampler: architecture === "illustrious" ? "dpmpp_sde" : "res_multistep",
        scheduler: architecture === "illustrious" ? "karras" : "simple",
        outputName: datasetOutputName(outputSlug, item.index + 1),
        diffusionModel: resolvedModel,
        textEncoder: profile.textEncoder,
        vae: profile.vae,
        loras: stackLoras,
        // Identity lock only — do not use high strength that freezes master pose/outfit.
        references: [{ image: referenceImage, mode: "direct", strength: identityStrength }]
      });
      const graph = architecture === "illustrious"
        ? buildIllustriousWorkflow(input)
        : architecture === "anima"
          ? buildAnimaWorkflow(input)
          : buildWorkflow(workflowTemplate, input);
      const result = await comfy().submit(graph, clientId, "low") as { prompt_id: string };
      promptIds.push(result.prompt_id);
    }
    const datasetDirectory = resolveInside(datasetsRoot, id);
    fs.mkdirSync(resolveInside(datasetDirectory, "images"), { recursive: true });
    const record = {
      id, status: "pending", progress: 0, phase: "Queued", createdAt: new Date().toISOString(),
      started: Date.now(), referenceImage, promptIds, completedPromptIds: [], failedPromptIds: [], promptErrors: {},
      images: [], captions: prompts.map(item => item.caption), captionByImage: {},
      promptPlan: prompts,
      architecture,
      steps: architecture === "krea2" ? 8 : architecture === "illustrious" ? 28 : 9,
      guidance: architecture === "illustrious" ? 4 : 1,
      sampler: architecture === "illustrious" ? "dpmpp_sde" : "res_multistep",
      scheduler: architecture === "illustrious" ? "karras" : "simple",
      textEncoder: profile.textEncoder,
      vae: profile.vae,
      warning: [
        stack.matchedFromMaster
          ? `Master model matched: ${String(resolvedModel).replace(/\.safetensors$/i, "")}.`
          : `Using selected model ${String(resolvedModel).replace(/\.safetensors$/i, "")}.`,
        stackLoras.length
          ? `Applied LoRAs (builder list): ${stackLoras.map(l => `${String(l.name).replace(/\.safetensors$/i, "")}:${l.strength}`).join(", ")}.`
          : "Applied LoRAs: none (builder list empty).",
        unmatchedNote,
        mismatchedLoras.length ? `LoRA architecture mismatch (applied anyway): ${mismatchedLoras.join(", ")} — model resolved as ${requiredFamily}. Re-verify in LoRA Manager if results look off.` : "",
        architecture === "z-image" ? "Z-Image uses structural guidance; Krea 2 Identity mode gives stronger one-image identity retention." : "",
        config.datasetMode === "instagram-ugc" ? "Instagram UGC mode: list + character captions; clothing-aware negative (editable). Review outfits before LoRA Lab." : ""
      ].filter(Boolean).join(" "),
      ...configWithStack,
      negativePrompt: datasetNegative,
      outputSlug,
      stackNote: stack.note,
      stackSources: stack.sources,
      appliedLoras: stackLoras
    };
    datasetRecords.unshift(record);
    persistDatasets();
    monitorDataset(record);
    r.status(202).json(record);
  } catch (error: any) {
    if (file && fs.existsSync(file.path)) try { fs.unlinkSync(file.path); } catch {}
    r.status(400).json({ error: error?.issues?.[0]?.message || simplify(error) });
  }
});
app.get("/api/gallery", (_q, r) => r.json(records));
app.delete("/api/gallery/:id", (q, r) => { records = records.filter(x => x.id !== q.params.id); persist(); r.status(204).end(); });
app.post("/api/generate", photoUpload.array("references", 4), async (q, r) => {
  const freshFiles = (q.files as Express.Multer.File[] | undefined) || [];
  try {
    const diffusionModel = q.body.diffusionModel || settings.diffusionModel;
    const architecture = modelArchitecture(diffusionModel);
    if (architecture === "unknown") throw new Error("This model architecture is not supported by Z-Image Studio yet.");
    const profile = architecture === "krea2" ? krea2 : architecture === "anima" ? anima : settings;
    const parsedLoras = typeof q.body.loras === "string" ? JSON.parse(q.body.loras) : q.body.loras;
    const requestedCharacters = z.array(generationCharacterSchema).max(8).parse(
      typeof q.body.characters === "string" ? JSON.parse(q.body.characters) : (q.body.characters || [])
    );
    const requestedReferences = typeof q.body.referenceSettings === "string" ? JSON.parse(q.body.referenceSettings) : [];
    let nextFile = 0;
    const resolvedReferences: Array<{ image: string; mode: "pose" | "direct" | "face"; strength: number; characterId?: string }> = requestedReferences.map((reference: any) => {
      const image = reference.image || (freshFiles[nextFile] ? `z-image-studio/${freshFiles[nextFile++].filename}` : "");
      return { image, mode: reference.mode, strength: Number(reference.strength), characterId: reference.characterId ? String(reference.characterId) : undefined };
    });
    if (nextFile !== freshFiles.length) throw new Error("Reference image settings did not match the uploaded files.");

    // NovelAI-style Improve: copy a completed gallery PNG from Comfy output → input for LoadImage.
    let initImage = typeof q.body.initImage === "string" && q.body.initImage.trim() ? String(q.body.initImage).trim() : undefined;
    if (!initImage && q.body.sourceFilename) {
      const sourceName = String(q.body.sourceFilename);
      const sourceSub = String(q.body.sourceSubfolder || "");
      const source = safeOutputPath(settings.outputDirectory, sourceName, sourceSub);
      if (!fs.existsSync(source)) throw new Error("Improve source image was not found in the ComfyUI output folder.");
      fs.mkdirSync(uploadRoot, { recursive: true });
      const safeBase = sourceName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "source.png";
      const destName = `improve-${Date.now()}-${safeBase}`;
      const dest = path.join(uploadRoot, destName);
      fs.copyFileSync(source, dest);
      initImage = `z-image-studio/${destName}`;
    }

    const img2imgStrength = q.body.img2imgStrength !== undefined && q.body.img2imgStrength !== ""
      ? Number(q.body.img2imgStrength) : 1;
    const img2imgNoise = q.body.img2imgNoise !== undefined && q.body.img2imgNoise !== ""
      ? Number(q.body.img2imgNoise) : 0;
    const img2imgMode = q.body.img2imgMode === "rewrite" ? "rewrite" : "refine";
    const img2imgLockStructure = q.body.img2imgLockStructure === undefined
      ? img2imgMode === "refine"
      : q.body.img2imgLockStructure === "true" || q.body.img2imgLockStructure === true;

    const input = generationSchema.parse({
      ...q.body, diffusionModel, textEncoder: profile.textEncoder, vae: profile.vae,
      width: Number(q.body.width), height: Number(q.body.height), seed: Number(q.body.seed),
      steps: Number(q.body.steps), guidance: Number(q.body.guidance), batchSize: Number(q.body.batchSize),
      neuralUpscale: q.body.neuralUpscale === "true",
      faceRefinement: q.body.faceRefinement === "true",
      upscaleModel: String(q.body.upscaleModel || "RealESRGAN_x4plus.pth"),
      initImage,
      img2imgStrength,
      img2imgNoise,
      img2imgMode,
      img2imgLockStructure,
      loras: parsedLoras || [], references: resolvedReferences.map(({ characterId: _characterId, ...reference }: any) => reference)
    });
    const modelCatalogEntry = modelCatalog.find(item => item.type === "checkpoint" && item.filename === diffusionModel);
    const characters: GenerationCharacter[] = requestedCharacters.map(character => ({
      ...character,
      references: resolvedReferences
        .filter((reference: { characterId?: string }) => reference.characterId === character.id)
        .map(({ characterId: _characterId, ...reference }: { image: string; mode: "pose" | "direct" | "face"; strength: number; characterId?: string }) => reference)
    }));
    const composed = composeCharacterPrompts(input.prompt, input.negativePrompt, characters);
    const basePrompt = input.prompt;
    const baseNegativePrompt = input.negativePrompt;
    if (characters.length) {
      input.prompt = composed.positive;
      input.negativePrompt = composed.negative;
    }
    for (const file of freshFiles) await validateUploadedMedia(file);
    const info: any = await comfy().objectInfo();
    const availableModels: string[] = architecture === "illustrious"
      ? info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || []
      : info.UNETLoader?.input?.required?.unet_name?.[0] || [];
    if (!availableModels.includes(input.diffusionModel)) throw new Error(`Diffusion model is not available in ComfyUI: ${input.diffusionModel}`);
    if (architecture !== "illustrious") {
      const availableEncoders: string[] = info.CLIPLoader?.input?.required?.clip_name?.[0] || [];
      const availableVaes: string[] = info.VAELoader?.input?.required?.vae_name?.[0] || [];
      const familyLabel = architecture === "krea2" ? "Krea 2 " : architecture === "anima" ? "Anima " : "";
      if (!availableEncoders.includes(input.textEncoder)) throw new Error(`Required ${familyLabel}text encoder is missing: ${input.textEncoder}. For Anima, install ${ANIMA_FILES.textEncoder} at the project root (Comfy text_encoders path).`);
      if (!availableVaes.includes(input.vae)) throw new Error(`Required ${familyLabel}VAE is missing: ${input.vae}`);
    }
    const availableLoras: string[] = (architecture === "illustrious" ? info.LoraLoader : info.LoraLoaderModelOnly)?.input?.required?.lora_name?.[0] || [];
    const unavailable = input.loras.find(lora => !availableLoras.includes(lora.name));
    if (unavailable) throw new Error(`LoRA is not available in ComfyUI: ${unavailable.name}`);
    const registeredLoras = loraRegistry.list(availableLoras);
    const requiredLoraFamily = modelCatalogEntry?.loraArchitecture || architecture;
    const incompatibleLora = input.loras.find(lora => {
      const record = registeredLoras.find(item => item.filename === lora.name);
      return !record?.verified || record.architecture !== requiredLoraFamily;
    });
    if (incompatibleLora) throw new Error(`LoRA is not verified for this ${requiredLoraFamily} model: ${incompatibleLora.name}`);
    input.prompt = applyLoraActivations(input.prompt, input.loras, registeredLoras);
    if ((architecture === "illustrious" || architecture === "anima") && q.body.consistentCharacter === "true") {
      throw new Error(`Character Consistency is not available for ${architecture === "anima" ? "Anima" : "Illustrious"} yet. Use Pose + Direct/Face references instead.`);
    }
    if (input.references.length) {
      const hasPose = input.references.some(reference => reference.mode === "pose");
      const hasIdentity = input.references.some(reference => ["direct", "face"].includes(reference.mode));
      const choiceList = (node: string, key: string): string[] =>
        info[node]?.input?.required?.[key]?.[0] || [];
      if (architecture === "krea2") {
        const referenceNodes = [
          ...(hasIdentity ? ["LoadImage", "VAEEncode", "LoraLoaderModelOnly", "Krea2EditModelPatch", "Krea2EditGroundedEncode"] : []),
          ...(hasPose ? ["LoadImage", "ImageScale", "DepthAnythingV2Preprocessor", "Krea2ControlLoRALoader", "Krea2ControlImageEncode", "Krea2ControlApply"] : [])
        ];
        const missing = referenceNodes.filter(node => !(node in info));
        if (missing.length) throw new Error(`ComfyUI is missing Krea reference nodes: ${missing.join(", ")}`);
        const kreaLoras = choiceList("Krea2ControlLoRALoader", "lora_name");
        for (const file of [
          ...(hasPose ? [KREA_REFERENCE_FILES.depthLora] : []),
          ...(hasIdentity ? [KREA_REFERENCE_FILES.identityLora] : [])
        ]) {
          if (!kreaLoras.includes(file)) throw new Error(`Krea 2 reference adapter is missing: ${file}`);
        }
      } else if (architecture === "illustrious") {
        const needed = ["LoadImage", "ImageScale", "ControlNetLoader", "ControlNetApplyAdvanced", "Canny",
          ...(hasPose ? ["OpenposePreprocessor"] : [])];
        const missing = needed.filter(node => !(node in info));
        if (missing.length) throw new Error(`ComfyUI is missing Illustrious reference nodes: ${missing.join(", ")}`);
        const nets = choiceList("ControlNetLoader", "control_net_name");
        if (hasPose && !nets.includes(ILLUSTRIOUS_REFERENCE_FILES.openpose)) {
          throw new Error(`SDXL OpenPose ControlNet is missing: ${ILLUSTRIOUS_REFERENCE_FILES.openpose}`);
        }
        if (hasIdentity && !nets.includes(ILLUSTRIOUS_REFERENCE_FILES.canny)) {
          throw new Error(`SDXL Canny ControlNet is missing: ${ILLUSTRIOUS_REFERENCE_FILES.canny}`);
        }
      } else if (architecture === "anima") {
        const needed = ["LoadImage", "ImageScale", "ModelPatchLoader", "AnimaLLLiteApply", "Canny",
          ...(hasPose ? ["OpenposePreprocessor"] : [])];
        const missing = needed.filter(node => !(node in info));
        if (missing.length) throw new Error(`ComfyUI is missing Anima reference nodes: ${missing.join(", ")}`);
        const patches = choiceList("ModelPatchLoader", "name");
        if (hasPose && !patches.includes(ANIMA_REFERENCE_FILES.pose)) {
          throw new Error(`Anima pose LLLite patch is missing: ${ANIMA_REFERENCE_FILES.pose}`);
        }
        if (hasIdentity && !patches.includes(ANIMA_REFERENCE_FILES.structure)) {
          throw new Error(`Anima lineart LLLite patch is missing: ${ANIMA_REFERENCE_FILES.structure}`);
        }
      } else {
        // Z-Image (default)
        const referenceNodes = [
          "LoadImage", "ImageScale", "ModelPatchLoader", "QwenImageDiffsynthControlnet",
          ...(hasIdentity ? ["Canny"] : []),
          ...(hasPose ? ["CheckpointLoaderSimple", "SDPoseKeypointExtractor", "SDPoseDrawKeypoints"] : [])
        ];
        const missing = referenceNodes.filter(node => !(node in info));
        if (missing.length) throw new Error(`ComfyUI is missing reference-guidance nodes: ${missing.join(", ")}`);
        const patches = choiceList("ModelPatchLoader", "name");
        const checkpoints = choiceList("CheckpointLoaderSimple", "ckpt_name");
        if (!patches.includes(POSE_FILES.controlnet)) throw new Error(`Reference ControlNet is missing: ${POSE_FILES.controlnet}`);
        if (hasPose && !checkpoints.includes(POSE_FILES.detector)) {
          throw new Error(`Pose detector is missing: ${POSE_FILES.detector}`);
        }
      }
    }
    if (q.body.faceRefinement === "true" || input.references.some(reference => reference.mode === "face" && architecture === "z-image")) {
      for (const node of ["FaceDetailer", "UltralyticsDetectorProvider"]) {
        if (!(node in info)) throw new Error(`Face polish is unavailable because ${node} is missing.`);
      }
      const detectors: string[] = info.UltralyticsDetectorProvider?.input?.required?.model_name?.[0] || [];
      if (!detectors.includes("bbox/face_yolov8m.pt")) throw new Error("Face polish detector is missing: bbox/face_yolov8m.pt");
    }
    if (input.neuralUpscale) {
      for (const node of ["UpscaleModelLoader", "ImageUpscaleWithModel"]) {
        if (!(node in info)) throw new Error(`Neural upscale is unavailable because ${node} is missing.`);
      }
      const upscaleInput = info.UpscaleModelLoader?.input?.required?.model_name;
      const upscaleModels: string[] = Array.isArray(upscaleInput?.[1]?.options)
        ? upscaleInput[1].options : (Array.isArray(upscaleInput?.[0]) ? upscaleInput[0] : []);
      if (!upscaleModels.includes(input.upscaleModel)) throw new Error(`Neural upscale model is missing: ${input.upscaleModel}`);
    }
    const clientId = crypto.randomUUID();
    const started = Date.now();
    const consistentCharacter = q.body.consistentCharacter === "true";
    const master = input.references.find(reference => reference.mode === "direct");
    const pose = input.references.find(reference => reference.mode === "pose");
    const { references: _references, ...consistentBase } = input;
    if (architecture !== "illustrious" && architecture !== "anima" && consistentCharacter && !master) throw new Error("Character Consistency needs one Identity / Direct reference image.");
    const graph = architecture === "illustrious"
      ? buildIllustriousWorkflow(input)
      : architecture === "anima"
      ? buildAnimaWorkflow(input)
      : consistentCharacter && master
      ? buildConsistentCharacterWorkflow(workflowTemplate, {
          ...consistentBase,
          characterRefPath: master.image, poseRefPath: pose?.image,
          environmentPrompt: "", ipAdapterWeight: master.strength,
          controlnetWeight: pose?.strength, controlnetEnd: Number(q.body.controlnetEnd || 0.75),
          faceRefinement: input.faceRefinement
        })
      : buildWorkflow(workflowTemplate, input);
    const result = await comfy().submit(graph, clientId, input.priority) as { prompt_id: string };
    const record = {
      id: crypto.randomUUID(), promptId: result.prompt_id, status: "pending",
      createdAt: new Date().toISOString(), started, ...input, basePrompt, baseNegativePrompt, characters, consistentCharacter,
      faceRefinement: q.body.faceRefinement === "true",
      inputNames: input.references.map(reference => path.basename(reference.image)),
      images: [] as unknown[]
    };
    records.unshift(record); persist(); monitor(record, clientId);
    r.status(202).json(record);
  } catch (e: any) {
    for (const file of freshFiles) {
      const resolved = path.resolve(file.path);
      if (resolved.startsWith(path.resolve(uploadRoot) + path.sep)) try { fs.unlinkSync(resolved); } catch {}
    }
    const error = e?.issues?.[0]?.message || simplify(e);
    recentErrors.unshift(error);
    const unavailable = error.startsWith("Cannot reach ComfyUI") || error.includes("did not respond");
    r.status(unavailable ? 503 : 400).json({ error });
  }
});
app.post("/api/video/generate", upload.fields([
  { name: "reference", maxCount: 1 }, { name: "driving", maxCount: 1 },
  { name: "referenceMask", maxCount: 1 }, { name: "drivingMask", maxCount: 1 }
]), async (q, r) => {
  const files = q.files as Record<string, Express.Multer.File[]> | undefined;
  const freshFiles = Object.values(files || {}).flat();
  try {
    if (records.some(record => record.mediaType === "video" && ["pending", "active"].includes(String(record.status)))) {
      throw new Error("A video job is already queued or running. This GPU processes one SCAIL-2 video at a time.");
    }
    const source = q.body.sourceRecordId ? records.find(record => record.id === q.body.sourceRecordId && record.mediaType === "video") as any : undefined;
    const relative = (field: string, previous?: string) => files?.[field]?.[0] ? `z-image-studio/${files[field][0].filename}` : previous;
    const raw = {
      ...q.body,
      width: Number(q.body.width), height: Number(q.body.height), frameCount: Number(q.body.frameCount),
      fps: Number(q.body.fps), seed: Number(q.body.seed), steps: Number(q.body.steps),
      guidance: Number(q.body.guidance), poseStrength: Number(q.body.poseStrength),
      poseStart: Number(q.body.poseStart), poseEnd: Number(q.body.poseEnd),
      automaticPreprocessing: q.body.automaticPreprocessing === "true",
      referenceImage: relative("reference", source?.inputs?.referenceImage),
      drivingVideo: relative("driving", source?.inputs?.drivingVideo),
      referenceMask: relative("referenceMask", source?.inputs?.referenceMask),
      drivingMask: relative("drivingMask", source?.inputs?.drivingMask)
    };
    const input = videoGenerationSchema.parse(raw);
    for (const file of freshFiles) await validateUploadedMedia(file);
    const drivingProbe = await probeMedia(path.join(root, "ComfyUI/input", input.drivingVideo));
    const availableFrames = estimateFrames(drivingProbe);
    if (availableFrames < input.frameCount) throw new Error(`Driving video has about ${availableFrames} frames, but ${input.frameCount} were requested.`);
    const info: any = await comfy().objectInfo();
    const missingNodes = SCAIL_NODES.filter(node => !(node in info));
    if (missingNodes.length) throw new Error(`ComfyUI is missing required SCAIL-2 nodes: ${missingNodes.join(", ")}`);
    const checkChoice = (node: string, key: string, name: string) => {
      const choices: string[] = info[node]?.input?.required?.[key]?.[0] || [];
      if (!choices.includes(name)) throw new Error(`Required SCAIL-2 file is missing: ${name}`);
    };
    checkChoice("UNETLoader", "unet_name", input.model);
    checkChoice("CLIPLoader", "clip_name", SCAIL_FILES.textEncoder);
    checkChoice("VAELoader", "vae_name", SCAIL_FILES.vae);
    checkChoice("CLIPVisionLoader", "clip_name", SCAIL_FILES.clipVision);
    if (input.automaticPreprocessing) checkChoice("CheckpointLoaderSimple", "ckpt_name", SCAIL_FILES.sam3);
    const clientId = crypto.randomUUID();
    const started = Date.now();
    const result = await comfy().submit(buildVideoWorkflow(input), clientId, input.priority) as { prompt_id: string };
    const record = {
      id: crypto.randomUUID(), promptId: result.prompt_id, mediaType: "video", status: "pending",
      createdAt: new Date().toISOString(), started, ...input,
      inputs: {
        referenceImage: input.referenceImage, drivingVideo: input.drivingVideo,
        referenceMask: input.referenceMask, drivingMask: input.drivingMask
      },
      inputNames: {
        reference: path.basename(input.referenceImage), driving: path.basename(input.drivingVideo),
        referenceMask: input.referenceMask ? path.basename(input.referenceMask) : undefined,
        drivingMask: input.drivingMask ? path.basename(input.drivingMask) : undefined
      },
      images: [] as unknown[], videos: [] as unknown[]
    };
    records.unshift(record); persist(); monitor(record, clientId);
    r.status(202).json(record);
  } catch (e: any) {
    for (const file of freshFiles) {
      const resolved = path.resolve(file.path);
      if (resolved.startsWith(path.resolve(uploadRoot) + path.sep)) try { fs.unlinkSync(resolved); } catch {}
    }
    const error = e?.issues?.[0]?.message || simplify(e);
    recentErrors.unshift(error);
    r.status(error.includes("ComfyUI") ? 503 : 400).json({ error });
  }
});
app.post("/api/jobs/:id/cancel", async (q, r) => { try { await comfy().deleteQueued(q.params.id); r.status(204).end(); } catch (e) { r.status(502).json({ error: simplify(e) }); } });
app.post("/api/interrupt", async (_q, r) => { try { await comfy().interrupt(); r.status(204).end(); } catch (e) { r.status(502).json({ error: simplify(e) }); } });
/**
 * Safe Activity kill: clear a Studio pending/active ghost without touching model files.
 * Best-effort cancel/interrupt on Comfy first; always terminates the Studio record.
 */
app.post("/api/gallery/:id/dismiss", async (q, r) => {
  try {
    const record = records.find(item => String(item.id) === q.params.id);
    if (!record) return r.status(404).json({ error: "Generation record not found." });
    if (!["pending", "active"].includes(String(record.status))) {
      return r.status(400).json({ error: "Only pending or active jobs can be cleared." });
    }
    const promptId = String(record.promptId || "");
    stopHistoryMonitor(promptId);
    if (promptId) {
      try { await comfy().deleteQueued(promptId); } catch { /* may already be gone */ }
      try { await comfy().interrupt(); } catch { /* idle is fine */ }
    }
    finishGeneration(record, { status: "failed", error: DISMISS_JOB_ERROR });
    r.json(record);
  } catch (e) {
    r.status(500).json({ error: simplify(e) });
  }
});
app.get("/api/image", (q, r) => {
  const { filename, subfolder = "", type = "output" } = q.query as Record<string,string>;
  if (!filename || filename.includes("..") || subfolder.includes("..")) return r.status(400).json({ error: "Invalid image path" });
  r.redirect(comfy().imageUrl(filename, subfolder, type));
});
app.get("/api/download", async (q, r) => {
  const { filename, subfolder = "", type = "output" } = q.query as Record<string,string>;
  if (!filename || filename.includes("..") || subfolder.includes("..")) return r.status(400).json({ error: "Invalid media path" });
  try {
    const upstream = await fetch(comfy().imageUrl(filename, subfolder, type));
    if (!upstream.ok || !upstream.body) return r.status(upstream.status || 502).json({ error: "Media file is unavailable" });
    r.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    r.setHeader("Content-Disposition", `attachment; filename="${path.basename(filename).replaceAll('"', "")}"`);
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(r);
  } catch (e) {
    r.status(502).json({ error: simplify(e) });
  }
});
app.post("/api/open-folder", async (_q, r) => {
  if (!settings.outputDirectory) return r.status(400).json({ error: "Configure the ComfyUI output directory first." });
  const { spawn } = await import("node:child_process");
  spawn("explorer.exe", [path.resolve(settings.outputDirectory)], { detached: true, stdio: "ignore" }).unref();
  r.status(204).end();
});

function finishGeneration(record: any, outcome: GenerationOutcome) {
  if (!["pending", "active"].includes(String(record.status))) return;
  if (outcome.status === "failed") {
    record.status = "failed";
    record.error = outcome.error;
  } else {
    record.status = "completed";
    record.progress = 100;
    record.videos = outcome.videos;
    record.images = outcome.images;
    record.durationMs = Date.now() - record.started;
    if (settings.outputDirectory) try {
      saveMetadata(path.join(root, "outputs"), record.id, { ...record, applicationVersion: "0.1.0", workflowVersion: "official-template-0.3.73" });
    } catch {}
    // Civitai upload support: embed A1111-style parameters (model + LoRA + hashes) into PNGs.
    // Never throws into the generation path — failures are non-fatal.
    try { embedCivitaiMetadataForRecord(record); }
    catch (error) { recentErrors.unshift(`Civitai metadata: ${simplify(error)}`); }
  }
  persist();
  broadcast({ type: "record", record });
}

type MasterStack = {
  model?: string;
  loras: Array<{ name: string; strength: number }>;
  /** LoRAs detected from metadata before availability filtering (for UI). */
  detectedLoras: Array<{ name: string; strength: number }>;
  matchedFromMaster: boolean;
  sources: string[];
  unmatchedLoras: string[];
  note: string;
};

function modelsFromLocalFallback(): string[] {
  const names = new Set<string>();
  for (const dir of [root, path.join(root, "checkpoints"), path.join(root, "ComfyUI", "models", "diffusion_models"), path.join(root, "ComfyUI", "models", "checkpoints")]) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (/\.safetensors$/i.test(name)) names.add(name);
      }
    } catch { /* skip */ }
  }
  return [...names];
}

function lorasFromLocalFallback(): string[] {
  const names = new Set<string>();
  for (const dir of [path.join(root, "lora"), path.join(root, "ComfyUI", "models", "loras")]) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (/\.safetensors$/i.test(name)) names.add(name);
      }
    } catch { /* skip */ }
  }
  return [...names];
}

/** Resolve Comfy input-relative paths like z-image-studio/foo.png to disk. */
function resolveComfyInputRelative(relative: string): string | undefined {
  const clean = String(relative || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || path.isAbsolute(clean)) return undefined;
  const full = path.join(root, "ComfyUI", "input", clean);
  return fs.existsSync(full) ? full : undefined;
}

/** Find gallery generation stack by output filename basename. */
function findGalleryStackByImageName(filename: string): { model?: string; loras: Array<{ name: string; strength: number }>; recordId?: string } | null {
  const base = path.basename(filename || "");
  if (!base) return null;
  for (const rec of records) {
    const images = Array.isArray(rec.images) ? rec.images : [];
    const hit = images.find((img: any) => path.basename(String(img?.filename || "")) === base);
    if (!hit) continue;
    const loras = Array.isArray(rec.loras)
      ? rec.loras
          .filter((item: any) => item?.name)
          .map((item: any) => ({ name: String(item.name), strength: Number(item.strength) || 1 }))
      : [];
    return {
      model: String(rec.diffusionModel || rec.model || "") || undefined,
      loras,
      recordId: String(rec.id || "")
    };
  }
  return null;
}

/**
 * Match dataset generation stack to the master image:
 * 1) Gallery record for that filename (model + LoRAs as generated)
 * 2) PNG A1111 parameters / Comment metadata (Model + <lora:…> only — NOT the positive prompt text)
 * 3) Explicit form model/loras
 * originalFilename: browser name before multer UUID rename (e.g. z-image_00240_.png)
 *
 * Intentionally ignores the master's positive prompt / scene text so dataset captions
 * stay list + character description only.
 *
 * LoRA authority:
 * - formLorasAuthoritative=true (dataset CREATE): Dataset Builder list is exact — add/remove/strength stick.
 * - formLorasAuthoritative=false (inspect-master): master fills defaults; form only adds missing extras.
 */
function resolveMasterGenerationStack(options: {
  masterDiskPath?: string;
  masterRelative?: string;
  originalFilename?: string;
  requestedModel?: string;
  requestedLoras?: Array<{ name: string; strength: number }>;
  availableModels: string[];
  availableLoras: string[];
  /** When true, form LoRA list fully replaces master LoRAs (Dataset Builder edits must stick). */
  formLorasAuthoritative?: boolean;
}): MasterStack {
  const sources: string[] = [];
  let modelHint = options.requestedModel;
  const formLoras = Array.isArray(options.requestedLoras) ? [...options.requestedLoras] : [];
  let masterLoras: Array<{ name: string; strength: number }> = [];

  // Prefer original browser filename for gallery lookup (uploads are renamed to UUID.png).
  const galleryCandidates = [
    options.originalFilename,
    options.masterRelative,
    options.masterDiskPath
  ].filter(Boolean).map(item => path.basename(String(item)));

  let gallery: ReturnType<typeof findGalleryStackByImageName> = null;
  for (const name of galleryCandidates) {
    gallery = findGalleryStackByImageName(name);
    if (gallery?.model || gallery?.loras?.length) break;
  }
  const formAuthoritative = options.formLorasAuthoritative === true;

  if (gallery?.model || gallery?.loras?.length) {
    if (gallery.model) {
      modelHint = gallery.model;
      sources.push(`gallery model (${gallery.recordId || "record"})`);
    }
    if (gallery.loras.length) {
      masterLoras = gallery.loras;
      // Only report master LoRA sources when they will actually seed the stack (inspect).
      if (!formAuthoritative) sources.push(`gallery LoRAs ×${gallery.loras.length}`);
    }
  }

  const pngPath =
    (options.masterDiskPath && fs.existsSync(options.masterDiskPath) ? options.masterDiskPath : undefined) ||
    (options.masterRelative ? resolveComfyInputRelative(options.masterRelative) : undefined);
  if (pngPath) {
    const parsed = readGenerationMetaFromPng(pngPath);
    if (parsed.model) {
      // Master PNG model is authoritative when present (dataset must match the master render stack).
      modelHint = parsed.model;
      if (!sources.some(s => /PNG Model/i.test(s))) sources.push("PNG Model metadata");
    }
    if (parsed.loras.length) {
      // PNG LoRAs seed inspect when gallery didn't supply any.
      if (!masterLoras.length) {
        masterLoras = parsed.loras;
        if (!formAuthoritative) sources.push(`PNG LoRA tags ×${parsed.loras.length}`);
      }
    }
  }

  // Form authoritative on create: user removals/strengths must not be re-injected from master.
  const hintResult = resolveDatasetLoraHints({
    formLoras,
    masterLoras,
    formAuthoritative
  });
  const loraHints = hintResult.loras;
  for (const s of hintResult.sources) {
    if (!sources.includes(s)) sources.push(s);
  }

  const availableModels = options.availableModels.length ? options.availableModels : modelsFromLocalFallback();
  const availableLoras = options.availableLoras.length ? options.availableLoras : lorasFromLocalFallback();

  const matchedModel =
    matchModelFilename(modelHint, availableModels) ||
    (options.requestedModel && matchModelFilename(options.requestedModel, availableModels)) ||
    options.requestedModel ||
    modelHint;

  const loraMatch = matchLoraFilenames(loraHints, availableLoras);
  const unmatchedLoras = loraMatch.filter(item => !item.matched).map(item => item.requestedName);
  // When Comfy list is empty, keep detected names so the UI can still show them for manual confirm.
  const loras = (availableLoras.length
    ? loraMatch.filter(item => item.matched)
    : loraMatch
  ).map(item => ({ name: item.name, strength: item.strength }));

  const matchedFromMaster = sources.some(s => /gallery|PNG/i.test(s));
  const noteParts = [
    matchedModel ? `model ${String(matchedModel).replace(/\.safetensors$/i, "")}` : "model not resolved from master",
    loras.length ? `${loras.length} LoRA${loras.length === 1 ? "" : "s"}` : "no LoRAs",
    sources.length ? `via ${sources.join(" + ")}` : "using form defaults (add LoRAs below if needed)"
  ];
  if (unmatchedLoras.length && availableLoras.length) {
    noteParts.push(`${unmatchedLoras.length} LoRA(s) not found in Comfy — add or install them`);
  }

  return {
    model: matchedModel,
    loras,
    detectedLoras: formAuthoritative ? loraHints : (masterLoras.length ? masterLoras : loraHints),
    matchedFromMaster,
    sources,
    unmatchedLoras,
    note: noteParts.join(" · ")
  };
}

function embedCivitaiMetadataForDatasetImage(record: any, imagePath: string, caption: string, seed?: number) {
  if (!/\.png$/i.test(imagePath) || !fs.existsSync(imagePath)) return false;
  const modelName = String(record.model || record.diffusionModel || "");
  const catalog = modelCatalog.find((item: any) => item.filename === modelName);
  const knownLoras: Record<string, string> = {};
  for (const lora of Array.isArray(record.loras) ? record.loras : []) {
    const reg = loraRegistry.list().find(item => item.filename.toLowerCase() === String(lora.name).toLowerCase());
    if (reg?.sha256) knownLoras[lora.name] = reg.sha256;
  }
  const hashes = collectResourceHashes(root, {
    diffusionModel: modelName,
    vae: record.vae,
    loras: record.loras
  }, { model: catalog?.sha256, loras: knownLoras });
  return embedCivitaiMetadataInPngFile(imagePath, {
    prompt: caption,
    negativePrompt: resolveDatasetNegativePrompt(record.datasetMode, record.negativePrompt),
    width: record.width,
    height: record.height,
    seed: seed ?? record.seed,
    steps: record.steps || (record.architecture === "krea2" ? 8 : 9),
    guidance: record.guidance ?? 1,
    sampler: record.sampler || "res_multistep",
    scheduler: record.scheduler || "simple",
    diffusionModel: modelName,
    vae: record.vae,
    textEncoder: record.textEncoder,
    loras: record.loras
  }, hashes);
}

/**
 * Write Civitai-friendly PNG text metadata into completed image files.
 * Leaves ComfyUI workflow "prompt" chunks intact; adds/replaces "parameters".
 */
function embedCivitaiMetadataForRecord(record: any) {
  const images = Array.isArray(record?.images) ? record.images : [];
  if (!images.length || !settings.outputDirectory) return;
  const modelName = String(record.diffusionModel || record.model || "");
  const catalog = modelCatalog.find((item: any) => item.filename === modelName);
  const knownLoras: Record<string, string> = {};
  for (const lora of Array.isArray(record.loras) ? record.loras : []) {
    const reg = loraRegistry.list().find(item => item.filename.toLowerCase() === String(lora.name).toLowerCase());
    if (reg?.sha256) knownLoras[lora.name] = reg.sha256;
  }
  const hashes = collectResourceHashes(root, {
    diffusionModel: modelName,
    vae: record.vae,
    loras: record.loras
  }, {
    model: catalog?.sha256,
    loras: knownLoras
  });
  let embedded = 0;
  for (const media of images) {
    const filename = String(media?.filename || "");
    if (!/\.png$/i.test(filename)) continue;
    if (filename.includes("..") || String(media?.subfolder || "").includes("..")) continue;
    try {
      const imagePath = safeOutputPath(settings.outputDirectory, filename, media.subfolder || "");
      if (!fs.existsSync(imagePath)) continue;
      if (embedCivitaiMetadataInPngFile(imagePath, {
        prompt: record.basePrompt || record.prompt,
        negativePrompt: record.baseNegativePrompt ?? record.negativePrompt,
        width: record.width,
        height: record.height,
        seed: record.seed,
        steps: record.steps,
        guidance: record.guidance,
        sampler: record.sampler,
        scheduler: record.scheduler,
        diffusionModel: modelName,
        vae: record.vae,
        textEncoder: record.textEncoder,
        loras: record.loras
      }, hashes)) embedded += 1;
    } catch (error) {
      recentErrors.unshift(`Civitai metadata (${filename}): ${simplify(error)}`);
    }
  }
  if (embedded) record.civitaiMetadataEmbedded = embedded;
}

function stopHistoryMonitor(promptId: string) {
  const timer = activeGenerationMonitors.get(promptId);
  if (timer) clearInterval(timer);
  activeGenerationMonitors.delete(promptId);
}

function monitorHistory(record: any, onTerminal?: () => void) {
  const promptId = String(record.promptId || "");
  if (!promptId || !["pending", "active"].includes(String(record.status)) || activeGenerationMonitors.has(promptId)) return;
  let polling = false;
  const poll = async () => {
    if (polling || !["pending", "active"].includes(String(record.status))) return;
    polling = true;
    try {
      const history: any = await comfy().history(promptId);
      const outcome = generationOutcome(history, promptId);
      if (outcome) {
        stopHistoryMonitor(promptId);
        finishGeneration(record, outcome);
        onTerminal?.();
        return;
      }
      // Ghost pending: Comfy forgot the job (empty history + not in queue after grace period).
      let inQueue = false;
      try {
        const queue: any = await comfy().queue();
        inQueue = promptIdsInComfyQueue(queue).has(promptId);
      } catch {
        // If Comfy is briefly unreachable, do not mark orphan yet.
        return;
      }
      const orphan = orphanGenerationOutcome(record, {
        historyHasTerminal: false,
        inComfyQueue: inQueue
      });
      if (orphan) {
        stopHistoryMonitor(promptId);
        finishGeneration(record, orphan);
        onTerminal?.();
      }
    } catch {
      // Temporary ComfyUI outages leave the durable record available for later reconciliation.
    } finally {
      polling = false;
    }
  };
  activeGenerationMonitors.set(promptId, setInterval(poll, 2_000));
  void poll();
}

function monitor(record: any, clientId: string) {
  const socket = comfy().socket(clientId);
  monitorHistory(record, () => socket.close());
  socket.on("message", async raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!["pending", "active"].includes(String(record.status))) return;
      if (msg.type === "executing" && msg.data?.prompt_id === record.promptId) {
        if (msg.data.node === null) {
          const history: any = await comfy().history(record.promptId);
          const outcome = generationOutcome(history, record.promptId);
          if (outcome) {
            stopHistoryMonitor(record.promptId);
            finishGeneration(record, outcome);
            socket.close();
          }
          return;
        }
        record.status = "active"; record.currentNode = msg.data.node;
        persist(); broadcast({ type: "record", record });
      } else if (msg.type === "progress" && msg.data?.prompt_id === record.promptId) {
        record.progress = Math.round((msg.data.value / msg.data.max) * 100); persist(); broadcast({ type: "record", record });
      } else if (msg.type === "execution_error" && msg.data?.prompt_id === record.promptId) {
        stopHistoryMonitor(record.promptId);
        finishGeneration(record, { status: "failed", error: msg.data.exception_message || "ComfyUI execution failed" });
        socket.close();
      }
    } catch {}
  });
  socket.on("error", e => { recentErrors.unshift(e.message); });
}
async function runMusubiTraining(record: any, config: any, datasetConfig: string, slug: string, installedPath: string) {
  const update = (status: string, phase: string, progress: number) => {
    Object.assign(record, { status, phase, progress });
    persistTraining();
    broadcast({ type: "training", record });
  };
  try {
    update("active", "Preparing local trainer", 3);
    const logFile = path.join(record.jobDirectory, "training.log");
    for (const item of trainingCommands(trainingPaths, config, record.jobDirectory, datasetConfig, slug)) {
      if (record.status === "cancelled") return;
      update("active", item.phase, item.progress);
      await runTrainingProcess(item.command, item.args, trainingPaths.musubi, logFile, text => {
        if (!item.phase.startsWith("Training")) return;
        const latest = parseTrainingProgress(text, Number(record.steps));
        if (!latest) return;
        record.currentStep = latest.currentStep;
        record.progress = Math.min(94, 28 + Math.round((latest.currentStep / latest.totalSteps) * 66));
        persistTraining();
        broadcast({ type: "training", record });
      }, child => { activeTrainingProcess = child; });
    }
    if (record.status === "cancelled") return;
    update("active", "Installing in Photo mode", 96);
    const outputDirectory = path.join(record.jobDirectory, "output");
    const trained = fs.readdirSync(outputDirectory).filter(name => name.endsWith(".safetensors"))
      .map(name => path.join(outputDirectory, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (!trained) throw new Error("Training finished, but no LoRA weights were produced.");
    if (modelArchitecture(config.model) === "z-image") {
      const converter = path.join(trainingPaths.musubi, "src", "musubi_tuner", "convert_lora.py");
      await runTrainingProcess(trainingPaths.python, [converter, "--input", trained, "--output", installedPath, "--target", "other"],
        trainingPaths.musubi, logFile, () => {}, child => { activeTrainingProcess = child; });
    } else {
      fs.copyFileSync(trained, installedPath, fs.constants.COPYFILE_EXCL);
    }
    Object.assign(record, {
      outputFile: trained, installedPath, durationMs: Date.now() - record.started,
      status: "completed", phase: "Ready in Photo mode", progress: 100, recommendedStrength: 1
    });
    const adapter = adapterForModel(config.model);
    if (adapter) loraRegistry.upsert({
      filename: path.basename(installedPath),
      architecture: adapter.architecture,
      baseTrainingModel: adapter.trainingBase,
      trainer: adapter.architecture === "illustrious" ? "kohya sd-scripts" : "Musubi Tuner",
      triggerToken: config.trigger,
      datasetId: config.datasetId,
      datasetVersion: config.datasetVersion,
      trainingResolution: config.resolution ? `${config.resolution}px buckets` : undefined,
      rank: config.rank,
      alpha: config.alpha,
      steps: config.maxTrainSteps,
      epochs: config.epochs,
      learningRate: config.learningRate,
      textEncoderLearningRate: config.textEncoderLearningRate,
      createdAt: new Date().toISOString(),
      recommendedStrength: 1,
      verifiedAdapters: [adapter.architecture],
      verified: true,
      notes: `Trained locally for ${adapter.displayName}.`
    });
    persistTraining();
    broadcast({ type: "training", record });
  } catch (error) {
    if (record.status === "cancelled") return;
    Object.assign(record, { status: "failed", phase: "Stopped", error: simplify(error), durationMs: Date.now() - record.started });
    persistTraining();
    broadcast({ type: "training", record });
  } finally { activeTrainingProcess = undefined; }
}
const DATASET_STOP_ERROR = "Stopped by user. Completed images were kept; remaining queue items were cancelled.";

function finalizeDatasetRecord(record: any, options?: { stopped?: boolean }) {
  record.completedPromptIds ||= [];
  record.failedPromptIds ||= [];
  record.promptIds ||= [];
  record.images ||= [];
  const terminalCount = record.completedPromptIds.length + record.failedPromptIds.length;
  record.progress = record.promptIds.length
    ? Math.round((terminalCount / record.promptIds.length) * 100)
    : 100;
  const failureCount = record.failedPromptIds.length;
  if (record.images.length) {
    record.status = "completed";
    if (options?.stopped) {
      record.phase = `Stopped · ${record.images.length} image${record.images.length === 1 ? "" : "s"} saved`;
      record.warning = `${record.images.length} completed image${record.images.length === 1 ? "" : "s"} kept. Remaining jobs were cancelled; review what you have or generate more.`;
      record.error = undefined;
    } else {
      record.phase = failureCount
        ? `Ready for review · ${failureCount} image${failureCount === 1 ? "" : "s"} failed`
        : "Ready for LoRA training";
      record.warning = failureCount
        ? `${failureCount} image${failureCount === 1 ? "" : "s"} could not be generated. The ${record.images.length} completed images were preserved; review them or generate replacements.`
        : record.warning || "";
    }
    try {
      const directory = resolveInside(datasetsRoot, String(record.id));
      const review = loadReview(directory, record);
      saveReview(directory, review);
    } catch { /* review can be rebuilt later */ }
  } else {
    record.status = options?.stopped ? "cancelled" : "failed";
    record.phase = options?.stopped ? "Stopped before any images finished" : "No images completed";
    record.error = options?.stopped
      ? DATASET_STOP_ERROR
      : `${failureCount || record.promptIds.length} dataset images failed.`;
  }
  record.durationMs = Date.now() - (record.started || Date.now());
}

function stopDatasetMonitor(datasetId: string) {
  activeDatasetMonitors.delete(datasetId);
}

async function cancelDatasetComfyJobs(record: any) {
  record.completedPromptIds ||= [];
  record.failedPromptIds ||= [];
  record.promptErrors ||= {};
  const remaining = (record.promptIds || []).filter(
    (id: string) => !record.completedPromptIds.includes(id) && !record.failedPromptIds.includes(id)
  );
  for (const promptId of remaining) {
    try { await comfy().deleteQueued(promptId); } catch { /* may already be gone or running */ }
    if (!record.failedPromptIds.includes(promptId)) {
      record.failedPromptIds.push(promptId);
      record.promptErrors[promptId] = DATASET_STOP_ERROR;
    }
  }
  try { await comfy().interrupt(); } catch { /* idle is fine */ }
  return remaining.length;
}

function monitorDataset(record: any) {
  if (activeDatasetMonitors.has(record.id)) return;
  activeDatasetMonitors.add(record.id);
  let checking = false;
  let reconnectAttempts = 0;
  const stop = () => {
    clearInterval(timer);
    stopDatasetMonitor(record.id);
  };
  const timer = setInterval(async () => {
    if (checking) return;
    // Terminal or user-stop: never overwrite completed/cancelled/failed records.
    if (["cancelled", "completed", "failed"].includes(String(record.status)) || record._stopRequested) {
      stop();
      return;
    }
    checking = true;
    try {
      record.completedPromptIds ||= [];
      record.failedPromptIds ||= [];
      record.promptErrors ||= {};
      record.captionByImage ||= {};
      let reachedComfy = false;
      for (let index = 0; index < record.promptIds.length; index++) {
        if (record._stopRequested || ["cancelled", "completed", "failed"].includes(String(record.status))) break;
        const promptId = record.promptIds[index];
        if (record.completedPromptIds.includes(promptId) || record.failedPromptIds.includes(promptId)) continue;
        const response: any = await comfy().history(promptId);
        reachedComfy = true;
        const history = response[promptId];
        if (!history) continue;
        if (history.status?.status_str === "error") {
          const message = history.status?.messages?.find((item: any[]) => item[0] === "execution_error")?.[1]?.exception_message || "ComfyUI reported an image-generation error.";
          record.failedPromptIds.push(promptId);
          record.promptErrors[promptId] = message;
          continue;
        }
        if (!history.status?.completed) continue;
        const media = Object.values(history.outputs || {}).flatMap((output: any) => output.images || []);
        const image = media.find((item: any) => item.filename);
        if (!image) {
          record.failedPromptIds.push(promptId);
          record.promptErrors[promptId] = `Image ${index + 1} completed without an output file.`;
          continue;
        }
        const source = safeOutputPath(settings.outputDirectory, image.filename, image.subfolder || "");
        const name = `${String(index + 1).padStart(3, "0")}${path.extname(image.filename).toLowerCase() || ".png"}`;
        const imageDirectory = resolveInside(datasetsRoot, String(record.id), "images");
        fs.mkdirSync(imageDirectory, { recursive: true });
        const target = resolveInside(imageDirectory, name);
        if (!fs.existsSync(target)) fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        // Opt-in cleanup of the raw ComfyUI output once it's safely copied into the dataset folder.
        if (settings.pruneRawDatasetOutputs) try { fs.unlinkSync(source); } catch {}
        const caption = datasetCaptionForPrompt(record, index);
        fs.writeFileSync(resolveInside(imageDirectory, `${String(index + 1).padStart(3, "0")}.txt`), caption, "utf8");
        // Embed model + LoRA metadata into dataset PNG (same stack as master / generation).
        try {
          const plannedSeed = record.promptPlan?.find((item: any) => item.index === index)?.seed;
          embedCivitaiMetadataForDatasetImage(record, target, caption, plannedSeed);
          // Also stamp the raw Comfy output when still present.
          if (fs.existsSync(source)) embedCivitaiMetadataForDatasetImage(record, source, caption, plannedSeed);
        } catch (error) {
          recentErrors.unshift(`Dataset metadata (${name}): ${simplify(error)}`);
        }
        if (!record.images.includes(name)) record.images.push(name);
        record.captionByImage[name] = caption;
        record.completedPromptIds.push(promptId);
      }
      if (record._stopRequested) {
        stop();
        return;
      }
      if (reachedComfy) {
        reconnectAttempts = 0;
        record.status = "active";
        record.error = undefined;
        record.phase = record.datasetMode === "instagram-ugc"
          ? "Generating Instagram UGC views"
          : "Generating consistent character views";
      }
      const terminalCount = record.completedPromptIds.length + record.failedPromptIds.length;
      record.progress = Math.round((terminalCount / record.promptIds.length) * 100);
      if (terminalCount === record.promptIds.length) {
        finalizeDatasetRecord(record);
        stop();
      }
      persistDatasets();
      broadcast({ type: "dataset", record });
    } catch (error) {
      if (record._stopRequested) {
        stop();
        return;
      }
      reconnectAttempts++;
      record.status = "paused";
      record.phase = "Waiting for the local image engine";
      record.error = simplify(error);
      persistDatasets();
      broadcast({ type: "dataset", record });
    } finally { checking = false; }
  }, 3_000);
}
function monitorTraining(record: any, clientId: string) {
  const socket = comfy().socket(clientId);
  socket.on("message", async raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "executing" && msg.data?.prompt_id === record.promptId) {
        record.status = msg.data.node === null ? "completed" : "active";
        record.currentNode = msg.data.node;
        if (msg.data.node === null) {
          const outputFolder = path.join(settings.outputDirectory, "lora-training", record.id);
          const trained = fs.existsSync(outputFolder)
            ? fs.readdirSync(outputFolder).filter(name => name.endsWith(".safetensors")).map(name => path.join(outputFolder, name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
            : undefined;
          if (!trained) throw new Error("Training completed but the LoRA weights were not found.");
          const installed = path.join(root, "lora", record.installedName);
          fs.copyFileSync(trained, installed, fs.constants.COPYFILE_EXCL);
          record.outputFile = trained;
          record.installedPath = installed;
          record.durationMs = Date.now() - record.started;
          record.progress = 100;
          socket.close();
        }
        persistTraining();
        broadcast({ type: "training", record });
      } else if (msg.type === "progress" && msg.data) {
        record.progress = Math.round((msg.data.value / msg.data.max) * 100);
        persistTraining();
        broadcast({ type: "training", record });
      } else if (msg.type === "execution_error" && msg.data?.prompt_id === record.promptId) {
        record.status = "failed";
        record.error = msg.data.exception_message || "LoRA training failed";
        persistTraining();
        broadcast({ type: "training", record });
        socket.close();
      }
    } catch (error) {
      record.status = "failed";
      record.error = simplify(error);
      persistTraining();
      broadcast({ type: "training", record });
      socket.close();
    }
  });
  socket.on("error", error => { recentErrors.unshift(error.message); });
}
function broadcast(data: unknown) { const text = JSON.stringify(data); for (const c of clients) if (c.readyState === 1) c.send(text); }

async function probeMedia(file: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", file
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
async function validateUploadedMedia(file: Express.Multer.File) {
  const extension = path.extname(file.filename).toLowerCase();
  const probe = await probeMedia(file.path).catch(() => { throw new Error(`${file.originalname} is not valid decodable media.`); });
  const stream = probe.streams?.find((item: any) => item.codec_type === "video");
  if (!stream?.width || !stream?.height) throw new Error(`${file.originalname} does not contain decodable visual media.`);
  if ((imageExtensions.has(extension) && file.size > 25 * 1024 * 1024) || (videoExtensions.has(extension) && file.size > 512 * 1024 * 1024)) {
    throw new Error(`${file.originalname} exceeds the upload size limit.`);
  }
}
function estimateFrames(probe: any) {
  const stream = probe.streams?.find((item: any) => item.codec_type === "video") || {};
  const exact = Number(stream.nb_frames);
  if (Number.isFinite(exact) && exact > 0) return exact;
  const [top, bottom] = String(stream.avg_frame_rate || "0/1").split("/").map(Number);
  const fps = bottom ? top / bottom : 0;
  return Math.max(0, Math.floor(Number(probe.format?.duration || stream.duration || 0) * fps));
}
function getDiskFreeBytes(target: string) {
  try {
    const stats = fs.statfsSync(target);
    return stats.bavail * stats.bsize;
  } catch { return 0; }
}

const dist = path.join(root, "app/dist");
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get("*splat", (_q, r) => r.sendFile(path.join(dist, "index.html"))); }
const server = app.listen(Number(process.env.PORT || 3199), process.env.HOST || "127.0.0.1", () => console.log("Z-Image Studio: http://127.0.0.1:3199"));
const wss = new WebSocketServer({ server, path: "/events" });
wss.on("connection", ws => { clients.add(ws); ws.on("close", () => clients.delete(ws)); });
for (const record of datasetRecords.filter(item => ["pending", "active", "paused"].includes(item.status))) {
  monitorDataset(record);
}
for (const record of records.filter(item => ["pending", "active"].includes(String(item.status)))) {
  const persistedOutcome = persistedGenerationOutcome(record);
  if (persistedOutcome) finishGeneration(record, persistedOutcome);
  else monitorHistory(record);
}
// One-shot orphan sweep after boot once Comfy is reachable (ghost pendings from prior sessions).
void (async () => {
  try {
    const queue: any = await comfy().queue();
    const inQueue = promptIdsInComfyQueue(queue);
    for (const record of records.filter(item => ["pending", "active"].includes(String(item.status)))) {
      const promptId = String(record.promptId || "");
      if (!promptId || inQueue.has(promptId)) continue;
      let historyHasTerminal = false;
      try {
        const history: any = await comfy().history(promptId);
        historyHasTerminal = Boolean(generationOutcome(history, promptId));
      } catch { continue; }
      if (historyHasTerminal) continue;
      const orphan = orphanGenerationOutcome(record, {
        historyHasTerminal: false,
        inComfyQueue: false,
        orphanAfterMs: 0 // after restart, any non-running ghost is already past the grace window
      });
      if (orphan) {
        stopHistoryMonitor(promptId);
        finishGeneration(record, orphan);
      }
    }
  } catch {
    // Comfy offline at boot — live monitors still attach and will orphan later.
  }
})();
