import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, randomInt } from 'node:crypto';
const ROOT = process.env.LOCAL_AI_IMAGE_ROOT || path.resolve(import.meta.dirname, '..', 'image-gen');
const executable = path.join(ROOT, 'runtime', process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli');
const diffusion = path.join(ROOT, 'models', 'z-image-Q8_0.gguf');
const encoder = path.join(ROOT, 'models', 'Qwen3-4B-Instruct-2507-Q8_0.gguf');
const vae = path.join(ROOT, 'models', 'ae.safetensors');
export function imageStatus() { return { ready: [executable, diffusion, encoder, vae].every(f => fs.existsSync(f)), model: 'Z-Image 6B Base · Q8', license: 'Apache 2.0' }; }
export function imageOptions(input) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt || prompt.length > 4000) throw new Error('Describe the image in 1–4,000 characters.');
  const width = Number(input.width || 1024), height = Number(input.height || 1024), steps = Number(input.steps || 32);
  if (![512, 768, 1024, 1280, 1536].includes(width) || ![512, 768, 1024, 1280, 1536].includes(height) || width * height > 1_572_864) throw new Error('Choose dimensions up to 1.5 megapixels.');
  if (![16, 32, 50].includes(steps)) throw new Error('Choose 16, 32, or 50 image steps.');
  const seed = input.seed === undefined || input.seed === '' || Number(input.seed) === -1 ? randomInt(0, 2 ** 31 - 1) : Number(input.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31) throw new Error('Seed must be -1 (random) or a positive 32-bit integer.');
  const negativePrompt = input.negativePrompt === undefined ? 'text, letters, watermark, logo, captions, blurry, low quality, malformed hands' : String(input.negativePrompt);
  if (negativePrompt.length > 2000) throw new Error('Avoid text must be shorter than 2,000 characters.');
  return { prompt, negativePrompt, width, height, steps, seed };
}
export async function runImage(input, signal, progress = () => {}) {
  if (!imageStatus().ready) throw new Error('The local image model is not installed yet.');
  const settings = imageOptions(input), id = randomUUID();
  const outputFolder = path.join(ROOT, 'outputs'); fs.mkdirSync(outputFolder, { recursive: true });
  const output = path.join(outputFolder, id + '.png');
  const args = ['--diffusion-model', diffusion, '--llm', encoder, '--vae', vae, '-p', settings.prompt, '-n', settings.negativePrompt, '-W', String(settings.width), '-H', String(settings.height), '--steps', String(settings.steps), '--cfg-scale', '4', '--sampling-method', 'euler', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling', '--max-vram', '12', '-s', String(settings.seed), '-o', output];
  const logFile = path.join(ROOT, 'logs', id + '.log');
  const started = Date.now();
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', last = 0;
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const data = bytes => {
      fs.appendFileSync(logFile, bytes); tail = (tail + bytes.toString()).slice(-6000);
      if (Date.now() - last > 1000) { const matches = [...tail.matchAll(/(\d+)\s*\/\s*(\d+)\s*[-|]/g)]; const step = matches.at(-1); progress(step && Number(step[2]) === settings.steps ? `Rendering image · step ${step[1]} of ${step[2]}` : /decode_first_stage|vae decode|decoding/i.test(tail) ? 'Decoding image' : 'Loading image model and preparing prompt'); last = Date.now(); }
    };
    child.stdout.on('data', data); child.stderr.on('data', data);
    child.once('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('Image generation stopped.'));
      if (code !== 0 || !fs.existsSync(output)) return reject(new Error(`Image generation failed (exit ${code}). ${tail.slice(-1500)}`));
      resolve();
    });
  });
  const bytes = fs.readFileSync(output);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('The image engine did not produce a PNG.');
  return { id, output, settings, seconds: (Date.now() - started) / 1000 };
}
export function imageOutput(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid image ID.');
  return path.join(ROOT, 'outputs', id + '.png');
}
