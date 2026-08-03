import React, { useMemo, useState } from "react";
import { BookOpen, Plus, Sparkles } from "lucide-react";

export type LoraStackItem = { name: string; strength: number };
export type LoraCatalogRecord = {
  name: string;
  filename: string;
  displayName?: string;
  architecture: "z-image" | "krea2" | "illustrious" | "anima" | "unknown";
  category?: "character" | "body" | "style" | "realism" | "action" | "concept" | "utility" | "other";
  tags?: string[];
  activationWords?: string[];
  usageGuide?: string;
  promptTemplate?: string;
  recommendedStrength?: number;
  sourceUrl?: string;
  /** ISO timestamp from disk mtime when known. */
  modifiedAt?: string;
  sizeBytes?: number;
};

const categoryOrder = ["character", "body", "realism", "style", "action", "concept", "utility", "other"];

export function LoraCharacterComposer({ records, stack, architecture, onAdd }: {
  records: LoraCatalogRecord[];
  stack: LoraStackItem[];
  architecture: "krea2" | "illustrious";
  onAdd: (record: LoraCatalogRecord) => void;
}) {
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => [...new Set(records.map(record => record.category || "other"))]
    .sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b)), [records]);
  const visible = category === "all" ? records : records.filter(record => (record.category || "other") === category);
  const activeWords = records
    .filter(record => stack.some(item => item.name === record.name))
    .flatMap(record => record.activationWords || [])
    .filter((word, index, words) => words.findIndex(item => item.toLowerCase() === word.toLowerCase()) === index);

  return <details className="lora-character-composer">
    <summary><span><Sparkles/> LoRA recipe composer</span><small>{architecture === "illustrious" ? "Illustrious" : "Krea"} catalog · automatic keywords</small></summary>
    <p className="composer-intro">Combine verified character, body, realism, style, action, and utility adapters. Required activation words are added to the submitted prompt automatically.</p>
    <div className="composer-filters" role="group" aria-label="LoRA category">
      <button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>All</button>
      {categories.map(item => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
    </div>
    {activeWords.length > 0 && <div className="activation-preview"><strong>Prompt activations</strong><div>{activeWords.map(word => <span key={word}>{word}</span>)}</div></div>}
    <div className="composer-catalog">
      {visible.map(record => {
        const selected = stack.some(item => item.name === record.name);
        return <article key={record.name}>
          <div className="composer-card-head"><span>{record.category || "other"}</span><strong>{record.displayName || record.name.replace(/\.safetensors$/i, "")}</strong></div>
          {record.activationWords?.length
            ? <div className="activation-chips">{record.activationWords.map(word => <span key={word}>{word}</span>)}</div>
            : <small className="no-trigger">No trigger word required</small>}
          {record.usageGuide && <p><BookOpen/>{record.usageGuide}</p>}
          <button disabled={selected} onClick={() => onAdd(record)}><Plus/>{selected ? "Added to stack" : `Add at ${record.recommendedStrength ?? 1}`}</button>
        </article>;
      })}
      {!visible.length && <p className="composer-empty">No categorized LoRAs are installed for this filter yet.</p>}
    </div>
  </details>;
}
