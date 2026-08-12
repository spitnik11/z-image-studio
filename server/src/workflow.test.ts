import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANIMA_DEFAULT_NEGATIVE, ANIMA_FILES, applyFacePolish, applyImg2ImgLatent, buildAnimaWorkflow, buildConsistentCharacterWorkflow, buildIllustriousWorkflow, buildWorkflow, effectiveImg2ImgDenoise, FACE_POLISH_DETECTOR, FACE_POLISH_DEFAULT_DENOISE, generationSchema, KREA_REFERENCE_FILES, modelArchitecture, safeOutputPath, saveMetadata, structureLockControlStrength, type ApiWorkflow } from "./workflow.js";

const template = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../workflows/z-image-turbo-api.json"), "utf8")) as ApiWorkflow;
const valid = { prompt:"test", negativePrompt:"", width:1024, height:768, seed:42, steps:8, guidance:1, batchSize:1, priority:"normal", outputFormat:"png", sampler:"res_multistep", scheduler:"simple", outputName:"test", diffusionModel:"model.safetensors", textEncoder:"qwen.safetensors", vae:"ae.safetensors", loras:[] };
describe("workflow inputs", () => {
  it("replaces only approved values without mutating the template", () => {
    const w = buildWorkflow(template, valid);
    expect(w["4"].inputs.text).toBe("test"); expect(w["8"].inputs.seed).toBe(42);
    expect(w["2"].inputs.type).toBe("lumina2"); expect(template["4"].inputs.text).not.toBe("test");
  });
  it("rejects out-of-range dimensions", () => {
    expect(() => generationSchema.parse({...valid, width: 100})).toThrow();
    expect(() => generationSchema.parse({...valid, width: 2561})).toThrow();
    expect(generationSchema.parse({...valid, width: 2560, height: 1440}).width).toBe(2560);
  });
  it("accepts zero and maximum safe seeds", () => {
    expect(generationSchema.parse({...valid,seed:0}).seed).toBe(0);
    expect(generationSchema.parse({...valid,seed:Number.MAX_SAFE_INTEGER}).seed).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("outputName allows safe subfolders but blocks path traversal", () => {
    expect(generationSchema.parse({...valid,outputName:"datasets/emily-a1b2c3d4/001"}).outputName).toBe("datasets/emily-a1b2c3d4/001");
    expect(generationSchema.parse({...valid,outputName:"z-image"}).outputName).toBe("z-image");
    for (const bad of ["../evil", "/abs/path", "a/../b", "a\\b", "datasets//001", "trailing/"]) {
      expect(() => generationSchema.parse({...valid, outputName: bad})).toThrow();
    }
  });
  it("chains multiple model-only LoRAs before model sampling", () => {
    const w = buildWorkflow(template, {...valid,loras:[{name:"flat.safetensors",strength:.7},{name:"nice.safetensors",strength:1.1}]});
    expect(w["20"].class_type).toBe("LoraLoaderModelOnly");
    expect(w["20"].inputs.model).toEqual(["1",0]);
    expect(w["21"].inputs.model).toEqual(["20",0]);
    expect(w["7"].inputs.model).toEqual(["21",0]);
  });
  it("switches to native WebP output and preserves exact requested canvas size", () => {
    const w = buildWorkflow(template, {...valid,width:1080,height:1350,outputFormat:"webp"});
    expect(w["11"].inputs.width).toBe(1080);
    expect(w["11"].inputs.height).toBe(1350);
    expect(w["10"].class_type).toBe("SaveAnimatedWEBP");
  });
  it("uses standard VAE decode at normal sizes and tiled decode at the high-resolution threshold", () => {
    expect(buildWorkflow(template, valid)["9"].class_type).toBe("VAEDecode");
    const large = buildWorkflow(template, { ...valid, width: 1080, height: 1920 });
    expect(large["9"]).toMatchObject({
      class_type: "VAEDecodeTiled",
      inputs: { tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 }
    });
  });
  it("uses encoded negative text only when supplied", () => {
    expect(buildWorkflow(template, valid)["8"].inputs.negative).toEqual(["5",0]);
    const w = buildWorkflow(template, {...valid,negativePrompt:"blurry, text"});
    expect(w["12"].inputs.text).toBe("blurry, text");
    expect(w["8"].inputs.negative).toEqual(["12",0]);
  });
  it("builds the native Krea 2 path without changing the Z-Image template", () => {
    const w = buildWorkflow(template, {...valid,diffusionModel:"krea2TurboINT8.safetensors",textEncoder:"qwen3vl_4b_fp8_scaled.safetensors",vae:"qwen_image_vae.safetensors"});
    expect(modelArchitecture("krea2TurboINT8.safetensors")).toBe("krea2");
    expect(w["2"].inputs.type).toBe("krea2");
    expect(w["6"].class_type).toBe("EmptyLatentImage");
    expect(w["8"].inputs.sampler_name).toBe("euler");
    expect(w["8"].inputs.model).toEqual(["1",0]);
    expect(w["7"]).toBeUndefined();
    expect(template["7"].class_type).toBe("ModelSamplingAuraFlow");
  });
  it("generates high-resolution Krea 2 canvases (1530x2048, 2048x2048, QHD 2560x1440) with exact size and tiled decode", () => {
    for (const [width, height] of [[1530, 2048], [2048, 2048], [2560, 1440]] as const) {
      expect(generationSchema.parse({ ...valid, width, height }).width).toBe(width);
      const w = buildWorkflow(template, {
        ...valid, diffusionModel: "krea2TurboINT8.safetensors",
        textEncoder: "qwen3vl_4b_fp8_scaled.safetensors", vae: "qwen_image_vae.safetensors",
        width, height
      });
      expect(w["2"].inputs.type).toBe("krea2");
      expect(w["6"].class_type).toBe("EmptyLatentImage");
      expect(w["6"].inputs.width).toBe(width);
      expect(w["6"].inputs.height).toBe(height);
      expect(w["8"].inputs.sampler_name).toBe("euler");
      expect(w["9"].class_type).toBe("VAEDecodeTiled");     // >2.07 MP → VRAM-safe tiled decode
      expect(w["11"].inputs.width).toBe(width);             // exact requested output after decode
      expect(w["11"].inputs.height).toBe(height);
      expect(w["10"].inputs.images).toEqual(["11", 0]);
    }
    // Max edge is 2560 (QHD width); 2561 is rejected
    expect(() => generationSchema.parse({ ...valid, width: 2561, height: 1440 })).toThrow();
    expect(generationSchema.parse({ ...valid, width: 2560, height: 1440 }).height).toBe(1440);
  });
  it("classifies Anima diffusion filenames and rejects companion TE/VAE names", () => {
    expect(modelArchitecture("anima_baseV10.safetensors")).toBe("anima");
    expect(modelArchitecture("anima-base-v1.0.safetensors")).toBe("anima");
    expect(modelArchitecture(ANIMA_FILES.textEncoder)).toBe("unknown");
    expect(modelArchitecture(ANIMA_FILES.vae)).toBe("unknown");
  });
  it("builds a native Anima split-model graph with model-only LoRAs and default negative", () => {
    const w = buildAnimaWorkflow({
      ...valid,
      diffusionModel: "anima_baseV10.safetensors",
      textEncoder: ANIMA_FILES.textEncoder,
      vae: ANIMA_FILES.vae,
      steps: 30,
      guidance: 4,
      sampler: "euler",
      scheduler: "simple",
      loras: [{ name: "V1.safetensors", strength: 0.8 }]
    });
    expect(w["1"]).toMatchObject({ class_type: "UNETLoader", inputs: { unet_name: "anima_baseV10.safetensors" } });
    expect(w["2"]).toMatchObject({
      class_type: "CLIPLoader",
      inputs: { clip_name: ANIMA_FILES.textEncoder, type: "stable_diffusion" }
    });
    expect(w["3"].inputs.vae_name).toBe(ANIMA_FILES.vae);
    expect(w["6"].class_type).toBe("EmptyLatentImage");
    expect(w["20"]).toMatchObject({
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["1", 0], lora_name: "V1.safetensors", strength_model: 0.8 }
    });
    expect(w["8"].inputs).toMatchObject({
      model: ["20", 0],
      sampler_name: "euler",
      scheduler: "simple",
      steps: 30,
      cfg: 4,
      negative: ["12", 0]
    });
    expect(w["12"].inputs.text).toBe(ANIMA_DEFAULT_NEGATIVE);
    expect(w["7"]).toBeUndefined();
  });
  it("builds Anima pose LLLite reference guidance", () => {
    const w = buildAnimaWorkflow({
      ...valid,
      diffusionModel: "anima_baseV10.safetensors",
      textEncoder: ANIMA_FILES.textEncoder,
      vae: ANIMA_FILES.vae,
      references: [{ image: "z-image-studio/x.png", mode: "pose", strength: 0.8 }]
    });
    expect(w["90"].class_type).toBe("ModelPatchLoader");
    expect(w["102"].class_type).toBe("OpenposePreprocessor");
    expect(w["104"]).toMatchObject({
      class_type: "AnimaLLLiteApply",
      inputs: { strength: 0.8, model_patch: ["90", 0] }
    });
    expect(w["8"].inputs.model).toEqual(["104", 0]);
  });
  it("applies face polish with explicit clip/vae wiring and single final output", () => {
    const w: ApiWorkflow = {
      "8": { class_type: "KSampler", inputs: { positive: ["4", 0], negative: ["5", 0] } },
      "9": { class_type: "VAEDecode", inputs: {} },
      "11": { class_type: "ImageScale", inputs: { image: ["9", 0] } },
      "10": { class_type: "SaveImage", inputs: { images: ["11", 0] } }
    };
    applyFacePolish(w, {
      image: ["9", 0],
      model: ["1", 0],
      clip: ["30", 0],
      vae: ["1", 2],
      positive: ["4", 0],
      negative: ["5", 0],
      sampler_name: "dpmpp_sde",
      scheduler: "karras",
      steps: 28,
      cfg: 4,
      seed: 7,
      denoise: FACE_POLISH_DEFAULT_DENOISE,
      outputName: "test",
      width: 512,
      height: 768
    });
    expect(w["189"].inputs.model_name).toBe(FACE_POLISH_DETECTOR);
    expect(w["190"]).toMatchObject({
      class_type: "FaceDetailer",
      inputs: { clip: ["30", 0], vae: ["1", 2], model: ["1", 0], denoise: 0.4 }
    });
    // Polish feeds the same ImageScale → SaveImage path as normal gens (no -original branch).
    expect(w["11"].inputs.image).toEqual(["190", 0]);
    expect(w["10"].inputs.images).toEqual(["11", 0]);
    expect(w["192"]).toBeUndefined();
    expect(w["193"]).toBeUndefined();
    expect(w["194"]).toBeUndefined();
  });
  it("wires face polish on Illustrious and Anima when faceRefinement is set", () => {
    const il = buildIllustriousWorkflow({
      ...valid, diffusionModel: "illustriousRealismBy_v10VAE.safetensors",
      textEncoder: "checkpoint", vae: "checkpoint", faceRefinement: true,
      steps: 28, guidance: 4, sampler: "dpmpp_sde", scheduler: "karras"
    });
    expect(il["190"].inputs.clip).toEqual(["30", 0]);
    expect(il["190"].inputs.vae).toEqual(["1", 2]);
    expect(il["11"].inputs.image).toEqual(["190", 0]);
    expect(il["194"]).toBeUndefined();
    const an = buildAnimaWorkflow({
      ...valid, diffusionModel: "anima_baseV10.safetensors",
      textEncoder: ANIMA_FILES.textEncoder, vae: ANIMA_FILES.vae, faceRefinement: true
    });
    expect(an["190"].inputs.clip).toEqual(["2", 0]);
    expect(an["190"].inputs.vae).toEqual(["3", 0]);
    expect(an["11"].inputs.image).toEqual(["190", 0]);
    expect(an["194"]).toBeUndefined();
  });
  it("wires face polish on Z-Image/Krea without requiring Character Consistency", () => {
    const z = buildWorkflow(template, { ...valid, faceRefinement: true });
    expect(z["190"].class_type).toBe("FaceDetailer");
    expect(z["190"].inputs.clip).toEqual(["2", 0]);
    const k = buildWorkflow(template, {
      ...valid, diffusionModel: "krea2TurboINT8.safetensors",
      textEncoder: "qwen3vl_4b_fp8_scaled.safetensors", vae: "qwen_image_vae.safetensors",
      faceRefinement: true, sampler: "euler"
    });
    expect(k["190"].inputs.sampler_name).toBe("euler");
    expect(k["190"].inputs.cfg).toBe(1);
  });
  it("omits FaceDetailer when faceRefinement is false", () => {
    const w = buildWorkflow(template, valid);
    expect(w["190"]).toBeUndefined();
    expect(w["189"]).toBeUndefined();
  });
  it("maps Strength/Noise into denoise with refine cap and gentler noise", () => {
    expect(effectiveImg2ImgDenoise(0.4, 0, "rewrite")).toBe(0.4);
    expect(effectiveImg2ImgDenoise(0.5, 0.5, "rewrite")).toBeCloseTo(0.6);
    expect(effectiveImg2ImgDenoise(0.25, 0.05, "refine")).toBeCloseTo(0.254);
    // Refine hard-caps so pose cannot drift with high sliders
    expect(effectiveImg2ImgDenoise(0.9, 0.5, "refine")).toBe(0.38);
    expect(structureLockControlStrength("refine")).toBeGreaterThan(structureLockControlStrength("rewrite"));
  });
  it("keeps empty latent and denoise 1 for pure txt2img", () => {
    const w = buildWorkflow(template, valid);
    expect(w["6"].class_type).toMatch(/Empty.*Latent/i);
    expect(w["8"].inputs.denoise).toBe(1);
    expect(w["40"]).toBeUndefined();
  });
  it("rejects Improve without a source image when strength is below 1", () => {
    expect(() => generationSchema.parse({ ...valid, img2imgStrength: 0.4 })).toThrow(/source image/i);
  });
  it("wires refine Improve with low denoise and structure lock on all Photo builders", () => {
    const init = "z-image-studio/improve-source.png";
    const z = buildWorkflow(template, {
      ...valid, initImage: init, img2imgStrength: 0.25, img2imgNoise: 0.05,
      img2imgMode: "refine", img2imgLockStructure: true
    });
    expect(z["40"].class_type).toBe("LoadImage");
    expect(z["6"].class_type).toBe("VAEEncode");
    expect(z["8"].inputs.denoise).toBeCloseTo(0.254);
    expect(z["43"].class_type).toBe("Canny");
    expect(z["44"].class_type).toBe("QwenImageDiffsynthControlnet");
    const il = buildIllustriousWorkflow({
      ...valid, diffusionModel: "illustriousRealismBy_v10VAE.safetensors",
      textEncoder: "checkpoint", vae: "checkpoint", steps: 28, guidance: 4,
      sampler: "dpmpp_sde", scheduler: "karras",
      initImage: init, img2imgStrength: 0.25, img2imgNoise: 0.05,
      img2imgMode: "refine", img2imgLockStructure: true
    });
    expect(il["6"].class_type).toBe("VAEEncode");
    expect(il["8"].inputs.denoise).toBeCloseTo(0.254);
    expect(il["43"].class_type).toBe("Canny");
    expect(il["44"].class_type).toBe("ControlNetApplyAdvanced");
    const an = buildAnimaWorkflow({
      ...valid, diffusionModel: "anima_baseV10.safetensors",
      textEncoder: ANIMA_FILES.textEncoder, vae: ANIMA_FILES.vae,
      initImage: init, img2imgStrength: 0.25, img2imgNoise: 0.05,
      img2imgMode: "refine", img2imgLockStructure: true
    });
    expect(an["6"].class_type).toBe("VAEEncode");
    expect(an["44"].class_type).toBe("AnimaLLLiteApply");
    const rewrite = buildWorkflow(template, {
      ...valid, initImage: init, img2imgStrength: 0.5, img2imgNoise: 0.25,
      img2imgMode: "rewrite", img2imgLockStructure: false
    });
    expect(rewrite["8"].inputs.denoise).toBeCloseTo(0.55);
    expect(rewrite["43"]).toBeUndefined();
  });
  it("applyImg2ImgLatent rewrites node 6 without custom nodes", () => {
    const w: ApiWorkflow = {
      "6": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
      "8": { class_type: "KSampler", inputs: { latent_image: ["6", 0], denoise: 1 } }
    };
    applyImg2ImgLatent(w, {
      initImage: "z-image-studio/x.png", vae: ["3", 0], width: 512, height: 768,
      batchSize: 1, strength: 0.3, noise: 0, mode: "refine"
    });
    expect(w["6"].class_type).toBe("VAEEncode");
    expect(w["8"].inputs.denoise).toBe(0.3);
  });
  it("builds Illustrious OpenPose ControlNet reference guidance", () => {
    const w = buildIllustriousWorkflow({
      ...valid,
      diffusionModel: "illustriousRealismBy_v10VAE.safetensors",
      textEncoder: "checkpoint",
      vae: "checkpoint",
      steps: 28,
      guidance: 4,
      sampler: "dpmpp_sde",
      scheduler: "karras",
      references: [{ image: "z-image-studio/pose.png", mode: "pose", strength: 0.85 }]
    });
    expect(w["90"].class_type).toBe("ControlNetLoader");
    expect(w["102"].class_type).toBe("OpenposePreprocessor");
    expect(w["104"]).toMatchObject({
      class_type: "ControlNetApplyAdvanced",
      inputs: { strength: 0.85, positive: ["4", 0], negative: ["5", 0] }
    });
    expect(w["8"].inputs.positive).toEqual(["104", 0]);
    expect(w["8"].inputs.negative).toEqual(["104", 1]);
  });
  it("builds an isolated Illustrious checkpoint graph with full model and CLIP LoRA chaining", () => {
    const w = buildIllustriousWorkflow({
      ...valid, diffusionModel:"illustriousRealismBy_v10VAE.safetensors",
      textEncoder:"checkpoint", vae:"checkpoint", steps:28, guidance:4,
      sampler:"dpmpp_sde", scheduler:"karras",
      loras:[{name:"armbar_V3.safetensors",strength:.8},{name:"Smooth_Booster_v2.safetensors",strength:.35}]
    });
    expect(modelArchitecture("illustriousRealismBy_v10VAE.safetensors")).toBe("illustrious");
    expect(modelArchitecture("autismmixSDXL_autismmixConfetti.safetensors")).toBe("illustrious");
    expect(w["1"].class_type).toBe("CheckpointLoaderSimple");
    expect(w["20"]).toMatchObject({class_type:"LoraLoader",inputs:{model:["1",0],clip:["1",1]}});
    expect(w["21"].inputs).toMatchObject({model:["20",0],clip:["20",1]});
    expect(w["30"].inputs).toEqual({clip:["21",1],stop_at_clip_layer:-2});
    expect(w["4"].class_type).toBe("CLIPTextEncodeSDXL");
    expect(w["8"].inputs).toMatchObject({model:["21",0],sampler_name:"dpmpp_sde",scheduler:"karras"});
    expect(w["9"].inputs.vae).toEqual(["1",2]);
    expect(template["1"].class_type).toBe("UNETLoader");
  });
  it("keeps Remacri in the architecture-neutral post-decode upscale stage", () => {
    const w = buildIllustriousWorkflow({
      ...valid, diffusionModel:"illustriousnxtXLBy_v20.safetensors",
      textEncoder:"checkpoint", vae:"checkpoint", neuralUpscale:true,
      upscaleModel:"remacri_original.safetensors", sampler:"euler_ancestral", scheduler:"sgm_uniform"
    });
    expect(w["300"].inputs.model_name).toBe("remacri_original.safetensors");
    expect(w["301"].inputs.image).toEqual(["9",0]);
    expect(w["11"].inputs.image).toEqual(["301",0]);
  });
  it("builds isolated Krea 2 depth pose guidance", () => {
    const w = buildWorkflow(template, {
      ...valid, diffusionModel:"krea2TurboINT8.safetensors",
      textEncoder:"qwen3vl_4b_fp8_scaled.safetensors", vae:"qwen_image_vae.safetensors",
      references:[{image:"z-image-studio/pose.jpg",mode:"pose",strength:.8}]
    });
    expect(w["182"].class_type).toBe("DepthAnythingV2Preprocessor");
    expect(w["184"].inputs).toMatchObject({lora_name:"depth-control-lora.safetensors",strength:.8});
    expect(w["185"].inputs.model).toEqual(["184",0]);
    expect(w["8"].inputs.model).toEqual(["185",0]);
    expect(w["90"]).toBeUndefined();
  });
  it("builds Krea 2 identity editing with two weighted direct references", () => {
    const w = buildWorkflow(template, {
      ...valid, diffusionModel:"krea2TurboINT8.safetensors",
      textEncoder:"qwen3vl_4b_fp8_scaled.safetensors", vae:"qwen_image_vae.safetensors",
      references:[
        {image:"z-image-studio/scene.jpg",mode:"direct",strength:.6},
        {image:"z-image-studio/person.jpg",mode:"direct",strength:1.2}
      ]
    });
    expect(w["170"].inputs.lora_name).toBe("krea2_identity_edit_v1_2.safetensors");
    expect(w["171"].inputs).toMatchObject({ref_boost:1.2,ref_boost_a:.6,fit_mode:"fit"});
    expect(w["172"].class_type).toBe("Krea2EditGroundedEncode");
    expect(w["8"].inputs.positive).toEqual(["172",0]);
    expect(w["8"].inputs.model).toEqual(["171",0]);
  });
  it("builds opt-in Krea consistency and face refinement without changing the base builder", () => {
    const w = buildConsistentCharacterWorkflow(template, {
      ...generationSchema.parse(valid), diffusionModel:"krea2TurboINT8.safetensors",
      textEncoder:"qwen3vl_4b_fp8_scaled.safetensors", vae:"qwen_image_vae.safetensors",
      characterRefPath:"z-image-studio/master.png", poseRefPath:"z-image-studio/pose.png",
      environmentPrompt:"soft studio light", ipAdapterWeight:.7, controlnetWeight:.8, faceRefinement:true
    });
    expect(w["160"]._meta?.title).toBe("[Identity] Master Reference");
    expect(w["180"]._meta?.title).toBe("[Pose] Target Reference");
    expect(w["189"].class_type).toBe("UltralyticsDetectorProvider");
    expect(w["190"].inputs.denoise).toBe(.4);
    expect(w["11"].inputs.image).toEqual(["190",0]);
    expect(w["194"]).toBeUndefined();
  });
  it("adds one architecture-neutral neural upscale stage after face polish on the single output path", () => {
    const base = buildWorkflow(template, {
      ...valid, diffusionModel:"krea2TurboINT8.safetensors",
      neuralUpscale:true, upscaleModel:"RealESRGAN_x4plus.pth"
    });
    expect(base["300"].inputs.model_name).toBe("RealESRGAN_x4plus.pth");
    expect(base["301"].inputs.image).toEqual(["9",0]);
    expect(base["11"].inputs.image).toEqual(["301",0]);
    const refined = buildConsistentCharacterWorkflow(template, {
      ...generationSchema.parse({...valid,neuralUpscale:true}),
      diffusionModel:"krea2TurboINT8.safetensors",
      characterRefPath:"z-image-studio/master.png", faceRefinement:true
    });
    // polish → neural upscale → exact scale → single SaveImage (no original dual-save)
    expect(refined["301"].inputs.image).toEqual(["190",0]);
    expect(refined["11"].inputs.image).toEqual(["301",0]);
    expect(refined["192"]).toBeUndefined();
    expect(refined["193"]).toBeUndefined();
    expect(refined["194"]).toBeUndefined();
  });
  it("rejects unsupported Krea 2 reference counts", () => {
    const krea = {...valid,diffusionModel:"krea2TurboINT8.safetensors"};
    expect(() => buildWorkflow(template, {...krea,references:[
      {image:"a.jpg",mode:"pose",strength:1},{image:"b.jpg",mode:"pose",strength:1}
    ]})).toThrow(/one Pose/);
    expect(() => buildWorkflow(template, {...krea,references:[
      {image:"a.jpg",mode:"direct",strength:1},{image:"b.jpg",mode:"direct",strength:1},{image:"c.jpg",mode:"direct",strength:1}
    ]})).toThrow(/two Direct/);
  });
  it("normalizes and chains weighted pose and direct references before model sampling", () => {
    const w = buildWorkflow(template, {
      ...valid,
      diffusionModel: "zImageTurbo_turbo.safetensors",
      width: 1080,
      height: 1920,
      references: [
        { image: "z-image-studio/pose.jpg", mode: "pose", strength: 1 },
        { image: "z-image-studio/shape.png", mode: "direct", strength: 0.55 }
      ]
    });
    expect(w["101"].inputs).toMatchObject({ width: 1080, height: 1920, crop: "center" });
    expect(w["102"].class_type).toBe("SDPoseKeypointExtractor");
    expect(w["103"].class_type).toBe("SDPoseDrawKeypoints");
    expect(w["104"].inputs.model).toEqual(["1", 0]);
    expect(w["112"].class_type).toBe("Canny");
    expect(w["114"].inputs.model).toEqual(["104", 0]);
    expect(w["114"].inputs.strength).toBe(0.55);
    expect(w["7"].inputs.model).toEqual(["114", 0]);
  });
  it("combines Z-Image Face and Pose references with approximate face refinement", () => {
    const w = buildWorkflow(template, {
      ...valid, diffusionModel: "zImageTurbo_turbo.safetensors",
      references: [
        { image: "z-image-studio/face.jpg", mode: "face", strength: 1 },
        { image: "z-image-studio/pose.jpg", mode: "pose", strength: 0.8 }
      ]
    });
    expect(w["102"].class_type).toBe("Canny");
    expect(w["112"].class_type).toBe("SDPoseKeypointExtractor");
    expect(w["190"]).toMatchObject({ class_type: "FaceDetailer", inputs: { denoise: 0.4 } });
    expect(w["11"].inputs.image).toEqual(["190", 0]);
  });
  it("routes Krea Face and Pose references through native identity and depth paths", () => {
    const w = buildWorkflow(template, {
      ...valid, diffusionModel: "krea2TurboINT8.safetensors",
      references: [
        { image: "z-image-studio/face.jpg", mode: "face", strength: 1 },
        { image: "z-image-studio/pose.jpg", mode: "pose", strength: 0.8 }
      ]
    });
    expect(w["170"].inputs.lora_name).toBe(KREA_REFERENCE_FILES.identityLora);
    expect(w["180"].class_type).toBe("LoadImage");
    expect(w["185"].class_type).toBe("Krea2ControlApply");
    expect(w["190"]).toBeUndefined();
  });
  it("rejects unsafe or excessive reference stacks", () => {
    expect(() => generationSchema.parse({ ...valid, references: [{ image: "../pose.jpg", mode: "pose", strength: 1 }] })).toThrow();
    expect(() => generationSchema.parse({
      ...valid,
      references: Array.from({ length: 5 }, (_, index) => ({ image: `pose-${index}.jpg`, mode: "pose", strength: 1 }))
    })).toThrow();
  });
});
describe("safe files", () => {
  it("blocks traversal and absolute paths", () => {
    expect(() => safeOutputPath("C:\\safe", "..\\outside.png")).toThrow();
    expect(() => safeOutputPath("C:\\safe", "C:\\outside.png")).toThrow();
  });
  it("saves metadata once", () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"z-image-"));
    const p=saveMetadata(dir,"job-1",{seed:1});
    expect(JSON.parse(fs.readFileSync(p,"utf8")).seed).toBe(1);
    expect(() => saveMetadata(dir,"job-1",{seed:2})).toThrow();
  });
});
