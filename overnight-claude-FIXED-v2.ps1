$ErrorActionPreference = "Continue"

# ============================================================
# Virtugenium Laboratory — Overnight Fume Hood Runner v2
#
# Fixes:
# - ProjectRoot = folder containing this .ps1
# - Claude prompts are sent through STDIN (avoids -p argument parsing issue)
# - explicit permission for all Blender MCP tools
# - full preflight before waiting
# - starts at 19:00 according to THIS COMPUTER'S local clock
# ============================================================

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$PromptFile = Join-Path $ProjectRoot "overnight-fumehood-prompt.txt"
$Reference  = Join-Path $ProjectRoot "references\FumeHood_reference.png"

$OvernightDir = Join-Path $ProjectRoot "overnight"
$StateFile    = Join-Path $OvernightDir "fumehood_state.json"
$DoneFile     = Join-Path $OvernightDir "fumehood.done"
$StopFile     = Join-Path $OvernightDir "fumehood.stop"
$LogFile      = Join-Path $OvernightDir "claude-overnight.log"

$MaxHours = 11
$RetryMinutesOnFailure = 15
$PauseMinutesBetweenIterations = 2

# Allow ALL tools exposed by the MCP server named "blender",
# plus normal project file read/write/edit operations.
$AllowedTools = "mcp__blender,Read,Write,Edit"

Set-Location $ProjectRoot

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "VIRTUGENIUM OVERNIGHT PREFLIGHT" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"
Write-Host ""

# ------------------------------------------------------------
# 1. REQUIRED INPUT FILES
# ------------------------------------------------------------

if (-not (Test-Path $PromptFile)) {
    Write-Host "PREFLIGHT FAIL: Missing prompt:" -ForegroundColor Red
    Write-Host $PromptFile
    exit 1
}

if (-not (Test-Path $Reference)) {
    Write-Host "PREFLIGHT FAIL: Missing reference image:" -ForegroundColor Red
    Write-Host $Reference
    exit 1
}

Write-Host "Prompt: OK" -ForegroundColor Green
Write-Host "Reference: OK" -ForegroundColor Green

# ------------------------------------------------------------
# 2. CREATE REQUIRED DIRECTORIES
# ------------------------------------------------------------

$RequiredDirs = @(
    (Join-Path $ProjectRoot "blender-source"),
    (Join-Path $ProjectRoot "public\assets\models"),
    (Join-Path $ProjectRoot "references"),
    (Join-Path $ProjectRoot "scripts"),
    $OvernightDir,
    (Join-Path $OvernightDir "qa"),
    (Join-Path $OvernightDir "checkpoints"),
    (Join-Path $OvernightDir "backup_before_overnight")
)

foreach ($Dir in $RequiredDirs) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
}

Write-Host "Required folders: OK" -ForegroundColor Green

# ------------------------------------------------------------
# 3. CLAUDE CLI CHECK
# ------------------------------------------------------------

$ClaudeCommand = Get-Command claude -ErrorAction SilentlyContinue

if (-not $ClaudeCommand) {
    Write-Host "PREFLIGHT FAIL: 'claude' CLI was not found in PATH." -ForegroundColor Red
    exit 1
}

$ClaudeVersionRaw = & claude --version 2>&1
$ClaudeVersionExit = $LASTEXITCODE
$ClaudeVersionText = (($ClaudeVersionRaw | Out-String).Trim())

if ($ClaudeVersionExit -ne 0) {
    Write-Host "PREFLIGHT FAIL: Claude CLI cannot run." -ForegroundColor Red
    Write-Host $ClaudeVersionText
    exit 1
}

Write-Host "Claude CLI: OK ($ClaudeVersionText)" -ForegroundColor Green

# ------------------------------------------------------------
# 4. BASIC CLAUDE RESPONSE CHECK
# Prompt is sent through STDIN intentionally.
# ------------------------------------------------------------

$ClaudeTestPrompt = "Reply with exactly: CLAUDE_OK"

$ClaudeTest = $ClaudeTestPrompt |
    & claude -p 2>&1

$ClaudeTestExit = $LASTEXITCODE
$ClaudeTestText = (($ClaudeTest | Out-String).Trim())

if (($ClaudeTestExit -ne 0) -or ($ClaudeTestText -notmatch "(?m)^CLAUDE_OK\s*$")) {
    Write-Host "PREFLIGHT FAIL: Claude did not answer correctly." -ForegroundColor Red
    Write-Host $ClaudeTestText
    exit 1
}

Write-Host "Claude response: OK" -ForegroundColor Green

# ------------------------------------------------------------
# 5. MCP CONFIGURATION CHECK
# ------------------------------------------------------------

$McpList = & claude mcp list 2>&1
$McpListExit = $LASTEXITCODE
$McpListText = ($McpList | Out-String)

if ($McpListExit -ne 0) {
    Write-Host "PREFLIGHT FAIL: Could not read MCP server list." -ForegroundColor Red
    Write-Host $McpListText
    exit 1
}

if (($McpListText -notmatch "(?i)blender:") -or
    ($McpListText -notmatch "(?i)Connected")) {
    Write-Host "PREFLIGHT FAIL: Blender MCP is not shown as Connected." -ForegroundColor Red
    Write-Host $McpListText
    exit 1
}

Write-Host "Blender MCP registration: CONNECTED" -ForegroundColor Green

# ------------------------------------------------------------
# 6. REAL BLENDER MCP READ-ONLY HANDSHAKE
#
# IMPORTANT FIX:
# The prompt goes through STDIN, so -p cannot lose its input
# while PowerShell parses --allowedTools / --permission-mode.
# ------------------------------------------------------------

Write-Host "Testing actual Blender MCP tool access..." -ForegroundColor Cyan

$BlenderTestPrompt = @"
Use the configured Blender MCP server named blender.

READ ONLY.
Do not modify the scene.
Do not save the file.
Do not create, delete, move, rename, or edit any Blender object.

You MUST actually call a Blender MCP tool and inspect the currently open scene.

If the Blender MCP tool call succeeds, reply with exactly:
BLENDER_MCP_OK

If you cannot actually invoke Blender MCP, reply with exactly:
BLENDER_MCP_FAIL
"@

$BlenderTest = $BlenderTestPrompt |
    & claude -p `
        --permission-mode acceptEdits `
        --allowedTools $AllowedTools 2>&1

$BlenderTestExit = $LASTEXITCODE
$BlenderTestText = (($BlenderTest | Out-String).Trim())

if (($BlenderTestExit -ne 0) -or
    ($BlenderTestText -notmatch "(?m)^BLENDER_MCP_OK\s*$")) {

    Write-Host ""
    Write-Host "PREFLIGHT FAIL: Claude CLI could not use Blender MCP." -ForegroundColor Red
    Write-Host ""
    Write-Host $BlenderTestText
    Write-Host ""
    Write-Host "Blender MCP is registered, but the real tool call did not succeed." -ForegroundColor Yellow
    Write-Host "Keep Blender open and ensure the Blender MCP addon/server is active." -ForegroundColor Yellow
    exit 1
}

Write-Host "Blender MCP actual tool access: OK" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "ALL PREFLIGHT CHECKS PASSED" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# 7. PREVIOUS MARKER SAFETY
# ------------------------------------------------------------

if (Test-Path $DoneFile) {
    Write-Host "A PASS marker already exists:" -ForegroundColor Yellow
    Write-Host $DoneFile
    Write-Host "Move/delete it manually if you intentionally want a new overnight run."
    exit 0
}

if (Test-Path $StopFile) {
    Write-Host "A STOP marker already exists:" -ForegroundColor Yellow
    Write-Host $StopFile
    Write-Host "Move/delete it manually if you intentionally want to resume/restart."
    exit 0
}

# ------------------------------------------------------------
# 8. WAIT UNTIL 19:00 LOCAL COMPUTER TIME
# ------------------------------------------------------------

$Now = Get-Date
$Target = [DateTime]::Today.AddHours(19)

if ($Now -ge $Target) {
    $Target = $Target.AddDays(1)
}

Write-Host "Scheduled start (computer local time): $($Target.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan
Write-Host "Keep Blender, this terminal, internet, and the computer awake."
Write-Host ""

while ((Get-Date) -lt $Target) {
    $Remaining = $Target - (Get-Date)
    $Seconds = [Math]::Min(
        60,
        [Math]::Max(1, [int][Math]::Ceiling($Remaining.TotalSeconds))
    )
    Start-Sleep -Seconds $Seconds
}

$RunStarted = Get-Date
$Deadline = $RunStarted.AddHours($MaxHours)

"============================================================" | Out-File -FilePath $LogFile -Append -Encoding utf8
"OVERNIGHT RUN START: $RunStarted" | Out-File -FilePath $LogFile -Append -Encoding utf8
"PROJECT ROOT: $ProjectRoot" | Out-File -FilePath $LogFile -Append -Encoding utf8
"DEADLINE: $Deadline" | Out-File -FilePath $LogFile -Append -Encoding utf8

Write-Host "Starting overnight run at $(Get-Date)." -ForegroundColor Green
Write-Host "Deadline: $Deadline"
Write-Host ""

# ------------------------------------------------------------
# 9. ITERATION LOOP
# Each invocation performs exactly one iteration.
# State is persisted to overnight\fumehood_state.json.
# ------------------------------------------------------------

$PassNumber = 0

while ((Get-Date) -lt $Deadline) {

    if (Test-Path $DoneFile) {
        Write-Host "PASS marker detected. Overnight job finished." -ForegroundColor Green
        break
    }

    if (Test-Path $StopFile) {
        Write-Host "STOP marker detected. Human review is required." -ForegroundColor Yellow
        break
    }

    $PassNumber++
    $Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    Write-Host "Claude pass $PassNumber starting at $Stamp..." -ForegroundColor Cyan

    "------------------------------------------------------------" | Out-File -FilePath $LogFile -Append -Encoding utf8
    "CLAUDE PASS $PassNumber START: $Stamp" | Out-File -FilePath $LogFile -Append -Encoding utf8

    if (-not (Test-Path $StateFile)) {
        $Instruction = @"
Read and obey .\overnight-fumehood-prompt.txt as the authoritative specification.

The authoritative visual reference is:
.\references\FumeHood_reference.png

No overnight state exists yet.
Perform ITERATION 1 only.

Use the configured Blender MCP server named blender as required.
You have explicit permission to use the Blender MCP tools for this task.

At the end:
- save/update .\overnight\fumehood_state.json
- follow the PASS/STOP marker rules in the specification
- STOP exactly as specified

Do not work on unrelated project files.
"@
    }
    else {
        $Instruction = @"
Continue the dedicated overnight fume hood task.

First read:
.\overnight-fumehood-prompt.txt
.\overnight\fumehood_state.json

The authoritative visual reference is:
.\references\FumeHood_reference.png

Perform exactly ONE next iteration according to the state and specification.

Use the configured Blender MCP server named blender as required.
You have explicit permission to use the Blender MCP tools for this task.

Do not restart the design from scratch.
Do not touch unrelated project assets.

Update the state file.
Create PASS/STOP marker only when the strict specification allows it.
Then STOP.
"@
    }

    try {
        # Prompt through STDIN: robust in PowerShell and avoids the earlier -p error.
        $ClaudeOutput = $Instruction |
            & claude -p `
                --permission-mode acceptEdits `
                --allowedTools $AllowedTools 2>&1

        $ExitCode = $LASTEXITCODE

        $ClaudeOutput |
            Tee-Object -FilePath $LogFile -Append
    }
    catch {
        $ExitCode = 1
        $ErrorText = "EXCEPTION: $($_.Exception.Message)"
        Write-Host $ErrorText -ForegroundColor Red
        $ErrorText | Out-File -FilePath $LogFile -Append -Encoding utf8
    }

    "CLAUDE PASS $PassNumber EXIT CODE: $ExitCode" |
        Out-File -FilePath $LogFile -Append -Encoding utf8

    if (Test-Path $DoneFile) {
        Write-Host "PASS marker detected after pass $PassNumber." -ForegroundColor Green
        break
    }

    if (Test-Path $StopFile) {
        Write-Host "STOP marker detected after pass $PassNumber." -ForegroundColor Yellow
        break
    }

    if ((Get-Date) -ge $Deadline) {
        break
    }

    if ($ExitCode -eq 0) {
        Write-Host "Iteration incomplete. Next pass in $PauseMinutesBetweenIterations minute(s)."
        Start-Sleep -Seconds ($PauseMinutesBetweenIterations * 60)
    }
    else {
        Write-Host "Claude returned exit code $ExitCode." -ForegroundColor Yellow
        Write-Host "Possible temporary usage/tool/network failure."
        Write-Host "Retrying in $RetryMinutesOnFailure minute(s)."
        Start-Sleep -Seconds ($RetryMinutesOnFailure * 60)
    }
}

# ------------------------------------------------------------
# 10. FINAL STATUS
# ------------------------------------------------------------

Write-Host ""

if (Test-Path $DoneFile) {
    Write-Host "OVERNIGHT RESULT: PASS" -ForegroundColor Green
    Get-Content $DoneFile -ErrorAction SilentlyContinue
}
elseif (Test-Path $StopFile) {
    Write-Host "OVERNIGHT RESULT: NEEDS HUMAN REVIEW" -ForegroundColor Yellow
    Write-Host "See:"
    Write-Host (Join-Path $OvernightDir "fumehood_final_report.md")
}
else {
    Write-Host "OVERNIGHT DEADLINE REACHED WITHOUT PASS/STOP MARKER." -ForegroundColor Yellow
    Write-Host "State and Blender files were left intact for review or continuation."
}

"OVERNIGHT RUN END: $(Get-Date)" |
    Out-File -FilePath $LogFile -Append -Encoding utf8
