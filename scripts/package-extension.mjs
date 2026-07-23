import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import { execFileSync } from 'node:child_process';
execFileSync('node', ['scripts/verify-dist.mjs'], { stdio: 'inherit' });
const out = 'ai-vision-sidebar-v0.1.0.zip';
if (fs.existsSync(out)) fs.unlinkSync(out);
const zip = new yazl.ZipFile();
function add(dir, base = '') {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name),
      n = path.join(base, name);
    fs.statSync(p).isDirectory() ? add(p, n) : zip.addFile(p, n);
  }
}
add('dist');
zip.end();
zip.outputStream.pipe(fs.createWriteStream(out)).on('close', () => console.log(out));
