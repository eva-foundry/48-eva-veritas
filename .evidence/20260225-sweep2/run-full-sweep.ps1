# run-full-sweep.ps1
# Full from-scratch veritas sweep:
#   1. generate-plan  (infer veritas-plan.json from PLAN.md for every project)
#   2. audit          (discover + reconcile + compute-trust fresh)
#   3. collect MTI + gap results
#   4. PUT to ACA data model
#   5. POST admin/commit
# Output: one log per project + summary table + model-update log

$evDir    = "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep2"
$veritas  = "C:\AICOE\eva-foundation\48-eva-veritas\src\cli.js"
$base     = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"
$actor    = "agent:veritas-sweep2"
$logFile  = "$evDir\sweep.log"
$results  = @()

New-Item -ItemType Directory -Force -Path $evDir | Out-Null

function Log($msg) {
    $ts = (Get-Date).ToString("HH:mm:ss")
    $line = "[$ts] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding ASCII
}

function Strip-Audit($obj) {
    $obj | Select-Object * -ExcludeProperty obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file
}

Log "=== SWEEP2 START $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

# ---- ACA health check ----
$h = Invoke-RestMethod "$base/health" -ErrorAction SilentlyContinue
if (-not $h) { Log "[FAIL] ACA unreachable -- aborting"; exit 1 }
Log "[PASS] ACA: status=$($h.status) store=$($h.store) version=$($h.version)"

$summary = Invoke-RestMethod "$base/model/agent-summary"
Log "[INFO] ACA total objects before sweep: $($summary.total)"
$summary | ConvertTo-Json -Depth 5 | Out-File "$evDir\baseline-agent-summary.json" -Encoding ASCII

# ---- Project list ----
$projects = Get-ChildItem "C:\AICOE\eva-foundation" -Directory |
    Where-Object { $_.Name -match '^\d{2}-' } |
    Sort-Object Name |
    Select-Object -ExpandProperty Name

Log "[INFO] Projects found: $($projects.Count)"

foreach ($proj in $projects) {
    $repoPath = "C:\AICOE\eva-foundation\$proj"
    $projLog  = "$evDir\$proj.log"
    Log "--- $proj ---"

    # Step 1: generate-plan (infer plan from PLAN.md / docs)
    Log "  [1] generate-plan"
    $gp = node $veritas generate-plan --repo $repoPath 2>&1
    $gp | Out-File $projLog -Encoding ASCII
    $planFile = "$repoPath\.eva\veritas-plan.json"
    if (Test-Path $planFile) {
        $plan = Get-Content $planFile | ConvertFrom-Json -ErrorAction SilentlyContinue
        $storyCount = if ($plan.stories) { $plan.stories.Count } else { 0 }
        Log "  [1] plan written: $storyCount stories"
    } else {
        Log "  [1] WARN: no veritas-plan.json produced"
        $storyCount = 0
    }

    # Step 2: audit (full discover + reconcile + compute-trust)
    Log "  [2] audit"
    $au = node $veritas audit --repo $repoPath --warn-only 2>&1
    $au | Add-Content $projLog -Encoding ASCII

    # Step 3: read trust.json for MTI score
    $trustFile = "$repoPath\.eva\trust.json"
    $mti  = 0
    $gaps = 0
    if (Test-Path $trustFile) {
        $trust = Get-Content $trustFile | ConvertFrom-Json -ErrorAction SilentlyContinue
        $mti   = if ($trust.score)      { [int]$trust.score }      else { 0 }
        $gaps  = if ($trust.gap_count)  { [int]$trust.gap_count }  else { 0 }
        Log "  [3] MTI=$mti  gaps=$gaps"
    } else {
        Log "  [3] WARN: no trust.json"
    }

    # Step 4: PUT to ACA data model
    $projRecord = Invoke-RestMethod "$base/model/projects/$proj" -ErrorAction SilentlyContinue
    if ($projRecord) {
        $prevRv = $projRecord.row_version
        $projRecord.notes = "veritas_scan=2026-02-25 mti=$mti gaps=$gaps stories=$storyCount sweep=sweep2"
        $body = Strip-Audit $projRecord | ConvertTo-Json -Depth 10
        try {
            Invoke-RestMethod "$base/model/projects/$proj" -Method PUT `
                -ContentType "application/json" -Body $body `
                -Headers @{"X-Actor"=$actor} | Out-Null
            $updated = Invoke-RestMethod "$base/model/projects/$proj"
            if ($updated.row_version -eq ($prevRv + 1)) {
                Log "  [4] PUT OK rv=$($updated.row_version)"
            } else {
                Log "  [4] WARN rv unexpected: got $($updated.row_version) expected $($prevRv+1)"
            }
        } catch {
            Log "  [4] PUT FAIL: $_"
        }
    } else {
        Log "  [4] SKIP: project not in data model (id=$proj)"
    }

    $results += [PSCustomObject]@{
        project    = $proj
        mti        = $mti
        gaps       = $gaps
        stories    = $storyCount
        in_model   = ($null -ne $projRecord)
    }
}

# ---- Summary table ----
Log ""
Log "=== RESULTS TABLE ==="
$results | Format-Table -AutoSize | Out-String | ForEach-Object {
    $_ -split "`n" | ForEach-Object { Log $_ }
}
$results | ConvertTo-Json -Depth 5 | Out-File "$evDir\sweep-results.json" -Encoding ASCII

# ---- POST admin/commit ----
Log "[5] POST admin/commit"
try {
    $commit = Invoke-RestMethod "$base/model/admin/commit" `
        -Method POST -Headers @{"Authorization"="Bearer dev-admin"}
    Log "[5] status=$($commit.status) violations=$($commit.violation_count) exported=$($commit.exported_total)"
    if ($commit.violation_count -eq 0) {
        Log "[PASS] Commit clean"
    } else {
        Log "[WARN] $($commit.violation_count) violations"
    }
} catch {
    Log "[WARN] commit call failed: $_"
}

Log "=== SWEEP2 DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Log "Evidence dir: $evDir"
