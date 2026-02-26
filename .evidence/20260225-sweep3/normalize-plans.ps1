# normalize-plans.ps1
# Phase 1 of plan-normalizer sweep.
# For every project that has .eva/veritas-plan.json (written by sweep3):
#   1. Read the structured plan (features + stories with generated IDs)
#   2. Back up existing PLAN.md as PLAN.md.bak
#   3. Write a new PLAN.md in veritas-native format:
#        ## Feature: <title> [ID=F33-01]
#        ### Story: <title> [ID=F33-01-001]
#   4. Write per-project output to run log
# Result: next veritas audit sees format="veritas" and picks up every story.
#
# Run:
#   pwsh normalize-plans.ps1 2>&1 | Out-File normalize.log -Encoding ASCII

$evDir  = "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep3"
$report = @()

function Build-PlanMd ($plan) {
    $lines = @()
    $lines += "# Project Plan"
    $lines += ""
    $lines += "<!-- veritas-normalized 2026-02-25 prefix=$($plan.prefix) source=$($plan.generated_from -join ',') -->"
    $lines += ""

    foreach ($feat in $plan.features) {
        $lines += "## Feature: $($feat.title) [ID=$($feat.id)]"
        $lines += ""

        foreach ($story in $feat.stories) {
            $lines += "### Story: $($story.title) [ID=$($story.id)]"
            $lines += ""

            foreach ($task in $story.tasks) {
                $lines += "- [ ] $($task.title) [ID=$($task.id)]"
            }
            if ($story.tasks.Count -gt 0) { $lines += "" }
        }
    }

    # Orphan stories (feature-less, from OpenAPI / code-structure enrichment)
    if ($plan._orphan_stories -and $plan._orphan_stories.Count -gt 0) {
        $lines += "## Feature: Discovered [ID=$($plan.prefix)-99]"
        $lines += ""
        foreach ($story in $plan._orphan_stories) {
            $lines += "### Story: $($story.title) [ID=$($story.id)]"
            $lines += ""
        }
    }

    return $lines -join "`n"
}

$projects = Get-ChildItem "C:\AICOE\eva-foundation" -Directory |
    Where-Object { $_.Name -match '^\d{2}-' } |
    Sort-Object Name |
    Select-Object -ExpandProperty Name

Write-Host "[INFO] Projects: $($projects.Count)"

foreach ($proj in $projects) {
    $repoPath  = "C:\AICOE\eva-foundation\$proj"
    $planJson  = "$repoPath\.eva\veritas-plan.json"
    $planMd    = "$repoPath\PLAN.md"

    if (-not (Test-Path $planJson)) {
        Write-Host "[$proj] SKIP  no veritas-plan.json"
        $report += [PSCustomObject]@{ project=$proj; status="skip"; features=0; stories=0 }
        continue
    }

    $plan = Get-Content $planJson -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (-not $plan) {
        Write-Host "[$proj] SKIP  invalid JSON"
        $report += [PSCustomObject]@{ project=$proj; status="skip"; features=0; stories=0 }
        continue
    }

    $featCount  = if ($plan.features) { $plan.features.Count } else { 0 }
    $storyCount = if ($plan.features) { ($plan.features | ForEach-Object { $_.stories.Count } | Measure-Object -Sum).Sum } else { 0 }
    $orphanCount = if ($plan._orphan_stories) { $plan._orphan_stories.Count } else { 0 }
    $totalStories = $storyCount + $orphanCount

    if ($featCount -eq 0 -and $totalStories -eq 0) {
        Write-Host "[$proj] SKIP  empty plan (no features or stories)"
        $report += [PSCustomObject]@{ project=$proj; status="empty"; features=0; stories=0 }
        continue
    }

    # Backup existing PLAN.md
    if (Test-Path $planMd) {
        Copy-Item $planMd "$planMd.bak" -Force
        Write-Host "[$proj] backed up PLAN.md"
    }

    # Write normalized PLAN.md
    $content = Build-PlanMd $plan
    # Enforce ASCII -- strip any non-ASCII codepoints before writing
    $content = [System.Text.RegularExpressions.Regex]::Replace($content, '[^\x00-\x7F]', '?')
    [System.IO.File]::WriteAllText($planMd, $content, [System.Text.Encoding]::ASCII)

    Write-Host "[$proj] OK   features=$featCount stories=$totalStories"
    $report += [PSCustomObject]@{ project=$proj; status="ok"; features=$featCount; stories=$totalStories }
}

Write-Host ""
Write-Host "=== NORMALIZE SUMMARY ==="
$report | Format-Table -AutoSize | Out-String | Write-Host
$ok    = ($report | Where-Object { $_.status -eq "ok" }).Count
$empty = ($report | Where-Object { $_.status -eq "empty" }).Count
$skip  = ($report | Where-Object { $_.status -eq "skip" }).Count
Write-Host "Normalized: $ok   Empty/skipped: $($empty + $skip)"

$report | ConvertTo-Json -Depth 5 | Out-File "$evDir\normalize-report.json" -Encoding ASCII
Write-Host "Report: $evDir\normalize-report.json"
