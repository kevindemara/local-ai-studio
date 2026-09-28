import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { additionalServers } from './mcp-servers.mjs';
import { executable } from './studio-jobs.mjs';
import { npmArgs } from './project-runtime.mjs';
const exec = promisify(execFile);
export const mcpCatalog = {
  reviewedAt: '2026-09-28',
  servers: [
    {id:'filesystem',name:'Project files',publisher:'MCP reference servers',category:'Files',description:'Read, search and edit files inside the selected project folder.',access:'Can read and change project files directly. These edits do not pass through Studio’s change review or checkpoints.',source:'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',package:'@modelcontextprotocol/server-filesystem@2026.8.31',bin:'mcp-server-filesystem',requirements:'Node.js and npm. First connection downloads the server from npm.'},
    {id:'memory',name:'Persistent memory',publisher:'MCP reference servers',category:'Planning',description:'Remember project facts, decisions and relationships between chats.',access:'Reads and writes a local memory file dedicated to this project, outside your source folder.',source:'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',package:'@modelcontextprotocol/server-memory@2026.8.31',bin:'mcp-server-memory',requirements:'Node.js and npm. First connection downloads the server from npm.'},
    {id:'thinking',name:'Sequential thinking',publisher:'MCP reference servers',category:'Planning',description:'Give the model a tool for working through and revising a multi-step plan.',access:'Processes the text the model sends locally. This does not guarantee a better answer.',source:'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',package:'@modelcontextprotocol/server-sequential-thinking@2026.8.31',bin:'mcp-server-sequential-thinking',requirements:'Node.js and npm. First connection downloads the server from npm.'},
    {id:'playwright',name:'Playwright browser',publisher:'Microsoft',category:'Browser',description:'Let the model inspect pages and test a website in a separate browser session.',access:'Can visit websites and interact with their pages. Uses a temporary browser profile, not your signed-in browser.',source:'https://github.com/microsoft/playwright-mcp',package:'@playwright/mcp@0.0.82',bin:'playwright-mcp',requirements:'Node.js, npm and Google Chrome for browser actions. First connection downloads the server; tool discovery alone does not test browser actions.'},
    {id:'context7',name:'Context7 documentation',publisher:'Upstash',category:'Documentation',description:'Look up current library documentation and code examples.',access:'Sends library names and documentation queries to Context7. Do not include private code or secrets in queries.',source:'https://github.com/upstash/context7',package:'@upstash/context7-mcp@4.1.1',bin:'context7-mcp',optionalEnv:'CONTEXT7_API_KEY',requirements:'Node.js, npm and internet access. An optional CONTEXT7_API_KEY can raise service limits.',accountUrl:'https://context7.com/dashboard'},
    {id:'github',name:'GitHub repository tools',publisher:'GitHub',category:'GitHub',description:'Read repository files, issues and pull requests using GitHub’s official server.',access:'Read-only tools. Token permissions determine which repositories it can read; project assignment does not restrict the GitHub account.',source:'https://github.com/github/github-mcp-server',image:'ghcr.io/github/github-mcp-server:v1.12.2',requiredEnv:'GITHUB_PERSONAL_ACCESS_TOKEN',requirements:'Docker must be running. Set GITHUB_PERSONAL_ACCESS_TOKEN in your environment. This is separate from Studio’s GitHub CLI sign-in.',accountUrl:'https://github.com/settings/personal-access-tokens'},
    ...additionalServers,
    {id:'brave',name:'Brave web search',publisher:'Brave',category:'Search',description:'Search the web for references and public information.',access:'Sends search queries to Brave Search. Provider account limits and terms apply.',source:'https://github.com/brave/brave-search-mcp-server',package:'@brave/brave-search-mcp-server@2.1.4',bin:'brave-search-mcp-server',requiredEnv:'BRAVE_API_KEY',requirements:'Node.js, npm and a Brave Search API key in BRAVE_API_KEY.',accountUrl:'https://api.search.brave.com/'}
  ]
};
export function catalogServer(id) {
  const server=mcpCatalog.servers.find(s=>s.id===id);
  if(!server)throw new Error('Choose a server from the MCP catalog.');
  return server;
}
export function dockerCommand() {
  const windowsPath=path.join(process.env.ProgramFiles||'C:\\Program Files','Docker','Docker','resources','bin','docker.exe');
  return process.platform==='win32'&&fs.existsSync(windowsPath)?windowsPath:'docker';
}
export async function serverEnvironment(names) {
  if(names.some(name=>typeof name!=='string'||! /^[A-Z_][A-Z_0-9]*$/.test(name)))throw new Error('Invalid environment variable name.');
  const values={};for(const name of names)if(process.env[name])values[name]=process.env[name];
  // Read only explicitly named variables. Values never enter manifests or API responses.
  if(process.platform==='win32'&&names.length){
    const script='$studioValues=@{}; foreach($studioName in @('+names.map(name=>`'${name}'`).join(',')+")) { $studioValue=[Environment]::GetEnvironmentVariable($studioName,'User'); if($studioValue){$studioValues[$studioName]=$studioValue} }; $studioValues | ConvertTo-Json -Compress";
    try{const result=JSON.parse((await exec('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true,timeout:5000,maxBuffer:200000})).stdout);for(const name of names)if(typeof result[name]==='string'&&result[name].length<=8192)values[name]=result[name];}catch{}
  }
  return values;
}
export async function catalogStatus(environment) {
  environment ||= await serverEnvironment([...new Set(mcpCatalog.servers.flatMap(s=>[s.requiredEnv,s.optionalEnv].filter(Boolean)))]);
  let npmReady=true,dockerReady=false,uvReady=false;try{npmArgs([]);}catch{npmReady=false;}
  const results=await Promise.allSettled([exec(dockerCommand(),['info','--format','{{.ServerVersion}}'],{timeout:5000,windowsHide:true}),exec(executable('uv'),['--version'],{timeout:5000,windowsHide:true})]);
  dockerReady=results[0].status==='fulfilled';uvReady=results[1].status==='fulfilled';
  return {...mcpCatalog,installUvSupported:process.platform==='win32',servers:mcpCatalog.servers.map(s=>({...s,connection:s.oauth?'Browser sign-in':s.requiredEnv?'Account key':s.pythonPackage?'Local Python':s.url?'Remote · no account':'Local Node',ready:(!s.package||npmReady)&&(!s.image||dockerReady)&&(!s.pythonPackage||uvReady)&&(!s.requiredEnv||!!environment[s.requiredEnv]),missing:[...(s.package&&!npmReady?['Install Node.js with npm.']:[]),...(s.image&&!dockerReady?['Start or install Docker Desktop.']:[]),...(s.pythonPackage&&!uvReady?['Install uv, then recheck requirements.']:[]),...(s.requiredEnv&&!environment[s.requiredEnv]?[`Set ${s.requiredEnv}, then recheck requirements${process.platform==='win32'?'': ' after restarting the Studio server'}.`]:[])],uvMissing:!!s.pythonPackage&&!uvReady,optionalKeyReady:s.optionalEnv?!!environment[s.optionalEnv]:undefined}))};
}
export function catalogConfiguration(server,input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Enter connection settings as an object.');
  const fields=server.fields||[],configuration={};
  if(Object.keys(input).some(key=>!fields.some(f=>f.name===key)))throw new Error('Use only the connection settings shown for this server. Never enter keys here.');
  for(const field of fields){const value=input[field.name]??'';if(typeof value!=='string'||value.length>100)throw new Error(`Enter a valid ${field.label}.`);const clean=value.trim();if(!clean){if(field.required)throw new Error(`Enter ${field.label}.`);continue;}if(!new RegExp(field.pattern).test(clean))throw new Error(`Enter a valid ${field.label}.`);configuration[field.name]=clean;}
  if(server.id==='sentry'&&configuration.project&&!configuration.organization)throw new Error('Enter the Sentry organization when specifying a project.');
  return configuration;
}
export function catalogUrl(server,configuration={}) {
  const url=new URL(server.url);
  if(server.id==='supabase'){url.searchParams.set('project_ref',configuration.projectRef);url.searchParams.set('read_only','true');url.searchParams.set('features','database,docs');}
  if(server.id==='sentry'){if(configuration.organization)url.pathname+='/'+encodeURIComponent(configuration.organization);if(configuration.project)url.pathname+='/'+encodeURIComponent(configuration.project);}
  return url.href;
}
export function catalogHeaders(entry,environment) {
  if(!entry.catalogId)return {};
  const server=catalogServer(entry.catalogId);
  if(!server.bearerEnv||!environment[server.bearerEnv])return {};
  // Do not send account credentials to modified or arbitrary manifest URLs.
  const configuration=catalogConfiguration(server,entry.catalogConfiguration||{});
  if(entry.url!==catalogUrl(server,configuration))throw new Error('Reconnect using the reviewed catalog endpoint.');
  return {Authorization:`Bearer ${environment[server.bearerEnv]}`};
}
export function catalogManifest(id,project,environment=process.env,input={}) {
  const server=catalogServer(id),configuration=catalogConfiguration(server,input);
  if(!project?.folder||!fs.existsSync(project.folder))throw new Error('Choose a project with an existing folder first.');
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(project.id))throw new Error('Invalid project identifier.');
  if(server.requiredEnv&&!environment[server.requiredEnv])throw new Error(`Set ${server.requiredEnv} in your environment, then recheck requirements. Never paste a key into a plugin manifest.`);
  const base={name:`${server.name} · ${project.name}`,description:server.description,envNames:[server.requiredEnv,server.optionalEnv].filter(Boolean)};
  if(server.url&&!server.oauth)return {...base,transport:'http',url:catalogUrl(server,configuration)};
  const folder=fs.realpathSync.native(project.folder);
  if(id==='git'&&!fs.existsSync(path.join(folder,'.git')))throw new Error('Initialize Git for this project in GitHub & repos, then reconnect Local Git tools.');
  let command=process.execPath,args;
  const extra=server.oauth?[catalogUrl(server,configuration),'--transport','http-only']:id==='filesystem'?[folder]:id==='playwright'?['--isolated','--headless','--browser','chrome']:id==='brave'?['--transport','stdio']:id==='git'?['--repository',folder]:server.extra||[];
  if(server.image){command=dockerCommand();args=['run','--rm','-i','-e',server.requiredEnv,'-e','GITHUB_READ_ONLY=1','-e','GITHUB_TOOLSETS=repos,issues,pull_requests',server.image];}
  else if(server.pythonPackage){command=executable('uv');args=['tool','run','--from',server.pythonPackage,'--with','mcp>=1.29.0,<2',server.bin,...extra];}
  else args=npmArgs(['exec','--yes','--package',server.package,'--',server.bin,...extra]);
  return {...base,transport:'stdio',command,args};
}
export function catalogEnvironment(entry,dataDir) {
  if(!entry.catalogId)return {};
  const server=catalogServer(entry.catalogId);
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(entry.catalogProjectId))throw new Error('Invalid catalog project.');
  const environment={PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||''),NPM_CONFIG_IGNORE_SCRIPTS:'true',NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false'};
  if(entry.catalogId==='memory'){
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(entry.catalogProjectId))throw new Error('Invalid memory project.');
    const directory=path.join(dataDir,'mcp-memory');fs.mkdirSync(directory,{recursive:true});environment.MEMORY_FILE_PATH=path.join(directory,entry.catalogProjectId+'.jsonl');
  }
  if(server.oauth){const directory=path.join(dataDir,'mcp-auth',entry.catalogProjectId,entry.catalogId);fs.mkdirSync(directory,{recursive:true});environment.MCP_REMOTE_CONFIG_DIR=directory;}
  if(server.pythonPackage)environment.PYTHONIOENCODING='utf-8';
  if(entry.catalogId==='chrome-devtools')environment.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS='1';
  if(entry.catalogId==='mongodb'){environment.MDB_MCP_READ_ONLY='true';environment.MDB_MCP_TELEMETRY='disabled';}
  if(entry.catalogId==='thinking')environment.DISABLE_THOUGHT_LOGGING='true';
  return environment;
}
