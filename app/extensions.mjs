import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { catalogManifest, catalogEnvironment, serverEnvironment, catalogServer, catalogConfiguration, catalogHeaders } from './mcp-catalog.mjs';
export function validateExtension(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Import a plugin manifest object.');
  const name=String(input.name||'').trim().slice(0,80);
  if(!name)throw new Error('Name this connection.');
  const transport=input.transport || 'stdio';
  const value={id:randomUUID(),name,transport,projects:[],trusted:false,tools:[],description:String(input.description||'').slice(0,500)};
  if(transport==='http') {
    const url=new URL(input.url);if(url.username||url.password)throw new Error('Use environment credentials, not passwords in URLs.');
    if(url.protocol!=='https:' && !(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Use HTTPS or a local HTTP MCP server.');
    value.url=url.href;
  } else if(transport==='stdio') {
    if(typeof input.command!=='string'||!input.command.trim()||input.command.length>500||input.command.includes('\0'))throw new Error('Enter the executable path or command.');
    if(!Array.isArray(input.args)||input.args.length>30||input.args.some(x=>typeof x!=='string'||x.length>2000||x.includes('\0')))throw new Error('Arguments must be a JSON array of strings.');
    value.command=input.command;value.args=input.args;
  } else throw new Error('Choose stdio or HTTP transport.');
  value.envNames=(input.envNames||[]);if(!Array.isArray(value.envNames)||value.envNames.length>20||value.envNames.some(x=>typeof x!=='string'||! /^[A-Z_][A-Z_0-9]*$/.test(x)))throw new Error('Enter environment variable names, not secret values.');
  return value;
}
export class Extensions {
  constructor(state,save,root,dataDir=path.join(root,'data')){this.state=state;this.save=save;this.root=root;this.dataDir=dataDir;this.sessions=new Map();state.extensions ||= [];}
  add(input){if(this.state.extensions.length>=100)throw new Error('Remove an unused connection first.');const entry=validateExtension(input);this.state.extensions.push(entry);this.save();return entry;}
  example(){return this.add({name:'Studio helper',description:'Bundled read-only demonstration: current time and text word counts.',command:process.execPath,args:[path.join(this.root,'example-mcp.mjs')],transport:'stdio'});}
  addCatalog(id,project,environment,input){
    const existing=this.state.extensions.find(e=>e.catalogId===id&&e.catalogProjectId===project.id);
    const configuration=catalogConfiguration(catalogServer(id),input??existing?.catalogConfiguration??{});
    const manifest=catalogManifest(id,project,environment,configuration);
    if(existing){
      if(JSON.stringify(existing.catalogConfiguration||{})!==JSON.stringify(configuration)){
        if(existing.projects.length||this.sessions.has(existing.id))throw new Error('Disable this connection before changing its settings.');
        const replacement=validateExtension(manifest);Object.assign(existing,replacement,{id:existing.id,catalogConfiguration:configuration});this.save();
      }
      return existing;
    }
    const entry=this.add(manifest);entry.catalogId=id;entry.catalogProjectId=project.id;entry.catalogConfiguration=configuration;this.save();return entry;
  }
  async activateCatalog(entry,projectIds,signal){
    if(!entry.catalogId)throw new Error('Choose a catalog connection.');
    try{await this.permissions(entry.id,{trusted:true,projects:[entry.catalogProjectId]},projectIds);await this.inspect(entry.id,signal);signal?.throwIfAborted();return {extensionId:entry.id,tools:entry.tools.length};}
    catch(error){await this.permissions(entry.id,{trusted:false,projects:[]},projectIds);entry.lastError=signal?.aborted?'Connection cancelled. Retry when ready.':error.message;this.save();throw error;}
  }
  get(id){const entry=this.state.extensions.find(x=>x.id===id);if(!entry)throw new Error('Connection not found.');return entry;}
  async connect(entry,signal){
    if(!entry.trusted)throw new Error('Review and trust this server before connecting.');
    if(this.sessions.has(entry.id))return this.sessions.get(entry.id);
    const client=new Client({name:'local-ai-studio',version:'0.2.2'});
    client.onclose=()=>{if(this.sessions.get(entry.id)===client)this.sessions.delete(entry.id);};
    const selectedEnvironment=entry.catalogId?await serverEnvironment(entry.envNames):Object.fromEntries(entry.envNames.filter(name=>process.env[name]).map(name=>[name,process.env[name]]));
    if(entry.catalogId){const required=catalogServer(entry.catalogId).requiredEnv;if(required&&!selectedEnvironment[required])throw new Error(`Set ${required}, then recheck requirements.`);}
    const env={...getDefaultEnvironment(),...catalogEnvironment(entry,this.dataDir),...selectedEnvironment};
    const transport=entry.transport==='http'?new StreamableHTTPClientTransport(new URL(entry.url),{requestInit:{headers:catalogHeaders(entry,selectedEnvironment)}}):new StdioClientTransport({command:entry.command,args:entry.args,env,stderr:'ignore',maxBufferSize:1_000_000});
    try{await client.connect(transport,{timeout:entry.catalogId?(catalogServer(entry.catalogId).oauth||catalogServer(entry.catalogId).pythonPackage?300000:120000):15000,signal});if(!entry.trusted||signal?.aborted){await client.close();throw new Error('Connection was cancelled or disabled.');}this.sessions.set(entry.id,client);return client;}catch(error){await client.close().catch(()=>{});throw new Error(`Could not connect to ${entry.name}. Check its prerequisites and internet access, then retry.`);}
  }
  async inspect(id,signal){const entry=this.get(id),client=await this.connect(entry,signal);const result=await client.listTools({}, {timeout:15000,signal});entry.tools=result.tools.slice(0,100).map(t=>({name:t.name,description:String(t.description||'').slice(0,1000),inputSchema:t.inputSchema}));entry.checkedAt=new Date().toISOString();delete entry.lastError;this.save();return entry;}
  async permissions(id,input,projectIds){
    const entry=this.get(id);if(typeof input.trusted!=='boolean'||!Array.isArray(input.projects)||input.projects.some(id=>!projectIds.includes(id)))throw new Error('Choose trust and valid projects.');
    if(entry.catalogProjectId&&input.projects.some(id=>id!==entry.catalogProjectId))throw new Error('Connect this catalog server separately for each project. Its configuration belongs to one project.');
    entry.trusted=input.trusted;entry.projects=[...new Set(input.projects)];if(!entry.trusted||!entry.projects.length){await this.sessions.get(id)?.close();this.sessions.delete(id);if(!entry.trusted)entry.tools=[];}this.save();return entry;
  }
  definitions(project,mode){if(mode!=='build'||project.autoFiles===false)return[];return this.state.extensions.filter(e=>e.trusted&&e.projects.includes(project.id)).flatMap(e=>e.tools.map((t,i)=>({type:'function',function:{name:`mcp_${e.id.replaceAll('-','')}_${i}`,description:`${e.name}: ${t.description}`.slice(0,1100),parameters:t.inputSchema}}))).slice(0,80);}
  async call(project,mode,name,args,signal){
    if(mode!=='build'||project.autoFiles===false)throw new Error('MCP actions are only available in Build mode.');
    const match=/^mcp_([0-9a-f]{32})_(\d+)$/.exec(name);const entry=match&&this.state.extensions.find(e=>e.id.replaceAll('-','')===match[1]);
    if(!entry?.trusted||!entry.projects.includes(project.id))throw new Error('This connection is disabled for the project.');
    const selected=entry.tools[Number(match[2])];if(!selected)throw new Error('Tool is unavailable. Recheck the connection.');
    const client=await this.connect(entry);const result=await client.callTool({name:selected.name,arguments:args},{signal,timeout:60000});
    return{server:entry.name,tool:selected.name,isError:!!result.isError,content:JSON.stringify(result.content||[]).slice(0,18000)};
  }
  async remove(id){await this.sessions.get(id)?.close();this.sessions.delete(id);this.state.extensions=this.state.extensions.filter(e=>e.id!==id);this.save();}
  async close(){await Promise.allSettled([...this.sessions.values()].map(c=>c.close()));this.sessions.clear();}
}
