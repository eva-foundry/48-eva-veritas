# Session 39 Part C: Systematic Extraction Script
# Date: 2026-03-07 9:38 PM ET

$ErrorActionPreference = 'Continue'
$results = @()

# Projects to test (skip 37 - already tested)
$projects = @(
    '36-red-teaming',
    '38-ado-poc',
    '39-ado-dashboard',
    '40-eva-control-plane',
    '41-eva-cli',
    '42-learn-foundry',
    '43-spark',
    '44-eva-jp-spark',
    '45-aicoe-page',
    '46-accelerator',
    '47-eva-mti',
    '48-eva-veritas'
)

Write-Host "`n=========================================="
Write-Host "SESSION 39 PART C: Projects 36-48 Extraction"
Write-Host "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "==========================================`n"

$i = 1
foreach ($project in $projects) {
    Write-Host "[$i/$($projects.Length)] Testing $project..." -ForegroundColor Cyan
    
    $projPath = "..\$project"
    
    # Check if project exists
    if (!(Test-Path $projPath)) {
        Write-Host "  ✗ Project not found" -ForegroundColor Red
        $results += [PSCustomObject]@{
            Project = $project
            Status = "Not Found"
            WBS = 0
            Evidence = 0
            Decisions = 0
            Risks = 0
            GovFiles = ""
            Error = "Directory not found"
        }
        $i++
        continue
    }
    
    # Check if audit files already exist
    $discoveryExists = Test-Path "$projPath\.eva\discovery.json"
    $reconciliationExists = Test-Path "$projPath\.eva\reconciliation.json"
    
    if ($discoveryExists -and $reconciliationExists) {
        Write-Host "  Audit files exist (skipping audit)" -ForegroundColor Gray
    } else {
        # Run audit (suppress output)
        Write-Host "  Running audit..." -NoNewline
        try {
            node .\src\cli.js audit --repo $projPath --warn-only 2>&1 | Out-Null
            Write-Host " ✓" -ForegroundColor Green
        } catch {
            Write-Host " (audit issues - continuing)" -ForegroundColor Yellow
        }
    }
    
    # Check if export already exists
    $exportPath = "$projPath\.eva\model-export.json"
    $exportExists = Test-Path $exportPath
    
    $govFiles = "N/A"
    $govCount = 0
    
    if ($exportExists) {
        Write-Host "  Using existing export..." -NoNewline
    } else {
        # Run export
        Write-Host "  Running export..." -NoNewline
        try {
            $exportOutput = node .\src\cli.js export-to-model --repo $projPath 2>&1 | Out-String
            
            # Parse output for governance files
            $govMatch = $exportOutput | Select-String -Pattern "Found (\d+) governance file\(s\): (.+)"
            $govFiles = if ($govMatch) { $govMatch.Matches[0].Groups[2].Value } else { "N/A" }
            $govCount = if ($govMatch) { [int]$govMatch.Matches[0].Groups[1].Value } else { 0 }
        } catch {
            Write-Host " ✗ Error: $_" -ForegroundColor Red
            $results += [PSCustomObject]@{
                Project = $project
                Status = "Error"
                WBS = 0
                Evidence = 0
                Decisions = 0
                Risks = 0
                GovFiles = 0
                Error = $_.Exception.Message
            }
            $i++
            Write-Host ""
            continue
        }
    }
    
    # Check if export file exists now
    try {
        if (Test-Path $exportPath) {
            $export = Get-Content $exportPath | ConvertFrom-Json
            $wbsCount = if ($export.wbs) { $export.wbs.Length } else { 0 }
            $evidenceCount = if ($export.evidence) { $export.evidence.Length } else { 0 }
            $decisionsCount = if ($export.decisions) { $export.decisions.Length } else { 0 }
            $risksCount = if ($export.risks) { $export.risks.Length } else { 0 }
            
            Write-Host " ✓" -ForegroundColor Green
            Write-Host "  Results: WBS=$wbsCount, Evidence=$evidenceCount, Decisions=$decisionsCount, Risks=$risksCount" -ForegroundColor Green
            if ($govCount -gt 0) {
                Write-Host "  Governance: $govCount file(s)" -ForegroundColor Gray
            }
            
            $results += [PSCustomObject]@{
                Project = $project
                Status = "Success"
                WBS = $wbsCount
                Evidence = $evidenceCount
                Decisions = $decisionsCount
                Risks = $risksCount
                GovFiles = $govCount
                GovFileNames = $govFiles
                Error = ""
            }
        } else {
            Write-Host " ✗ (no output file)" -ForegroundColor Red
            $results += [PSCustomObject]@{
                Project = $project
                Status = "Export Failed"
                WBS = 0
                Evidence = 0
                Decisions = 0
                Risks = 0
                GovFiles = $govCount
                Error = "No model-export.json generated"
            }
        }
    } catch {
        Write-Host " ✗ Error: $_" -ForegroundColor Red
        $results += [PSCustomObject]@{
            Project = $project
            Status = "Error"
            WBS = 0
            Evidence = 0
            Decisions = 0
            Risks = 0
            GovFiles = 0
            Error = $_.Exception.Message
        }
    }
    
    $i++
    Write-Host ""
}

Write-Host "`n=========================================="
Write-Host "RESULTS SUMMARY"
Write-Host "==========================================`n"

$results | Format-Table -AutoSize Project, Status, WBS, Evidence, Decisions, Risks, GovFiles

Write-Host "`nStatistics:"
$successful = ($results | Where-Object { $_.Status -eq "Success" }).Count
Write-Host "  Successful: $successful / $($projects.Length)"
Write-Host "  Total WBS: $(($results | Measure-Object -Property WBS -Sum).Sum)"
Write-Host "  Total Evidence: $(($results | Measure-Object -Property Evidence -Sum).Sum)"
Write-Host "  Total Decisions: $(($results | Measure-Object -Property Decisions -Sum).Sum)"
Write-Host "  Total Risks: $(($results | Measure-Object -Property Risks -Sum).Sum)"

# Export results to JSON
$results | ConvertTo-Json -Depth 3 | Out-File "..\.github\SESSION-39-PART-C-RESULTS.json"
Write-Host "`nResults saved to: .github\SESSION-39-PART-C-RESULTS.json"
Write-Host "Completed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"
