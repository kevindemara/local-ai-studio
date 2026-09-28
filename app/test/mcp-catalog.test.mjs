import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalogManifest,catalogEnvironment,mcpCatalog,catalogStatus,serverEnvironment } from '../mcp-catalog.mjs';
import { Extensions } from '../extensions.mjs';
import { catalog,recommendations } from '../hardware.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('credential environment names cannot inject commands and catalog responses expose availability only',async()=>{
  await assert.rejects(serverEnvironment(["BAD'; Write-Output 'injected"]),/Invalid/);
  const status=await catalogStatus({BRAVE_API_KEY:'private-catalog-key-fixture',CONTEXT7_API_KEY:'private-context-key-fixture'});
  assert.equal(status.servers.find(s=>s.id==='brave').ready,true);assert.equal(status.servers.find(s=>s.id==='context7').optionalKeyReady,true);assert.ok(!JSON.stringify(status).includes('private-catalog'));assert.ok(!JSON.stringify(status).includes('private-context'));
});
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-catalog-'));return {directory,project:{id:'project-one',name:'Test project',folder:directory}};}
test('expanded models retain distinct sizes and low-memory choices without combining GPUs',()=>{
  assert.equal(catalog.models.length,11);assert.equal(new Set(catalog.models.map(m=>m.id)).size,11);
  const choices=recommendations({ramGiB:8,gpus:[]});assert.equal(choices.find(m=>m.id==='qwen3.5:0.8b').fit,'cpu');assert.equal(choices.find(m=>m.id==='gemma4:e4b').fit,'insufficient');
});
test('catalog pins official packages and restricts filesystem configuration to the selected project',()=>{
  const {directory,project}=fixture();try{
    const config=catalogManifest('filesystem',project);assert.equal(config.command,process.execPath);assert.equal(config.args.at(-1),fs.realpathSync.native(directory));assert.ok(config.args.includes('@modelcontextprotocol/server-filesystem@2026.8.31'));
    assert.throws(()=>catalogManifest('not-a-server',project),/catalog/);assert.throws(()=>catalogManifest('memory',{...project,id:'../escape'}),/identifier/);assert.throws(()=>catalogManifest('filesystem',{...project,folder:''}),/folder/);
    assert.ok(mcpCatalog.servers.every(s=>s.source.startsWith('https://github.com/')));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('catalog credentials remain environment references, not command arguments or saved values',()=>{
  const {directory,project}=fixture();try{
    assert.throws(()=>catalogManifest('brave',project,{}),/BRAVE_API_KEY/);
    const config=catalogManifest('brave',project,{BRAVE_API_KEY:'private-key-fixture'});assert.deepEqual(config.envNames,['BRAVE_API_KEY']);assert.ok(!JSON.stringify(config).includes('private-key-fixture'));
    const github=catalogManifest('github',project,{GITHUB_PERSONAL_ACCESS_TOKEN:'private-token-fixture'});assert.ok(github.args.includes('GITHUB_READ_ONLY=1'));assert.ok(!JSON.stringify(github).includes('private-token-fixture'));
    const context=catalogManifest('context7',project,{});assert.deepEqual(context.envNames,['CONTEXT7_API_KEY']);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('catalog memory paths are distinct per project and browser profiles are isolated',()=>{
  const {directory,project}=fixture();try{
    const a=catalogEnvironment({catalogId:'memory',catalogProjectId:'project-one'},directory),b=catalogEnvironment({catalogId:'memory',catalogProjectId:'project-two'},directory);
    assert.notEqual(a.MEMORY_FILE_PATH,b.MEMORY_FILE_PATH);assert.equal(path.dirname(a.MEMORY_FILE_PATH),path.join(directory,'mcp-memory'));assert.equal(a.NPM_CONFIG_IGNORE_SCRIPTS,'true');
    const browser=catalogManifest('playwright',project);assert.ok(browser.args.includes('--isolated'));assert.ok(browser.args.includes('--headless'));assert.ok(!browser.args.includes('--extension'));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('catalog connections deduplicate per project and cannot enable a different project',async()=>{
  const {directory,project}=fixture(),ext=new Extensions({extensions:[]},()=>{},root,directory);try{
    const entry=ext.addCatalog('memory',project);assert.equal(ext.addCatalog('memory',project).id,entry.id);assert.equal(entry.trusted,false);
    await assert.rejects(ext.permissions(entry.id,{trusted:true,projects:['project-two']},[project.id,'project-two']),/separately/);
    assert.deepEqual(ext.definitions(project,'build'),[]);
  }finally{await ext.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('failed or cancelled catalog activation clears trust, tools and project access',async()=>{
  const {directory,project}=fixture(),ext=new Extensions({extensions:[]},()=>{},root,directory);try{
    const entry=ext.addCatalog('thinking',project);ext.inspect=async()=>{entry.tools=[{name:'partial'}];throw new Error('fixture startup failed');};
    await assert.rejects(ext.activateCatalog(entry,[project.id]),/startup failed/);assert.equal(entry.trusted,false);assert.deepEqual(entry.tools,[]);assert.deepEqual(entry.projects,[]);assert.match(entry.lastError,/startup failed/);
    const controller=new AbortController();controller.abort();ext.inspect=async()=>{entry.tools=[{name:'partial'}];};
    await assert.rejects(ext.activateCatalog(entry,[project.id],controller.signal));assert.equal(entry.trusted,false);assert.match(entry.lastError,/cancelled/);
  }finally{await ext.close();fs.rmSync(directory,{recursive:true,force:true});}
});
