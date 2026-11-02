import { openSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';

const archive = process.env.DSH_ASAR ?? 'D:/Program/DeepSeek Harness/resources/app.asar';
const fd = openSync(archive, 'r');
try {
  const prefix = Buffer.alloc(16);
  readSync(fd, prefix, 0, 16, 0);
  const bytes = Buffer.alloc(prefix.readUInt32LE(12));
  readSync(fd, bytes, 0, bytes.length, 16);
  const tree = JSON.parse(bytes.toString());
  const base = 8 + prefix.readUInt32LE(4);
  const entries = new Map();
  function walk(files, directory = '') {
    for (const [name, entry] of Object.entries(files)) {
      const path = directory + name;
      if (entry.files) walk(entry.files, path + '/');
      else entries.set(path, entry);
    }
  }
  walk(tree.files);
  for (const name of process.argv.slice(2)) {
    const source = `dsh/node_modules/@deepseek-ai/${name}/lib/${name.startsWith('dsh-client-') ? 'client.js' : 'index.js'}`;
    const entry = entries.get(source);
    if (!entry || entry.unpacked) throw new Error(`Packed entry unavailable: ${source}`);
    const data = Buffer.alloc(entry.size);
    readSync(fd, data, 0, data.length, base + Number(entry.offset));
    const directory = resolve('work/dsh-0.2.1-rc.5');
    const target = resolve(directory, `${name}.js`);
    const child = relative(directory, target);
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Invalid output path');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    console.log(`${name}: ${entry.size} bytes -> ${target}`);
  }
} finally { closeSync(fd); }
