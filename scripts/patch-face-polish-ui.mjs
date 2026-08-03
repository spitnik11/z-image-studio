import fs from "node:fs";

const p = "app/src/main.tsx";
let s = fs.readFileSync(p, "utf8");

const old =
  '<label className="upscale-toggle"><input type="checkbox" checked={form.neuralUpscale} onChange={e=>setForm({...form,neuralUpscale:e.target.checked})}/><span><strong>Neural detail upscale</strong><small>Optional 4× detail pass, resized back to the exact canvas. Works across all Photo architectures.</small></span></label>';
const neu =
  '<label className="upscale-toggle"><input type="checkbox" checked={faceRefinement} disabled={diag?.capabilities?.[models.find(x=>x.name===diffusionModel)?.architecture as "z-image"|"krea2"|"illustrious"|"anima"]?.find(c=>c.id==="face-refinement")?.available===false} onChange={e=>setFaceRefinement(e.target.checked)}/><span><strong>Face polish</strong><small>Detect faces after generation and run a low-denoise detail pass. Saves original + refined. Works on all Photo models when Impact Pack is ready.</small></span></label><label className="upscale-toggle"><input type="checkbox" checked={form.neuralUpscale} onChange={e=>setForm({...form,neuralUpscale:e.target.checked})}/><span><strong>Neural detail upscale</strong><small>Optional 4× detail pass, resized back to the exact canvas. Works across all Photo architectures.</small></span></label>';

if (!s.includes(old)) {
  console.error("upscale toggle not found");
  process.exit(1);
}
s = s.replace(old, neu);

const oldCap =
  'capabilities={diag?.capabilities?.[models.find(x=>x.name===diffusionModel)?.architecture as "z-image"|"krea2"|"illustrious"]}';
const newCap =
  'capabilities={diag?.capabilities?.[models.find(x=>x.name===diffusionModel)?.architecture as "z-image"|"krea2"|"illustrious"|"anima"]}';
if (s.includes(oldCap)) s = s.replace(oldCap, newCap);

fs.writeFileSync(p, s);
console.log("face polish advanced UI patched");
