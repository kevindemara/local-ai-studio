import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('a build retries malformed calls, detects broken connections, and previews the model repair', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const run = fs.mkdtempSync(path.join(import.meta.dirname, 'artifacts', 'build-loop-'));
  const folder = path.join(run, 'project'); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'README.md'), 'Existing project context: make all files connect.');
  let round = 0, sawRepair = false;
  const call = (name, args) => ({ function: { name, arguments: args } });
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/api/ps') return res.end('{"models":[]}');
    if (req.url === '/api/tags') return res.end('{"models":[{"name":"gpt-oss-20b-local"}]}');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    assert.ok(input.messages[0].content.includes('Existing project context'));
    let message;
    if (round === 0) message = { tool_calls: [call('update_plan', { steps: [{ title: 'Build and connect', status: 'in_progress' }] }), call('write_project_file', { path: 'index.html', content: '<script src="missing.js"></script><h1>App</h1>' })] };
    else if (round === 1) { round++; return res.end(JSON.stringify({ error: 'error parsing tool call: invalid JSON arguments' }) + '\n'); }
    else if (round === 2) {
      assert.ok(input.messages.some(m => m.content?.includes('malformed JSON')));
      message = { content: 'Finished the website.' };
    }
    else if (round === 3) {
      sawRepair = input.messages.some(m => m.content?.includes('Missing local reference'));
      assert.ok(sawRepair);
      message = { tool_calls: [call('edit_project_file', { path: 'index.html', find: 'missing.js', replace: 'app.js' }), call('write_project_file', { path: 'app.js', content: 'document.title = "Connected app";' }), call('update_plan', { steps: [{ title: 'Build and connect', status: 'complete' }] })] };
    } else message = { content: 'Saved and connected the repaired app.' };
    round++;
    res.end(JSON.stringify({ message }) + '\n' + JSON.stringify({ done: true, done_reason: 'stop' }) + '\n');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const socket = http.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(r => socket.close(r));
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { windowsHide: true, env: { ...process.env, LOCAL_AI_PORT: String(port), LOCAL_AI_OLLAMA_PORT: String(mock.address().port), LOCAL_AI_DATA_DIR: path.join(run, 'data') }, stdio: 'ignore' });
  let token, project;
  const api = async (route, data) => { const r = await fetch(`http://127.0.0.1:${port}/api` + route, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Local-Token': token }, body: data ? JSON.stringify(data) : undefined }); assert.ok(r.ok, await (r.ok ? Promise.resolve('') : r.text())); return r; };
  try {
    for (let i = 0; i < 100; i++) { try { token = (await (await api('/bootstrap')).json()).token; break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    project = await (await api('/projects', { name: 'Repair fixture', folder })).json();
    const chat = await (await api('/chats', { projectId: project.id })).json();
    const events = (await (await api('/chat', { chatId: chat.id, content: 'Build a website and connect all files.' })).text()).trim().split('\n').map(JSON.parse);
    const assistant = events.findLast(e => e.type === 'done').chat.messages.at(-1);
    assert.equal(assistant.status, 'complete'); assert.equal(round, 5); assert.ok(sawRepair);
    assert.equal(assistant.plan[0].status, 'complete');
    assert.ok(assistant.activity.some(a => a.tool === 'verify_project' && a.result.success === false));
    assert.ok(assistant.activity.some(a => a.tool === 'verify_project' && a.result.success === true));
    const preview = assistant.activity.find(a => a.tool === 'start_project_preview').result;
    assert.equal((await fetch(preview.url + '/app.js')).status, 200);
    const changes = await (await api(`/projects/${project.id}/changes`)).json(); assert.equal(changes.length, 3);
    const review = await (await api(`/projects/${project.id}/review?id=${changes.find(c => c.action === 'updated').id}`)).json(); assert.ok(review.before.includes('missing.js')); assert.ok(review.after.includes('app.js'));
  } finally {
    if (project) await api(`/projects/${project.id}/preview-stop`, {});
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    await new Promise(r => mock.close(r));
  }
});
