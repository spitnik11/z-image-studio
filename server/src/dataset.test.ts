import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  composeInstagramDatasetCaption,
  datasetCaptionForPrompt,
  datasetExtensionSchema,
  datasetIdentityReferenceStrength,
  datasetPrompts,
  datasetSchema,
  DEFAULT_INSTAGRAM_UGC_NEGATIVE,
  DEFAULT_POSE_SEQUENCE,
  DEFAULT_STANDARD_DATASET_NEGATIVE,
  getInstagramUgcShotCount,
  getInstagramUgcShots,
  resolveDatasetLoraHints,
  resolveDatasetNegativePrompt,
  resolveMasterIdentityStrength
} from "./dataset.js";

const projectRoot = path.resolve(process.cwd(), "..");

describe("Dataset Builder", () => {
  it("creates forty deterministic labelled character views", () => {
    const input = datasetSchema.parse({
      name: "Character Set", trigger: "photo of zperson", model: "krea2Turbo.safetensors",
      basePrompt: "same woman with red hair", count: 40, width: 512, height: 768, seed: 100
    });
    const prompts = datasetPrompts(input);
    expect(prompts).toHaveLength(40);
    expect(prompts[0].seed).toBe(100);
    expect(prompts[39].seed).toBe(139);
    expect(prompts.some(item => item.caption.includes("close-up"))).toBe(true);
    expect(prompts.some(item => item.caption.includes("full-body"))).toBe(true);
    expect(prompts.every(item => item.caption.includes("photo of zperson"))).toBe(true);
    expect(prompts[0].tags.angle).toBe("eye-level front");
    expect(new Set(prompts.map(item => item.tags.framing)).size).toBeGreaterThan(2);
    expect(new Set(prompts.map(item => item.tags.pose)).size).toBe(40);
    expect(prompts[39].tags.pose).not.toBe(prompts[0].tags.pose);
    expect(new Set(prompts.map(item => `${item.tags.pose}|${item.tags.angle}|${item.tags.framing}|${item.tags.lighting}`)).size).toBe(40);
  });
  it("continues the directed shot sequence when a dataset is extended", () => {
    const original = datasetSchema.parse({
      name: "Continued Set", trigger: "zperson", model: "krea2.safetensors",
      basePrompt: "same character", count: 12, width: 512, height: 768, seed: 100
    });
    const first = datasetPrompts(original);
    const more = datasetPrompts({ ...original, count: 5, seed: 112, variationOffset: 12 });
    expect(more[0].variationSlot).toBe(12);
    expect(more[0].tags.pose).not.toBe(first[0].tags.pose);
    expect(more[0].tags.pose).toBe(DEFAULT_POSE_SEQUENCE[12]);
    const afterForty = datasetPrompts({ ...original, count: 1, seed: 140, variationOffset: 40 });
    expect(afterForty[0].variationSlot).toBe(40);
    expect(afterForty[0].caption).toContain("alternate variation pass");
  });
  it("uses the selected prompt matrix and records its tags", () => {
    const input = datasetSchema.parse({
      name: "Focused Set", trigger: "zperson", model: "krea2.safetensors",
      basePrompt: "same character", count: 12, width: 512, height: 768, seed: 1,
      promptMatrix: {
        angles: ["profile"], framings: ["full-body"], expressions: ["angry"],
        poses: ["walking"], scenes: ["outdoor"], lighting: ["backlit"],
        varyOutfits: false, varyBackgrounds: false
      }
    });
    const prompts = datasetPrompts(input);
    expect(prompts.every(item => item.tags.angle === "profile" && item.tags.pose === "walking")).toBe(true);
    expect(prompts[0].caption).toContain("consistent outfit");
    expect(prompts[0].caption).toContain("simple uncluttered background");
  });
  it("adds deliberate character adjustments to every generated caption", () => {
    const input = datasetSchema.parse({
      name: "Adjusted Set", trigger: "zperson", model: "krea2.safetensors",
      basePrompt: "same adult character", count: 12, width: 512, height: 768, seed: 10,
      characterAdjustments: {
        hair: "copper-red shoulder-length hair",
        body: "tall athletic build",
        other: "faint freckles"
      }
    });
    const prompts = datasetPrompts(input);
    expect(prompts.every(item => item.caption.includes("intentional hair adjustment: copper-red shoulder-length hair"))).toBe(true);
    expect(prompts.every(item => item.caption.includes("intentional body proportion adjustment: tall athletic build"))).toBe(true);
    expect(prompts.every(item => item.caption.includes("intentional character adjustment: faint freckles"))).toBe(true);
  });
  it("accepts one to forty additional images for an existing dataset", () => {
    expect(datasetExtensionSchema.parse({ count: 1 }).count).toBe(1);
    expect(datasetExtensionSchema.parse({ count: 40 }).count).toBe(40);
    expect(() => datasetExtensionSchema.parse({ count: 41 })).toThrow();
  });
  it("builds Instagram UGC mode from the editable 40-prompt JSON list in order", () => {
    const shots = getInstagramUgcShots(projectRoot);
    expect(getInstagramUgcShotCount(projectRoot)).toBe(40);
    expect(shots[0]).toMatch(/Casual amateur phone snapshot/i);
    expect(shots[0]).toMatch(/lili doe/i);
    expect(shots[0]).toMatch(/dolphin shorts/i);
    expect(shots[0]).toMatch(/streamer room/i);
    expect(shots[39]).toMatch(/dolphin shorts/i);
    expect(shots[39]).toMatch(/mischievous smirk/i);
    const liliDesc =
      "lili doe, a young woman in her early twenties with the soft freckled doe-eyed look of a Belle Delphine-inspired Instagram model, large brown doe eyes, soft pouty lips, delicate freckles across pale cheeks and nose, long soft dark brown curly hair falling in loose waves over her shoulders and down her back, slender waist, large perfectly rounded curvy ass, C-cup breasts, natural skin texture with visible pores and freckles, playful teasing expression that shifts between innocent “hi” smiles and subtle flirty pouts";
    const input = datasetSchema.parse({
      name: "IG UGC Set", trigger: "lili doe", model: "krea2Turbo.safetensors",
      basePrompt: liliDesc, count: 40, width: 512, height: 768, seed: 10,
      datasetMode: "instagram-ugc", promptOrder: "sequential", projectRoot
    });
    const prompts = datasetPrompts(input);
    expect(prompts).toHaveLength(40);
    // One unique full prompt per image, sequential list indices 0..39
    expect(prompts.map(p => p.listIndex)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(new Set(prompts.map(p => p.caption)).size).toBe(40);
    expect(prompts[0].caption).toMatch(/dolphin shorts/i);
    expect(prompts[0].caption).toMatch(/Casual amateur phone snapshot/i);
    expect((prompts[0].tags as Record<string, string>).mode).toBe("instagram-ugc");
    expect((prompts[0].tags as Record<string, string>).order).toBe("sequential");
    // v6 streamer list uses angle language (low/high/Dutch) more than classic close-up/full-body labels
    expect(prompts.every(item => item.tags.mode === "instagram-ugc")).toBe(true);
    expect(prompts.some(item => /low angle|high angle|overhead|Dutch/i.test(item.caption))).toBe(true);
    expect(prompts.some(item => /full frontal|standing full|standing with/i.test(item.caption))).toBe(true);

    // Structure: first half = list prompt, second half = character features
    for (const item of prompts) {
      const caption = item.caption;
      const marker = "character features:";
      expect(caption.includes(marker)).toBe(true);
      const [listPart, characterPart] = caption.split(marker);
      expect(listPart.toLowerCase()).toContain("casual amateur phone snapshot");
      expect(characterPart.toLowerCase()).toContain("lili doe");
      expect(characterPart.toLowerCase()).toContain("c-cup");
      expect(characterPart.toLowerCase()).toContain("curvy ass");
      // List half comes first
      expect(caption.indexOf("Casual amateur")).toBeLessThan(caption.indexOf(marker));
      // Character half is after the list prompt
      expect(caption.indexOf(marker)).toBeGreaterThan(listPart.length - 1);
    }
    // Different shots still share the same character half
    expect(prompts[0].characterHalf).toBe(prompts[15].characterHalf);
    expect(prompts[0].listHalf).not.toBe(prompts[15].listHalf);
  });
  it("continues Instagram list slots when a UGC dataset is extended", () => {
    const shots = getInstagramUgcShots(projectRoot);
    const base = datasetSchema.parse({
      name: "IG Extend", trigger: "lili doe", model: "krea2.safetensors",
      basePrompt: "same woman", count: 12, width: 512, height: 768, seed: 5,
      datasetMode: "instagram-ugc", promptOrder: "sequential", projectRoot
    });
    const first = datasetPrompts(base);
    const more = datasetPrompts({ ...base, count: 3, seed: 17, variationOffset: 12 });
    expect(more[0].variationSlot).toBe(12);
    expect(more[0].listIndex).toBe(12);
    expect(more[0].caption).toContain(shots[12].slice(0, 40));
    expect(more[0].listIndex).not.toBe(first[0].listIndex);
    const wrap = datasetPrompts({ ...base, count: 1, seed: 45, variationOffset: 40 });
    expect(wrap[0].variationSlot).toBe(40);
    expect(wrap[0].listIndex).toBe(0);
    expect(wrap[0].caption).toContain("alternate Instagram pass");
  });
  it("keeps prompt captions aligned after a generated image is deleted", () => {
    const record = {
      captions: ["first", "second"],
      promptPlan: [
        { index: 0, caption: "planned first" },
        { index: 1, caption: "planned second" },
        { index: 2, caption: "recovery caption" }
      ],
      trigger: "zperson"
    };
    record.captions.splice(0, 1);
    expect(datasetCaptionForPrompt(record, 2)).toBe("recovery caption");
    expect(typeof datasetCaptionForPrompt({ captions: [], trigger: "zperson" }, 9)).toBe("string");
  });
  it("resolves clothing-aware Instagram negatives and allows custom overrides", () => {
    expect(resolveDatasetNegativePrompt("instagram-ugc")).toBe(DEFAULT_INSTAGRAM_UGC_NEGATIVE);
    expect(resolveDatasetNegativePrompt("instagram-ugc")).toMatch(/nude/i);
    expect(resolveDatasetNegativePrompt("instagram-ugc")).toMatch(/see-through/i);
    expect(resolveDatasetNegativePrompt("standard")).toBe(DEFAULT_STANDARD_DATASET_NEGATIVE);
    expect(resolveDatasetNegativePrompt("instagram-ugc", "  custom only  ")).toBe("custom only");
    expect(resolveDatasetNegativePrompt("standard", "")).toBe(DEFAULT_STANDARD_DATASET_NEGATIVE);
  });

  it("treats form LoRA list as authoritative so removals and strengths stick", () => {
    const master = [
      { name: "SBBT_B_e46.safetensors", strength: 0.9 },
      { name: "Cutifier.safetensors", strength: 0.75 },
      { name: "Krea2_TextFusion_Refusal_Reduction.safetensors", strength: 1 }
    ];
    // User removed SBBT + Refusal, lowered Cutifier — must not re-inject master LoRAs.
    const form = [{ name: "Cutifier.safetensors", strength: 0.45 }];
    const auth = resolveDatasetLoraHints({ formLoras: form, masterLoras: master, formAuthoritative: true });
    expect(auth.loras).toEqual([{ name: "Cutifier.safetensors", strength: 0.45 }]);
    expect(auth.sources.some(s => /edited stack/i.test(s))).toBe(true);

    const cleared = resolveDatasetLoraHints({ formLoras: [], masterLoras: master, formAuthoritative: true });
    expect(cleared.loras).toEqual([]);

    // Inspect path still seeds from master when form is empty / non-authoritative.
    const inspect = resolveDatasetLoraHints({ formLoras: [], masterLoras: master, formAuthoritative: false });
    expect(inspect.loras).toHaveLength(3);
    const inspectMerge = resolveDatasetLoraHints({
      formLoras: [{ name: "Extra.safetensors", strength: 0.5 }],
      masterLoras: master,
      formAuthoritative: false
    });
    expect(inspectMerge.loras.map(l => l.name)).toContain("Extra.safetensors");
    expect(inspectMerge.loras.map(l => l.name)).toContain("SBBT_B_e46.safetensors");
  });

  it("never mixes a master PNG positive prompt into dataset captions", () => {
    const masterPositive =
      "master only scene with red sports car under neon, unique_master_token_xyz, cyberpunk alley";
    const listPrompt =
      "Raw photo, grainy iPhone, mirror selfie in bedroom, black bikini top fully covering, no nudity";
    const character = "lili doe, freckles, long curly brown hair, C-cup, playful expression";
    const { caption, listHalf, characterHalf } = composeInstagramDatasetCaption({
      listPrompt,
      characterFeatures: character,
      trigger: "lili doe"
    });
    expect(caption).not.toContain("unique_master_token_xyz");
    expect(caption).not.toContain("red sports car");
    expect(caption).not.toContain(masterPositive);
    expect(listHalf).toContain("mirror selfie");
    expect(characterHalf).toContain("character features:");
    expect(characterHalf).toContain("freckles");
    // Identity ref for IG is lower than legacy 1.15 so list pose/outfit can win
    expect(datasetIdentityReferenceStrength("krea2", "instagram-ugc")).toBeLessThan(1);
    expect(datasetIdentityReferenceStrength("krea2", "instagram-ugc")).toBe(0.72);
    expect(datasetIdentityReferenceStrength("krea2", "standard")).toBe(0.85);
    expect(datasetIdentityReferenceStrength("z-image", "instagram-ugc")).toBe(0.55);
  });

  it("resolves editable master identity strength with defaults and clamps", () => {
    expect(resolveMasterIdentityStrength("krea2", "instagram-ugc")).toBe(0.72);
    expect(resolveMasterIdentityStrength("krea2", "instagram-ugc", 0.4)).toBe(0.4);
    expect(resolveMasterIdentityStrength("krea2", "standard", 1.2)).toBe(1.2);
    expect(resolveMasterIdentityStrength("z-image", "standard", 0)).toBe(0);
    expect(resolveMasterIdentityStrength("krea2", "instagram-ugc", 3)).toBe(2);
    expect(resolveMasterIdentityStrength("krea2", "instagram-ugc", -1)).toBe(0);
    expect(resolveMasterIdentityStrength("illustrious", "standard", undefined)).toBe(0.65);
    // Schema accepts explicit strength
    const parsed = datasetSchema.parse({
      name: "Strength Set",
      trigger: "zperson",
      model: "krea2.safetensors",
      basePrompt: "same character",
      masterIdentityStrength: 0.35
    });
    expect(parsed.masterIdentityStrength).toBe(0.35);
  });
});
