$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$sdkVersion = '1.0.4314.35'
$sdk = Join-Path $root 'vendor\webview2\sdk'
if (-not (Test-Path -LiteralPath (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $sdk) -Force | Out-Null
    $zip = Join-Path (Split-Path -Parent $sdk) 'sdk.zip'
    Invoke-WebRequest -Uri ('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/' + $sdkVersion + '/microsoft.web.webview2.' + $sdkVersion + '.nupkg') -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $sdk -Force
}
$out = Join-Path $root 'windows\panel\bin'
New-Item -ItemType Directory -Path $out -Force | Out-Null
foreach ($name in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $sdk ('lib\net462\' + $name)) -Destination (Join-Path $out $name) -Force
}
Copy-Item -LiteralPath (Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $out -Force
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ (('/out:' + (Join-Path $out 'CodexUsagePanel.exe'))) (('/win32manifest:' + (Join-Path $root 'windows\panel\app.manifest'))) /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll (('/r:' + (Join-Path $out 'Microsoft.Web.WebView2.Core.dll'))) (('/r:' + (Join-Path $out 'Microsoft.Web.WebView2.WinForms.dll'))) (Join-Path $root 'windows\panel\Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Panel compilation failed.' }
& node.exe (Join-Path $root 'windows\panel\page.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Panel page generation failed.' }
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $out 'WEBVIEW2-LICENSE.txt') -Force
Write-Output 'Taskbar panel built.'
