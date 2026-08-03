import { describe,expect,it } from "vitest";
import { PromptLibraryStore,generatePrompt,validatePromptRequest } from "./prompt-engine.js";
import type { LoraRecord } from "./lora-registry.js";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const records:LoraRecord[]=[
 {filename:"choke.safetensors",architecture:"illustrious",category:"action",activationWords:["back_chokehold"],recommendedStrength:.8,verified:true},
 {filename:"fame.safetensors",architecture:"krea2",category:"style",activationWords:["famegrid"],recommendedStrength:.8,verified:true}
];
function store(){
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"prompt-engine-")),"library.json");
 fs.writeFileSync(file,JSON.stringify({version:1,source:"test",importedAt:new Date().toISOString(),negativePresets:[{id:"n1",name:"quality",prompt:"blurry"}],entries:[
  {id:"WA-1",sourceRange:"1",architecture:"illustrious",category:"action",complexity:"standard",style:"anime",promptTemplate:"adult woman, sleeper hold",activationWords:["back_chokehold"],poseVariants:[],requiredLora:"choke.safetensors",startWeight:.8,negativePresetId:"n1",safetyNotes:[],resolved:true},
  {id:"CM-1",sourceRange:"2",architecture:"krea2",category:"ugc",complexity:"detailed",style:"photo",promptTemplate:"A candid social media photograph of an adult creator",activationWords:["famegrid"],poseVariants:[],requiredLora:"fame.safetensors",startWeight:.8,negativePresetId:"n1",safetyNotes:[],resolved:true}
 ]}));
 return new PromptLibraryStore(file);
}
describe("prompt engine",()=>{
 it("serializes Illustrious as tags and Krea as prose with proposals",()=>{
  const s=store(); const ill=generatePrompt({architecture:"illustrious",entryIds:["WA-1"],keywords:["top view"]},s,records);
  expect(ill.prompt).toContain("adult woman, sleeper hold, top view"); expect(ill.proposedLoras[0].filename).toBe("choke.safetensors");
  const k=generatePrompt({architecture:"krea2",entryIds:["CM-1"],keywords:["golden hour"]},s,records);
  expect(k.prompt).toContain("photograph of an adult creator. golden hour."); expect(k.proposedLoras[0].filename).toBe("fame.safetensors");
 });
 it("blocks architecture, unresolved, lora syntax, and ambiguous age; warns on two actions",()=>{
  const base=generatePrompt({architecture:"illustrious",keywords:["schoolgirl"],confirmedLoras:[{name:"fame.safetensors",strength:1},{name:"missing.safetensors",strength:1}]},store(),records);
  base.prompt+=" <lora:x:1>";
  const result=validatePromptRequest(base,records); expect(result.ok).toBe(false); expect(result.blocks.length).toBeGreaterThanOrEqual(3);
  const two={...base,prompt:"two adult wrestlers",loras:[{name:"choke.safetensors",strength:.8},{name:"choke.safetensors",strength:.8}]};
  expect(validatePromptRequest(two,records).warnings.some(w=>w.includes("action"))).toBe(true);
 });
 it("uses curated incompatibility metadata without inferring from filenames",()=>{
  const curated:LoraRecord[]=[
   {...records[1],incompatibleWith:["other.safetensors"],conflictingActivations:["monochrome"],incompatibleAesthetics:["anime"]},
   {filename:"other.safetensors",architecture:"krea2",category:"style",verified:true}
  ];
  const request=generatePrompt({architecture:"krea2",keywords:["anime monochrome adult portrait"],confirmedLoras:[
   {name:"fame.safetensors",strength:.8},{name:"other.safetensors",strength:.5}
  ]},store(),curated);
  const result=validatePromptRequest(request,curated);
  expect(result.blocks.some(x=>x.includes("explicitly incompatible"))).toBe(true);
  expect(result.warnings.some(x=>x.includes("monochrome"))).toBe(true);
  expect(result.warnings.some(x=>x.includes("aesthetic"))).toBe(true);
 });
});
