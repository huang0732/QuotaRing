$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $projectRoot 'dist'
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$archive = Join-Path $dist ('QuotaRing-Windows-x64-v' + $version + '.zip')
$checksum = Join-Path $dist 'SHA256SUMS.txt'
$files = @('agent.cjs','manage.cjs','package.json','package-lock.json','LICENSE','README.md','CHANGELOG.md','SECURITY.md','windows','docs','tests','scripts','vendor\UPSTREAM.md')
$entries = @(Get-ChildItem -LiteralPath $projectRoot -Filter '*-Windows.cmd' -File | ForEach-Object { $_.Name })
if ($entries.Count -ne 4) { throw 'Expected four Windows entry scripts in the project root.' }
$files += $entries
$panelFiles = @('CodexUsagePanel.exe','panel.html','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','WEBVIEW2-LICENSE.txt')
$required = @($files) + @($panelFiles | ForEach-Object { 'windows\panel\bin\' + $_ })
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $projectRoot $_)) })
if ($missing.Count) { throw ('Build the panel first with npm run build:panel. Missing files: ' + ($missing -join ', ')) }
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$stage = Join-Path $dist ('build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$previous = Get-Location
try {
    foreach ($relative in @($files | Select-Object -Unique)) {
        $destination = Join-Path $stage $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $projectRoot $relative) -Destination $destination -Recurse
    }
    Set-Location -LiteralPath $stage
    Compress-Archive -Path '.\*' -DestinationPath $archive -Force
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($archive))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
    [IO.File]::WriteAllText($checksum, "$digest  $([IO.Path]::GetFileName($archive))`n", (New-Object Text.UTF8Encoding($false)))
    Write-Output $archive
    Write-Output "SHA256: $digest"
} finally {
    Set-Location -LiteralPath $previous
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    $distPrefix = [IO.Path]::GetFullPath($dist) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStage.StartsWith($distPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Staging path escaped dist' }
    if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
