import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browseFolders } from '../folder-browser.mjs';

test('folder browser navigates real directories without exposing file contents', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-folders-'));
  try {
    await fs.mkdir(path.join(home, 'Project & demo'));
    await fs.mkdir(path.join(home, 'Empty'));
    await fs.writeFile(path.join(home, '.env'), 'fake-test-value');
    const listed = await browseFolders('', home);
    assert.equal(listed.folder, await fs.realpath(home));
    assert.deepEqual(listed.folders.map(item => item.name), ['Empty', 'Project & demo']);
    assert.equal(listed.parent, path.dirname(listed.folder));
    assert.equal(listed.locations[0].path, home);
    const empty = await browseFolders(listed.folders[0].path, home);
    assert.deepEqual(empty.folders, []);
    assert.equal(empty.parent, listed.folder);
    await assert.rejects(browseFolders(path.join(home, '.env'), home), /unavailable/);
    await assert.rejects(browseFolders(path.join(home, 'missing'), home), /unavailable/);
    await assert.rejects(browseFolders('relative/path', home), /absolute/);
    await assert.rejects(browseFolders(123, home), /valid/);
    await assert.rejects(browseFolders('bad\0path', home), /valid/);
    if (process.platform === 'win32') await assert.rejects(browseFolders('\\\\server\\share', home), /absolute local/);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
