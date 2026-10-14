#!/usr/bin/env node
/**
 * Runs independent Codex CLI workers in separate Git worktrees (Node 20+, no dependencies).
 * Run from the (clean) repository or worktree that holds tools/codex-team and the committed contract.
 * Never merges, cherry-picks, pushes or touches the main branch. After a worker exits, the runner (outside
 * the Codex sandbox) snapshots the worker's changes as a commit on that worker's own branch, writes a patch,
 * checks file ownership and runs typecheck + tests, then writes MORNING_REPORT.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const usage = `Usage: node tools/codex-team/run.mjs [--plan | --run]\n\n--plan  Validate configuration; report intended worktrees without changes (default)\n--run   Create worktrees and launch Codex workers concurrently\n`;
const mode = process.argv[2] || '--plan';
if (mode === '--help' || mode === '-h') { process.stdout.write(usage); process.exit(0); }
if (!['--plan', '--run'].includes(mode)) { process.stderr.write(usage); process.exit(2); }

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout || result.error}`);
  }
  return result.stdout.trim();
}
function safeId(input) {
  if (!/^[a-z][a-z0-9-]*$/.test(input)) throw new Error(`Invalid worker id: ${input}`);
  return input;
}
const inside = (root, p) => { const r = path.relative(root, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };

let repoRoot;
try { repoRoot = path.resolve(git(['rev-parse', '--show-toplevel'])); }
catch (e) { console.error(e.message); process.exit(1); }
const packDir = path.join(repoRoot, 'tools', 'codex-team');
const config = JSON.parse(fs.readFileSync(path.join(packDir, 'tasks.json'), 'utf8'));
const jobs = config.jobs;
if (!Array.isArray(jobs) || !jobs.length) throw new Error('No jobs in tasks.json');
const maxHours = Number(config.maxHours) || 9;
const nodeModulesFrom = config.nodeModulesFrom ? path.resolve(config.nodeModulesFrom) : null;
for (const job of jobs) {
  safeId(job.id);
  const p = path.resolve(repoRoot, job.prompt);
  if (!inside(repoRoot, p)) throw new Error(`Prompt escapes repository: ${job.prompt}`);
  if (!fs.existsSync(p)) throw new Error(`Missing prompt: ${p}`);
  if (!Array.isArray(job.owns) || !job.owns.length) throw new Error(`Job ${job.id} needs an "owns" list`);
}
try { git(['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot }); }
catch { throw new Error('Commit the initial project state before launching worktrees.'); }
const modified = git(['status', '--porcelain', '--untracked-files=no'], { cwd: repoRoot });
if (modified) {
  console.error('Tracked changes detected in this worktree. Commit them first:');
  console.error(modified);
  process.exit(1);
}
const contract = path.join(repoRoot, 'docs', 'AGCL_INTERFACES.md');
if (!fs.existsSync(contract)) { console.error('Missing docs/AGCL_INTERFACES.md.'); process.exit(1); }
if (fs.readFileSync(contract, 'utf8').includes('[COORDINATOR TO FILL]')) {
  console.error('Shared contract still contains coordinator placeholders.');
  process.exit(1);
}
try { git(['cat-file', '-e', 'HEAD:docs/AGCL_INTERFACES.md'], { cwd: repoRoot }); }
catch { throw new Error('docs/AGCL_INTERFACES.md must be COMMITTED before running agents.'); }
if (nodeModulesFrom && !fs.existsSync(nodeModulesFrom)) throw new Error(`nodeModulesFrom not found: ${nodeModulesFrom}`);

const baseSha = git(['rev-parse', 'HEAD'], { cwd: repoRoot });
const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const runId = `${timestamp}-${process.pid}`;
const treesBase = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-codex-worktrees`, runId);
const reportsBase = path.join(repoRoot, '.codex-agent-runs', runId);
const tasks = jobs.map(job => ({
  ...job,
  branch: `agent/${job.id}-${runId}`,
  tree: path.join(treesBase, job.id),
  promptBody: fs.readFileSync(path.resolve(repoRoot, job.prompt), 'utf8')
}));
console.log(`Repo: ${repoRoot}\nBase: ${baseSha}\nWorkers: ${tasks.length}\nWorktree base: ${treesBase}\nReports: ${reportsBase}`);
for (const task of tasks) console.log(`- ${task.id}: ${task.branch} -> ${task.tree}`);
if (mode === '--plan') { console.log('\nPlan only. Use --run to launch.'); process.exit(0); }

const cli = process.env.CODEX_BIN || (process.platform === 'win32' ? 'codex.cmd' : 'codex');
const check = spawnSync(cli, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (check.status !== 0) {
  console.error(`Could not run ${cli} --version. Check that Codex CLI is installed, authenticated, and available on PATH.`);
  console.error(check.stderr || check.error || '');
  process.exit(1);
}
console.log(`\nCodex: ${(check.stdout || '').trim()}`);
fs.mkdirSync(reportsBase, { recursive: true });
fs.mkdirSync(treesBase, { recursive: true });
for (const task of tasks) {
  git(['worktree', 'add', '-b', task.branch, task.tree, 'HEAD'], { cwd: repoRoot });
  if (nodeModulesFrom) fs.symlinkSync(nodeModulesFrom, path.join(task.tree, 'node_modules'), 'junction');
}
const manifest = {
  repoRoot, runId, baseSha, reportsBase, startedAt: new Date().toISOString(), maxHours,
  tasks: tasks.map(({ id, branch, tree, prompt, owns }) => ({ id, branch, tree, prompt, owns, status: 'running' }))
};
const manifestPath = path.join(reportsBase, 'manifest.json');
const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
saveManifest();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const killTree = pid => { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']); else { try { process.kill(-pid, 'SIGKILL'); } catch {} } };
const deadline = Date.now() + maxHours * 3600 * 1000;

function header(task, attempt) {
  return [
    `You are the ${task.id} worker in an isolated Git worktree (${task.tree}) on branch ${task.branch}.`,
    'First read docs/AGCL_INTERFACES.md, then inspect the current code. This is an unattended overnight run: work autonomously, iterate (write, run tests, fix) until the task is genuinely done or you are blocked, then stop.',
    'You may edit ONLY the paths listed under your worker in the "Module ownership" section of the contract. Anything else you want changed goes into the final report as an integration request.',
    'Do not commit, merge, switch branches, create worktrees, push, or touch files outside this worktree. The runner snapshots your changes automatically.',
    'node_modules is a shared junction: do NOT run npm install/ci/update and do not modify it. Use `npx tsc --noEmit` and `npx vitest run --no-file-parallelism <paths>`.',
    'Do not use --yolo or disable the sandbox. Do not fake videos, tests or results. Report limitations honestly.',
    'At the end, write a report: files modified, tests run with real pass/fail counts, remaining issues, integration blockers.',
    attempt > 1 ? `This is attempt ${attempt}: a previous attempt was interrupted. Inspect the current worktree state (git status, git diff) and continue; do not start over.` : '',
    '', task.promptBody
  ].join('\n');
}

function runCodexOnce(task, attempt) {
  return new Promise(resolve => {
    const args = ['exec', '-C', task.tree, '--sandbox', 'workspace-write', '--color', 'never',
      '--output-last-message', path.join(reportsBase, `${task.id}.result.txt`), '-'];
    const logPath = path.join(reportsBase, `${task.id}.stdout.log`);
    const errPath = path.join(reportsBase, `${task.id}.stderr.log`);
    const stdout = fs.createWriteStream(logPath, { flags: 'a' });
    const stderr = fs.createWriteStream(errPath, { flags: 'a' });
    const proc = spawn(cli, args, { cwd: task.tree, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    proc.stdout.pipe(stdout);
    proc.stderr.pipe(stderr);
    proc.stdin.on('error', () => {});
    proc.stdin.end(header(task, attempt));
    const rec = manifest.tasks.find(x => x.id === task.id);
    rec.pid = proc.pid; saveManifest();
    const timer = setTimeout(() => { rec.timedOut = true; killTree(proc.pid); }, Math.max(60000, deadline - Date.now()));
    let settled = false;
    const finish = (code, signal, error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      stdout.end(); stderr.end();
      resolve({ code, signal, error, errPath });
    };
    proc.on('error', err => finish(-1, null, err));
    proc.on('close', (code, signal) => finish(code, signal));
  });
}

async function runWorker(task) {
  const rec = manifest.tasks.find(x => x.id === task.id);
  let res;
  for (let attempt = 1; attempt <= 6; attempt++) {
    rec.attempts = attempt; saveManifest();
    res = await runCodexOnce(task, attempt);
    if (res.code === 0 || rec.timedOut) break;
    const err = fs.existsSync(res.errPath) ? fs.readFileSync(res.errPath, 'utf8').slice(-4000) : '';
    if (!/capacity|overloaded|rate.?limit|429|503/i.test(err) || Date.now() > deadline) break;
    console.log(`[${task.id}] transient error, waiting 10 min before attempt ${attempt + 1}`);
    await sleep(10 * 60 * 1000);
  }
  rec.exitCode = res.code; rec.signal = res.signal || null;
  if (res.error) rec.error = String(res.error);
  rec.status = res.code === 0 ? 'finished-needs-review' : (rec.timedOut ? 'timed-out' : 'failed');
  postProcess(task, rec);
  saveManifest();
  console.log(`[${task.id}] ${rec.status}, exit=${res.code}, commit=${rec.commit || 'none'}`);
  return rec;
}

const ownsMatch = (owns, file) => owns.some(o => (o.endsWith('/') ? file.startsWith(o) : file === o));

function postProcess(task, rec) {
  const opts = { cwd: task.tree };
  const ident = ['-c', 'user.name=codex-night', '-c', 'user.email=codex-night@localhost'];
  try {
    git(['add', '-A'], opts);
    const staged = git(['diff', '--cached', '--name-only'], opts);
    if (staged) git([...ident, 'commit', '-q', '-m', `agent/${task.id}: overnight snapshot (unreviewed, exit ${rec.exitCode})`], opts);
    rec.commit = git(['rev-parse', 'HEAD'], opts);
    const files = git(['diff', '--name-only', `${baseSha}..HEAD`], opts).split('\n').filter(Boolean);
    rec.changedFiles = files;
    rec.ownershipViolations = files.filter(f => !ownsMatch(task.owns, f));
    fs.writeFileSync(path.join(reportsBase, `${task.id}.patch`), git(['diff', `${baseSha}..HEAD`], opts) + '\n');
    rec.diffStat = git(['diff', '--stat', `${baseSha}..HEAD`], opts).split('\n').pop();
  } catch (e) { rec.postProcessError = String(e.message || e); }
  const sh = process.platform === 'win32';
  const verify = (name, cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: task.tree, encoding: 'utf8', shell: sh, timeout: 25 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 });
    fs.writeFileSync(path.join(reportsBase, `${task.id}.${name}.log`), `${r.stdout || ''}\n${r.stderr || ''}`);
    return r.status;
  };
  try {
    rec.typecheckExit = verify('typecheck', 'npx', ['tsc', '--noEmit']);
    rec.testsExit = verify('tests', 'npx', ['vitest', 'run', '--no-file-parallelism']);
  } catch (e) { rec.verifyError = String(e.message || e); }
}

function writeReport() {
  const L = [`# Morning report, run ${runId}`, '',
    `Base commit: ${baseSha}`, `Started: ${manifest.startedAt}`, `Finished: ${new Date().toISOString()}`, '',
    'Nothing was merged, cherry-picked or pushed. Review each branch, then integrate sequentially.', ''];
  for (const t of manifest.tasks) {
    L.push(`## ${t.id}`, `- Status: ${t.status}, exit code: ${t.exitCode}, attempts: ${t.attempts}`,
      `- Branch: ${t.branch}`, `- Worktree: ${t.tree}`, `- Snapshot commit: ${t.commit || 'none'}`,
      `- Diff: ${t.diffStat || 'no changes'}`,
      `- tsc exit: ${t.typecheckExit}, vitest exit: ${t.testsExit} (0 = pass; see ${t.id}.typecheck.log / ${t.id}.tests.log)`,
      `- Ownership violations: ${(t.ownershipViolations && t.ownershipViolations.length) ? t.ownershipViolations.join(', ') : 'none'}`,
      `- Changed files: ${(t.changedFiles || []).join(', ') || 'none'}`,
      `- Worker report: ${t.id}.result.txt; logs: ${t.id}.stdout.log / ${t.id}.stderr.log; patch: ${t.id}.patch`, '');
  }
  fs.writeFileSync(path.join(reportsBase, 'MORNING_REPORT.md'), L.join('\n') + '\n');
}

console.log('\nLaunching all Codex workers in parallel...');
const results = await Promise.all(tasks.map(runWorker));
manifest.finishedAt = new Date().toISOString(); saveManifest();
writeReport();
console.log(`\nAll workers stopped. Report: ${path.join(reportsBase, 'MORNING_REPORT.md')}`);
process.exitCode = results.some(r => r.exitCode !== 0) ? 1 : 0;
