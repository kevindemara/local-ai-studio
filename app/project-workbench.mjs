import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { projectTarget, writeProjectFile } from './project-files.mjs';
import { packageInfo, runProjectTask } from './project-runtime.mjs';
import {qualityGates} from './developer-tools.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function recordChange(changes, project, result) {
  if (result.action === 'unchanged') return result;
  const { target } = projectTarget(project, result.path);
  const change = { id: randomUUID(), projectId: project.id, ...result, hash: hash(fs.readFileSync(target)), createdAt: new Date().toISOString() };
  changes.push(change);
  return { ...result, changeId: change.id };
}
export function reviewChange(project, change) {
  const { target } = projectTarget(project, change.path);
  const current = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
  const before = change.backup && fs.existsSync(change.backup) ? fs.readFileSync(change.backup) : Buffer.alloc(0);
  const binary = /\.(png|webp|jpe?g)$/i.test(change.path);
  return { ...change, binary, before: binary ? '' : before.toString('utf8'), after: binary ? '' : current.toString('utf8'), canUndo: !change.undoneAt && fs.existsSync(target) && hash(current) === change.hash };
}
export function undoChange(project, change, backupRoot) {
  const review = reviewChange(project, change);
  if (!review.canUndo) throw new Error('This file changed since that edit. Review its current contents before undoing.');
  if (change.backup) {
    if (!fs.existsSync(change.backup)) throw new Error('The original backup is missing.');
    writeProjectFile(project, change.path, review.binary ? fs.readFileSync(change.backup) : review.before, backupRoot, review.binary);
  } else {
    const { target } = projectTarget(project, change.path);
    fs.mkdirSync(backupRoot, { recursive: true });
    const undoBackup = path.join(backupRoot, randomUUID() + '-' + path.basename(target));
    fs.copyFileSync(target, undoBackup, fs.constants.COPYFILE_EXCL); fs.unlinkSync(target); change.undoBackup = undoBackup;
  }
  change.undoneAt = new Date().toISOString();
  return { path: change.path, action: change.backup ? 'restored' : 'removed-created-file' };
}
export function patchFile(project, input, backupRoot) {
  const { target } = projectTarget(project, input.path);
  const content = fs.readFileSync(target, 'utf8');
  if (!input.find || typeof input.find !== 'string' || typeof input.replace !== 'string') throw new Error('Supply exact find and replace text.');
  if (content.split(input.find).length !== 2) throw new Error('Find text must match exactly once. Read the current file and use a unique match.');
  return writeProjectFile(project, input.path, content.replace(input.find, () => input.replace), backupRoot);
}
export function searchProject(project, input, list, read) {
  const query = String(input.query || '').trim(); if (!query || query.length > 200) throw new Error('Use a search string under 200 characters.');
  const hits = [], needle = query.toLowerCase();
  for (const file of list(project).files) {
    if (file.kind === 'image') continue;
    if (input.path && !file.path.toLowerCase().includes(String(input.path).toLowerCase())) continue;
    const content = read(project, file.path).content;
    for (const [line, text] of content.split('\n').entries()) if (text.toLowerCase().includes(needle)) {
      hits.push({ path: file.path, line: line + 1, text: text.slice(0, 320) }); if (hits.length >= 40) return { hits, truncated: true };
    }
  }
  return { hits, truncated: false };
}
export function projectContext(project, list, read, request = '') {
  const listing = list(project); let pkg;
  try { pkg = packageInfo(project); } catch (error) { pkg = { error: error.message }; }
  const important = listing.files.filter(f => /(^|\/)(README\.md|package\.json|index\.html|App\.(tsx|jsx|js)|main\.(tsx|jsx|js)|vite\.config\.[cm]?[jt]s|tsconfig\.json)$/i.test(f.path));
  const words = request.toLowerCase().match(/[a-z]{4,}/g) || [];
  const ranked = [...important, ...listing.files.filter(f => f.kind !== 'image' && words.some(w => f.path.toLowerCase().includes(w)))];
  let budget = 10_000; const snippets = [];
  for (const file of [...new Map(ranked.map(f => [f.path, f])).values()].slice(0, 6)) {
    if (budget < 500) break;
    const content = read(project, file.path).content.slice(0, Math.min(3000, budget)); budget -= content.length;
    snippets.push({ path: file.path, content });
  }
  return { files: listing.files.map(f => f.path).slice(0, 150), truncated: listing.truncated || listing.files.length > 150, package: pkg, snippets };
}
export async function verifyProject(project, list, read, signal, output) {
  const files = list(project).files.filter(f => f.kind !== 'image'), issues = [], checks = [];
  const root = fs.realpathSync.native(project.folder);
  for (const file of files) {
    signal?.throwIfAborted();
    const text = read(project, file.path).content;
    if (/\.json$/i.test(file.path)) { try { JSON.parse(text); } catch (error) { issues.push({ path: file.path, message: 'Invalid JSON: ' + error.message }); } }
    const refs = [];
    if (/\.html$/i.test(file.path)) for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) refs.push(match[1]);
    if (/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(file.path)) for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.[^"']+)["']/g)) refs.push(match[1]);
    if (/\.(css|scss)$/i.test(file.path)) for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) refs.push(match[1]);
    for (const ref of refs) {
      if (/^(?:[a-z]+:|\/\/|#|\{|\$)/i.test(ref)) continue;
      const clean = ref.split(/[?#]/)[0]; if (!clean) continue;
      let target; try { target = path.resolve(clean.startsWith('/') ? root : path.dirname(path.join(root, file.path)), '.' + (clean.startsWith('/') ? clean : path.sep + clean)); } catch { continue; }
      const candidates = [target, ...['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '/index.js', '/index.ts', '/index.tsx'].map(ext => target + ext)];
      if (!candidates.some(f => { try { const real = fs.realpathSync.native(f), rel = path.relative(root, real); return !rel.startsWith('..') && !path.isAbsolute(rel) && fs.statSync(real).isFile(); } catch { return false; } })) {
        // Bare routes are handled by routers; explicit file references and imports must exist.
        if (path.extname(clean) || clean.startsWith('.')) issues.push({ path: file.path, message: `Missing local reference: ${ref}` });
      }
    }
  }
  checks.push({ name: 'JSON and local file references', success: !issues.length, checkedFiles: files.length });
  if(project.qualityScripts?.length){
    const gates=await qualityGates(project,signal,output);checks.push(...gates.checks);if(!gates.success)issues.push({message:'Configured quality gates did not pass.',remaining:gates.remaining});
  } else if (project.allowCommands !== false) {
    let pkg; try { pkg = packageInfo(project); } catch { /* Invalid JSON is already reported above, so the model can repair it. */ }
    if (pkg?.scripts.build) {
      const result = await runProjectTask(project, { task: 'script', script: 'build' }, signal, output); checks.push({ name: 'Build', ...result });
      if (!result.success) issues.push({ message: 'Build failed', output: result.output });
    } else for (const file of files.filter(f => /\.(?:mjs|cjs|js)$/i.test(f.path)).slice(0, 30)) {
      const result = await runProjectTask(project, { task: 'syntax', path: file.path }, signal, output); checks.push({ name: file.path, ...result });
      if (!result.success) issues.push({ path: file.path, message: 'JavaScript syntax check failed', output: result.output });
    }
    if (pkg?.scripts.test) {
      const result = await runProjectTask(project, { task: 'script', script: 'test' }, signal, output); checks.push({ name: 'Tests', ...result });
      if (!result.success) issues.push({ message: 'Tests failed', output: result.output });
    }
  } else checks.push({ name: 'Commands', skipped: true, reason: 'Development commands disabled' });
  return { success: !issues.length, checks, issues, note: 'Checks cover JSON, local references and build/syntax. Browser interaction and external services need separate testing.' };
}
