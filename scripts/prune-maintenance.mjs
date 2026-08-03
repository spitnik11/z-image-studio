import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const days = Math.max(1, Number(process.env.Z_IMAGE_PRUNE_DAYS || 30));
const maxLogBytes = Math.max(1024 * 1024, Number(process.env.Z_IMAGE_LOG_MAX_BYTES || 10 * 1024 * 1024));
const cutoff = Date.now() - days * 24 * 60 * 60 * 1_000;
const outputs = path.join(root, "outputs");
const logs = path.join(root, "logs");
let removed = 0;
let rotated = 0;

for (const entry of fs.existsSync(outputs) ? fs.readdirSync(outputs, { withFileTypes: true }) : []) {
  if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
  const file = path.join(outputs, entry.name);
  if (fs.statSync(file).mtimeMs >= cutoff) continue;
  fs.unlinkSync(file);
  removed++;
}

for (const entry of fs.existsSync(logs) ? fs.readdirSync(logs, { withFileTypes: true }) : []) {
  if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".log") continue;
  const file = path.join(logs, entry.name);
  if (fs.statSync(file).size <= maxLogBytes) continue;
  const backup = `${file}.1`;
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
  fs.renameSync(file, backup);
  fs.writeFileSync(file, "", "utf8");
  rotated++;
}

console.log(`Maintenance complete: removed ${removed} JSON sidecars older than ${days} days; rotated ${rotated} oversized logs.`);
