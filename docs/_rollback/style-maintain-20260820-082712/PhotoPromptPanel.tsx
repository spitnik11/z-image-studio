import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PhotoReferences, type PhotoReference, type ReferenceCapability } from "./PhotoReferences";
import type { LoraCatalogRecord, LoraStackItem } from "./LoraCharacterComposer";

export type PhotoCharacterDraft = {
  id: string;
  prompt: string;
  negative: string;
  references: PhotoReference[];
};

type PromptTab = "prompt" | "negative" | "face" | "pose" | "style";

export function PhotoPromptPanel({
  prompt, negative, onPrompt, onNegative,
  references, onReferences, characters, onCharacters,
  architecture, capabilities, busy,
  consistentCharacter, faceRefinement, onConsistencyChange,
  availableLoras, loras, onAddLora
}: {
  prompt: string; negative: string;
  onPrompt: (value: string) => void; onNegative: (value: string) => void;
  references: PhotoReference[]; onReferences: (next: PhotoReference[]) => void;
  characters: PhotoCharacterDraft[]; onCharacters: (next: PhotoCharacterDraft[]) => void;
  architecture?: "z-image" | "krea2" | "illustrious" | "anima" | "unknown";
  capabilities?: ReferenceCapability[]; busy?: boolean;
  consistentCharacter: boolean; faceRefinement: boolean;
  onConsistencyChange: (consistent: boolean, refine: boolean) => void;
  availableLoras: LoraCatalogRecord[]; loras: LoraStackItem[];
  onAddLora: (record: LoraCatalogRecord) => void;
}) {
  const [tab, setTab] = useState<PromptTab>("prompt");
  const [scope, setScope] = useState<string>("global");
  const activeCharacter = characters.find(character => character.id === scope);
  const activeReferences = activeCharacter?.references || references;
  const totalReferences = references.length + characters.reduce((sum, character) => sum + character.references.length, 0);
  const remainingSlots = Math.max(0, 4 - totalReferences);
  const setActiveReferences = (next: PhotoReference[]) => {
    if (!activeCharacter) return onReferences(next);
    onCharacters(characters.map(character => character.id === activeCharacter.id ? { ...character, references: next } : character));
  };
  const modeReferences = (modes: PhotoReference["mode"][]) => activeReferences.filter(reference => modes.includes(reference.mode));
  const replaceModes = (modes: PhotoReference["mode"][], next: PhotoReference[]) =>
    setActiveReferences([...activeReferences.filter(reference => !modes.includes(reference.mode)), ...next]);
  const addCharacter = () => {
    const next = { id: crypto.randomUUID(), prompt: "", negative: "", references: [] };
    onCharacters([...characters, next]);
    setScope(next.id);
    setTab("prompt");
  };
  const removeCharacter = (id: string) => {
    onCharacters(characters.filter(character => character.id !== id));
    if (scope === id) setScope("global");
  };
  const styleLoras = availableLoras.filter(record => ["style", "realism"].includes(record.category || ""));

  return <section className="photo-prompt-panel">
    <div className="prompt-scope-bar">
      <div className="prompt-scopes" role="tablist" aria-label="Prompt subject">
        <button className={scope === "global" ? "active" : ""} onClick={() => setScope("global")}>Global</button>
        {characters.map((character, index) => <button key={character.id} className={scope === character.id ? "active" : ""} onClick={() => setScope(character.id)}>Character {index + 1}</button>)}
      </div>
      <button className="add-character" onClick={addCharacter} disabled={characters.length >= 8}><Plus/>Add Character</button>
    </div>
    {activeCharacter&&<div className="character-block-head"><strong>{`Character ${characters.indexOf(activeCharacter) + 1}`}</strong><button onClick={() => removeCharacter(activeCharacter.id)}><Trash2/>Remove</button></div>}
    <div className="prompt-tabs" role="tablist" aria-label={activeCharacter ? "Character controls" : "Global controls"}>
      {(["prompt", "negative", "face", "pose", "style"] as PromptTab[]).map(item =>
        <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
    </div>
    <div className="prompt-tab-content">
      {tab === "prompt"&&<label><span>{activeCharacter ? "Character description" : "Scene and base prompt"}</span><textarea autoFocus value={activeCharacter?.prompt ?? prompt} onChange={event => activeCharacter
        ? onCharacters(characters.map(character => character.id === activeCharacter.id ? { ...character, prompt: event.target.value } : character))
        : onPrompt(event.target.value)} placeholder={activeCharacter ? "Describe this character’s identity, clothing, position, and action…" : "Describe the complete scene, lighting, and composition…"} maxLength={activeCharacter ? 2000 : 4000}/><small>{(activeCharacter?.prompt ?? prompt).length}/{activeCharacter ? 2000 : 4000}</small></label>}
      {tab === "negative"&&<label><span>{activeCharacter ? "Character exclusions" : "Global negative prompt"}</span><textarea value={activeCharacter?.negative ?? negative} onChange={event => activeCharacter
        ? onCharacters(characters.map(character => character.id === activeCharacter.id ? { ...character, negative: event.target.value } : character))
        : onNegative(event.target.value)} placeholder="Things to avoid…" maxLength={activeCharacter ? 1000 : 2000}/></label>}
      {tab === "face"&&<PhotoReferences
        references={modeReferences(["face", "direct"])} onChange={next => replaceModes(["face", "direct"], next)}
        disabled={busy} architecture={architecture} capabilities={capabilities}
        consistentCharacter={consistentCharacter} faceRefinement={faceRefinement}
        onConsistencyChange={onConsistencyChange} defaultMode="face" allowedModes={["face", "direct"]}
        remainingSlots={remainingSlots} showConsistency={!activeCharacter} title={activeCharacter ? "Character face reference" : "Face and identity references"}
      />}
      {tab === "pose"&&<PhotoReferences
        references={modeReferences(["pose"])} onChange={next => replaceModes(["pose"], next)}
        disabled={busy} architecture={architecture} capabilities={capabilities}
        consistentCharacter={consistentCharacter} faceRefinement={faceRefinement}
        onConsistencyChange={onConsistencyChange} defaultMode="pose" allowedModes={["pose"]}
        remainingSlots={remainingSlots} showConsistency={false} title={activeCharacter ? "Character pose reference" : "Global pose references"}
      />}
      {tab === "style"&&<div className="style-lora-tab">
        <div><strong>LoRA-backed style</strong><p>Style images aren’t supported by these architectures. Add verified style LoRAs instead; their effect is global in this MVP.</p></div>
        <div className="style-lora-grid">{styleLoras.map(record => {
          const added = loras.some(item => item.name === record.name);
          return <button key={record.name} disabled={added} onClick={() => onAddLora(record)}><span>{record.displayName || record.name.replace(/\.safetensors$/i, "")}</span><small>{added ? "Added" : `Add at ${record.recommendedStrength ?? 1}`}</small></button>;
        })}{!styleLoras.length&&<p>No verified style LoRAs are installed for this model.</p>}</div>
      </div>}
    </div>
    {totalReferences>0&&<small className="reference-total">{totalReferences}/4 references across global and character blocks</small>}
  </section>;
}
