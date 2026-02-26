# wbs-import.ps1
# Builds the full WBS tree in the data model from veritas-plan.json files.
# Hierarchy: Program > Stream > Project > Feature > Story
# WBS ID scheme:
#   Program : WBS-000
#   Stream  : WBS-S-AI | WBS-S-DEV | WBS-S-PL | WBS-S-UP
#   Project : WBS-{NN}  (e.g. WBS-01, WBS-31)
#   Feature : {feature_id}  (e.g. F31-01)
#   Story   : {story_id}    (e.g. F31-01-001)
#
# Run:
#   cd C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-wbs-import
#   pwsh wbs-import.ps1 2>&1 | Out-File wbs-import.log -Encoding ASCII

$evDir   = "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-wbs-import"
$veritas = "C:\AICOE\eva-foundation\48-eva-veritas\src\cli.js"
$base    = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io"
$actor   = "agent:veritas-wbs-import"

New-Item -ItemType Directory -Force -Path $evDir | Out-Null

function Log($msg) { $ts = (Get-Date).ToString("HH:mm:ss"); Write-Host "[$ts] $msg" }

function Upsert-WBS($id, $body) {
    $json = $body | ConvertTo-Json -Depth 10
    try {
        $r = Invoke-RestMethod "$base/model/wbs/$id" -Method PUT `
            -ContentType "application/json" -Body $json `
            -Headers @{"X-Actor"=$actor} -ErrorAction Stop
        return $r
    } catch {
        Log "  [FAIL] PUT wbs/$id : $_"
        return $null
    }
}

# ---- Stream assignment lookup table ----
$streamMap = @{
    "01-documentation-generator" = "WBS-S-DEV"
    "02-poc-agent-skills"         = "WBS-S-DEV"
    "03-poc-enhanced-docs"        = "WBS-S-UP"
    "04-os-vnext"                 = "WBS-S-DEV"
    "05-extract-cases"            = "WBS-S-DEV"
    "06-jp-auto-extraction"       = "WBS-S-DEV"
    "07-foundation-layer"         = "WBS-S-DEV"
    "08-cds-rag"                  = "WBS-S-AI"
    "09-eva-repo-documentation"   = "WBS-S-UP"
    "10-mkdocs-poc"               = "WBS-S-UP"
    "11-ms-infojp"                = "WBS-S-AI"
    "12-work-spc-reorg"           = "WBS-S-PL"
    "13-vscode-tools"             = "WBS-S-DEV"
    "14-az-finops"                = "WBS-S-PL"
    "15-cdc"                      = "WBS-S-PL"
    "16-engineered-case-law"      = "WBS-S-AI"
    "17-apim"                     = "WBS-S-PL"
    "18-azure-best"               = "WBS-S-PL"
    "19-ai-gov"                   = "WBS-S-PL"
    "20-AssistMe"                 = "WBS-S-UP"
    "21-habit-tracker"            = "WBS-S-UP"
    "22-rg-sandbox"               = "WBS-S-PL"
    "23-ei-dsst-rewrite"          = "WBS-S-DEV"
    "24-eva-brain"                = "WBS-S-AI"
    "25-eva-suite"                = "WBS-S-DEV"
    "26-eva-gh"                   = "WBS-S-DEV"
    "27-devbench"                 = "WBS-S-DEV"
    "28-rbac"                     = "WBS-S-PL"
    "29-foundry"                  = "WBS-S-AI"
    "30-ui-bench"                 = "WBS-S-UP"
    "31-eva-faces"                = "WBS-S-UP"
    "32-logging"                  = "WBS-S-PL"
    "33-eva-brain-v2"             = "WBS-S-AI"
    "34-AIRA"                     = "WBS-S-AI"
    "35-agentic-code-fixing"      = "WBS-S-DEV"
    "36-red-teaming"              = "WBS-S-AI"
    "37-data-model"               = "WBS-S-PL"
    "38-ado-poc"                  = "WBS-S-PL"
    "39-ado-dashboard"            = "WBS-S-UP"
    "40-eva-control-plane"        = "WBS-S-PL"
    "41-eva-cli"                  = "WBS-S-DEV"
    "42-learn-foundry"            = "WBS-S-AI"
    "43-spark"                    = "WBS-S-UP"
    "44-eva-jp-spark"             = "WBS-S-UP"
    "45-aicoe-page"               = "WBS-S-UP"
    "46-accelerator"              = "WBS-S-UP"
    "47-eva-mti"                  = "WBS-S-PL"
    "48-eva-veritas"              = "WBS-S-PL"
    "49-eva-dtl"                  = "WBS-S-PL"
}

# Maturity -> WBS status
function Get-WBSStatus($maturity) {
    switch ($maturity) {
        "active"   { return "in-progress" }
        "retired"  { return "done" }
        "empty"    { return "not-started" }
        default    { return "planned" }
    }
}

Log "=== wbs-import START $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

# ---- ACA health check ----
$h = Invoke-RestMethod "$base/health" -ErrorAction SilentlyContinue
if (-not $h) { Log "[FAIL] ACA unreachable"; exit 1 }
Log "[PASS] ACA: status=$($h.status) store=$($h.store)"

# ---- Verify WBS is empty ----
$existing = Invoke-RestMethod "$base/model/wbs/"
if ($existing.Count -gt 0) {
    Log "[FAIL] WBS layer not empty ($($existing.Count) records)."
    Log "       Run: Invoke-RestMethod base/model/wbs/ | ForEach { DELETE each }"
    exit 1
}
Log "[INFO] WBS layer empty -- proceeding"

$stats = @{ program=0; streams=0; projects=0; features=0; stories=0; errors=0 }

# ============================================================
# LEVEL 0: Programme
# ============================================================
Log "--- Programme ---"
$r = Upsert-WBS "WBS-000" @{
    id             = "WBS-000"
    label          = "EVA Platform Programme"
    label_fr       = "Programme Plateforme EVA"
    level          = "program"
    parent_wbs_id  = $null
    project_id     = $null
    stream         = $null
    status         = "in-progress"
    methodology    = "hybrid"
    is_active      = $true
    milestone      = $false
    owner          = "marco.presta"
    percent_complete = 0
    team           = "program"
    deliverable    = "Production-ready bilingual AI platform -- EVA Foundation 49-project portfolio"
    done_criteria  = "All 49 projects at maturity >= active. Full WBS traced. Evidence complete."
    notes          = "wbs-import=2026-02-25 sweep=wbs-import-v1"
}
if ($r) { $stats.program++; Log "  [OK] WBS-000 rv=$($r.row_version)" }
else    { $stats.errors++ }

# ============================================================
# LEVEL 1: Streams
# ============================================================
Log "--- Streams ---"
$streamDefs = @(
    @{ id="WBS-S-AI";  label="Stream: AI Intelligence";     label_fr="Stream: Intelligence Artificielle"; desc="RAG, agents, LLM, evaluation, red-teaming" }
    @{ id="WBS-S-DEV"; label="Stream: Developer Enablement"; label_fr="Stream: Outillage Developpeur";     desc="Tooling, automation, process, migration" }
    @{ id="WBS-S-PL";  label="Stream: Platform";            label_fr="Stream: Plateforme";                desc="Infrastructure, governance, data model, control plane" }
    @{ id="WBS-S-UP";  label="Stream: User Products";       label_fr="Stream: Produits Utilisateurs";     desc="End-user facing apps, UI, portals, JP assistant" }
)
foreach ($sd in $streamDefs) {
    $r = Upsert-WBS $sd.id @{
        id            = $sd.id
        label         = $sd.label
        label_fr      = $sd.label_fr
        level         = "stream"
        parent_wbs_id = "WBS-000"
        project_id    = $null
        stream        = $sd.id
        status        = "in-progress"
        methodology   = "agile"
        is_active     = $true
        milestone     = $false
        owner         = "marco.presta"
        deliverable   = $sd.desc
        notes         = "wbs-import=2026-02-25"
    }
    if ($r) { $stats.streams++; Log "  [OK] $($sd.id) rv=$($r.row_version)" }
    else    { $stats.errors++ }
}

# ============================================================
# LEVEL 2+: Projects, Features, Stories
# ============================================================
$allProjects = Invoke-RestMethod "$base/model/projects/"
$projectList = $allProjects | Where-Object { $_.id -match '^\d{2}-' } | Sort-Object id

Log "--- Projects ($($projectList.Count)) ---"

foreach ($proj in $projectList) {
    $projId    = $proj.id
    $num       = ($projId -replace '^(\d+)-.*','$1')
    $wbsProjId = "WBS-$num"
    $streamId  = if ($streamMap.ContainsKey($projId)) { $streamMap[$projId] } else { "WBS-S-PL" }
    $wbsStatus = Get-WBSStatus $proj.maturity
    $repoPath  = "C:\AICOE\eva-foundation\$projId"

    Log "  [$projId] -> $wbsProjId stream=$streamId"

    # Create project-level WBS record
    $r = Upsert-WBS $wbsProjId @{
        id            = $wbsProjId
        label         = $projId
        label_fr      = $projId
        level         = "project"
        parent_wbs_id = $streamId
        project_id    = $projId
        stream        = $streamId
        status        = $wbsStatus
        methodology   = "agile"
        is_active     = ($proj.maturity -ne "retired" -and $proj.maturity -ne "empty")
        milestone     = $false
        owner         = "marco.presta"
        deliverable   = $proj.description
        notes         = "wbs-import=2026-02-25 maturity=$($proj.maturity)"
    }
    if ($r) { $stats.projects++; Log "    [PROJ OK] $wbsProjId rv=$($r.row_version)" }
    else    { $stats.errors++; continue }

    # Link project record back to its WBS entry and set stream
    $projBody = $proj | Select-Object * -ExcludeProperty obj_id,layer,modified_by,modified_at,created_by,created_at,row_version,source_file
    $projBody.wbs_id = $wbsProjId
    $projBody.stream = $streamId
    try {
        Invoke-RestMethod "$base/model/projects/$projId" -Method PUT `
            -ContentType "application/json" -Body ($projBody | ConvertTo-Json -Depth 10) `
            -Headers @{"X-Actor"=$actor} | Out-Null
    } catch {
        Log "    [WARN] could not link project wbs_id: $_"
    }

    # Read veritas-plan.json
    $planFile = "$repoPath\.eva\veritas-plan.json"
    if (-not (Test-Path $planFile)) {
        # Try to generate it
        node $veritas generate-plan --repo $repoPath --enrich 2>&1 | Out-Null
    }
    if (-not (Test-Path $planFile)) {
        Log "    [SKIP] no veritas-plan.json"
        continue
    }

    $plan = Get-Content $planFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (-not $plan -or -not $plan.features) {
        Log "    [SKIP] plan has no features"
        continue
    }

    # Features
    foreach ($feat in $plan.features) {
        $featId = $feat.id   # e.g. F31-01
        if (-not $featId) { continue }

        $r = Upsert-WBS $featId @{
            id            = $featId
            label         = $feat.title
            label_fr      = $feat.title
            level         = "feature"
            parent_wbs_id = $wbsProjId
            project_id    = $projId
            stream        = $streamId
            status        = "planned"
            methodology   = "agile"
            is_active     = $true
            milestone     = $false
            owner         = "marco.presta"
            deliverable   = $feat.title
            notes         = "wbs-import=2026-02-25 project=$projId"
        }
        if ($r) { $stats.features++ }
        else    { $stats.errors++ }

        # Stories
        if (-not $feat.stories) { continue }
        foreach ($story in $feat.stories) {
            $storyId = $story.id   # e.g. F31-01-001
            if (-not $storyId) { continue }

            $r = Upsert-WBS $storyId @{
                id            = $storyId
                label         = $story.title
                label_fr      = $story.title
                level         = "story"
                parent_wbs_id = $featId
                project_id    = $projId
                stream        = $streamId
                status        = "planned"
                methodology   = "agile"
                is_active     = $true
                milestone     = $false
                owner         = "marco.presta"
                deliverable   = $story.title
                notes         = "wbs-import=2026-02-25 project=$projId feature=$featId"
            }
            if ($r) { $stats.stories++ }
            else    { $stats.errors++ }
        }
    }

    # Orphan stories (veritas stories not under any feature)
    if ($plan._orphan_stories) {
        foreach ($story in $plan._orphan_stories) {
            $storyId = $story.id
            if (-not $storyId) { continue }
            $r = Upsert-WBS $storyId @{
                id            = $storyId
                label         = $story.title
                label_fr      = $story.title
                level         = "story"
                parent_wbs_id = $wbsProjId
                project_id    = $projId
                stream        = $streamId
                status        = "planned"
                methodology   = "agile"
                is_active     = $true
                milestone     = $false
                owner         = "marco.presta"
                deliverable   = $story.title
                notes         = "wbs-import=2026-02-25 orphan=true project=$projId"
            }
            if ($r) { $stats.stories++ }
            else    { $stats.errors++ }
        }
    }

    $fCount = $plan.features.Count
    $sCount = ($plan.features | ForEach-Object { $_.stories.Count } | Measure-Object -Sum).Sum
    Log "    features=$fCount stories=$sCount"
}

# ============================================================
# Summary
# ============================================================
$total = $stats.program + $stats.streams + $stats.projects + $stats.features + $stats.stories
Log ""
Log "=== WBS IMPORT COMPLETE ==="
Log "  program : $($stats.program)"
Log "  streams : $($stats.streams)"
Log "  projects: $($stats.projects)"
Log "  features: $($stats.features)"
Log "  stories : $($stats.stories)"
Log "  TOTAL   : $total"
Log "  errors  : $($stats.errors)"
Log ""

$stats | ConvertTo-Json | Out-File "$evDir\wbs-import-stats.json" -Encoding ASCII

# ---- Commit ----
Log "POST admin/commit..."
$c = Invoke-RestMethod "$base/model/admin/commit" -Method POST `
    -Headers @{"Authorization"="Bearer dev-admin"} -ErrorAction SilentlyContinue
Log "  status=$($c.status) violations=$($c.violation_count) exported=$($c.exported_total)"
$c | ConvertTo-Json -Depth 5 | Out-File "$evDir\commit-result.json" -Encoding ASCII

if ($c.violation_count -eq 0) { Log "[PASS] Commit clean" }
else { Log "[WARN] Violations: $($c.violation_count)" }

# Final agent-summary
$s = Invoke-RestMethod "$base/model/agent-summary"
Log "Final model total: $($s.total)  wbs=$($s.layers.wbs)"
$s | ConvertTo-Json -Depth 5 | Out-File "$evDir\final-agent-summary.json" -Encoding ASCII

Log "=== DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Log "Evidence: $evDir"
