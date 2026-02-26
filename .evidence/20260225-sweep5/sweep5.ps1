# sweep5.ps1
# Re-audit after PLAN.md normalization.
# PLAN.md files now use veritas-native format -- generate-plan will find
# format="veritas" and report real story counts. audit coverage will reflect
# which of those stories have EVA-STORY tags in source files.
#
# Run:
#   cd C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep5
#   pwsh sweep5.ps1 2>&1 | Out-File sweep5.log -Encoding ASCII

$evDir   = "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep5"
$veritas = "C:\AICOE\eva-foundation\48-eva-veritas\src\cli.js"
$base    = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"
$actor   = "agent:veritas-sweep5"
$results = @()

New-Item -ItemType Directory -Force -Path $evDir | Out-Null

function Log($msg) {
    $ts   = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$ts] $msg"
}

function Strip-Audit($obj) {
    $obj | Select-Object * -ExcludeProperty `
        obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file
}

Log "=== sweep5 START $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

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

    # Step 1: generate-plan --enrich (reads normalized PLAN.md, format=veritas)
    Log "  [1] generate-plan --enrich"
    $gp = node $veritas generate-plan --repo $repoPath --enrich 2>&1
    $gp | Out-File $projLog -Encoding ASCII
    $planFile = "$repoPath\.eva\veritas-plan.json"
    $storyCount = 0
    $featCount  = 0
    if (Test-Path $planFile) {
        $plan = Get-Content $planFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($plan -and $plan.features) {
            $featCount  = $plan.features.Count
            $storyCount = ($plan.features | ForEach-Object { $_.stories.Count } | Measure-Object -Sum).Sum
            $orphans    = if ($plan._orphan_stories) { $plan._orphan_stories.Count } else { 0 }
            $storyCount += $orphans
        }
        Log "  [1] features=$featCount stories=$storyCount"
    } else {
        Log "  [1] WARN: no veritas-plan.json"
    }

    # Step 2: audit (full discover + reconcile + compute-trust)
    Log "  [2] audit"
    $au = node $veritas audit --repo $repoPath --warn-only 2>&1
    $au | Add-Content $projLog -Encoding ASCII

    # Step 3: read trust.json for MTI score + gaps + coverage
    $trustFile = "$repoPath\.eva\trust.json"
    $mti     = 0
    $gaps    = 0
    $covered = 0
    if (Test-Path $trustFile) {
        $trust   = Get-Content $trustFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        $mti     = if ($null -ne $trust.score)     { [int]$trust.score }     else { 0 }
        $gaps    = if ($null -ne $trust.gap_count) { [int]$trust.gap_count } else { 0 }
        $covered = if ($trust.coverage -and $null -ne $trust.coverage.stories_with_artifacts) { [int]$trust.coverage.stories_with_artifacts } else { 0 }
        Log "  [3] MTI=$mti  gaps=$gaps  covered=$covered/$storyCount"
    } else {
        Log "  [3] WARN: no trust.json"
    }

    # Step 4: PUT to ACA data model
    $projRecord = Invoke-RestMethod "$base/model/projects/$proj" -ErrorAction SilentlyContinue
    if ($projRecord) {
        $prevRv   = $projRecord.row_version
        $notesVal = "veritas_scan=2026-02-25 mti=$mti gaps=$gaps stories=$storyCount covered=$covered sweep=sweep5"
        $projRecord | Add-Member -NotePropertyName "notes" -NotePropertyValue $notesVal -Force
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
        project  = $proj
        mti      = $mti
        gaps     = $gaps
        stories  = $storyCount
        covered  = $covered
        features = $featCount
        in_model = ($null -ne $projRecord)
    }
}

# ---- Summary table ----
Log ""
Log "=== RESULTS TABLE ==="
$results | Format-Table -AutoSize | Out-String | ForEach-Object {
    $_ -split "`n" | ForEach-Object { Log $_ }
}
$results | ConvertTo-Json -Depth 5 | Out-File "$evDir\sweep5-results.json" -Encoding ASCII
Log "Results JSON: $evDir\sweep5-results.json"

# ---- POST admin/commit ----
Log "[5] POST admin/commit"
try {
    $commit = Invoke-RestMethod "$base/model/admin/commit" `
        -Method POST -Headers @{"Authorization"="Bearer dev-admin"}
    Log "[5] status=$($commit.status) violations=$($commit.violation_count) exported=$($commit.exported_total)"
    if ($commit.violation_count -eq 0) {
        Log "[PASS] Commit clean"
    } else {
        Log "[FAIL] Commit has $($commit.violation_count) violations"
    }
    $commit | ConvertTo-Json -Depth 5 | Out-File "$evDir\commit-result.json" -Encoding ASCII
} catch {
    Log "[FAIL] POST commit error: $_"
}

Log "=== sweep5 DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Log "Evidence dir: $evDir"
