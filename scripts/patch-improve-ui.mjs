import fs from "node:fs";

const path = "Z:/codex app/app/src/main.tsx";
let c = fs.readFileSync(path, "utf8");
const orig = c.length;
if (orig < 40_000) throw new Error(`main.tsx too small (${orig})`);

if (!c.includes("img2imgStrength")) {
  const stateMark = "const [faceRefinement,setFaceRefinement]=useState(false);";
  if (!c.includes(stateMark)) throw new Error("faceRefinement state not found");
  c = c.replace(
    stateMark,
    stateMark +
      " const [img2imgStrength,setImg2imgStrength]=useState(1); const [img2imgNoise,setImg2imgNoise]=useState(0); const [improveSource,setImproveSource]=useState(null as null|{filename:string;subfolder:string;type:string;label:string});"
  );
  console.log("state ok");
}

// Generate body append
const oldBody =
  "Object.entries({...form,seed:seeds[runIndex],outputName:runTotal>1?`${form.outputName}-run-${runIndex+1}`:form.outputName,diffusionModel,consistentCharacter,faceRefinement,controlnetEnd:.75}).forEach(([key,value])=>body.append(key,String(value)));";
if (!c.includes(oldBody)) throw new Error("generate body not found");
if (!c.includes('body.append("sourceFilename"')) {
  c = c.replace(
    oldBody,
    "Object.entries({...form,seed:seeds[runIndex],outputName:runTotal>1?`${form.outputName}-run-${runIndex+1}`:form.outputName,diffusionModel,consistentCharacter,faceRefinement,controlnetEnd:.75,img2imgStrength:improveSource?img2imgStrength:1,img2imgNoise:improveSource?img2imgNoise:0}).forEach(([key,value])=>body.append(key,String(value)));if(improveSource){body.append(\"sourceFilename\",improveSource.filename);body.append(\"sourceSubfolder\",improveSource.subfolder||\"\");body.append(\"sourceType\",improveSource.type||\"output\");}"
  );
  console.log("body ok");
}

// improveSelected before openLibraryUpload
if (!c.includes("function improveSelected")) {
  const openLib = " const openLibraryUpload=";
  if (!c.includes(openLib)) throw new Error("openLibraryUpload not found");
  const improveFn =
    ' function improveSelected(r:RecordItem){if(r.mediaType==="video"||!r.images?.[0])return;reuse(r);const media=r.images[0];setImproveSource({filename:media.filename,subfolder:media.subfolder||"",type:media.type||"output",label:media.filename});setImg2imgStrength(0.45);setImg2imgNoise(0.15);setForm(f=>({...f,seed:0,outputName:(f.outputName||"z-image").replace(/-improve$/,"")+"-improve"}));setNotice("Improve ready: Medium magnitude (Strength 0.45 · Noise 0.15). Adjust below, then Generate.");}\n';
  c = c.replace(openLib, improveFn + openLib);
  console.log("fn ok");
}

// Toolbar Improve button next to Reuse
const reuseBtn =
  '<button className="reuse" onClick={()=>reuse(selected)}><RotateCcw/>Reuse settings</button>';
if (!c.includes(reuseBtn)) throw new Error("reuse button not found");
if (!c.includes("Improve</button>")) {
  c = c.replace(
    reuseBtn,
    reuseBtn +
      '{selected.mediaType!=="video"&&selected.status==="completed"&&!!selected.images?.[0]&&<button className="reuse improve" type="button" onClick={()=>improveSelected(selected)} title="Re-sample this image with Strength and Noise (NovelAI-style Enhance)"><Zap size={14}/> Improve</button>}'
  );
  console.log("btn ok");
}

// Improve panel before fine-tune
const fine = '<section className="fine-tune-section">';
if (!c.includes(fine)) throw new Error("fine-tune section missing");
if (!c.includes("improve-panel")) {
  const panel =
    '{improveSource&&<div className="improve-panel"><div className="section-title"><span>Improve source</span><small>NovelAI-style Enhance</small><button type="button" className="ghost" onClick={()=>{setImproveSource(null);setImg2imgStrength(1);setImg2imgNoise(0)}}>Clear</button></div><p className="improve-blurb">Re-samples <strong title={improveSource.label}>{improveSource.label}</strong> with your prompt. Strength = how much may change; Noise = extra detail freedom. Not Pose/Structure reference guidance.</p><div className="improve-presets">{([["Subtle",0.22,0.05],["Mild",0.35,0.1],["Medium",0.45,0.15],["Strong",0.6,0.25]] as const).map(([label,s,n])=><button type="button" key={label} className={img2imgStrength===s&&img2imgNoise===n?"active":""} onClick={()=>{setImg2imgStrength(s);setImg2imgNoise(n)}}>{label}</button>)}</div><div className="two"><label>Strength<input type="range" min={0.05} max={1} step={0.05} value={img2imgStrength} onChange={e=>setImg2imgStrength(+e.target.value)}/><small>{img2imgStrength.toFixed(2)} — low sticks to the image, high rewrites more</small></label><label>Noise<input type="range" min={0} max={1} step={0.05} value={img2imgNoise} onChange={e=>setImg2imgNoise(+e.target.value)}/><small>{img2imgNoise.toFixed(2)} — higher invites new detail (can artifact if overused)</small></label></div></div>}';
  c = c.replace(fine, panel + fine);
  console.log("panel ok");
}

if (c.length < orig * 0.95) throw new Error(`refusing shrink ${orig} -> ${c.length}`);
fs.writeFileSync(path, c, "utf8");
console.log("wrote", c.length, "from", orig);

const cssPath = "Z:/codex app/app/src/styles.css";
let css = fs.readFileSync(cssPath, "utf8");
if (!css.includes(".improve-panel")) {
  css += `

/* NovelAI-style Improve / Enhance */
.improve-panel{margin:0 0 1rem;padding:0.85rem 1rem;border:1px solid color-mix(in srgb, var(--accent, #b8ff4a) 35%, transparent);border-radius:12px;background:color-mix(in srgb, var(--panel, #12141a) 92%, #1a2a10)}
.improve-panel .section-title{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem}
.improve-panel .section-title .ghost{margin-left:auto;font-size:0.8rem}
.improve-blurb{font-size:0.82rem;opacity:0.85;margin:0 0 0.65rem;line-height:1.35}
.improve-presets{display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.65rem}
.improve-presets button{padding:0.35rem 0.7rem;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:inherit;cursor:pointer;font-size:0.8rem}
.improve-presets button.active{border-color:var(--accent, #b8ff4a);background:color-mix(in srgb, var(--accent, #b8ff4a) 18%, transparent)}
.improve-panel label small{display:block;opacity:0.7;margin-top:0.2rem}
button.reuse.improve{margin-left:0.35rem}
`;
  fs.writeFileSync(cssPath, css, "utf8");
  console.log("css ok");
}
