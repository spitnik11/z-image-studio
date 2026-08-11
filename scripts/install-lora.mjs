#!/usr/bin/env node
/**
 * Modular LoRA install CLI for Z-Image Studio.
 *
 * Usage:
 *   node scripts/install-lora.mjs "C:\path\to\adapter.safetensors"
 *   node scripts/install-lora.mjs "C:\path\to\folder" --expect krea2
 *   node scripts/install-lora.mjs "C:\path\to\file.safetensors" --expect krea2 --strength 0.7 --category body
 *
 * Never overwrites existing files. Writes data/lora-registry.json and copies into lora/.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const distInstall = path.join(projectRoot, "server", "dist", "lora-install.js");

function parseArgs(argv) {
  const args = { paths: [], expect: undefined, strength: 0.7, category: undefined, name: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--expect" || a === "-e") args.expect = argv[++i];
    else if (a === "--strength" || a === "-s") args.strength = Number(argv[++i]);
    else if (a === "--category" || a === "-c") args.category = argv[++i];
    else if (a === "--name" || a === "-n") args.name = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("-")) args.paths.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.paths.length) {
  console.log(`install-lora.mjs — modular local LoRA installer

  node scripts/install-lora.mjs <file-or-dir> [--expect krea2] [--strength 0.7] [--category body] [--name "Display Name"]

  Safe: never overwrites existing lora/*.safetensors. Hash-checks after copy.
  Requires: npm run build -w server (or tsc) so server/dist/lora-install.js exists.
`);
  process.exit(args.help ? 0 : 1);
}

const mod = await import(pathToFileURL(distInstall).href);
const { installLoraFromPath, installLorasFromDirectory } = mod;
const fs = await import("node:fs");

const results = [];
for (const p of args.paths) {
  const abs = path.resolve(p);
  const opts = {
    expectArchitecture: args.expect,
    recommendedStrength: Number.isFinite(args.strength) ? args.strength : 0.7,
    category: args.category,
    displayName: args.name,
    markVerified: true
  };
  if (fs.statSync(abs).isDirectory()) {
    results.push(...installLorasFromDirectory(projectRoot, abs, opts));
  } else {
    results.push(installLoraFromPath(projectRoot, abs, opts));
  }
}

for (const r of results) {
  console.log(JSON.stringify({
    ok: true,
    filename: r.filename,
    architecture: r.architecture,
    sha256: r.sha256,
    sizeBytes: r.sizeBytes,
    alreadyExisted: r.alreadyExisted,
    verified: r.record.verified,
    finalPath: r.finalPath
  }, null, 2));
}
console.log(`Installed ${results.length} LoRA(s). Refresh LoRA list in Studio if the UI was already open.`);
