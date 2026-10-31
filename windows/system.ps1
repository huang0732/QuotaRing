param(
    [ValidateSet('Inspect','StartWorker','RemoveShortcuts','IntegrateOriginal','RestoreOriginal','IntegrationStatus','InstallBackground','RemoveBackground')][string]$Action = 'Inspect',
    [string]$ConfigPath,
    [string]$ShortcutDirectory
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$owner = 'codex-usage-card-windows-v1'
$debugArgs = '--remote-debugging-port=39222 --remote-debugging-address=127.0.0.1'
function Hash-File([string]$file) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($file))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
function Write-Json([string]$file, $data) {
    $temporary = $file + '.tmp'
    [IO.File]::WriteAllText($temporary, ($data | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $file -Force
}
function Assert-PlainPath([string]$file) {
    $current = [IO.Path]::GetFullPath($file)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if (((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Refusing a shortcut or backup path through a reparse point.'
            }
        }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current) { break }
        $current = $parent
    }
}
$packages = @()
try { $packages = @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop) } catch { }
if ($Action -eq 'Inspect') {
    $apps = @()
    foreach ($package in $packages) {
        foreach ($name in @('app\ChatGPT.exe','app\Codex.exe','Codex.exe')) {
            $candidate = Join-Path $package.InstallLocation $name
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $apps += $candidate }
        }
    }
    $running = @()
    foreach ($proc in @(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue)) {
        try {
            $exe = $proc.Path
            if ($exe -and ($exe -match '\\OpenAI\.Codex_[^\\]+\\' -or
                $exe -match '\\(?:Programs\\)?Codex\\(?:ChatGPT|Codex)\.exe$' -or
                $exe -match '\\OpenAI\\Codex\\ChatGPT\.exe$')) {
                $running += @{ pid = $proc.Id; path = $exe }
                $apps += $exe
            }
        } catch { }
    }
    foreach ($root in @($env:LOCALAPPDATA, $env:ProgramFiles)) {
        foreach ($relative in @('Programs\Codex\Codex.exe','Codex\Codex.exe','OpenAI\Codex\ChatGPT.exe')) {
            $candidate = Join-Path $root $relative
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $apps += $candidate }
        }
    }
    @{ apps = @($apps | Select-Object -Unique); running = @($running) } | ConvertTo-Json -Depth 5 -Compress
    exit 0
}
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($config.owner -ne $owner) { throw 'Invalid installation owner' }
$installDir = Split-Path -Parent $ConfigPath
if ([IO.Path]::GetFullPath($installDir) -ine [IO.Path]::GetFullPath($config.installDir)) { throw 'Invalid installation path' }
if ($Action -eq 'StartWorker') {
    $nodePath = $config.nodePath
    $managerPath = Join-Path $installDir 'manage.cjs'
    if (($nodePath + $managerPath + $installDir) -match '["\r\n]') { throw 'Unsupported worker path.' }
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node executable is unavailable.' }
    $startup = ([wmiclass]'\\.\root\cimv2:Win32_ProcessStartup').CreateInstance()
    $startup.ShowWindow = 0
    if ($config.displayMode -eq 'taskbar') { $startup.WinstationDesktop = 'WinSta0\Default' }
    # CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB | CREATE_UNICODE_ENVIRONMENT.
    # The WMI broker, rather than
    # the Codex tool process, owns this long-lived per-user background process.
    $startup.CreateFlags = 0x09000400
    $startup.EnvironmentVariables = @([Environment]::GetEnvironmentVariables().GetEnumerator() |
        Where-Object { -not $_.Key.StartsWith('=') } | ForEach-Object { [string]$_.Key + '=' + [string]$_.Value })
    $command = '"' + $nodePath + '" "' + $managerPath + '" worker --install-dir "' + $installDir + '"'
    # WMI can reject a profile/AppData current directory even when the same user
    # can read it. Every worker path is absolute, so use the system directory.
    $result = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($command, $env:SystemRoot, $startup)
    if ($result.ReturnValue -ne 0) { throw ('Independent worker creation failed: ' + $result.ReturnValue) }
    @{ pid = $result.ProcessId; launchMode = 'wmi-breakaway' } | ConvertTo-Json -Compress
    exit 0
}
$shell = New-Object -ComObject WScript.Shell
$scriptPath = Join-Path $installDir 'launch.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$backgroundArgs = '"' + $scriptPath + '"'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Codex Usage Card Background.lnk'
if ($Action -eq 'RemoveShortcuts') {
    foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Startup'))) {
        $file = Join-Path $folder 'Codex Usage Card.lnk'
        if (-not (Test-Path -LiteralPath $file)) { continue }
        Assert-PlainPath $file
        $link = $shell.CreateShortcut($file)
        if ($link.TargetPath -ine $wscript -or $link.Arguments -cne $backgroundArgs) { throw 'Legacy shortcut belongs to another installation.' }
        Remove-Item -LiteralPath $file
    }
    exit 0
}
if ($Action -eq 'InstallBackground' -or $Action -eq 'RemoveBackground') {
    Assert-PlainPath $startupPath
    if (Test-Path -LiteralPath $startupPath) {
        $link = $shell.CreateShortcut($startupPath)
        if ($link.TargetPath -ine $wscript -or $link.Arguments -cne $backgroundArgs) { throw 'Startup entry belongs to another installation.' }
    }
    if ($Action -eq 'RemoveBackground') {
        if (Test-Path -LiteralPath $startupPath) { Remove-Item -LiteralPath $startupPath }
    } else {
        $link = $shell.CreateShortcut($startupPath)
        $link.TargetPath = $wscript
        $link.Arguments = $backgroundArgs
        $link.WorkingDirectory = $installDir
        $link.Description = 'QuotaRing background helper; does not open Codex'
        $link.Save()
    }
    exit 0
}
$folders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('StartMenu'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'))
if ($ShortcutDirectory) { $folders = @([IO.Path]::GetFullPath($ShortcutDirectory)) }
function Assert-ShortcutPath([string]$file) {
    Assert-PlainPath $file
    $absolute = [IO.Path]::GetFullPath($file)
    if ([IO.Path]::GetExtension($absolute) -ine '.lnk') { throw 'Expected a shell shortcut.' }
    foreach ($folder in $folders) {
        $prefix = [IO.Path]::GetFullPath($folder).TrimEnd('\') + '\'
        if ($absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return }
    }
    throw 'Shortcut lies outside the selected user shortcut folders.'
}
$backupDir = Join-Path $installDir 'shortcut-backups'
$manifestPath = Join-Path $backupDir 'manifest.json'
Assert-PlainPath $backupDir
$manifest = @{ owner = $owner; entries = @() }
if (Test-Path -LiteralPath $manifestPath) {
    Assert-PlainPath $manifestPath
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.owner -ne $owner) { throw 'Invalid shortcut backup ownership.' }
}
$mappedLoginPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Codex - original login.lnk'
if ($ShortcutDirectory) { $mappedLoginPath = Join-Path $ShortcutDirectory 'Codex - original login.lnk' }
$loginReceiptPath = Join-Path $installDir 'login-integration.json'
$loginReceipt = $null
if (Test-Path -LiteralPath $loginReceiptPath) {
    Assert-PlainPath $loginReceiptPath
    $saved = Get-Content -LiteralPath $loginReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($saved.owner -eq $owner -and $saved.managedHash -match '^[a-f0-9]{64}$') { $loginReceipt = $saved }
}
if ($loginReceipt) {
    # Repair a partial win.2 upgrade that mistook our own mapped login entry
    # (inside Start Menu/Programs/Startup) for an original user shortcut.
    $ownedEntries = @($manifest.entries | Where-Object { $_.path -ieq $mappedLoginPath -and
        $_.originalHash -eq $loginReceipt.managedHash -and $_.managedHash -eq $loginReceipt.managedHash })
    foreach ($entry in $ownedEntries) {
        if ($entry.backup -notmatch '^[a-f0-9]{32}\.lnk$') { throw 'Invalid owned login backup.' }
        $backup = Join-Path $backupDir $entry.backup
        Assert-PlainPath $backup
        if ((Hash-File $backup) -ne $entry.originalHash) { throw 'Owned login backup integrity failed.' }
        $manifest.entries = @($manifest.entries | Where-Object { $_.path -ine $mappedLoginPath })
        Write-Json $manifestPath $manifest
        Remove-Item -LiteralPath $backup
    }
}
foreach ($entry in @($manifest.entries)) {
    Assert-ShortcutPath $entry.path
    if ($entry.backup -notmatch '^[a-f0-9]{32}\.lnk$') { throw 'Invalid backup filename.' }
    $backup = Join-Path $backupDir $entry.backup
    Assert-PlainPath $backup
    if (-not (Test-Path -LiteralPath $backup) -or (Hash-File $backup) -ne $entry.originalHash) { throw 'Shortcut backup failed integrity check.' }
}
if ($Action -eq 'IntegrationStatus') {
    $healthy = 0
    foreach ($entry in @($manifest.entries)) {
        if ((Test-Path -LiteralPath $entry.path) -and (Hash-File $entry.path) -eq $entry.managedHash) { $healthy++ }
    }
    $startupHealthy = $false
    if (Test-Path -LiteralPath $startupPath) {
        $link = $shell.CreateShortcut($startupPath)
        $startupHealthy = $link.TargetPath -ieq $wscript -and $link.Arguments -ceq $backgroundArgs
    }
    @{ originalShortcuts = @($manifest.entries).Count; healthyShortcuts = $healthy; backgroundAtLogin = $startupHealthy } | ConvertTo-Json -Compress
    exit 0
}
if ($Action -eq 'RestoreOriginal') {
    foreach ($entry in @($manifest.entries)) {
        if ((Test-Path -LiteralPath $entry.path) -and
            (Hash-File $entry.path) -ne $entry.managedHash -and (Hash-File $entry.path) -ne $entry.originalHash) {
            throw 'An integrated shortcut was edited after installation; backup retained for manual recovery.'
        }
    }
    foreach ($entry in @($manifest.entries)) {
        if (Test-Path -LiteralPath $entry.path) {
            Copy-Item -LiteralPath (Join-Path $backupDir $entry.backup) -Destination $entry.path -Force
        }
        Remove-Item -LiteralPath (Join-Path $backupDir $entry.backup)
    }
    if (Test-Path -LiteralPath $manifestPath) { Remove-Item -LiteralPath $manifestPath }
    if ((Test-Path -LiteralPath $backupDir) -and @(Get-ChildItem -LiteralPath $backupDir -Force).Count -eq 0) { Remove-Item -LiteralPath $backupDir }
    exit 0
}
$target = $config.appPath
$appId = $null
foreach ($package in $packages) {
    if ($config.appPath.StartsWith($package.InstallLocation + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $appId = $package.PackageFamilyName + '!App'
        $alias = Join-Path $env:LOCALAPPDATA ('Microsoft\WindowsApps\' + $package.PackageFamilyName + '\chatgpt-desktop.exe')
        if (Test-Path -LiteralPath $alias -PathType Leaf) { $target = $alias }
        break
    }
}
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Codex desktop target is unavailable.' }
$candidates = @()
foreach ($folder in $folders) {
    if (-not (Test-Path -LiteralPath $folder)) { continue }
    foreach ($file in @(Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -Recurse -ErrorAction Stop)) {
        if ($loginReceipt -and $file.FullName -ieq $mappedLoginPath) { continue }
        $link = $shell.CreateShortcut($file.FullName)
        $direct = $link.TargetPath -ieq $config.appPath -or $link.TargetPath -ieq $target
        $packaged = $appId -and [IO.Path]::GetFileName($link.TargetPath) -ieq 'explorer.exe' -and
            $link.Arguments.Trim('"') -ieq ('shell:AppsFolder\' + $appId)
        if ($direct -or $packaged) { $candidates += @{ path = $file.FullName } }
    }
}
if (-not $candidates.Count -and -not @($manifest.entries).Count) {
    throw 'No existing Codex shortcut was found. Create a normal Codex shortcut, then reinstall the add-on.'
}
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
foreach ($candidate in $candidates) {
    Assert-ShortcutPath $candidate.path
    $entry = @($manifest.entries | Where-Object { $_.path -ieq $candidate.path })
    if ($entry.Count) {
        if ((Hash-File $candidate.path) -ne $entry[0].managedHash -and (Hash-File $candidate.path) -ne $entry[0].originalHash) {
            throw 'An integrated shortcut was edited; leaving it unchanged.'
        }
        $entry = $entry[0]
    } else {
        $backupName = [Guid]::NewGuid().ToString('N') + '.lnk'
        Copy-Item -LiteralPath $candidate.path -Destination (Join-Path $backupDir $backupName)
        $entry = @{ path = $candidate.path; backup = $backupName; originalHash = (Hash-File $candidate.path); managedHash = (Hash-File $candidate.path) }
        $manifest.entries = @($manifest.entries) + @($entry)
        Write-Json $manifestPath $manifest
    }
    $backup = Join-Path $backupDir $entry.backup
    $original = $shell.CreateShortcut($backup)
    $extra = $original.Arguments
    if ($appId -and [IO.Path]::GetFileName($original.TargetPath) -ieq 'explorer.exe') { $extra = '' }
    if ($extra -match '--remote-debugging-(port|address)(=|\s)') { throw 'Existing debugging arguments require manual review.' }
    $pending = Join-Path $backupDir ([Guid]::NewGuid().ToString('N') + '.lnk')
    Copy-Item -LiteralPath $backup -Destination $pending
    $link = $shell.CreateShortcut($pending)
    $link.TargetPath = $target
    $link.Arguments = ($extra + ' ' + $debugArgs).Trim()
    $link.Save()
    $entry.managedHash = Hash-File $pending
    Write-Json $manifestPath $manifest
    Move-Item -LiteralPath $pending -Destination $candidate.path -Force
}
@{ integrated = @($manifest.entries).Count; directClientTarget = $true } | ConvertTo-Json -Compress
