param([ValidateSet('Create','CreatePackaged','CreateOwnedLogin','Inspect','Edit')][string]$Action, [string]$Directory, [string]$AppPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$shell = New-Object -ComObject WScript.Shell
$file = Join-Path $Directory 'Codex.lnk'
if ($Action -eq 'Create' -or $Action -eq 'CreatePackaged') {
    $link = $shell.CreateShortcut($file)
    $link.TargetPath = $AppPath
    $link.Arguments = '--fixture'
    if ($Action -eq 'CreatePackaged') {
        $package = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
        if (-not $package) { throw 'Codex package is required for this isolated fixture.' }
        $link.TargetPath = Join-Path $env:SystemRoot 'explorer.exe'
        $link.Arguments = 'shell:AppsFolder\' + $package.PackageFamilyName + '!App'
    }
    $link.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',5'
    $link.Description = 'Original shortcut description'
    $link.Hotkey = 'CTRL+ALT+F12'
    $link.Save()
    $other = $shell.CreateShortcut((Join-Path $Directory 'Unrelated.lnk'))
    $other.TargetPath = Join-Path $env:SystemRoot 'explorer.exe'
    $other.Arguments = 'C:\'
    $other.Save()
} elseif ($Action -eq 'CreateOwnedLogin') {
    $link = $shell.CreateShortcut((Join-Path $Directory 'Codex - original login.lnk'))
    $link.TargetPath = $AppPath
    $link.Arguments = '--remote-debugging-port=39222 --remote-debugging-address=127.0.0.1'
    $link.Save()
} elseif ($Action -eq 'Edit') {
    $link = $shell.CreateShortcut($file)
    $link.Arguments += ' --user-edited'
    $link.Save()
} else {
    $link = $shell.CreateShortcut($file)
    @{ target = $link.TargetPath; arguments = $link.Arguments; icon = $link.IconLocation;
        description = $link.Description; hotkey = $link.Hotkey } | ConvertTo-Json -Compress
}
