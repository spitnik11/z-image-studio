const studio=process.env.Z_IMAGE_STUDIO_URL||"http://127.0.0.1:3199";
async function json(url,init){const response=await fetch(url,init);if(!response.ok)throw new Error(`${response.status} ${await response.text()}`);return response.status===204?undefined:response.json()}
try{const diagnostics=await json(`${studio}/api/diagnostics`);if(!diagnostics.connected)throw new Error("offline")}catch{
 console.log(`SKIP: Studio/ComfyUI is unavailable at ${studio}. Start the desktop app, then rerun npm run smoke:prompt.`);process.exit(0);
}
const [settings,models,library]=await Promise.all([json(`${studio}/api/settings`),json(`${studio}/api/models`),json(`${studio}/api/prompt-library`)]);
const model=models.find(item=>item.name===settings.diffusionModel&&item.architecture!=="unknown")||models.find(item=>item.architecture==="z-image"||item.architecture==="krea2");
if(!model)throw new Error("No supported installed Photo model is available.");
const entry=library.entries.find(item=>item.architecture===model.architecture&&item.resolved&&!item.requiredLora);
const generated=await json(`${studio}/api/prompt/generate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
 architecture:model.architecture,entryIds:entry?[entry.id]:[],keywords:["adult product creator in a clean studio, safe automation acceptance image"],complexity:entry?.complexity||"standard",confirmedLoras:[]
})});
const validation=await json(`${studio}/api/prompt/validate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(generated)});
if(!validation.ok)throw new Error(`Prompt validation blocked: ${validation.blocks.join(" ")}`);
const recipe=model.recommended||(model.architecture==="krea2"?{steps:8,guidance:1,sampler:"euler",scheduler:"simple"}:{steps:8,guidance:1,sampler:"res_multistep",scheduler:"simple"});
const form=new FormData();
const input={prompt:validation.normalized.prompt,negativePrompt:validation.normalized.negativePrompt,width:512,height:512,seed:424243,batchSize:1,priority:"low",outputFormat:"png",outputName:`prompt-smoke-${Date.now()}`,diffusionModel:model.name,neuralUpscale:false,upscaleModel:"RealESRGAN_x4plus.pth",consistentCharacter:false,faceRefinement:false,controlnetEnd:.75,...recipe,loras:"[]",characters:"[]",referenceSettings:"[]"};
for(const [key,value] of Object.entries(input))form.append(key,String(value));
const job=await json(`${studio}/api/generate`,{method:"POST",body:form});
const deadline=Date.now()+5*60_000;
while(Date.now()<deadline){
 const record=(await json(`${studio}/api/gallery`)).find(item=>item.id===job.id);
 if(record?.status==="completed"){if(!record.images?.some(image=>image.filename?.toLowerCase().endsWith(".png")))throw new Error("Completed without a PNG.");console.log(`PASS: prompt generate → validate → submit completed as ${record.images[0].filename}.`);process.exit(0)}
 if(["failed","cancelled"].includes(record?.status))throw new Error(record.error||`Prompt smoke ${record.status}.`);
 await new Promise(resolve=>setTimeout(resolve,1000));
}
throw new Error("Prompt automation smoke timed out after five minutes.");
