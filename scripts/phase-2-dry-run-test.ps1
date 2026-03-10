#!/usr/bin/env pwsh
# Phase 2 Test Script - Upload to Model API
# Date: March 7, 2026 10:51 PM ET
# Test on Projects 07, 37, 51 with dry-run first

$ErrorActionPreference = "Stop"
$testResults = @()

Write-Host "`n" + "="*70
Write-Host "PHASE 2: UPLOAD-TO-MODEL - DRY-RUN TEST (10:51 PM ET)"
Write-Host "="*70

$testProjects = @('07-foundation-layer', '37-data-model', '51-ACA')
$veritas = 'C:\AICOE\eva-foundry\48-eva-veritas'

foreach ($project in $testProjects) {
    $repoPath = "C:\AICOE\eva-foundry\$project"
    Write-Host "`n[TEST] Project: $project"
    Write-Host "       Repo: $repoPath"
    
    # Verify extraction file exists
    $exportFile = Join-Path $repoPath '.eva\model-export.json'
    if (-not (Test-Path $exportFile)) {
        Write-Host "       ❌ ERROR: model-export.json not found"
        $testResults += [PSCustomObject]@{
            Project = $project
            Status = "FAILED"
            Reason = "No model-export.json"
        }
        continue
    }
    
    # Check constraints
    $data = Get-Content $exportFile | ConvertFrom-Json
    $wbsCount = @($data.wbs).Count
    $evidenceCount = @($data.evidence).Count
    $decisionsCount = @($data.decisions).Count
    $risksCount = @($data.risks).Count
    
    Write-Host "       ✓ Found: WBS=$wbsCount, Evidence=$evidenceCount, Decisions=$decisionsCount, Risks=$risksCount"
    
    # Run dry-run test
    Write-Host "       → Running dry-run upload..."
    try {
        # Note: This will test the command itself, not the actual API upload (since we can't modify API structure in this test)
        $output = & node "$veritas\src\cli.js" upload-to-model --repo $repoPath --dry-run 2>&1
        
        #Check for success markers
        if ($output -match "DRY-RUN MODE" -and $output -match "SUMMARY") {
            Write-Host "       ✅ PASS: Dry-run completed successfully"
            $testResults += [PSCustomObject]@{
                Project = $project
                Status = "DRY-RUN PASS"
                Records = "$wbsCount WBS, $evidenceCount Evidence, $decisionsCount Decisions, $risksCount Risks"
            }
        } else {
            Write-Host "       ⚠️  WARNING: Unexpected output format"
            Write-Host "       Output: $($output | Select-Object -First 5)"
            $testResults += [PSCustomObject]@{
                Project = $project
                Status = "DRY-RUN WARNING"
                Reason = "Unexpected output"
            }
        }
    } catch {
        Write-Host "       ❌ ERROR: $_"
        $testResults += [PSCustomObject]@{
            Project = $project
            Status = "FAILED"
            Reason = $_.Exception.Message
        }
    }
}

# Summary
Write-Host "`n" + "="*70
Write-Host "TEST SUMMARY (Dry-Run Phase)"
Write-Host "="*70
$testResults | Format-Table -AutoSize

$passCount = @($testResults | Where-Object { $_.Status -like "*PASS*" }).Count
$totalCount = $testResults.Count

Write-Host "`nResults: $passCount/$totalCount passed"
if ($passCount -eq $totalCount) {
    Write-Host "✅ All tests passed! Ready for actual upload.`n"
    exit 0
} else {
    Write-Host "⚠️  Some tests failed. Review errors above.`n"
    exit 1
}
