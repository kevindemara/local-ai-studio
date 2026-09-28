import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
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
  constructor(state,save,root){this.state=state;this.save=save;this.root=root;this.sessions=new Map();state.extensions ||= [];}
  add(input){if(this.state.extensions.length>=25)throw new Error('Remove an unused connection first.');const entry=validateExtension(input);this.state.extensions.push(entry);this.save();return entry;}
  example(){return this.add({name:'Studio helper',description:'Bundled read-only demonstration: current time and text word counts.',command:process.execPath,args:[path.join(this.root,'example-mcp.mjs')],transport:'stdio'});}
  get(id){const entry=this.state.extensions.find(x=>x.id===id);if(!entry)throw new Error('Connection not found.');return entry;}
  async connect(entry){
    if(!entry.trusted)throw new Error('Review and trust this server before connecting.');
    if(this.sessions.has(entry.id))return this.sessions.get(entry.id);
    const client=new Client({name:'local-ai-studio',version:'0.2.0'});
    const env={...getDefaultEnvironment()};for(const name of entry.envNames){if(process.env[name])env[name]=process.env[name];}
    const transport=entry.transport==='http'?new StreamableHTTPClientTransport(new URL(entry.url)):new StdioClientTransport({command:entry.command,args:entry.args,env,stderr:'ignore',maxBufferSize:1_000_000});
    try{await client.connect(transport,{timeout:15000});this.sessions.set(entry.id,client);return client;}catch(error){await client.close().catch(()=>{});throw new Error(`Could not connect to ${entry.name}: ${error.message}`);}
  }
  async inspect(id){const entry=this.get(id),client=await this.connect(entry);const result=await client.listTools({}, {timeout:15000});entry.tools=result.tools.slice(0,40).map(t=>({name:t.name,description:String(t.description||'').slice(0,1000),inputSchema:t.inputSchema}));entry.checkedAt=new Date().toISOString();this.save();return entry;}
  async permissions(id,input,projectIds){
    const entry=this.get(id);if(typeof input.trusted!=='boolean'||!Array.isArray(input.projects)||input.projects.some(id=>!projectIds.includes(id)))throw new Error('Choose trust and valid projects.');
    entry.trusted=input.trusted;entry.projects=[...new Set(input.projects)];if(!entry.trusted){await this.sessions.get(id)?.close();this.sessions.delete(id);entry.tools=[];}this.save();return entry;
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
