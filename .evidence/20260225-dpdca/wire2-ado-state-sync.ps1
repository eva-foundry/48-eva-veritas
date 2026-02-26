<#
.SYNOPSIS
    Wire #2 -- ADO State Sync: pull live ADO state for every WBS record with ado_id
    and update WBS status accordingly.

ADO state -> WBS status mapping:
    "To Do", "New", "Open"              -> planned
    "In Progress", "Active", "Committed"-> in-progress
    "Done", "Closed", "Resolved"        -> done
    "Removed"                           -> cancelled
    everything else                     -> no change (warn)
#>

param(
    [switch]$DryRun,
    [string]$DataModelBase = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io",
    [string]$CpBase = "http://localhost:8020",
    [string]$AdoOrg = "https://dev.azure.com/marcopresta",
    [string]$AdoProject = "eva-poc",
    [string]$Actor = "agent:wire2-ado-state-sync"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$HERE = $PSScriptRoot
$LOG  = "$HERE\wire2.log"

function Log { param([string]$m) $ts = Get-Date -Format "HH:mm:ss"; "[$ts] $m" | Tee-Object -FilePath $LOG -Append | Write-Host }
function ADO-Headers {
    $enc = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$($env:ADO_PAT)"))
    return @{ Authorization = "Basic $enc"; "Content-Type" = "application/json" }
}

# State map
$stateMap = @{
    "To Do"       = "planned"
    "New"         = "planned"
    "Open"        = "planned"
    "In Progress" = "in-progress"
    "Active"      = "in-progress"
    "Committed"   = "in-progress"
    "Done"        = "done"
    "Closed"      = "done"
    "Resolved"    = "done"
    "Removed"     = "cancelled"
}

if (-not $env:ADO_PAT) {
    Log "[INFO] Fetching ADO_PAT from Key Vault..."
    $env:ADO_PAT = az keyvault secret show --vault-name evachatkv --name ADO-PAT --query value -o tsv
}
Log "[PASS] ADO_PAT ready ($($env:ADO_PAT.Length) chars)"

# 1 -- GET all WBS records that have ado_id
Log "[STEP1] Loading WBS records with ado_id..."
$allWbs = Invoke-RestMethod "$DataModelBase/model/wbs/" -ErrorAction Stop
$linked = $allWbs | Where-Object { $_.PSObject.Properties['ado_id'] -and $_.ado_id }
Log "  WBS total=$($allWbs.Count)  with ado_id=$($linked.Count)"

# 2 -- Batch GET ADO states (200 per batch) - only need Id + State
Log "[STEP2] Fetching ADO states in batches..."
$adoIds = $linked | ForEach-Object { $_.ado_id }
$stateById = @{}
$batchSize = 200
for ($i = 0; $i -lt $adoIds.Count; $i += $batchSize) {
    $batch = $adoIds[$i..([Math]::Min($i + $batchSize - 1, $adoIds.Count - 1))]
    $body  = @{ ids = $batch; fields = @("System.Id","System.State") } | ConvertTo-Json -Depth 5
    $url   = "$AdoOrg/$AdoProject/_apis/wit/workitemsbatch?api-version=7.1"
    $resp  = Invoke-RestMethod $url -Method POST -Body $body -Headers (ADO-Headers) -ErrorAction Stop
    foreach ($wi in $resp.value) {
        $stateById[[int]$wi.id] = $wi.fields."System.State"
    }
    Log "  batch $([Math]::Floor($i/$batchSize)+1): $($resp.value.Count) items"
}
Log "  ADO states fetched: $($stateById.Count)"

# 3 -- Sync WBS status
Log "[STEP3] Syncing WBS status..."
$stats = @{ updated=0; unchanged=0; unmapped=0; failed=0 }
$changeLog = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($rec in $linked) {
    $adoState = $stateById[[int]$rec.ado_id]
    if (-not $adoState) { $stats.unchanged++; continue }

    $newStatus = $stateMap[$adoState]
    if (-not $newStatus) {
        Log "  [WARN] Unknown ADO state '$adoState' on ado_id=$($rec.ado_id) wbs=$($rec.id)"
        $stats.unmapped++
        continue
    }

    if ($rec.status -eq $newStatus) { $stats.unchanged++; continue }

    if (-not $DryRun) {
        $body = $rec | Select-Object * -ExcludeProperty obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file
        $bodyObj = $body | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $bodyObj.status = $newStatus
        try {
            Invoke-RestMethod "$DataModelBase/model/wbs/$($rec.id)" -Method PUT -Body ($bodyObj | ConvertTo-Json -Depth 10) -ContentType "application/json" -Headers @{"X-Actor"=$Actor} -ErrorAction Stop | Out-Null
            $stats.updated++
        } catch {
            Log "  [WARN] PUT failed $($rec.id): $($_.Exception.Message)"
            $stats.failed++
            continue
        }
    } else {
        $stats.updated++
    }
    $changeLog.Add([PSCustomObject]@{ wbs_id=$rec.id; ado_id=$rec.ado_id; old_status=$rec.status; new_status=$newStatus; ado_state=$adoState })
}

Log "  updated=$($stats.updated)  unchanged=$($stats.unchanged)  unmapped=$($stats.unmapped)  failed=$($stats.failed)"

# 4 -- Spot-check 5 updated records (only if there were changes)
$spotPass = 0; $spotTotal = 0
if ($changeLog.Count -eq 0) {
    Log "  [INFO] No status changes needed -- all WBS statuses already match ADO states"
    $spotPass = 1; $spotTotal = 1
}
$sample = if ($changeLog.Count -gt 0) { $changeLog | Get-Random -Count ([Math]::Min(5, $changeLog.Count)) } else { @() }
foreach ($s in $sample) {
    $v = Invoke-RestMethod "$DataModelBase/model/wbs/$($s.wbs_id)" -ErrorAction SilentlyContinue
    $ok = ($v.status -eq $s.new_status)
    Log "  SPOT $($s.wbs_id): status=$($v.status) expected=$($s.new_status) --> $(if ($ok) {'[PASS]'} else {'[FAIL]'})"
    if ($ok) { $spotPass++ }
    $spotTotal++
}

$passed = ($stats.failed -eq 0) -and ($spotPass -eq $spotTotal)
Log ""
Log "=== WIRE #2 COMPLETE ==="
Log "  updated=$($stats.updated)  spot=$spotPass/$spotTotal  mode=$(if ($DryRun) {'DRY-RUN'} else {'LIVE'})"
Log "  $(if ($passed) {'[PASS]'} else {'[WARN] issues -- check wire2.log'})"

# Write evidence snippet
@{ wire="2"; action="ado-state-sync"; updated=$stats.updated; unchanged=$stats.unchanged; spot_pass=$spotPass; spot_total=$spotTotal; passed=$passed; generated_at=(Get-Date -Format "o") } | ConvertTo-Json | Out-File "$HERE\wire2-evidence.json" -Encoding ASCII
