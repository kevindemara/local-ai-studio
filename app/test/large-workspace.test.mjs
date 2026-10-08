import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Build checkpoints a deep project and fits a short request into 4K context', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-large-workspace-'));
  const folder = path.join(root, 'project');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'AGENTS.md'), 'Project conventions.\n' + 'Use clear names and accessible controls.\n'.repeat(100));
  for (let i = 0; i < 120; i++) fs.writeFileSync(path.join(folder, 'src', `feature-${i}.js`), `export const feature${i} = ${i};\n`);
  const deep = path.join(folder, 'notices', ...Array.from({ length: 8 }, (_, i) => `level-${i}`));
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'license.txt'), 'A deeply nested project file.');

  let modelCalls = 0;
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/api/tags') return res.end('{"models":[{"name":"gpt-oss-20b-local"}]}');
    if (req.url === '/api/ps') return res.end('{"models":[]}');
    if (req.url === '/api/version') return res.end('{"version":"test"}');
    if (req.url === '/api/chat') {
      modelCalls++;
      return res.end(JSON.stringify({ message: { content: 'The project is ready.' }, done: true, done_reason: 'stop' }) + '\n');
    }
    res.end('{}');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '..', 'server.mjs')], {
    windowsHide: true, stdio: 'ignore',
    env: { ...process.env, LOCAL_AI_PORT: String(port), LOCAL_AI_OLLAMA_PORT: String(mock.address().port), LOCAL_AI_DATA_DIR: path.join(root, 'data') },
  });
  let token;
  const api = async (route, data) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'X-Local-Token': token, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  try {
    for (let i = 0; i < 100 && !token; i++) {
      try { token = (await api('/bootstrap')).token; } catch { await delay(25); }
    }
    assert.ok(token, 'server started');
    const project = await api('/projects', { name: 'Deep project', folder });
    const chat = await api('/chats', { projectId: project.id, model: 'gpt-oss-20b-local', mode: 'build' });
    const run = await api('/runs', { chatId: chat.id, content: 'Update the app.', mode: 'build' });
    let result;
    for (let i = 0; i < 100; i++) {
      result = await api(`/runs/${run.id}`);
      if (!['queued', 'running'].includes(result.run.status)) break;
      await delay(50);
    }
    assert.equal(result.run.status, 'complete', result.run.error);
    assert.equal(modelCalls, 1);
    const saved = await api('/bootstrap');
    const checkpoint = saved.state.checkpoints.find(item => item.id === result.run.checkpointId);
    assert.equal(checkpoint.files.length, 122);
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
