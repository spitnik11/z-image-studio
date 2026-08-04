/**
 * Live smoke: inspect master from Desktop/d, then generate ONE photo with the
 * resolved model + LoRAs + master as Direct reference (same path Dataset uses).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const masterPath = process.argv[2] || "C:/Users/losth/Desktop/d/z-image_00240_.png";
const studio = process.env.STUDIO_URL || "http://127.0.0.1:3199";

function die(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(masterPath)) die(`Master not found: ${masterPath}`);
  console.log("Master:", masterPath);

  // 1) Inspect stack
  const inspectFd = new FormData();
  inspectFd.append(
    "master",
    new Blob([fs.readFileSync(masterPath)], { type: "image/png" }),
    path.basename(masterPath)
  );
  const inspectRes = await fetch(`${studio}/api/datasets/inspect-master`, {
    method: "POST",
    body: inspectFd
  });
  const stack = await inspectRes.json();
  console.log("Inspect:", {
    status: inspectRes.status,
    model: stack.model,
    loraCount: stack.loras?.length,
    matched: stack.matchedFromMaster,
    note: stack.note
  });
  if (!stack.model) die("No model from inspect");
  if (!stack.loras?.length) die("No LoRAs from inspect — master stack not applied");
  if (stack.unmatchedLoras?.length) {
    console.warn("Unmatched LoRAs:", stack.unmatchedLoras);
  }

  // 2) Upload master as reference for generation
  const genFd = new FormData();
  const fields = {
    prompt:
      "photo of the same woman, close-up portrait, soft natural light, looking at camera, consistent identity, dataset stack smoke test",
    negativePrompt: "different person, deformed face, bad hands, blurry",
    width: "512",
    height: "768",
    seed: String(Math.floor(Math.random() * 1e9)),
    steps: "8",
    guidance: "1",
    batchSize: "1",
    priority: "next",
    outputFormat: "png",
    sampler: "res_multistep",
    scheduler: "simple",
    outputName: "dataset-stack-smoke",
    diffusionModel: stack.model,
    neuralUpscale: "false",
    faceRefinement: "false",
    consistentCharacter: "false",
    loras: JSON.stringify(stack.loras),
    referenceSettings: JSON.stringify([
      { mode: "direct", strength: 1.15, image: "" }
    ])
  };
  for (const [k, v] of Object.entries(fields)) genFd.append(k, v);
  genFd.append(
    "references",
    new Blob([fs.readFileSync(masterPath)], { type: "image/png" }),
    path.basename(masterPath)
  );

  const genRes = await fetch(`${studio}/api/generate`, { method: "POST", body: genFd });
  const genBody = await genRes.json().catch(() => ({}));
  if (!genRes.ok) die(`Generate failed: ${genBody.error || genRes.status}`);
  console.log("Queued:", genBody.id, genBody.promptId);
  console.log("Record stack:", {
    model: genBody.diffusionModel || genBody.model,
    loras: (genBody.loras || []).map(l => `${l.name}@${l.strength}`)
  });
  if (!(genBody.loras || []).length) die("Generation record has empty loras[] — stack not wired into /api/generate");

  // 3) Poll gallery until complete or fail
  const id = genBody.id;
  const deadline = Date.now() + 180_000;
  let final = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const list = await fetch(`${studio}/api/gallery`).then(r => r.json());
    final = list.find(item => item.id === id);
    if (!final) continue;
    process.stdout.write(`\rstatus=${final.status} progress=${final.progress || 0}   `);
    if (["completed", "failed", "cancelled"].includes(final.status)) break;
  }
  console.log("");
  if (!final) die("Record disappeared from gallery");
  if (final.status !== "completed") die(`Generation ${final.status}: ${final.error || final.phase}`);
  if (!final.images?.length) die("Completed without images");

  const img = final.images[0];
  console.log("Output:", img.filename, img.subfolder || "(root)");

  // 4) Read output PNG parameters if present
  const outDir = path.join(root, "ComfyUI", "output", img.subfolder || "");
  const outFile = path.join(outDir, img.filename);
  if (fs.existsSync(outFile)) {
    const { readGenerationMetaFromPng } = await import("../server/src/civitai-metadata.ts");
    const meta = readGenerationMetaFromPng(outFile);
    console.log("Output metadata:", {
      model: meta.model,
      loraCount: meta.loras.length,
      loras: meta.loras.map(l => `${l.name}@${l.strength}`)
    });
    if (!meta.loras.length) {
      console.warn("WARN: output PNG has no LoRA tags in parameters (embed may have failed or still pending)");
    }
  } else {
    console.warn("WARN: output file not found at", outFile);
  }

  console.log("\nSMOKE OK — model + LoRAs from master applied to generation.");
  process.exit(0);
}

main().catch(err => die(err?.stack || String(err)));
