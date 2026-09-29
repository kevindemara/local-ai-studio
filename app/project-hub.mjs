import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {projectTarget,writeProjectFile} from './project-files.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
function fail(message,code=400){throw Object.assign(new Error(message),{code});}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))fail(`${label} must contain text under ${max.toLocaleString()} characters.`);return value.trim();}
const terms=value=>[...new Set(String(value).toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)||[])].slice(0,40);
const score=(query,title,body)=>terms(query).reduce((n,w)=>n+(title.toLowerCase().includes(w)?5:0)+(body.toLowerCase().includes(w)?1:0),0);
export function excluded(relative,patterns=[]){return patterns.some(pattern=>{const p=pattern.replaceAll('\\','/').trim();if(!p)return false;const escaped=p.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('**','§').replaceAll('*','[^/]*').replaceAll('§','.*');return new RegExp('^'+escaped+'(?:/.*)?$','i').test(relative);});}
export function knowledgeContext(project,query){
  const chunks=[];
  for(const note of project.knowledge||[])if(note.enabled!==false){
    for(let offset=0;offset<note.content.length;offset+=1800){const content=note.content.slice(offset,offset+2000);chunks.push({id:note.id,title:note.title,start:offset,content,score:score(query,note.title,content)});}
  }
  return chunks.filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.start-b.start).slice(0,3).map(c=>({...c,citation:`K-${c.id.slice(0,8)}-${c.start}`}));
}
export function contextPack(project,listing,read,query=''){
  const all=listing(project), patterns=project.contextExcludes||[], sources=[];
  for(const file of all.files){if(file.kind==='image'||excluded(file.path,patterns))continue;try{const value=read(project,file.path);sources.push({...value,score:score(query,file.path,value.content),important:/^(README\.md|package\.json|index\.html)$/i.test(file.path)});}catch{}}
  sources.sort((a,b)=>(b.score-a.score)||(Number(b.important)-Number(a.important))||a.path.localeCompare(b.path));
  const snippets=[];let remaining=project.contextCharacters||8000;
  for(const file of sources.slice(0,8)){
    if(remaining<200)break;const words=terms(query);let start=0;
    if(file.score>0){const hit=words.map(w=>file.content.toLowerCase().indexOf(w)).filter(i=>i>=0).sort((a,b)=>a-b)[0];if(hit!==undefined)start=Math.max(0,hit-350);}
    const content=file.content.slice(start,start+Math.min(2400,remaining));remaining-=content.length;
    snippets.push({path:file.path,startLine:file.content.slice(0,start).split('\n').length,content,characters:content.length,score:file.score});
  }
  return {files:all.files.filter(f=>!excluded(f.path,patterns)).slice(0,150).map(f=>f.path),snippets,excluded:all.files.filter(f=>excluded(f.path,patterns)).map(f=>f.path),truncated:all.truncated,knowledge:knowledgeContext(project,query),characterBudget:project.contextCharacters||8000,estimatedTokens:Math.ceil((JSON.stringify(snippets).length+JSON.stringify(knowledgeContext(project,query)).length)/4),estimate:true};
}
export function generationProfile(project,mode,defaultContext){const p=project.modelProfiles?.[mode]||{};return {model:project.routeModels?p.model:'',options:{num_ctx:p.contextTokens||defaultContext||8192,temperature:p.temperature??0.7,num_predict:p.maxTokens||4096}};}
export function promptVariables(body){return [...new Set([...body.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,30})\}\}/g)].map(m=>m[1]))];}
export const BUILTIN_PROMPTS=[
  {id:'builtin-accessibility',title:'Accessibility audit',command:'accessibility',mode:'ask',body:'Audit {{page}} for keyboard use, labels, contrast and responsive layout. Read the files and report concrete fixes with paths. Do not change files.'},
  {id:'builtin-feature',title:'Build a feature',command:'feature',mode:'build',body:'Implement {{feature}} in this project. Inspect existing files, connect the feature to the app, verify it and summarize the saved files.'},
  {id:'builtin-test',title:'Test plan',command:'test-plan',mode:'plan',body:'Inspect {{feature}} and propose a focused test plan with normal cases, failures and acceptance criteria. Do not modify files.'},
  {id:'builtin-explain',title:'Explain a module',command:'explain',mode:'ask',body:'Read {{module}} and explain its responsibilities, dependencies and data flow in plain language.'},
];
export class ProjectHub {
  constructor(state,save,data,deps){this.state=state;this.save=save;this.data=data;this.deps=deps;state.promptLibrary||=[];state.proposals||=[];state.comparisons||=[];}
  prompts(){return [...BUILTIN_PROMPTS,...this.state.promptLibrary];}
  prompt(input){
    if(input.action==='delete'){this.state.promptLibrary=this.state.promptLibrary.filter(p=>p.id!==input.id);this.save();return this.prompts();}
    if(input.action==='expand'){const p=this.prompts().find(p=>p.id===input.id);if(!p)fail('Prompt not found.',404);const values=input.values||{};const expanded=p.body.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,30})\}\}/g,(_,key)=>text(values[key],3000,key));if(expanded.length>16000)fail('Expanded prompt exceeds the message limit.');return {content:expanded,mode:p.mode};}
    const title=text(input.title,120,'Title'),body=text(input.body,12000,'Prompt'),command=text(input.command,40,'Slash command');
    if(!/^[a-z][a-z0-9-]{0,39}$/.test(command))fail('Use lowercase letters, numbers and hyphens for a slash command.');
    if(!['ask','plan','build'].includes(input.mode))fail('Choose a valid prompt mode.');
    if(this.prompts().some(p=>p.command===command&&p.id!==input.id))fail('That slash command already exists.');
    let p=this.state.promptLibrary.find(p=>p.id===input.id);if(!p){if(this.state.promptLibrary.length>=100)fail('The prompt library holds up to 100 prompts.');p={id:randomUUID()};this.state.promptLibrary.push(p);}
    Object.assign(p,{title,body,command,mode:input.mode,updatedAt:now()});this.save();return p;
  }
  search(query,projectId=''){
    const q=text(query,200,'Search').toLowerCase(),hits=[];
    for(const chat of this.state.chats){if(projectId&&chat.projectId!==projectId)continue;for(const message of chat.messages){const content=String(message.content||''),index=content.toLowerCase().indexOf(q);if(index<0)continue;hits.push({projectId:chat.projectId,project:this.state.projects.find(p=>p.id===chat.projectId)?.name||'Removed project',chatId:chat.id,title:chat.title,messageId:message.id,role:message.role,createdAt:message.createdAt,snippet:content.slice(Math.max(0,index-70),index+q.length+160)});}}
    return {results:hits.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,100),total:hits.length};
  }
  snapshot(project){return {project,knowledge:project.knowledge||[],tasks:this.tasks(project),prompts:this.prompts(),proposals:this.state.proposals.filter(p=>p.projectId===project.id).slice(-100).reverse(),comparisons:this.state.comparisons.filter(c=>c.projectId===project.id).slice(-10).reverse()};}
  knowledge(project,input){
    project.knowledge||=[];
    const existing=project.knowledge.find(n=>n.id===input.id);
    if(input.action==='delete'){project.knowledge=project.knowledge.filter(n=>n.id!==input.id);this.save();return {ok:true};}
    if(input.action==='toggle'){if(!existing)fail('Note not found.',404);existing.enabled=input.enabled!==false;this.save();return existing;}
    const title=text(input.title,120,'Document title'),content=text(input.content,50000,'Knowledge document');
    if(project.knowledge.reduce((n,k)=>n+(k.id===input.id?0:k.content.length),0)+content.length>500000)fail('Project knowledge is limited to 500,000 characters.');
    let note=existing;if(!note){if(project.knowledge.length>=50)fail('Use up to 50 documents per project.');note={id:randomUUID(),enabled:true};project.knowledge.push(note);}
    Object.assign(note,{title,content,updatedAt:now()});this.save();return note;
  }
  settings(original,input){
    const project=structuredClone(original);
    if(input.contextExcludes!==undefined){if(!Array.isArray(input.contextExcludes)||input.contextExcludes.length>30||input.contextExcludes.some(p=>typeof p!=='string'||p.length>200))fail('Use up to 30 exclusion patterns.');project.contextExcludes=input.contextExcludes;}
    if(input.contextCharacters!==undefined){if(![4000,8000,12000].includes(input.contextCharacters))fail('Choose a supported source budget.');project.contextCharacters=input.contextCharacters;}
    if(input.reviewEdits!==undefined)project.reviewEdits=input.reviewEdits===true;
    if(input.routeModels!==undefined)project.routeModels=input.routeModels===true;
    if(input.modelProfiles!==undefined){const profiles={};for(const [mode,value] of Object.entries(input.modelProfiles)){if(!['build','plan','ask'].includes(mode))fail('Unknown profile mode.');const model=value.model?this.deps.modelId(value.model):'';if(![2048,4096,8192,16384,32768].includes(value.contextTokens)||!Number.isFinite(value.temperature)||value.temperature<0||value.temperature>2||!Number.isInteger(value.maxTokens)||value.maxTokens<128||value.maxTokens>8192)fail('Use valid context, temperature and output limits.');profiles[mode]={model,contextTokens:value.contextTokens,temperature:value.temperature,maxTokens:value.maxTokens};}project.modelProfiles=profiles;}
    Object.assign(original,project);this.save();return original;
  }
  tasks(project){return (project.tasks||[]).map(t=>{const run=this.state.runs.find(r=>r.id===t.runId);return {...t,runStatus:run?.status,phase:run?.phase,status:t.status==='done'?'done':run&&['queued','running'].includes(run.status)?'working':run?.status==='complete'||run?.status==='review'?'review':run?'blocked':t.status};});}
  task(project,input){
    project.tasks||=[];let task=project.tasks.find(t=>t.id===input.id);
    if(input.action==='delete'){if(task&&['queued','running'].includes(this.state.runs.find(r=>r.id===task.runId)?.status))fail('Stop the running task before removing its card.',409);project.tasks=project.tasks.filter(t=>t.id!==input.id);this.save();return {ok:true};}
    if(input.action==='run'){
      if(project.autoFiles===false)fail('Enable automatic project files in Project settings before building a task.');
      if(!task)fail('Task not found.',404);if(['queued','running'].includes(this.state.runs.find(r=>r.id===task.runId)?.status))fail('This task is already running.',409);
      const mode='build',profile=generationProfile(project,mode,this.state.settings.contextTokens),model=this.deps.modelId(profile.model||input.model||this.state.preferredModel);
      const chat={id:randomUUID(),projectId:project.id,title:task.title,model,mode,attachments:[],messages:[],createdAt:now(),updatedAt:now()};this.state.chats.push(chat);
      let run;try{run=this.deps.enqueue({chatId:chat.id,projectId:project.id,model,mode,content:`Implement this project task: ${task.title}\nDescription: ${task.description}\nAcceptance criteria (verify and report each):\n${task.criteria}`});}catch(error){this.state.chats=this.state.chats.filter(c=>c.id!==chat.id);this.save();throw error;}
      Object.assign(task,{runId:run.id,chatId:chat.id,status:'backlog'});this.save();return {task,run,chat};
    }
    if(input.action==='status'){if(!task)fail('Task not found.',404);if(['queued','running'].includes(this.state.runs.find(r=>r.id===task.runId)?.status))fail('Wait for this task to finish.',409);if(!['backlog','done'].includes(input.status))fail('Choose backlog or done.');task.status=input.status;if(input.status==='backlog'){delete task.runId;delete task.chatId;}this.save();return task;}
    const title=text(input.title,120,'Task title'),description=String(input.description||'').slice(0,4000),criteria=text(input.criteria,4000,'Acceptance criteria');
    if(task&&['queued','running'].includes(this.state.runs.find(r=>r.id===task.runId)?.status))fail('Wait for this task to finish before editing it.',409);
    if(!task){if(project.tasks.length>=200)fail('Use up to 200 task cards.');task={id:randomUUID(),status:'backlog',createdAt:now()};project.tasks.push(task);}Object.assign(task,{title,description,criteria});this.save();return task;
  }
  propose(project,relative,content,runId){
    if(typeof content!=='string'||content.includes('\0')||Buffer.byteLength(content)>200000)fail('Proposed source must be text under 200 KB.');const {target,relative:clean}=projectTarget(project,relative);if(/\.(png|webp|jpe?g)$/i.test(clean))fail('Review mode supports text edits only.');
    const previous=fs.existsSync(target)?fs.readFileSync(target,'utf8'):null;
    if(previous===content)return {path:clean,action:'unchanged',bytes:Buffer.byteLength(content)};
    let item=this.state.proposals.find(p=>p.projectId===project.id&&p.runId===runId&&p.path===clean&&p.status==='pending');
    if(!item){if(this.state.proposals.filter(p=>p.status==='pending').length>=100)fail('Review existing proposals before adding more.');item={id:randomUUID(),projectId:project.id,runId,path:clean,original:previous,revision:previous===null?null:hash(previous),status:'pending',createdAt:now()};this.state.proposals.push(item);}
    item.content=content;this.save();return {path:clean,action:'proposed',proposalId:item.id,pendingApproval:true,instruction:'This change is saved as a proposal only. It is NOT written to the project. Finish proposing the remaining files, then tell the user to review them in Project hub. Do not run checks or claim files are saved.'};
  }
  decide(project,input){
    const item=this.state.proposals.find(p=>p.id===input.id&&p.projectId===project.id);if(!item||item.status!=='pending')fail('Pending proposal not found.',404);
    if(input.action==='reject'){item.status='rejected';item.decidedAt=now();this.save();return item;}
    if(input.action!=='approve')fail('Choose approve or reject.');
    const {target}=projectTarget(project,item.path),current=fs.existsSync(target)?fs.readFileSync(target,'utf8'):null;
    if((current===null?null:hash(current))!==item.revision)fail('This file changed after the proposal. Reject it and ask for a fresh edit.',409);
    item.result=this.deps.write(project,item.path,item.content);item.status='approved';item.decidedAt=now();this.save();return item;
  }
  export(project){
    if(!project.folder)fail('Create project files before exporting.');const listing=this.deps.list(project);if(listing.truncated)fail('This project exceeds the 600-file export limit.');
    const files={},entries=[];let size=0;
    for(const file of listing.files){if(excluded(file.path,project.contextExcludes||[]))continue;let target;try{target=projectTarget(project,file.path).target;}catch{continue;}const data=fs.readFileSync(target);size+=data.length;if(size>25000000)fail('Project export is limited to 25 MB.');files['files/'+file.path]=data;entries.push({path:file.path,bytes:data.length,sha256:hash(data)});}
    if(!entries.length)fail('There are no shareable source or image files.');
    // Deliberately whitelist metadata: no conversations, knowledge, credentials, paths or connections.
    files['manifest.json']=strToU8(JSON.stringify({format:'local-ai-studio-project',version:1,name:project.name,files:entries,exportedAt:now()},null,2));
    const archive=zipSync(files,{level:6});if(archive.length>10000000)fail('The compressed bundle exceeds 10 MB. Exclude large assets before exporting.');
    return {name:project.name.replace(/[^a-zA-Z0-9_-]/g,'-')+'.studio.zip',files:entries,base64:Buffer.from(archive).toString('base64')};
  }
  import(input){
    if(typeof input.base64!=='string'||input.base64.length>14000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))fail('Choose a project ZIP smaller than 10 MB.');
    let total=0,count=0,files;try{files=unzipSync(Buffer.from(input.base64,'base64'),{filter:file=>{total+=file.originalSize;if(++count>601||total>26000000||file.originalSize>20000000)fail('Project archive exceeds its expanded size or file limit.');return true;}});}catch(error){fail('Cannot import project ZIP: '+error.message);}
    let manifest;try{manifest=JSON.parse(strFromU8(files['manifest.json']));}catch{fail('This ZIP has no valid Studio project manifest.');}
    if(manifest.format!=='local-ai-studio-project'||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length<1||manifest.files.length>600)fail('Unsupported Studio project bundle.');
    const project={id:randomUUID(),name:text(input.name||manifest.name,120,'Project name'),folder:'',instructions:'',autoFiles:true,allowCommands:false,reviewEdits:true,createdAt:now()};
    project.folder=path.join(this.data,'projects',project.id);fs.mkdirSync(project.folder,{recursive:true});
    try{
      const seen=new Set();for(const entry of manifest.files){const {relative}=projectTarget(project,entry.path);if(seen.has(relative.toLowerCase()))fail('Duplicate archive path.');seen.add(relative.toLowerCase());const data=files['files/'+relative];if(!data||data.length!==entry.bytes||hash(data)!==entry.sha256)fail('Project bundle checksum mismatch: '+relative);const image=/\.(png|webp|jpe?g)$/i.test(relative);if(!image&&(data.length>200000||data.includes(0)))fail('Unsupported text source: '+relative);writeProjectFile(project,relative,image?data:strFromU8(data),path.join(this.data,'backups',project.id),image);}
    }catch(error){const projectsRoot=path.resolve(this.data,'projects'),target=path.resolve(project.folder);if(path.dirname(target)!==projectsRoot||path.basename(target)!==project.id)throw new Error('Invalid import cleanup path.');fs.rmSync(target,{recursive:true,force:true});throw error;}
    this.state.projects.push(project);this.save();return project;
  }
}
