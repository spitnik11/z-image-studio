const studio = process.env.Z_IMAGE_STUDIO_URL || "http://127.0.0.1:3199";
const requested = process.argv.slice(2);

async function json(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
}

const models = await json(`${studio}/api/models`);
const targets = requested.length
  ? requested.map(name => {
      const model = models.find(item => item.name === name);
      if (!model) throw new Error(`Model is not registered: ${name}`);
      return model;
    })
  : models.filter(item => item.type === "checkpoint" && item.architecture !== "unknown");

for (const [index, model] of targets.entries()) {
  const pony = model.loraArchitecture === "pony";
  const prompt = pony
    ? "score_9, score_8_up, source_anime, best quality, adult woman, studio portrait, detailed eyes"
    : "masterpiece, best quality, adult woman, studio portrait, detailed eyes, clean background";
  const recipe = model.recommended || {
    steps: 8,
    guidance: 1,
    sampler: "res_multistep",
    scheduler: "simple",
  };
  const form = new FormData();
  const input = {
    prompt,
    negativePrompt: "low quality, blurry, watermark, text, malformed hands",
    width: 512,
    height: 512,
    seed: 730000 + index,
    steps: Math.min(recipe.steps, 8),
    guidance: recipe.guidance,
    batchSize: 1,
    priority: "low",
    outputFormat: "png",
    outputName: `checkpoint-smoke-${model.name.replace(/\.safetensors$/i, "")}-${Date.now()}`,
    diffusionModel: model.name,
    neuralUpscale: false,
    upscaleModel: "RealESRGAN_x4plus.pth",
    consistentCharacter: false,
    faceRefinement: false,
    controlnetEnd: 0.75,
    sampler: recipe.sampler,
    scheduler: recipe.scheduler,
    loras: "[]",
    characters: "[]",
    referenceSettings: "[]",
  };
  for (const [key, value] of Object.entries(input)) form.append(key, String(value));

  const job = await json(`${studio}/api/generate`, { method: "POST", body: form });
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const record = (await json(`${studio}/api/gallery`)).find(item => item.id === job.id);
    if (record?.status === "completed") {
      const output = record.images?.find(image => image.filename?.toLowerCase().endsWith(".png"));
      if (!output) throw new Error(`${model.name} completed without a PNG.`);
      console.log(`PASS ${model.name}: ${output.filename}`);
      break;
    }
    if (["failed", "cancelled"].includes(record?.status)) {
      throw new Error(`${model.name}: ${record.error || record.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (Date.now() >= deadline) throw new Error(`${model.name} timed out after ten minutes.`);
}
