import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { recordChange, reviewChange, undoChange, patchFile, verifyProject } from '../project-workbench.mjs';
import { writeProjectFile } from '../project-files.mjs';
import { runProjectTask, startPreview, stopPreview, previewStatus } from '../project-runtime.mjs';

const run = fs.mkdtempSync(path.join(import.meta.dirname, 'artifacts', 'workbench-'));
function fixture(name) { const folder = path.join(run, name); fs.mkdirSync(folder); return { id: name, folder }; }
const backups = path.join(run, 'backups');
test('precise edits, review and undo preserve unrelated content and refuse stale undo', () => {
  const project = fixture('edits'), changes = [];
  writeProjectFile(project, 'app.js', 'const a = 1;\nconst b = 2;\n', backups);
  const result = recordChange(changes, project, patchFile(project, { path: 'app.js', find: 'a = 1', replace: 'a = 3' }, backups));
  assert.ok(result.changeId);
  const reviewed = reviewChange(project, changes[0]); assert.ok(reviewed.before.includes('a = 1')); assert.ok(reviewed.after.includes('a = 3')); assert.ok(reviewed.canUndo);
  undoChange(project, changes[0], backups); assert.equal(fs.readFileSync(path.join(project.folder, 'app.js'), 'utf8'), 'const a = 1;\nconst b = 2;\n');
  recordChange(changes, project, writeProjectFile(project, 'new.html', '<h1>new</h1>', backups));
  fs.appendFileSync(path.join(project.folder, 'new.html'), '\nManual edit');
  assert.throws(() => undoChange(project, changes[1], backups), /changed since/);
  assert.throws(() => patchFile(project, { path: 'app.js', find: 'missing', replace: '' }, backups), /exactly once/);
});
test('connected file checks find missing assets, broken JSON and JS, then pass repairs', async () => {
  const project = fixture('checks');
  fs.writeFileSync(path.join(project.folder, 'index.html'), '<script src="app.js"></script><img src="assets/missing.png">');
  fs.writeFileSync(path.join(project.folder, 'app.js'), 'const x = ;');
  fs.writeFileSync(path.join(project.folder, 'config.json'), '{broken');
  const list = p => ({ files: ['index.html', 'app.js', 'config.json'].map(f => ({ path: f })) });
  const read = (p, f) => ({ content: fs.readFileSync(path.join(p.folder, f), 'utf8') });
  let result = await verifyProject(project, list, read);
  assert.equal(result.success, false); assert.ok(result.issues.some(i => i.message.includes('Missing local reference'))); assert.ok(result.issues.some(i => i.message.includes('Invalid JSON'))); assert.ok(result.issues.some(i => i.message.includes('syntax')));
  fs.writeFileSync(path.join(project.folder, 'index.html'), '<script src="app.js"></script>'); fs.writeFileSync(path.join(project.folder, 'app.js'), 'const x = 1;'); fs.writeFileSync(path.join(project.folder, 'config.json'), '{}');
  result = await verifyProject(project, list, read); assert.equal(result.success, true);
});
test('npm install and script tasks execute in the selected folder and return real failures', async () => {
  const project = fixture('npm');
  fs.writeFileSync(path.join(project.folder, 'package.json'), JSON.stringify({ name: 'local-test', version: '1.0.0', private: true, scripts: { test: 'node test.cjs', fail: 'node fail.cjs' } }));
  fs.writeFileSync(path.join(project.folder, 'test.cjs'), 'require("fs").writeFileSync("task-result.txt", process.cwd()); console.log("CHECK_PASSED");');
  fs.writeFileSync(path.join(project.folder, 'fail.cjs'), 'console.error("REAL_FAILURE");process.exit(7);');
  const install = await runProjectTask(project, { task: 'install' }); assert.equal(install.success, true, install.output);
  const result = await runProjectTask(project, { task: 'script', script: 'test' }); assert.equal(result.exitCode, 0); assert.ok(result.output.includes('CHECK_PASSED')); assert.equal(fs.readFileSync(path.join(project.folder, 'task-result.txt'), 'utf8'), project.folder);
  const failed = await runProjectTask(project, { task: 'script', script: 'fail' }); assert.equal(failed.exitCode, 7); assert.equal(failed.success, false); assert.ok(failed.output.includes('REAL_FAILURE'));
  await assert.rejects(runProjectTask({ ...project, allowCommands: false }, { task: 'install' }), /Enable development/);
  await assert.rejects(runProjectTask(project, { task: 'script', script: 'test & whoami' }), /existing/);
});
test('Stop terminates a running project command', async () => {
  const project = fixture('stop'); fs.writeFileSync(path.join(project.folder, 'wait.js'), 'setInterval(() => {}, 100);');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 300);
  const result = await runProjectTask(project, { task: 'node', path: 'wait.js' }, controller.signal); clearTimeout(timer);
  assert.equal(result.stopped, true); assert.equal(result.success, false); assert.ok(result.seconds < 10);
});
test('static preview serves connected assets on a separate origin and denies secrets and escaped links', async () => {
  const project = fixture('preview'); fs.writeFileSync(path.join(project.folder, 'index.html'), '<h1>PREVIEW</h1><script src="app.js"></script>'); fs.writeFileSync(path.join(project.folder, 'app.js'), 'console.log("asset")'); fs.writeFileSync(path.join(project.folder, '.env'), 'HIDDEN');
  const preview = await startPreview(project);
  try { assert.ok(preview.running); assert.match(preview.url, /^http:\/\/127\.0\.0\.1:\d+$/); assert.ok((await (await fetch(preview.url)).text()).includes('PREVIEW')); assert.equal((await fetch(preview.url + '/app.js')).status, 200); assert.equal((await fetch(preview.url + '/.env')).status, 404); assert.equal((await fetch(preview.url + '/api/bootstrap')).status, 404);
    const outside = path.join(run, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'private.html'), 'PRIVATE'); fs.symlinkSync(outside, path.join(project.folder, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); assert.equal((await fetch(preview.url + '/escape/private.html')).status, 404);
  } finally { await stopPreview(project); }
  await assert.rejects(fetch(preview.url));
});
test('app preview starts a backend using HOST and PORT, serves its API and stops its process tree', async () => {
  const project = fixture('app-preview');
  fs.writeFileSync(path.join(project.folder, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.mjs' } }));
  fs.writeFileSync(path.join(project.folder, 'server.mjs'), "import http from 'node:http'; setTimeout(() => http.createServer((req,res)=>{res.end(req.url === '/api/test' ? 'API_OK' : '<h1>APP</h1>')}).listen(Number(process.env.PORT), process.env.HOST), 500);");
  const starting = startPreview(project);
  for (let i = 0; i < 100 && !previewStatus(project).url; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(previewStatus(project).running, false, 'Do not expose a running preview before its server responds');
  const preview = await starting;
  try { assert.equal(preview.mode, 'app'); assert.equal(await (await fetch(preview.url + '/api/test')).text(), 'API_OK'); } finally { await stopPreview(project); }
  await assert.rejects(fetch(preview.url));
});
