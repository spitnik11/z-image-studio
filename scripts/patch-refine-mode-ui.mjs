/**
 * Rebuild Improve panel: Refine (default, pose-preserving) vs Rewrite,
 * low-denoise presets, keep seed, structure lock + face polish defaults.
 */
import fs from "node:fs";

const path = "Z:/codex app/app/src/main.tsx";
let c = fs.readFileSync(path, "utf8");
const orig = c.length;
if (orig < 40_000) throw new Error("main too small");

// State: add mode + lock if missing
if (!c.includes("img2imgMode")) {
  const mark =
    "const [img2imgStrength,setImg2imgStrength]=useState(1); const [img2imgNoise,setImg2imgNoise]=useState(0); const [improveSource,setImproveSource]=useState(null as null|{filename:string;subfolder:string;type:string;label:string});";
  if (!c.includes(mark)) throw new Error("improve state block missing");
  c = c.replace(
    mark,
    "const [img2imgStrength,setImg2imgStrength]=useState(1); const [img2imgNoise,setImg2imgNoise]=useState(0); const [img2imgMode,setImg2imgMode]=useState(\"refine\" as \"refine\"|\"rewrite\"); const [img2imgLockStructure,setImg2imgLockStructure]=useState(true); const [improveSource,setImproveSource]=useState(null as null|{filename:string;subfolder:string;type:string;label:string});"
  );
  console.log("state ok");
}

// generate body fields
if (!c.includes("img2imgMode:improveSource")) {
  const old =
    "img2imgStrength:improveSource?img2imgStrength:1,img2imgNoise:improveSource?img2imgNoise:0";
  if (!c.includes(old)) throw new Error("body strength fields missing");
  c = c.replace(
    old,
    "img2imgStrength:improveSource?img2imgStrength:1,img2imgNoise:improveSource?img2imgNoise:0,img2imgMode:improveSource?img2imgMode:\"refine\",img2imgLockStructure:improveSource?img2imgLockStructure:false"
  );
  console.log("body ok");
}

// improveSelected: keep seed, refine defaults, face polish on
const oldImprove =
  'function improveSelected(r:RecordItem){if(r.mediaType==="video"||!r.images?.[0])return;reuse(r);const media=r.images[0];setImproveSource({filename:media.filename,subfolder:media.subfolder||"",type:media.type||"output",label:media.filename});setImg2imgStrength(0.45);setImg2imgNoise(0.15);setForm(f=>({...f,seed:0,outputName:(f.outputName||"z-image").replace(/-improve$/,"")+"-improve"}));setNotice("Improve ready: Medium magnitude (Strength 0.45 · Noise 0.15). Adjust below, then press Run Improve in this panel.");}';
const newImprove =
  'function improveSelected(r:RecordItem){if(r.mediaType==="video"||!r.images?.[0])return;reuse(r);const media=r.images[0];setImproveSource({filename:media.filename,subfolder:media.subfolder||"",type:media.type||"output",label:media.filename});setImg2imgMode("refine");setImg2imgLockStructure(true);setImg2imgStrength(0.25);setImg2imgNoise(0.05);setFaceRefinement(true);setForm(f=>({...f,outputName:(f.outputName||"z-image").replace(/-improve$/,"")+"-improve"}));setNotice("Refine ready: low denoise + structure lock + face polish. Keeps the original seed and pose. Press Run Improve when ready.");}';
if (c.includes("function improveSelected")) {
  // replace function body flexibly
  const start = c.indexOf("function improveSelected");
  const end = c.indexOf("\n function openLibraryUpload", start);
  const end2 = c.indexOf("\n const openLibraryUpload", start);
  const cut = end > 0 ? end : end2;
  if (cut < 0) throw new Error("cannot find end of improveSelected");
  c = c.slice(0, start) + newImprove + "\n" + c.slice(cut);
  console.log("improveSelected ok");
}

// Clear button should reset mode
c = c.replace(
  "onClick={()=>{setImproveSource(null);setImg2imgStrength(1);setImg2imgNoise(0)}}",
  'onClick={()=>{setImproveSource(null);setImg2imgStrength(1);setImg2imgNoise(0);setImg2imgMode("refine");setImg2imgLockStructure(true)}}'
);

// Replace entire improve-panel block
const panelStart = c.indexOf("{improveSource&&<div className=\"improve-panel\">");
if (panelStart < 0) throw new Error("panel start missing");
const panelEndMarker = "Connected · source";
const pe = c.indexOf(panelEndMarker, panelStart);
if (pe < 0) throw new Error("panel end marker missing");
// find closing of panel: </div></div>} after improve-actions
const after = c.indexOf("</div></div>}", pe);
if (after < 0) throw new Error("panel close missing");
const panelEnd = after + "</div></div>}".length;

const panel = `{improveSource&&<div className="improve-panel"><div className="section-title"><span>Improve</span><small>Fine-tune a good image</small><button type="button" className="ghost" onClick={()=>{setImproveSource(null);setImg2imgStrength(1);setImg2imgNoise(0);setImg2imgMode("refine");setImg2imgLockStructure(true)}}>Clear</button></div><p className="improve-blurb">Source <strong title={improveSource.label}>{improveSource.label}</strong>. <em>Refine</em> keeps pose/layout (low denoise + structure lock) and cleans anatomy, face, light, and detail. Leave the prompt as-is; do not rewrite composition. <em>Rewrite</em> allows bigger pose/style changes.</p><div className="improve-modes"><button type="button" className={img2imgMode==="refine"?"active":""} onClick={()=>{setImg2imgMode("refine");setImg2imgLockStructure(true);setImg2imgStrength(0.25);setImg2imgNoise(0.05);setFaceRefinement(true)}}>Refine (preserve pose)</button><button type="button" className={img2imgMode==="rewrite"?"active":""} onClick={()=>{setImg2imgMode("rewrite");setImg2imgLockStructure(false);setImg2imgStrength(0.45);setImg2imgNoise(0.15)}}>Rewrite (freer)</button></div><div className="improve-presets">{(img2imgMode==="refine"?[["Soft",0.18,0.02],["Refine",0.25,0.05],["Polish",0.32,0.08]] as const:[["Mild",0.35,0.1],["Medium",0.45,0.15],["Strong",0.6,0.25]] as const).map(([label,s,n])=><button type="button" key={label} className={img2imgStrength===s&&img2imgNoise===n?"active":""} onClick={()=>{setImg2imgStrength(s);setImg2imgNoise(n)}}>{label}</button>)}</div><div className="two"><label>Strength<input type="range" min={0.05} max={img2imgMode==="refine"?0.4:1} step={0.01} value={img2imgStrength} onChange={e=>setImg2imgStrength(+e.target.value)}/><small>{img2imgStrength.toFixed(2)} — {img2imgMode==="refine"?"keep low (≤0.38) for anatomy/detail without pose drift":"higher rewrites composition"}</small></label><label>Noise<input type="range" min={0} max={img2imgMode==="refine"?0.2:1} step={0.01} value={img2imgNoise} onChange={e=>setImg2imgNoise(+e.target.value)}/><small>{img2imgNoise.toFixed(2)} — {img2imgMode==="refine"?"near zero; only a little detail freedom":"extra detail freedom (can artifact)"}</small></label></div><div className="improve-toggles"><label><input type="checkbox" checked={img2imgLockStructure} onChange={e=>setImg2imgLockStructure(e.target.checked)}/><span><strong>Lock pose / structure</strong><small>Re-feeds this image as Canny/depth control so limbs and framing stay put.</small></span></label><label><input type="checkbox" checked={faceRefinement} onChange={e=>setFaceRefinement(e.target.checked)}/><span><strong>Face polish after refine</strong><small>Low-denoise Face Detailer on the result (recommended for Refine).</small></span></label></div><div className="improve-actions"><button type="button" className="improve-run" disabled={!canGenerate||!improveSource||busy} onClick={()=>generate()} title="Queue structure-preserving Improve">{busy?<LoaderCircle className="spin"/>:<Zap size={16}/}<span>{busy?"Sending Improve…":img2imgMode==="refine"?"Run Refine":"Run Rewrite"}</span></button><small>Connected · {img2imgMode} · seed kept · Strength {img2imgStrength.toFixed(2)} · Noise {img2imgNoise.toFixed(2)} · structure {img2imgLockStructure?"on":"off"} · face polish {faceRefinement?"on":"off"}</small></div></div>}`;

c = c.slice(0, panelStart) + panel + c.slice(panelEnd);
console.log("panel replaced");

if (c.length < orig * 0.9) throw new Error(`shrink ${orig}->${c.length}`);
fs.writeFileSync(path, c, "utf8");
console.log("wrote", c.length);

const cssPath = "Z:/codex app/app/src/styles.css";
let css = fs.readFileSync(cssPath, "utf8");
if (!css.includes(".improve-modes")) {
  css += `

.improve-modes{display:flex;flex-wrap:wrap;gap:0.4rem;margin:0 0 0.65rem}
.improve-modes button{flex:1;min-width:8rem;padding:0.45rem 0.65rem;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:transparent;color:inherit;cursor:pointer;font-size:0.82rem;font-weight:600}
.improve-modes button.active{border-color:var(--accent,#b8ff4a);background:color-mix(in srgb,var(--accent,#b8ff4a) 20%,transparent)}
.improve-toggles{display:flex;flex-direction:column;gap:0.45rem;margin:0.55rem 0 0.35rem}
.improve-toggles label{display:flex;gap:0.55rem;align-items:flex-start;font-size:0.85rem;cursor:pointer}
.improve-toggles label span{display:flex;flex-direction:column;gap:0.15rem}
.improve-toggles small{opacity:0.7;font-weight:400}
`;
  fs.writeFileSync(cssPath, css, "utf8");
  console.log("css ok");
}
