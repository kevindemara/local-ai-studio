import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projectTarget, writeProjectFile } from '../project-files.mjs';
import { imageOptions } from '../image-engine.mjs';
const run = fs.mkdtempSync(path.join(import.meta.dirname, 'artifacts', 'file-writes-'));
const folder = path.join(run, 'project'); fs.mkdirSync(folder);
const project = { folder }, backups = path.join(run, 'backups');
test('writes nested source files and preserves the prior contents when replacing', () => {
  const created = writeProjectFile(project, 'src/app.js', 'export const value = 1;', backups);
  assert.equal(created.action, 'created');
  const changed = writeProjectFile(project, 'src/app.js', 'export const value = 2;', backups);
  assert.equal(changed.action, 'updated');
  assert.equal(fs.readFileSync(changed.backup, 'utf8'), 'export const value = 1;');
  assert.equal(fs.readFileSync(path.join(folder, 'src/app.js'), 'utf8'), 'export const value = 2;');
  assert.equal(writeProjectFile(project, 'src/app.js', 'export const value = 2;', backups).action, 'unchanged');
});
test('blocks traversal, Windows alternate streams, reserved names, secrets, and executable files', () => {
  for (const name of ['../outside.html', 'src/../../outside.js', 'C:\\outside.js', 'a.js:payload', '.env', '.env.local', '.git/config', 'runtime/test.js', 'CON.txt', 'nul.html', 'file .', 'file.html.', 'evil.exe', 'script.ps1', 'photo.png']) assert.throws(() => writeProjectFile(project, name, 'content', backups), undefined, name);
  assert.ok(!fs.existsSync(path.join(run, 'outside.html')));
});
test('rejects folder junctions, symbolic links, and hardlinked targets', () => {
  const outside = path.join(run, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(folder, 'escape'), 'junction');
  assert.throws(() => writeProjectFile(project, 'escape/test.html', 'blocked', backups));
  assert.ok(!fs.existsSync(path.join(outside, 'test.html')));
  const original = path.join(outside, 'original.txt'); fs.writeFileSync(original, 'original');
  fs.linkSync(original, path.join(folder, 'linked.txt'));
  assert.throws(() => writeProjectFile(project, 'linked.txt', 'blocked', backups));
  assert.equal(fs.readFileSync(original, 'utf8'), 'original');
});
test('validates image paths before generation and restricts dimensions, seeds, and steps', () => {
  assert.throws(() => projectTarget(project, '../image.png'));
  assert.throws(() => imageOptions({ prompt: 'test', width: 1536, height: 1536 }));
  assert.throws(() => imageOptions({ prompt: 'test', steps: 10000 }));
  assert.throws(() => imageOptions({ prompt: 'test', seed: -2 }));
  const options = imageOptions({ prompt: 'test', width: 1024, height: 768, steps: 32, seed: 42 });
  assert.equal(options.seed, 42); assert.equal(options.width, 1024); assert.ok(options.negativePrompt.includes('watermark'));
});
