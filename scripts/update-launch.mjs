// Runs outside the application directory so Windows can close the previous server cleanly.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const [oldPid,newRoot,oldRoot,data,port]=process.argv.slice(2);
const log=fs.openSync(path.join(data,'update.log'),'a'),url=`http://127.0.0.1:${Number(port)}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function alive(){try{process.kill(Number(oldPid),0);return true;}catch{return false;}}
function launch(root){const child=spawn(process.execPath,[path.join(root,'app','server.mjs')],{cwd:root,windowsHide:true,detached:true,env:{...process.env,LOCAL_AI_PORT:port,LOCAL_AI_DATA_DIR:data},stdio:['ignore',log,log]});child.on('error',e=>fs.writeSync(log,e.message+'\n'));child.unref();return child;}
async function ready(pid){for(let i=0;i<100;i++){try{const res=await fetch(url+'/api/health',{signal:AbortSignal.timeout(500)}),v=await res.json();if(v.app==='local-ai-studio'&&v.pid===pid)return true;}catch{}await sleep(100);}return false;}
for(let i=0;i<300&&alive();i++)await sleep(100);
if(alive()){fs.writeSync(log,'Update was not activated: the previous server did not exit.\n');process.exit(1);}
const next=launch(newRoot);
if(await ready(next.pid)){fs.writeFileSync(path.join(data,'active-app.json'),JSON.stringify({root:newRoot,previousRoot:oldRoot,activatedAt:new Date().toISOString()}));fs.writeSync(log,'Update ready: '+newRoot+'\n');}
else{try{next.kill();}catch{}await sleep(500);const previous=launch(oldRoot);await ready(previous.pid);fs.writeSync(log,'The new version did not become ready. Relaunched the previous application. Workspace backups remain available.\n');}
fs.closeSync(log);
