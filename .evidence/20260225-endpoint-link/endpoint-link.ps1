# endpoint-link.ps1
# Links EVA endpoints and screens to WBS story IDs
# Strategy:
#   1. Build service -> project map (hardcoded from known EVA architecture)
#   2. Build app/face -> project map for screens
#   3. For each endpoint/screen: find best matching WBS story by keyword scoring
#   4. Test whether API accepts wbs_id on endpoints (flexible Cosmos schema)
#   5. If wbs_id accepted: PUT on endpoints + screens
#      If not accepted: enrich WBS story notes with endpoint coverage list

$base = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"

Write-Host "[INFO] Fetching data model layers..."
$eps     = Invoke-RestMethod "$base/model/endpoints/" -TimeoutSec 60
$scr     = Invoke-RestMethod "$base/model/screens/"   -TimeoutSec 60
$wbs     = Invoke-RestMethod "$base/model/wbs/"       -TimeoutSec 60
$stories = $wbs | Where-Object { $_.level -eq "story" }

Write-Host "[INFO] eps=$($eps.Count)  scr=$($scr.Count)  wbs_stories=$($stories.Count)"

# ---------------------------------------------------------------------------
# Service -> project_id map (from EVA architecture knowledge)
# ---------------------------------------------------------------------------
$svcProjectMap = @{
    "eva-brain-api"            = "33-eva-brain-v2"
    "eva-control-plane"        = "40-eva-control-plane"
    "eva-jp-spark"             = "44-eva-jp-spark"
    "eva-roles-api"            = "28-rbac"
    "info-assistant-backend"   = "11-ms-infojp"
    "model-api"                = "37-data-model"
    "session-workflow-agent"   = "33-eva-brain-v2"
    "ado-poc"                  = "38-ado-poc"
}

# App/face -> project_id map for screens
$faceProjectMap = @{
    "admin-face"     = "31-eva-faces"
    "ops-face"       = "31-eva-faces"
    "chat-face"      = "44-eva-jp-spark"
    "portal-face"    = "31-eva-faces"
    "admin"          = "31-eva-faces"
    "chat"           = "44-eva-jp-spark"
    "assistant-face" = "44-eva-jp-spark"
    "eva-jp-spark"   = "44-eva-jp-spark"
}

# ---------------------------------------------------------------------------
# Build project -> stories index for fast lookup
# ---------------------------------------------------------------------------
$storyMap = @{}   # project_id -> [story objects]
foreach ($st in $stories) {
    $proj_id = $st.project_id
    if (-not $proj_id) { continue }
    if (-not $storyMap.ContainsKey($proj_id)) {
        $storyMap[$proj_id] = [System.Collections.Generic.List[object]]::new()
    }
    $storyMap[$proj_id].Add($st)
}
Write-Host "[INFO] project->story index: $($storyMap.Count) projects"

# ---------------------------------------------------------------------------
# Keyword match: score how well a WBS item label matches a path/hint
# ---------------------------------------------------------------------------
function Get-MatchScore {
    param([string]$candidate, [string]$query)
    $c     = $candidate.ToLower() -replace '[-_/\{\}]', ' '
    $q     = $query.ToLower()     -replace '[-_/\{\}]', ' '
    $words = $q -split '\s+' | Where-Object { $_.Length -gt 3 } | Select-Object -Unique
    $score = 0
    foreach ($w in $words) {
        if ($c -like "*$w*") { $score++ }
    }
    return $score
}

# Find best WBS story for a given project + hint string
function Find-BestStory {
    param([string]$projectId, [string]$hint)
    if (-not $storyMap.ContainsKey($projectId)) { return $null }
    $candidates = $storyMap[$projectId]
    $best       = $null
    $bestScore  = -1
    foreach ($st in $candidates) {
        $sc = Get-MatchScore -candidate "$($st.label) $($st.id) $($st.notes)" -query $hint
        if ($sc -gt $bestScore) {
            $bestScore = $sc
            $best      = $st
        }
    }
    # Fall back to first story in project if no keyword hit
    if (-not $best -or $bestScore -lt 1) {
        $best = $candidates[0]
    }
    return $best
}

# ---------------------------------------------------------------------------
# Strip audit columns before PUT
# ---------------------------------------------------------------------------
function Strip-Audit {
    param($obj)
    $obj | Select-Object * -ExcludeProperty obj_id, layer, modified_by, modified_at,
        created_by, created_at, row_version, source_file, _cached
}

# ---------------------------------------------------------------------------
# Step 1 -- Test whether endpoints/screens accept wbs_id field
# ---------------------------------------------------------------------------
Write-Host "[INFO] Testing wbs_id field acceptance on endpoints..."
$testEp = $eps | Where-Object { $_.service -eq "eva-brain-api" } | Select-Object -First 1
$testEpCopy = $testEp | Select-Object *
$testEpCopy | Add-Member -MemberType NoteProperty -Name "wbs_id" -Value "TEST-PROBE" -Force
$testBody = Strip-Audit $testEpCopy | ConvertTo-Json -Depth 10
$testId   = [Uri]::EscapeDataString($testEp.id)

$wbs_id_on_endpoint_works = $false
try {
    $put = Invoke-RestMethod "$base/model/endpoints/$testId" `
        -Method PUT -ContentType "application/json" -Body $testBody `
        -Headers @{"X-Actor"="agent:copilot-test"} -ErrorAction Stop
    # Read back and check
    $readBack = Invoke-RestMethod "$base/model/endpoints/$testId" -TimeoutSec 10
    if ($readBack.wbs_id -eq "TEST-PROBE") {
        $wbs_id_on_endpoint_works = $true
        Write-Host "[INFO] wbs_id field ACCEPTED by endpoint layer"
        # Restore (clear probe value)
        $testEpCopy.wbs_id = $null
        $restoreBody = Strip-Audit $testEpCopy | ConvertTo-Json -Depth 10
        Invoke-RestMethod "$base/model/endpoints/$testId" -Method PUT -ContentType "application/json" `
            -Body $restoreBody -Headers @{"X-Actor"="agent:copilot"} | Out-Null
    } else {
        Write-Host "[WARN] wbs_id field NOT persisted on endpoints -- will use notes enrichment"
    }
} catch {
    Write-Host "[WARN] PUT test failed: $($_.Exception.Message) -- will use notes enrichment"
}

# Test screens
Write-Host "[INFO] Testing wbs_id field acceptance on screens..."
$testSc = $scr | Select-Object -First 1
$testScCopy = $testSc | Select-Object *
$testScCopy | Add-Member -MemberType NoteProperty -Name "wbs_id" -Value "TEST-PROBE" -Force
$testScBody = Strip-Audit $testScCopy | ConvertTo-Json -Depth 10
$wbs_id_on_screen_works = $false
try {
    Invoke-RestMethod "$base/model/screens/$($testSc.id)" `
        -Method PUT -ContentType "application/json" -Body $testScBody `
        -Headers @{"X-Actor"="agent:copilot-test"} -ErrorAction Stop | Out-Null
    $readBackSc = Invoke-RestMethod "$base/model/screens/$($testSc.id)" -TimeoutSec 10
    if ($readBackSc.wbs_id -eq "TEST-PROBE") {
        $wbs_id_on_screen_works = $true
        Write-Host "[INFO] wbs_id field ACCEPTED by screens layer"
        $testScCopy.wbs_id = $null
        $restoreSc = Strip-Audit $testScCopy | ConvertTo-Json -Depth 10
        Invoke-RestMethod "$base/model/screens/$($testSc.id)" -Method PUT -ContentType "application/json" `
            -Body $restoreSc -Headers @{"X-Actor"="agent:copilot"} | Out-Null
    } else {
        Write-Host "[WARN] wbs_id NOT persisted on screens -- will use WBS notes enrichment"
    }
} catch {
    Write-Host "[WARN] Screen PUT test failed: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
# Step 2 -- Build coverage map: project -> endpoint/screen IDs
# (used by notes-enrichment fallback)
# ---------------------------------------------------------------------------
$epCoverage  = @{}   # project_id -> [ep ids]
$scrCoverage = @{}   # project_id -> [screen ids]

# Assign endpoints
$linked_eps    = 0
$skipped_eps   = 0
$ep_to_story   = @{}  # ep.id -> story.id (for notes enrichment)

Write-Host "[INFO] Assigning endpoints -> WBS stories..."
foreach ($ep in $eps) {
    $service   = $ep.service
    $projectId = $svcProjectMap[$service]
    if (-not $projectId) {
        Write-Host "[WARN] Unknown service='$service' for ep='$($ep.id)'"
        $skipped_eps++
        continue
    }
    $hint  = "$($ep.path) $($ep.tag) $($ep.summary)"
    $story = Find-BestStory -projectId $projectId -hint $hint
    if (-not $story) {
        Write-Host "[WARN] No story found for project='$projectId' ep='$($ep.id)'"
        $skipped_eps++
        continue
    }
    $ep_to_story[$ep.id] = $story.id

    if (-not $epCoverage.ContainsKey($story.id)) {
        $epCoverage[$story.id] = [System.Collections.Generic.List[string]]::new()
    }
    $epCoverage[$story.id].Add($ep.id)

    if ($wbs_id_on_endpoint_works) {
        $epCopy = $ep | Select-Object *
        $epCopy | Add-Member -MemberType NoteProperty -Name "wbs_id" -Value $story.id -Force
        $body   = Strip-Audit $epCopy | ConvertTo-Json -Depth 10
        $epId   = [Uri]::EscapeDataString($ep.id)
        try {
            Invoke-RestMethod "$base/model/endpoints/$epId" -Method PUT -ContentType "application/json" `
                -Body $body -Headers @{"X-Actor"="agent:copilot"} | Out-Null
            $linked_eps++
        } catch {
            Write-Host "[ERR] ep PUT failed: $($ep.id) -> $($_.Exception.Message)"
        }
    } else {
        $linked_eps++   # counted as logically linked even if stored on WBS side
    }
}

Write-Host "[INFO] Assigning screens -> WBS stories..."
$linked_scr  = 0
$skipped_scr = 0
$scr_to_story = @{}

foreach ($sc in $scr) {
    # Derive project from app or face field
    $projectId = $null
    $appVal    = if ($sc.app)  { $sc.app }  else { "" }
    $faceVal   = if ($sc.face) { $sc.face } else { "" }

    foreach ($key in $faceProjectMap.Keys) {
        if ($appVal -like "*$key*" -or $faceVal -like "*$key*") {
            $projectId = $faceProjectMap[$key]
            break
        }
    }
    if (-not $projectId) {
        # Fallback: if app contains project number pattern (e.g. "31-something")
        if ($appVal -match '^(\d+)-') {
            $num = $Matches[1].PadLeft(2, '0')
            $projectId = ($wbs | Where-Object { $_.project_id -like "$num-*" } | Select-Object -First 1).project_id
        }
    }
    if (-not $projectId) {
        Write-Host "[WARN] Cannot resolve project for screen='$($sc.id)' app='$appVal' face='$faceVal'"
        $skipped_scr++
        continue
    }

    $hint  = "$($sc.id) $($sc.label_en) $($sc.route)"
    $story = Find-BestStory -projectId $projectId -hint $hint
    if (-not $story) {
        Write-Host "[WARN] No story for project='$projectId' screen='$($sc.id)'"
        $skipped_scr++
        continue
    }
    $scr_to_story[$sc.id] = $story.id

    if (-not $scrCoverage.ContainsKey($story.id)) {
        $scrCoverage[$story.id] = [System.Collections.Generic.List[string]]::new()
    }
    $scrCoverage[$story.id].Add($sc.id)

    if ($wbs_id_on_screen_works) {
        $scCopy = $sc | Select-Object *
        $scCopy | Add-Member -MemberType NoteProperty -Name "wbs_id" -Value $story.id -Force
        $body   = Strip-Audit $scCopy | ConvertTo-Json -Depth 10
        try {
            Invoke-RestMethod "$base/model/screens/$($sc.id)" -Method PUT -ContentType "application/json" `
                -Body $body -Headers @{"X-Actor"="agent:copilot"} | Out-Null
            $linked_scr++
        } catch {
            Write-Host "[ERR] screen PUT failed: $($sc.id) -> $($_.Exception.Message)"
        }
    } else {
        $linked_scr++
    }
}

# ---------------------------------------------------------------------------
# Step 3 -- Enrich WBS story notes with endpoint/screen coverage
# (always run -- adds coverage list to story notes regardless of wbs_id field)
# ---------------------------------------------------------------------------
Write-Host "[INFO] Enriching WBS story notes with endpoint/screen coverage..."
$enriched = 0
$enrich_errors = 0

# Merge coverage keys
$allStoryIds = ($epCoverage.Keys + $scrCoverage.Keys) | Select-Object -Unique

foreach ($storyId in $allStoryIds) {
    $story = $stories | Where-Object { $_.id -eq $storyId } | Select-Object -First 1
    if (-not $story) { continue }

    $prev_rv = $story.row_version

    $eps_list  = if ($epCoverage.ContainsKey($storyId))  { $epCoverage[$storyId]  -join "; " } else { "" }
    $scrs_list = if ($scrCoverage.ContainsKey($storyId)) { $scrCoverage[$storyId] -join "; " } else { "" }

    $coverage_note = ""
    if ($eps_list)  { $coverage_note += " endpoints=[$eps_list]" }
    if ($scrs_list) { $coverage_note += " screens=[$scrs_list]" }

    # Append to existing notes (avoid duplicating on re-run)
    $existingNotes = if ($story.notes) { $story.notes } else { "" }
    # Remove old coverage annotation if present
    $cleanNotes = $existingNotes -replace ' endpoints=\[.*?\]', '' -replace ' screens=\[.*?\]', ''
    $newNotes   = ($cleanNotes + $coverage_note).Trim()

    $stCopy = $story | Select-Object *
    $stCopy.notes = $newNotes

    $body = Strip-Audit $stCopy | ConvertTo-Json -Depth 10
    try {
        Invoke-RestMethod "$base/model/wbs/$storyId" -Method PUT -ContentType "application/json" `
            -Body $body -Headers @{"X-Actor"="agent:copilot"} | Out-Null
        $enriched++
    } catch {
        Write-Host "[ERR] WBS story notes update failed: $storyId -> $($_.Exception.Message)"
        $enrich_errors++
    }
}

# ---------------------------------------------------------------------------
# Commit
# ---------------------------------------------------------------------------
Write-Host "[INFO] Committing..."
$c = Invoke-RestMethod "$base/model/admin/commit" -Method POST `
    -Headers @{"Authorization"="Bearer dev-admin"} -TimeoutSec 60

Write-Host ""
Write-Host "=== ENDPOINT LINK COMPLETE ==="
Write-Host "  wbs_id_on_endpoints : $wbs_id_on_endpoint_works"
Write-Host "  wbs_id_on_screens   : $wbs_id_on_screen_works"
Write-Host "  linked_eps          : $linked_eps  (skipped=$skipped_eps)"
Write-Host "  linked_scr          : $linked_scr  (skipped=$skipped_scr)"
Write-Host "  wbs_stories_enriched: $enriched  (errors=$enrich_errors)"
Write-Host "  commit_violations   : $($c.violation_count)"
Write-Host "  commit_exported     : $($c.exported_total)"
Write-Host "  commit_errors       : $($c.export_errors.Count)"
if ($c.violation_count -eq 0 -and $c.export_errors.Count -eq 0) {
    Write-Host "[PASS] Commit clean"
} else {
    Write-Host "[FAIL] Check violations"
    $c | ConvertTo-Json -Depth 3
}

# ---------------------------------------------------------------------------
# Output summary table
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== LINKAGE SUMMARY BY PROJECT ==="
$summaryProjects = ($svcProjectMap.Values + @("31-eva-faces","44-eva-jp-spark")) | Select-Object -Unique
foreach ($sproj in $summaryProjects) {
    $epCount    = ($eps | Where-Object { $svcProjectMap[$_.service] -eq $sproj }).Count
    $scrCount   = ($scr | Where-Object {
        $appVal  = if ($_.app)  { $_.app }  else { "" }
        $faceVal = if ($_.face) { $_.face } else { "" }
        $resolved = $null
        foreach ($k in $faceProjectMap.Keys) {
            if ($appVal -like "*$k*" -or $faceVal -like "*$k*") { $resolved = $faceProjectMap[$k]; break }
        }
        $resolved -eq $sproj
    }).Count
    $storyCount = if ($storyMap.ContainsKey($sproj)) { $storyMap[$sproj].Count } else { 0 }
    Write-Host "  $sproj : eps=$epCount  scr=$scrCount  stories=$storyCount"
}
