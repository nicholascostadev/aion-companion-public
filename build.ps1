# Compatibility entry point for existing Dev shortcuts and PowerShell callers.
# Build orchestration lives in dev.sh.
param([switch]$Test, [switch]$Run, [switch]$Dev, [string]$TargetDirectory)
$ErrorActionPreference = 'Stop'
$bash = Get-Command bash.exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\System32\*' } | Select-Object -First 1 -ExpandProperty Source
if (-not $bash) {
    foreach ($candidate in @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")) {
        if (Test-Path -LiteralPath $candidate) { $bash = $candidate; break }
    }
}
if (-not $bash) { throw 'Git for Windows is required. Install it, then run bash dev.sh dev.' }
$arguments = @('--login', (Join-Path $PSScriptRoot 'dev.sh'), $(if ($Dev) {'dev'} else {'build'}))
if (-not $Dev) {
    if ($Test) { $arguments += '--test' }
    if ($Run) { $arguments += '--run' }
}
if ($TargetDirectory) {
    $target = if ([IO.Path]::IsPathRooted($TargetDirectory)) { $TargetDirectory } else { Join-Path $PSScriptRoot $TargetDirectory }
    $arguments += @('--target-dir', $target)
}
& $bash @arguments
if ($LASTEXITCODE -ne 0) { throw "Bash development command failed (exit $LASTEXITCODE)." }
