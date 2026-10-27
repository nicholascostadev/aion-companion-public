param([string]$Makensis, [string]$Bootstrapper)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('aion-installer-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$installed = Join-Path $testRoot 'installed'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not $Makensis) { $Makensis = & (Join-Path $PSScriptRoot 'get-installer-tools.ps1') }
if (-not $Bootstrapper) {
    $Bootstrapper = Join-Path $testRoot 'MicrosoftEdgeWebview2Setup.exe'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $Bootstrapper
}
function Run([string]$file, [string[]]$arguments, [int]$expected = 0) {
    $process = Start-Process -FilePath $file -ArgumentList $arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(30000)) { $process.Kill(); throw "Test process timed out: $file" }
    if ($process.ExitCode -ne $expected) { throw "Unexpected exit $($process.ExitCode) (expected $expected): $file" }
}
function BuildFixture([int]$revision) {
    $source = Join-Path $testRoot "Fixture$revision.cs"
    @"
using System.Reflection;
using System.Threading;
[assembly: AssemblyProduct("Aion Companion Prototype")]
[assembly: AssemblyVersion("1.0.$revision.0")]
internal static class Fixture {
  static void Main(string[] args) { if (args.Length > 0 && args[0] == "--hold") Thread.Sleep(120000); }
}
"@ | Set-Content -LiteralPath $source
    $exe = Join-Path $testRoot "fixture$revision.exe"
    & $compiler /nologo /target:winexe "/out:$exe" $source
    if ($LASTEXITCODE -ne 0) { throw 'Installer fixture compilation failed.' }
    $payload = Join-Path $testRoot "payload$revision"
    & (Join-Path $PSScriptRoot 'publish-desktop.ps1') -Executable $exe -Channel Stable -InstallRoot $payload -NoShortcuts | Out-Host
    $hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    $output = Join-Path $testRoot "setup$revision.exe"
    & $Makensis /V2 "/DVERSION=1.0.$revision" "/DPAYLOAD_DIR=$payload" "/DAPP_HASH=$hash" "/DOUTPUT_FILE=$output" "/DICON_FILE=$(Join-Path $root 'src-tauri/icons/icon.ico')" "/DBOOTSTRAPPER=$Bootstrapper" "/DTEST_INSTALL_ROOT=$installed" /DTEST_SHORTCUTS=1 /DTEST_WEBVIEW2_READY=1 (Join-Path $PSScriptRoot 'installer.nsi') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Fixture setup compilation failed.' }
    return @{ setup = $output; hash = $hash }
}

$first = BuildFixture 1
Run $first.setup @('/S')
$pointer = Join-Path $installed 'current.txt'
$initial = [IO.File]::ReadAllText($pointer).Trim()
if ($initial -ne "versions\$($first.hash)\aion-companion.exe") { throw 'Initial installation selected the wrong version.' }
Run (Join-Path $installed 'Aion Companion.exe') @('--verify')
if (Test-Path -LiteralPath (Join-Path $installed 'workspace.txt')) { throw 'Installer leaked a development workspace path.' }
if (-not (Test-Path -LiteralPath (Join-Path $installed 'Uninstall.exe'))) { throw 'Installer did not create the uninstaller.' }

# A foreign file and an app-data sentinel must survive upgrade and uninstall.
$foreign = Join-Path $installed 'keep-user-file.txt'
[IO.File]::WriteAllText($foreign, 'preserve')
$data = Join-Path $testRoot 'saved-data'
[void][IO.Directory]::CreateDirectory($data)
[IO.File]::WriteAllText((Join-Path $data 'settings.json'), '{"sentinel":true}')
$second = BuildFixture 2
$active = Start-Process -FilePath (Join-Path $installed $initial) -ArgumentList '--hold' -PassThru -WindowStyle Hidden
try {
    Start-Sleep -Milliseconds 250
    Run $second.setup @('/S') 1
    if ([IO.File]::ReadAllText($pointer).Trim() -ne $initial) { throw 'Refused upgrade changed the running version.' }
    Run (Join-Path $installed 'Uninstall.exe') @('/S', ('_?=' + $installed)) 1
    if ([IO.File]::ReadAllText($pointer).Trim() -ne $initial) { throw 'Refused uninstall changed the running version.' }
} finally { if (-not $active.HasExited) { $active.Kill(); $active.WaitForExit() } }
Run $second.setup @('/S')
if ([IO.File]::ReadAllText($pointer).Trim() -ne "versions\$($second.hash)\aion-companion.exe") { throw 'Upgrade did not select the verified new version.' }
Run (Join-Path $installed 'Aion Companion.exe') @('--verify')
if ([IO.File]::ReadAllText($foreign) -ne 'preserve') { throw 'Upgrade changed an unrelated file.' }
if ([IO.File]::ReadAllText((Join-Path $installed 'previous.txt')).Trim() -ne $initial) { throw 'Upgrade did not retain its previous version.' }
$download = Join-Path $installed 'updates/1.0.1-1234'
[void][IO.Directory]::CreateDirectory($download)
[IO.File]::WriteAllText((Join-Path $download 'AionCompanion-1.0.1-windows-x64.exe'), 'obsolete download')
$third = BuildFixture 3
Run $third.setup @('/S')
if ([IO.File]::ReadAllText($pointer).Trim() -ne "versions\$($third.hash)\aion-companion.exe") { throw 'Third install did not activate.' }
if (Test-Path -LiteralPath (Join-Path $installed $initial)) { throw 'Upgrade retained obsolete app version.' }
if (-not (Test-Path -LiteralPath (Join-Path $installed "versions/$($second.hash)/aion-companion.exe"))) { throw 'Upgrade deleted fallback.' }
if (Test-Path -LiteralPath $download) { throw 'Upgrade retained completed update download.' }
Run $third.setup @('/S')
if ([IO.File]::ReadAllText((Join-Path $installed 'previous.txt')).Trim() -ne "versions\$($second.hash)\aion-companion.exe") { throw 'Reinstall lost fallback.' }

# _?= runs in-place and makes the uninstaller process waitable by this test.
Run (Join-Path $installed 'Uninstall.exe') @('/S', ('_?=' + $data)) 2
if ([IO.File]::ReadAllText($pointer).Trim() -ne "versions\$($third.hash)\aion-companion.exe") { throw 'A relocated uninstaller changed the installation.' }
Run (Join-Path $installed 'Uninstall.exe') @('/S', ('_?=' + $installed))
if (Test-Path -LiteralPath $pointer) { throw 'Uninstall left the active app installed.' }
if ([IO.File]::ReadAllText($foreign) -ne 'preserve') { throw 'Uninstall removed an unrelated file.' }
if ([IO.File]::ReadAllText((Join-Path $data 'settings.json')) -ne '{"sentinel":true}') { throw 'Uninstall changed saved data.' }
if (Test-Path -LiteralPath (Join-Path $installed 'previous.txt')) { throw 'Uninstall retained fallback metadata.' }
Write-Output 'PASS isolated install, running-app refusal, repeated upgrades with current plus fallback retention, download cleanup, reinstall, relocated-uninstaller rejection and uninstall with preserved unrelated files. Test builds do not register shortcuts, uninstall keys or install runtimes.'
