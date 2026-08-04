/**
 * Verify Instagram UGC list: 40 full prompts, sequential one-per-image uniqueness.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { datasetPrompts, datasetSchema, getInstagramUgcShots } from "../server/src/dataset.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = getInstagramUgcShots(root);
console.log("list length", shots.length);
console.log("first starts raw", /^Raw photo/i.test(shots[0]));
console.log("has lili doe", shots.every(s => /lili doe/i.test(s)));

const sequential = datasetPrompts(datasetSchema.parse({
  name: "Verify",
  trigger: "lili doe",
  model: "krea2.safetensors",
  basePrompt: "unused",
  count: 40,
  width: 512,
  height: 768,
  seed: 42,
  datasetMode: "instagram-ugc",
  promptOrder: "sequential",
  projectRoot: root
}));

const indices = sequential.map(p => p.listIndex);
const uniqueCaptions = new Set(sequential.map(p => p.caption)).size;
const ok =
  shots.length === 40 &&
  indices.every((v, i) => v === i) &&
  uniqueCaptions === 40 &&
  sequential.every((p, i) => p.caption.includes(shots[i].slice(0, 30)));

console.log({
  sequentialIndices: indices.slice(0, 5).join(",") + "...",
  uniqueCaptions,
  img0_mirror: /mirror selfie/i.test(sequential[0].caption),
  img39_frontal: /full frontal/i.test(sequential[39].caption),
  ok
});
process.exit(ok ? 0 : 1);
