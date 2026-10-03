import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { audioOptions, audioOutput } from '../audio-engine.mjs';
import { writeProjectFile } from '../project-files.mjs';

test('audio choices enforce model modes, bounded duration and seed', () => {
  assert.equal(audioOptions({ mode: 'effect', prompt: 'a sword hit', duration: 1 }).mode, 'effect');
  assert.equal(audioOptions({ mode: 'music', prompt: 'menu theme', duration: 30 }).duration, 30);
  assert.throws(() => audioOptions({ mode: 'effect', prompt: 'hit', duration: 31 }), /1–30/);
  assert.throws(() => audioOptions({ mode: 'music', prompt: 'theme', duration: 9 }), /10–180/);
  assert.throws(() => audioOptions({ mode: 'voice', prompt: 'hello', seed: -2 }), /Seed/);
  assert.throws(() => audioOptions({ mode: 'voice', prompt: 'hello', language: 'unknown' }), /language/);
  assert.throws(() => audioOutput('../outside'), /audio ID/);
});

test('a chat cannot write fake WAV text while generated binary audio can be saved', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-audio-'));
  try {
    const project = { folder };
    assert.throws(() => writeProjectFile(project, 'assets/fx.wav', 'fake audio', folder), /binary/);
    const bytes = Buffer.from('RIFF1234WAVE');
    const saved = writeProjectFile(project, 'assets/fx.wav', bytes, folder, true);
    assert.equal(saved.path, 'assets/fx.wav');
    assert.deepEqual(fs.readFileSync(path.join(folder, 'assets', 'fx.wav')), bytes);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
