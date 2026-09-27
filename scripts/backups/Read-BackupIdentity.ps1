# Internal local pipe only: the output is secret, never forward to logs/chat.
param([Parameter(Mandatory)][string]$IdentityPath)
$ErrorActionPreference = 'Stop'
$root = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HorecaOS-PrivateBackup'
$full = [IO.Path]::GetFullPath($IdentityPath)
if ([IO.Path]::GetDirectoryName($full) -ne $root -or (Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected identity location.' }
$record = Get-Content -LiteralPath $full -Raw | ConvertFrom-Json
if ($record.endpoint.purpose -ne 'backup-encryption-identity') { throw 'Unexpected secret type.' }
$secure = ConvertTo-SecureString $record.protectedPassword
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Console]::Out.WriteLine([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
