const studio = process.env.Z_IMAGE_STUDIO_URL || "http://127.0.0.1:3199";

async function json(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

try {
  await json(`${studio}/api/diagnostics`);
} catch {
  console.log(`SKIP: Z-Image Studio is not reachable at ${studio}. Start the desktop app, then rerun npm run smoke.`);
  process.exit(0);
}

const settings = await json(`${studio}/api/settings`);
const form = new FormData();
const input = {
  prompt: "a small lime ceramic sphere on a charcoal studio background",
  negativePrompt: "",
  width: 512,
  height: 512,
  seed: 424242,
  steps: 8,
  guidance: 1,
  batchSize: 1,
  priority: "low",
  outputFormat: "png",
  sampler: "res_multistep",
  scheduler: "simple",
  outputName: `maintenance-smoke-${Date.now()}`,
  neuralUpscale: false,
  upscaleModel: "RealESRGAN_x4plus.pth",
  diffusionModel: settings.diffusionModel,
  loras: "[]",
  referenceSettings: "[]",
  consistentCharacter: false,
  faceRefinement: false,
  controlnetEnd: 0.75
};
for (const [key, value] of Object.entries(input)) form.append(key, String(value));
const job = await json(`${studio}/api/generate`, { method: "POST", body: form });
const deadline = Date.now() + 5 * 60_000;
while (Date.now() < deadline) {
  const gallery = await json(`${studio}/api/gallery`);
  const record = gallery.find(item => item.id === job.id);
  if (record?.status === "completed") {
    if (!record.images?.some(image => image.filename?.toLowerCase().endsWith(".png"))) {
      throw new Error("Smoke generation completed without a PNG output.");
    }
    console.log(`PASS: ${record.images[0].filename} completed in ${record.durationMs ?? "unknown"} ms.`);
    process.exit(0);
  }
  if (["failed", "cancelled"].includes(record?.status)) throw new Error(record.error || `Smoke generation ${record.status}.`);
  await new Promise(resolve => setTimeout(resolve, 1_000));
}
throw new Error("Smoke generation did not complete within five minutes.");
