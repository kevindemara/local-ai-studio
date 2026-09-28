import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {unzipSync} from 'fflate';
import {runCommand} from './studio-jobs.mjs';
import {npmArgs} from './project-runtime.mjs';

const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const skipped=new Set(['.git','node_modules','.venv','venv','__pycache__','.next','dist','build','.cache','coverage']);
function relative(value){if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.includes('\0')||value.startsWith('/')||value.split('/').some(p=>p==='..'||p==='.'))throw new Error('Unsafe archive path.');return value;}
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function noLinks(file,root){const rel=path.relative(root,file);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Path is outside the backup.');for(let dir=file;;dir=path.dirname(dir)){if((await fs.lstat(dir)).isSymbolicLink())throw new Error('Linked backup paths are not supported.');if(dir===root)break;}}
export class Backups {
  constructor(data){this.data=path.resolve(data);this.root=path.join(this.data,'snapshots');}
  async list(){await fs.mkdir(this.root,{recursive:true});await noLinks(this.root,this.data);const list=[];for(const name of await fs.readdir(this.root)){if(!/^[a-f\d-]{36}$/.test(name))continue;try{await noLinks(path.join(this.root,name,'manifest.json'),this.root);const m=JSON.parse(await fs.readFile(path.join(this.root,name,'manifest.json'),'utf8'));if(m.id===name&&m.complete)list.push({id:m.id,label:m.label,createdAt:m.createdAt,files:m.files.length,bytes:m.bytes,projects:m.workspace.projects.length,warnings:m.warnings});}catch{}}return list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async create(state,label='Workspace backup',signal,update=()=>{}){
    const id=randomUUID(),folder=path.join(this.root,id),workspace=structuredClone(state),files=[],warnings=[];let bytes=0;
    await fs.mkdir(folder,{recursive:true});
    await noLinks(folder,this.data);
    const copy=async(source,prefix)=>{if(!await exists(source))return;const base=await fs.lstat(source);if(base.isSymbolicLink()){warnings.push(`Skipped linked folder: ${prefix}`);return;}const walk=async(dir,rel='')=>{for(const item of await fs.readdir(dir,{withFileTypes:true})){signal?.throwIfAborted();if(skipped.has(item.name))continue;const src=path.join(dir,item.name),name=[prefix,rel,item.name].filter(Boolean).join('/');if(item.isSymbolicLink()){warnings.push(`Skipped linked path: ${name}`);continue;}if(item.isDirectory()){await walk(src,[rel,item.name].filter(Boolean).join('/'));continue;}if(!item.isFile())continue;const stat=await fs.lstat(src);if(stat.isSymbolicLink())throw new Error('A source file changed to a link during backup.');if(stat.size>100_000_000||bytes+stat.size>2_000_000_000||files.length>=20000)throw new Error('Backup exceeds the 2 GB / 20,000 file limit. Exclude large assets first.');const content=await fs.readFile(src);bytes+=content.length;const target=path.join(folder,relative(name));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});files.push({path:name,sha256:digest(content),bytes:content.length});update({message:`Copied ${files.length} files (${Math.round(bytes/1024)} KB).`});}};await walk(source);};
    for(const project of workspace.projects){if(project.folder){const source=path.resolve(project.folder);if(source===this.data||this.root.startsWith(source+path.sep))throw new Error('A project contains Studio data. Choose a separate project folder before backing up.');await copy(source,'projects/'+project.id);}}
    await copy(path.join(this.data,'backups'),'backups');await copy(path.join(this.data,'checkpoints'),'checkpoints');await copy(path.join(this.data,'mcp-memory'),'mcp-memory');
    const manifest={id,label:String(label).slice(0,100),createdAt:new Date().toISOString(),dataDir:this.data,workspace,files,bytes,warnings,complete:true};
    await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});return {id,files:files.length,bytes,warnings};
  }
  async restore(id,signal,update=()=>{}){
    if(!/^[a-f\d-]{36}$/.test(id))throw new Error('Invalid backup ID.');const folder=path.join(this.root,id);await noLinks(path.join(folder,'manifest.json'),this.data);
    const m=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));if(m.id!==id||!m.complete||!Array.isArray(m.files)||m.files.length>20000||!Array.isArray(m.workspace?.projects)||!Array.isArray(m.workspace?.chats))throw new Error('Backup is incomplete or invalid.');
    if(m.workspace.projects.some(p=>!/^[-a-zA-Z0-9_]{1,100}$/.test(p.id))||typeof m.dataDir!=='string')throw new Error('Invalid project metadata.');
    const allowed=new Set(m.workspace.projects.map(p=>`projects/${p.id}`));let bytes=0;const names=new Set();
    for(const item of m.files){signal?.throwIfAborted();relative(item.path);const prefix=item.path.split('/').slice(0,2).join('/');if(!allowed.has(prefix)&&!item.path.startsWith('backups/')&&!item.path.startsWith('checkpoints/')&&!item.path.startsWith('mcp-memory/'))throw new Error('Unexpected backup entry.');if(names.has(item.path.toLowerCase()))throw new Error('Duplicate backup entry.');names.add(item.path.toLowerCase());const src=path.join(folder,item.path);await noLinks(src,folder);const stat=await fs.stat(src);bytes+=stat.size;if(stat.size>100_000_000||bytes>2_000_000_000)throw new Error('Backup exceeds recovery limits.');if(stat.size!==item.bytes||digest(await fs.readFile(src))!==item.sha256)throw new Error(`Backup integrity check failed: ${item.path}`);}
    const destination=path.join(this.data,'recovered',randomUUID());await fs.mkdir(destination,{recursive:true});
    for(const item of m.files){signal?.throwIfAborted();const src=path.join(folder,item.path);await noLinks(src,folder);const content=await fs.readFile(src);if(digest(content)!==item.sha256)throw new Error('Backup changed during recovery.');const target=path.join(destination,item.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});}
    const workspace=structuredClone(m.workspace);for(const p of workspace.projects){if(p.folder){p.folder=path.join(destination,'projects',p.id);await fs.mkdir(p.folder,{recursive:true});}}
    // Backup paths are absolute in change records. Repoint them into this recovery, never overwrite originals.
    const replace=value=>{for(const dir of ['backups','checkpoints','mcp-memory'])if(typeof value==='string'&&value.startsWith(path.join(m.dataDir,dir)+path.sep))return path.join(destination,dir,path.relative(path.join(m.dataDir,dir),value));if(Array.isArray(value))return value.map(replace);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));return value;};
    const restored=replace(workspace);for(const r of restored.runs||[])if(['running','queued'].includes(r.status)){r.status='interrupted';r.phase='Recovered; continue manually';}for(const c of restored.chats)for(const msg of c.messages||[])if(msg.status==='generating')msg.status='interrupted';
    for(const e of restored.extensions||[]){e.trusted=false;e.projects=[];e.tools=[];e.lastError='Reconnect after recovery to review access to the recovered project folder.';}
    update({message:'Verified and recovered files into separate folders. Original project folders remain available.'});return {workspace:restored,destination};
  }
}
export function newer(a,b){const parse=v=>/^v?\d+\.\d+\.\d+$/.test(v)?v.replace(/^v/,'').split('.').map(Number):null;const x=parse(a),y=parse(b);if(!x||!y)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
export function chooseRelease(releases,version,channel='preview'){
  const choices=releases.filter(r=>!r.draft&&(channel==='preview'||!r.prerelease)&&/^v\d+\.\d+\.\d+$/.test(r.tag_name)).sort((a,b)=>newer(a.tag_name,b.tag_name)?-1:newer(b.tag_name,a.tag_name)?1:0);
  const r=choices[0];if(!r)return {available:false,version:null};const asset=r.assets?.find(a=>a.name===`local-ai-studio-${r.tag_name.slice(1)}.zip`);
  return {available:newer(r.tag_name,version),version:r.tag_name,prerelease:r.prerelease,url:`https://github.com/kevindemara/local-ai-studio/releases/tag/${r.tag_name}`,notes:String(r.body||'').slice(0,10000),asset:asset?{name:asset.name,url:asset.browser_download_url,digest:asset.digest,size:asset.size}:null};
}
export async function checkUpdates(version,channel){const res=await fetch('https://api.github.com/repos/kevindemara/local-ai-studio/releases?per_page=30',{headers:{Accept:'application/vnd.github+json','User-Agent':'Local-AI-Studio'},signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error(`GitHub update check failed (${res.status}). Try again later.`);return {...chooseRelease(await res.json(),version,channel),checkedAt:new Date().toISOString()};}
export function extractRelease(buffer,expected,version){
  if(buffer.length>10_000_000||!/^sha256:[a-f\d]{64}$/.test(expected)||`sha256:${digest(buffer)}`!==expected)throw new Error('Release checksum did not match GitHub metadata.');let total=0,count=0;const names=new Set();
  const files=unzipSync(buffer,{filter:file=>{const name=relative(file.name);if(names.has(name.toLowerCase()))throw new Error('Duplicate release entry.');names.add(name.toLowerCase());total+=file.originalSize;if(++count>2000||file.originalSize>5_000_000||total>25_000_000)throw new Error('Release archive exceeds installation limits.');if(name.split('/').some(p=>['.git','node_modules','data','projects','snapshots'].includes(p)))throw new Error('Release contains private or unexpected directories.');return !name.endsWith('/');}});
  const prefix='local-ai-studio-'+version.replace(/^v/,'')+'/'; const normalized=Object.fromEntries(Object.entries(files).map(([name,content])=>[name.startsWith(prefix)?name.slice(prefix.length):name,content])); const packageFile=normalized['package.json'];if(!packageFile||!normalized['app/server.mjs']||!normalized['scripts/launch.mjs'])throw new Error('Release does not contain the expected application.');const pkg=JSON.parse(Buffer.from(packageFile).toString());if(pkg.name!=='local-ai-studio'||'v'+pkg.version!==version)throw new Error('Release version does not match its package.');return normalized;
}
export async function prepareUpdate(release,data,signal,update=()=>{}){
  const asset=release.asset;if(!release.available||!asset||!/^v\d+\.\d+\.\d+$/.test(release.version)||asset.url!==`https://github.com/kevindemara/local-ai-studio/releases/download/${release.version}/${asset.name}`||asset.name!==`local-ai-studio-${release.version.slice(1)}.zip`||asset.size>10_000_000)throw new Error('No verified release is available to install.');
  update({message:'Downloading the official release…'});const res=await fetch(asset.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});if(!res.ok)throw new Error('Release download failed.');let size=0;const chunks=[];for await(const chunk of res.body){size+=chunk.length;if(size>10_000_000)throw new Error('Release download exceeds limits.');chunks.push(chunk);}const files=extractRelease(Buffer.concat(chunks),asset.digest,release.version);
  const folder=path.join(data,'app-releases',release.version+'-'+randomUUID());await fs.mkdir(folder,{recursive:true});for(const [name,content] of Object.entries(files)){signal.throwIfAborted();const target=path.join(folder,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});}
  await noLinks(folder,path.resolve(data));update({message:'Checksum verified. Installing application dependencies…'});
  await runCommand(process.execPath,npmArgs(['ci','--ignore-scripts','--no-audit','--no-fund']),{cwd:folder,signal,onOutput:text=>update({message:String(text).slice(-500)})});
  const check=await runCommand(process.execPath,['--check',path.join(folder,'app','server.mjs')],{cwd:folder,signal});return {folder,version:release.version,syntaxChecked:!check.exitCode};
}
