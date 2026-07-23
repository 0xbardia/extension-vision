import fs from 'node:fs';
import path from 'node:path';
const d = 'dist';
if (!fs.existsSync(d)) throw Error('dist missing');
const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json')));
if (m.manifest_version !== 3) throw Error('not MV3');
for (const f of [
  m.background.service_worker,
  m.side_panel.default_path,
  'icons/icon-16.svg',
  'icons/icon-32.svg',
  'icons/icon-48.svg',
  'icons/icon-128.svg',
])
  if (!fs.existsSync(path.join(d, f))) throw Error(`missing ${f}`);
const files = [];
function walk(x) {
  for (const f of fs.readdirSync(x)) {
    const p = path.join(x, f);
    fs.statSync(p).isDirectory() ? walk(p) : files.push(p);
  }
}
walk(d);
const text = files
  .filter((f) => /\.(js|html|css|json)$/.test(f))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
for (const bad of [
  /(?:^|[\\/"'])\.env(?:$|[\\/"'])/i,
  /localhost/i,
  /node_modules/i,
  /sk-[A-Za-z0-9]{20,}/,
])
  if (bad.test(text)) throw Error(`forbidden output pattern ${bad}`);
if (/<script[^>]+src=["']https?:/i.test(text)) throw Error('remote script');
console.log(`dist verified: ${files.length} files`);
