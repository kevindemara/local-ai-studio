import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'test', 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const run = fs.mkdtempSync(path.join(artifacts, 'run-'));
const folder = path.join(run, 'project');
fs.mkdirSync(folder);
fs.writeFileSync(path.join(folder, 'notes.md'), '# Fixture\nThis file belongs to the integration test.\n');
fs.writeFileSync(path.join(folder, '.env'), 'TEST_ONLY=fake-value');
fs.mkdirSync(path.join(folder, 'node_modules'));
fs.writeFileSync(path.join(folder, 'node_modules', 'excluded.json'), '{}');
fs.writeFileSync(path.join(run, 'outside.txt'), 'This file is outside the project boundary.');
fs.writeFileSync(path.join(folder, 'too-big.txt'), 'a'.repeat(100_001));
fs.writeFileSync(path.join(folder, 'context-budget.txt'), 'a'.repeat(29_000));
let port, child, token, projectId, chatId;
async function start() {
  child = spawn(process.execPath, [path.join(root, 'server.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LOCAL_AI_PORT: String(port), LOCAL_AI_DATA_DIR: path.join(run, 'data') } });
  let log = '';
  child.stdout.on('data', data => log += data);
  child.stderr.on('data', data => log += data);
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Test server failed: ' + log);
    try { const r = await fetch(`http://127.0.0.1:${port}/api/bootstrap`); const b = await r.json(); token = b.token; return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not start: ' + log);
}
async function stop() { if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
async function request(route, data, method, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: method || (data === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', 'X-Local-Token': token, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
before(async () => { const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); port = socket.address().port; await new Promise(resolve => socket.close(resolve)); await start(); });
after(stop);

test('inline editor refuses stale saves and guided plans survive project reloads',async()=>{
  const p=(await request('/api/projects',{name:'Guided test'})).data;await request(`/api/projects/${p.id}/scaffold`,{template:'static'});const original=(await request(`/api/projects/${p.id}/file?path=index.html`)).data;
  assert.match(original.revision,/^[a-f\d]{64}$/);assert.equal((await request(`/api/projects/${p.id}/file`,{path:'index.html',content:'new',expectedRevision:original.revision})).status,200);
  assert.equal((await request(`/api/projects/${p.id}/file`,{path:'index.html',content:'stale',expectedRevision:original.revision})).status,409);assert.equal((await request(`/api/projects/${p.id}/file?path=index.html`)).data.content,'new');
  assert.equal((await request(`/api/projects/${p.id}`,{kickoffPrompt:'Build connected pages'},'PATCH')).data.kickoffPrompt,'Build connected pages');assert.equal((await request('/api/studio/kickoff',{name:'Demo',goal:'A useful website'})).status,200);assert.equal((await request('/api/studio/kickoff',{name:'Demo'})).status,500);
});

test('local API rejects foreign origins, host spoofing, and missing session tokens', async () => {
  assert.equal((await request('/api/projects', { name: 'Blocked' }, 'POST', { 'X-Local-Token': '' })).status, 403);
  assert.equal((await request('/api/state', undefined, 'GET', { Origin: 'https://untrusted.example' })).status, 403);
  const spoofed = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: '/api/bootstrap', headers: { Host: `untrusted.example:${port}` } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }).on('error', reject);
  });
  assert.equal(spoofed, 403);
});

test('MCP catalog connect API requires explicit access review before creating a connection', async () => {
  const bootstrap=await request('/api/state'),selected=bootstrap.data.projects[0];
  const before=(await request('/api/studio/extensions')).data;
  const result=await request('/api/studio/extensions/connect',{catalogId:'memory',projectId:selected.id});
  assert.equal(result.status,400);assert.match(result.data.error,/Review/);
  assert.equal((await request('/api/studio/extensions')).data.length,before.length);
  assert.equal((await request('/api/studio/extensions/catalog',undefined,'GET',{'X-Local-Token':''})).status,403);
});
test('projects and chats retain their configuration on disk', async () => {
  let result = await request('/api/projects', { name: 'Integration fixture', folder, instructions: 'Explain this fixture.' });
  assert.equal(result.status, 201); projectId = result.data.id;
  result = await request('/api/chats', { projectId, model: 'gpt-oss-20b-local' });
  assert.equal(result.status, 201); chatId = result.data.id;
  result = await request(`/api/chats/${chatId}`, { title: 'Saved chat', model: 'qwen3.8-27b-local' }, 'PATCH');
  assert.equal(result.data.model, 'qwen3.8-27b-local');
  await stop(); await start();
  const workspace = (await request('/api/state')).data;
  assert.equal(workspace.projects.find(p => p.id === projectId).folder, folder);
  assert.equal(workspace.chats.find(c => c.id === chatId).title, 'Saved chat');
  assert.equal(workspace.chats.find(c => c.id === chatId).model, 'qwen3.8-27b-local');
});
test('file access stays inside the linked project and excludes oversized and secret files', async () => {
  const listing = await request(`/api/projects/${projectId}/files`);
  assert.ok(listing.data.files.some(f => f.path === 'notes.md'));
  assert.ok(!listing.data.files.some(f => f.path === '.env' || f.path.includes('node_modules') || f.path === 'too-big.txt'));
  assert.equal((await request(`/api/projects/${projectId}/file?path=notes.md`)).data.content, '# Fixture\nThis file belongs to the integration test.\n');
  for (const relative of ['../outside.txt', path.join(run, 'outside.txt'), '.env', 'too-big.txt']) assert.equal((await request(`/api/projects/${projectId}/file?path=${encodeURIComponent(relative)}`)).status, 400);
});
test('symlinks cannot escape the selected folder', async t => {
  const outside = path.join(run, 'outside-folder'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 'Fixture text outside the linked folder.');
  try { fs.symlinkSync(outside, path.join(folder, 'escape-link'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { t.skip('System does not permit creating test symlinks.'); return; }
  assert.equal((await request(`/api/projects/${projectId}/file?path=escape-link%2Fsecret.txt`)).status, 400);
});
test('unknown model names are rejected and attachment budgets are enforced before mutation', async () => {
  assert.equal((await request(`/api/chats/${chatId}`, { model: 'unapproved-model' }, 'PATCH')).status, 400);
  assert.equal((await request(`/api/chats/${chatId}`, { attachments: ['context-budget.txt'] }, 'PATCH')).status, 400);
  const attached = await request(`/api/chats/${chatId}`, { attachments: ['notes.md'] }, 'PATCH');
  assert.deepEqual(attached.data.attachments, ['notes.md']);
  assert.equal(attached.data.model, 'qwen3.8-27b-local');
  assert.equal((await request('/api/chat', { chatId, content: 'a'.repeat(16_001) })).status, 400);
  assert.equal((await request('/api/state')).data.chats.find(c => c.id === chatId).messages.length, 0);
});
test('project save API writes source files, keeps backups, and enforces the same boundary', async () => {
  let result = await request(`/api/projects/${projectId}/file`, { path: 'site/styles.css', content: 'body { color: navy; }' });
  assert.equal(result.status, 200); assert.equal(result.data.action, 'created');
  result = await request(`/api/projects/${projectId}/file`, { path: 'site/styles.css', content: 'body { color: blue; }' });
  assert.equal(result.status, 200); assert.equal(result.data.action, 'updated');
  assert.equal(fs.readFileSync(result.data.backup, 'utf8'), 'body { color: navy; }');
  assert.equal((await request(`/api/projects/${projectId}/file`, { path: '../escape.html', content: 'blocked' })).status, 400);
  assert.equal((await request(`/api/projects/${projectId}/file`, { path: '.env', content: 'blocked' })).status, 400);
  result = await request(`/api/projects/${projectId}`, { autoFiles: false }, 'PATCH');
  assert.equal(result.data.autoFiles, false);
});
test('removing app metadata leaves original project files intact', async () => {
  assert.equal((await request(`/api/chats/${chatId}`, undefined, 'DELETE')).status, 200);
  assert.equal((await request(`/api/projects/${projectId}`, undefined, 'DELETE')).status, 200);
  assert.ok(fs.existsSync(path.join(folder, 'notes.md')));
  assert.ok(!(await request('/api/state')).data.projects.some(p => p.id === projectId));
});
test('the served interface has a restrictive policy and no external script dependencies', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  const html = await response.text(); assert.ok(html.includes('Choose model')); assert.ok(!/src="https?:/.test(html));
});
