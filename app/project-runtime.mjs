import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { projectTarget } from './project-files.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

const running = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function rootOf(project) { if (!project.folder) throw new Error('Create project files first.'); return fs.realpathSync.native(project.folder); }
export function packageInfo(project) {
  if (!project.folder || !fs.existsSync(path.join(project.folder, 'package.json'))) return null;
  const { target } = projectTarget(project, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(target, 'utf8'));
  return { name: pkg.name, scripts: pkg.scripts || {}, dependencies: { ...pkg.dependencies, ...pkg.devDependencies } };
}
function npmArgs(args) {
  const candidates=[path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),'/usr/share/nodejs/npm/bin/npm-cli.js',path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
  try{candidates.unshift(path.join(path.dirname(require.resolve('npm/package.json')),'bin','npm-cli.js'));}catch{}
  const cli=candidates.find(file=>fs.existsSync(file));
  if (!cli) throw new Error('npm was not found. Install Node.js with npm.');
  return [cli, ...args];
}
export async function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  else {try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}
}
function spawnProject(project, args, onOutput = () => {}, env = {}) {
  const child = spawn(process.execPath, args, { cwd: rootOf(project), windowsHide: true, detached:process.platform!=='win32', env: { ...process.env, ...env, CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const add = data => { const text = data.toString().replace(/\x1b\[[0-9;]*m/g, ''); output = (output + text).slice(-40_000); onOutput(text); };
  child.stdout.on('data', add); child.stderr.on('data', add);
  child.on('error', error => add(error.message));
  return { child, output: () => output };
}
export async function runProjectTask(project, input, signal, onOutput) {
  if (project.allowCommands === false) throw new Error('Enable development commands in Project settings.');
  const task = input.task;
  const pkg = packageInfo(project);
  let args, command;
  if (task === 'install') { if (!pkg) throw new Error('Write package.json before installing.'); args = npmArgs(['install', '--no-audit', '--no-fund']); command = 'npm install'; }
  else if (task === 'script') {
    const script = input.script;
    if (typeof script !== 'string' || !/^[a-zA-Z0-9:_-]{1,60}$/.test(script) || !Object.hasOwn(pkg?.scripts || {}, script)) throw new Error('Choose an existing package.json script.');
    if (/^(dev|start|serve|preview|watch)$/i.test(script)) throw new Error('Use start_project_preview for a long-running server.');
    args = npmArgs(['run', script]); command = `npm run ${script}`;
  } else if (task === 'node' || task === 'syntax') {
    if (!/\.(?:mjs|cjs|js)$/i.test(input.path || '')) throw new Error('Choose a project JavaScript file.');
    const { target, relative } = projectTarget(project, input.path);
    if (!fs.existsSync(target)) throw new Error('The JavaScript file does not exist.');
    args = [...(task === 'syntax' ? ['--check'] : []), target]; command = `node ${task === 'syntax' ? '--check ' : ''}${relative}`;
  } else throw new Error('Supported tasks: install, script, node, syntax.');
  signal?.throwIfAborted();
  const started = Date.now(), job = spawnProject(project, args, onOutput);
  let timedOut = false;
  const timeoutMs = Math.max(1000, Math.min(Number(input.timeoutMs) || 120_000, 300_000));
  const timer = setTimeout(() => { timedOut = true; void killTree(job.child); }, timeoutMs);
  const abort = () => { void killTree(job.child); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const [exitCode] = await once(job.child, 'close');
    return { command, exitCode, success: exitCode === 0 && !timedOut && !signal?.aborted, timedOut, stopped: Boolean(signal?.aborted), seconds: (Date.now() - started) / 1000, output: job.output().slice(-16_000) };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function previewStatus(project) {
  const item = running.get(project.id);
  return item ? { url: item.url, mode: item.mode, output: item.output?.().slice(-12_000) || '', running: Boolean(item.server?.listening || item.ready && item.child?.exitCode === null && item.child?.signalCode === null) } : { running: false };
}
export async function stopPreview(project) {
  const item = running.get(project.id); running.delete(project.id);
  if (item?.server) { item.server.closeAllConnections(); await new Promise(resolve => item.server.close(resolve)); }
  if (item?.child) await killTree(item.child);
  return { running: false };
}
export async function stopAllPreviews() { for (const id of running.keys()) await stopPreview({ id }); }
export async function requestProjectAPI(project, input, signal) {
  const preview = previewStatus(project);
  if (!preview.running) throw new Error('Start this project preview before testing its API.');
  const relative = String(input.path || '/');
  if (!relative.startsWith('/') || relative.startsWith('//') || /[\\\r\n\0]/.test(relative) || relative.length > 2000) throw new Error('Use an absolute route within the preview, such as /api/items.');
  const url = new URL(relative, preview.url);
  if (url.origin !== new URL(preview.url).origin) throw new Error('Requests must stay on this project preview.');
  const method = String(input.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) throw new Error('Unsupported request method.');
  const data = input.body === undefined || input.body === '' ? undefined : typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
  if (data && data.length > 24_000) throw new Error('Request body must be under 24 KB.');
  const started = Date.now();
  const response = await fetch(url, { method, redirect: 'manual', ...(data && !['GET', 'HEAD'].includes(method) ? { body: data, headers: { 'Content-Type': 'application/json' } } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
  const reader = response.body?.getReader(); let text = '', truncated = false;
  if (reader) { const decoder = new TextDecoder(); while (true) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); if (text.length > 20_000) { text = text.slice(0, 20_000); truncated = true; await reader.cancel(); break; } } }
  return { method, path: relative, status: response.status, success: response.ok, contentType: response.headers.get('content-type'), seconds: (Date.now() - started) / 1000, body: text, truncated };
}
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain' };
async function freePort() { const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
export async function startPreview(project, signal) {
  signal?.throwIfAborted(); await stopPreview(project);
  const root = rootOf(project), pkg = packageInfo(project);
  const script = pkg?.scripts.dev ? 'dev' : pkg?.scripts.start ? 'start' : '';
  if (script) {
    if (project.allowCommands === false) throw new Error('Enable development commands to start this app.');
    const port = await freePort(), command = pkg.scripts[script];
    let extra = [];
    if (/\bvite\b/.test(command)) extra = ['--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
    else if (/\bnext\b/.test(command)) extra = ['--', '--hostname', '127.0.0.1', '--port', String(port)];
    const job = spawnProject(project, npmArgs(['run', script, ...extra]), () => {}, { HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', PORT: String(port), BROWSER: 'none' });
    const item = { ...job, ready: false, mode: 'app', url: `http://127.0.0.1:${port}` }; running.set(project.id, item);
    try {
      for (let i = 0; i < 150; i++) {
        signal?.throwIfAborted();
        if (job.child.exitCode !== null || job.child.signalCode !== null) throw new Error('The app server stopped: ' + job.output().slice(-4000));
        try { const response = await fetch(item.url, { signal: AbortSignal.timeout(800) }); await response.body?.cancel(); if (response.ok) { item.ready = true; return { ...previewStatus(project), command: `npm run ${script}` }; } } catch {}
        await delay(200);
      }
      throw new Error('No successful page response on the assigned port. Your dev/start script must use process.env.PORT and bind to 127.0.0.1. ' + job.output().slice(-4000));
    } catch (error) { await stopPreview(project); throw error; }
  }
  const base = fs.existsSync(path.join(root, 'index.html')) ? root : fs.existsSync(path.join(root, 'dist', 'index.html')) ? fs.realpathSync.native(path.join(root, 'dist')) : '';
  if (!base || !path.relative(root, base).split(path.sep).every(p => p !== '..')) throw new Error('Create index.html or a dev/start script first.');
  const server = http.createServer((req, res) => {
    try {
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) throw new Error('Invalid host');
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      let name = decodeURIComponent(new URL(req.url, 'http://local').pathname).replace(/^\/+/, '') || 'index.html';
      const parts = name.split(/[\\/]/);
      if (parts.some(p => p === '..' || p.startsWith('.') || ['node_modules', 'data', 'logs', 'backups'].includes(p.toLowerCase())) || /[:\0]/.test(name)) throw new Error('Invalid path');
      let file = path.join(base, ...parts);
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      file = fs.realpathSync.native(file);
      const rel = path.relative(base, file);
      if (rel.startsWith('..') || path.isAbsolute(rel) || !MIME[path.extname(file).toLowerCase()] || !fs.statSync(file).isFile()) throw new Error('Invalid file');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    } catch { res.writeHead(404); res.end('Project file not found.'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  running.set(project.id, { server, mode: 'static', url: `http://127.0.0.1:${server.address().port}` });
  return previewStatus(project);
}
