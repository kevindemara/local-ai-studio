import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectTarget } from './project-files.mjs';
import { executable } from './studio-jobs.mjs';
const exec = promisify(execFile);
async function git(project, args) {
  if (!project.folder) throw new Error('Create or link a project folder first.');
  const result = await exec(executable('git'), ['-C', fs.realpathSync.native(project.folder), ...args], { windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }); return result.stdout;
}
async function repository(project) {
  const root = (await git(project, ['rev-parse', '--show-toplevel'])).trim();
  if (fs.realpathSync.native(root).toLowerCase() !== fs.realpathSync.native(project.folder).toLowerCase()) throw new Error('Link the repository root to use Git here.');
}
export async function gitStatus(project) {
  try { await repository(project); } catch (error) { return { repository: false, error: error.message.includes('ENOENT') ? 'Git is not installed.' : error.message }; }
  const status = await git(project, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  const entries = status.split('\0').filter(Boolean), files = [];
  for (let i = 0; i < entries.length; i++) {
    const status = entries[i].slice(0, 2), relative = entries[i].slice(3);
    const original = /[RC]/.test(status) ? entries[++i] : undefined;
    let supported = true; try { projectTarget(project, relative); if (original) projectTarget(project, original); } catch { supported = false; }
    files.push({ path: relative.replaceAll('\\', '/'), status, original, supported });
  }
  const branch = (await git(project, ['branch', '--show-current'])).trim();
  let commits = ''; try { commits = await git(project, ['log', '-5', '--format=%h %s']); } catch {}
  return { repository: true, branch, files: files.slice(0, 300), commits };
}
export async function gitDiff(project, relative) {
  await repository(project); const { relative: file } = projectTarget(project, relative);
  let unstaged = await git(project, ['diff', '--no-ext-diff', '--', file]);
  const staged = await git(project, ['diff', '--cached', '--no-ext-diff', '--', file]);
  if (!unstaged && !staged) {
    try { await git(project, ['ls-files', '--error-unmatch', '--', file]); }
    catch { const target = projectTarget(project,file).target; if (fs.existsSync(target)) unstaged = /\.(png|webp|jpe?g)$/i.test(file) ? 'New image file' : 'New file\n'+fs.readFileSync(target,'utf8').slice(0,50000).split('\n').map(line=>'+'+line).join('\n'); }
  }
  return { path: file, unstaged: unstaged.slice(0, 50_000), staged: staged.slice(0, 50_000) };
}
export async function gitInit(project) {
  // Reject parent repositories, including when this folder has no .git directory.
  try { await git(project, ['rev-parse', '--show-toplevel']); throw new Error('This folder already belongs to a repository.'); }
  catch (error) { if (!String(error.message).includes('not a git repository')) throw error; }
  await git(project, ['init']); return gitStatus(project);
}
export async function gitCommit(project, input) {
  await repository(project);
  if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 100 || !String(input.message || '').trim() || String(input.message).length > 500) throw new Error('Select source files and enter a commit message.');
  const files = [...new Set(input.paths.map(p => projectTarget(project, p).relative))];
  await git(project, ['add', '--', ...files]);
  let author = []; try { await git(project, ['var', 'GIT_AUTHOR_IDENT']); } catch { author = ['-c', 'user.name=Local AI Studio', '-c', 'user.email=local-ai@localhost']; }
  const output = await git(project, [...author, 'commit', '-m', input.message.trim(), '--', ...files]);
  return { output, status: await gitStatus(project) };
}
