$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('aion lifecycle test ' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
try {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $fixtureSource = Join-Path $testRoot 'Capture.cs'
    @'
using System;
using System.Threading;
internal static class CaptureFixture {
    private static void Main(string[] args) {
        int id = System.Diagnostics.Process.GetCurrentProcess().Id;
        using (var quit = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\AionCompanion.SaveAndQuit." + id))
        using (var ready = EventWaitHandle.OpenExisting(args[0])) {
            ready.Set();
            quit.WaitOne();
        }
    }
}
'@ | Set-Content -LiteralPath $fixtureSource
    $fixtureFolder = Join-Path $testRoot 'versions/active'
    [void][IO.Directory]::CreateDirectory($fixtureFolder)
    $fixture = Join-Path $fixtureFolder 'aion-companion.exe'
    & $compiler /nologo /target:winexe "/out:$fixture" $fixtureSource
    if ($LASTEXITCODE -ne 0) { throw 'Capture fixture compilation failed.' }

    # Inject ONLY process discovery so this test cannot see, signal or stop the
    # player's real companion. All launch decisions and shutdown code are real.
    $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Launcher.cs'))
    $discovery = 'Process.GetProcessesByName("aion-companion")'
    if (($source.Split(@($discovery), [StringSplitOptions]::None).Length - 1) -ne 1) {
        throw 'Expected exactly one launcher process-discovery seam.'
    }
    $launcherSource = Join-Path $testRoot 'Launcher.cs'
    $isolated = $source.Replace($discovery, 'LifecycleSmoke.Processes()')
    $isolated = $isolated.Replace('MessageBox.Show(', 'LifecycleSmoke.UnexpectedDialog(')
    [IO.File]::WriteAllText($launcherSource, $isolated)
    $driverSource = Join-Path $testRoot 'Driver.cs'
    @'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
internal static class LifecycleSmoke {
    private static int fixtureId;
    private static bool dialog;
    internal static Process[] Processes() { return fixtureId == 0 ? new Process[0] : new[] { Process.GetProcessById(fixtureId) }; }
    internal static DialogResult UnexpectedDialog(string message, string title, MessageBoxButtons buttons, MessageBoxIcon icon) {
        dialog = true;
        return DialogResult.None;
    }
    private static int Launch(string[] args) {
        return (int)typeof(Launcher).GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic)
            .Invoke(null, new object[] { args });
    }
    private static int Main() {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string fixture = Path.Combine(root, @"versions\active\aion-companion.exe");
        File.WriteAllText(Path.Combine(root, "channel.txt"), "development");
        // A different published build must be left pending while capture runs.
        string candidate = Path.Combine(root, @"versions\candidate\aion-companion.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(candidate));
        File.WriteAllText(candidate, "Must never be launched while capture is running.");
        File.WriteAllText(Path.Combine(root, "dev-executable.txt"), candidate);
        string pointer = @"versions\candidate\aion-companion.exe";
        File.WriteAllText(Path.Combine(root, "current.txt"), pointer);
        string readyName = @"Local\AionCompanion.LifecycleTest." + Guid.NewGuid().ToString("N");
        using (var ready = new EventWaitHandle(false, EventResetMode.AutoReset, readyName))
        using (var capture = new Process()) {
            capture.StartInfo = new ProcessStartInfo(fixture, readyName) { UseShellExecute = false, CreateNoWindow = true };
            capture.Start();
            fixtureId = capture.Id;
            try {
                if (!ready.WaitOne(5000)) throw new Exception("Fixture did not start.");
                // A direct Dev command reaches this exact preparation path.
                int result = Launch(new[] { "--prepare-dev" });
                if (capture.WaitForExit(300)) throw new Exception("Dev preparation closed the active companion.");
                if (result != 1) throw new Exception("Dev preparation must refuse a second native capture.");
                foreach (string channel in new[] { "development", "stable" }) {
                    File.WriteAllText(Path.Combine(root, "channel.txt"), channel);
                    foreach (var args in new[] { new string[0], new[] { "--standalone" }, new[] { "--overlay" } }) {
                        if (Launch(args) != 0 || dialog) throw new Exception("Launch did not reuse the active companion: " + channel);
                        if (capture.WaitForExit(100)) throw new Exception("Launch closed the active companion: " + channel);
                    }
                }
                if (File.ReadAllText(Path.Combine(root, "current.txt")) != pointer)
                    throw new Exception("Launch changed the published build pointer.");
                fixtureId = 0;
                File.WriteAllText(Path.Combine(root, "channel.txt"), "development");
                if (Launch(new[] { "--prepare-dev" }) != 0) throw new Exception("Idle Dev preparation was rejected.");
                return 0;
            }
            finally { if (!capture.HasExited) { capture.Kill(); capture.WaitForExit(); } }
        }
    }
}
'@ | Set-Content -LiteralPath $driverSource
    $driver = Join-Path $testRoot 'LifecycleSmoke.exe'
    & $compiler /nologo /target:exe /main:LifecycleSmoke /reference:System.Windows.Forms.dll "/out:$driver" $launcherSource $driverSource
    if ($LASTEXITCODE -ne 0) { throw 'Lifecycle driver compilation failed.' }
    & $driver
    if ($LASTEXITCODE -ne 0) { throw 'Development interrupted the active companion.' }
    Write-Output 'PASS active capture survives native Dev preparation, live/standalone shortcuts and stable/Dev launches; idle preparation remains available.'

    # Exercise the actual host with isolated platform/tool adapters. This never
    # starts Tauri, binds a port, publishes a shortcut or opens a real profile.
    $hostScripts = Join-Path $testRoot 'host/scripts'
    [void][IO.Directory]::CreateDirectory($hostScripts)
    $hostSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'start-dev.ps1'))
    $hostSource = $hostSource.Replace('Local\AionCompanion.DevHost', ('Local\AionCompanion.HostTest.' + [Guid]::NewGuid().ToString('N')))
    $hostSource = $hostSource.Replace("Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AionCompanionDev'", '$env:AION_LIFECYCLE_ROOT')
    [IO.File]::WriteAllText((Join-Path $hostScripts 'start-dev.ps1'), $hostSource)
    foreach ($name in @('publish-desktop.ps1', 'initialize-dev-profile.ps1')) {
        [IO.File]::WriteAllText((Join-Path $hostScripts $name), '# Isolated no-op adapter.')
    }
    [IO.File]::WriteAllText((Join-Path $testRoot 'npm.cmd'), "@echo off`r`necho %* > `"%AION_LIFECYCLE_ARGS%`"`r`nexit /b 0`r`n")
    $hostDriver = Join-Path $testRoot 'host-driver.ps1'
    @'
param([string]$Root)
$ErrorActionPreference = 'Stop'
$env:AION_LIFECYCLE_ROOT = $Root
$env:AION_LIFECYCLE_ARGS = Join-Path $Root 'npm-args.txt'
$env:PATH = $Root + ';' + $env:PATH
function Start-Transcript {}
function Stop-Transcript {}
function Get-NetTCPConnection {}
function Start-Process { [PSCustomObject]@{ ExitCode = $global:AionTestPrepareExit } }
function Stop-Process { throw 'The host must not stop any process.' }
$hostScript = Join-Path $Root 'host/scripts/start-dev.ps1'
$target = Join-Path $Root 'target with spaces'
$global:AionTestPrepareExit = 1
$blocked = $false
try { & $hostScript -TargetDirectory $target }
catch { if ($_.Exception.Message -notlike '*left running*') { throw }; $blocked = $true }
if (-not $blocked -or (Test-Path -LiteralPath $env:AION_LIFECYCLE_ARGS)) {
    throw 'Busy native host started Tauri instead of leaving capture running.'
}
$global:AionTestPrepareExit = 0
& $hostScript -TargetDirectory $target
$arguments = [IO.File]::ReadAllText($env:AION_LIFECYCLE_ARGS)
if ($arguments -notlike 'run tauri -- dev --no-watch --features development --config *') {
    throw "Native development enabled automatic restarts: $arguments"
}
'@ | Set-Content -LiteralPath $hostDriver
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hostDriver -Root $testRoot
    if ($LASTEXITCODE -ne 0) { throw 'Native Dev host lifecycle regression.' }
    Write-Output 'PASS native host leaves a busy capture alone and disables Rust file-watch restarts for idle startup.'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
    if ([IO.Path]::GetDirectoryName($resolved) -ne $temporaryRoot -or
        [IO.Path]::GetFileName($resolved) -notmatch '^aion lifecycle test [a-f0-9]{32}$') {
        throw 'Refusing to clean an unexpected lifecycle-test directory.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
