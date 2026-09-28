import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {zipSync,strToU8} from 'fflate';
import {Backups,chooseRelease,extractRelease} from '../maintenance.mjs';
import {kickoff,recovery,buildProgress} from '../public/helpers.mjs';

test('kickoff produces a reviewed connected-file build brief and validates required goals',()=>{
  assert.throws(()=>kickoff({name:'Demo'}),/describe/);const p=kickoff({name:'Toronto plumber',goal:'Generate quote requests',pages:'Services, contact',style:'Navy, accessible',template:'react'});assert.equal(p.template,'react');assert.match(p.prompt,/actual files/);assert.match(p.prompt,/Services, contact/);assert.match(p.prompt,/unless it really works/);assert.equal(kickoff({name:'Demo',goal:'Hello',template:'shell'}).template,'static');
});
test('recovery distinguishes runtime, offline and context failures; progress never invents passing checks',()=>{
  assert.ok(recovery('CUDA error: shared object initialization failed').actions.includes('smaller'));assert.deepEqual(recovery('ECONNREFUSED 11434').actions,['start']);assert.ok(recovery('context token limit').actions.includes('context'));
  const progress=buildProgress({status:'complete'},{activity:[{tool:'write_project_file',result:{path:'a.js'}},{tool:'verify_project',result:{success:false}}]});assert.equal(progress.stages[2].status,'failed');assert.equal(progress.stages[3].status,'waiting');assert.equal(buildProgress({status:'complete'},{activity:[]}).stages[2].status,'waiting');
  const actual=buildProgress({status:'complete'},{artifacts:[{path:'index.html',action:'updated'}],activity:[{tool:'verify_project',result:{success:true}}],verifiedWrites:0});assert.equal(actual.stages[1].status,'done');assert.equal(actual.stages[2].status,'waiting');
});
test('verified workspace recovery preserves originals, excludes dependencies/credentials and interrupts queued jobs',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-recovery-')),data=path.join(root,'data'),source=path.join(root,'linked-project');await fs.mkdir(path.join(source,'node_modules'),{recursive:true});await fs.mkdir(path.join(data,'mcp-auth'),{recursive:true});await fs.writeFile(path.join(data,'mcp-auth','secret'),'credential');await fs.writeFile(path.join(source,'node_modules','large.js'),'dependency');await fs.writeFile(path.join(source,'index.html'),'original');
  const state={projects:[{id:'demo',folder:source}],chats:[{id:'chat',messages:[]}],runs:[{id:'run',status:'queued'}],extensions:[{trusted:true,projects:['demo'],tools:[{}]}]},manager=new Backups(data),snapshot=await manager.create(state);assert.equal(snapshot.files,1);await fs.writeFile(path.join(source,'index.html'),'current work');
  const result=await manager.restore(snapshot.id);assert.equal(await fs.readFile(path.join(source,'index.html'),'utf8'),'current work');assert.equal(await fs.readFile(path.join(result.workspace.projects[0].folder,'index.html'),'utf8'),'original');assert.equal(result.workspace.runs[0].status,'interrupted');assert.equal(result.workspace.extensions[0].trusted,false);assert.equal(await fs.readFile(path.join(data,'mcp-auth','secret'),'utf8'),'credential');assert.equal((await manager.list()).length,1);
  await fs.writeFile(path.join(data,'snapshots',snapshot.id,'projects','demo','index.html'),'tampered');await assert.rejects(manager.restore(snapshot.id),/integrity/);
});
test('recovery rejects traversal metadata and linked snapshot paths before copying anything',async()=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'studio-invalid-backup-')),manager=new Backups(data),snapshot=await manager.create({projects:[],chats:[]});const file=path.join(data,'snapshots',snapshot.id,'manifest.json'),m=JSON.parse(await fs.readFile(file));m.files=[{path:'../../outside',sha256:'bad',bytes:1}];await fs.writeFile(file,JSON.stringify(m));await assert.rejects(manager.restore(snapshot.id),/Unsafe/);await assert.rejects(manager.restore('../../bad'),/Invalid/);
});
test('release checks separate channels and version ordering rather than relying on GitHub list order',()=>{
  const releases=[{tag_name:'v0.9.0',prerelease:false},{tag_name:'v0.10.0',prerelease:true},{tag_name:'v99.0.0',draft:true}];assert.equal(chooseRelease(releases,'0.9.0','preview').version,'v0.10.0');assert.equal(chooseRelease(releases,'0.9.0','stable').available,false);assert.equal(chooseRelease(releases,'0.11.0','preview').available,false);
});
test('release extraction checks digest, archive paths, resource limits and package identity',()=>{
  const make=extra=>zipSync({'package.json':strToU8(JSON.stringify({name:'local-ai-studio',version:'0.3.0'})),'app/server.mjs':strToU8(''),'scripts/launch.mjs':strToU8(''),...extra});const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');const valid=make({});assert.ok(extractRelease(valid,hash(valid),'v0.3.0')['package.json']);assert.throws(()=>extractRelease(valid,'sha256:'+'0'.repeat(64),'v0.3.0'),/checksum/);assert.throws(()=>extractRelease(valid,hash(valid),'v0.4.0'),/version/);for(const name of ['../evil','C:/evil','data/private','app\\bad','node_modules/x']){const archive=make({[name]:strToU8('bad')});assert.throws(()=>extractRelease(archive,hash(archive),'v0.3.0'),/Unsafe|unexpected/);}
});

test('official release folder prefixes are stripped before installation and asset names match packaging',()=>{
  const prefix='local-ai-studio-0.3.0/',buffer=zipSync({[prefix+'package.json']:strToU8('{"name":"local-ai-studio","version":"0.3.0"}'),[prefix+'app/server.mjs']:strToU8(''),[prefix+'scripts/launch.mjs']:strToU8('')});assert.ok(extractRelease(buffer,'sha256:'+createHash('sha256').update(buffer).digest('hex'),'v0.3.0')['app/server.mjs']);const release=chooseRelease([{tag_name:'v0.3.0',assets:[{name:'local-ai-studio-0.3.0.zip'}]}],'0.2.2');assert.equal(release.asset.name,'local-ai-studio-0.3.0.zip');
});

test('update launcher activates a healthy version and relaunches the previous app if startup fails',async()=>{
  const helper=path.resolve(import.meta.dirname,'../../scripts/update-launch.mjs');
  for(const fail of [false,true]){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-update-launch-')),data=path.join(root,'data'),oldRoot=path.join(root,'previous'),newRoot=path.join(root,'next');await fs.mkdir(data);for(const dir of [oldRoot,newRoot])await fs.mkdir(path.join(dir,'app'),{recursive:true});
    const source=kind=>`import http from 'node:http';const server=http.createServer((req,res)=>{if(req.url==='/stop'){res.end('ok');server.close(()=>process.exit(0));return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'local-ai-studio',pid:process.pid,kind:'${kind}'}));});server.listen(Number(process.env.LOCAL_AI_PORT),'127.0.0.1');`;
    await fs.writeFile(path.join(oldRoot,'app','server.mjs'),source('previous'));await fs.writeFile(path.join(newRoot,'app','server.mjs'),fail?'process.exit(1);':source('next'));
    const socket=net.createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
    const previous=spawn(process.execPath,['-e','process.exit(0)']);await once(previous,'exit');const child=spawn(process.execPath,[helper,String(previous.pid),newRoot,oldRoot,data,String(port)],{stdio:'pipe'});let stderr='';child.stderr.on('data',v=>stderr+=v);const finished=once(child,'exit');
    try{await finished;assert.equal(child.exitCode,0,stderr);const result=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();assert.equal(result.kind,fail?'previous':'next');if(!fail)assert.equal(JSON.parse(await fs.readFile(path.join(data,'active-app.json'))).root,newRoot);else assert.match(await fs.readFile(path.join(data,'update.log'),'utf8'),/Relaunched|relaunched/);}finally{try{await fetch(`http://127.0.0.1:${port}/stop`);}catch{}if(child.exitCode===null)child.kill();}
  }
});
