import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { executable, runCommand } from './studio-jobs.mjs';
import { gitStatus } from './project-git.mjs';
const exec=promisify(execFile);
const env={...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'};
async function gh(args,cwd,signal){return(await exec(executable('gh'),args,{cwd,env,signal,windowsHide:true,timeout:90000,maxBuffer:2_000_000})).stdout;}
export async function account(){try{const user=JSON.parse(await gh(['api','user']));return{connected:true,login:user.login,url:user.html_url};}catch{return{connected:false,message:'Install GitHub CLI and connect your account to clone private repositories or publish.'};}}
export async function repositories(){return JSON.parse(await gh(['repo','list','--limit','100','--json','nameWithOwner,url,isPrivate,description,updatedAt']));}
export async function login(signal,update){let entered=false;return runCommand(executable('gh'),['auth','login','--hostname','github.com','--git-protocol','https','--web'],{signal,onOutput:(output,child)=>{
  const code=output.match(/(?:code:?\s*|\()([A-Z0-9]{4}-[A-Z0-9]{4})\)?/i)?.[1];
  update({message:code?'Open GitHub, enter this code, and authorize GitHub CLI.':'Waiting for GitHub sign-in',deviceCode:code,url:'https://github.com/login/device'});
  if(/Authenticate Git/i.test(output)&&!entered){child.stdin.write('Y\n');entered=true;}
  if(/Press Enter/i.test(output))child.stdin.write('\n');
}});}
export function repoSlug(value){if(typeof value!=='string'||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)||value.split('/').some(x=>x==='.'||x==='..'))throw new Error('Use a GitHub repository name such as owner/project.');return value;}
export async function cloneRepository(slug,destination,signal){repoSlug(slug);if(fs.existsSync(destination))throw new Error('Choose a new project folder.');fs.mkdirSync(path.dirname(destination),{recursive:true});await gh(['repo','clone',slug,destination,'--','--no-recurse-submodules'],undefined,signal);signal?.throwIfAborted();return{folder:destination};}
export async function gitCommand(project,args){
  const status=await gitStatus(project);if(!status.repository)throw new Error(status.error||'Initialize the repository first.');
  return(await exec(executable('git'),['-C',fs.realpathSync.native(project.folder),...args],{env,windowsHide:true,timeout:90000,maxBuffer:1_000_000})).stdout;
}
export async function branches(project){const text=await gitCommand(project,['for-each-ref','--format=%(refname:short)','refs/heads']);let remote='';try{remote=(await gitCommand(project,['remote','get-url','origin'])).trim();}catch{}return{branches:text.trim().split('\n').filter(Boolean),remote};}
export async function changeBranch(project,input){
  if(!(await gitStatus(project)).files.length){
    const name=String(input.name||'');if(name.startsWith('-')||name.length>120||/\s|[~^:?*\[\\]/.test(name))throw new Error('Use a short branch name without spaces.');
    await gitCommand(project,['check-ref-format','--branch',name]);
    return{output:await gitCommand(project,input.create?['switch','-c',name]:['switch',name])};
  }throw new Error('Commit your changes before switching branches.');
}
async function githubRemote(project){const remote=(await branches(project)).remote;if(! /^(https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remote))throw new Error('This workflow requires an origin on github.com.');return remote;}
export async function syncRepository(project,action){
  await githubRemote(project);
  if(action==='pull'){if((await gitStatus(project)).files.length)throw new Error('Commit changes before pulling.');return{output:await gitCommand(project,['pull','--ff-only','origin'])};}
  if(action==='push'){const status=await gitStatus(project);if(!status.branch)throw new Error('Switch to a named branch first.');await gh(['auth','setup-git']);return{output:await gitCommand(project,['push','--set-upstream','origin',status.branch])};}
  throw new Error('Choose Pull or Push.');
}
export async function publishRepository(project,input){
  const name=String(input.name||'');if(! /^[A-Za-z0-9_.-]{1,100}$/.test(name)||name==='.'||name==='..')throw new Error('Enter a repository name using letters, numbers and hyphens.');
  if(!['public','private'].includes(input.visibility))throw new Error('Choose Public or Private.');
  const status=await gitStatus(project);if(!status.repository||!status.commits)throw new Error('Initialize Git and make your first commit before publishing.');
  if((await branches(project)).remote)throw new Error('This project already has an origin. Use Push.');
  const user=await account();if(!user.connected)throw new Error('Connect your GitHub account first.');
  // Publishing pushes committed history only; never stage unselected files automatically.
  await gh(['auth','setup-git']);
  const output=await gh(['repo','create',`${user.login}/${name}`,`--${input.visibility}`,'--source',project.folder,'--remote','origin','--push'],project.folder);
  return{output,url:`https://github.com/${user.login}/${name}`};
}
export function changelogEntry(input){
  const version=String(input.version||'Unreleased').replace(/[\r\n]/g,' ').slice(0,80), summary=String(input.summary||'').trim().slice(0,4000);
  if(!summary)throw new Error('Describe what changed.');
  const template=String(input.template||'## {version} — {date}\n\n{summary}\n').slice(0,6000);
  return template.replaceAll('{version}',version).replaceAll('{date}',new Date().toISOString().slice(0,10)).replaceAll('{summary}',summary)+'\n';
}
