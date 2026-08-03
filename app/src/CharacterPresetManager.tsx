import React,{useEffect,useMemo,useRef,useState} from "react";
import {ArrowRight,ImagePlus,Plus,Save,Trash2,X} from "lucide-react";
import type {LoraCatalogRecord,LoraStackItem} from "./LoraCharacterComposer";

export type CharacterPreset={
 id:string;name:string;architecture:"z-image"|"krea2";keywords:string[];triggers:string[];
 preferredLoras:Array<{name:string;strength:number}>;
 referenceImages:Array<{path:string;tag:"face"|"body"|"pose"}>;notes:string;
};
export type PresetGeneration={
 architecture:"z-image"|"krea2";keywords:string[];confirmedLoras:Array<{name:string;strength:number}>;
 references:Array<{image:string;mode:"face"|"pose"|"direct";strength:number}>;
};
export type PresetDatasetHandoff={
 name:string;architecture:"z-image"|"krea2";characterDescription:string;masterReference:string;
 additionalImages:string[];note:string;
};
type Draft=Omit<CharacterPreset,"id">;
const blank:Draft={name:"",architecture:"krea2",keywords:[],triggers:[],preferredLoras:[],referenceImages:[],notes:""};
async function json<T>(url:string,init?:RequestInit){const r=await fetch(url,{headers:{"content-type":"application/json"},...init});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||`Request failed (${r.status})`);return x as T}
const split=(value:string)=>value.split(",").map(x=>x.trim()).filter(Boolean);
const imageUrl=(value:string)=>{const filename=value.split("/").pop()||value;return `/api/image?${new URLSearchParams({filename,subfolder:"z-image-studio",type:"input"})}`};

export function CharacterPresetManager({availableLoras,currentLoras,onUse,onPromote,onClose,embedded=false}:{
 availableLoras:LoraCatalogRecord[];currentLoras:LoraStackItem[];
 onUse:(preset:PresetGeneration,name:string)=>void;
 onPromote:(handoff:PresetDatasetHandoff)=>void;onClose:()=>void;embedded?:boolean;
}){
 const input=useRef<HTMLInputElement>(null);
 const [items,setItems]=useState<CharacterPreset[]>([]),[selected,setSelected]=useState(""),[draft,setDraft]=useState<Draft>(blank);
 const [keywords,setKeywords]=useState(""),[triggers,setTriggers]=useState(""),[query,setQuery]=useState(""),[message,setMessage]=useState("");
 const [uploadTag,setUploadTag]=useState<"face"|"body"|"pose">("face"),[busy,setBusy]=useState(false);
 const visible=useMemo(()=>items.filter(item=>!query||JSON.stringify(item).toLowerCase().includes(query.toLowerCase())),[items,query]);
 const refresh=()=>json<CharacterPreset[]>("/api/character-presets").then(setItems);
 useEffect(()=>{refresh().catch(e=>setMessage(e.message))},[]);
 function edit(item?:CharacterPreset){
  setSelected(item?.id||"");setDraft(item?{...item,referenceImages:[...item.referenceImages],preferredLoras:[...item.preferredLoras]}:blank);
  setKeywords(item?.keywords.join(", ")||"");setTriggers(item?.triggers.join(", ")||"");setMessage("");
 }
 async function save(){
  setBusy(true);setMessage("");
  try{
   const payload={...draft,keywords:split(keywords),triggers:split(triggers)};
   const item=await json<CharacterPreset>(selected?`/api/character-presets/${selected}`:"/api/character-presets",{method:selected?"PUT":"POST",body:JSON.stringify(payload)});
   await refresh();edit(item);setMessage("Character preset saved.");
  }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
 }
 async function upload(files:FileList|null){
  if(!files?.length)return;setBusy(true);
  try{
   const body=new FormData();Array.from(files).slice(0,4).forEach(file=>body.append("images",file));
   const r=await fetch("/api/character-presets/images",{method:"POST",body});const x=await r.json();if(!r.ok)throw new Error(x.error);
   setDraft(current=>({...current,referenceImages:[...current.referenceImages,...x.map((file:{path:string})=>({path:file.path,tag:uploadTag}))].slice(0,12)}));
  }catch(e:any){setMessage(e.message)}finally{setBusy(false);if(input.current)input.current.value=""}
 }
 async function remove(){
  if(!selected||!confirm(`Delete “${draft.name}”? Uploaded source images will be preserved.`))return;
  await fetch(`/api/character-presets/${selected}`,{method:"DELETE"});await refresh();edit();setMessage("Preset deleted; source images were preserved.");
 }
 async function use(){
  if(!selected)return;const payload=await json<PresetGeneration>(`/api/character-presets/${selected}/generation`);
  onUse(payload,draft.name);
 }
 async function promote(){
  if(!selected)return;onPromote(await json<PresetDatasetHandoff>(`/api/character-presets/${selected}/promote`));
 }
 const compatible=availableLoras.filter(lora=>lora.architecture===draft.architecture);
 return <div className={embedded?"character-preset-page":"character-preset-backdrop"} role={embedded?undefined:"dialog"} aria-modal={embedded?undefined:true} aria-label="Character preset library">
  <section className="character-preset-workspace">
   <header><div><span className="eyebrow">CHARACTER LIBRARY</span><h2>Reusable identity presets</h2><p>Organize prompts, verified LoRAs, and tagged face, body, and pose references.</p></div><button className={embedded?"back-button":"icon"} onClick={onClose} aria-label={embedded?"Back to Library":"Close Character Library"}>{embedded?"Back to Library":<X/>}</button></header>
   <div className="character-preset-layout">
    <aside><div className="preset-list-tools"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search characters…"/><button onClick={()=>edit()}><Plus/>New</button></div>
     <div className="preset-list">{visible.map(item=><button key={item.id} className={selected===item.id?"active":""} onClick={()=>edit(item)}><strong>{item.name}</strong><small>{item.architecture==="krea2"?"Krea 2":"Z-Image"} · {item.referenceImages.length} references</small></button>)}{!visible.length&&<p>No presets yet.</p>}</div>
    </aside>
    <main>
     <div className="preset-form-grid"><label>Name<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>Architecture<select value={draft.architecture} onChange={e=>setDraft({...draft,architecture:e.target.value as Draft["architecture"],preferredLoras:[]})}><option value="krea2">Krea 2</option><option value="z-image">Z-Image</option></select></label></div>
     <div className="preset-advisory">{draft.architecture==="krea2"?"Krea Identity Edit provides the strongest installed reference consistency.":"Z-Image references are approximate. Use a trained face/character LoRA for a reliable identity lock."}</div>
     <label>Character keywords<input value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="adult creator, red hair, green eyes…"/><small>Comma separated.</small></label>
     <label>Trigger words<input value={triggers} onChange={e=>setTriggers(e.target.value)} placeholder="mara_person"/><small>Comma separated; only use confirmed triggers.</small></label>
     <section className="preset-loras"><div><strong>Preferred LoRAs</strong><button type="button" onClick={()=>setDraft({...draft,preferredLoras:currentLoras.filter(item=>compatible.some(record=>record.name===item.name))})}>Use current stack</button></div>
      <div>{compatible.map(record=>{const checked=draft.preferredLoras.some(item=>item.name===record.name);return <label key={record.name}><input type="checkbox" checked={checked} onChange={()=>setDraft({...draft,preferredLoras:checked?draft.preferredLoras.filter(item=>item.name!==record.name):[...draft.preferredLoras,{name:record.name,strength:record.recommendedStrength??.8}]})}/><span>{record.displayName||record.name}<small>{record.category||"other"} · {record.recommendedStrength??.8}</small></span></label>})}</div>
     </section>
     <section className="preset-images"><div className="preset-images-head"><div><strong>Reference images</strong><small>{draft.referenceImages.length}/12 · associations can be removed without deleting source files</small></div><select value={uploadTag} onChange={e=>setUploadTag(e.target.value as typeof uploadTag)}><option value="face">Face</option><option value="body">Body / structure</option><option value="pose">Pose</option></select><button onClick={()=>input.current?.click()} disabled={busy||draft.referenceImages.length>=12}><ImagePlus/>Add images</button></div>
      <input ref={input} hidden type="file" accept=".png,.jpg,.jpeg,.webp" multiple onChange={e=>upload(e.target.files)}/>
      <div className="preset-image-grid">{draft.referenceImages.map((image,index)=><article key={`${image.path}-${index}`}><img src={imageUrl(image.path)} alt={`${image.tag} reference`}/><select value={image.tag} onChange={e=>setDraft({...draft,referenceImages:draft.referenceImages.map((item,i)=>i===index?{...item,tag:e.target.value as typeof image.tag}:item)})}><option value="face">Face</option><option value="body">Body</option><option value="pose">Pose</option></select><button onClick={()=>setDraft({...draft,referenceImages:draft.referenceImages.filter((_,i)=>i!==index)})} aria-label="Remove reference association"><Trash2/></button></article>)}</div>
     </section>
     <label>Notes<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})} placeholder="Identity guidance, preferred weights, known limitations…"/></label>
     {message&&<p className="preset-message">{message}</p>}
     <footer><button className="delete" disabled={!selected} onClick={remove}><Trash2/>Delete preset</button><div><button disabled={!selected} onClick={promote}>Send to Dataset <ArrowRight/></button><button disabled={!selected} onClick={use}>Use in Photo</button><button className="primary" disabled={busy||!draft.name.trim()} onClick={save}><Save/>{busy?"Saving…":"Save preset"}</button></div></footer>
    </main>
   </div>
  </section>
 </div>
}
