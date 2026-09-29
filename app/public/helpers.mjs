export function kickoff(input) {
  const clean=(value,max)=>String(value||'').trim().slice(0,max);
  const name=clean(input.name,100),goal=clean(input.goal,1800),pages=clean(input.pages,1000),style=clean(input.style,500);
  if(!name||!goal)throw new Error('Give your project a name and describe what it should do.');
  const template=['static','react','node'].includes(input.template)?input.template:'static';
  const sentence=value=>value.replace(/[.!?]+$/,'')+'.';
  const steps=[sentence(`Build ${name}: ${goal}`),sentence(`Connect ${pages||'the main page, navigation and essential interactions'}`),sentence(`Use ${style||'a clear, accessible layout that works on phones and desktops'}`),'Check links, interactions and available build/test scripts.','Start a local preview and report anything still unfinished.'];
  return {name,template,steps,instructions:`Project goal: ${goal}\nPages and features: ${pages}\nVisual direction: ${style}`,prompt:`Build the following project in its project folder. Inspect the starter first, create and connect the actual files, and preserve unrelated work.\n\n${steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\nUse fictional information where needed. Do not claim a contact form sends email or an integration is connected unless it really works.`,createdAt:new Date().toISOString()};
}
export function recovery(error) {
  const text=String(error||'');
  if(/CUDA|out of memory|allocation|VRAM|0xc0000409/i.test(text))return {title:'The model runtime stopped',detail:'Free GPU memory, try a smaller installed model or reduce reply context. CUDA initialization failures can also require an Ollama or driver update.',actions:['smaller','context','unload','start']};
  if(/ECONNREFUSED|fetch failed|Ollama.*(offline|unavailable)|connect.*11434/i.test(text))return {title:'Ollama is unavailable',detail:'Start Ollama, then continue from the saved project files.',actions:['start']};
  if(/context|token.*limit|too long/i.test(text))return {title:'This request exceeds the model context',detail:'Reduce reply context to save memory, or use a fresh chat with a shorter brief if the prompt itself is too long.',actions:['context','smaller']};
  if(/tool.*(invalid|malformed|support)|JSON|parse.*call/i.test(text))return {title:'The model could not use a development tool',detail:'Try another installed coding model, then continue from the saved files.',actions:['smaller']};
  return {title:'The build needs attention',detail:'Review the error and saved files, then continue the remaining work.',actions:[]};
}
export function buildProgress(run,message) {
  const activity=message?.activity||[],artifacts=message?.artifacts||[],written=artifacts.filter(a=>a.path&&!a.error&&!['unchanged','proposed'].includes(a.action)).length||activity.filter(a=>/write|edit_project|move_project|trash_project|patch|file_operation/.test(a.tool)&&a.result&&!a.result.error&&a.result.success!==false).length;
  const check=activity.findLast(a=>a.tool==='verify_project')?.result;
  const preview=activity.findLast(a=>a.tool==='start_project_preview')?.result;
  const verified=check?.success&&(message?.verifiedWrites===undefined||message.verifiedWrites>=artifacts.length);
  const active=run?.status==='running';
  return {label:run?`${run.status==='running'?run.phase||'Working':run.status} · ${written} file operation${written===1?'':'s'}`:'Describe your project to begin',stages:[
    {title:'Prepare',status:!run?'waiting':run.status==='queued'?'active':'done'},
    {title:'Create files',status:written?'done':active&&/files|build|tool|work/i.test(run.phase||'')?'active':'waiting'},
    {title:'Check',status:verified?'done':check&&!check.success?'failed':active&&/check|verif|test/i.test(run.phase||'')?'active':'waiting'},
    {title:'Preview',status:preview?.running?'done':'waiting'}]};
}
