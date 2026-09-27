# Internal pipe only. Never print this script's output in logs or chat.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'HorecaOS-PrivateBackup'
$file = Join-Path $root 'backup-report-token.dpapi'
foreach ($item in @($root,$file)) { if ((Get-Item -LiteralPath $item).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe credential path' } }
$secure = (Get-Content -LiteralPath $file -Raw).Trim() | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
