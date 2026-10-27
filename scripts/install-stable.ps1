param([string]$Version, [switch]$Run)
$ErrorActionPreference = 'Stop'
$repository = 'nicholascostadev/aion-companion-public'
$endpoint = if ($Version) { "repos/$repository/releases/tags/v$($Version.TrimStart('v'))" } else { "repos/$repository/releases/latest" }
$releaseJson = & gh api $endpoint
if ($LASTEXITCODE -ne 0) { throw 'Could not read the published release. Sign in with gh auth login if the repository is private.' }
$release = $releaseJson | ConvertFrom-Json
if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v\d+\.\d+\.\d+$') { throw 'Only published stable releases can be installed.' }
$versionNumber = $release.tag_name.Substring(1)
$assetName = "AionCompanion-$versionNumber-windows-x64.exe"
$assets = @($release.assets | Where-Object { $_.name -eq $assetName })
if ($assets.Count -ne 1 -or $assets[0].digest -notmatch '^sha256:[a-fA-F0-9]{64}$') { throw 'The release executable is missing its verified SHA-256 digest.' }
$downloadRoot = Join-Path ([IO.Path]::GetTempPath()) ('aion-stable-install-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($downloadRoot)
& gh release download $release.tag_name --repo $repository --pattern $assetName --dir $downloadRoot
if ($LASTEXITCODE -ne 0) { throw 'Stable release download failed. The installed version was not changed.' }
$exe = Join-Path $downloadRoot $assetName
$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
if ("sha256:$hash" -ne $assets[0].digest.ToLowerInvariant()) { throw 'Release checksum verification failed. The installed version was not changed.' }
& (Join-Path $PSScriptRoot 'publish-desktop.ps1') -Executable $exe -Channel Stable
Write-Output "Stable $versionNumber installed. Your development checkout and stable saved data were preserved."
if ($Run) { Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AionCompanion/Aion Companion.exe') -WindowStyle Hidden }
