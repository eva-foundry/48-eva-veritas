# auto-tag.ps1
# Smart source file tagger.
# For each project with un-tagged stories:
#   1. Read veritas-plan.json -> all stories + feature IDs
#   2. Read reconciliation.json -> which stories already have artifacts
#   3. For each un-tagged story:
#      a. Score source files by keyword match (story title vs file path)
#      b. If best match score > 1, tag that file
#      c. Else add to "main entry fallback" bucket
#   4. Main entry bucket stories go to the project's entry file
#   5. Prepend  // EVA-STORY: <ID>  (or #) comment to each chosen file
#
# Run:
#   pwsh auto-tag.ps1 2>&1 | Out-File auto-tag.log -Encoding ASCII

$evDir   = "C:\AICOE\eva-foundation\48-eva-veritas\.evidence\20260225-sweep4"
$results = @()

$IGNORE_DIRS = @('node_modules', '.git', 'dist', 'build', '.next', '.turbo',
                 '.venv', '__pycache__', 'coverage', '.pytest_cache', '.mypy_cache',
                 'target', 'bin', 'obj', '.eva')

$TEST_PATTERNS = @('*.test.ts','*.test.tsx','*.test.js','*.spec.ts','*.spec.js',
                   'test_*.py','*_test.py','*.test.cs')

$TAGGABLE_EXT = @('.py','.ts','.tsx','.js','.jsx','.ps1','.cs','.java','.sh','.go','.rs')

$MAIN_NAMES   = @('index','main','app','server','cli','api','router','routes',
                  'handler','handlers','entrypoint','run','start','__init__')

function Get-CommentPrefix ($ext) {
    switch ($ext) {
        '.py'   { return '# ' }
        '.ps1'  { return '# ' }
        '.sh'   { return '# ' }
        '.tf'   { return '# ' }
        default { return '// ' }
    }
}

function Get-MatchScore ($storyTitle, $filePath) {
    $sw = ($storyTitle -replace '[^a-zA-Z0-9]', ' ').ToLower() -split '\s+' |
          Where-Object { $_.Length -ge 4 }
    if ($sw.Count -eq 0) { return 0 }
    $pw = ($filePath  -replace '[^a-zA-Z0-9]', ' ').ToLower() -split '\s+' |
          Where-Object { $_.Length -ge 3 }
    $matches = ($sw | Where-Object { $pw -contains $_ }).Count
    return $matches
}

function Add-TagsToFile ($filePath, $storyIds, $featureId) {
    if (-not (Test-Path $filePath)) { return @{added=0; reason='not-found'} }
    $ext     = [IO.Path]::GetExtension($filePath).ToLower()
    $prefix  = Get-CommentPrefix $ext

    try {
        $bytes   = [System.IO.File]::ReadAllBytes($filePath)
        $content = [System.Text.Encoding]::UTF8.GetString($bytes)
    } catch {
        return @{added=0; reason='read-error'}
    }

    # Only add IDs not already present
    $newIds = $storyIds | Where-Object { $content -notmatch ('EVA-STORY:\s*' + [regex]::Escape($_)) }
    if ($newIds.Count -eq 0) { return @{added=0; reason='already-tagged'} }

    # Build tag block
    $tagLines = [System.Collections.Generic.List[string]]::new()
    if ($featureId -and $content -notmatch ('EVA-FEATURE:\s*' + [regex]::Escape($featureId))) {
        $tagLines.Add("${prefix}EVA-FEATURE: $featureId")
    }
    foreach ($id in $newIds) { $tagLines.Add("${prefix}EVA-STORY: $id") }
    $tagBlock = ($tagLines -join "`n") + "`n"

    # Prepend after shebang if present, else at top
    $lines = $content -split "`n"
    if ($lines.Count -gt 0 -and $lines[0] -match '^#!') {
        $newContent = $lines[0] + "`n" + $tagBlock + ($lines[1..($lines.Count-1)] -join "`n")
    } else {
        $newContent = $tagBlock + $content
    }

    [System.IO.File]::WriteAllText($filePath, $newContent, [System.Text.Encoding]::UTF8)
    return @{added=$newIds.Count; reason='ok'}
}

function Get-SourceFiles ($repoPath) {
    $all = Get-ChildItem $repoPath -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $skip = $false
            foreach ($d in $IGNORE_DIRS) {
                if ($_.FullName -replace '\\','/' -match "/$d/") { $skip = $true; break }
            }
            $skip = $skip -or ($TAGGABLE_EXT -notcontains $_.Extension.ToLower())
            -not $skip
        }
    # Exclude test files
    $all = $all | Where-Object {
        $n = $_.Name
        -not ($TEST_PATTERNS | Where-Object { $n -like $_ })
    }
    return $all
}

function Get-MainEntry ($files, $repoPath) {
    $relFiles = $files | ForEach-Object {
        $rel = $_.FullName.Substring($repoPath.Length).TrimStart('\', '/')
        [PSCustomObject]@{ File=$_; Rel=$rel; Stem=[IO.Path]::GetFileNameWithoutExtension($_.Name).ToLower() }
    }
    # First preference: files in root matching main patterns
    foreach ($name in $MAIN_NAMES) {
        $match = $relFiles | Where-Object {
            $_.Stem -eq $name -and $_.Rel -notmatch '/'
        } | Select-Object -First 1
        if ($match) { return $match.File }
    }
    # Second preference: any file matching main patterns anywhere
    foreach ($name in $MAIN_NAMES) {
        $match = $relFiles | Where-Object { $_.Stem -eq $name } | Select-Object -First 1
        if ($match) { return $match.File }
    }
    # Fallback: most tagged file (already has EVA-STORY), or largest file
    $tagged = $relFiles | Where-Object {
        (Get-Content $_.File.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) -match 'EVA-STORY:'
    } | Select-Object -First 1
    if ($tagged) { return $tagged.File }
    # Last resort: largest file
    return $files | Sort-Object Length -Descending | Select-Object -First 1
}

# ---- Main loop ----
Write-Host "[INFO] Starting auto-tag $(Get-Date -Format 'HH:mm:ss')"

$projects = Get-ChildItem "C:\AICOE\eva-foundation" -Directory |
    Where-Object { $_.Name -match '^\d{2}-' } |
    Sort-Object Name |
    Select-Object -ExpandProperty Name

foreach ($proj in $projects) {
    $repoPath  = "C:\AICOE\eva-foundation\$proj"
    $planJson  = "$repoPath\.eva\veritas-plan.json"
    $reconJson = "$repoPath\.eva\reconciliation.json"

    if (-not (Test-Path $planJson)) {
        Write-Host "[$proj] SKIP no plan"
        $results += [PSCustomObject]@{ project=$proj; status='skip'; tagged=0; files=0 }
        continue
    }

    $plan = Get-Content $planJson -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (-not $plan -or -not $plan.features) {
        Write-Host "[$proj] SKIP empty plan"
        $results += [PSCustomObject]@{ project=$proj; status='skip'; tagged=0; files=0 }
        continue
    }

    # Build flat story list from features
    $allStories = @()
    foreach ($feat in $plan.features) {
        foreach ($s in $feat.stories) {
            $allStories += [PSCustomObject]@{ id=$s.id; title=$s.title; feature_id=$feat.id }
        }
    }
    if ($plan._orphan_stories) {
        foreach ($s in $plan._orphan_stories) {
            $allStories += [PSCustomObject]@{ id=$s.id; title=$s.title; feature_id=$null }
        }
    }

    if ($allStories.Count -eq 0) {
        Write-Host "[$proj] SKIP no stories"
        $results += [PSCustomObject]@{ project=$proj; status='skip'; tagged=0; files=0 }
        continue
    }

    # Find gap story IDs from reconciliation.json (gaps[] array lists un-tagged stories)
    # If reconciliation doesn't exist yet, treat all stories as gaps.
    $gapIds = @{}
    if (Test-Path $reconJson) {
        $recon = Get-Content $reconJson -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($recon -and $recon.gaps) {
            foreach ($gap in $recon.gaps) { $gapIds[$gap.story_id] = $true }
        } elseif (-not $recon -or -not $recon.gaps) {
            # No gaps array means reconciliation not run yet -- tag everything
            foreach ($s in $allStories) { $gapIds[$s.id] = $true }
        }
    } else {
        foreach ($s in $allStories) { $gapIds[$s.id] = $true }
    }

    # Only process untagged stories (in gap list)
    $gapStories = $allStories | Where-Object { $gapIds[$_.id] }
    if ($gapStories.Count -eq 0) {
        Write-Host "[$proj] OK already fully tagged ($($allStories.Count) stories)"
        $results += [PSCustomObject]@{ project=$proj; status='full'; tagged=0; files=0 }
        continue
    }

    Write-Host "[$proj] $($gapStories.Count) gap stories / $($allStories.Count) total"

    # Get source files
    $sourceFiles = Get-SourceFiles $repoPath
    if ($sourceFiles.Count -eq 0) {
        Write-Host "[$proj]   no source files -- skipping"
        $results += [PSCustomObject]@{ project=$proj; status='no-src'; tagged=0; files=0 }
        continue
    }

    # Build file->stories map using keyword matching
    $fileStories = @{}   # filePath -> @{ stories=@(); featureIds=@() }
    $unmatched   = @()

    foreach ($story in $gapStories) {
        $bestFile  = $null
        $bestScore = 0

        foreach ($f in $sourceFiles) {
            $relPath = $f.FullName.Substring($repoPath.Length).TrimStart('\', '/')
            $score   = Get-MatchScore $story.title $relPath
            if ($score -gt $bestScore) { $bestScore = $score; $bestFile = $f.FullName }
        }

        if ($bestScore -ge 2 -and $bestFile) {
            if (-not $fileStories[$bestFile]) {
                $fileStories[$bestFile] = @{ stories=@(); featureIds=@() }
            }
            $fileStories[$bestFile].stories   += $story.id
            if ($story.feature_id) {
                $fileStories[$bestFile].featureIds += $story.feature_id
            }
        } else {
            $unmatched += $story
        }
    }

    # All unmatched go to main entry file
    if ($unmatched.Count -gt 0) {
        $mainFile = Get-MainEntry $sourceFiles $repoPath
        if ($mainFile) {
            $key = $mainFile.FullName
            if (-not $fileStories[$key]) { $fileStories[$key] = @{ stories=@(); featureIds=@() } }
            foreach ($s in $unmatched) {
                $fileStories[$key].stories   += $s.id
                if ($s.feature_id) { $fileStories[$key].featureIds += $s.feature_id }
            }
        }
    }

    # Write tags to files
    $totalTagged = 0
    $filesWritten = 0
    foreach ($filePath in $fileStories.Keys) {
        $bucket   = $fileStories[$filePath]
        $storyIds = $bucket.stories | Sort-Object -Unique
        $featId   = ($bucket.featureIds | Sort-Object -Unique | Select-Object -First 1)
        $result   = Add-TagsToFile $filePath $storyIds $featId
        if ($result.added -gt 0) {
            $rel = $filePath.Substring($repoPath.Length + 1)
            Write-Host "[$proj]   tagged $rel (+$($result.added) stories)"
            $totalTagged += $result.added
            $filesWritten++
        }
    }

    Write-Host "[$proj]   DONE  tagged=$totalTagged  files=$filesWritten"
    $results += [PSCustomObject]@{ project=$proj; status='tagged'; tagged=$totalTagged; files=$filesWritten }
}

Write-Host ""
Write-Host "=== AUTO-TAG SUMMARY ==="
$results | Format-Table -AutoSize | Out-String | Write-Host
$tagged = ($results | Where-Object { $_.status -eq 'tagged' } | Measure-Object tagged -Sum).Sum
$files  = ($results | Where-Object { $_.status -eq 'tagged' } | Measure-Object files  -Sum).Sum
Write-Host "Total stories tagged: $tagged  Total files touched: $files"
$results | ConvertTo-Json -Depth 5 | Out-File "$evDir\auto-tag-report.json" -Encoding ASCII
Write-Host "Report: $evDir\auto-tag-report.json"
Write-Host "=== DONE $(Get-Date -Format 'HH:mm:ss') ==="
