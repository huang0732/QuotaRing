$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$FilePath) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($FilePath)
    try { return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $projectRoot ('dist\v' + $version)
$archive = Join-Path $dist ('QuotaRing-Windows-x64-v' + $version + '.zip')
$checksum = Join-Path $dist 'SHA256SUMS.txt'
$runtimeManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-runtime.json') -Raw | ConvertFrom-Json
$runtimeCache = Join-Path $projectRoot ('artifacts\node-runtime-' + $runtimeManifest.version)
$nodeArchive = Join-Path $projectRoot ('artifacts\' + $runtimeManifest.archive)
$nodeExtraction = Join-Path $runtimeCache 'archive'
$nodeRoot = Join-Path $nodeExtraction ('node-v' + $runtimeManifest.version + '-win-x64')
$nodeExecutable = Join-Path $nodeRoot 'node.exe'
$nodeLicense = Join-Path $nodeRoot 'LICENSE'
$files = @('agent.cjs','manage.cjs','package.json','package-lock.json','LICENSE','README.md','CHANGELOG.md','SECURITY.md','windows','docs','tests','scripts','vendor\UPSTREAM.md')
$entries = @(Get-ChildItem -LiteralPath $projectRoot -Filter '*-Windows.cmd' -File | ForEach-Object { $_.Name })
if ($entries.Count -ne 4) { throw 'Expected four Windows entry scripts in the project root.' }
$files += $entries
$panelFiles = @('CodexUsagePanel.exe','panel.html','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','WEBVIEW2-LICENSE.txt')
$required = @($files) + @($panelFiles | ForEach-Object { 'windows\panel\bin\' + $_ })
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $projectRoot $_)) })
if ($missing.Count) { throw ('Build the panel first with npm run build:panel. Missing files: ' + ($missing -join ', ')) }
New-Item -ItemType Directory -Path (Split-Path -Parent $nodeArchive) -Force | Out-Null
$cachedDigest = if (Test-Path -LiteralPath $nodeArchive -PathType Leaf) {
    Get-Sha256 $nodeArchive
} else { '' }
if ($cachedDigest -ne $runtimeManifest.sha256) {
    $download = Join-Path (Split-Path -Parent $nodeArchive) ('.node-download-' + [Guid]::NewGuid().ToString('N') + '.zip')
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $runtimeManifest.url -OutFile $download -UseBasicParsing -TimeoutSec 180
        $downloadDigest = Get-Sha256 $download
        if ($downloadDigest -ne $runtimeManifest.sha256) { throw 'Node.js archive SHA256 does not match the pinned official digest.' }
        Move-Item -LiteralPath $download -Destination $nodeArchive -Force
    } finally {
        if (Test-Path -LiteralPath $download -PathType Leaf) { Remove-Item -LiteralPath $download -Force }
    }
}
# Extract only the executable and its license, always from the verified archive.
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Path $nodeRoot -Force | Out-Null
$nodeZip = [IO.Compression.ZipFile]::OpenRead($nodeArchive)
try {
    foreach ($name in @('node.exe','LICENSE')) {
        $entry = $nodeZip.GetEntry(('node-v' + $runtimeManifest.version + '-win-x64/' + $name))
        if (-not $entry) { throw ('Node.js archive is missing ' + $name) }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $nodeRoot $name), $true)
    }
} finally {
    $nodeZip.Dispose()
}
$executableDigest = if (Test-Path -LiteralPath $nodeExecutable -PathType Leaf) {
    Get-Sha256 $nodeExecutable
} else { '' }
if ($executableDigest -ne $runtimeManifest.executableSha256 -or -not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) {
    throw 'The pinned Node.js archive is missing node.exe or its LICENSE file.'
}
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
    $runtimeStage = Join-Path $stage 'runtime'
    New-Item -ItemType Directory -Path $runtimeStage -Force | Out-Null
    Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $runtimeStage 'node.exe')
    Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtimeStage 'LICENSE')
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
