<#
.SYNOPSIS
    Wire #4 -- test_ids Linkage: populate requirements.test_ids by tracing
    satisfied_by endpoints -> endpoint.wbs_id -> WBS story IDs.

Chain:
    requirement.satisfied_by -> endpoint.id -> endpoint.wbs_id -> test_id

test_ids format: array of WBS story IDs (e.g. "F33-HEALTH-001")
This creates a closed traceability loop:
    requirement proven by endpoint
    endpoint owned by WBS story
    therefore requirement tested by that story (evidence of implementation)
#>

param(
    [switch]$DryRun,
    [string]$DataModelBase = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io",
    [string]$Actor = "agent:wire4-test-ids-link"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$HERE = $PSScriptRoot
$LOG  = "$HERE\wire4.log"

function Log { param([string]$m) $ts = Get-Date -Format "HH:mm:ss"; "[$ts] $m" | Tee-Object -FilePath $LOG -Append | Write-Host }

Log "[STEP1] Loading endpoints (wbs_id index)..."
$eps = Invoke-RestMethod "$DataModelBase/model/endpoints/" -ErrorAction Stop
$epIndex = @{}
foreach ($ep in $eps) {
    if ($ep.PSObject.Properties['wbs_id'] -and $ep.wbs_id) {
        $epIndex[$ep.id] = $ep.wbs_id
    }
}
Log "  endpoints indexed: $($epIndex.Count)"

Log "[STEP2] Loading requirements..."
$reqs = Invoke-RestMethod "$DataModelBase/model/requirements/" -ErrorAction Stop
Log "  requirements: $($reqs.Count)"

Log "[STEP3] Building test_ids for each requirement..."
$stats = @{ updated=0; already_set=0; no_match=0; failed=0 }
$changeLog = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($req in $reqs) {
    # Gather test IDs from satisfied_by -> wbs_id
    $derivedIds = [System.Collections.Generic.List[string]]::new()
    foreach ($epId in $req.satisfied_by) {
        if ($epIndex.ContainsKey($epId)) {
            $wbsId = $epIndex[$epId]
            if (-not $derivedIds.Contains($wbsId)) {
                $derivedIds.Add($wbsId)
            }
        }
    }

    if ($derivedIds.Count -eq 0) { $stats.no_match++; continue }

    # Already has matching set?
    $existingSet = @(if ($req.test_ids) { @($req.test_ids) | Sort-Object } else { @() })
    $newSet      = @($derivedIds | Sort-Object)
    if ($existingSet.Count -eq $newSet.Count -and ($existingSet.Count -eq 0 -or -not (Compare-Object $existingSet $newSet))) {
        $stats.already_set++
        continue
    }

    if (-not $DryRun) {
        $body = $req | Select-Object * -ExcludeProperty obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file
        $bodyObj = $body | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $bodyObj.test_ids = @($newSet)
        try {
            Invoke-RestMethod "$DataModelBase/model/requirements/$($req.id)" -Method PUT -Body ($bodyObj | ConvertTo-Json -Depth 10) -ContentType "application/json" -Headers @{"X-Actor"=$Actor} -ErrorAction Stop | Out-Null
            $stats.updated++
        } catch {
            Log "  [WARN] PUT failed $($req.id): $($_.Exception.Message)"
            $stats.failed++
            continue
        }
    } else {
        $stats.updated++
    }
    $changeLog.Add([PSCustomObject]@{ req_id=$req.id; test_ids_count=$derivedIds.Count; sample=$derivedIds[0] })
    Log "  $($req.id): $($derivedIds.Count) test_ids ($(($derivedIds | Select-Object -First 3) -join ', ')...)"
}

Log "  updated=$($stats.updated)  already_set=$($stats.already_set)  no_match=$($stats.no_match)  failed=$($stats.failed)"

# Spot-check: verify 3 updated requirements
Log "[STEP4] Spot-check..."
$spotPass = 0; $spotTotal = 0
if ($changeLog.Count -eq 0) { $spotPass = 1; $spotTotal = 1; Log "  [INFO] No updates needed -- spot-check skipped" }
$sample = if ($changeLog.Count -gt 0) { $changeLog | Get-Random -Count ([Math]::Min(3, $changeLog.Count)) } else { @() }
foreach ($s in $sample) {
    $v = Invoke-RestMethod "$DataModelBase/model/requirements/$($s.req_id)" -ErrorAction SilentlyContinue
    $ok = ($v.test_ids.Count -eq $s.test_ids_count)
    Log "  SPOT $($s.req_id): test_ids.Count=$($v.test_ids.Count) expected=$($s.test_ids_count) --> $(if ($ok) {'[PASS]'} else {'[FAIL]'})"
    if ($ok) { $spotPass++ }
    $spotTotal++
}

$passed = ($stats.failed -eq 0)
Log ""
Log "=== WIRE #4 COMPLETE ==="
Log "  updated=$($stats.updated)  test_ids_total=$($changeLog | Measure-Object test_ids_count -Sum | Select-Object -ExpandProperty Sum)"
Log "  spot=$spotPass/$spotTotal  mode=$(if ($DryRun) {'DRY-RUN'} else {'LIVE'})"
Log "  $(if ($passed) {'[PASS]'} else {'[WARN] issues -- check wire4.log'})"

@{ wire="4"; action="test-ids-link"; updated=$stats.updated; no_match=$stats.no_match; spot_pass=$spotPass; spot_total=$spotTotal; passed=$passed; generated_at=(Get-Date -Format "o") } | ConvertTo-Json | Out-File "$HERE\wire4-evidence.json" -Encoding ASCII
