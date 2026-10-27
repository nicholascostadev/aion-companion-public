$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('aion cleanup test ' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$launcher = Join-Path $testRoot 'Maintenance.exe'
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll "/out:$launcher" (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Maintenance launcher compilation failed.' }

function Build([string]$root, [string]$content) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($content)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    $folder = Join-Path $root "versions/$hash"
    [void][IO.Directory]::CreateDirectory($folder)
    [IO.File]::WriteAllBytes((Join-Path $folder 'aion-companion.exe'), $bytes)
    [IO.File]::WriteAllText((Join-Path $folder 'THIRD_PARTY_NOTICES.txt'), 'notices')
    return "versions\$hash\aion-companion.exe"
}
function RunMaintenance([string]$root, [int]$expected = 0) {
    $process = Start-Process -FilePath $launcher -ArgumentList @('--maintain-installation', ('"' + $root + '"')) -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Maintenance timed out.' }
    if ($process.ExitCode -ne $expected) { throw "Maintenance exit $($process.ExitCode), expected $expected." }
}
function WritePointer([string]$root, [string]$pointer) {
    [IO.File]::WriteAllText((Join-Path $root 'current.txt'), $pointer)
}

$root = Join-Path $testRoot 'installed'
$obsolete = Build $root 'obsolete'
$fallback = Build $root 'fallback'
$current = Build $root 'current'
$unexpected = Build $root 'contains foreign file'
$foreign = Join-Path (Split-Path (Join-Path $root $unexpected)) 'keep.txt'
[IO.File]::WriteAllText($foreign, 'preserve')
[IO.File]::WriteAllText((Join-Path $root 'channel.txt'), 'stable')
[IO.File]::WriteAllText((Join-Path $root 'previous.txt'), $fallback)
WritePointer $root $current
$download = Join-Path $root 'updates/1.2.3-123456'
[void][IO.Directory]::CreateDirectory($download)
[IO.File]::WriteAllText((Join-Path $download 'AionCompanion-1.2.3-windows-x64.exe'), 'downloaded duplicate')
[IO.File]::WriteAllText((Join-Path $download 'THIRD_PARTY_NOTICES.txt'), 'notices')
$unknown = Join-Path $root 'updates/user-folder'
[void][IO.Directory]::CreateDirectory($unknown)
[IO.File]::WriteAllText((Join-Path $unknown 'keep.txt'), 'preserve')
$outside = Join-Path $testRoot 'saved-data'
[void][IO.Directory]::CreateDirectory($outside)
$sentinel = Join-Path $outside 'settings.json'
[IO.File]::WriteAllText($sentinel, '{"preserve":true}')
$link = Join-Path $root ('versions/' + ('a' * 64))
New-Item -ItemType Junction -Path $link -Target $outside | Out-Null

RunMaintenance $root
if (Test-Path -LiteralPath (Join-Path $root $obsolete)) { throw 'Obsolete executable retained.' }
if (Test-Path -LiteralPath $download) { throw 'Completed download retained.' }
foreach ($path in @((Join-Path $root $current), (Join-Path $root $fallback), $foreign, $sentinel, (Join-Path $unknown 'keep.txt'))) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Cleanup removed protected file: $path" }
}
if ([IO.File]::ReadAllText((Join-Path $root 'current.txt')) -ne $current) { throw 'Cleanup changed active pointer.' }
RunMaintenance $root

# Bad pointers and linked installation roots must fail before any deletion.
$obsolete = Build $root 'obsolete after cleanup'
WritePointer $root '../saved-data/settings.json'
RunMaintenance $root 1
if (-not (Test-Path -LiteralPath (Join-Path $root $obsolete))) { throw 'Bad pointer allowed deletion.' }
WritePointer $root $current
[IO.File]::WriteAllText((Join-Path $root 'channel.txt'), 'development')
RunMaintenance $root 1
if (-not (Test-Path -LiteralPath (Join-Path $root $obsolete))) { throw 'Stable maintenance touched Dev.' }
[IO.File]::WriteAllText((Join-Path $root 'channel.txt'), 'stable')
$rootLink = Join-Path $testRoot 'linked-install'
New-Item -ItemType Junction -Path $rootLink -Target $root | Out-Null
RunMaintenance $rootLink 1

# Locked files are deferred and retried; the active app can never be pruned.
$locked = [IO.File]::Open((Join-Path $root $obsolete), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
try {
    RunMaintenance $root
    if (-not (Test-Path -LiteralPath (Join-Path $root $obsolete))) { throw 'Cleanup removed locked file.' }
} finally { $locked.Dispose() }
RunMaintenance $root
if (Test-Path -LiteralPath (Join-Path $root $obsolete)) { throw 'Cleanup did not retry locked obsolete file.' }

$source = Join-Path $testRoot 'Hold.cs'
'using System.Threading; internal static class Hold { static void Main() { Thread.Sleep(30000); } }' | Set-Content -LiteralPath $source
$holdingExe = Join-Path $testRoot 'aion-companion.exe'
& $compiler /nologo /target:winexe "/out:$holdingExe" $source
if ($LASTEXITCODE -ne 0) { throw 'Busy fixture compilation failed.' }
$holdingPointer = Build $root 'busy fixture'
$holdingPath = Join-Path $root $holdingPointer
Copy-Item -LiteralPath $holdingExe -Destination $holdingPath -Force
$running = Start-Process -FilePath $holdingPath -PassThru -WindowStyle Hidden
try {
    RunMaintenance $root 1
    if (-not (Test-Path -LiteralPath $holdingPath)) { throw 'Cleanup touched running installation.' }
} finally { if (-not $running.HasExited) { $running.Kill(); $running.WaitForExit() } }
RunMaintenance $root
if ([IO.File]::ReadAllText($sentinel) -ne '{"preserve":true}') { throw 'Cleanup touched saved data.' }
Write-Output 'PASS installation retention: current plus fallback, obsolete downloads removed, repeatable cleanup, unknown files and junctions preserved, invalid/Dev/busy installations refused, locked files retried.'
