import React,{useEffect,useMemo,useState} from "react";
import {AlertTriangle,Check,Library,Search,Sparkles} from "lucide-react";
type Architecture="z-image"|"krea2"|"illustrious";
type Entry={id:string;architecture:Architecture;category:string;complexity:"simple"|"standard"|"detailed";style:string;promptTemplate:string;requiredLora?:string;resolved:boolean;safetyNotes:string[]};
type Preset={id:string;name:string;prompt:string};
type Proposal={filename:string;weight:number;confidence:number;reason:string;category?:string};
export type EngineDraft={architecture:Architecture;prompt:string;negativePrompt:string;loras:Array<{name:string;strength:number}>;proposedLoras:Proposal[];entryIds:string[];characters:unknown[];references:unknown[]};
async function json<T>(url:string,init?:RequestInit){const r=await fetch(url,{headers:{"content-type":"application/json"},...init});const x=await r.json();if(!r.ok)throw new Error(x.error||"Prompt Studio request failed");return x as T}
export function PromptStudio({architecture,onApply,onOpenCharacters,onOpenReferences,expanded=false}:{architecture:Architecture;onApply:(draft:EngineDraft)=>void;onOpenCharacters:()=>void;onOpenReferences:()=>void;expanded?:boolean}){
 const [entries,setEntries]=useState<Entry[]>([]),[negatives,setNegatives]=useState<Preset[]>([]);
 const [target,setTarget]=useState<Architecture>(architecture),[query,setQuery]=useState(""),[keywords,setKeywords]=useState(""),[complexity,setComplexity]=useState("standard"),[category,setCategory]=useState(""),[style,setStyle]=useState(""),[requiredLora,setRequiredLora]=useState(""),[selected,setSelected]=useState<string[]>([]),[negative,setNegative]=useState("");
 const [draft,setDraft]=useState<EngineDraft>(),[confirmed,setConfirmed]=useState<string[]>([]),[message,setMessage]=useState("");
 useEffect(()=>{json<{entries:Entry[];negativePresets:Preset[]}>("/api/prompt-library").then(x=>{setEntries(x.entries);setNegatives(x.negativePresets)}).catch(e=>setMessage(e.message))},[]);
 useEffect(()=>setTarget(architecture),[architecture]);
 const scoped=useMemo(()=>entries.filter(e=>e.architecture===target),[entries,target]);
 const categories=useMemo(()=>[...new Set(scoped.map(e=>e.category))].sort(),[scoped]);
 const styles=useMemo(()=>[...new Set(scoped.map(e=>e.style).filter(Boolean))].sort(),[scoped]);
 const requiredLoras=useMemo(()=>[...new Set(scoped.map(e=>e.requiredLora).filter((x):x is string=>Boolean(x)))].sort(),[scoped]);
 const visible=useMemo(()=>scoped.filter(e=>e.complexity===complexity&&(!category||e.category===category)&&(!style||e.style===style)&&(!requiredLora||e.requiredLora===requiredLora)&&(!query||JSON.stringify(e).toLowerCase().includes(query.toLowerCase()))),[scoped,complexity,category,style,requiredLora,query]);
 async function build(){
  setMessage("");
  try{
   const next=await json<EngineDraft>("/api/prompt/generate",{method:"POST",body:JSON.stringify({architecture:target,entryIds:selected,keywords:keywords.trim()?[keywords.trim()]:[],complexity,negativePresetId:negative})});
   setDraft(next);setConfirmed([]);
  }catch(e:any){setMessage(e.message)}
 }
 async function apply(){
  if(!draft)return;
  const loras=draft.proposedLoras.filter(p=>confirmed.includes(p.filename)).map(p=>({name:p.filename,strength:p.weight}));
  const next=await json<EngineDraft>("/api/prompt/generate",{method:"POST",body:JSON.stringify({architecture:target,entryIds:selected,keywords:keywords.trim()?[keywords.trim()]:[],complexity,negativePresetId:negative,confirmedLoras:loras})});
  const validated=await json<{ok:boolean;blocks:string[];warnings:string[];normalized:EngineDraft}>("/api/prompt/validate",{method:"POST",body:JSON.stringify(next)});
  if(!validated.ok){setMessage(validated.blocks.join(" "));return}
  setMessage(validated.warnings.join(" "));onApply(validated.normalized);
 }
 return <section className="prompt-studio">
  <details open={expanded||undefined}>
   <summary><span><Library/> Prompt Studio</span><small>Library → safe LoRA proposal → Photo draft</small></summary>
   <div className="prompt-studio-controls">
    <div className="prompt-architecture-readonly"><span>Active model family</span><strong>{target==="krea2"?"Krea 2":target==="illustrious"?"Illustrious XL":"Z-Image"}</strong><small>Change this from Model above. Prompt Studio follows it automatically.</small></div>
    <label>Complexity<select value={complexity} onChange={e=>{setComplexity(e.target.value);setSelected([])}}><option value="simple">Simple</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select></label>
    <label>Negative preset<select value={negative} onChange={e=>setNegative(e.target.value)}><option value="">Entry default</option>{negatives.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
    <label>Category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{categories.map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Style<select value={style} onChange={e=>setStyle(e.target.value)}><option value="">All styles</option>{styles.map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Required LoRA<select value={requiredLora} onChange={e=>setRequiredLora(e.target.value)}><option value="">Any / prompt only</option>{requiredLoras.map(value=><option key={value}>{value.replace(/\.safetensors$/i,"")}</option>)}</select></label>
   </div>
   <label className="prompt-library-search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search the prompt library…"/></label>
   <label className="prompt-scenario-keywords"><span>Scenario details</span><input value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="Extra scene, action, lighting, or camera details…"/></label>
   <div className="prompt-studio-links"><button onClick={onOpenCharacters}>Character Library</button><button onClick={onOpenReferences}>Character & reference controls</button><button onClick={()=>{setQuery("");setCategory("");setStyle("");setRequiredLora("")}}>Clear filters</button><span>{selected.length} selected · {visible.length} shown</span></div>
   <div className="prompt-entry-list">{visible.map(entry=><label className={selected.includes(entry.id)?"prompt-entry selected":"prompt-entry"} key={entry.id}><input type="checkbox" checked={selected.includes(entry.id)} onChange={()=>setSelected(s=>s.includes(entry.id)?s.filter(id=>id!==entry.id):[...s,entry.id])}/><span><strong>{entry.id} · {entry.style}</strong><small>{entry.category} · {entry.requiredLora||"Prompt only"}</small></span>{entry.resolved?<Check/>:<AlertTriangle/>}</label>)}{!visible.length&&<p className="prompt-library-empty">No {complexity} {target} entries yet. Choose another complexity or architecture.</p>}</div>
   <button className="prompt-build" onClick={build} disabled={!selected.length&&!keywords.trim()}><Sparkles/>Build prompt and propose LoRAs</button>
   {draft&&<div className="prompt-result"><div><strong>Generated prompt</strong><p>{draft.prompt}</p></div>{draft.proposedLoras.length?<div className="proposal-list"><strong>Confirm LoRAs</strong>{draft.proposedLoras.map(p=><label key={p.filename}><input type="checkbox" checked={confirmed.includes(p.filename)} onChange={()=>setConfirmed(s=>s.includes(p.filename)?s.filter(x=>x!==p.filename):[...s,p.filename])}/><span>{p.filename}<small>{p.weight} · {p.reason}</small></span></label>)}</div>:<p>No matching LoRA required.</p>}<button className="prompt-apply" onClick={apply}>Apply to Photo workspace</button></div>}
   {message&&<p className="prompt-studio-message">{message}</p>}
  </details>
 </section>
}
