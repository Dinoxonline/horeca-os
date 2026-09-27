# Deterministic local backup runner. Produces only encrypted archives and non-sensitive manifests.
[CmdletBinding()]
param([ValidateSet('Hourly','Daily','Full','PrivateOnly','CheckOnly')][string]$Mode='Hourly')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$repo='D:/CodexData/2026-09-04/ik/horeca-os-agenda-nav-0926'
$privateDir='C:/Users/Dino Veldkamp/AppData/Local/HorecaOS-PrivateBackup'
$dropbox='D:/Dropbox (Persoonlijk)/Horeca OS Backups/Automatisch'
$node='C:/Program Files/nodejs/node.exe'
$pwsh='C:/Users/Dino Veldkamp/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
$pgBin='D:/CodexData/2026-09-04/ik/horeca-backup-tools-20260927/postgresql-17.11/pgsql/bin'
$ageDir='D:/CodexData/2026-09-04/ik/horeca-backup-tools-20260927/age-v1.3.2/age'
$dbCredential=Join-Path $privateDir 'connection-20260927T014825859Z-1b138fce0a3b40fc82601b20cf6af422.json'
$apiCredential=Join-Path $privateDir 'connection-20260927T095147213Z-5a31150d2e084dd68b3dfe11658e18d8.json'
$quotes='D:/Dropbox (Persoonlijk)/Le Club BBQ/Management/Verhuur locatie/Offertes'
$lockPath=Join-Path $privateDir 'automatic-backup.lock'
$lock=$null
$runId=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$runDir=Join-Path $privateDir ('automatic-runs/'+$runId)
$result=[ordered]@{formatVersion=1;runId=$runId;mode=$Mode;startedAt=[DateTime]::UtcNow.ToString('o');ok=$false;components=@();dropboxFolder=$dropbox;retentionApplied=$false;productionWrites=$false}

function Assert-File([string]$Path){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "Required file missing: $Path"}}
function Invoke-Component([string]$Name,[string[]]$Arguments){
    $lines=@(& $node @Arguments 2>&1)
    if($LASTEXITCODE -ne 0){throw "$Name failed"}
    $parsed=$null
    foreach($line in $lines){
        try{
            $candidate=$line|ConvertFrom-Json -ErrorAction Stop
            $hasOk=$null -ne $candidate.PSObject.Properties['ok'] -and $candidate.ok -eq $true
            $hasPartial=$null -ne $candidate.PSObject.Properties['partialBackupCreated'] -and $candidate.partialBackupCreated -eq $true
            if($hasOk -or $hasPartial){$parsed=$candidate}
        }catch{}
    }
    if($null -eq $parsed){throw "$Name did not produce a success record"}
    return $parsed
}
function Invoke-ComponentWithRetry([string]$Name,[string[]]$Arguments,[int]$Attempts=3){
    for($attempt=1;$attempt -le $Attempts;$attempt++){
        try{return Invoke-Component $Name $Arguments}
        catch{
            if($attempt -eq $Attempts){throw}
            # Supabase can keep a disconnected pooler backend briefly. The dedicated
            # backup role automatically clears it after 60 seconds.
            Start-Sleep -Seconds 70
        }
    }
}
function Copy-Verified([string]$Source,[string]$TargetName,[string]$Component){
    Assert-File $Source
    $target=Join-Path $dropbox $TargetName
    if(Test-Path -LiteralPath $target){throw "Destination already exists: $TargetName"}
    [IO.File]::Copy($Source,$target,$false)
    $sourceHash=(Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLowerInvariant()
    $targetHash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if($sourceHash -cne $targetHash){throw "Dropbox copy verification failed: $TargetName"}
    $result.components += [ordered]@{component=$Component;file=$TargetName;bytes=(Get-Item -LiteralPath $target).Length;sha256=$targetHash;copyVerified=$true}
}
function Copy-ComponentDirectory([string]$OutDir,[string]$Prefix,[string]$Component){
    $archives=@(Get-ChildItem -LiteralPath $OutDir -File | Where-Object {$_.Name -like '*.age'})
    $manifests=@(Get-ChildItem -LiteralPath $OutDir -File | Where-Object {$_.Name -like '*.json' -and $_.Name -notlike 'FAILED*'})
    if($archives.Count -lt 1 -or $manifests.Count -lt 1){throw "$Component output incomplete"}
    foreach($file in @($archives+$manifests)){
        Copy-Verified $file.FullName ($Prefix+'-'+$file.Name) $Component
    }
}

try{
    foreach($path in @($node,$pwsh,(Join-Path $pgBin 'pg_dump.exe'),(Join-Path $ageDir 'age.exe'),$dbCredential,(Join-Path $privateDir 'backup-encryption.json'))){Assert-File $path}
    if(-not(Test-Path -LiteralPath $quotes -PathType Container)){throw 'Quotation folder missing'}
    [IO.Directory]::CreateDirectory($runDir)|Out-Null
    [IO.Directory]::CreateDirectory($dropbox)|Out-Null
    $lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    if($Mode -eq 'CheckOnly'){$result.ok=$true;return}

    if($Mode -in @('Hourly','Daily','Full')){
        $db=Invoke-ComponentWithRetry 'database-core' @((Join-Path $repo 'scripts/backups/runtime/export-partial.mjs'),$pgBin,$ageDir,$pwsh,$privateDir,'core') 3
        Copy-ComponentDirectory $db.outDir ("HorecaOS-AUTOMATISCH-$runId-database-core") 'application-database-core'
        if($Mode -ne 'Hourly'){
            $history=Invoke-ComponentWithRetry 'database-history' @((Join-Path $repo 'scripts/backups/runtime/export-history.mjs'),$pwsh,$ageDir,$privateDir,$dbCredential) 2
            Copy-ComponentDirectory $history.outDir ("HorecaOS-AUTOMATISCH-$runId-database-history") 'application-database-history'
        }
    }
    if($Mode -eq 'Full'){
        Assert-File $apiCredential
        $managed=Invoke-Component 'managed-and-public-storage' @((Join-Path $repo 'scripts/backups/runtime/export-supplement.mjs'),$pwsh,$ageDir,$privateDir,$apiCredential)
        Copy-ComponentDirectory $managed.outDir ("HorecaOS-AUTOMATISCH-$runId-managed-media") 'managed-data-and-public-media'
    }
    if($Mode -in @('Daily','Full','PrivateOnly')){
        $private=Invoke-Component 'private-storage' @((Join-Path $repo 'scripts/backups/runtime/export-private-storage.mjs'),$pwsh,$ageDir,$privateDir,$dbCredential)
        Copy-Verified $private.archivePath ("HorecaOS-AUTOMATISCH-$runId-private-media.age") 'private-media'
        Copy-Verified $private.manifestPath ("HorecaOS-AUTOMATISCH-$runId-private-media.manifest.json") 'private-media'
    }
    if($Mode -eq 'Full'){
        $source=Invoke-Component 'source-and-quotes' @((Join-Path $repo 'scripts/backups/runtime/export-source-quotes.mjs'),$pwsh,$ageDir,$privateDir,$repo,$quotes)
        Copy-ComponentDirectory $source.outDir ("HorecaOS-AUTOMATISCH-$runId-source-quotes") 'source-and-quotations'
    }
    $result.ok=$true
} catch {
    $result.error=if($_.Exception.Message -match 'expired'){ 'READ_CREDENTIAL_EXPIRED' } else { 'AUTOMATIC_BACKUP_FAILED' }
    $result.failureComponent=$_.Exception.Message
    throw
} finally {
    $result.completedAt=[DateTime]::UtcNow.ToString('o')
    [IO.Directory]::CreateDirectory($runDir)|Out-Null
    $report=Join-Path $runDir 'RUN-RESULT.json'
    if ($Mode -eq 'Hourly') {
        # Only sanitized status metadata is sent. Backup-reader rights stay read-only.
        $result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $report -Encoding utf8
        try {
            $delivery=@(& $node (Join-Path $repo 'scripts/backups/runtime/report-status.mjs') $report $pwsh 2>&1)
            $result.statusReported=($LASTEXITCODE -eq 0)
        } catch { $result.statusReported=$false }
        if (-not $result.statusReported) { Write-Warning 'Back-upstatus kon niet aan Horeca OS worden doorgegeven.' }
    }
    $result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $report -Encoding utf8
    if(Test-Path -LiteralPath $dropbox -PathType Container){
        $reportTarget=Join-Path $dropbox ("HorecaOS-AUTOMATISCH-$runId-RUN-RESULT.json")
        if(-not(Test-Path -LiteralPath $reportTarget)){[IO.File]::Copy($report,$reportTarget,$false)}
    }
    if($lock){
        $lock.Dispose()
        if(Test-Path -LiteralPath $lockPath){Remove-Item -LiteralPath $lockPath -Force}
    }
    $result|ConvertTo-Json -Depth 8 -Compress
}
