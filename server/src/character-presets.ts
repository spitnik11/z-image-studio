import fs from "node:fs"; import crypto from "node:crypto"; import {z} from "zod";
import {writeJsonAtomic} from "./file-utils.js";
const safeReferencePath=z.string().trim().min(1).max(500).refine(value=>
 !value.includes("\0")&&!value.includes("..")&&!value.startsWith("/")&&!value.startsWith("\\")&&!/^[a-z]:/i.test(value),
 "Reference images must use an application-managed relative path."
);
export const characterPresetInputSchema=z.object({
 name:z.string().trim().min(1).max(100),architecture:z.enum(["z-image","krea2"]),
 keywords:z.array(z.string().max(200)).max(50).default([]),triggers:z.array(z.string().max(100)).max(20).default([]),
 preferredLoras:z.array(z.object({name:z.string().max(300),strength:z.number().min(-2).max(2)})).max(8).default([]),
 referenceImages:z.array(z.object({path:safeReferencePath,tag:z.enum(["face","body","pose"])})).max(12).default([]),
 notes:z.string().max(3000).default("")
});
export type CharacterPreset=z.infer<typeof characterPresetInputSchema>&{id:string;createdAt:string;updatedAt:string};
const characterPresetSchema=characterPresetInputSchema.extend({
 id:z.string().uuid(),createdAt:z.string().datetime(),updatedAt:z.string().datetime()
});
export class CharacterPresetStore{
 constructor(private file:string){}
 list():CharacterPreset[]{try{return z.array(characterPresetSchema).parse(JSON.parse(fs.readFileSync(this.file,"utf8")))}catch{return[]}}
 get(id:string){return this.list().find(x=>x.id===id)}
 create(raw:unknown){const data=characterPresetInputSchema.parse(raw),now=new Date().toISOString();const item={...data,id:crypto.randomUUID(),createdAt:now,updatedAt:now};this.save([item,...this.list()]);return item}
 update(id:string,raw:unknown){const all=this.list(),i=all.findIndex(x=>x.id===id);if(i<0)return;all[i]={...all[i],...characterPresetInputSchema.parse(raw),updatedAt:new Date().toISOString()};this.save(all);return all[i]}
 remove(id:string){const all=this.list(),next=all.filter(x=>x.id!==id);if(next.length===all.length)return false;this.save(next);return true}
 private save(items:CharacterPreset[]){writeJsonAtomic(this.file,items)}
}
export function presetGenerationInput(preset:CharacterPreset){
 return {architecture:preset.architecture,keywords:[...preset.triggers,...preset.keywords],confirmedLoras:preset.preferredLoras,
  references:preset.referenceImages.map(image=>({image:image.path,mode:image.tag==="pose"?"pose":image.tag==="body"?"direct":"face",strength:image.tag==="face"?.8:.75}))};
}
export function presetDatasetHandoff(preset:CharacterPreset){
 return {name:`${preset.name} dataset`,architecture:preset.architecture,characterDescription:preset.keywords.join(", "),
  masterReference:preset.referenceImages.find(image=>image.tag==="face")?.path||preset.referenceImages[0]?.path||"",
  additionalImages:preset.referenceImages.map(image=>image.path),note:"Reference-based consistency only. Review the dataset before promoting it to LoRA Lab."};
}
