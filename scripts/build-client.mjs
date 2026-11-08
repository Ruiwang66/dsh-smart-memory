import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'src', 'client', 'index.js');
const targetDir = path.join(root, 'lib', 'client');
const target = path.join(targetDir, 'index.js');

fs.mkdirSync(targetDir, { recursive: true });
let code = fs.readFileSync(source, 'utf8');
if (!code.includes('window.__ModuleLoader__.load')) {
  throw new Error('client bundle must self-register through window.__ModuleLoader__.load');
}
if (!code.includes('id: "dsh-smart-memory"')) {
  throw new Error('client bundle id must equal the package name');
}
fs.writeFileSync(target, code, 'utf8');
console.log(`client bundle: ${path.relative(root, target)} (${code.length} bytes)`);
