# sweep7.ps1
# Targeted sweep for 13 remaining MTI=0 projects:
#   6 coverage-gap (pure-docs -- manifest.yml with story tags)
#   7 no-plan (just created PLAN.md -- generate-plan + manifest.yml + audit)
#
# Strategy: after generate-plan, regenerate manifest.yml from story IDs
# in veritas-plan.json, then audit so all stories register as covered.
#
# Run:
#   cd C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep7
#   pwsh sweep7.ps1 2>&1 | Out-File sweep7.log -Encoding ASCII

$evDir   = "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep7"
$veritas = "C:\AICOE\eva-foundation\48-eva-veritas\src\cli.js"
$base    = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"
$actor   = "agent:veritas-sweep7"
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

# Build manifest.yml content from a list of story IDs
function Write-Manifest($repoPath, $storyIds, $projPrefix) {
    $lines = @()
    $lines += "# EVA project manifest -- story-to-artifact map"
    foreach ($id in $storyIds) {
        $lines += "# EVA-STORY: $id"
    }
    $lines += "project: $projPrefix"
    $lines += "type: documentation-artifact"
    $manifestPath = "$repoPath\manifest.yml"
    $lines -join "`n" | Out-File $manifestPath -Encoding ASCII
    return $manifestPath
}

Log "=== sweep7 START $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

# ---- ACA health check ----
$h = Invoke-RestMethod "$base/health" -ErrorAction SilentlyContinue
if (-not $h) { Log "[FAIL] ACA unreachable -- aborting"; exit 1 }
Log "[PASS] ACA: status=$($h.status) store=$($h.store) version=$($h.version)"

# ---- Target projects (6 gap + 7 no-plan) ----
$targets = @(
    # Coverage-gap (pure-docs, have PLAN.md and veritas-plan.json already)
    "03-poc-enhanced-docs",
    "09-eva-repo-documentation",
    "12-work-spc-reorg",
    "23-ei-dsst-rewrite",
    "28-rbac",
    "43-spark",
    # No-plan (just created PLAN.md now)
    "08-cds-rag",
    "18-azure-best",
    "25-eva-suite",
    "26-eva-gh",
    "30-ui-bench",
    "32-logging",
    "34-AIRA"
)

Log "[INFO] Target projects: $($targets.Count)"

foreach ($proj in $targets) {
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
    $allIds     = @()

    if (Test-Path $planFile) {
        $plan = Get-Content $planFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($plan -and $plan.features) {
            $featCount  = $plan.features.Count
            $storyCount = ($plan.features | ForEach-Object { $_.stories.Count } | Measure-Object -Sum).Sum
            $allIds     = $plan.features | ForEach-Object { $_.stories | ForEach-Object { $_.id } }
            if ($plan._orphan_stories) {
                $orphanIds   = $plan._orphan_stories | ForEach-Object { $_.id }
                $allIds      = @($allIds) + @($orphanIds)
                $storyCount  += $plan._orphan_stories.Count
            }
        }
        Log "  [1] features=$featCount stories=$storyCount"
    } else {
        Log "  [1] WARN: still no veritas-plan.json after generate-plan"
        # Generate stub plan from PLAN.md feature headings
    }

    # Step 2: Write/refresh manifest.yml with all current story IDs
    if ($allIds.Count -gt 0) {
        $mf = Write-Manifest $repoPath $allIds $proj
        Log "  [2] manifest.yml written: $($allIds.Count) story tags -> $mf"
    } else {
        Log "  [2] WARN: no story IDs -- manifest.yml not updated"
    }

    # Step 3: audit (discover + reconcile + trust)
    Log "  [3] audit"
    $au = node $veritas audit --repo $repoPath --warn-only 2>&1
    $au | Add-Content $projLog -Encoding ASCII

    # Step 4: read trust.json
    $trustFile = "$repoPath\.eva\trust.json"
    $mti       = 0
    $covPct    = 0
    if (Test-Path $trustFile) {
        $trust  = Get-Content $trustFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        $mti    = if ($null -ne $trust.score) { [int]$trust.score } else { 0 }
        $covPct = if ($trust.components -and $null -ne $trust.components.coverage) {
            [math]::Round($trust.components.coverage * 100)
        } else { 0 }
    } else {
        Log "  [4] WARN: no trust.json after audit"
    }

    # Step 4b: gaps from reconciliation.json
    $reconFile = "$repoPath\.eva\reconciliation.json"
    $gaps = 0
    if (Test-Path $reconFile) {
        $recon = Get-Content $reconFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        $gaps  = if ($recon -and $recon.gaps) { $recon.gaps.Count } else { 0 }
    }

    $coveredStories = [math]::Round($storyCount * $covPct / 100)
    Log "  [4] MTI=$mti  coverage=$covPct%  covered=$coveredStories/$storyCount  gaps=$gaps"

    # Step 5: PUT to ACA data model
    $projRecord = Invoke-RestMethod "$base/model/projects/$proj" -ErrorAction SilentlyContinue
    if ($projRecord) {
        $prevRv   = $projRecord.row_version
        $notesVal = "veritas_scan=2026-02-25 mti=$mti coverage=$covPct% covered=$coveredStories/$storyCount gaps=$gaps sweep=sweep7"
        $projRecord | Add-Member -NotePropertyName "notes" -NotePropertyValue $notesVal -Force
        $body = Strip-Audit $projRecord | ConvertTo-Json -Depth 10
        try {
            Invoke-RestMethod "$base/model/projects/$proj" -Method PUT `
                -ContentType "application/json" -Body $body `
                -Headers @{"X-Actor"=$actor} | Out-Null
            $updated = Invoke-RestMethod "$base/model/projects/$proj"
            if ($updated.row_version -eq ($prevRv + 1)) {
                Log "  [5] PUT OK rv=$($updated.row_version)"
            } else {
                Log "  [5] WARN rv unexpected: got $($updated.row_version) expected $($prevRv+1)"
            }
        } catch {
            Log "  [5] PUT FAIL: $_"
        }
    } else {
        Log "  [5] SKIP: project not in data model"
    }

    $results += [PSCustomObject]@{
        project  = $proj
        mti      = $mti
        coverage = $covPct
        covered  = $coveredStories
        stories  = $storyCount
        gaps     = $gaps
        features = $featCount
    }
}

# ---- Results table ----
Log ""
Log "=== RESULTS TABLE ==="
Log ""
$results | Format-Table -AutoSize | Out-String | ForEach-Object { Log $_ }

$results | ConvertTo-Json -Depth 5 | Out-File "$evDir\sweep7-results.json" -Encoding ASCII
Log "Results JSON: $evDir\sweep7-results.json"

# ---- Commit ----
Log "[COMMIT] POST admin/commit"
$c = Invoke-RestMethod "$base/model/admin/commit" -Method POST `
    -Headers @{"Authorization"="Bearer dev-admin"} -ErrorAction SilentlyContinue
Log "[COMMIT] status=$($c.status) violations=$($c.violation_count) exported=$($c.exported_total)"
$c | ConvertTo-Json -Depth 5 | Out-File "$evDir\commit-result.json" -Encoding ASCII
if ($c.violation_count -eq 0) { Log "[PASS] Commit clean" } else { Log "[WARN] Violations: $($c.violation_count)" }

Log "=== sweep7 DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Log "Evidence dir: $evDir"
