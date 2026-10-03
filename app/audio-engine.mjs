import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID, randomInt } from 'node:crypto';

const ROOT = process.env.LOCAL_AI_AUDIO_ROOT || path.join(process.platform === 'win32' ? (process.env.LOCALAPPDATA || os.homedir()) : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')), 'LocalAIStudioAudio');
const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'audio-generate.py');
const ENGINES = {
  effect: { label: 'MOSS SoundEffect v2', python: path.join(ROOT, 'moss-venv', 'Scripts', 'python.exe'), weights: [path.join(ROOT, 'models', 'sfx', 'transformer', 'diffusion_pytorch_model.safetensors'), path.join(ROOT, 'models', 'sfx', 'text_encoder', 'model-00001-of-00002.safetensors')] },
  music: { label: 'ACE-Step 1.5', python: path.join(ROOT, 'ace-step', '.venv', 'Scripts', 'python.exe'), weights: [path.join(ROOT, 'models', 'music', 'acestep-v15-turbo', 'model.safetensors'), path.join(ROOT, 'models', 'music', 'vae', 'diffusion_pytorch_model.safetensors')] },
  voice: { label: 'Qwen3-TTS VoiceDesign 1.7B', python: path.join(ROOT, 'voice-venv', 'Scripts', 'python.exe'), weights: [path.join(ROOT, 'models', 'voice', 'model.safetensors'), path.join(ROOT, 'models', 'voice', 'speech_tokenizer', 'model.safetensors')] },
};
export function audioStatus() {
  return Object.fromEntries(Object.entries(ENGINES).map(([mode, engine]) => [mode, { model: engine.label, ready: fs.existsSync(engine.python) && engine.weights.every(file => fs.existsSync(file)) }]));
}
export function audioOptions(input) {
  const mode = String(input.mode || '');
  if (!ENGINES[mode]) throw new Error('Choose sound effect, music, or voice.');
  const prompt = String(input.prompt || '').trim();
  if (!prompt || prompt.length > (mode === 'voice' ? 1500 : 500)) throw new Error('Enter a shorter description or spoken line.');
  const duration = Number(input.duration || (mode === 'music' ? 30 : 10));
  if (!Number.isFinite(duration) || mode === 'effect' && (duration < 1 || duration > 30) || mode === 'music' && (duration < 10 || duration > 180)) throw new Error('Choose 1–30 seconds for effects or 10–180 seconds for music.');
  const style = String(input.style || 'A clear, expressive speaking voice.').trim();
  if (style.length > 500) throw new Error('Voice style is too long.');
  const lyrics = String(input.lyrics || '').trim();
  if (lyrics.length > 4000) throw new Error('Lyrics are too long.');
  const language = String(input.language || 'English');
  if (!['Auto','English','Chinese','Japanese','Korean','German','French','Russian','Portuguese','Spanish','Italian'].includes(language)) throw new Error('Choose a supported language.');
  const seed = input.seed === undefined || Number(input.seed) === -1 ? randomInt(0, 2 ** 31 - 1) : Number(input.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31) throw new Error('Seed must be -1 or a positive 32-bit integer.');
  const steps = Number(input.steps || 24);
  if (![8,24,100].includes(steps)) throw new Error('Choose draft, standard, or high effect quality.');
  return { mode, prompt, duration, style, lyrics, language, seed, steps };
}
export async function runAudio(input, signal, progress = () => {}) {
  const settings = audioOptions(input), engine = ENGINES[settings.mode];
  if (!audioStatus()[settings.mode].ready) throw new Error(`${engine.label} is not installed yet.`);
  const id = randomUUID(), outputDir = path.join(ROOT, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, id + '.wav');
  const args = [SCRIPT, '--mode', settings.mode, '--models', path.join(ROOT, 'models'), '--prompt', settings.prompt, '--output', output, '--duration', String(settings.duration), '--style', settings.style, '--language', settings.language, '--lyrics', settings.lyrics, '--seed', String(settings.seed), '--steps', String(settings.steps)];
  const logDir = path.join(ROOT, 'logs'); fs.mkdirSync(logDir, { recursive: true });
  const log = path.join(logDir, id + '.log');
  const started = Date.now(); signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const child = spawn(engine.python, args, { cwd: ROOT, env: { ...process.env, TORCHDYNAMO_DISABLE: '1', HF_HUB_OFFLINE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const abort = () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill();
    }; signal?.addEventListener('abort', abort, { once: true });
    const onData = chunk => { fs.appendFileSync(log, chunk); tail = (tail + chunk.toString()).slice(-3000); if (/\d+%|Loading|generation/i.test(tail)) progress(`Creating ${settings.mode} audio`); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.once('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', code => { signal?.removeEventListener('abort', abort); if (signal?.aborted) reject(new Error('Audio generation stopped.')); else if (code !== 0 || !fs.existsSync(output)) reject(new Error(`${engine.label} failed (exit ${code}). ${tail.slice(-1200)}`)); else resolve(); });
  });
  const header = Buffer.alloc(12); const fd = fs.openSync(output, 'r'); try { fs.readSync(fd, header, 0, 12, 0); } finally { fs.closeSync(fd); }
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('The audio engine did not produce a WAV file.');
  return { id, output, settings, seconds: (Date.now() - started) / 1000, model: engine.label };
}
export function audioOutput(id) { if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid audio ID.'); return path.join(ROOT, 'outputs', id + '.wav'); }
