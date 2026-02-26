# wbs-to-ado.ps1
# Generates ADO ado-artifacts.json files from WBS data model layer
# then seeds them into Azure DevOps eva-poc project.
#
# Version  : 1.0.0
# Date     : 2026-02-25 08:20 ET
# Author   : agent:copilot (session 5)
#
# FLOW
# ----
# 1. Fetch all WBS records (projects / features / stories) from data model API
# 2. For each active project: build ado-artifacts.json matching ado-import-project.ps1 schema
# 3. Write per-project JSON to .evidence/20260225-ado-seed/artifacts/{project}.json
# 4. Run ado-import-project.ps1 for each project (DryRun=$DryRun)
# 5. Summarize: created/skipped/failed
#
# USAGE
# -----
# Preview without creating anything in ADO:
#   pwsh wbs-to-ado.ps1 -DryRun
#
# Live (creates work items -- idempotent, checks for duplicates by title):
#   $env:ADO_PAT = "<pat>"; pwsh wbs-to-ado.ps1
#
# REQUIREMENTS
# ------------
#   $env:ADO_PAT set, OR secret ADO-PAT in keyvault 'evachatkv'
#   38-ado-poc/scripts/ado-import-project.ps1 must exist
#   ACA data model reachable

param(
    [switch]$DryRun,
    [string]$FilterProject = "",     # limit to a single project id (e.g. "31-eva-faces")
    [string]$FilterStream  = "",     # limit to one stream (e.g. "WBS-S-AI")
    [switch]$ActiveOnly              # only projects with maturity != retired/empty/idea
)

$ErrorActionPreference = "Continue"
$base    = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"
$BASEDIR = "C:\AICOE\eva-foundation"
$IMPORT  = "$BASEDIR\38-ado-poc\scripts\ado-import-project.ps1"
$HERE    = $PSScriptRoot
$ARTDIR  = "$HERE\artifacts"
New-Item -ItemType Directory -Force -Path $ARTDIR | Out-Null

function Log { param([string]$m) "[$(Get-Date -Format 'HH:mm:ss')] $m" | Tee-Object -FilePath "$HERE\wbs-to-ado.log" -Append | Write-Host }

Log "[INFO] Fetching WBS + project data from data model..."
$wbs      = Invoke-RestMethod "$base/model/wbs/"      -TimeoutSec 60
$projects = Invoke-RestMethod "$base/model/projects/" -TimeoutSec 60

$wbsProjects = $wbs | Where-Object { $_.level -eq "project"  }
$wbsFeatures = $wbs | Where-Object { $_.level -eq "feature"  }
$wbsStories  = $wbs | Where-Object { $_.level -eq "story"    }

Log "[INFO] WBS: projects=$($wbsProjects.Count)  features=$($wbsFeatures.Count)  stories=$($wbsStories.Count)"

# Build lookup: feature_id -> [story objects]
$storyByFeature = @{}
foreach ($st in $wbsStories) {
    $fid = $st.parent_wbs_id
    if (-not $fid) { continue }
    if (-not $storyByFeature.ContainsKey($fid)) {
        $storyByFeature[$fid] = [System.Collections.Generic.List[object]]::new()
    }
    $storyByFeature[$fid].Add($st)
}

# Build lookup: project_id -> [feature objects]
$featureByProject = @{}
foreach ($f in $wbsFeatures) {
    $fproj = $f.project_id
    if (-not $fproj) { continue }
    if (-not $featureByProject.ContainsKey($fproj)) {
        $featureByProject[$fproj] = [System.Collections.Generic.List[object]]::new()
    }
    $featureByProject[$fproj].Add($f)
}

# Build lookup: project folder name -> data model project record
$projRecord = @{}
foreach ($p in $projects) { $projRecord[$p.id] = $p }

# ---- ADO iteration path helper (maps stream to sprint area) ---
$streamIterMap = @{
    "WBS-S-AI"  = "eva-poc\\Sprint-Backlog"
    "WBS-S-DEV" = "eva-poc\\Sprint-Backlog"
    "WBS-S-PL"  = "eva-poc\\Sprint-Backlog"
    "WBS-S-UP"  = "eva-poc\\Sprint-Backlog"
}

# ---- Status -> ADO state mapping ---
function Get-ADOState {
    param([string]$status)
    switch ($status) {
        "done"      { return "Done" }
        "active"    { return "Committed" }
        "in-flight" { return "Approved" }
        default     { return "New" }
    }
}

# ---- Maturity exclusion list
$SKIP_MATURITY = @("retired", "empty", "idea")

$created = 0; $skipped = 0; $failed = 0; $totalPBIs = 0

Log "[INFO] Building per-project ADO artifacts..."

foreach ($wbsProj in $wbsProjects) {
    $projId   = $wbsProj.project_id
    if (-not $projId) { continue }

    # Apply filters
    if ($FilterProject -and $projId -ne $FilterProject) { continue }
    if ($FilterStream  -and $wbsProj.stream -ne $FilterStream) { continue }

    # Get data model record for this project
    $rec = $projRecord[$projId]
    if ($rec -and $ActiveOnly -and ($rec.maturity -in $SKIP_MATURITY)) {
        Log "[SKIP] $projId (maturity=$($rec.maturity))"
        $skipped++
        continue
    }

    $maturity    = if ($rec) { $rec.maturity } else { "poc" }
    $description = if ($rec -and $rec.description) { $rec.description } else { $wbsProj.label }
    $ghRepo      = "eva-foundry/$projId"
    $stream      = if ($wbsProj.stream) { $wbsProj.stream } else { "WBS-S-DEV" }
    $iterPath    = $streamIterMap[$stream]
    $epicTags    = "$projId;$stream"

    # Features for this project
    $features = if ($featureByProject.ContainsKey($projId)) { $featureByProject[$projId] } else { @() }

    if ($features.Count -eq 0) {
        Log "[WARN] $projId has WBS project node but no features -- skipping ADO artifact"
        $skipped++
        continue
    }

    # Build ADO features array
    $adoFeatures = [System.Collections.Generic.List[object]]::new()
    $adoStories  = [System.Collections.Generic.List[object]]::new()

    foreach ($feat in $features) {
        $featId    = $feat.id
        $featLabel = if ($feat.label) { $feat.label } else { $featId }
        $featDesc  = if ($feat.deliverable) { $feat.deliverable } else { $featLabel }

        $adoFeatures.Add([PSCustomObject]@{
            id_hint     = $featId
            type        = "Feature"
            title       = $featLabel
            description = $featDesc
            tags        = "$projId;$featId"
            parent      = "epic"
        })

        # Stories under this feature
        $stories = if ($storyByFeature.ContainsKey($featId)) { $storyByFeature[$featId] } else { @() }
        foreach ($st in $stories) {
            $stLabel     = if ($st.label)      { $st.label }      else { $st.id }
            $stCriteria  = if ($st.deliverable){ $st.deliverable } else { $stLabel }
            $adoState    = Get-ADOState -status $st.status

            $rawTitle = "[$($st.id)] $stLabel"
            if ($rawTitle.Length -gt 255) {
                $rawTitle = $rawTitle.Substring(0, 252) + "..."
                Log "[WARN] Story $($st.id) title truncated to 255 chars"
            }
            $adoStories.Add([PSCustomObject]@{
                id_hint              = $st.id
                type                 = "Product Backlog Item"
                title                = $rawTitle
                acceptance_criteria  = $stCriteria
                tags                 = "$projId;$($st.id)"
                iteration_path       = $iterPath
                parent               = $featId
                state                = $adoState
                wbs_id               = $st.id
            })
            $totalPBIs++
        }
    }

    # Build ado-artifacts.json
    $artifact = [PSCustomObject]@{
        schema_version   = "1.0"
        generated_at     = (Get-Date -Format "o")
        ado_org          = "https://dev.azure.com/marcopresta"
        ado_project      = "eva-poc"
        github_repo      = $ghRepo
        project_maturity = $maturity
        wbs_project_id   = $wbsProj.id
        stream           = $stream
        sprints_needed   = @()   # empty -- sprints already exist in eva-poc
        epic             = [PSCustomObject]@{
            skip_if_id_exists = $null
            type              = "Epic"
            title             = $wbsProj.label
            description       = $description
            tags              = $epicTags
            area_path         = "eva-poc"
        }
        features         = $adoFeatures
        user_stories     = $adoStories
    }

    $outFile = "$ARTDIR\$projId.json"
    $artifact | ConvertTo-Json -Depth 10 | Out-File $outFile -Encoding ASCII
    Log "[BUILT] $projId  features=$($adoFeatures.Count)  stories=$($adoStories.Count)  -> $outFile"
    $created++
}

Log ""
Log "[INFO] Artifact generation complete: built=$created  skipped=$skipped"
Log "[INFO] Total PBIs staged: $totalPBIs"
Log ""

if (-not (Test-Path $IMPORT)) {
    Log "[FAIL] ado-import-project.ps1 not found at $IMPORT -- cannot run import"
    exit 1
}

# ---- Run ado-import-project.ps1 for each artifact file
Log "=== ADO IMPORT $(if ($DryRun) { '(DRY RUN)' } else { '(LIVE)' }) ==="

$imp_created = 0; $imp_skipped = 0; $imp_failed = 0

$artifactFiles = Get-ChildItem "$ARTDIR\*.json" | Sort-Object Name
Log "[INFO] Importing $($artifactFiles.Count) project artifact files..."

foreach ($af in $artifactFiles) {
    $projName = $af.BaseName
    Log "[START] Import: $projName"
    try {
        $logFile = "$HERE\import-$projName.log"
        if ($DryRun) {
            & pwsh $IMPORT -ArtifactsFile $af.FullName -DryRun 2>&1 | Out-File $logFile -Encoding ASCII
        } else {
            & pwsh $IMPORT -ArtifactsFile $af.FullName 2>&1 | Out-File $logFile -Encoding ASCII
        }
        if ($LASTEXITCODE -ne 0) {
            Log "[FAIL] $projName (exit=$LASTEXITCODE) -- see $logFile"
            $imp_failed++
        } else {
            Log "[DONE] $projName"
            $imp_created++
        }
    } catch {
        Log "[FAIL] $projName -- $($_.Exception.Message)"
        $imp_failed++
    }
}

Log ""
Log "=== WBS-TO-ADO COMPLETE ==="
Log "  artifacts_built  : $created"
Log "  artifacts_skipped: $skipped"
Log "  import_success   : $imp_created"
Log "  import_failed    : $imp_failed"
Log "  total_pbis_staged: $totalPBIs"
Log "  mode             : $(if ($DryRun) { 'DRY-RUN (nothing created in ADO)' } else { 'LIVE' })"
if ($imp_failed -eq 0) {
    Log "[PASS] All imports completed"
} else {
    Log "[WARN] $imp_failed imports failed -- check individual import logs in $HERE"
}
