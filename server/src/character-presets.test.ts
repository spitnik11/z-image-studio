import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CharacterPresetStore, presetDatasetHandoff, presetGenerationInput } from "./character-presets.js";

function store() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"character-presets-"));
  return new CharacterPresetStore(path.join(directory,"presets.json"));
}

const input={
  name:"Mara",architecture:"krea2" as const,keywords:["adult creator","red hair"],triggers:["mara_person"],
  preferredLoras:[{name:"mara.safetensors",strength:.8}],
  referenceImages:[
    {path:"z-image-studio/mara-face.png",tag:"face" as const},
    {path:"z-image-studio/mara-pose.png",tag:"pose" as const}
  ],
  notes:"Reference-based consistency."
};

describe("character presets",()=>{
  it("creates, updates, lists, and removes presets without losing stable fields",()=>{
    const presets=store();
    const created=presets.create(input);
    expect(presets.get(created.id)?.name).toBe("Mara");
    const updated=presets.update(created.id,{...input,name:"Mara v2"});
    expect(updated?.id).toBe(created.id);
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(presets.list()).toHaveLength(1);
    expect(presets.remove(created.id)).toBe(true);
    expect(presets.list()).toEqual([]);
  });

  it("builds generation and Dataset handoffs with tagged references",()=>{
    const created=store().create(input);
    const generation=presetGenerationInput(created);
    expect(generation.confirmedLoras).toEqual(input.preferredLoras);
    expect(generation.references).toEqual([
      {image:"z-image-studio/mara-face.png",mode:"face",strength:.8},
      {image:"z-image-studio/mara-pose.png",mode:"pose",strength:.75}
    ]);
    const dataset=presetDatasetHandoff(created);
    expect(dataset.masterReference).toBe("z-image-studio/mara-face.png");
    expect(dataset.additionalImages).toHaveLength(2);
  });

  it("rejects absolute and traversal reference paths",()=>{
    const presets=store();
    expect(()=>presets.create({...input,referenceImages:[{path:"../secret.png",tag:"face"}]})).toThrow(/relative path/);
    expect(()=>presets.create({...input,referenceImages:[{path:"C:\\outside.png",tag:"face"}]})).toThrow(/relative path/);
  });

  it("maps body references to structural/direct guidance",()=>{
    const created=store().create({...input,referenceImages:[{path:"z-image-studio/body.png",tag:"body"}]});
    expect(presetGenerationInput(created).references[0].mode).toBe("direct");
  });
});
