import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const extensions = new Set(['.html', '.css', '.scss', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.txt', '.svg', '.yaml', '.yml', '.toml', '.xml', '.sql', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.php', '.vue', '.svelte', '.gitignore', '.png', '.webp', '.jpg', '.jpeg', '.wav']);
const forbidden = new Set(['.git', '.codex', '.ssh', 'node_modules', '.venv', 'venv', 'data', 'logs', 'models', 'runtime', 'downloads', 'backups']);
function fail(message, code = 400) { const error = new Error(message); error.code = code; throw error; }
function inside(root, target) { const relative = path.relative(root, target); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
export function projectTarget(project, input, createParents = false) {
  if (!project.folder) fail('Link a project folder first.');
  if (typeof input !== 'string' || !input || input.length > 240 || path.isAbsolute(input) || /[:\0]/.test(input)) fail('Use a relative path inside this project.');
  const parts = input.split(/[\\/]/);
  if (parts.some(p => !p || p === '.' || p === '..' || /[<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || forbidden.has(p.toLowerCase()) || /^\.env(?:\.|$)/i.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) fail('This project path is not allowed.');
  const filename = parts.at(-1);
  if (!extensions.has(path.extname(filename).toLowerCase()) && filename !== '.gitignore') fail('Use a supported source or image file extension.');
  const root = fs.realpathSync.native(project.folder);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    if (!inside(root, current)) fail('File must stay inside its project folder.');
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true; } catch { return false; } })()) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !inside(root, fs.realpathSync.native(current))) fail('Links are not allowed for project writes.');
      if (i < parts.length - 1 && !stat.isDirectory()) fail('A parent path is not a folder.');
      if (i === parts.length - 1 && (!stat.isFile() || stat.nlink > 1)) fail('Target must be a regular file without links.');
    } else if (i < parts.length - 1) {
      if (createParents) fs.mkdirSync(current);
      else break;
    }
  }
  return { target: path.join(root, ...parts), relative: parts.join('/') };
}
export function writeProjectFile(project, input, content, backupRoot, binary = false) {
  if (!binary && (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > 200_000)) fail('Source files must contain text under 200 KB.');
  if (!binary && /\.(png|webp|jpe?g|wav)$/i.test(input)) fail('Use asset generation to create binary files.');
  const { target, relative } = projectTarget(project, input, true);
  let backup = '';
  if (fs.existsSync(target)) {
    if (fs.readFileSync(target).equals(Buffer.from(content))) return { path: relative, action: 'unchanged', bytes: Buffer.byteLength(content) };
    fs.mkdirSync(backupRoot, { recursive: true });
    backup = path.join(backupRoot, randomUUID() + '-' + path.basename(target));
    fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  }
  const temporary = target + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, content, { flag: 'wx' }); fs.renameSync(temporary, target); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { path: relative, action: backup ? 'updated' : 'created', bytes: Buffer.byteLength(content), ...(backup ? { backup } : {}) };
}
