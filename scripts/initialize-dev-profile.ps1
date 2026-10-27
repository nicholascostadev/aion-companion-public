param(
    [string]$SourceRoot = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'org.aioncompanion.prototype'),
    [string]$DestinationRoot = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'org.aioncompanion.development')
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceRoot)
$destination = [IO.Path]::GetFullPath($DestinationRoot)
if ($source.Equals($destination,[StringComparison]::OrdinalIgnoreCase)) { throw 'Development and stable profiles must be different folders.' }
if (Test-Path -LiteralPath $destination) { return }
# Copy only this app's preferences and pet baseline, after capture has saved.
# Combat history, active recordings and WebView storage are never copied.
$staging = $destination + '.initialize-' + [Guid]::NewGuid().ToString('N')
[void][IO.Directory]::CreateDirectory($staging)
foreach ($relative in @('offline/settings.json','offline/pets.json','offline/alerts.json','pet-radar-window.json','alert-popup.json','timers-window.json','overlay-locks.json','window-positions.json')) {
    $file = Join-Path $source $relative
    if (-not (Test-Path -LiteralPath $file)) { continue }
    [void]([IO.File]::ReadAllText($file) | ConvertFrom-Json)
    $target = Join-Path $staging $relative
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    Copy-Item -LiteralPath $file -Destination $target
}
[IO.Directory]::Move($staging,$destination)
Write-Output 'Created the independent Dev profile from stable preferences and pet progress. Future changes stay separate.'
