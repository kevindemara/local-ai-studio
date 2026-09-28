import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
const output=path.join(root,'dist',`local-ai-studio-${version}.zip`);
// Only Git-tracked release source is packaged. User data, logs, models and dependencies are excluded.
execFileSync('git',['archive','--format=zip',`--prefix=local-ai-studio-${version}/`,'-o',output,'HEAD'],{cwd:root,windowsHide:true});
console.log(output);
