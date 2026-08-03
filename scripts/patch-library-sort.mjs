import fs from "node:fs";

const path = "app/src/main.tsx";
let s = fs.readFileSync(path, "utf8");

// 1) Extend ModelItem type
const oldModelType =
  'type ModelItem={name:string;displayName?:string;displayFamily?:string;loraArchitecture?:"z-image"|"krea2"|"illustrious"|"anima"|"pony"|"unknown";architecture:"z-image"|"krea2"|"illustrious"|"anima"|"unknown";recommended?:{steps:number;guidance:number;sampler:Sampler;scheduler:Scheduler};usageGuide?:string;licenseNotes?:string};';
const newModelType =
  'type ModelItem={name:string;displayName?:string;displayFamily?:string;loraArchitecture?:"z-image"|"krea2"|"illustrious"|"anima"|"pony"|"unknown";architecture:"z-image"|"krea2"|"illustrious"|"anima"|"unknown";recommended?:{steps:number;guidance:number;sampler:Sampler;scheduler:Scheduler};usageGuide?:string;licenseNotes?:string;modifiedAt?:string;sizeBytes?:number};type LibrarySort="name"|"modified";';
if (!s.includes(oldModelType)) {
  console.error("ModelItem type not found");
  process.exit(1);
}
s = s.replace(oldModelType, newModelType);

// 2) State for sort modes
const oldState =
  " const [models,setModels]=useState<ModelItem[]>([]); const [diffusionModel,setDiffusionModel]=useState(\"\"); const [metadata,setMetadata]=useState(\"\"); const [metadataResult,setMetadataResult]=useState(\"\");";
const newState =
  " const [models,setModels]=useState<ModelItem[]>([]); const [diffusionModel,setDiffusionModel]=useState(\"\"); const [metadata,setMetadata]=useState(\"\"); const [metadataResult,setMetadataResult]=useState(\"\");\n const [modelSort,setModelSort]=useState<LibrarySort>(\"name\"); const [loraSort,setLoraSort]=useState<LibrarySort>(\"name\");";
if (!s.includes(oldState)) {
  console.error("models state not found");
  process.exit(1);
}
s = s.replace(oldState, newState);

// 3) Insert sorted memos after active/gallery lines - find a stable anchor after openLibraryUpload
const anchor = " const openLibraryUpload=(preferredKind?:LibraryKind)=>setLibraryOpen({id:Date.now(),preferredKind});";
if (!s.includes(anchor)) {
  console.error("openLibraryUpload anchor not found");
  process.exit(1);
}
const sortHelpers = `
 const labelOf=(name:string,display?:string)=> (display||name.replace(/\\.safetensors$/i,\"\")).toLowerCase();
 const sortedModels=useMemo(()=>{
  const list=[...models];
  if(modelSort===\"modified\") list.sort((a,b)=>String(b.modifiedAt||\"\").localeCompare(String(a.modifiedAt||\"\"))||labelOf(a.name,a.displayName).localeCompare(labelOf(b.name,b.displayName)));
  else list.sort((a,b)=>Number(b.architecture!==\"unknown\")-Number(a.architecture!==\"unknown\")||labelOf(a.name,a.displayName).localeCompare(labelOf(b.name,b.displayName)));
  return list;
 },[models,modelSort]);
 const sortedAvailableLoras=useMemo(()=>{
  const list=[...availableLoras];
  if(loraSort===\"modified\") list.sort((a,b)=>String(b.modifiedAt||\"\").localeCompare(String(a.modifiedAt||\"\"))||labelOf(a.name,a.displayName).localeCompare(labelOf(b.name,b.displayName)));
  else list.sort((a,b)=>labelOf(a.name,a.displayName).localeCompare(labelOf(b.name,b.displayName)));
  return list;
 },[availableLoras,loraSort]);
 const sortedActiveLoras=useMemo(()=>{
  const list=[...loras];
  const meta=new Map(availableLoras.map(item=>[item.name,item]));
  if(loraSort===\"modified\") list.sort((a,b)=>String(meta.get(b.name)?.modifiedAt||\"\").localeCompare(String(meta.get(a.name)?.modifiedAt||\"\"))||labelOf(a.name,meta.get(a.name)?.displayName).localeCompare(labelOf(b.name,meta.get(b.name)?.displayName)));
  else list.sort((a,b)=>labelOf(a.name,meta.get(a.name)?.displayName).localeCompare(labelOf(b.name,meta.get(b.name)?.displayName)));
  return list;
 },[loras,availableLoras,loraSort]);
`;
s = s.replace(anchor, anchor + sortHelpers);

// 4) Model picker: inject sort select + use sortedModels
// Find model-picker opening and add sort control after section-title actions area
// Replace models.map with sortedModels.map in model select only carefully
const modelMapOld = "{models.map(model=><option key={model.name}";
const modelMapNew = "{sortedModels.map(model=><option key={model.name}";
if (!s.includes(modelMapOld)) {
  console.error("models.map not found");
  process.exit(1);
}
s = s.replace(modelMapOld, modelMapNew);

// Insert sort control in model-picker before select - find model-picker div
const modelPickerOld = '<div className="model-picker"><select aria-label="Diffusion model"';
const modelPickerNew =
  '<div className="model-picker"><label className="library-sort"><span className="sr-only">Sort models</span><select aria-label="Sort models" value={modelSort} onChange={e=>setModelSort(e.target.value as LibrarySort)}><option value="name">A–Z</option><option value="modified">Date modified</option></select></label><select aria-label="Diffusion model"';
if (!s.includes(modelPickerOld)) {
  console.error("model-picker not found");
  process.exit(1);
}
s = s.replace(modelPickerOld, modelPickerNew);

// 5) LoRA section: sort control + sorted lists
const loraActionsOld =
  '<div className="section-title-actions"><button type="button" onClick={()=>openLibraryUpload("lora")} aria-label="Upload LoRA" title="Upload LoRA"><Upload size={15}/></button><button type="button" onClick={()=>refreshLoras(diffusionModel)} aria-label="Refresh LoRAs" title="Refresh LoRAs"><RefreshCw size={15}/></button></div>';
const loraActionsNew =
  '<div className="section-title-actions"><label className="library-sort"><span className="sr-only">Sort LoRAs</span><select aria-label="Sort LoRAs" value={loraSort} onChange={e=>setLoraSort(e.target.value as LibrarySort)}><option value="name">A–Z</option><option value="modified">Date modified</option></select></label><button type="button" onClick={()=>openLibraryUpload("lora")} aria-label="Upload LoRA" title="Upload LoRA"><Upload size={15}/></button><button type="button" onClick={()=>refreshLoras(diffusionModel)} aria-label="Refresh LoRAs" title="Refresh LoRAs"><RefreshCw size={15}/></button></div>';
if (!s.includes(loraActionsOld)) {
  console.error("lora actions not found");
  process.exit(1);
}
s = s.replace(loraActionsOld, loraActionsNew);

const loraOptionsOld = "{availableLoras.map(record=><option key={record.name}";
const loraOptionsNew = "{sortedAvailableLoras.map(record=><option key={record.name}";
if (!s.includes(loraOptionsOld)) {
  console.error("availableLoras.map not found");
  process.exit(1);
}
s = s.replace(loraOptionsOld, loraOptionsNew);

// Active stack map - only the lora-list map
const activeMapOld = "{loras.map((lora,index)=><div className=\"lora-row\" key={lora.name}>";
const activeMapNew = "{sortedActiveLoras.map((lora,index)=><div className=\"lora-row\" key={lora.name}>";
if (!s.includes(activeMapOld)) {
  console.error("loras.map row not found");
  process.exit(1);
}
s = s.replace(activeMapOld, activeMapNew);

// Fix strength onChange for sorted list - currently uses index into loras
// sortedActiveLoras index != loras index. Must update by name.
const strengthOld =
  "onChange={e=>setLoras(xs=>xs.map((x,i)=>i===index?{...x,strength:+e.target.value}:x))}";
const strengthNew =
  "onChange={e=>setLoras(xs=>xs.map(x=>x.name===lora.name?{...x,strength:+e.target.value}:x))}";
if (!s.includes(strengthOld)) {
  console.error("strength onChange not found");
  process.exit(1);
}
s = s.replace(strengthOld, strengthNew);

const removeOld =
  "onClick={()=>setLoras(xs=>xs.filter((_,i)=>i!==index))}";
const removeNew =
  "onClick={()=>setLoras(xs=>xs.filter(x=>x.name!==lora.name))}";
if (!s.includes(removeOld)) {
  console.error("remove onClick not found");
  process.exit(1);
}
s = s.replace(removeOld, removeNew);

fs.writeFileSync(path, s);
console.log("library sort UI patched");
