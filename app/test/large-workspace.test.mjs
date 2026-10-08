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

  let modelCalls = 0, longCalls = 0;
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/api/tags') return res.end('{"models":[{"name":"gpt-oss-20b-local"}]}');
    if (req.url === '/api/ps') return res.end('{"models":[]}');
    if (req.url === '/api/version') return res.end('{"version":"test"}');
    if (req.url === '/api/chat') {
      modelCalls++;
      let body = ''; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      const query=request.messages.filter(message=>message.role==='user').at(-1)?.content;
      if(query==='Long task'){
        if(longCalls++<41)return res.end(JSON.stringify({message:{tool_calls:[{function:{name:'read_project_file',arguments:{path:`src/feature-${longCalls}.js`}}}]} })+'\n'+JSON.stringify({done:true,done_reason:'stop'})+'\n');
        return res.end(JSON.stringify({message:{content:'Finished the long inspection.'},done:true,done_reason:'stop'})+'\n');
      }
      if(query==='Stuck task')return res.end(JSON.stringify({message:{tool_calls:[{function:{name:'list_project_files',arguments:{}}}]} })+'\n'+JSON.stringify({done:true,done_reason:'stop'})+'\n');
      if (query==='Inspect files') {
        const listed=request.messages.some(message=>message.role==='tool'&&message.tool_name==='list_project_files'||message.role==='system'&&message.content.includes('Recent tool excerpt')&&message.content.includes('list_project_files'));
        if(listed)return res.end(JSON.stringify({message:{content:'I inspected the bounded project listing.'},done:true,done_reason:'stop'})+'\n');
        return res.end(JSON.stringify({message:{tool_calls:[{function:{name:'list_project_files',arguments:{}}}]} })+'\n'+JSON.stringify({done:true,done_reason:'stop'})+'\n');
      }
      if (request.messages.at(-1)?.content === 'Always limit' || ['Force limit','Partial limit'].includes(request.messages.at(-1)?.content) && request.think !== false) return res.end(JSON.stringify({ message: { thinking: 'Working through the task.', ...(request.messages.at(-1)?.content==='Partial limit'?{content:'I will start by'}:{}) }, done: true, done_reason: 'length', prompt_eval_count: 4000, eval_count: 20 }) + '\n');
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
    const limited = await api('/runs', { chatId: chat.id, content: 'Force limit', mode: 'build' });
    let limitedResult;
    for (let i = 0; i < 100; i++) {
      limitedResult = await api(`/runs/${limited.id}`);
      if (!['queued', 'running'].includes(limitedResult.run.status)) break;
      await delay(50);
    }
    assert.equal(limitedResult.run.status, 'complete');
    assert.equal(limitedResult.chat.messages.at(-1).content, 'The project is ready.');
    const partial = await api('/runs', { chatId: chat.id, content: 'Partial limit', mode: 'build' });
    let partialResult;
    for (let i = 0; i < 100; i++) {
      partialResult = await api(`/runs/${partial.id}`);
      if (!['queued', 'running'].includes(partialResult.run.status)) break;
      await delay(50);
    }
    assert.equal(partialResult.run.status, 'complete');
    assert.equal(partialResult.chat.messages.at(-1).content, 'The project is ready.', 'discard the unfinished reply after automatic continuation');
    const inspection=await api('/runs',{chatId:chat.id,content:'Inspect files',mode:'build'});
    let inspectionResult;
    for(let i=0;i<100;i++){
      inspectionResult=await api(`/runs/${inspection.id}`);
      if(!['queued','running'].includes(inspectionResult.run.status))break;
      await delay(50);
    }
    assert.equal(inspectionResult.run.status,'complete');
    const listing=JSON.parse(inspectionResult.chat.messages.at(-1).toolLog[0].summary);
    assert.equal(listing.files.length,50);
    assert.ok(listing.omitted>0);
    const long=await api('/runs',{chatId:chat.id,content:'Long task',mode:'build'});
    let longResult;
    for(let i=0;i<200;i++){
      longResult=await api(`/runs/${long.id}`);
      if(!['queued','running'].includes(longResult.run.status))break;
      await delay(50);
    }
    assert.equal(longResult.run.status,'complete',longResult.run.error);
    assert.equal(longResult.chat.messages.at(-1).limits.roundsUsed,42);
    const stuck=await api('/runs',{chatId:chat.id,content:'Stuck task',mode:'build'});
    let stuckResult;
    for(let i=0;i<100;i++){
      stuckResult=await api(`/runs/${stuck.id}`);
      if(!['queued','running'].includes(stuckResult.run.status))break;
      await delay(50);
    }
    assert.equal(stuckResult.run.status,'error');
    assert.match(stuckResult.run.error,/repeated list_project_files without making progress/);
    const exhausted = await api('/runs', { chatId: chat.id, content: 'Always limit', mode: 'build' });
    let exhaustedResult;
    for (let i = 0; i < 100; i++) {
      exhaustedResult = await api(`/runs/${exhausted.id}`);
      if (!['queued', 'running'].includes(exhaustedResult.run.status)) break;
      await delay(50);
    }
    assert.equal(exhaustedResult.run.status, 'incomplete');
    assert.match(exhaustedResult.run.error, /context filled/i);
    assert.equal(exhaustedResult.chat.messages.at(-1).status, 'length');
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
