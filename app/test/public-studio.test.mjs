import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseNvidia, recommendations } from '../hardware.mjs';
import { StudioJobs,pullModel } from '../studio-jobs.mjs';
import { Extensions,validateExtension } from '../extensions.mjs';
import { usageOverview,diagnosticReport } from '../insights.mjs';
import { changeBranch,branches,changelogEntry,repoSlug } from '../github-workflows.mjs';
import { gitInit,gitCommit } from '../project-git.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
test('16GB recommendations reserve runtime memory and never combine independent GPUs',()=>{
  const h={ramGiB:32,gpus:parseNvidia('RTX 5070 Ti, 16303, 15000, 3')};
  const choices=recommendations(h);assert.equal(choices[0].id,'gemma4:12b');assert.equal(choices.find(m=>m.id==='qwen3.8:27b').fit,'cpu');assert.equal(choices.find(m=>m.id==='qwen3.5:9b').fit,'good');
  const dual=recommendations({ramGiB:32,gpus:[{memoryGiB:8},{memoryGiB:8}]});assert.notEqual(dual.find(m=>m.id==='gemma4:12b').fit,'good');
});
test('small CPU PCs and unified-memory Macs receive different fit estimates',()=>{
  const cpu=recommendations({ramGiB:8,gpus:[]},'lightweight');assert.equal(cpu[0].id,'qwen3:1.7b');assert.equal(cpu[0].fit,'cpu');assert.equal(cpu.find(m=>m.id==='qwen3.8:27b').fit,'insufficient');
  const mac=recommendations({ramGiB:24,gpus:[{memoryGiB:24}],unified:true});assert.equal(mac.find(m=>m.id==='gemma4:12b').fit,'good');assert.equal(mac.find(m=>m.id==='qwen3.8:27b').fit,'cpu');
});
test('plugin manifests reject credential URLs, invalid executable arguments and secret values',()=>{
  assert.throws(()=>validateExtension({name:'Bad',transport:'http',url:'http://example.com/mcp'}));
  assert.throws(()=>validateExtension({name:'Bad',transport:'http',url:'https://user:secret@example.com/mcp'}));
  assert.throws(()=>validateExtension({name:'Bad',command:'node',args:'--bad'}));
  assert.throws(()=>validateExtension({name:'Bad',command:'node',args:[],envNames:['secret=value']}));
  assert.equal(validateExtension({name:'Local',transport:'http',url:'http://127.0.0.1:8080/mcp'}).trusted,false);
});
test('real SDK discovers and calls a local MCP server only after project trust; revocation and read-only modes block it',async()=>{
  const state={extensions:[]},ext=new Extensions(state,()=>{},root),entry=ext.example(),project={id:'project-one'};
  try{
    await assert.rejects(ext.inspect(entry.id),/trust/);assert.deepEqual(ext.definitions(project,'build'),[]);
    await ext.permissions(entry.id,{trusted:true,projects:[project.id]},[project.id]);await ext.inspect(entry.id);assert.equal(entry.tools.length,2);
    const definitions=ext.definitions(project,'build'),name=definitions.find(t=>t.function.description.includes('Count words')).function.name;
    assert.deepEqual(ext.definitions(project,'plan'),[]);assert.deepEqual(ext.definitions({id:'another-project'},'build'),[]);
    await assert.rejects(ext.call(project,'ask',name,{text:'hello'}),/Build/);
    const result=await ext.call(project,'build',name,{text:'one two three'});assert.equal(JSON.parse(result.content)[0].text,'3');
    await ext.permissions(entry.id,{trusted:false,projects:[]},[project.id]);await assert.rejects(ext.call(project,'build',name,{}),/disabled/);
  }finally{await ext.close();}
});
test('model downloads parse split progress records and surface daemon errors',async()=>{
  const mock=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;if(JSON.parse(raw).model==='bad')return res.end('{"error":"out of disk"}\n');res.write('{"status":"down');res.end('loading","total":100,"completed":50}\n{"status":"success"}\n');});mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const updates=[],url=`http://127.0.0.1:${mock.address().port}`;try{await pullModel(url,'test',new AbortController().signal,data=>updates.push(data));assert.equal(updates[0].progress,50);assert.equal(updates.at(-1).message,'success');await assert.rejects(pullModel(url,'bad',new AbortController().signal,()=>{}),/out of disk/);const controller=new AbortController();controller.abort();await assert.rejects(pullModel(url,'test',controller.signal,()=>{}));}finally{await new Promise(r=>mock.close(r));}
});
test('Streamable HTTP MCP connects and calls a real HTTP server',async()=>{
  const mock=http.createServer(async(req,res)=>{if(req.method==='DELETE'){res.writeHead(200);return res.end();}if(req.method!=='POST'){res.writeHead(405);return res.end();}let raw='';for await(const chunk of req)raw+=chunk;const message=JSON.parse(raw);if(message.id===undefined){res.writeHead(202);return res.end();}let result;
    if(message.method==='initialize')result={protocolVersion:message.params.protocolVersion,serverInfo:{name:'http-fixture',version:'1'},capabilities:{tools:{}}};
    else if(message.method==='tools/list')result={tools:[{name:'hello',description:'Return a greeting',inputSchema:{type:'object',properties:{}}}]};
    else if(message.method==='tools/call')result={content:[{type:'text',text:'Hello from HTTP'}]};else result={};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');const state={extensions:[]},extensions=new Extensions(state,()=>{},root),entry=extensions.add({name:'HTTP fixture',transport:'http',url:`http://127.0.0.1:${mock.address().port}/mcp`}),project={id:'http-project'};
  try{await extensions.permissions(entry.id,{trusted:true,projects:[project.id]},[project.id]);await extensions.inspect(entry.id);const tool=extensions.definitions(project,'build')[0];const result=await extensions.call(project,'build',tool.function.name,{});assert.equal(JSON.parse(result.content)[0].text,'Hello from HTTP');}finally{await extensions.close();await new Promise(r=>mock.close(r));}
});
test('setup jobs persist interruption, reject duplicate work and cancel without reporting completion',async()=>{
  const state={setupJobs:[{id:'old',status:'running'}]},jobs=new StudioJobs(state,()=>{});assert.equal(state.setupJobs[0].status,'interrupted');
  const job=jobs.start('download','Test',signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true})));
  await new Promise(r=>setImmediate(r));assert.throws(()=>jobs.start('download','Duplicate',async()=>{}),/already/);jobs.cancel(job.id);await new Promise(r=>setImmediate(r));assert.equal(job.status,'cancelled');
});
test('usage sums recorded input/output only and honors project/model/status filters',()=>{
  const now=new Date().toISOString(),state={projects:[{id:'p',name:'Project',createdAt:now}],changes:[{projectId:'p'}],chats:[{id:'c',projectId:'p',createdAt:now,messages:[{role:'assistant',model:'a',createdAt:now,metrics:{promptTokens:100,tokens:20,totalSeconds:2}},{role:'assistant',model:'b',createdAt:now,metrics:{promptTokens:30,tokens:10}},{role:'assistant',model:'a',createdAt:now}]}],runs:[{id:'r',projectId:'p',model:'a',status:'error',createdAt:now,content:'private prompt',events:[{}],output:'private output'}]};
  const usage=usageOverview(state,{model:'a',project:'p',status:'error'});assert.equal(usage.input,100);assert.equal(usage.output,20);assert.equal(usage.replies,2);assert.equal(usage.runs.length,1);assert.equal(usage.runs[0].events,undefined);assert.equal(usage.projects[0].changes,1);
  const report=JSON.stringify(diagnosticReport(state,{platform:'test',ramGiB:32,gpus:[]},[]));assert.ok(!report.includes('private'));assert.ok(!report.includes('Project'));
});
test('Git wizard creates branches only on a clean repository and validates names',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-git-')),project={id:'git',folder:dir};fs.writeFileSync(path.join(dir,'index.html'),'hello');await gitInit(project);await gitCommit(project,{paths:['index.html'],message:'Initial source'});
  await changeBranch(project,{name:'feature/hello',create:true});assert.ok((await branches(project)).branches.includes('feature/hello'));
  fs.writeFileSync(path.join(dir,'index.html'),'changed');await assert.rejects(changeBranch(project,{name:'another',create:true}),/Commit/);
  await exec('git',['-C',dir,'checkout','--','index.html']);await assert.rejects(changeBranch(project,{name:'--bad',create:true}));
  assert.throws(()=>repoSlug('../repo'));assert.throws(()=>repoSlug('https://github.com/owner/repo'));assert.equal(repoSlug('owner/repo'),'owner/repo');
});
test('changelog templates preserve literal text while replacing supported placeholders',()=>{
  const entry=changelogEntry({version:'v0.2\nspoof',summary:'Added tool connections',template:'# {version}\n{date}\n{summary}\nLiteral {other}'});assert.ok(entry.includes('v0.2 spoof'));assert.ok(entry.includes('Added tool connections'));assert.ok(entry.includes('{other}'));assert.throws(()=>changelogEntry({summary:''}));
});
