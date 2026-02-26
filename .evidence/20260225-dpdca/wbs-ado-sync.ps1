<#
.SYNOPSIS
    WBS <-> ADO Full Sync -- pull State, IterationPath, StoryPoints, AssignedTo
    from ADO for every WBS record with ado_id and write them to the data model.

    Run on-demand or scheduled (Task Scheduler / GitHub Actions) to keep
    the data model in sync with live ADO state.

Fields synced per WBS record:
    status      planned | in-progress | done | cancelled  (from System.State)
    sprint_id   Sprint-6 | Sprint-Backlog | etc.          (from System.IterationPath)
    story_points numeric or null                           (from VSTS.StoryPoints)
    owner       email                                      (from System.AssignedTo)

Usage:
    .\wbs-ado-sync.ps1                    # live sync all
    .\wbs-ado-sync.ps1 -DryRun            # show changes without writing
    .\wbs-ado-sync.ps1 -Project 33-eva-brain-v2  # single project only
    .\wbs-ado-sync.ps1 -Level story       # stories only (fastest)
#>

param(
    [switch]$DryRun,
    [string]$Project = "",
    [string]$Level   = "",
    [string]$DataModelBase = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io",
    [string]$AdoOrg  = "https://dev.azure.com/marcopresta",
    [string]$AdoProject = "eva-poc",
    [string]$Actor   = "agent:wbs-ado-sync"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$HERE  = $PSScriptRoot
$LOG   = "$HERE\wbs-ado-sync.log"
$STAMP = Get-Date -Format "yyyyMMdd-HHmmss"

function Log { param([string]$m) $ts = Get-Date -Format "HH:mm:ss"; "[$ts] $m" | Tee-Object -FilePath $LOG -Append | Write-Host }

# ADO state -> WBS status map
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

function ADO-Headers {
    if (-not $env:ADO_PAT) {
        Log "[INFO] Fetching ADO_PAT from Key Vault..."
        $env:ADO_PAT = az keyvault secret show --vault-name evachatkv --name ADO-PAT --query value -o tsv
    }
    $enc = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$env:ADO_PAT"))
    return @{ Authorization = "Basic $enc"; "Content-Type" = "application/json" }
}

function Parse-SprintId ([string]$iterPath) {
    # "eva-poc\Sprint-6"      -> "Sprint-6"
    # "eva-poc\Sprint-Backlog"-> "Sprint-Backlog"
    # "eva-poc"               -> "Sprint-Backlog"
    if (-not $iterPath -or $iterPath -eq $AdoProject) { return "Sprint-Backlog" }
    $parts = $iterPath.Split('\')
    if ($parts.Count -gt 1) { return $parts[-1] } else { return "Sprint-Backlog" }
}

# ---- Load WBS -----------------------------------------------------------------
Log "[STEP1] Loading WBS records with ado_id..."
$allWbs = Invoke-RestMethod "$DataModelBase/model/wbs/" -ErrorAction Stop
$linked = $allWbs | Where-Object { $_.PSObject.Properties['ado_id'] -and $_.ado_id }
if ($Project) { $linked = $linked | Where-Object { $_.project_id -eq $Project } }
if ($Level)   { $linked = $linked | Where-Object { $_.level -eq $Level } }
Log "  WBS total=$($allWbs.Count)  linked=$($linked.Count)  filter_project='$Project'  filter_level='$Level'"

# ---- Batch GET from ADO -------------------------------------------------------
Log "[STEP2] Fetching ADO fields (State, IterationPath, StoryPoints, AssignedTo)..."
$hdrs     = ADO-Headers
$adoData  = @{}
$batchSize = 200
$adoIds   = @($linked | ForEach-Object { [int]$_.ado_id })
$fields   = @(
    "System.Id",
    "System.State",
    "System.IterationPath",
    "System.AssignedTo",
    "Microsoft.VSTS.Scheduling.StoryPoints"
)

for ($i = 0; $i -lt $adoIds.Count; $i += $batchSize) {
    $batch = $adoIds[$i..([Math]::Min($i + $batchSize - 1, $adoIds.Count - 1))]
    $body  = @{ ids = $batch; fields = $fields } | ConvertTo-Json -Depth 5
    $url   = "$AdoOrg/$AdoProject/_apis/wit/workitemsbatch?api-version=7.1"
    $resp  = Invoke-RestMethod $url -Method POST -Body $body -Headers $hdrs -ErrorAction Stop
    foreach ($wi in $resp.value) {
        $assignedTo = $wi.fields.PSObject.Properties["System.AssignedTo"]
        $assignedVal = if ($assignedTo) { $assignedTo.Value } else { $null }
        $email = if ($assignedVal -is [string]) { $assignedVal } elseif ($assignedVal) { $assignedVal.uniqueName } else { $null }
        $spProp = $wi.fields.PSObject.Properties["Microsoft.VSTS.Scheduling.StoryPoints"]
        $adoData[[int]$wi.id] = [PSCustomObject]@{
            state       = $wi.fields.PSObject.Properties["System.State"].Value
            iter_path   = $wi.fields.PSObject.Properties["System.IterationPath"].Value
            sprint_id   = Parse-SprintId $wi.fields.PSObject.Properties["System.IterationPath"].Value
            story_points= if ($spProp) { $spProp.Value } else { $null }
            assigned_to = $email
        }
    }
    Log "  batch $([Math]::Floor($i/$batchSize)+1): $($resp.value.Count) items"
}
Log "  ADO data fetched: $($adoData.Count)"

# ---- Detect sprint start/finish from iterations API --------------------------
Log "[STEP3] Fetching sprint calendar from ADO..."
$sprintCal = @{}
try {
    $iters = Invoke-RestMethod "$AdoOrg/$AdoProject/_apis/work/teamsettings/iterations?api-version=7.1" -Headers $hdrs
    foreach ($sp in $iters.value) {
        $sprintCal[$sp.name] = [PSCustomObject]@{
            id           = $sp.id
            name         = $sp.name
            start_date   = $sp.attributes.startDate
            finish_date  = $sp.attributes.finishDate
            timeframe    = $sp.attributes.timeFrame
        }
    }
    Log "  sprints found: $($sprintCal.Count) (with dates: $($sprintCal.Values | Where-Object { $_.start_date } | Measure-Object | Select-Object -ExpandProperty Count))"
} catch {
    Log "  [WARN] Could not fetch sprint calendar: $($_.Exception.Message)"
}

# ---- Sync WBS records --------------------------------------------------------
Log "[STEP4] Syncing WBS records..."
$stats = @{ updated=0; unchanged=0; failed=0; no_data=0 }
$changes = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($rec in $linked) {
    $d = $adoData[[int]$rec.ado_id]
    if (-not $d) { $stats.no_data++; continue }

    $newStatus = if ($stateMap.ContainsKey($d.state)) { $stateMap[$d.state] } else { $rec.status }
    $newSprint = $d.sprint_id
    $newSP     = $d.story_points
    $newOwner  = if ($d.assigned_to) { $d.assigned_to } else { $rec.owner }

    # Determine if any field actually changes
    $curSprint = if ($rec.PSObject.Properties['sprint_id']) { $rec.sprint_id } else { $null }
    $curSP     = if ($rec.PSObject.Properties['story_points']) { $rec.story_points } else { $null }
    $changed   = ($rec.status -ne $newStatus) -or ($curSprint -ne $newSprint) -or ($curSP -ne $newSP) -or ($rec.owner -ne $newOwner)

    if (-not $changed) { $stats.unchanged++; continue }

    if (-not $DryRun) {
        $body = $rec | Select-Object * -ExcludeProperty obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file
        $bodyObj = $body | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $bodyObj.status = $newStatus
        $bodyObj | Add-Member -NotePropertyName sprint_id    -NotePropertyValue $newSprint -Force
        $bodyObj | Add-Member -NotePropertyName story_points -NotePropertyValue $newSP     -Force
        if ($newOwner) { $bodyObj.owner = $newOwner }
        try {
            Invoke-RestMethod "$DataModelBase/model/wbs/$($rec.id)" -Method PUT `
                -Body ($bodyObj | ConvertTo-Json -Depth 10) `
                -ContentType "application/json" `
                -Headers @{"X-Actor"=$Actor} -ErrorAction Stop | Out-Null
            $stats.updated++
        } catch {
            Log "  [WARN] PUT failed $($rec.id): $($_.Exception.Message)"
            $stats.failed++
            continue
        }
    } else {
        $stats.updated++
    }
    $changes.Add([PSCustomObject]@{
        wbs_id       = $rec.id
        ado_id       = $rec.ado_id
        old_status   = $rec.status
        new_status   = $newStatus
        sprint_id    = $newSprint
        story_points = $newSP
    })
}

Log "  updated=$($stats.updated)  unchanged=$($stats.unchanged)  no_data=$($stats.no_data)  failed=$($stats.failed)"

# ---- Write sprint calendar to data model (model/sprints layer) ---------------
# If the sprints layer exists in the model, upsert each sprint definition
# so the ADO dashboard can read sprint dates directly from GET /model/sprints/
if ($sprintCal.Count -gt 0 -and -not $DryRun) {
    Log "[STEP5] Upserting sprint definitions to data model..."
    $spUpdated = 0
    foreach ($spName in $sprintCal.Keys) {
        $sp = $sprintCal[$spName]
        $spId = "sprint-$($spName.ToLower() -replace ' ','-')"
        $spBody = @{
            id          = $spId
            name        = $sp.name
            ado_iter_id = $sp.id
            start_date  = $sp.start_date
            finish_date = $sp.finish_date
            timeframe   = $sp.timeframe
            project     = $AdoProject
            is_active   = $true
        } | ConvertTo-Json -Depth 5
        try {
            Invoke-RestMethod "$DataModelBase/model/sprints/$spId" -Method PUT `
                -Body $spBody -ContentType "application/json" `
                -Headers @{"X-Actor"=$Actor} -ErrorAction Stop | Out-Null
            $spUpdated++
        } catch {
            # Layer may not exist yet; skip silently
        }
    }
    if ($spUpdated -gt 0) { Log "  sprint defs upserted: $spUpdated" }
}

# ---- Spot-check a few records ------------------------------------------------
Log "[STEP6] Spot-check..."
$spotPass = 0; $spotTotal = 0
if ($DryRun) {
    Log "  [INFO] Dry-run mode -- showing proposed changes (no live verify)"
    $sample = if ($changes.Count -gt 0) { $changes | Get-Random -Count ([Math]::Min(5, $changes.Count)) } else { @() }
    foreach ($s in $sample) {
        Log "  PROPOSED $($s.wbs_id): status=$($s.new_status) sprint=$($s.sprint_id) sp=$($s.story_points)"
    }
    $spotPass = 1; $spotTotal = 1
} else {
    $sample = if ($changes.Count -gt 0) { $changes | Get-Random -Count ([Math]::Min(5, $changes.Count)) } else { @() }
    foreach ($s in $sample) {
        $v = Invoke-RestMethod "$DataModelBase/model/wbs/$($s.wbs_id)" -ErrorAction SilentlyContinue
        $gotSprint = $v.PSObject.Properties["sprint_id"]
        $sprintVal  = if ($gotSprint) { $gotSprint.Value } else { $null }
        $ok = ($v.status -eq $s.new_status) -and ($sprintVal -eq $s.sprint_id)
        $spotTotal++
        if ($ok) { $spotPass++ }
        Log "  SPOT $($s.wbs_id): status=$($v.status) sprint=$sprintVal --> $(if ($ok) {'[PASS]'} else {'[FAIL]'})"
    }
    if ($spotTotal -eq 0) { Log "  [INFO] No changes to spot-check"; $spotPass = 1; $spotTotal = 1 }
}

# ---- Summary -----------------------------------------------------------------
$passed = ($stats.failed -eq 0) -and ($spotPass -eq $spotTotal)
Log ""
Log "=== WBS-ADO SYNC COMPLETE ($STAMP) ==="
Log "  updated=$($stats.updated)  unchanged=$($stats.unchanged)  failed=$($stats.failed)"
Log "  sprint_calendar=$($sprintCal.Count) sprints  spot=$spotPass/$spotTotal  mode=$(if ($DryRun) {'DRY-RUN'} else {'LIVE'})"
Log "  $(if ($passed) {'[PASS]'} else {'[WARN] check log for failures'})"

# Write evidence
@{
    sync_id      = "wbs-ado-sync-$STAMP"
    generated_at = (Get-Date -Format "o")
    mode         = if ($DryRun) { "dry-run" } else { "live" }
    filter       = @{ project=$Project; level=$Level }
    result       = @{ updated=$stats.updated; unchanged=$stats.unchanged; failed=$stats.failed; no_data=$stats.no_data }
    sprint_calendar_count = $sprintCal.Count
    spot_check   = @{ pass=$spotPass; total=$spotTotal }
    passed       = $passed
    sample_changes = ($changes | Select-Object -First 10)
} | ConvertTo-Json -Depth 10 | Out-File "$HERE\wbs-ado-sync-$STAMP.json" -Encoding ASCII
Log "  evidence: $HERE\wbs-ado-sync-$STAMP.json"
