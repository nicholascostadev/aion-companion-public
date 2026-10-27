$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('aion-channel-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$publisher = Join-Path $PSScriptRoot 'publish-desktop.ps1'
function Fixture([string]$channel, [string]$product) {
    $source = Join-Path $testRoot "$channel.cs"
    ('using System.Reflection; [assembly: AssemblyProduct("' + $product + '")] internal static class Fixture { static void Main() {} }') | Set-Content -LiteralPath $source
    $exe = Join-Path $testRoot "$channel.exe"
    & $compiler /nologo /target:winexe "/out:$exe" $source
    if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed' }
    return $exe
}
$stable = Fixture 'stable' 'Aion Companion Prototype'
$dev = Fixture 'dev' 'Aion Companion Dev'
$stableRoot = Join-Path $testRoot 'stable'
$devRoot = Join-Path $testRoot 'development'
& $publisher -Executable $stable -Channel Stable -InstallRoot $stableRoot -NoShortcuts
$stablePointer = [IO.File]::ReadAllText((Join-Path $stableRoot 'current.txt'))
& $publisher -Executable $dev -InstallRoot $devRoot -NoShortcuts
& $publisher -Live -InstallRoot $devRoot -DevExecutable (Join-Path $testRoot 'target/debug/aion-companion.exe') -NoShortcuts
if ([IO.File]::ReadAllText((Join-Path $stableRoot 'current.txt')) -ne $stablePointer) { throw 'Development publication changed stable' }
if ([IO.File]::ReadAllText((Join-Path $devRoot 'channel.txt')) -ne 'development') { throw 'Wrong development channel' }
$devPointer = [IO.File]::ReadAllText((Join-Path $devRoot 'current.txt'))
foreach ($case in @(@($dev,'Stable',$stableRoot), @($stable,'Development',$devRoot))) {
    $rejected = $false
    try { & $publisher -Executable $case[0] -Channel $case[1] -InstallRoot $case[2] -NoShortcuts }
    catch { if ($_.Exception.Message -notlike 'Executable channel mismatch:*') { throw }; $rejected = $true }
    if (-not $rejected) { throw 'Cross-channel publication was accepted' }
}
if ([IO.File]::ReadAllText((Join-Path $stableRoot 'current.txt')) -ne $stablePointer -or [IO.File]::ReadAllText((Join-Path $devRoot 'current.txt')) -ne $devPointer) { throw 'Rejected publication changed a pointer' }
foreach ($item in @(@($stableRoot,'Aion Companion.exe'), @($devRoot,'Aion Companion Dev.exe'))) {
    $process = Start-Process -FilePath (Join-Path $item[0] $item[1]) -ArgumentList '--verify' -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw 'Published channel failed launcher checksum verification' }
}
Write-Output 'PASS independent stable/development publication, live shortcut metadata, cross-channel rejection and verified launch pointers.'
$profileSource = Join-Path $testRoot 'profiles/stable'
$profileDev = Join-Path $testRoot 'profiles/development'
[void][IO.Directory]::CreateDirectory((Join-Path $profileSource 'offline'))
[IO.File]::WriteAllText((Join-Path $profileSource 'offline/pets.json'),'{"native":"pet baseline"}')
[IO.File]::WriteAllText((Join-Path $profileSource 'offline/active.json'),'{"active":"must not copy"}')
$stablePositions = '{"version":1,"windows":{"dps-overlay":{"x":-1200,"y":40}}}'
[IO.File]::WriteAllText((Join-Path $profileSource 'window-positions.json'),$stablePositions)
& (Join-Path $PSScriptRoot 'initialize-dev-profile.ps1') -SourceRoot $profileSource -DestinationRoot $profileDev
if (Test-Path -LiteralPath (Join-Path $profileDev 'offline/active.json')) { throw 'Active capture was copied' }
$devPositions = Join-Path $profileDev 'window-positions.json'
if ([IO.File]::ReadAllText($devPositions) -ne $stablePositions) { throw 'Window positions not copied' }
[IO.File]::WriteAllText($devPositions,'{"version":1,"windows":{"dps-overlay":{"x":300,"y":200}}}')
$devPets = Join-Path $profileDev 'offline/pets.json'
if ([IO.File]::ReadAllText($devPets) -ne '{"native":"pet baseline"}') { throw 'Pet baseline not copied' }
[IO.File]::WriteAllText($devPets,'{"native":"development change"}')
& (Join-Path $PSScriptRoot 'initialize-dev-profile.ps1') -SourceRoot $profileSource -DestinationRoot $profileDev
if ([IO.File]::ReadAllText($devPets) -ne '{"native":"development change"}') { throw 'Existing Dev profile overwritten' }
if ([IO.File]::ReadAllText((Join-Path $profileSource 'offline/pets.json')) -ne '{"native":"pet baseline"}') { throw 'Stable profile changed' }
if ([IO.File]::ReadAllText($devPositions) -eq $stablePositions) { throw 'Existing Dev window positions overwritten' }
if ([IO.File]::ReadAllText((Join-Path $profileSource 'window-positions.json')) -ne $stablePositions) { throw 'Stable window positions changed' }
Write-Output 'PASS first-use profile seed (including window positions), independent edits, no active recording copy, no overwrite on later launches.'
