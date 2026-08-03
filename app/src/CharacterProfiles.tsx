import React, { useEffect, useState } from "react";
import { Plus, Save, Trash2, UserRound } from "lucide-react";

export type CharacterProfile = {
  id: string; name: string; triggerToken: string; masterReferenceImages: string[];
  stableIdentity: string; hairstyle: string; eyeColor: string; bodyCharacteristics: string;
  defaultOutfit: string; changeableAttributes: string[]; notes: string;
  preferredModel: string; identityWeight: number;
};

type Draft = Omit<CharacterProfile, "id" | "masterReferenceImages" | "changeableAttributes"> & {
  id?: string; masterReferenceImages: string; changeableAttributes: string;
};
const empty: Draft = {
  name: "", triggerToken: "", masterReferenceImages: "", stableIdentity: "", hairstyle: "",
  eyeColor: "", bodyCharacteristics: "", defaultOutfit: "", changeableAttributes: "outfit, background",
  notes: "", preferredModel: "", identityWeight: .7
};

export function CharacterProfiles({ models, activeModel, referenceImages, onApply }: {
  models: { name: string; architecture: string }[];
  activeModel: string;
  referenceImages: string[];
  onApply: (profile: CharacterProfile) => void;
}) {
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [notice, setNotice] = useState("");
  const refresh = () => fetch("/api/characters").then(async response => {
    if (!response.ok) throw new Error("Could not load character profiles.");
    setProfiles(await response.json());
  });
  useEffect(() => { refresh().catch(error => setNotice(error.message)); }, []);

  function edit(profile?: CharacterProfile) {
    setDraft(profile ? {
      ...profile,
      masterReferenceImages: profile.masterReferenceImages.join("\n"),
      changeableAttributes: profile.changeableAttributes.join(", ")
    } : { ...empty, preferredModel: activeModel, masterReferenceImages: referenceImages.join("\n") });
    setEditing(true); setNotice("");
  }
  async function save() {
    const body = {
      ...draft,
      masterReferenceImages: draft.masterReferenceImages.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
      changeableAttributes: draft.changeableAttributes.split(",").map(value => value.trim()).filter(Boolean)
    };
    const response = await fetch(draft.id ? `/api/characters/${draft.id}` : "/api/characters", {
      method: draft.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error || "Could not save the character.");
    await refresh(); setSelected(payload.id); setEditing(false);
  }
  async function remove() {
    if (!draft.id) return;
    const response = await fetch(`/api/characters/${draft.id}`, { method: "DELETE" });
    if (!response.ok) return setNotice("Could not delete the character.");
    await refresh(); setSelected(""); setEditing(false);
  }
  const current = profiles.find(profile => profile.id === selected);
  return <section className="character-profiles">
    <div className="section-title"><span><UserRound/> Character</span><small>{profiles.length} saved</small></div>
    <p className="character-intro">Save identity details and references once, then reuse them across prompts.</p>
    <div className="character-profile-row">
      <select aria-label="Saved character" value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">No saved character</option>
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
      <button className="character-new" title="New character" aria-label="New character" onClick={() => edit()}><Plus/></button>
    </div>
    {current && <div className="character-summary"><div><strong>{current.name}</strong><small>{current.triggerToken || "No trigger token"} · {current.masterReferenceImages.length} reference{current.masterReferenceImages.length === 1 ? "" : "s"}</small></div><div className="character-profile-actions"><button className="character-use" onClick={() => onApply(current)}>Use character</button><button className="character-edit" onClick={() => edit(current)}>Edit</button></div></div>}
    {notice && <p className="model-note">{notice}</p>}
    {editing && <div className="character-editor">
      <div className="character-editor-head"><div><strong>{draft.id ? "Edit character" : "New character"}</strong><small>Identity traits stay fixed; outfit and background can change.</small></div></div>
      <label>Name<input value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})}/></label>
      <label>Unique trigger token<input value={draft.triggerToken} onChange={event => setDraft({...draft, triggerToken: event.target.value})}/></label>
      <label>Stable identity<textarea value={draft.stableIdentity} onChange={event => setDraft({...draft, stableIdentity: event.target.value})} placeholder="Facial features and traits that should stay consistent"/></label>
      <div className="two"><label>Hairstyle<input value={draft.hairstyle} onChange={event => setDraft({...draft, hairstyle: event.target.value})}/></label><label>Eye color<input value={draft.eyeColor} onChange={event => setDraft({...draft, eyeColor: event.target.value})}/></label></div>
      <label>Body characteristics<input value={draft.bodyCharacteristics} onChange={event => setDraft({...draft, bodyCharacteristics: event.target.value})}/></label>
      <label>Default outfit<input value={draft.defaultOutfit} onChange={event => setDraft({...draft, defaultOutfit: event.target.value})}/></label>
      <label>Changeable attributes<input value={draft.changeableAttributes} onChange={event => setDraft({...draft, changeableAttributes: event.target.value})}/></label>
      <label>Preferred model<select value={draft.preferredModel} onChange={event => setDraft({...draft, preferredModel: event.target.value})}><option value="">Use active model</option>{models.filter(model => model.architecture !== "unknown").map(model => <option key={model.name}>{model.name}</option>)}</select></label>
      <label>Identity weight<input type="number" min="0" max="2" step=".05" value={draft.identityWeight} onChange={event => setDraft({...draft, identityWeight: Number(event.target.value)})}/></label>
      <label>Master references<textarea value={draft.masterReferenceImages} onChange={event => setDraft({...draft, masterReferenceImages: event.target.value})} placeholder="Captured automatically from current references, one stored image per line"/></label>
      <label>Notes<textarea value={draft.notes} onChange={event => setDraft({...draft, notes: event.target.value})}/></label>
      <div className="character-profile-actions editor-actions">{draft.id && <button className="character-delete" onClick={remove}><Trash2/>Delete</button>}<button className="character-cancel" onClick={() => setEditing(false)}>Cancel</button><button className="character-save" onClick={save}><Save/>Save character</button></div>
    </div>}
  </section>;
}
