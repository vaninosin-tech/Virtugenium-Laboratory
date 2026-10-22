$ErrorActionPreference = "Continue"

# ============================================================
# Virtugenium Laboratory — PPE Cabinet Autonomous Runner FIXED
#
# IMPORTANT:
# This version uses ppe-cabinet-prompt-FIXED.txt.
# The PPE cabinet itself is modeled EMPTY.
# Coat / goggles / gloves are NOT modeled.
# ============================================================

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$PromptFile = Join-Path $ProjectRoot "ppe-cabinet-prompt-FIXED.txt"

$RootReference = Join-Path $ProjectRoot "PPECabinet_FINAL_REFERENCE.png"
$ReferenceDir  = Join-Path $ProjectRoot "references"
$Reference     = Join-Path $ReferenceDir "PPECabinet_FINAL_REFERENCE.png"

$DonorFile  = Join-Path $ProjectRoot "blender-source\ReagentCabinet_MASTER.blend"
$TargetFile = Join-Path $ProjectRoot "blender-source\PPECabinet_MASTER.blend"

$OvernightDir = Join-Path $ProjectRoot "overnight\ppe"
$StateFile    = Join-Path $OvernightDir "ppe_state.json"
$DoneFile     = Join-Path $OvernightDir "ppe.done"
$StopFile     = Join-Path $OvernightDir "ppe.stop"
$LogFile      = Join-Path $OvernightDir "claude-ppe.log"

$MaxIterations = 8
$RetryMinutesOnFailure = 10
$PauseSecondsBetweenIterations = 20

$AllowedTools = "mcp__blender,Read,Write,Edit"

Set-Location $ProjectRoot

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "PPE CABINET PREFLIGHT — EMPTY CABINET" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"
Write-Host ""

$RequiredDirs = @(
    (Join-Path $ProjectRoot "blender-source"),
    (Join-Path $ProjectRoot "public\assets\models"),
    $ReferenceDir,
    (Join-Path $ProjectRoot "scripts"),
    $OvernightDir,
    (Join-Path $OvernightDir "qa"),
    (Join-Path $OvernightDir "checkpoints"),
    (Join-Path $OvernightDir "backup")
)

foreach ($Dir in $RequiredDirs) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
}

Write-Host "Required folders: OK" -ForegroundColor Green

if (-not (Test-Path $PromptFile)) {
    Write-Host "PREFLIGHT FAIL: Missing corrected prompt:" -ForegroundColor Red
    Write-Host $PromptFile
    exit 1
}

if (-not (Test-Path $DonorFile)) {
    Write-Host "PREFLIGHT FAIL: Missing reagent-cabinet donor:" -ForegroundColor Red
    Write-Host $DonorFile
    exit 1
}

if (-not (Test-Path $Reference)) {
    if (Test-Path $RootReference) {
        Copy-Item -Force $RootReference $Reference
        Write-Host "Reference copied into .\references: OK" -ForegroundColor Green
    }
    else {
        Write-Host "PREFLIGHT FAIL: Missing PPE reference image." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Corrected prompt: OK" -ForegroundColor Green
Write-Host "Reference: OK (PPE props in image are explicitly ignored)" -ForegroundColor Green
Write-Host "Reagent cabinet donor: OK" -ForegroundColor Green

if (-not (Test-Path $TargetFile)) {
    Copy-Item -Force $DonorFile $TargetFile
    Write-Host "PPE master created from ReagentCabinet_MASTER.blend: YES" -ForegroundColor Green
}
else {
    Write-Host "Existing PPECabinet_MASTER.blend preserved: YES" -ForegroundColor Green
}

if (Test-Path $DoneFile) {
    Write-Host "PASS marker already exists: $DoneFile" -ForegroundColor Yellow
    exit 0
}

if (Test-Path $StopFile) {
    Write-Host "STOP marker already exists: $StopFile" -ForegroundColor Yellow
    exit 0
}

$ClaudeCommand = Get-Command claude -ErrorAction SilentlyContinue

if (-not $ClaudeCommand) {
    Write-Host "PREFLIGHT FAIL: Claude CLI not found." -ForegroundColor Red
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

$ClaudeTestPrompt = "Reply with exactly: CLAUDE_OK"
$ClaudeTest = $ClaudeTestPrompt | & claude -p 2>&1
$ClaudeTestExit = $LASTEXITCODE
$ClaudeTestText = (($ClaudeTest | Out-String).Trim())

if (($ClaudeTestExit -ne 0) -or ($ClaudeTestText -notmatch "(?m)^CLAUDE_OK\s*$")) {
    Write-Host "PREFLIGHT FAIL: Claude response test failed." -ForegroundColor Red
    Write-Host $ClaudeTestText
    exit 1
}

Write-Host "Claude response: OK" -ForegroundColor Green

$McpList = & claude mcp list 2>&1
$McpListExit = $LASTEXITCODE
$McpListText = ($McpList | Out-String)

if (($McpListExit -ne 0) -or
    ($McpListText -notmatch "(?i)blender:") -or
    ($McpListText -notmatch "(?i)Connected")) {
    Write-Host "PREFLIGHT FAIL: Blender MCP is not connected." -ForegroundColor Red
    Write-Host $McpListText
    exit 1
}

Write-Host "Blender MCP registration: CONNECTED" -ForegroundColor Green

Write-Host "Testing real Blender MCP access..." -ForegroundColor Cyan

$BlenderTestPrompt = @"
Use the configured Blender MCP server named blender.

READ ONLY.
Do not modify the scene.
Do not save anything.

Actually call a Blender MCP tool and inspect the current Blender scene.

If successful reply exactly:
BLENDER_MCP_OK

Otherwise:
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

    Write-Host "PREFLIGHT FAIL: Blender MCP tool call failed." -ForegroundColor Red
    Write-Host $BlenderTestText
    exit 1
}

Write-Host "Blender MCP actual tool access: OK" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "ALL PPE PREFLIGHT CHECKS PASSED" -ForegroundColor Green
Write-Host "IMPORTANT: PPE CONTENT MUST REMAIN UNMODELED" -ForegroundColor Green
Write-Host "AUTONOMOUS PPE BUILD STARTING NOW" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

$PassNumber = 0

while ($PassNumber -lt $MaxIterations) {

    if (Test-Path $DoneFile) {
        Write-Host "PASS marker detected." -ForegroundColor Green
        break
    }

    if (Test-Path $StopFile) {
        Write-Host "STOP marker detected." -ForegroundColor Yellow
        break
    }

    $PassNumber++
    $Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    Write-Host "Claude PPE pass $PassNumber starting at $Stamp..." -ForegroundColor Cyan

    "------------------------------------------------------------" | Out-File -FilePath $LogFile -Append -Encoding utf8
    "PPE PASS $PassNumber START: $Stamp" | Out-File -FilePath $LogFile -Append -Encoding utf8

    if (-not (Test-Path $StateFile)) {
        $Instruction = @"
Read and obey .\ppe-cabinet-prompt-FIXED.txt as the authoritative specification.

Target:
.\blender-source\PPECabinet_MASTER.blend

Donor:
.\blender-source\ReagentCabinet_MASTER.blend

Reference:
.\references\PPECabinet_FINAL_REFERENCE.png

CRITICAL:
DO NOT model the lab coat, goggles, gloves, glove boxes, hangers, or any PPE props.
The reference contents are illustrative only.
Build the EMPTY cabinet/storage geometry.

No PPE state exists yet.
Perform ITERATION 1 only.

Use Blender MCP as required.

At the end:
- update .\overnight\ppe\ppe_state.json
- follow PASS/STOP rules
- STOP

Do not touch unrelated assets.
"@
    }
    else {
        $Instruction = @"
Continue the autonomous EMPTY PPE cabinet task.

Read:
.\ppe-cabinet-prompt-FIXED.txt
.\overnight\ppe\ppe_state.json

Target:
.\blender-source\PPECabinet_MASTER.blend

Reference:
.\references\PPECabinet_FINAL_REFERENCE.png

CRITICAL:
The final cabinet must contain ZERO modeled PPE props.
Do not create coat/goggles/gloves/hangers/glove boxes.

Perform exactly ONE next iteration.

Inspect only failed deterministic checks
and TOP THREE visual defects from state.

Do not restart the model from scratch.
Do not touch unrelated assets.

Update state.
Create PASS/STOP marker only when strict rules allow.
Then STOP.
"@
    }

    try {
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

    "PPE PASS $PassNumber EXIT CODE: $ExitCode" |
        Out-File -FilePath $LogFile -Append -Encoding utf8

    if (Test-Path $DoneFile) {
        Write-Host "PASS marker detected after PPE pass $PassNumber." -ForegroundColor Green
        break
    }

    if (Test-Path $StopFile) {
        Write-Host "STOP marker detected after PPE pass $PassNumber." -ForegroundColor Yellow
        break
    }

    if ($PassNumber -ge $MaxIterations) {
        break
    }

    if ($ExitCode -eq 0) {
        Write-Host "Iteration incomplete. Next PPE pass in $PauseSecondsBetweenIterations seconds."
        Start-Sleep -Seconds $PauseSecondsBetweenIterations
    }
    else {
        Write-Host "Claude returned exit code $ExitCode." -ForegroundColor Yellow
        Write-Host "Retrying in $RetryMinutesOnFailure minute(s)."
        Start-Sleep -Seconds ($RetryMinutesOnFailure * 60)
    }
}

Write-Host ""

if (Test-Path $DoneFile) {
    Write-Host "PPE CABINET RESULT: PASS" -ForegroundColor Green
    Get-Content $DoneFile -ErrorAction SilentlyContinue
}
elseif (Test-Path $StopFile) {
    Write-Host "PPE CABINET RESULT: NEEDS HUMAN REVIEW" -ForegroundColor Yellow
    Write-Host "See:"
    Write-Host (Join-Path $OvernightDir "ppe_final_report.md")
}
else {
    Write-Host "PPE CABINET RUN ENDED WITHOUT PASS/STOP MARKER." -ForegroundColor Yellow
    Write-Host "Check:"
    Write-Host $StateFile
    Write-Host $LogFile
}

"PPE RUN END: $(Get-Date)" |
    Out-File -FilePath $LogFile -Append -Encoding utf8
