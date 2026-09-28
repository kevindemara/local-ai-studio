import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {spawn}from 'node:child_process';import {once}from 'node:events';
const root=path.resolve(import.meta.dirname,'..'),dir=fs.mkdtempSync(path.join(import.meta.dirname,'artifacts','durable-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('server reconnects durable builds, queues work, enforces read-only modes, forks chats and recovers restart',async()=>{
 let round=0,mode='build',memorySeen=false,readOnly=false,gate=250;
 const mock=http.createServer(async(req,res)=>{
  if(req.url==='/api/ps')return res.end('{"models":[]}');if(req.url==='/api/tags')return res.end('{"models":[{"name":"gpt-oss-20b-local"}]}');let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);
  if(req.url==='/api/generate')return res.end('{}');
  memorySeen=input.messages[0].content.includes('Use purple accents')&&input.messages[0].content.includes('Use accessible forms');
  readOnly=!input.tools.some(t=>t.function.name==='write_project_file');
  await wait(gate);
  const message=round++%2===0?{tool_calls:[{function:{name:'write_project_file',arguments:{path:'made.txt',content:mode}}}]}:{content:'Finished.'};
  res.end(JSON.stringify({message})+'\n'+JSON.stringify({done:true,done_reason:'stop'})+'\n');
 });mock.listen(0,'127.0.0.1');await once(mock,'listening');
 const socket=http.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 let child,token,chat,project;
 const api=async(route,data,method)=>{const res=await fetch('http://127.0.0.1:'+port+'/api'+route,{method:method || (data===undefined?'GET':'POST'),headers:{'X-Local-Token':token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const value=await res.json();assert.ok(res.ok,JSON.stringify(value));return value;};
 const start=async()=>{child=spawn(process.execPath,[path.join(root,'server.mjs')],{windowsHide:true,stdio:'ignore',env:{...process.env,LOCAL_AI_PORT:String(port),LOCAL_AI_OLLAMA_PORT:String(mock.address().port),LOCAL_AI_DATA_DIR:path.join(dir,'data')}});for(let i=0;i<100;i++){try{token=(await api('/bootstrap')).token;return;}catch{}await wait(25);}throw Error('Server failed');};
 const stop=async()=>{if(child.exitCode===null){const end=once(child,'exit');child.kill();await end;}};
 const finish=async id=>{for(let i=0;i<200;i++){const snapshot=await api('/runs/'+id);if(!['running','queued'].includes(snapshot.run.status))return snapshot;await wait(25);}throw Error('Run timed out');};
 try{
  await start();const folder=path.join(dir,'project');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'AGENTS.md'),'Use accessible forms');
  project=await api('/projects',{name:'Durable fixture',folder});await api('/projects/'+project.id,{memory:'Use purple accents'},'PATCH');chat=await api('/chats',{projectId:project.id,model:'gpt-oss-20b-local'});
  const first=await api('/runs',{chatId:chat.id,content:'Create a saved text file',mode:'build'});const queued=await api('/runs',{chatId:chat.id,content:'Cancelled queued request',mode:'build'});await api('/runs/'+queued.id+'/cancel',{});
  // Bootstrap is the same reconnect operation used by a refreshed or newly opened GUI.
  assert.ok((await api('/bootstrap')).state.runs.some(r=>r.id===first.id));
  const done=await finish(first.id);assert.equal(done.run.status,'complete');assert.equal(fs.readFileSync(path.join(folder,'made.txt'),'utf8'),'build');assert.ok(done.run.checkpointId);assert.ok(memorySeen);assert.equal((await finish(queued.id)).run.status,'stopped');
  const fork=await api('/chats/'+chat.id+'/fork',{messageId:done.run.messageId});assert.equal(fork.forkedFrom,chat.id);assert.equal(fork.messages.length,2);assert.notEqual(fork.messages[0].id,done.chat.messages[0].id);assert.equal(fork.projectId,chat.projectId);assert.equal(fork.messages.at(-1).runId,undefined);
  for(mode of ['plan','ask']){round=0;const readonly=await api('/runs',{chatId:chat.id,content:'Create a text file',mode});const answer=await finish(readonly.id);assert.equal(answer.run.status,'complete');assert.ok(readOnly);assert.equal(fs.readFileSync(path.join(folder,'made.txt'),'utf8'),'build');assert.equal(answer.chat.messages.at(-1).artifacts,undefined);}
  gate=5000;mode='build';round=0;const interrupted=await api('/runs',{chatId:chat.id,content:'Create after restart',mode});for(let i=0;i<50;i++){if((await api('/runs/'+interrupted.id)).run.status==='running')break;await wait(20);}await stop();await start();assert.equal((await api('/runs/'+interrupted.id)).run.status,'interrupted');gate=20;round=0;const continued=await api('/runs/'+interrupted.id+'/continue',{});assert.equal((await finish(continued.id)).run.status,'complete');
  gate=5000;const cancelled=await api('/runs',{chatId:chat.id,content:'Long request',mode:'ask'});for(let i=0;i<50;i++){if((await api('/runs/'+cancelled.id)).run.status==='running')break;await wait(20);}await api('/runs/'+cancelled.id+'/cancel',{});assert.equal((await finish(cancelled.id)).run.status,'stopped');
 }finally{await stop();mock.closeAllConnections();await new Promise(r=>mock.close(r));}
});
