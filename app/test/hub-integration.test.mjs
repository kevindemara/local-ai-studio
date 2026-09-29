import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=path.resolve(import.meta.dirname,'..');
test('hub builds route profiles, retrieve knowledge, stage edits for approval and compare models serially',async()=>{
  const data=fs.mkdtempSync(path.join(root,'test','artifacts','hub-flow-'));let concurrent=0,maxConcurrent=0,requests=[];
  const mock=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;res.setHeader('Content-Type','application/json');
    if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'small:latest'},{name:'large:latest'}]}));
    if(req.url==='/api/ps')return res.end('{"models":[]}');
    if(req.url==='/api/version')return res.end('{"version":"test"}');
    const input=JSON.parse(raw);if(req.url==='/api/generate')return res.end('{}');
    requests.push(input);concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);
    try{
      await new Promise(resolve=>setTimeout(resolve,20));
      if(!input.stream)return res.end(JSON.stringify({message:{content:'A useful comparison answer.'},eval_count:8,eval_duration:100000000,done_reason:'stop'}));
      const hasTool=input.messages.some(m=>m.role==='tool');
      res.end([hasTool?{message:{content:'The file is proposed. Review it in Project hub.'}}:{message:{tool_calls:[{function:{name:'write_project_file',arguments:{path:'index.html',content:'<!doctype html><html><body>Book a visit</body></html>'}}}]}},{done:true,done_reason:'stop',eval_count:12,eval_duration:100000000,total_duration:100000000}].map(c=>JSON.stringify(c)).join('\n')+'\n');
    }finally{concurrent--;}
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const socket=http.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'test',LOCAL_AI_PORT:String(port),LOCAL_AI_OLLAMA_PORT:String(mock.address().port),LOCAL_AI_DATA_DIR:data}});let token,log='';child.stderr.on('data',chunk=>log+=chunk);
  async function api(route,input){const response=await fetch(`http://127.0.0.1:${port}/api${route}`,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:input===undefined?undefined:JSON.stringify(input)});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;}
  async function until(read,predicate){for(let i=0;i<200;i++){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,25));}throw new Error('Flow timed out. '+log);}
  try{
    for(let i=0;i<100;i++){try{token=(await api('/bootstrap')).token;break;}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(token,log);
    const project=await api('/projects',{name:'Review flow'}),hub=`/projects/${project.id}/hub`;
    await api(hub+'/knowledge',{title:'Booking guide',content:'Booking must provide a clear appointment button.'});
    await api(hub+'/settings',{reviewEdits:true,routeModels:true,modelProfiles:{build:{model:'large:latest',contextTokens:4096,temperature:0.2,maxTokens:256}}});
    const chat=await api('/chats',{projectId:project.id,model:'small:latest',mode:'build'});
    const queued=await api('/runs',{chatId:chat.id,model:'small:latest',mode:'build',content:'Create a booking web page.'});
    const finished=await until(()=>api('/runs/'+queued.id),r=>!['queued','running'].includes(r.run.status));
    assert.equal(finished.run.status,'review');assert.equal(finished.run.model,'large:latest');assert.equal(finished.chat.messages.at(-1).sources[0].title,'Booking guide');
    const payload=requests.find(r=>r.stream);assert.equal(payload.options.num_ctx,4096);assert.equal(payload.options.num_predict,256);assert.equal(payload.options.temperature,0.2);assert.match(payload.messages[0].content,/Booking guide/);assert.ok(!payload.tools.some(t=>/run_project_task|verify_project|generate_project_image|scaffold_project|mcp_/.test(t.function.name)));
    assert.equal(fs.existsSync(path.join(finished.project.folder,'index.html')),false);
    assert.equal((await api('/runs')).find(r=>r.id===queued.id).pendingProposals,1);
    const pending=(await api(hub)).proposals[0];await api(hub+'/review',{id:pending.id,action:'approve'});assert.match(fs.readFileSync(path.join(finished.project.folder,'index.html'),'utf8'),/Book a visit/);
    assert.equal((await api('/runs')).find(r=>r.id===queued.id).pendingProposals,0);
    const exported=await api(hub+'/export',{}),imported=await api('/hub/import',{base64:exported.base64,name:'Shared copy'});assert.equal(imported.reviewEdits,true);assert.equal(imported.allowCommands,false);
    const search=await api('/hub/search?q='+encodeURIComponent('booking web'));assert.equal(search.results[0].chatId,chat.id);
    const comparison=await api(hub+'/compare',{models:['small:latest','large:latest'],prompt:'Explain web pages.'});
    const job=await until(()=>api('/studio/jobs'),jobs=>jobs.find(j=>j.id===comparison.id)?.status==='complete');assert.equal(job.find(j=>j.id===comparison.id).result.results.length,2);assert.equal(maxConcurrent,1);
  }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await new Promise(r=>mock.close(r));}
});
