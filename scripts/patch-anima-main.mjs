import fs from "node:fs";

const path = "app/src/main.tsx";
let s = fs.readFileSync(path, "utf8");
const oldNote =
  'models.find(x=>x.name===diffusionModel)?.architecture==="illustrious"?"Illustrious XL profile active: checkpoint VAE/CLIP, Clip Skip 2, and full model + text-encoder LoRAs. Pose LoRAs are Photo-only; animate the finished still in SCAIL Video.":models.find(x=>x.name===diffusionModel)?.architecture==="krea2"?"Krea 2 profile active: Qwen3-VL encoder, Qwen Image VAE, Euler, 8 steps, CFG 1. Use only Krea 2 LoRAs.":"Z-Image profile active: Lumina2 encoder, AuraFlow shift, res_multistep sampler."';
const newNote =
  'models.find(x=>x.name===diffusionModel)?.architecture==="illustrious"?"Illustrious XL profile active: checkpoint VAE/CLIP, Clip Skip 2, and full model + text-encoder LoRAs. Pose LoRAs are Photo-only; animate the finished still in SCAIL Video.":models.find(x=>x.name===diffusionModel)?.architecture==="anima"?"Anima profile active: Qwen3-0.6B text encoder, Qwen Image VAE, Euler/simple, ~30 steps, CFG 4. Anime/illustration only; no image references yet. Use verified Anima LoRAs.":models.find(x=>x.name===diffusionModel)?.architecture==="krea2"?"Krea 2 profile active: Qwen3-VL encoder, Qwen Image VAE, Euler, 8 steps, CFG 1. Use only Krea 2 LoRAs.":"Z-Image profile active: Lumina2 encoder, AuraFlow shift, res_multistep sampler."';
if (!s.includes(oldNote)) {
  console.error("note pattern not found");
  process.exit(1);
}
s = s.replace(oldNote, newNote);
const oldGate = 'models.find(item=>item.name===diffusionModel)?.loraArchitecture!=="pony"&&<PromptStudio';
const newGate =
  '!["pony","anima"].includes(String(models.find(item=>item.name===diffusionModel)?.loraArchitecture||models.find(item=>item.name===diffusionModel)?.architecture))&&<PromptStudio';
if (!s.includes(oldGate)) {
  console.error("gate not found");
  process.exit(1);
}
s = s.replace(oldGate, newGate);
s = s.replace(
  '?.architecture?.replace("krea2","Krea 2")',
  '?.architecture?.replace("krea2","Krea 2").replace("anima","Anima")'
);
fs.writeFileSync(path, s);
console.log("main.tsx note/gate updated");
