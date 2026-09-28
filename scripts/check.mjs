import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');let count=0;
for(const folder of ['app','app/public','scripts'])for(const entry of fs.readdirSync(path.join(root,folder),{withFileTypes:true}))if(entry.isFile()&&/\.(mjs|js)$/.test(entry.name)){execFileSync(process.execPath,['--check',path.join(root,folder,entry.name)],{stdio:'inherit'});count++;}
console.log(`Syntax checked ${count} application and launcher files.`);
