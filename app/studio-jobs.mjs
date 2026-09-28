import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { killTree } from './project-runtime.mjs';
const exec = promisify(execFile);
export function executable(name) {
  if (process.platform==='win32') {
    const candidates = name==='gh' ? [path.join(process.env.ProgramFiles||'C:\\Program Files','GitHub CLI','gh.exe')] : name==='ollama' ? [path.join(process.env.LOCALAPPDATA||'','Programs','Ollama','ollama.exe')] : name==='uv' ? [path.join(process.env.LOCALAPPDATA||'','Microsoft','WinGet','Links','uv.exe'),path.join(process.env.USERPROFILE||'','.local','bin','uv.exe'),path.join(process.env.LOCALAPPDATA||'','Microsoft','WinGet','Packages','astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe','uv.exe')] : name==='git' ? [path.join(process.env.ProgramFiles||'C:\\Program Files','Git','cmd','git.exe')] : [];
    for(const file of candidates) if(fs.existsSync(file)) return file;
  }
  return name;
}
export class StudioJobs {
  constructor(state,save,onFinish=()=>{}) { this.state=state;this.save=save;this.onFinish=onFinish;this.controllers=new Map();state.setupJobs ||= [];for(const j of state.setupJobs) if(j.status==='running'){j.status='interrupted';j.message='Restart interrupted this action. Retry when ready.';} }
  start(kind, label, task) {
    if(this.state.setupJobs.some(j=>j.kind===kind&&j.status==='running')) throw new Error('This action is already running.');
    const job={id:randomUUID(),kind,label,status:'running',message:'Starting',progress:0,createdAt:new Date().toISOString()};
    const controller=new AbortController();this.controllers.set(job.id,controller);this.state.setupJobs.push(job);this.state.setupJobs=this.state.setupJobs.slice(-50);this.save();
    const update = data => { Object.assign(job,data);this.save(); };
    Promise.resolve().then(()=>{controller.signal.throwIfAborted();return task(controller.signal,update);}).then(result=>{controller.signal.throwIfAborted();update({status:'complete',progress:100,message:'Complete',result});}).catch(error=>update({status:controller.signal.aborted?'cancelled':'failed',message:error.message.slice(0,1000)})).finally(()=>{this.controllers.delete(job.id);update({finishedAt:new Date().toISOString()});this.onFinish();});
    return job;
  }
  cancel(id) { const controller=this.controllers.get(id);if(!controller) throw new Error('This action is no longer running.');controller.abort();return{ok:true}; }
  close() { for(const controller of this.controllers.values()) controller.abort(); }
}
export async function prerequisites() {
  const entries = [{id:'node',label:'Node.js',file:process.execPath,args:['--version'],url:'https://nodejs.org/en/download'},{id:'ollama',label:'Ollama',file:executable('ollama'),args:['--version'],url:'https://ollama.com/download'},{id:'git',label:'Git',file:executable('git'),args:['--version'],url:'https://git-scm.com/downloads'},{id:'gh',label:'GitHub CLI',file:executable('gh'),args:['--version'],url:'https://cli.github.com/'}];
  return Promise.all(entries.map(async ({file,args,...entry})=>{try{const result=await exec(file,args,{timeout:8000,windowsHide:true});return{...entry,installed:true,version:result.stdout.split('\n')[0]};}catch{return{...entry,installed:false};}}));
}
export async function runCommand(file,args,{signal,cwd,onOutput=()=>{},env={}}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd,windowsHide:true,detached:process.platform!=='win32',shell:false,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let output='',settled=false;
    const timer=setTimeout(()=>{void killTree(child);finish(new Error('This command exceeded its 10-minute time limit.'));},600000);
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
    const abort=()=>{void killTree(child);finish(new Error('Cancelled; already completed installation steps may remain.'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const collect=data=>{const chunk=data.toString();output=(output+chunk).slice(-8000);onOutput(output,child);};child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',finish);child.on('close',code=>finish(code===0?null:new Error(output.slice(-1600)||`Command exited ${code}`),{output}));
  });
}
export async function installPrerequisite(id, signal, update) {
  const packages={ollama:'Ollama.Ollama',git:'Git.Git',gh:'GitHub.cli',uv:'astral-sh.uv'};
  if(!packages[id])throw new Error('Choose Ollama, Git, GitHub CLI or uv.');
  if(process.platform!=='win32')throw new Error('Use the official download link or your package manager on this platform, then recheck.');
  return runCommand('winget',['install','--id',packages[id],'--exact','--source','winget','--silent','--accept-package-agreements','--accept-source-agreements','--disable-interactivity'],{signal,onOutput:output=>update({message:output.slice(-1200)})});
}
export async function pullModel(ollama,model,signal,update) {
  const response=await fetch(`${ollama}/api/pull`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:true}),signal});
  if(!response.ok) throw new Error(`Ollama download failed (${response.status}). Start Ollama and retry.`);
  let pending='';const decoder=new TextDecoder();
  for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});const lines=pending.split('\n');pending=lines.pop();for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);if(event.error)throw new Error(event.error);update({message:event.status||'Downloading',progress:event.total?Math.round((event.completed||0)/event.total*100):0,completed:event.completed,total:event.total});}}
  if(pending.trim()){const event=JSON.parse(pending);if(event.error)throw new Error(event.error);}
  return {model};
}
