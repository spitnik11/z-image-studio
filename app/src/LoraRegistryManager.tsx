import React, { useEffect, useState } from "react";
import { ShieldCheck, Wrench } from "lucide-react";

type Architecture = "z-image" | "krea2" | "illustrious" | "anima" | "pony" | "unknown";
type LoraRecord = {
  name: string; filename: string; architecture: Architecture; verified: boolean; notes?: string;
  displayName?: string; category?: string; tags?: string[]; activationWords?: string[];
  usageGuide?: string; promptTemplate?: string; sourceUrl?: string; sourceModelId?: number;
  sourceVersionId?: number; sha256?: string; licenseNotes?: string;
  baseTrainingModel?: string; trainer?: string; triggerToken?: string; datasetId?: string;
  datasetVersion?: string; trainingResolution?: string; rank?: number; alpha?: number;
  steps?: number; epochs?: number; learningRate?: number; textEncoderLearningRate?: number;
  recommendedStrength?: number; verifiedAdapters?: string[];
};

export function LoraRegistryManager({ activeArchitecture, onChanged }: {
  activeArchitecture: Architecture; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<LoraRecord[]>([]);
  const [editing, setEditing] = useState<LoraRecord>();
  const [notice, setNotice] = useState("");
  const refresh = () => fetch("/api/loras").then(async response => {
    if (!response.ok) throw new Error("Could not inspect LoRA metadata.");
    setRecords(await response.json());
  });
  useEffect(() => { if (open) refresh().catch(error => setNotice(error.message)); }, [open]);
  async function save() {
    if (!editing) return;
    const response = await fetch(`/api/loras/registry/${encodeURIComponent(editing.filename)}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(editing)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error || "Could not save LoRA metadata.");
    await refresh(); onChanged(); setEditing(undefined); setNotice("LoRA metadata saved.");
  }
  return <details className="lora-registry-manager" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Wrench/> Manage LoRA compatibility <span>{records.filter(item => !item.verified || item.architecture === "unknown").length || ""}</span></summary>
    {notice && <p className="model-note">{notice}</p>}
    <div className="lora-registry-list">{records.map(record => {
      const available = record.verified && record.architecture === activeArchitecture;
      const reason = record.architecture === "unknown"
        ? "Unavailable: architecture has not been confirmed."
        : !record.verified ? "Unavailable: compatibility has not been verified."
        : record.architecture !== activeArchitecture ? `Unavailable for ${activeArchitecture}; registered for ${record.architecture}.`
        : "Available for the active model.";
      return <button key={record.filename} className={available ? "compatible" : ""} onClick={() => setEditing({...record})}>
        <strong>{record.filename.replace(/\.safetensors$/i, "")}</strong><small>{reason}</small>
      </button>;
    })}</div>
    {editing && <div className="lora-registry-editor">
      <strong>{editing.filename}</strong>
      <div className="two"><label>Display name<input value={editing.displayName||""} onChange={event => setEditing({...editing,displayName:event.target.value})}/></label><label>Category<select value={editing.category||"other"} onChange={event => setEditing({...editing,category:event.target.value})}><option value="character">Character</option><option value="body">Body</option><option value="realism">Realism</option><option value="style">Style</option><option value="action">Action</option><option value="concept">Concept</option><option value="utility">Utility</option><option value="other">Other</option></select></label></div>
      <div className="two"><label>Architecture<select value={editing.architecture} onChange={event => setEditing({...editing, architecture: event.target.value as Architecture, verifiedAdapters: []})}><option value="unknown">Unknown</option><option value="z-image">Z-Image</option><option value="krea2">Krea 2</option><option value="illustrious">Illustrious XL</option><option value="anima">Anima</option><option value="pony">Pony XL</option></select></label><label className="check-field"><input type="checkbox" checked={editing.verified} onChange={event => setEditing({...editing, verified: event.target.checked, verifiedAdapters: event.target.checked&&editing.architecture!=="unknown"?[editing.architecture]:[]})}/>Verified</label></div>
      <label>Training base<input value={editing.baseTrainingModel||""} onChange={event => setEditing({...editing,baseTrainingModel:event.target.value})}/></label>
      <div className="two"><label>Dataset ID<input value={editing.datasetId||""} onChange={event => setEditing({...editing,datasetId:event.target.value})}/></label><label>Dataset version<input value={editing.datasetVersion||""} onChange={event => setEditing({...editing,datasetVersion:event.target.value})}/></label></div>
      <div className="two"><label>Training resolution<input value={editing.trainingResolution||""} onChange={event => setEditing({...editing,trainingResolution:event.target.value})}/></label><label>Trigger token<input value={editing.triggerToken||""} onChange={event => setEditing({...editing,triggerToken:event.target.value})}/></label></div>
      <div className="lora-metadata-grid"><label>Rank<input type="number" value={editing.rank??""} onChange={event => setEditing({...editing,rank:Number(event.target.value)||undefined})}/></label><label>Alpha<input type="number" value={editing.alpha??""} onChange={event => setEditing({...editing,alpha:Number(event.target.value)||undefined})}/></label><label>Steps<input type="number" value={editing.steps??""} onChange={event => setEditing({...editing,steps:Number(event.target.value)||undefined})}/></label><label>Epochs<input type="number" value={editing.epochs??""} onChange={event => setEditing({...editing,epochs:Number(event.target.value)||undefined})}/></label></div>
      <div className="two"><label>Learning rate<input type="number" step=".000001" value={editing.learningRate??""} onChange={event => setEditing({...editing,learningRate:Number(event.target.value)||undefined})}/></label><label>Text encoder rate<input type="number" step=".000001" value={editing.textEncoderLearningRate??""} onChange={event => setEditing({...editing,textEncoderLearningRate:Number(event.target.value)||undefined})}/></label></div>
      <label>Recommended strength<input type="number" min="-2" max="2" step=".05" value={editing.recommendedStrength??1} onChange={event => setEditing({...editing,recommendedStrength:Number(event.target.value)})}/></label>
      <label>Activation words<input value={(editing.activationWords||[]).join(", ")} onChange={event => setEditing({...editing,activationWords:event.target.value.split(",").map(item=>item.trim()).filter(Boolean)})} placeholder="Comma-separated; added automatically at generation"/></label>
      <label>Catalog tags<input value={(editing.tags||[]).join(", ")} onChange={event => setEditing({...editing,tags:event.target.value.split(",").map(item=>item.trim()).filter(Boolean)})} placeholder="realism, influencer, lighting"/></label>
      <label>Usage guide<textarea value={editing.usageGuide||""} onChange={event => setEditing({...editing,usageGuide:event.target.value})}/></label>
      <label>Prompt template<textarea value={editing.promptTemplate||""} onChange={event => setEditing({...editing,promptTemplate:event.target.value})}/></label>
      <label>Source URL<input value={editing.sourceUrl||""} onChange={event => setEditing({...editing,sourceUrl:event.target.value})}/></label>
      <label>Notes<textarea value={editing.notes||""} onChange={event => setEditing({...editing,notes:event.target.value})}/></label>
      <div className="character-profile-actions"><button onClick={() => setEditing(undefined)}>Cancel</button><button onClick={save} disabled={editing.architecture==="unknown"&&editing.verified}><ShieldCheck/>Save metadata</button></div>
    </div>}
  </details>;
}
