import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { catalogManifest,catalogEnvironment,mcpCatalog,catalogStatus,serverEnvironment,catalogHeaders,catalogConfiguration,catalogServer,catalogUrl } from '../mcp-catalog.mjs';
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
    assert.ok(mcpCatalog.servers.every(s=>s.source.startsWith('https://')));
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

test('expanded catalog has 25 distinct providers and pinned local launch packages',()=>{
  assert.equal(mcpCatalog.servers.length,25);assert.equal(new Set(mcpCatalog.servers.map(s=>s.id)).size,25);
  for(const server of mcpCatalog.servers){assert.ok(server.access&&server.requirements&&server.source);if(server.package)assert.match(server.package,/@[0-9]+\.[0-9]+\.[0-9]+$/);if(server.pythonPackage)assert.match(server.pythonPackage,/==[0-9]+\.[0-9]+\.[0-9]+$/);if(server.url)assert.equal(new URL(server.url).protocol,'https:');}
});
test('Supabase configuration narrows access and token headers never enter saved manifests',()=>{
  const {directory,project}=fixture();try{
    const server=catalogServer('supabase'),environment={SUPABASE_ACCESS_TOKEN:'private-header-fixture'};
    assert.throws(()=>catalogManifest('supabase',project,environment),/reference/);
    assert.throws(()=>catalogConfiguration(server,{projectRef:'abc12345',token:'secret'}),/settings/);
    assert.throws(()=>catalogConfiguration(server,{projectRef:'abc12345&features=account'}),/valid/);
    const configuration={projectRef:'abc12345'},manifest=catalogManifest('supabase',project,environment,configuration),entry={...manifest,catalogId:'supabase',catalogConfiguration:configuration};
    const url=new URL(manifest.url);assert.equal(url.searchParams.get('project_ref'),'abc12345');assert.equal(url.searchParams.get('read_only'),'true');assert.equal(url.searchParams.get('features'),'database,docs');
    assert.ok(!JSON.stringify(entry).includes('private-header'));assert.deepEqual(catalogHeaders(entry,environment),{Authorization:'Bearer private-header-fixture'});
    assert.throws(()=>catalogHeaders({...entry,url:'https://elsewhere.example/mcp'},environment),/reviewed/);
    assert.deepEqual(catalogHeaders({...entry,catalogId:undefined},environment),{});
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('browser sign-in uses a pinned bridge with per-project private auth caches and bounded scope fields',()=>{
  const {directory,project}=fixture();try{
    const config=catalogManifest('sentry',project,{}, {organization:'my-org',project:'my-app'});assert.ok(config.args.includes('mcp-remote@0.14.3'));assert.ok(config.args.includes('https://mcp.sentry.dev/mcp/my-org/my-app'));assert.ok(config.args.includes('http-only'));
    const a=catalogEnvironment({catalogId:'sentry',catalogProjectId:project.id},directory),b=catalogEnvironment({catalogId:'sentry',catalogProjectId:'another-project'},directory);assert.notEqual(a.MCP_REMOTE_CONFIG_DIR,b.MCP_REMOTE_CONFIG_DIR);assert.equal(a.MCP_REMOTE_CONFIG_DIR,path.join(directory,'mcp-auth',project.id,'sentry'));
    assert.throws(()=>catalogConfiguration(catalogServer('sentry'),{project:'my-app'}),/organization/);assert.throws(()=>catalogConfiguration(catalogServer('sentry'),{organization:'../escape'}),/valid/);
    const atlassian=catalogManifest('atlassian',project);assert.ok(atlassian.args.includes('https://mcp.atlassian.com/v2/mcp'));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('Python tools use isolated versioned environments; database and browser defaults limit access',()=>{
  const {directory,project}=fixture();try{
    const fetch=catalogManifest('fetch',project);assert.equal(fetch.args[0],'tool');assert.ok(fetch.args.includes('mcp-server-fetch==2026.8.18'));assert.ok(fetch.args.includes('mcp>=1.29.0,<2'));
    const pg=catalogManifest('postgres',project,{DATABASE_URI:'private-database-uri-fixture'});assert.ok(pg.args.includes('--access-mode=restricted'));assert.ok(!JSON.stringify(pg).includes('private-database'));
    const mongo=catalogEnvironment({catalogId:'mongodb',catalogProjectId:project.id},directory);assert.equal(mongo.MDB_MCP_READ_ONLY,'true');assert.equal(mongo.MDB_MCP_TELEMETRY,'disabled');
    const chrome=catalogManifest('chrome-devtools',project);for(const flag of ['--headless','--isolated','--no-usage-statistics','--no-performance-crux'])assert.ok(chrome.args.includes(flag));
    assert.equal(catalogManifest('microsoft-learn',project).transport,'http');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('disabled catalog connections can be reconfigured without duplicates; enabled ones require disabling first',async()=>{
  const {directory,project}=fixture(),ext=new Extensions({extensions:[]},()=>{},root,directory);try{
    const entry=ext.addCatalog('sentry',project,{}, {organization:'first'});assert.equal(ext.addCatalog('sentry',project,{}, {organization:'second'}).id,entry.id);assert.equal(entry.catalogConfiguration.organization,'second');assert.ok(entry.args.includes('https://mcp.sentry.dev/mcp/second'));
    await ext.permissions(entry.id,{trusted:true,projects:[project.id]},[project.id]);assert.throws(()=>ext.addCatalog('sentry',project,{}, {organization:'third'}),/Disable/);assert.equal(entry.catalogConfiguration.organization,'second');
    await ext.permissions(entry.id,{trusted:true,projects:[]},[project.id]);ext.addCatalog('sentry',project,{}, {organization:'third'});assert.equal(entry.catalogConfiguration.organization,'third');assert.equal(entry.trusted,false);
  }finally{await ext.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('catalog bearer authentication reaches HTTP requests while workspace metadata stays secret-free',async()=>{
  const {directory,project}=fixture(),server=catalogServer('supabase'),originalUrl=server.url,oldToken=process.env.SUPABASE_ACCESS_TOKEN,received=[];
  const mock=http.createServer(async(req,res)=>{received.push(req.headers.authorization);if(req.method!=='POST'){res.writeHead(405);return res.end();}let raw='';for await(const chunk of req)raw+=chunk;const message=JSON.parse(raw);if(message.id===undefined){res.writeHead(202);return res.end();}const result=message.method==='initialize'?{protocolVersion:message.params.protocolVersion,serverInfo:{name:'auth-fixture',version:'1'},capabilities:{tools:{}}}:{tools:[{name:'safe_read',inputSchema:{type:'object',properties:{}}}]};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));});
  mock.listen(0,'127.0.0.1');await once(mock,'listening');const ext=new Extensions({extensions:[]},()=>{},root,directory);
  try{server.url=`http://127.0.0.1:${mock.address().port}/mcp`;process.env.SUPABASE_ACCESS_TOKEN='private-http-auth-fixture';const entry=ext.addCatalog('supabase',project,{SUPABASE_ACCESS_TOKEN:process.env.SUPABASE_ACCESS_TOKEN},{projectRef:'abc12345'});await ext.activateCatalog(entry,[project.id]);assert.equal(entry.tools[0].name,'safe_read');assert.ok(received.length>=2);assert.ok(received.every(value=>value==='Bearer private-http-auth-fixture'));assert.ok(!JSON.stringify(ext.state).includes('private-http-auth-fixture'));}
  finally{await ext.close();server.url=originalUrl;if(oldToken===undefined)delete process.env.SUPABASE_ACCESS_TOKEN;else process.env.SUPABASE_ACCESS_TOKEN=oldToken;await new Promise(resolve=>mock.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});
