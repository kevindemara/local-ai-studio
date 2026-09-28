import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectTarget, writeProjectFile } from './project-files.mjs';
import { hash, recordChange } from './project-workbench.mjs';

export const isImage = name => /\.(png|jpe?g|webp)$/i.test(name);
export function fileOperation(project, input, backupRoot, changes, runId = '') {
  const from = projectTarget(project, input.path);
  if (!fs.existsSync(from.target)) throw new Error('The source file does not exist.');
  const bytes = fs.readFileSync(from.target);
  if (input.action === 'rename') {
    const to = projectTarget(project, input.to, true);
    if (fs.existsSync(to.target) || from.relative.toLowerCase() === to.relative.toLowerCase()) throw new Error('Choose a new filename that does not already exist.');
    fs.renameSync(from.target, to.target);
    const change = { id: randomUUID(), projectId: project.id, runId, operation: 'rename', path: to.relative, oldPath: from.relative, action: 'renamed', hash: hash(bytes), bytes: bytes.length, createdAt: new Date().toISOString() };
    changes.push(change); return { ...change, changeId: change.id };
  }
  if (input.action !== 'trash') throw new Error('Choose rename or trash.');
  fs.mkdirSync(backupRoot, { recursive: true });
  const backup = path.join(backupRoot, randomUUID() + '-' + path.basename(from.target));
  fs.copyFileSync(from.target, backup, fs.constants.COPYFILE_EXCL); fs.unlinkSync(from.target);
  const change = { id: randomUUID(), projectId: project.id, runId, operation: 'trash', path: from.relative, action: 'trashed', backup, hash: null, bytes: bytes.length, createdAt: new Date().toISOString() };
  changes.push(change); return { ...change, changeId: change.id };
}
export function undoFileOperation(project, change, backupRoot) {
  const to = projectTarget(project, change.path);
  if (change.undoneAt) throw new Error('This change was already undone.');
  if (change.operation === 'trash') {
    if (fs.existsSync(to.target)) throw new Error('A file now exists at this path. Restore to a different path or move it first.');
    writeProjectFile(project, change.path, fs.readFileSync(change.backup), backupRoot, true);
  } else if (change.operation === 'rename') {
    const from = projectTarget(project, change.oldPath, true);
    if (fs.existsSync(from.target) || !fs.existsSync(to.target) || hash(fs.readFileSync(to.target)) !== change.hash) throw new Error('The renamed file changed or its original path is occupied.');
    fs.renameSync(to.target, from.target);
  } else throw new Error('Not a file operation.');
  change.undoneAt = new Date().toISOString(); return { path: change.oldPath || change.path, action: 'restored' };
}
export function createCheckpoint(project, label, root, files, runId = '') {
  const checkpoint = { id: randomUUID(), projectId: project.id, runId, label: String(label || 'Project checkpoint').slice(0, 100), createdAt: new Date().toISOString(), files: [], bytes: 0 };
  const pending = [];
  for (const file of files) {
    let target; try { target = projectTarget(project, file.path).target; } catch { continue; }
    const bytes = fs.readFileSync(target); checkpoint.bytes += bytes.length;
    if (checkpoint.bytes > 128 * 1024 * 1024) throw new Error('Checkpoint exceeds 128 MB. Use a smaller project folder.');
    pending.push({ relative: file.path, bytes });
  }
  const folder = path.join(root, checkpoint.id); fs.mkdirSync(folder, { recursive: true });
  for (const [i, file] of pending.entries()) {
    const stored = path.join(folder, String(i)); fs.writeFileSync(stored, file.bytes);
    checkpoint.files.push({ path: file.relative, hash: hash(file.bytes), stored, bytes: file.bytes.length });
  }
  return checkpoint;
}
// Journal-derived expectations protect edits made outside the app. Validate every path
// before restoring any file so a conflict cannot leave a partially restored checkpoint.
export function restoreCheckpoint(project, checkpoint, changes, backupRoot) {
  if (checkpoint.projectId !== project.id) throw new Error('Checkpoint belongs to another project.');
  const baseline = new Map(checkpoint.files.map(f => [f.path, f]));
  const expected = new Map(checkpoint.files.map(f => [f.path, f.hash]));
  for (const change of changes.slice(checkpoint.changeIndex ?? 0).filter(c => c.projectId === project.id && (checkpoint.changeIndex !== undefined || c.createdAt >= checkpoint.createdAt))) {
    if (change.operation === 'rename') {
      expected.set(change.oldPath, change.undoneAt ? change.hash : null);
      expected.set(change.path, change.undoneAt ? null : change.hash);
    } else if (change.operation === 'trash') expected.set(change.path, change.undoneAt ? hash(fs.readFileSync(change.backup)) : null);
    else expected.set(change.path, change.undoneAt ? change.backup ? hash(fs.readFileSync(change.backup)) : null : change.hash);
  }
  const targets = [];
  for (const [relative, digest] of expected) {
    const { target } = projectTarget(project, relative);
    const current = fs.existsSync(target) ? hash(fs.readFileSync(target)) : null;
    if (current !== digest) throw new Error(`Checkpoint conflict: ${relative} was changed outside the recorded edits. Nothing was restored.`);
    const original = baseline.get(relative);
    if (original && (!fs.existsSync(original.stored) || hash(fs.readFileSync(original.stored)) !== original.hash)) throw new Error('Checkpoint backup is missing or damaged.');
    targets.push({ relative, target, original });
  }
  const restored = [];
  for (const item of targets) {
    if (item.original) {
      const bytes = fs.readFileSync(item.original.stored);
      const result = recordChange(changes, project, writeProjectFile(project, item.relative, isImage(item.relative) ? bytes : bytes.toString('utf8'), backupRoot, isImage(item.relative)));
      restored.push(result);
    } else if (fs.existsSync(item.target)) restored.push(fileOperation(project, { action: 'trash', path: item.relative }, backupRoot, changes));
  }
  checkpoint.restoredAt = new Date().toISOString(); return { restored, files: targets.length };
}
