import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function browseFolders(input = '', home = os.homedir()) {
  if (typeof input !== 'string' || input.length > 4096 || input.includes('\0')) throw new Error('Enter a valid local folder path.');
  const requested = input.trim() || home;
  if (!path.isAbsolute(requested) || (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(requested) || requested.includes(':', 2)))) throw new Error('Enter an absolute local folder path.');
  let folder;
  try { folder = await fs.realpath(requested); if (!(await fs.stat(folder)).isDirectory()) throw new Error(); }
  catch { throw new Error('This folder is unavailable. Check the path and permissions, or choose another folder.'); }
  const folders = []; let visited = 0, truncated = false;
  try {
    const entries = await fs.opendir(folder);
    for await (const entry of entries) {
      if (++visited > 5000 || folders.length >= 500) { truncated = true; break; }
      // Do not follow filesystem links while listing. A pasted path is resolved explicitly above.
      if (entry.isDirectory()) folders.push({ name: entry.name, path: path.join(folder, entry.name) });
    }
  } catch { throw new Error('This folder cannot be read. Choose another folder or check its permissions.'); }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const locations = [{ name: 'Home', path: home }];
  for (const name of ['Desktop', 'Documents']) {
    const location = path.join(home, name);
    try { if ((await fs.stat(location)).isDirectory()) locations.push({ name, path: location }); } catch {}
  }
  if (process.platform === 'win32') {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const location = `${letter}:\\`;
      try { if ((await fs.stat(location)).isDirectory()) locations.push({ name: location, path: location }); } catch {}
    }
  } else locations.push({ name: 'Filesystem', path: path.parse(folder).root });
  const parent = path.dirname(folder);
  return { folder, parent: parent === folder ? null : parent, folders, locations, truncated };
}
