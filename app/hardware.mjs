import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile), GiB = 1024 ** 3;
export const catalog = JSON.parse(fs.readFileSync(new URL('./model-catalog.json', import.meta.url)));
export function parseNvidia(text) {
  return text.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [name,total,free,utilization] = line.split(',').map(x => x.trim());
    return { name, vendor: 'NVIDIA', memoryGiB: Number(total)/1024, freeGiB: Number(free)/1024, utilization: Number(utilization), confidence:'measured' };
  }).filter(g => Number.isFinite(g.memoryGiB) && g.memoryGiB > 0);
}
export function recommendations(hardware, goal = 'coding') {
  const ram = hardware.ramGiB || 0;
  // A single model is loaded on one GPU. Do not add separate GPUs' VRAM together.
  const gpu = Math.max(0, ...hardware.gpus.map(g => g.memoryGiB || 0));
  const usable = hardware.unified ? Math.max(0,ram-8) : Math.max(0,gpu-2);
  return catalog.models.map(m => {
    const weightsGiB = m.downloadGB * 1e9 / GiB;
    const workingGiB = weightsGiB + Math.max(1, weightsGiB * .12);
    const gpuFit = usable >= workingGiB;
    const ramFit = ram - 5 >= workingGiB;
    const fit = gpuFit ? 'good' : ramFit ? 'cpu' : 'insufficient';
    const reason = gpuFit ? 'Fits with room for the runtime and a modest context.' : ramFit ? 'Uses system RAM; CPU or partial GPU loading can be much slower.' : 'Not enough detected memory. Choose a smaller model.';
    return {...m, weightsGiB, workingGiB, fit, reason, score: (fit==='good'?100:fit==='cpu'?30:0)+(m.goals.includes(goal)?15:0)+(m.priority||0)};
  }).sort((a,b)=>b.score-a.score);
}
async function command(file,args) { try { return (await exec(file,args,{windowsHide:true,timeout:10000,maxBuffer:1_000_000})).stdout.trim(); } catch { return ''; } }
export async function detectHardware(dataDir) {
  const hardware = { platform:process.platform, arch:process.arch, cpu:os.cpus()[0]?.model || 'Unknown CPU', cores:os.cpus().length, ramGiB:os.totalmem()/GiB, availableRamGiB:os.freemem()/GiB, gpus:[], unified:false, warnings:[] };
  let nvidia = await command('nvidia-smi',['--query-gpu=name,memory.total,memory.free,utilization.gpu','--format=csv,noheader,nounits']);
  if (!nvidia && process.platform==='win32') nvidia = await command(path.join(process.env.SystemRoot || 'C:\\Windows','System32','nvidia-smi.exe'),['--query-gpu=name,memory.total,memory.free,utilization.gpu','--format=csv,noheader,nounits']);
  hardware.gpus = nvidia ? parseNvidia(nvidia) : [];
  if (!hardware.gpus.length && process.platform==='win32') {
    const text = await command('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress']);
    try { const rows = JSON.parse(text); hardware.gpus = (Array.isArray(rows)?rows:[rows]).filter(Boolean).map(g=>({name:g.Name,vendor:/AMD|Radeon/i.test(g.Name)?'AMD':/Intel/i.test(g.Name)?'Intel':'Unknown',memoryGiB:null,confidence:'unknown'})); } catch {}
    hardware.warnings.push('Windows cannot reliably report this adapter’s usable VRAM. Memory fit uses system RAM until you enter verified dedicated VRAM.');
  }
  if (process.platform==='darwin') {
    const text = await command('system_profiler',['SPDisplaysDataType','-json']);
    try { const info = JSON.parse(text).SPDisplaysDataType || []; hardware.unified = process.arch==='arm64'; hardware.gpus = info.map(g=>({name:g.sppci_model||'Apple GPU',vendor:hardware.unified?'Apple':'Unknown',memoryGiB:hardware.unified?hardware.ramGiB:null,confidence:hardware.unified?'unified':'unknown'})); } catch {}
  }
  if (!hardware.gpus.length && process.platform==='linux') {
    const text = await command('lspci',[]); hardware.gpus = text.split('\n').filter(l=>/VGA|3D controller|Display controller/i.test(l)).map(l=>({name:l.replace(/^.*?: /,''),memoryGiB:null,confidence:'unknown'}));
  }
  try { const disk=fs.statfsSync(dataDir); hardware.diskFreeGiB=Number(disk.bavail)*Number(disk.bsize)/GiB; } catch { hardware.diskFreeGiB=null; }
  hardware.detectedAt = new Date().toISOString();
  return hardware;
}
