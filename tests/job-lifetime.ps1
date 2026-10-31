param([string]$ConfigPath, [string]$LauncherPath, [string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WorkerJobFixture {
  [StructLayout(LayoutKind.Sequential)] public struct Basic {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWS, MaxWS;
    public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong A,B,C,D,E,F; }
  [StructLayout(LayoutKind.Sequential)] public struct Extended {
    public Basic Limits; public IO Counters; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
  }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended data, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
"@
$job = [WorkerJobFixture]::CreateJobObject([IntPtr]::Zero, $null)
$limits = New-Object WorkerJobFixture+Extended
$basic = New-Object WorkerJobFixture+Basic
$basic.Flags = 0x2000
$limits.Limits = $basic
if (-not [WorkerJobFixture]::SetInformationJobObject($job, 9, [ref]$limits, [Runtime.InteropServices.Marshal]::SizeOf($limits))) { throw 'Cannot configure test job.' }
$process = New-Object Diagnostics.Process
try {
    $gate = Join-Path $FixtureDirectory 'gate.json'
    $ready = Join-Path $FixtureDirectory 'ready.json'
    $process.StartInfo.FileName = $config.nodePath
    $process.StartInfo.Arguments = '"' + $LauncherPath + '" "' + $config.installDir + '" "' + $gate + '" "' + $ready + '"'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.RedirectStandardOutput = $true
    if (-not $process.Start()) { throw 'Cannot start test launcher.' }
    if (-not [WorkerJobFixture]::AssignProcessToJobObject($job, $process.Handle)) { throw 'Cannot assign launcher to test job.' }
    [IO.File]::WriteAllText($gate, '{}')
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    while (-not (Test-Path -LiteralPath $ready)) {
        if ($process.HasExited) { throw ('Test launcher exited: ' + $process.StandardError.ReadToEnd()) }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Test launcher timed out.' }
        Start-Sleep -Milliseconds 100
    }
    $receipt = Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
    $before = Get-Content -LiteralPath (Join-Path $config.installDir 'worker-state.json') -Raw | ConvertFrom-Json
    [WorkerJobFixture]::CloseHandle($job) | Out-Null
    $job = [IntPtr]::Zero
    $process.WaitForExit(5000) | Out-Null
    Start-Sleep -Milliseconds 2200
    $alive = [bool](Get-Process -Id $receipt.worker -ErrorAction SilentlyContinue)
    $after = Get-Content -LiteralPath (Join-Path $config.installDir 'worker-state.json') -Raw | ConvertFrom-Json
    $worker = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $receipt.worker)
    $parent = Get-Process -Id $worker.ParentProcessId -ErrorAction SilentlyContinue
    @{ launcherExited = $process.HasExited; workerAlive = $alive;
       heartbeatAdvanced = ($after.heartbeat -gt $before.heartbeat); parentName = $parent.ProcessName } | ConvertTo-Json -Compress
} finally {
    if ($job -ne [IntPtr]::Zero) { [WorkerJobFixture]::CloseHandle($job) | Out-Null }
    # This is the exact fixture process created above, never the real client.
    if ($process.Id -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
}
