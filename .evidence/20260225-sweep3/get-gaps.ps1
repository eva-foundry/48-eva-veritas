$projects = @('33-eva-brain-v2','37-data-model','29-foundry','44-eva-jp-spark',
              '45-aicoe-page','46-accelerator','48-eva-veritas','49-eva-dtl',
              '38-ado-poc','43-spark')
$out = @()
foreach ($p in $projects) {
    $rf = "C:\AICOE\eva-foundation\$p\.eva\reconciliation.json"
    if (Test-Path $rf) {
        $r = Get-Content $rf -Raw | ConvertFrom-Json
        $gapIds = $r.gaps | ForEach-Object { $_.story_id }
        $line = "$p gaps=$($r.gaps.Count) covered=$($r.coverage.stories_with_artifacts) total=$($r.coverage.stories_total)"
        $out += $line
        $r.gaps | ForEach-Object { "  GAP: $($_.story_id) -- $($_.title)" } | ForEach-Object { $out += $_ }
    } else {
        $out += "$p : no reconciliation.json"
    }
}
$out | Set-Content "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep3\gap-summary.txt" -Encoding ASCII
