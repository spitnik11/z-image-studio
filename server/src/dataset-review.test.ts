import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeReview, createReview, exportReviewedDataset, loadReview, removeReviewItem, renderStructuredCaption, saveReview, updateReviewItem } from "./dataset-review.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

describe("dataset review", () => {
  it("renders structured captions and persists review edits", () => {
    const review = createReview("one", ["001.png"], ["red hair"], "zperson");
    updateReviewItem(review, "001.png", { state: "keep", warningTags: ["bad-hands"], caption: { triggerToken: "zperson", pose: "standing", customText: "red hair" } });
    expect(review.items[0].state).toBe("keep");
    expect(review.items[0].renderedCaption).toBe("zperson, standing, red hair");
    expect(renderStructuredCaption(review.items[0].caption)).not.toContain("undefined");
    expect(renderStructuredCaption({ ...review.items[0].caption, clothing: "blue coat" }, "identity-focused")).not.toContain("blue coat");
  });

  it("flags exact duplicates and exports accepted images with splits and captions", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zimage-review-"));
    directories.push(directory);
    fs.mkdirSync(path.join(directory, "images"));
    const image = await sharp({ create: { width: 512, height: 640, channels: 3, background: "#888888" } }).png().toBuffer();
    fs.writeFileSync(path.join(directory, "images", "001.png"), image);
    fs.writeFileSync(path.join(directory, "images", "002.png"), image);
    const review = createReview("one", ["001.png", "002.png"], ["first", "second"], "zperson");
    review.items[0].state = "keep";
    review.items[1].state = "reject";
    await analyzeReview(directory, review);
    expect(review.items[1].warningTags).toContain("exact-duplicate");
    const output = exportReviewedDataset(directory, review, { model: "test.safetensors", captionStrategy: "identity-focused", width: 512, height: 640 });
    expect(output.manifest.summary.accepted).toBe(1);
    expect(output.manifest.summary.rejected).toBe(1);
    expect(output.manifest.trainerConfig.captionStrategy).toBe("identity-focused");
    expect(fs.existsSync(path.join(output.exportDirectory, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(output.exportDirectory, "images", "001.txt"))).toBe(true);
    expect(fs.existsSync(path.join(output.exportDirectory, "images", "002.txt"))).toBe(false);
  });

  it("adds newly imported images to an existing review without losing saved decisions", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zimage-review-add-"));
    directories.push(directory);
    const first = createReview("one", ["001.png"], ["first"], "zperson");
    first.items[0].state = "keep";
    saveReview(directory, first);
    const merged = loadReview(directory, {
      id: "one", images: ["001.png", "added.png"], captions: ["first", "second"],
      trigger: "zperson", captionStrategy: "flexible-character"
    });
    expect(merged.items).toHaveLength(2);
    expect(merged.items[0].state).toBe("keep");
    expect(merged.items[1].state).toBe("uncertain");
    expect(merged.items[1].caption.triggerToken).toBe("zperson");
  });

  it("removes an image from the live review collection", () => {
    const review = createReview("one", ["001.png", "002.png"], ["first", "second"], "zperson");
    const removed = removeReviewItem(review, "001.png");
    expect(removed.image).toBe("001.png");
    expect(review.items.map(item => item.image)).toEqual(["002.png"]);
    expect(() => removeReviewItem(review, "missing.png")).toThrow("Dataset image was not found.");
  });
});
