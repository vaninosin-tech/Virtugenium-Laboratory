import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const roots = ['docs/night/stage1/', 'docs/night/wave10c1/', 'docs/night/wave11c3/',
  'docs/night/wave12c5/', 'docs/night/wave12c6/', 'docs/night/wave13c7/',
  'docs/night/wave7reagents/'];
const paths = execFileSync('git', ['diff', '--name-only', '--', 'docs/night'], { encoding: 'utf8' })
  .trim().split(/\r?\n/).filter(path => roots.some(root => path.startsWith(root)));
for (const path of paths)
  fs.writeFileSync(path, execFileSync('git', ['show', `HEAD:${path}`], { maxBuffer: 10_000_000 }));
console.log(`Restored ${paths.length} tracked diagnostic files from HEAD`);
// This Windows worktree checks these text files out with CRLF. Git cannot
// refresh its index in the sandbox, so match the worktree byte convention too.
const stale = execFileSync('git', ['status', '--short', '--', 'docs/night'], { encoding: 'utf8' })
  .split(/\r?\n/).filter(line => line.startsWith(' M ')).map(line => line.slice(3))
  .filter(path => roots.some(root => path.startsWith(root)));
for (const path of stale) {
  const bytes = fs.readFileSync(path);
  if (bytes.includes(0)) continue;
  const value = bytes.toString('utf8').replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(path, value);
}
console.log(`Matched CRLF checkout for ${stale.length} text files`);
