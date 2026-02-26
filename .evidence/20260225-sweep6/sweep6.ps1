# sweep6.ps1
# First clean sweep after BOM fix on cli.js.
# All node calls now succeed. Auto-tags from sweep4/auto-tag.ps1 are present.
# Reads trust.json fields correctly: $trust.score, $trust.components.coverage
# Reads reconciliation.json for gap count: $recon.gaps.Count
#
# Run:
#   cd C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep6
#   pwsh sweep6.ps1 2>&1 | Out-File sweep6.log -Encoding ASCII

$evDir   = "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep6"
$veritas = "C:\AICOE\eva-foundation\48-eva-veritas\src\cli.js"
$base    = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"
$actor   = "agent:veritas-sweep6"
$results = @()

New-Item -ItemType Directory -Force -Path $evDir | Out-Null

function Log($msg) {
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$ts] $msg"
}

function Strip-Audit($obj) {
    $obj | Select-Object * -ExcludeProperty `
        obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file
}

Log "=== sweep6 START $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

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

    # Step 1: generate-plan --enrich
    Log "  [1] generate-plan --enrich"
    $gp = node $veritas generate-plan --repo $repoPath --enrich 2>&1
    $gp | Out-File $projLog -Encoding ASCII
    $planFile   = "$repoPath\.eva\veritas-plan.json"
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

    # Step 2: audit (discover + reconcile + trust)
    Log "  [2] audit"
    $au = node $veritas audit --repo $repoPath --warn-only 2>&1
    $au | Add-Content $projLog -Encoding ASCII

    # Step 3: read trust.json
    $trustFile = "$repoPath\.eva\trust.json"
    $mti       = 0
    $covPct    = 0
    if (Test-Path $trustFile) {
        $trust  = Get-Content $trustFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        $mti    = if ($null -ne $trust.score) { [int]$trust.score } else { 0 }
        # components.coverage is a ratio 0..1
        $covPct = if ($trust.components -and $null -ne $trust.components.coverage) {
            [math]::Round($trust.components.coverage * 100)
        } else { 0 }
    } else {
        Log "  [3] WARN: no trust.json"
    }

    # Step 3b: read reconciliation.json for gap count
    $reconFile = "$repoPath\.eva\reconciliation.json"
    $gaps = 0
    if (Test-Path $reconFile) {
        $recon = Get-Content $reconFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        $gaps  = if ($recon -and $recon.gaps) { $recon.gaps.Count } else { 0 }
    }

    $coveredStories = [math]::Round($storyCount * $covPct / 100)
    Log "  [3] MTI=$mti  coverage=$covPct%  covered=$coveredStories/$storyCount  gaps=$gaps"

    # Step 4: PUT to ACA data model
    $projRecord = Invoke-RestMethod "$base/model/projects/$proj" -ErrorAction SilentlyContinue
    if ($projRecord) {
        $prevRv   = $projRecord.row_version
        $notesVal = "veritas_scan=2026-02-25 mti=$mti coverage=$covPct% covered=$coveredStories/$storyCount gaps=$gaps sweep=sweep6"
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
        Log "  [4] SKIP: project not in data model"
    }

    $results += [PSCustomObject]@{
        project  = $proj
        mti      = $mti
        coverage = $covPct
        covered  = $coveredStories
        stories  = $storyCount
        gaps     = $gaps
        features = $featCount
        in_model = ($null -ne $projRecord)
    }
}

# ---- Results table ----
Log ""
Log "=== RESULTS TABLE ==="
Log ""
$results | Format-Table -AutoSize | Out-String | ForEach-Object { Log $_ }

$results | ConvertTo-Json -Depth 5 | Out-File "$evDir\sweep6-results.json" -Encoding ASCII
Log "Results JSON: $evDir\sweep6-results.json"

# ---- Commit ----
Log "[5] POST admin/commit"
$c = Invoke-RestMethod "$base/model/admin/commit" -Method POST `
    -Headers @{"Authorization"="Bearer dev-admin"} -ErrorAction SilentlyContinue
Log "[5] status=$($c.status) violations=$($c.violation_count) exported=$($c.exported_total)"
$c | ConvertTo-Json -Depth 5 | Out-File "$evDir\commit-result.json" -Encoding ASCII
if ($c.violation_count -eq 0) {
    Log "[PASS] Commit clean"
} else {
    Log "[WARN] Violations: $($c.violation_count)"
}

Log "=== sweep6 DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Log "Evidence dir: $evDir"
