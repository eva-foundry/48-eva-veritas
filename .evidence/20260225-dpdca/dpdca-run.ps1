<#
.SYNOPSIS
    DPDCA Full Cycle -- ADO-ID Writeback + Evidence Generation
    Plan -> Do -> Check -> Act
    2026-02-25  agent:copilot

.DESCRIPTION
    PLAN  : Read WBS summary (stories/features/projects without ado_id)
    DO    : Query ADO, parse [WBS-ID] from titles, PUT ado_id onto each WBS record
    CHECK : Verify FK coverage, spot-check 5 records, build evidence JSON
    ACT   : POST run + evidence to CP8020, final model commit to ACA
#>

param(
    [switch]$DryRun,
    [string]$DataModelBase = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io",
    [string]$CpBase = "http://localhost:8020",
    [string]$AdoOrg = "https://dev.azure.com/marcopresta",
    [string]$AdoProject = "eva-poc",
    [string]$Actor = "agent:ado-id-writeback"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$HERE = $PSScriptRoot
$LOG  = "$HERE\dpdca.log"
$EVIDENCE_FILE = "$HERE\evidence.json"

function Log { param([string]$m) $ts = Get-Date -Format "HH:mm:ss"; "[$ts] $m" | Tee-Object -FilePath $LOG -Append | Write-Host }
function ADO-Headers {
    $enc = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$($env:ADO_PAT)"))
    return @{ Authorization = "Basic $enc"; "Content-Type" = "application/json" }
}

# ---- PLAN ---------------------------------------------------------------
Log ""
Log "=== PLAN ==="
Log "scope  : ADO-ID writeback for WBS stories, features, projects"
Log "mode   : $(if ($DryRun) { 'DRY-RUN' } else { 'LIVE' })"
Log "ACA    : $DataModelBase"
Log "CP     : $CpBase"

if (-not $env:ADO_PAT) {
    Log "[INFO] ADO_PAT not in env -- fetching from Key Vault evachatkv..."
    $env:ADO_PAT = az keyvault secret show --vault-name evachatkv --name ADO-PAT --query value -o tsv
}
if (-not $env:ADO_PAT -or $env:ADO_PAT.Length -lt 10) {
    Log "[FAIL] Cannot retrieve ADO_PAT"; exit 1
}
Log "[PASS] ADO_PAT ready ($($env:ADO_PAT.Length) chars)"

# Preflight ACA
$hlt = Invoke-RestMethod "$DataModelBase/health" -ErrorAction Stop
Log "[PASS] ACA status=$($hlt.status) store=$($hlt.store)"

# Preflight CP
$cpHlt = Invoke-RestMethod "$CpBase/health" -ErrorAction SilentlyContinue
if ($cpHlt) { Log "[PASS] CP8020 status=$($cpHlt.status)" } else { Log "[WARN] CP8020 offline -- evidence will be local only" }

# Read WBS summary
$smy = Invoke-RestMethod "$DataModelBase/model/agent-summary" -ErrorAction Stop
$wbsTotal = $smy.layers.wbs
Log "[INFO] WBS layer: $wbsTotal records total"

# POST run start to CP
$runId  = "run-dpdca-$(Get-Date -Format 'yyyyMMddHHmmss')"
$evidId = "DPDCA-20260225-ado-id-writeback"
if ($cpHlt) {
    $runBody = @{
        id           = $runId
        evidence_id  = $evidId
        runbook_id   = "rb-ado-writeback"
        app_id       = "eva-control-plane"
        env_id       = "env-dev"
        status       = "running"
        initiated_by = $Actor
        notes        = "ADO-ID writeback: link ADO integer IDs to WBS records in data model"
    } | ConvertTo-Json -Depth 5
    $run = Invoke-RestMethod "$CpBase/runs" -Method POST -Body $runBody -ContentType "application/json" -ErrorAction SilentlyContinue
    if ($run) { Log "[INFO] CP run created: $runId" }
}

# ---- DO -----------------------------------------------------------------
Log ""
Log "=== DO ==="

# Step 1: WIQL -- get all PBIs, Features, Epics
Log "[STEP1] WIQL query to ADO..."
$wiqlBody = @{
    query = "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '$AdoProject' AND [System.WorkItemType] IN ('Product Backlog Item', 'Feature', 'Epic') ORDER BY [System.Id] ASC"
} | ConvertTo-Json
$wiqlUrl = "$AdoOrg/$AdoProject/_apis/wit/wiql?api-version=7.1&`$top=5000"
$wiqlResult = Invoke-RestMethod $wiqlUrl -Method POST -Body $wiqlBody -Headers (ADO-Headers) -ErrorAction Stop
$allIds = $wiqlResult.workItems | ForEach-Object { $_.id }
Log "[INFO] ADO items found: $($allIds.Count)"

# Step 2: Batch GET titles (200 per batch)
Log "[STEP2] Batch GET titles from ADO..."
$allItems = [System.Collections.Generic.List[PSCustomObject]]::new()
$batchSize = 200
for ($i = 0; $i -lt $allIds.Count; $i += $batchSize) {
    $batch = $allIds[$i..([Math]::Min($i + $batchSize - 1, $allIds.Count - 1))]
    $batchBody = @{
        ids    = $batch
        fields = @("System.Id", "System.Title", "System.WorkItemType")
    } | ConvertTo-Json -Depth 5
    $batchUrl = "$AdoOrg/$AdoProject/_apis/wit/workitemsbatch?api-version=7.1"
    $batchResult = Invoke-RestMethod $batchUrl -Method POST -Body $batchBody -Headers (ADO-Headers) -ErrorAction Stop
    foreach ($wi in $batchResult.value) {
        $allItems.Add([PSCustomObject]@{
            ado_id   = [int]$wi.id
            title    = $wi.fields."System.Title"
            wi_type  = $wi.fields."System.WorkItemType"
        })
    }
    Log "  batch $([Math]::Floor($i/$batchSize)+1): got $($batchResult.value.Count) items"
}
Log "[INFO] Total ADO items retrieved: $($allItems.Count)"

# Step 3: Parse [WBS-ID] from title, PUT ado_id to data model
Log "[STEP3] Matching ADO items to WBS records and writing ado_id..."
$wbsIdPattern = [regex]'^\[([A-Za-z0-9\-]+)\] '
$stats = @{ matched = 0; not_found = 0; skipped = 0; failed = 0; already_set = 0 }
$matchLog = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($item in $allItems) {
    $m = $wbsIdPattern.Match($item.title)
    if (-not $m.Success) {
        $stats.skipped++
        continue
    }
    $wbsId = $m.Groups[1].Value

    # GET from data model
    $rec = $null
    try {
        $rec = Invoke-RestMethod "$DataModelBase/model/wbs/$wbsId" -ErrorAction Stop
    } catch {
        $stats.not_found++
        continue
    }

    # Already has correct ado_id?
    $existingAdoId = if ($rec.PSObject.Properties['ado_id']) { $rec.ado_id } else { $null }
    if ($existingAdoId -ne $null -and $existingAdoId -eq $item.ado_id) {
        $stats.already_set++
        continue
    }

    # PUT back with ado_id
    if (-not $DryRun) {
        $prevRv = $rec.row_version
        $body = $rec | Select-Object * -ExcludeProperty obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file
        $bodyObj = $body | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        $bodyObj | Add-Member -NotePropertyName ado_id -NotePropertyValue $item.ado_id -Force
        $putBody = $bodyObj | ConvertTo-Json -Depth 10
        try {
            Invoke-RestMethod "$DataModelBase/model/wbs/$wbsId" -Method PUT -Body $putBody -ContentType "application/json" -Headers @{"X-Actor"=$Actor} -ErrorAction Stop | Out-Null
            $stats.matched++
        } catch {
            Log "[WARN] PUT failed for $wbsId : $($_.Exception.Message)"
            $stats.failed++
            continue
        }
    } else {
        $stats.matched++
    }
    $matchLog.Add([PSCustomObject]@{ wbs_id=$wbsId; ado_id=$item.ado_id; wi_type=$item.wi_type })
}

Log "  matched (wrote ado_id) : $($stats.matched)"
Log "  already_set            : $($stats.already_set)"
Log "  not_found in WBS       : $($stats.not_found)"
Log "  skipped (no WBS prefix): $($stats.skipped)"
Log "  failed                 : $($stats.failed)"

# ---- CHECK --------------------------------------------------------------
Log ""
Log "=== CHECK ==="

# Verify spot-check: 5 random matched records
$spotSample = $matchLog | Get-Random -Count ([Math]::Min(5, $matchLog.Count))
$spotResults = [System.Collections.Generic.List[PSCustomObject]]::new()
foreach ($s in $spotSample) {
    $verify = Invoke-RestMethod "$DataModelBase/model/wbs/$($s.wbs_id)" -ErrorAction SilentlyContinue
    $verifyAdoId = if ($verify -and $verify.PSObject.Properties['ado_id']) { $verify.ado_id } else { $null }
    $ok = ($verifyAdoId -eq $s.ado_id)
    $spotResults.Add([PSCustomObject]@{ wbs_id=$s.wbs_id; expected=$s.ado_id; actual=$verifyAdoId; pass=$ok })
    Log "  SPOT $($s.wbs_id): ado_id=$verifyAdoId expected=$($s.ado_id) --> $(if ($ok) {'[PASS]'} else {'[FAIL]'})"
}
$spotPass  = ($spotResults | Where-Object { $_.pass }).Count
$spotTotal = $spotResults.Count

# FK coverage metric
$totalLinked  = $stats.matched + $stats.already_set
$coveragePct  = if ($allItems.Count -gt 0) { [Math]::Round(100 * $totalLinked / $allItems.Count, 1) } else { 0 }
Log "  FK coverage: $totalLinked / $($allItems.Count) ADO items linked ($coveragePct%)"
Log "  Spot-check : $spotPass / $spotTotal [PASS]"

$checkPassed = ($stats.failed -eq 0) -and ($spotPass -eq $spotTotal)
Log "  CHECK result: $(if ($checkPassed) {'[PASS]'} else {'[FAIL]'})"

# Build evidence JSON
$evidence = [PSCustomObject]@{
    evidence_id      = $evidId
    run_id           = $runId
    generated_at     = (Get-Date -Format "o")
    actor            = $Actor
    mode             = if ($DryRun) { "dry-run" } else { "live" }
    plan = [PSCustomObject]@{
        scope          = "ADO-ID writeback: link ADO integer IDs to WBS records"
        wbs_total      = $wbsTotal
        ado_items_found = $allItems.Count
    }
    do_result = [PSCustomObject]@{
        matched     = $stats.matched
        already_set = $stats.already_set
        not_found   = $stats.not_found
        skipped     = $stats.skipped
        failed      = $stats.failed
    }
    check_result = [PSCustomObject]@{
        fk_coverage_pct = $coveragePct
        total_linked    = $totalLinked
        spot_pass       = $spotPass
        spot_total      = $spotTotal
        passed          = $checkPassed
    }
    sample_mappings = ($matchLog | Select-Object -First 10)
}
$evidence | ConvertTo-Json -Depth 10 | Out-File $EVIDENCE_FILE -Encoding ASCII
Log "[INFO] Evidence written: $EVIDENCE_FILE"

# ---- ACT ----------------------------------------------------------------
Log ""
Log "=== ACT ==="

# POST evidence artifact to CP
if ($cpHlt) {
    # Update run to completed
    $runPatch = @{ status = if ($checkPassed) {"succeeded"} else {"failed"}; completed_at = (Get-Date -Format "o") } | ConvertTo-Json
    Invoke-RestMethod "$CpBase/runs/$runId" -Method PATCH -Body $runPatch -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null

    # Register artifact
    $artBody = @{
        evidence_id    = $evidId
        run_id         = $runId
        step_id        = "s-writeback"
        name           = "evidence.json"
        type           = "evidence_pack"
        uri            = $EVIDENCE_FILE
        size_bytes     = (Get-Item $EVIDENCE_FILE).Length
        notes          = "ADO-ID writeback evidence pack -- $(if ($checkPassed) {'PASS'} else {'FAIL'})"
    } | ConvertTo-Json
    $art = Invoke-RestMethod "$CpBase/artifacts" -Method POST -Body $artBody -ContentType "application/json" -ErrorAction SilentlyContinue
    if ($art) { Log "[INFO] Artifact registered: $($art.id)" }

    # Verify round-trip via evidence endpoint
    $evFull = Invoke-RestMethod "$CpBase/evidence/$evidId" -ErrorAction SilentlyContinue
    if ($evFull) {
        Log "[PASS] CP evidence round-trip: run=$($evFull.run.status) artifacts=$($evFull.artifact_count) steps=$($evFull.step_count)"
    }
}

# Final ACA commit
$commit = Invoke-RestMethod "$DataModelBase/model/admin/commit" -Method POST -Headers @{"Authorization"="Bearer dev-admin"} -ErrorAction SilentlyContinue
if ($commit) {
    Log "  ACA commit: violations=$($commit.violation_count) exported=$($commit.exported_total) errors=$($commit.export_errors.Count)"
    if ($commit.violation_count -eq 0 -and $commit.export_errors.Count -eq 0) {
        Log "[PASS] Data model clean"
    } else {
        Log "[WARN] Commit issues -- check manually"
    }
}

# Final summary
Log ""
Log "=== DPDCA COMPLETE ==="
Log "  plan     : wbs_total=$wbsTotal ado_items=$($allItems.Count)"
Log "  do       : matched=$($stats.matched) already_set=$($stats.already_set) failed=$($stats.failed)"
Log "  check    : coverage=$coveragePct% spot=$spotPass/$spotTotal"
Log "  act      : evidence=$EVIDENCE_FILE run=$runId"
Log "  mode     : $(if ($DryRun) { 'DRY-RUN' } else { 'LIVE' })"
if ($checkPassed) {
    Log "[PASS] DPDCA cycle complete"
} else {
    Log "[WARN] DPDCA cycle complete with issues -- review evidence.json"
}
