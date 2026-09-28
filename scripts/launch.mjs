import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
let root=path.resolve(import.meta.dirname,'..');const port=Number(process.env.LOCAL_AI_PORT||3211),url=`http://127.0.0.1:${port}`;
const data=process.env.LOCAL_AI_DATA_DIR||path.join(process.platform==='win32'?(process.env.LOCALAPPDATA||os.homedir()):(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share')),'LocalAIStudio');
fs.mkdirSync(data,{recursive:true});
if(!fs.existsSync(path.join(root,'.git'))){try{const active=JSON.parse(fs.readFileSync(path.join(data,'active-app.json'),'utf8'));const releases=fs.realpathSync(path.join(data,'app-releases')),target=fs.realpathSync(active.root);if(target.startsWith(releases+path.sep)&&JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8')).name==='local-ai-studio')root=target;}catch{}}
async function running(){try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});return r.ok&&(await r.json()).app==='local-ai-studio';}catch{return false;}}
if(!await running()){
  const output=fs.openSync(path.join(data,'server.log'),'a');
  const child=spawn(process.execPath,[path.join(root,'app','server.mjs')],{cwd:root,detached:true,windowsHide:true,env:{...process.env,LOCAL_AI_DATA_DIR:data,LOCAL_AI_PORT:String(port)},stdio:['ignore',output,output]});
  child.on('error',error=>console.error(error.message));child.unref();fs.closeSync(output);
  for(let i=0;i<50&&!await running();i++)await new Promise(resolve=>setTimeout(resolve,100));
  if(!await running())throw new Error(`Studio could not start. Check ${path.join(data,'server.log')}, or select another LOCAL_AI_PORT.`);
}
const command=process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'open':'xdg-open';
const args=process.platform==='win32'?['-NoProfile','-Command',`Start-Process '${url}'`]:[url];
const browser=spawn(command,args,{windowsHide:true,detached:true,stdio:'ignore'});browser.on('error',()=>console.log('Open '+url+' in your browser.'));browser.unref();
console.log('Local AI Studio: '+url);
