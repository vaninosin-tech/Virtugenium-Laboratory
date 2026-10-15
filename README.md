# Claude Code → parallel Codex CLI workers (starter kit)

Requirements: Git, Node.js 20+, Codex CLI already installed and logged in, Claude Code. Designed for Windows with Node-based launcher; also works on macOS/Linux.

## Install into your existing project

Copy `tools/`, `.claude/skills/codex-team/`, and `docs/AGCL_INTERFACES.md` into the repository root. These are project files; do not overwrite existing directories/files blindly.

From the repository root in PowerShell:

```powershell
node --version
git --version
codex --version
codex login status
node .\tools\codex-team\run.mjs --plan
```

The plan only validates configuration and does NOT launch agents. The placeholder `docs/AGCL_INTERFACES.md` must first be edited by Claude to match your project's real architecture, and committed. Do not blindly commit unrelated local changes.

In Claude Code from the repo root, run:

`/codex-team`

Ask Claude to audit and adapt the interface contract, establish file ownership, then request consent to commit the baseline. After this:

```powershell
node .\tools\codex-team\run.mjs --plan
node .\tools\codex-team\run.mjs --run
```

The command stays active while all three subprocesses work in parallel. Logs and manifest are saved to `<project>/.codex-agent-runs/<runid>/`. Each worker uses a separate Git worktree in `<project-parent>/<project-name>-codex-worktrees/<runid>/<worker>/`, based on committed `HEAD`.

## Inspect workers

```powershell
Get-ChildItem .\.codex-agent-runs\ -Directory | Sort-Object Name -Descending | Select-Object -First 1
Get-Content .\.codex-agent-runs\<runid>\manifest.json
Get-Content .\.codex-agent-runs\<runid>\fluid.stderr.log -Tail 30

git worktree list
```

Claude must inspect each worker's diff and tests. The launcher deliberately does NOT commit or merge changes, and deliberately leaves worktrees intact for review. Do not delete worktrees before review. When finished with reviews, Claude may use `git worktree remove` on clean worktrees (and remove obsolete branches) after confirming no uncommitted work remains.

## Important constraints

* Commit a clean baseline before creating worktrees. Uncommitted original project changes will not be present in worker checkouts. Launcher refuses tracked local changes.
* Git worktrees share Git object storage, but tracked data may be duplicated on disk. For a 5GB repo verify free space before launching.
* `node_modules`, local env files, untracked videos and other ignored content are **not** automatically copied to worker worktrees. Set up required dependencies separately; only share trusted read-only assets if appropriate.
* Avoid creating many full dev servers and browser recording jobs at once: three parallel CLI sessions are already resource-intensive.
* No `--yolo`, no auto commits/merges, no auto approvals. Use per-worktree `workspace-write` sandbox.
* Some Codex installation/Windows sandbox configurations may require first-run initialization or additional approval. Check CLI diagnostics if a worker fails.
* Original reference MP4 should be provided to coordinator separately; do not commit large video automatically.
* For the first run, a 3-worker split is fluid, AgCl physics, and tests. Rendering improvements can follow as a second wave after interfaces are integrated.
* Add `.codex-agent-runs/` to `.gitignore` after discussing with Claude, so logs stay private.
