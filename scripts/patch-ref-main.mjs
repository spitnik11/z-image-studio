import fs from "node:fs";

const p = "app/src/main.tsx";
let s = fs.readFileSync(p, "utf8");

const old =
  'if(model?.architecture==="illustrious"){const recipe=model.recommended||{steps:28,guidance:4,sampler:"dpmpp_sde" as Sampler,scheduler:"karras" as Scheduler};setForm(f=>({...f,...recipe}));setPhotoReferences([]);setCharacters(current=>current.map(character=>({...character,references:[]})));setConsistentCharacter(false);setFaceRefinement(false)}';
const next =
  'if(model?.architecture==="illustrious"){const recipe=model.recommended||{steps:28,guidance:4,sampler:"dpmpp_sde" as Sampler,scheduler:"karras" as Scheduler};setForm(f=>({...f,...recipe}));setConsistentCharacter(false);setFaceRefinement(false)}';

if (!s.includes(old)) {
  console.error("illustrious select pattern not found");
  process.exit(1);
}
s = s.replace(old, next);

const oldType =
  'capabilities?:Partial<Record<"z-image"|"krea2"|"illustrious",ReferenceCapability[]>>';
const newType =
  'capabilities?:Partial<Record<"z-image"|"krea2"|"illustrious"|"anima",ReferenceCapability[]>>';
if (s.includes(oldType)) s = s.replace(oldType, newType);

// Capabilities lookup may cast architecture - leave as-is if cast already flexible
fs.writeFileSync(p, s);
console.log("main.tsx reference selection patched");
