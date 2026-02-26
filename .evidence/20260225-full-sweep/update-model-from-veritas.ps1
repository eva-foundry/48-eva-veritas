# update-model-from-veritas.ps1
# Reads .eva/trust.json + .eva/reconciliation.json from each numbered project
# and pushes the findings into the EVA data model projects layer.
# Run AFTER scan-portfolio completes.
#
# Usage: pwsh update-model-from-veritas.ps1 [-DryRun]
param([switch]$DryRun)

$base = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"
$portfolioRoot = "C:\AICOE\eva-foundation"
$evDir = "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-full-sweep"
$scanDate = (Get-Date).ToString("yyyy-MM-dd")

$results = [System.Collections.Generic.List[hashtable]]::new()

$projectDirs = Get-ChildItem $portfolioRoot -Directory |
    Where-Object { $_.Name -match "^\d{2}-" } |
    Sort-Object Name

"[INFO] Processing $($projectDirs.Count) project folders -- DryRun=$DryRun"

foreach ($dir in $projectDirs) {
    $name = $dir.Name
    $evaDir = Join-Path $dir.FullName ".eva"
    $trustFile = Join-Path $evaDir "trust.json"
    $reconFile = Join-Path $evaDir "reconciliation.json"

    if (-not (Test-Path $trustFile)) {
        "[WARN] $name -- no .eva/trust.json (scan may not have reached this project)"
        $results.Add(@{ name=$name; status="SKIP"; reason="no-trust-json" })
        continue
    }

    try {
        $trust = Get-Content $trustFile -Raw | ConvertFrom-Json
    } catch {
        "[WARN] $name -- trust.json parse error: $($_.Exception.Message)"
        $results.Add(@{ name=$name; status="SKIP"; reason="parse-error" })
        continue
    }

    $score        = $trust.score
    $actions      = if ($trust.actions) { ($trust.actions -join ",") } else { "" }
    $storiesTotal = 0
    $storiesDone  = 0
    $gapsCount    = 0

    if (Test-Path $reconFile) {
        try {
            $recon = Get-Content $reconFile -Raw | ConvertFrom-Json
            $storiesTotal = [int]($recon.coverage.stories_total ?? 0)
            $storiesDone  = [int]($recon.coverage.stories_with_artifacts ?? 0)
            $gapsCount    = ($recon.gaps | Where-Object { $_.type -ne "orphan_story_tag" } | Measure-Object).Count
        } catch { }
    }

    $scoreStr  = if ($score -ne $null) { [string]$score } else { "null" }
    $notesStr  = "veritas_scan=$scanDate mti=$scoreStr gaps=$gapsCount coverage=$storiesDone/$storiesTotal actions=$actions"

    if ($DryRun) {
        "[DRY] $name -- notes=$notesStr"
        $results.Add(@{ name=$name; status="DRY"; notes=$notesStr })
        continue
    }

    # GET current record
    try {
        $proj = Invoke-RestMethod "$base/model/projects/$name" -ErrorAction Stop
    } catch {
        "[WARN] $name -- not found in data model (new project?): $($_.Exception.Message)"
        $results.Add(@{ name=$name; status="WARN"; reason="not-in-model" })
        continue
    }

    $prevRv = $proj.row_version
    $proj.notes = $notesStr

    # Build PUT body (strip audit fields)
    $body = $proj |
        Select-Object * -ExcludeProperty obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file |
        ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod "$base/model/projects/$name" -Method PUT `
            -ContentType "application/json" -Body $body `
            -Headers @{ "X-Actor"="agent:veritas-sweep" } -ErrorAction Stop | Out-Null

        # Verify row_version incremented
        $verify = Invoke-RestMethod "$base/model/projects/$name"
        if ($verify.row_version -eq ($prevRv + 1)) {
            "[PASS] $name mti=$scoreStr gaps=$gapsCount rv=$($verify.row_version)"
            $results.Add(@{ name=$name; status="PASS"; mti=$scoreStr; gaps=$gapsCount; rv=$verify.row_version })
        } else {
            "[FAIL] $name -- rv check failed (expected $($prevRv+1) got $($verify.row_version))"
            $results.Add(@{ name=$name; status="FAIL"; reason="rv-mismatch" })
        }
    } catch {
        "[FAIL] $name -- PUT failed: $($_.Exception.Message)"
        $results.Add(@{ name=$name; status="FAIL"; reason=$_.Exception.Message })
    }
}

# Commit
if (-not $DryRun) {
    "[INFO] Running commit..."
    try {
        $c = Invoke-RestMethod "$base/model/admin/commit" -Method POST `
            -Headers @{ "Authorization"="Bearer dev-admin" } -ErrorAction Stop
        "[INFO] commit status=$($c.status) violations=$($c.violation_count)"
        $commitStatus = $c.status
        $commitViolations = $c.violation_count
    } catch {
        "[WARN] commit failed: $($_.Exception.Message)"
        $commitStatus = "ERROR"
        $commitViolations = -1
    }
} else {
    $commitStatus = "DRY"
    $commitViolations = 0
}

# Summary
$pass  = ($results | Where-Object { $_.status -eq "PASS" }).Count
$fail  = ($results | Where-Object { $_.status -eq "FAIL" }).Count
$skip  = ($results | Where-Object { $_.status -in "SKIP","WARN" }).Count

""
"===================================="
"EVA Model Update -- Summary"
"===================================="
"PASS=$pass  FAIL=$fail  SKIP=$skip  TOTAL=$($results.Count)"
"Commit: $commitStatus violations=$commitViolations"
"===================================="

# Save evidence
$evidence = @{
    run_at             = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
    dry_run            = $DryRun.IsPresent
    projects_processed = $results.Count
    pass               = $pass
    fail               = $fail
    skip               = $skip
    commit_status      = $commitStatus
    commit_violations  = $commitViolations
    results            = $results
}
$evidence | ConvertTo-Json -Depth 10 | Out-File "$evDir\model-update-results.json" -Encoding ASCII
"[INFO] Evidence saved to $evDir\model-update-results.json"
