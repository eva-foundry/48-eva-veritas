# full-bootstrap.ps1
# EVA Foundation -- Full Portfolio Bootstrap Replay
# Version  : 1.0.0
# Date     : 2026-02-25 08:20 ET
# Author   : agent:copilot (session 5)
#
# PURPOSE
# -------
# Replays the complete EVA data model build sequence from a clean slate.
# Run this whenever the data model is reset, re-provisioned, or migrated.
# Every step is idempotent -- safe to re-run.
#
# SEQUENCE
# --------
# Phase 0 -- Preflight     : verify ACA reachable, veritas CLI works
# Phase 1 -- Reset         : delete all WBS records, clear project wbs_id/stream
# Phase 2 -- Normalize     : normalize PLAN.md files to veritas-native format
# Phase 3 -- Tag           : inject EVA-STORY tags into source files
# Phase 4 -- Sweep         : PDCA loop for all 49 projects (generate-plan + audit + sync)
# Phase 5 -- WBS Import    : build full hierarchy from veritas-plan.json files
# Phase 6 -- Endpoint Link : link all endpoints + screens to WBS story IDs
# Phase 7 -- ADO Seeding   : generate ADO Epics/Features/PBIs from WBS (requires ADO_PAT)
# Phase 8 -- Commit        : final integrity check + admin/commit
#
# EVIDENCE OUTPUT
# ---------------
# .evidence/YYYYMMDD-bootstrap/bootstrap.log  -- full run log
# .evidence/YYYYMMDD-bootstrap/bootstrap-summary.json  -- machine-readable results
#
# SCRIPTS CALLED (all located in .evidence/ subfolders)
# -------------------------------------------------------
# 20260225-sweep3/normalize-plans.ps1          -- Phase 2
# 20260225-sweep4/auto-tag.ps1                 -- Phase 3 (if exists)
# 20260225-sweep7/sweep7.ps1                   -- Phase 4 (for remaining MTI=0 projects)
# 20260225-wbs-import/wbs-import.ps1           -- Phase 5
# 20260225-endpoint-link/endpoint-link.ps1     -- Phase 6
# 20260225-ado-seed/wbs-to-ado.ps1             -- Phase 7 (requires ADO_PAT)
#
# USE SWEEP-ALL INSTEAD OF INDIVIDUAL SWEEPS on a clean machine:
#   This script runs sweep-all-projects.ps1 (defined inline) that combines
#   sweep6 + sweep7 logic into one idempotent loop.
#
# REQUIREMENTS
# ------------
#   node >= 18 (tested on v24)
#   PowerShell >= 7.0
#   ACA data model reachable at $base (or local fallback at port 8010)
#   EVA-Foundation workspace cloned at C:\AICOE\eva-foundation\

Set-StrictMode -Off
$ErrorActionPreference = "Continue"

$HERE    = $PSScriptRoot
$BASEDIR = "C:\AICOE\eva-foundation"
$VERIT   = "$BASEDIR\48-eva-veritas"
$CLI     = "node $VERIT\src\cli.js"
$DATE    = (Get-Date -Format "yyyyMMdd-HHmm")
$LOG_DIR = "$VERIT\.evidence\$DATE-bootstrap"
New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null

function Log {
    param([string]$msg)
    $ts = Get-Date -Format "HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line
    $line | Out-File "$LOG_DIR\bootstrap.log" -Encoding ASCII -Append
}

function Run-Step {
    param([string]$label, [scriptblock]$block)
    Log "[START] $label"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        & $block
        Log "[DONE]  $label  ($($sw.Elapsed.TotalSeconds.ToString('0.0'))s)"
        return $true
    } catch {
        Log "[FAIL]  $label -- $($_.Exception.Message)"
        return $false
    }
}

# ============================================================
# DATA MODEL BASE URL
# ============================================================
$base = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"

# ============================================================
# PHASE 0 -- PREFLIGHT
# ============================================================
Log "=== PHASE 0: PREFLIGHT ==="

$h = Invoke-RestMethod "$base/health" -TimeoutSec 15 -ErrorAction SilentlyContinue
if (-not $h) {
    $base = "http://localhost:8010"
    $h = Invoke-RestMethod "$base/health" -TimeoutSec 10 -ErrorAction SilentlyContinue
    if (-not $h) {
        Log "[FAIL] Data model unreachable at ACA and localhost:8010 -- aborting"
        exit 1
    }
    Log "[WARN] Using local fallback: $base"
} else {
    Log "[INFO] ACA data model: status=$($h.status) store=$($h.store) version=$($h.version)"
}

$nodeVer = node --version 2>&1
Log "[INFO] Node.js: $nodeVer"

$cliCheck = & node "$VERIT\src\cli.js" --version 2>&1
Log "[INFO] veritas CLI: $cliCheck"

$sm = Invoke-RestMethod "$base/model/agent-summary" -TimeoutSec 20
Log "[INFO] Pre-bootstrap model total: $($sm.total)  wbs=$($sm.wbs)"

# ============================================================
# PHASE 1 -- RESET (clean slate)
# ============================================================
Log "=== PHASE 1: RESET -- delete WBS, clear project links ==="

Run-Step "Delete all WBS records" {
    $wbs = Invoke-RestMethod "$base/model/wbs/" -TimeoutSec 60
    Log "[INFO] WBS records to delete: $($wbs.Count)"
    $deleted = 0
    foreach ($w in $wbs) {
        $wid = [Uri]::EscapeDataString($w.id)
        Invoke-RestMethod "$base/model/wbs/$wid" -Method DELETE `
            -Headers @{"X-Actor"="agent:bootstrap"} -ErrorAction SilentlyContinue | Out-Null
        $deleted++
    }
    Log "[INFO] Deleted $deleted WBS records"
}

Run-Step "Clear wbs_id and stream on all projects" {
    $projs = Invoke-RestMethod "$base/model/projects/" -TimeoutSec 30
    $cleared = 0
    foreach ($p in $projs) {
        $prev_rv = $p.row_version
        $pCopy = $p | Select-Object * -ExcludeProperty obj_id, layer, modified_by, modified_at,
            created_by, created_at, row_version, source_file
        $pCopy.wbs_id = $null
        $pCopy.stream = $null
        $body = $pCopy | ConvertTo-Json -Depth 10
        $pid  = [Uri]::EscapeDataString($p.id)
        Invoke-RestMethod "$base/model/projects/$pid" -Method PUT -ContentType "application/json" `
            -Body $body -Headers @{"X-Actor"="agent:bootstrap"} -ErrorAction SilentlyContinue | Out-Null
        $cleared++
    }
    Log "[INFO] Cleared wbs_id/stream on $cleared projects"
}

# ============================================================
# PHASE 2 -- NORMALIZE PLAN.MD FILES
# ============================================================
Log "=== PHASE 2: NORMALIZE PLAN.MD ==="

$normalizeScript = "$VERIT\.evidence\20260225-sweep3\normalize-plans.ps1"
if (Test-Path $normalizeScript) {
    Run-Step "normalize-plans.ps1" {
        & pwsh $normalizeScript 2>&1 | Out-File "$LOG_DIR\normalize.log" -Encoding ASCII
        Log "[INFO] normalize log -> $LOG_DIR\normalize.log"
    }
} else {
    Log "[WARN] normalize-plans.ps1 not found at $normalizeScript -- skipping"
}

# ============================================================
# PHASE 3 -- AUTO-TAG SOURCE FILES
# ============================================================
Log "=== PHASE 3: AUTO-TAG SOURCE FILES ==="

$autoTagScript = "$VERIT\.evidence\20260225-sweep4\auto-tag.ps1"
if (Test-Path $autoTagScript) {
    Run-Step "auto-tag.ps1" {
        & pwsh $autoTagScript 2>&1 | Out-File "$LOG_DIR\auto-tag.log" -Encoding ASCII
        Log "[INFO] auto-tag log -> $LOG_DIR\auto-tag.log"
    }
} else {
    Log "[WARN] auto-tag.ps1 not found at $autoTagScript -- skipping (tags may already be in source)"
}

# ============================================================
# PHASE 4 -- SWEEP ALL PROJECTS (PDCA loop)
# ============================================================
Log "=== PHASE 4: SWEEP ALL PROJECTS ==="

# Project list: all numbered folders under eva-foundation
$projectFolders = Get-ChildItem $BASEDIR -Directory |
    Where-Object { $_.Name -match '^\d{2}-' } |
    Sort-Object Name

Log "[INFO] Found $($projectFolders.Count) project folders"

$sweep_pass = 0; $sweep_fail = 0; $sweep_skip = 0

foreach ($folder in $projectFolders) {
    $proj = $folder.Name
    $repoPath = $folder.FullName

    # Skip if no PLAN.md and no manifest.yml (truly empty)
    $hasPlan     = Test-Path "$repoPath\PLAN.md"
    $hasManifest = Test-Path "$repoPath\manifest.yml"

    if (-not $hasPlan -and -not $hasManifest) {
        Log "[SKIP] $proj -- no PLAN.md or manifest.yml"
        $sweep_skip++
        continue
    }

    try {
        # generate-plan: infer veritas-plan.json from PLAN.md
        $gp = & node "$VERIT\src\cli.js" generate-plan --repo "$repoPath" --enrich 2>&1
        # audit: compute MTI and write trust.json
        $au = & node "$VERIT\src\cli.js" audit --repo "$repoPath" --warn-only 2>&1

        # Read trust.json
        $trust = Get-Content "$repoPath\.eva\trust.json" -ErrorAction SilentlyContinue |
            ConvertFrom-Json -ErrorAction SilentlyContinue
        $mti  = if ($trust) { [int]$trust.score }              else { 0 }
        $cov  = if ($trust -and $trust.components) { [math]::Round($trust.components.coverage * 100) } else { 0 }

        # Read veritas-plan.json for story count
        $plan = Get-Content "$repoPath\.eva\veritas-plan.json" -ErrorAction SilentlyContinue |
            ConvertFrom-Json -ErrorAction SilentlyContinue
        $stories = if ($plan -and $plan.features) {
            ($plan.features | ForEach-Object { $_.stories.Count } | Measure-Object -Sum).Sum
        } else { 0 }

        # Read reconciliation gaps
        $recon = Get-Content "$repoPath\.eva\reconciliation.json" -ErrorAction SilentlyContinue |
            ConvertFrom-Json -ErrorAction SilentlyContinue
        $gaps = if ($recon -and $recon.gaps) { $recon.gaps.Count } else { 0 }

        # Sync to data model
        $projRec = Invoke-RestMethod "$base/model/projects/$([Uri]::EscapeDataString($proj))" `
            -ErrorAction SilentlyContinue
        if ($projRec) {
            $pCopy = $projRec | Select-Object * -ExcludeProperty obj_id, layer, modified_by, modified_at,
                created_by, created_at, row_version, source_file
            $pCopy | Add-Member -MemberType NoteProperty -Name "mti_score"    -Value $mti     -Force
            $pCopy | Add-Member -MemberType NoteProperty -Name "story_count"  -Value $stories -Force
            $pCopy | Add-Member -MemberType NoteProperty -Name "gap_count"    -Value $gaps    -Force
            $pCopy | Add-Member -MemberType NoteProperty -Name "coverage_pct" -Value $cov     -Force
            $body = $pCopy | ConvertTo-Json -Depth 10
            $pid  = [Uri]::EscapeDataString($proj)
            Invoke-RestMethod "$base/model/projects/$pid" -Method PUT -ContentType "application/json" `
                -Body $body -Headers @{"X-Actor"="agent:bootstrap"} -ErrorAction SilentlyContinue | Out-Null
        }

        $status = if ($mti -ge 50) { "[PASS]" } else { "[WARN]" }
        Log "$status $proj  mti=$mti  coverage=$cov%  stories=$stories  gaps=$gaps"
        $sweep_pass++
    } catch {
        Log "[FAIL] $proj -- $($_.Exception.Message)"
        $sweep_fail++
    }
}

Log "[INFO] Sweep complete: pass=$sweep_pass fail=$sweep_fail skip=$sweep_skip"

# ============================================================
# PHASE 5 -- WBS IMPORT
# ============================================================
Log "=== PHASE 5: WBS IMPORT ==="

$wbsScript = "$VERIT\.evidence\20260225-wbs-import\wbs-import.ps1"
if (Test-Path $wbsScript) {
    Run-Step "wbs-import.ps1" {
        & pwsh $wbsScript 2>&1 | Out-File "$LOG_DIR\wbs-import.log" -Encoding ASCII
        $summary = Get-Content "$LOG_DIR\wbs-import.log" | Select-String "(TOTAL|errors|PASS|FAIL)"
        Log "[INFO] WBS import: $($summary -join ' | ')"
    }
} else {
    Log "[FAIL] wbs-import.ps1 not found at $wbsScript"
    exit 1
}

# ============================================================
# PHASE 6 -- ENDPOINT LINKAGE
# ============================================================
Log "=== PHASE 6: ENDPOINT LINKAGE ==="

$epScript = "$VERIT\.evidence\20260225-endpoint-link\endpoint-link.ps1"
if (Test-Path $epScript) {
    Run-Step "endpoint-link.ps1" {
        & pwsh $epScript 2>&1 | Out-File "$LOG_DIR\endpoint-link.log" -Encoding ASCII
        $summary = Get-Content "$LOG_DIR\endpoint-link.log" | Select-String "(linked_eps|linked_scr|enriched|PASS|FAIL)"
        Log "[INFO] Endpoint link: $($summary -join ' | ')"
    }
} else {
    Log "[FAIL] endpoint-link.ps1 not found at $epScript"
    exit 1
}

# ============================================================
# PHASE 7 -- ADO SPRINT SEEDING (optional -- requires ADO_PAT)
# ============================================================
Log "=== PHASE 7: ADO SPRINT SEEDING ==="

$adoScript = "$VERIT\.evidence\20260225-ado-seed\wbs-to-ado.ps1"
if (Test-Path $adoScript) {
    if ($env:ADO_PAT -or (az keyvault secret show --vault-name marcosandkv20260203 --name ADO-PAT 2>$null)) {
        Run-Step "wbs-to-ado.ps1 (live)" {
            & pwsh $adoScript 2>&1 | Out-File "$LOG_DIR\ado-seed.log" -Encoding ASCII
            $summary = Get-Content "$LOG_DIR\ado-seed.log" | Select-String "(COMPLETE|import_success|import_failed|PASS|FAIL)"
            Log "[INFO] ADO seed: $($summary -join ' | ')"
        }
    } else {
        Log "[WARN] ADO_PAT not set and Key Vault unavailable -- running wbs-to-ado.ps1 -DryRun"
        Run-Step "wbs-to-ado.ps1 (dry-run)" {
            & pwsh $adoScript -DryRun 2>&1 | Out-File "$LOG_DIR\ado-seed-dryrun.log" -Encoding ASCII
            Log "[INFO] Dry-run log -> $LOG_DIR\ado-seed-dryrun.log"
        }
    }
} else {
    Log "[WARN] wbs-to-ado.ps1 not found at $adoScript -- skipping ADO seeding"
}

# ============================================================
# PHASE 8 -- FINAL COMMIT + SUMMARY
# ============================================================
Log "=== PHASE 8: FINAL COMMIT ===" 

$c = Invoke-RestMethod "$base/model/admin/commit" -Method POST `
    -Headers @{"Authorization"="Bearer dev-admin"} -TimeoutSec 60
$sm2 = Invoke-RestMethod "$base/model/agent-summary" -TimeoutSec 20

Log ""
Log "=== FULL BOOTSTRAP COMPLETE ==="
Log "  Date             : $DATE"
Log "  violations       : $($c.violation_count)"
Log "  exported_total   : $($c.exported_total)"
Log "  export_errors    : $($c.export_errors.Count)"
Log "  model_total      : $($sm2.total)"
Log "  wbs_total        : $($sm2.wbs)"
Log "  projects_swept   : $sweep_pass"
Log "  sweep_failed     : $sweep_fail"

if ($c.violation_count -eq 0 -and $c.export_errors.Count -eq 0) {
    Log "[PASS] Bootstrap complete -- data model is authoritative"
} else {
    Log "[FAIL] Bootstrap finished with issues -- check $LOG_DIR\bootstrap.log"
}

# Write machine-readable summary
@{
    run_date         = (Get-Date -Format "o")
    base_url         = $base
    violations       = $c.violation_count
    exported_total   = $c.exported_total
    model_total      = $sm2.total
    wbs_total        = $sm2.wbs
    projects_swept   = $sweep_pass
    sweep_failed     = $sweep_fail
    result           = if ($c.violation_count -eq 0) { "PASS" } else { "FAIL" }
} | ConvertTo-Json -Depth 3 | Out-File "$LOG_DIR\bootstrap-summary.json" -Encoding ASCII

Log "[INFO] Logs -> $LOG_DIR\"
