$ErrorActionPreference = 'Stop'
$root = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HorecaOS-PrivateBackup'
$file = Join-Path $root 'backup-report-token.dpapi'
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe credential directory' }
if (Test-Path -LiteralPath $file) { throw 'Credential already exists; it has not been changed' }
$token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$secure = ConvertTo-SecureString $token -AsPlainText -Force
try { $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $file -Encoding utf8 } finally { $secure.Dispose(); $token=$null }
Write-Output 'Reporting credential saved locally with Windows encryption.'
