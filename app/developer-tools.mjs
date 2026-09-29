import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {projectTarget} from './project-files.mjs';
import {excluded,generationProfile} from './project-hub.mjs';
import {packageInfo,runProjectTask} from './project-runtime.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,code=400)=>{throw Object.assign(new Error(message),{code});};
const text=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))fail(`${label} must contain text under ${max} characters.`);return value.trim();};
const stamp=()=>new Date().toISOString();
export function runtimePolicy(settings={}){return {keep_alive:({eco:0,balanced:'2m',warm:'10m'})[settings.memoryPreset]??'2m',options:settings.compute==='cpu'?{num_gpu:0}:{}};}
export function runLimits(project){return {rounds:project.runLimits?.rounds||40,minutes:project.runLimits?.minutes||0};}
export function deadline(controller,minutes){if(!minutes)return ()=>{};const timer=setTimeout(()=>controller.abort(new Error(`Run reached its ${minutes}-minute time limit. Saved files are retained; continue when ready.`)),minutes*60000);timer.unref?.();return ()=>clearTimeout(timer);}
export function assertEditScope(project,relative){const {relative:clean}=projectTarget(project,relative);if(project.editScope?.enabled&&(!excluded(clean,project.editScope.allowed)||excluded(clean,project.editScope.protected)))fail(`Edit boundary blocks ${clean}. Change Code & workflow → Edit boundaries to allow this file.`,403);return clean;}
export function scopedTool(name){return ['read_project_file','list_project_files','search_project','search_project_knowledge','project_code_map','write_project_file','edit_project_file','move_project_file','trash_project_file','update_plan'].includes(name);}
export function sourceMap(project,list,read){
  const listing=list(project),nodes=[],markers=[];let inspected=0;
  for(const file of listing.files){if(file.kind==='image'||excluded(file.path,project.contextExcludes||[]))continue;if(inspected++>=200)break;let content;try{content=read(project,file.path).content;}catch{continue;}
    const node={path:file.path,symbols:[],imports:[],usedBy:[]};
    for(const [index,line] of content.split('\n').entries()){
      if(node.symbols.length<25){const m=line.match(/\b(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|def|fn|struct|interface|type)\s+([\w$]+)/)||line.match(/\b(?:export\s+)?(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/);if(m)node.symbols.push({name:m[1],line:index+1});}
      const marker=line.match(/\b(TODO|FIXME|HACK|XXX)\b\s*[:( -]?\s*(.{0,180})/);if(marker&&markers.length<300)markers.push({path:file.path,line:index+1,kind:marker[1],text:marker[2].replace(/\*\/$/,'').trim()||marker[1]});
    }
    for(const m of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|(?:src|href)\s*=\s*)["']([^"']+)["']/g)){if(node.imports.length>=40)break;const spec=m[1].split(/[?#]/)[0];if(spec.startsWith('.')||(!/^[a-z]+:|^\/\/|^#/i.test(spec)&&/\.(?:js|mjs|css|html|tsx?)$/.test(spec)))node.imports.push({specifier:spec});}
    nodes.push(node);
  }
  const byPath=new Map(nodes.map(n=>[n.path.toLowerCase(),n]));
  for(const node of nodes)for(const ref of node.imports){const base=ref.specifier.startsWith('/')?ref.specifier.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(node.path),ref.specifier));const target=[base,...['.js','.mjs','.jsx','.ts','.tsx','.json','.css','/index.js','/index.ts','/index.tsx'].map(ext=>base+ext)].map(f=>byPath.get(f.toLowerCase())).find(Boolean);if(target){ref.target=target.path;if(!target.usedBy.includes(node.path))target.usedBy.push(node.path);}}
  return {nodes,markers,scanned:nodes.length,truncated:listing.truncated||inspected>200,heuristic:true,note:'Text-based symbols and explicit imports only. Dynamic imports, aliases and language semantics may be missing.'};
}
export function agentCodeMap(project,list,read){const map=sourceMap(project,list,read),result={nodes:[],scanned:map.scanned,truncated:map.truncated,heuristic:true,note:map.note};for(const node of [...map.nodes].sort((a,b)=>b.usedBy.length-a.usedBy.length||a.path.localeCompare(b.path))){const item={path:node.path,symbols:node.symbols.slice(0,8),imports:node.imports.slice(0,8),usedBy:node.usedBy.slice(0,8)};result.nodes.push(item);if(JSON.stringify(result).length>12000){result.nodes.pop();result.truncated=true;break;}}return result;}
export async function qualityGates(project,signal,output,runner=runProjectTask){
  const scripts=project.qualityScripts||[],checks=[];
  if(!scripts.length)return {success:true,checks,configured:false};
  if(project.allowCommands===false)return {success:false,configured:true,checks:[{name:'Quality gates',skipped:true,reason:'Enable development commands to run configured scripts.'}]};
  for(const script of scripts){signal?.throwIfAborted();let result;try{result=await runner(project,{task:'script',script},signal,output);}catch(error){signal?.throwIfAborted();result={success:false,output:error.message};}checks.push({name:script,...result});if(!result.success)break;}
  return {success:checks.length===scripts.length&&checks.every(c=>c.success),checks,configured:true,remaining:scripts.slice(checks.length)};
}

export class DeveloperTools{
  constructor(state,save,deps){this.state=state;this.save=save;this.deps=deps;this.replacements=new Map();}
  snapshot(project){let pkg=null;try{pkg=packageInfo(project);}catch{}return {project,map:sourceMap(project,this.deps.list,this.deps.read),scripts:Object.keys(pkg?.scripts||{}).filter(s=>/^[a-zA-Z0-9:_-]{1,60}$/.test(s)&&!/^(dev|start|serve|preview|watch)$/i.test(s)),chats:this.state.chats.filter(c=>c.projectId===project.id).map(({messages,...c})=>({...c,messageCount:messages.length})),settings:this.state.settings,jobs:(this.state.setupJobs||[]).filter(j=>j.kind==='quality'&&j.projectId===project.id).slice(-10).reverse()};}
  settings(project,input){
    const next={};
    if(input.editScope!==undefined){const value=input.editScope;for(const key of ['allowed','protected']){if(!Array.isArray(value[key])||value[key].length>30||value[key].some(p=>typeof p!=='string'||!p.trim()||p.length>200||/\\|:|\0/.test(p)||p.split('/').includes('..')))fail('Use up to 30 relative glob patterns, e.g. src/**.');}if(value.enabled&&!value.allowed.length)fail('Choose at least one allowed path.');next.editScope={enabled:value.enabled===true,allowed:value.allowed,protected:value.protected};}
    if(input.qualityScripts!==undefined){let pkg;try{pkg=packageInfo(project);}catch{}const scripts=input.qualityScripts;if(!Array.isArray(scripts)||scripts.length>8||new Set(scripts).size!==scripts.length||scripts.some(s=>typeof s!=='string'||!/^[a-zA-Z0-9:_-]{1,60}$/.test(s)||!/./.test(s)||/^(dev|start|serve|preview|watch)$/i.test(s)||!Object.hasOwn(pkg?.scripts||{},s)))fail('Choose up to 8 existing package.json scripts, excluding servers.');next.qualityScripts=scripts;}
    if(input.runLimits!==undefined){const value=input.runLimits;if(![0,5,15,30,60].includes(value.minutes)||![2,10,20,40,80].includes(value.rounds))fail('Choose supported time and model-round limits.');next.runLimits={minutes:value.minutes,rounds:value.rounds};}
    Object.assign(project,next);this.save();return project;
  }
  chat(project,input){const chat=this.state.chats.find(c=>c.id===input.id&&c.projectId===project.id);if(!chat)fail('Chat not found.',404);if(input.archived!==undefined&&this.state.runs.some(r=>r.chatId===chat.id&&['queued','running'].includes(r.status)))fail('Stop queued or running requests before archiving this chat.',409);
    const next={};if(input.pinned!==undefined)next.pinned=input.pinned===true;if(input.archived!==undefined)next.archived=input.archived===true;if(input.tags!==undefined){if(!Array.isArray(input.tags)||input.tags.length>8||input.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>30))fail('Use up to 8 tags under 30 characters.');next.tags=[...new Set(input.tags.map(t=>t.trim()))];}Object.assign(chat,next);this.save();return chat;
  }
  handoff(project,input){if(project.autoFiles===false)fail('Enable project file creation before building a plan.');const source=this.state.chats.find(c=>c.id===input.chatId&&c.projectId===project.id),message=source?.messages.find(m=>m.id===input.messageId&&m.role==='assistant'&&m.mode==='plan'&&['complete','length'].includes(m.status));if(!message)fail('Choose a finished Plan reply.',404);if(input.approved!==true)fail('Review and approve the plan before building.');const plan=text(input.plan,14000,'Approved plan'),profile=generationProfile(project,'build',this.state.settings.contextTokens),model=this.deps.modelId(profile.model||input.model||source.model),chat={id:randomUUID(),projectId:project.id,title:('Build: '+source.title).slice(0,80),model,mode:'build',attachments:[],messages:[],createdAt:stamp(),updatedAt:stamp(),handoff:{chatId:source.id,messageId:message.id,plan,sha256:digest(plan),approvedAt:stamp()}};
    this.state.chats.push(chat);let run;try{run=this.deps.enqueue({projectId:project.id,chatId:chat.id,model,mode:'build',content:'Implement this user-reviewed plan. Inspect the existing project, create and connect the requested files, run the configured checks, and report results.\n\n'+plan});}catch(error){this.state.chats=this.state.chats.filter(c=>c.id!==chat.id);this.save();throw error;}this.save();return {chat,run};
  }
  replacePreview(project,input){
    if(typeof input.find!=='string'||!input.find.length||input.find.length>1000||input.find.includes('\0'))fail('Find must contain 1–1,000 literal characters.');const find=input.find,replace=typeof input.replace==='string'?input.replace:fail('Replacement must be text.');if(replace.length>10000||replace.includes('\0'))fail('Replacement must be text under 10,000 characters.');if(find===replace)fail('Find and replacement are identical.');if(input.path!==undefined&&(typeof input.path!=='string'||input.path.length>200))fail('Use a short path filter.');
    const files=[];let total=0;
    for(const file of this.deps.list(project).files){if(file.kind==='image'||excluded(file.path,project.contextExcludes||[])||input.path&&!file.path.includes(input.path))continue;const original=this.deps.read(project,file.path).content,count=original.split(find).length-1;if(!count)continue;const content=original.split(find).join(replace);if(Buffer.byteLength(content)>200000)fail('A replaced file exceeds 200 KB.');files.push({path:file.path,original,content,revision:digest(original),count});total+=count;if(files.length>30||total>2000)fail('Narrow the replacement to 30 files and 2,000 matches.');}
    if(!files.length)fail('No literal matches in readable source files.');for(const [id,p] of this.replacements)if(Date.now()-p.at>600000)this.replacements.delete(id);if(this.replacements.size>=5)this.replacements.delete(this.replacements.keys().next().value);const id=randomUUID();this.replacements.set(id,{projectId:project.id,files,at:Date.now()});return {id,total,files,note:'Literal, case-sensitive replacement. All listed files will change after Apply.'};
  }
  replaceApply(project,input){const preview=this.replacements.get(input.id);if(!preview||preview.projectId!==project.id||Date.now()-preview.at>600000)fail('Replacement preview expired. Preview again.',409);if(input.confirm!==true)fail('Review the replacement preview before applying.');for(const f of preview.files)if(digest(this.deps.read(project,f.path).content)!==f.revision)fail(`${f.path} changed since preview. Preview again. No replacements applied.`,409);
    const written=[];try{for(const f of preview.files){if(digest(this.deps.read(project,f.path).content)!==f.revision)fail(`${f.path} changed during replacement.`,409);written.push(this.deps.write(project,f.path,f.content));}}catch(error){const rollback=[];for(const item of written.reverse()){const file=preview.files.find(f=>f.path===item.path);try{if(digest(this.deps.read(project,file.path).content)===digest(file.content)){this.deps.write(project,file.path,file.original);rollback.push(file.path);}else rollback.push(file.path+' changed externally; retained');}catch{rollback.push(item.path+' could not restore; use Changes/undo');}}this.replacements.delete(input.id);fail(`${error.message} Applied files were restored where safe: ${rollback.join(', ')}`,409);}this.replacements.delete(input.id);return {files:written,total:preview.files.reduce((n,f)=>n+f.count,0)};
  }
}
