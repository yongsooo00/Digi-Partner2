import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error('No inline JavaScript found in index.html');
for (let i = 0; i < scripts.length; i++) {
  new vm.Script(scripts[i][1], { filename: \`index.inline-\${i + 1}.js\` });
}
console.log(\`OK: \${scripts.length} inline script block(s) in index.html\`);

const workerPath = new URL('../src/index.js', import.meta.url);
const workerCheck = spawnSync(process.execPath, ['--check', workerPath.pathname], { stdio: 'inherit' });
if (workerCheck.status !== 0) process.exit(workerCheck.status ?? 1);
console.log('OK: Cloudflare Worker JavaScript syntax');

for (const file of ['manifest.webmanifest', 'server/package.json']) {
  JSON.parse(await readFile(new URL(file, root), 'utf8'));
  console.log(\`OK: \${file} JSON\`);
}
