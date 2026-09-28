import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const root = path.resolve(import.meta.dirname, '..');
const run = fs.mkdtempSync(path.join(root, 'test', 'artifacts', 'agent-history-'));
test('tool history preserves real file content and checkpoints only completed work', async () => {
  const first = '/* first file */\n' + 'a'.repeat(27_000), second = '/* second file */\n' + 'b'.repeat(27_000);
  let call = 0; let checkpointed = false;
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({models:[{name:'gpt-oss-20b-local'}]}));
    const input = JSON.parse(raw); assert.equal(req.url, '/api/chat');
    const chunks = [];
    if (call === 0) chunks.push({ message: { tool_calls: [{ function: { name: 'write_project_file', arguments: { path: 'first.js', content: first } } }] } });
    if (call === 1) {
      const previous = input.messages.find(m => m.tool_calls)?.tool_calls[0];
      assert.equal(previous.function.arguments.content, first, 'Previous tool calls must keep the content that was actually written');
      chunks.push({ message: { tool_calls: [{ function: { name: 'write_project_file', arguments: { path: 'second.js', content: second } } }] } });
    }
    if (call === 2) {
      checkpointed = input.messages.some(m => m.role === 'system' && m.content.includes('ALREADY completed') && m.content.includes('first.js') && m.content.includes('second.js'));
      assert.ok(checkpointed); chunks.push({ message: { content: 'Created first.js and second.js.' } });
    }
    chunks.push({ done: true, done_reason: 'stop', eval_count: 10, eval_duration: 1e8, total_duration: 1e8 }); call++;
    res.end(chunks.map(c => JSON.stringify(c)).join('\n') + '\n');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening'); const port = portServer.address().port; await new Promise(r => portServer.close(r));
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { windowsHide: true, env: { ...process.env, LOCAL_AI_PORT: String(port), LOCAL_AI_OLLAMA_PORT: String(mock.address().port), LOCAL_AI_DATA_DIR: path.join(run, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let token;
  async function api(route, data) { const r = await fetch(`http://127.0.0.1:${port}/api` + route, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Local-Token': token }, body: data ? JSON.stringify(data) : undefined }); return r; }
  try {
    for (let i = 0; i < 100; i++) { try { token = (await (await api('/bootstrap')).json()).token; break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    const folder = path.join(run, 'project'); fs.mkdirSync(folder);
    const project = await (await api('/projects', { name: 'History regression', folder })).json();
    const chat = await (await api('/chats', { projectId: project.id, model: 'gpt-oss-20b-local' })).json();
    const stream = await (await api('/chat', { chatId: chat.id, content: 'Create first.js and second.js with your tools.' })).text();
    const done = stream.trim().split('\n').map(s => JSON.parse(s)).findLast(e => e.type === 'done');
    assert.equal(done.chat.messages.at(-1).status, 'complete'); assert.equal(call, 3); assert.ok(checkpointed);
    assert.equal(fs.readFileSync(path.join(folder, 'first.js'), 'utf8'), first); assert.equal(fs.readFileSync(path.join(folder, 'second.js'), 'utf8'), second);
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await new Promise(r => mock.close(r));
  }
});
