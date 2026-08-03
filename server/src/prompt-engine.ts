import fs from "node:fs";
import { z } from "zod";
import { writeJsonAtomic } from "./file-utils.js";
import type { ImageArchitecture } from "./model-adapters.js";
import type { LoraRecord } from "./lora-registry.js";
import { applyLoraActivations } from "./lora-registry.js";

export const promptEntrySchema = z.object({
  id: z.string().min(2).max(80),
  sourceRange: z.string().max(80),
  architecture: z.enum(["z-image", "krea2", "illustrious"]),
  category: z.string().min(1).max(80),
  complexity: z.enum(["simple", "standard", "detailed"]),
  style: z.string().max(100),
  promptTemplate: z.string().min(1).max(8000),
  activationWords: z.array(z.string()).default([]),
  poseVariants: z.array(z.string()).default([]),
  requiredLora: z.string().optional(),
  startWeight: z.number().min(-2).max(2).optional(),
  negativePresetId: z.string().optional(),
  safetyNotes: z.array(z.string()).default([]),
  resolved: z.boolean()
});
export const negativePresetSchema = z.object({ id:z.string(), name:z.string(), prompt:z.string() });
export const promptLibrarySchema = z.object({
  version: z.number().int().positive(),
  source: z.string(),
  importedAt: z.string(),
  entries: z.array(promptEntrySchema),
  negativePresets: z.array(negativePresetSchema)
});
export type PromptEntry = z.infer<typeof promptEntrySchema>;
export type PromptLibrary = z.infer<typeof promptLibrarySchema>;

const engineInputSchema = z.object({
  architecture: z.enum(["z-image", "krea2", "illustrious"]),
  modelName: z.string().optional(),
  entryIds: z.array(z.string()).default([]),
  keywords: z.array(z.string().max(300)).default([]),
  complexity: z.enum(["simple", "standard", "detailed"]).default("standard"),
  style: z.string().optional(),
  negativePresetId: z.string().optional(),
  characters: z.array(z.unknown()).default([]),
  references: z.array(z.unknown()).default([]),
  confirmedLoras: z.array(z.object({ name:z.string(), strength:z.number() })).default([])
});
export type PromptEngineInput = z.infer<typeof engineInputSchema>;

export type PromptProposal = { filename:string; weight:number; confidence:number; reason:string; category?:string };
export type PromptEngineOutput = {
  architecture: ImageArchitecture; modelName?: string; prompt:string; negativePrompt:string;
  loras:Array<{name:string;strength:number}>; proposedLoras:PromptProposal[];
  characters:unknown[]; references:unknown[]; entryIds:string[];
};
export type ValidationResult = { ok:boolean; blocks:string[]; warnings:string[]; normalized:PromptEngineOutput };

const loraSyntax = /<lora:[^>]+>/gi;
const ambiguousAge = /\b(teen|teenage|young boy|young girl|schoolgirl|schoolboy|student|loli|shota|underage|child|kid)\b/i;
const explicitAdult = /\b(adult|(?:2[1-9]|[3-9]\d)[ -]?(?:year|yo)|mature)\b/i;

function dedupe(items:string[]) {
  const seen = new Set<string>();
  return items.map(item=>item.trim()).filter(item=>item&&!seen.has(item.toLowerCase())&&seen.add(item.toLowerCase()));
}
function prose(parts:string[]) {
  return dedupe(parts).map(part=>part.replace(/[.\s]+$/,"")).join(". ").replace(/\s+/g," ").replace(/\.+$/,"") + ".";
}
function tags(parts:string[]) {
  return dedupe(parts.flatMap(part=>part.split(",").map(value=>value.trim()))).join(", ");
}

export class PromptLibraryStore {
  private data: PromptLibrary;
  constructor(private readonly file:string) { this.data=this.load(); }
  private load():PromptLibrary {
    return promptLibrarySchema.parse(JSON.parse(fs.readFileSync(this.file,"utf8")));
  }
  list(filters:Partial<{architecture:string;category:string;complexity:string;style:string;keyword:string}>={}) {
    const term=filters.keyword?.toLowerCase();
    return this.data.entries.filter(entry=>
      (!filters.architecture||entry.architecture===filters.architecture)&&
      (!filters.category||entry.category===filters.category)&&
      (!filters.complexity||entry.complexity===filters.complexity)&&
      (!filters.style||entry.style.toLowerCase().includes(filters.style.toLowerCase()))&&
      (!term||JSON.stringify(entry).toLowerCase().includes(term))
    );
  }
  get(id:string){ return this.data.entries.find(entry=>entry.id===id); }
  negatives(){ return this.data.negativePresets; }
  import(next:PromptLibrary) {
    this.data=promptLibrarySchema.parse(next);
    writeJsonAtomic(this.file,this.data);
    return this.data;
  }
}

export function resolveLoraProposals(
  architecture:ImageArchitecture, entries:PromptEntry[], keywords:string[], records:LoraRecord[]
) {
  const compatible=records.filter(record=>record.verified&&record.architecture===architecture);
  const result=new Map<string,PromptProposal>();
  for(const entry of entries) {
    if(!entry.resolved||!entry.requiredLora) continue;
    const record=compatible.find(item=>item.filename.toLowerCase()===entry.requiredLora!.toLowerCase());
    if(record) result.set(record.filename,{filename:record.filename,weight:entry.startWeight??record.recommendedStrength??1,confidence:1,reason:`Required by ${entry.id}`,category:record.category});
  }
  const haystack=keywords.join(" ").toLowerCase();
  for(const record of compatible) {
    const matches=[...(record.activationWords||[]),record.triggerToken||"",...(record.tags||[])].filter(Boolean).filter(word=>haystack.includes(word.toLowerCase()));
    if(matches.length&&!result.has(record.filename)) result.set(record.filename,{filename:record.filename,weight:record.recommendedStrength??1,confidence:Math.min(.95,.55+matches.length*.1),reason:`Matched ${matches.join(", ")}`,category:record.category});
  }
  // ponytail: keyword matches are proposals only; blind insertion silently corrupts multi-LoRA stacks.
  return [...result.values()];
}

export function generatePrompt(raw:unknown, library:PromptLibraryStore, records:LoraRecord[]):PromptEngineOutput {
  const input=engineInputSchema.parse(raw);
  const entries=input.entryIds.map(id=>library.get(id)).filter((entry):entry is PromptEntry=>Boolean(entry));
  const wrong=entries.find(entry=>entry.architecture!==input.architecture);
  if(wrong) throw new Error(`${wrong.id} targets ${wrong.architecture}, not ${input.architecture}.`);
  const parts=[...entries.map(entry=>entry.promptTemplate),...input.keywords];
  const prompt=(input.architecture==="illustrious"?tags:prose)(parts).replace(loraSyntax,"").trim();
  const preset=library.negatives().find(item=>item.id===(input.negativePresetId||entries.find(entry=>entry.negativePresetId)?.negativePresetId));
  const confirmed=input.confirmedLoras.map(item=>({name:item.name,strength:item.strength}));
  return {
    architecture:input.architecture,modelName:input.modelName,
    prompt:applyLoraActivations(prompt,confirmed,records),negativePrompt:preset?.prompt||"",
    loras:confirmed,proposedLoras:resolveLoraProposals(input.architecture,entries,input.keywords,records),
    characters:input.characters,references:input.references,entryIds:entries.map(entry=>entry.id)
  };
}

export function validatePromptRequest(request:PromptEngineOutput, records:LoraRecord[]):ValidationResult {
  const blocks:string[]=[]; const warnings:string[]=[];
  const hadLoraSyntax=/<lora:[^>]+>/i.test(request.prompt);
  let prompt=request.prompt.replace(loraSyntax,"").replace(/\s{2,}/g," ").trim();
  if(hadLoraSyntax) blocks.push("Embedded <lora:...> syntax is not allowed; select adapters through the LoRA stack.");
  if(ambiguousAge.test(prompt)&&!explicitAdult.test(prompt)) blocks.push("The prompt contains an ambiguous-age term without an explicit adult recast.");
  const byName=new Map(records.map(record=>[record.filename.toLowerCase(),record]));
  const normalizedLoras=request.loras.map(lora=>{
    const record=byName.get(lora.name.toLowerCase());
    if(!record||!record.verified) blocks.push(`LoRA is unresolved or uninstalled: ${lora.name}`);
    else if(record.architecture!==request.architecture) blocks.push(`${lora.name} is ${record.architecture}, not ${request.architecture}.`);
    if(lora.strength < -2 || lora.strength > 2) blocks.push(`${lora.name} weight must stay between -2 and 2.`);
    return {...lora,strength:Math.max(-2,Math.min(2,lora.strength))};
  });
  const actionCount=normalizedLoras.filter(lora=>byName.get(lora.name.toLowerCase())?.category==="action").length;
  if(actionCount>1) warnings.push("More than one action LoRA can create conflicting body positions; start with one.");
  const selectedNames=new Set(normalizedLoras.map(lora=>lora.name.toLowerCase()));
  for(const lora of normalizedLoras){
    const record=byName.get(lora.name.toLowerCase());
    for(const incompatible of record?.incompatibleWith||[])if(selectedNames.has(incompatible.toLowerCase()))
      blocks.push(`${record!.filename} is explicitly incompatible with ${incompatible}.`);
    for(const activation of record?.conflictingActivations||[])if(prompt.toLowerCase().includes(activation.toLowerCase()))
      warnings.push(`${record!.filename} may conflict with prompt term “${activation}”.`);
    for(const aesthetic of record?.incompatibleAesthetics||[])if(prompt.toLowerCase().includes(aesthetic.toLowerCase()))
      warnings.push(`${record!.filename} may fight the requested “${aesthetic}” aesthetic.`);
  }
  const total=normalizedLoras.reduce((sum,lora)=>sum+Math.abs(lora.strength),0);
  if(normalizedLoras.length>4||total>3.2) warnings.push(`Heavy LoRA stack (${normalizedLoras.length} adapters, ${total.toFixed(2)} total weight).`);
  const activations=normalizedLoras.flatMap(lora=>byName.get(lora.name.toLowerCase())?.activationWords||[]).map(word=>word.toLowerCase());
  if(new Set(activations).size<activations.length) warnings.push("Duplicate activation words were deduplicated.");
  prompt=applyLoraActivations(prompt,normalizedLoras,records);
  return {ok:blocks.length===0,blocks:[...new Set(blocks)],warnings:[...new Set(warnings)],normalized:{...request,prompt,loras:normalizedLoras}};
}
