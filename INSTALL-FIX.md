# Fixed installation layout

This ZIP has NO extra `codex-team-kit/` wrapper. Extract its CONTENTS into the **project root** (same directory as `package.json`), not into a new subdirectory.

Verify in PowerShell from the project root:

```powershell
Test-Path .\.claude\skills\codex-team\SKILL.md
Test-Path .\tools\codex-team\run.mjs
```

Both must return `True`. Restart Claude Code or run `/reload-skills`, then invoke `/codex-team`.

If the slash command is still missing, tell Claude: `Read .claude/skills/codex-team/SKILL.md and coordinate the setup. Do not start workers before I approve the plan.`

For the original full instructions, see README.md.
