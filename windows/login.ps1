param([ValidateSet('Integrate','Restore','Status')][string]$Action, [string]$ConfigPath, [string]$StartupDirectory)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$owner = 'codex-usage-card-windows-v1'
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$dir = Split-Path -Parent $ConfigPath
if ($config.owner -ne $owner -or [IO.Path]::GetFullPath($config.installDir) -ine [IO.Path]::GetFullPath($dir)) { throw 'Invalid installation.' }
$receiptPath = Join-Path $dir 'login-integration.json'
$receipt = $null
if (Test-Path -LiteralPath $receiptPath) { $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json }
if (-not $StartupDirectory) { $StartupDirectory = [Environment]::GetFolderPath('Startup') }
$linkPath = Join-Path $StartupDirectory 'Codex - original login.lnk'
$shell = New-Object -ComObject WScript.Shell
function Hash-File([string]$file) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($file))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
foreach ($file in @($receiptPath, $linkPath)) {
    if ((Test-Path -LiteralPath $file) -and ((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing a linked receipt or startup file.' }
}
$family = $null
$target = $config.appPath
if ($receipt) {
    if ($receipt.owner -ne $owner -or $receipt.family -notmatch '^OpenAI\.Codex_[a-z0-9]+$' -or $receipt.originalState -ne 2) { throw 'Invalid login integration receipt.' }
    $family = $receipt.family
} else {
    try {
        foreach ($package in @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop)) {
            if ($config.appPath.StartsWith($package.InstallLocation + '\', [StringComparison]::OrdinalIgnoreCase)) { $family = $package.PackageFamilyName; break }
        }
    } catch { }
}
if (-not $family) {
    if ($Action -eq 'Status') { @{ nativeLoginMapped = $false; clientLoginHealthy = $true } | ConvertTo-Json -Compress }
    exit 0
}
if ($family -notmatch '^OpenAI\.Codex_[a-z0-9]+$') { throw 'Unexpected Codex package identity.' }
$key = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\' + $family + '\App'
$nativeState = $null
if (Test-Path -LiteralPath $key) { $nativeState = (Get-ItemProperty -LiteralPath $key).State }
if ($Action -eq 'Status') {
    $healthy = -not $receipt -or ($nativeState -eq 0 -and (Test-Path -LiteralPath $linkPath) -and (Hash-File $linkPath) -eq $receipt.managedHash)
    @{ nativeLoginMapped = [bool]$receipt; clientLoginHealthy = [bool]$healthy } | ConvertTo-Json -Compress
    exit 0
}
if ($receipt -and (Test-Path -LiteralPath $linkPath) -and (Hash-File $linkPath) -ne $receipt.managedHash) {
    throw 'The mapped Codex login shortcut was edited; leaving it and the receipt unchanged.'
}
if ($Action -eq 'Restore') {
    if ($receipt) {
        # Do not overwrite a subsequent user/policy change to the native startup state.
        if ($nativeState -eq 0) { Set-ItemProperty -LiteralPath $key -Name State -Value $receipt.originalState }
        if (Test-Path -LiteralPath $linkPath) { Remove-Item -LiteralPath $linkPath }
        Remove-Item -LiteralPath $receiptPath
    }
    exit 0
}
if ($nativeState -eq 4) { throw 'Codex login startup is enforced by policy; leaving that policy unchanged.' }
if (-not $receipt -and $nativeState -ne 2) { exit 0 }
if ($receipt -and $nativeState -notin @(0,2)) { throw 'Native Codex login preference changed after integration; manual review is needed.' }
if (-not $receipt -and (Test-Path -LiteralPath $linkPath)) { throw 'The Codex login shortcut name is already occupied.' }
$alias = Join-Path $env:LOCALAPPDATA ('Microsoft\WindowsApps\' + $family + '\chatgpt-desktop.exe')
if (Test-Path -LiteralPath $alias -PathType Leaf) { $target = $alias }
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Codex executable is unavailable.' }
$pending = Join-Path $dir 'login-pending.lnk'
if (Test-Path -LiteralPath $pending) { throw 'An incomplete login integration needs review.' }
$link = $shell.CreateShortcut($pending)
$link.TargetPath = $target
$link.Arguments = '--remote-debugging-port=39222 --remote-debugging-address=127.0.0.1'
$link.IconLocation = $config.appPath + ',0'
$link.Description = 'Preserves the existing Codex login startup with usage card support'
$link.Save()
$next = @{ owner = $owner; family = $family; originalState = 2; managedHash = (Hash-File $pending) }
$temporary = $receiptPath + '.tmp'
[IO.File]::WriteAllText($temporary, ($next | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temporary -Destination $receiptPath -Force
Move-Item -LiteralPath $pending -Destination $linkPath -Force
# The replacement launch entry is durable before disabling the old duplicate entry.
Set-ItemProperty -LiteralPath $key -Name State -Value 0
