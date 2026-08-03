import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { resolveInside, writeJsonAtomic } from "./file-utils.js";

export const reviewStateSchema = z.enum(["keep", "reject", "uncertain"]);
export const warningTagSchema = z.enum([
  "face-drift", "bad-hands", "anatomy", "text-watermark",
  "incorrect-identity", "blur", "poor-crop", "low-resolution",
  "exact-duplicate", "near-duplicate"
]);

export const structuredCaptionSchema = z.object({
  triggerToken: z.string().max(100).default(""),
  stableIdentity: z.string().max(600).default(""),
  expression: z.string().max(160).default(""),
  pose: z.string().max(240).default(""),
  cameraFraming: z.string().max(160).default(""),
  cameraAngle: z.string().max(160).default(""),
  clothing: z.string().max(240).default(""),
  background: z.string().max(240).default(""),
  lighting: z.string().max(160).default(""),
  style: z.string().max(200).default(""),
  customText: z.string().max(1200).default("")
});

export type StructuredCaption = z.infer<typeof structuredCaptionSchema>;
export type ReviewState = z.infer<typeof reviewStateSchema>;
export type WarningTag = z.infer<typeof warningTagSchema>;

export type ReviewItem = {
  image: string;
  state: ReviewState;
  warningTags: WarningTag[];
  caption: StructuredCaption;
  renderedCaption: string;
  analysis?: { width: number; height: number; exactHash: string; perceptualHash: string; blurScore: number };
};

export type DatasetReview = {
  version: 1;
  datasetId: string;
  captionStrategy?: string;
  updatedAt: string;
  items: ReviewItem[];
};

export function renderStructuredCaption(value: StructuredCaption, strategy = "flexible-character") {
  const fields = strategy === "custom"
    ? [value.triggerToken, value.customText]
    : strategy === "identity-focused"
      ? [value.triggerToken, value.stableIdentity, value.expression, value.pose, value.cameraFraming, value.cameraAngle, value.customText]
      : strategy === "style"
        ? [value.triggerToken, value.style, value.lighting, value.cameraFraming, value.customText]
        : [
    value.triggerToken, value.stableIdentity, value.expression, value.pose,
    value.cameraFraming, value.cameraAngle, value.clothing, value.background,
    value.lighting, value.style, value.customText
  ];
  return fields.map(part => part.trim()).filter(Boolean).join(", ");
}

export function createReview(datasetId: string, images: string[], captions: string[], trigger = "", captionStrategy = "flexible-character"): DatasetReview {
  return {
    version: 1, datasetId, captionStrategy, updatedAt: new Date().toISOString(),
    items: images.map((image, index) => {
      const original = captions[index] || "";
      const customText = trigger && original.toLowerCase().startsWith(`${trigger.toLowerCase()},`)
        ? original.slice(trigger.length + 1).trim()
        : original;
      const caption = structuredCaptionSchema.parse({ triggerToken: trigger, customText });
      return { image, state: "uncertain", warningTags: [], caption, renderedCaption: renderStructuredCaption(caption, captionStrategy) };
    })
  };
}

export function loadReview(datasetDirectory: string, dataset: { id: string; images: string[]; captions: string[]; captionByImage?: Record<string, string>; trigger?: string; captionStrategy?: string; promptPlan?: Array<{ tags?: Record<string, string> }> }) {
  const file = path.join(datasetDirectory, "review.json");
  if (!fs.existsSync(file)) return createReview(dataset.id, dataset.images || [], dataset.captions || [], dataset.trigger, dataset.captionStrategy);
  const review = JSON.parse(fs.readFileSync(file, "utf8")) as DatasetReview;
  review.captionStrategy ||= dataset.captionStrategy || "flexible-character";
  for (const image of dataset.images || []) {
    if (!review.items.some(item => item.image === image)) {
      const index = dataset.images.indexOf(image);
      review.items.push(createReview(dataset.id, [image], [dataset.captionByImage?.[image] || dataset.captions?.[index] || ""], dataset.trigger, review.captionStrategy).items[0]);
    }
  }
  review.items.forEach((item, index) => {
    const generatedNumber = /^(\d+)\.[^.]+$/i.exec(item.image)?.[1];
    const promptIndex = generatedNumber ? Number(generatedNumber) - 1 : index;
    const tags = dataset.promptPlan?.[promptIndex]?.tags;
    if (!tags) return;
    if (!item.caption.expression) item.caption.expression = tags.expression || "";
    if (!item.caption.pose) item.caption.pose = tags.pose || "";
    if (!item.caption.cameraFraming) item.caption.cameraFraming = tags.framing || "";
    if (!item.caption.cameraAngle) item.caption.cameraAngle = tags.angle || "";
    if (!item.caption.clothing) item.caption.clothing = tags.outfit || "";
    if (!item.caption.background) item.caption.background = `${tags.scene || ""}${tags.background ? `, ${tags.background}` : ""}`;
    if (!item.caption.lighting) item.caption.lighting = tags.lighting || "";
    item.renderedCaption = renderStructuredCaption(item.caption, review.captionStrategy);
  });
  return review;
}

export function saveReview(datasetDirectory: string, review: DatasetReview) {
  review.updatedAt = new Date().toISOString();
  fs.mkdirSync(datasetDirectory, { recursive: true });
  writeJsonAtomic(resolveInside(datasetDirectory, "review.json"), review);
}

export function updateReviewItem(review: DatasetReview, image: string, body: unknown) {
  const schema = z.object({
    state: reviewStateSchema.optional(),
    warningTags: z.array(warningTagSchema).max(10).optional(),
    caption: structuredCaptionSchema.optional()
  });
  const update = schema.parse(body);
  const item = review.items.find(candidate => candidate.image === image);
  if (!item) throw new Error("Dataset image was not found.");
  if (update.state) item.state = update.state;
  if (update.warningTags) item.warningTags = [...new Set(update.warningTags)];
  if (update.caption) {
    item.caption = update.caption;
    item.renderedCaption = renderStructuredCaption(update.caption, review.captionStrategy);
  }
  return item;
}

export function removeReviewItem(review: DatasetReview, image: string) {
  const index = review.items.findIndex(candidate => candidate.image === image);
  if (index < 0) throw new Error("Dataset image was not found.");
  return review.items.splice(index, 1)[0];
}

function hamming(a: string, b: string) {
  let distance = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const value = parseInt(a[index], 16) ^ parseInt(b[index], 16);
    distance += value.toString(2).split("1").length - 1;
  }
  return distance + Math.abs(a.length - b.length) * 4;
}

async function inspectImage(file: string) {
  const bytes = fs.readFileSync(file);
  const image = sharp(bytes);
  const metadata = await image.metadata();
  const { data, info } = await image.clone().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let row = 0; row < info.height; row++) for (let column = 0; column < 8; column++) {
    bits += data[row * info.width + column] > data[row * info.width + column + 1] ? "1" : "0";
  }
  let perceptualHash = "";
  for (let index = 0; index < bits.length; index += 4) perceptualHash += parseInt(bits.slice(index, index + 4), 2).toString(16);
  const { data: sample, info: sampleInfo } = await image.clone().greyscale().resize(128, 128, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let sum = 0, sumSquares = 0, count = 0;
  const width = sampleInfo.width, height = sampleInfo.height;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const laplacian = 4 * sample[i] - sample[i - 1] - sample[i + 1] - sample[i - width] - sample[i + width];
    sum += laplacian; sumSquares += laplacian * laplacian; count++;
  }
  const blurScore = count ? sumSquares / count - (sum / count) ** 2 : 0;
  return {
    width: metadata.width || 0, height: metadata.height || 0,
    exactHash: crypto.createHash("sha256").update(bytes).digest("hex"),
    perceptualHash, blurScore: Math.round(blurScore * 10) / 10
  };
}

export async function analyzeReview(datasetDirectory: string, review: DatasetReview) {
  for (const item of review.items) {
    const file = path.join(datasetDirectory, "images", path.basename(item.image));
    item.analysis = await inspectImage(file);
    item.warningTags = item.warningTags.filter(tag => !["blur", "low-resolution", "exact-duplicate", "near-duplicate"].includes(tag));
    if (Math.min(item.analysis.width, item.analysis.height) < 512) item.warningTags.push("low-resolution");
    if (item.analysis.blurScore < 45) item.warningTags.push("blur");
  }
  for (let index = 0; index < review.items.length; index++) for (let other = 0; other < index; other++) {
    const current = review.items[index], previous = review.items[other];
    if (!current.analysis || !previous.analysis) continue;
    if (current.analysis.exactHash === previous.analysis.exactHash) current.warningTags.push("exact-duplicate");
    else if (hamming(current.analysis.perceptualHash, previous.analysis.perceptualHash) <= 7) current.warningTags.push("near-duplicate");
  }
  review.items.forEach(item => item.warningTags = [...new Set(item.warningTags)]);
  return review;
}

export function exportReviewedDataset(datasetDirectory: string, review: DatasetReview, source: Record<string, unknown>) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const exportDirectory = path.join(datasetDirectory, "exports", stamp);
  const imageDirectory = path.join(exportDirectory, "images");
  fs.mkdirSync(imageDirectory, { recursive: true });
  const accepted = review.items.filter(item => item.state === "keep");
  const validationCount = accepted.length >= 5 ? Math.max(1, Math.round(accepted.length * 0.1)) : 0;
  const buckets: Record<string, number> = {};
  const entries = accepted.map((item, index) => {
    const sourceImage = path.join(datasetDirectory, "images", path.basename(item.image));
    const targetImage = path.join(imageDirectory, path.basename(item.image));
    fs.copyFileSync(sourceImage, targetImage);
    fs.writeFileSync(path.join(imageDirectory, `${path.parse(item.image).name}.txt`), item.renderedCaption, "utf8");
    const bucket = item.analysis ? `${item.analysis.width}x${item.analysis.height}` : "unknown";
    buckets[bucket] = (buckets[bucket] || 0) + 1;
    return { image: item.image, caption: item.renderedCaption, split: index >= accepted.length - validationCount ? "validation" : "train", bucket, warningTags: item.warningTags };
  });
  const manifest = {
    version: 2, exportedAt: new Date().toISOString(), datasetId: review.datasetId,
    source, summary: { accepted: entries.length, rejected: review.items.filter(item => item.state === "reject").length, uncertain: review.items.filter(item => item.state === "uncertain").length, buckets },
    trainerConfig: {
      version: 1,
      captionStrategy: source.captionStrategy || "flexible-character",
      resolution: source.width && source.height ? `${source.width}x${source.height}` : "source",
      aspectRatioBuckets: true,
      trainValidationRatio: validationCount ? "90/10" : "train only"
    },
    images: entries,
    rejected: review.items.filter(item => item.state === "reject").map(item => ({ image: item.image, warningTags: item.warningTags })),
    uncertain: review.items.filter(item => item.state === "uncertain").map(item => ({ image: item.image, warningTags: item.warningTags }))
  };
  writeJsonAtomic(resolveInside(exportDirectory, "manifest.json"), manifest);
  return { exportDirectory, manifest };
}
