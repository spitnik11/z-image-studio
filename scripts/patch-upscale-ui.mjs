import fs from "node:fs";

const path = "Z:/codex app/app/src/main.tsx";
let c = fs.readFileSync(path, "utf8");
const origLen = c.length;
if (origLen < 10_000) throw new Error(`file too small: ${origLen}`);

if (!c.includes("upscale-catalog")) {
  const marker = 'import { LibraryUpload, type LibraryKind } from "./LibraryUpload";';
  if (!c.includes(marker)) throw new Error("LibraryUpload import not found");
  c = c.replace(
    marker,
    `${marker}\nimport { DEFAULT_UPSCALE_MODEL, UPSCALE_CATALOG, recommendedUpscaleForArchitecture, upscaleCatalogByFilename } from "./upscale-catalog";`
  );
  console.log("import ok");
}

c = c.replace('upscaleModel:"RealESRGAN_x4plus.pth"}', "upscaleModel:DEFAULT_UPSCALE_MODEL}");
c = c.replace(
  'upscaleModel:r.upscaleModel||"RealESRGAN_x4plus.pth"',
  "upscaleModel:r.upscaleModel||DEFAULT_UPSCALE_MODEL"
);

const oldBlock =
  '<label className="upscale-toggle"><input type="checkbox" checked={form.neuralUpscale} onChange={e=>setForm({...form,neuralUpscale:e.target.checked})}/><span><strong>Neural detail upscale</strong><small>Optional 4× detail pass, resized back to the exact canvas. Works across all Photo architectures.</small></span></label>{form.neuralUpscale&&<label>Upscale model<select aria-label="Upscale model" value={form.upscaleModel} onChange={e=>setForm({...form,upscaleModel:e.target.value})}><option value="RealESRGAN_x4plus.pth">RealESRGAN ×4 Plus</option><option value="remacri_original.safetensors">Remacri ×4 (noncommercial license)</option></select></label>}';

const newBlock =
  '<label className="upscale-toggle"><input type="checkbox" checked={form.neuralUpscale} onChange={e=>{const arch=models.find(x=>x.name===diffusionModel)?.architecture;const next=e.target.checked;setForm({...form,neuralUpscale:next,upscaleModel:next&&!form.neuralUpscale?recommendedUpscaleForArchitecture(arch):form.upscaleModel})}}/><span><strong>Neural detail upscale</strong><small>Optional 4x pixel detail pass after decode, then Lanczos back to the exact canvas. Same path for Z-Image, Krea 2, Illustrious, and Anima — pick a model below for the use case.</small></span></label>{form.neuralUpscale&&<label>Upscale model<select aria-label="Upscale model" value={form.upscaleModel} onChange={e=>setForm({...form,upscaleModel:e.target.value})}>{UPSCALE_CATALOG.map(entry=>{const arch=models.find(x=>x.name===diffusionModel)?.architecture;const rec=arch&&entry.recommendedFor.includes(arch as "z-image"|"krea2"|"illustrious"|"anima");return <option key={entry.filename} value={entry.filename}>{entry.optionLabel}{rec?" ★":""}</option>})}</select><small>{(upscaleCatalogByFilename(form.upscaleModel)||UPSCALE_CATALOG[0]).useCase}{(upscaleCatalogByFilename(form.upscaleModel)||UPSCALE_CATALOG[0]).license.includes("noncommercial")?` License: ${(upscaleCatalogByFilename(form.upscaleModel)||UPSCALE_CATALOG[0]).license}.`:""}</small></label>}';

if (!c.includes(oldBlock)) throw new Error("upscale block not found");
c = c.replace(oldBlock, newBlock);
console.log("block ok");

c = c.replace(
  '<div><dt>Neural upscale</dt><dd>{selected.neuralUpscale?"Real-ESRGAN":"Off"}</dd></div>',
  '<div><dt>Neural upscale</dt><dd>{selected.neuralUpscale?(upscaleCatalogByFilename(selected.upscaleModel||"")?.label||selected.upscaleModel||"On"):"Off"}</dd></div>'
);
c = c.replace(
  '<div><dt>Face comparison</dt><dd>{originalImage?"Original + refined":selected.faceRefinement?"Refined":"Off"}</dd></div>',
  '<div><dt>Face polish</dt><dd>{selected.faceRefinement?"On":"Off"}</dd></div>'
);

// Advanced Face polish copy if present in this shell
c = c.replace(
  "Detect faces after generation and run a low-denoise detail pass. Saves original + refined. Works on all Photo models when Impact Pack is ready.",
  "Optional. Detect faces after generation and run a low-denoise detail pass; the polished image is the only output. Works on all Photo models when Impact Pack is ready."
);

if (c.length < 10_000) throw new Error("refusing short write");
fs.writeFileSync(path, c, "utf8");
console.log("wrote", c.length, "from", origLen);
console.log({
  map: c.includes("UPSCALE_CATALOG.map"),
  import: c.includes("upscale-catalog"),
  useCase: c.includes("upscaleCatalogByFilename(form.upscaleModel)"),
  rec: c.includes("recommendedUpscaleForArchitecture")
});
