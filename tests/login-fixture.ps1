param([ValidateSet('Init','Inspect','SetState','Integrate','Restore','Status','Destroy')][string]$Action,
    [string]$Directory, [string]$ConfigPath, [string]$SourceScript, [int]$State = 2)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$name = Split-Path -Leaf $Directory
if ($name -notmatch '^\.test-login-[a-f0-9-]+$') { throw 'Invalid isolated registry fixture name.' }
$physical = 'Registry::HKEY_CURRENT_USER\Software\CodexUsageCardTests\' + $name
if ($Action -eq 'Destroy') {
    if (-not $physical.StartsWith('Registry::HKEY_CURRENT_USER\Software\CodexUsageCardTests\.test-login-')) { throw 'Invalid registry cleanup target.' }
    if (Test-Path -LiteralPath $physical) { Remove-Item -LiteralPath $physical -Recurse -Force }
    exit 0
}
if ($Action -eq 'Init') { New-Item -Path $physical -Force | Out-Null }
# Remap this process's HKCU drive to an isolated test subtree. Never touch the actual app's key.
Remove-PSDrive -Name HKCU
New-PSDrive -Name HKCU -PSProvider Registry -Root $physical.Replace('Registry::','') | Out-Null
$key = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\OpenAI.Codex_fixture\App'
$startup = Join-Path $Directory 'startup'
New-Item -ItemType Directory -Path $startup -Force | Out-Null
if ($Action -eq 'Init') {
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -LiteralPath $key -Name State -Value $State -PropertyType DWord -Force | Out-Null
    exit 0
}
if ($Action -eq 'SetState') { Set-ItemProperty -LiteralPath $key -Name State -Value $State; exit 0 }
if ($Action -eq 'Inspect') {
    $linkPath = Join-Path $startup 'Codex - original login.lnk'
    $target = $null; $arguments = $null
    if (Test-Path -LiteralPath $linkPath) {
        $link = (New-Object -ComObject WScript.Shell).CreateShortcut($linkPath)
        $target = $link.TargetPath; $arguments = $link.Arguments
    }
    @{ state = (Get-ItemProperty -LiteralPath $key).State; target = $target; arguments = $arguments } | ConvertTo-Json -Compress
    exit 0
}
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$fixturePackage = @{ InstallLocation = (Split-Path -Parent $config.appPath); PackageFamilyName = 'OpenAI.Codex_fixture' }
function Get-AppxPackage { param($Name, $ErrorAction) return [pscustomobject]$fixturePackage }
& $SourceScript -Action $Action -ConfigPath $ConfigPath -StartupDirectory $startup
