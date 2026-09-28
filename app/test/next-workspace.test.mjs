import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {fileOperation,undoFileOperation,createCheckpoint,restoreCheckpoint} from '../project-history.mjs';
import {writeProjectFile} from '../project-files.mjs';
import {recordChange} from '../project-workbench.mjs';
import {gitInit,gitCommit,gitStatus,gitDiff} from '../project-git.mjs';
import {templateFiles} from '../project-templates.mjs';
import {runProjectTask,startPreview,stopPreview,requestProjectAPI} from '../project-runtime.mjs';
import {RunQueue} from '../run-queue.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-ai-next-workspace-'));
const exec=promisify(execFile);
function fixture(name){const folder=path.join(root,name);fs.mkdirSync(folder);return {id:name,folder,allowCommands:true};}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('move and trash restore exact bytes and reject stale or occupied paths',()=>{
  const p=fixture('operations'),backup=path.join(root,'backups'),changes=[];
  fs.writeFileSync(path.join(p.folder,'a.js'),'original');
  const moved=fileOperation(p,{action:'rename',path:'a.js',to:'src/b.js'},backup,changes);
  assert.equal(fs.readFileSync(path.join(p.folder,'src/b.js'),'utf8'),'original');
  fs.writeFileSync(path.join(p.folder,'src/b.js'),'external');assert.throws(()=>undoFileOperation(p,moved,backup),/changed/);
  fs.writeFileSync(path.join(p.folder,'src/b.js'),'original');undoFileOperation(p,moved,backup);
  const trash=fileOperation(p,{action:'trash',path:'a.js'},backup,changes);assert.equal(fs.existsSync(path.join(p.folder,'a.js')),false);
  undoFileOperation(p,trash,backup);assert.equal(fs.readFileSync(path.join(p.folder,'a.js'),'utf8'),'original');
  assert.throws(()=>fileOperation(p,{action:'trash',path:'../outside.js'},backup,changes),/allowed|relative/);
});
test('checkpoint restores connected edits, moves, trash and newly created files; conflicts change nothing',()=>{
  const p=fixture('checkpoint'),backup=path.join(root,'backups'),changes=[];
  fs.writeFileSync(path.join(p.folder,'a.js'),'original A');fs.writeFileSync(path.join(p.folder,'b.css'),'original B');
  const snapshot=createCheckpoint(p,'Before changes',path.join(root,'checkpoints'),[{path:'a.js'},{path:'b.css'}]);snapshot.changeIndex=0;
  recordChange(changes,p,writeProjectFile(p,'a.js','changed',backup));fileOperation(p,{action:'rename',path:'b.css',to:'src/b.css'},backup,changes);recordChange(changes,p,writeProjectFile(p,'new.js','new',backup));
  fs.writeFileSync(path.join(p.folder,'a.js'),'outside');assert.throws(()=>restoreCheckpoint(p,snapshot,changes,backup),/Nothing was restored/);assert.ok(fs.existsSync(path.join(p.folder,'src/b.css')));
  fs.writeFileSync(path.join(p.folder,'a.js'),'changed');restoreCheckpoint(p,snapshot,changes,backup);
  assert.equal(fs.readFileSync(path.join(p.folder,'a.js'),'utf8'),'original A');assert.equal(fs.readFileSync(path.join(p.folder,'b.css'),'utf8'),'original B');assert.equal(fs.existsSync(path.join(p.folder,'new.js')),false);assert.equal(fs.existsSync(path.join(p.folder,'src/b.css')),false);
  restoreCheckpoint(p,snapshot,changes,backup);assert.equal(fs.readFileSync(path.join(p.folder,'b.css'),'utf8'),'original B');
});
test('Git commits selected files while preserving other staged files and refuses parent repositories',async()=>{
  const p=fixture('git');await gitInit(p);
  fs.writeFileSync(path.join(p.folder,'a.js'),'one');fs.writeFileSync(path.join(p.folder,'b.js'),'other');
  assert.match((await gitDiff(p,'a.js')).unstaged,/\+one/);
  await exec('git',['-C',p.folder,'add','b.js']);await gitCommit(p,{paths:['a.js'],message:'Add selected file'});
  const committed=(await exec('git',['-C',p.folder,'ls-tree','--name-only','HEAD'])).stdout;assert.equal(committed.trim(),'a.js');
  assert.ok((await gitStatus(p)).files.find(f=>f.path==='b.js' && f.status[0]==='A'));
  fs.writeFileSync(path.join(p.folder,'a.js'),'two');assert.match((await gitDiff(p,'a.js')).unstaged,/\+two/);
  const child={id:'nested',folder:path.join(p.folder,'nested')};fs.mkdirSync(child.folder);assert.equal((await gitStatus(child)).repository,false);await assert.rejects(gitInit(child),/already belongs/);
});
test('queued runs persist, execute serially and cancelled queued requests never execute',async()=>{
  const state={runs:[]};let concurrent=0,max=0,saved=0;const executed=[];
  const queue=new RunQueue(state,()=>saved++,async(req,res,input)=>{concurrent++;max=Math.max(max,concurrent);executed.push(input.content);await wait(50);res.write(JSON.stringify({type:'done',chat:{messages:[{id:'message',status:'complete'}]}}));concurrent--;},()=>false);
  const a=queue.enqueue({content:'one'});const b=queue.enqueue({content:'cancel'});const c=queue.enqueue({content:'three'});queue.cancelQueued(b.id);
  for(let i=0;i<100 && c.status!=='complete';i++)await wait(10);
  assert.deepEqual(executed,['one','three']);assert.equal(max,1);assert.equal(a.status,'complete');assert.equal(b.status,'stopped');assert.ok(saved>3);assert.equal(a.events[0].chat,undefined);
  const recovered={runs:[{status:'running'},{status:'queued'}]};const q=new RunQueue(recovered,()=>{},()=>{},()=>true);assert.equal(recovered.runs[0].status,'interrupted');assert.equal(recovered.runs[1].status,'queued');q.close();queue.close();
});
for(const id of ['static','node','react'])test(id+' starter verifies and serves real connected files',async()=>{
  const p=fixture('template-'+id);for(const [relative,content]of Object.entries(templateFiles(id)))writeProjectFile(p,relative,content,path.join(root,'backups'));
  if(id==='react'){const install=await runProjectTask(p,{task:'install'});assert.equal(install.success,true,install.output);}
  if(id!=='static'){const build=await runProjectTask(p,{task:'script',script:'build'});assert.equal(build.success,true,build.output);}
  if(id==='node'){const tests=await runProjectTask(p,{task:'script',script:'test'});assert.equal(tests.success,true,tests.output);}
  const preview=await startPreview(p);
  try{
    assert.equal((await fetch(preview.url)).status,200);
    await assert.rejects(requestProjectAPI(p,{path:'//example.com'}),/within/);await assert.rejects(requestProjectAPI(p,{path:'/\\example.com'}),/within/);
    if(id==='node'){
      const added=await requestProjectAPI(p,{method:'POST',path:'/api/items',body:{name:'  test item  '}});assert.equal(added.status,201);assert.equal(JSON.parse(added.body).name,'test item');
      const invalid=await requestProjectAPI(p,{method:'POST',path:'/api/items',body:{name:' '}});assert.equal(invalid.status,400);
      const all=await requestProjectAPI(p,{path:'/api/items'});assert.equal(JSON.parse(all.body).length,1);
    }
  }finally{await stopPreview(p);}
});
