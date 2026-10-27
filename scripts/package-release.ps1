param([string]$Executable='target/release/aion-companion.exe',[string]$OutputDirectory='release-artifacts',[string]$Makensis,[string]$Bootstrapper,[switch]$RequireSigning)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version=& node (Join-Path $PSScriptRoot 'release-version.mjs') --check
if($LASTEXITCODE -ne 0){throw 'Version validation failed'}
$exe=(Resolve-Path -LiteralPath $Executable).Path
if ([Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductName -ne 'Aion Companion Prototype') { throw 'Development builds cannot be packaged as stable releases.' }
$output=if ([IO.Path]::IsPathRooted($OutputDirectory)) {[IO.Path]::GetFullPath($OutputDirectory)} else {[IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))}
if(Test-Path -LiteralPath $output){throw 'Package output must be a new directory'}
[void][IO.Directory]::CreateDirectory($output)
$name="AionCompanion-$version-windows-x64"
$portable=Join-Path $output "$name.exe"
Copy-Item -LiteralPath $exe -Destination $portable
& (Join-Path $PSScriptRoot 'sign-windows.ps1') -Path $portable -RequireSigning:$RequireSigning
Copy-Item -LiteralPath (Join-Path $root 'THIRD_PARTY_NOTICES.txt') -Destination $output
$installer=Join-Path $output "$name-setup.exe"
& (Join-Path $PSScriptRoot 'build-installer.ps1') -Executable $portable -OutputFile $installer -Makensis $Makensis -Bootstrapper $Bootstrapper -RequireSigning:$RequireSigning
& node (Join-Path $PSScriptRoot 'check-bundle-size.mjs') --installer $installer
if ($LASTEXITCODE -ne 0) { throw 'Installer size budget exceeded.' }
# Maps are independent, content-addressed release assets, never inside Setup or the ZIP.
& node (Join-Path $PSScriptRoot 'build-map-packs.mjs') --output $output
if ($LASTEXITCODE -ne 0) { throw 'Map asset packaging failed.' }
$trust = if ((Get-AuthenticodeSignature -LiteralPath $portable).Status -eq 'Valid') {'The executable is digitally signed. Verify the publisher shown by Windows.'} else {'This release is unsigned. Windows may show an unknown-publisher or SmartScreen warning. Download only from the official release page and verify checksums.'}
$readme=@"
Aion Companion $version (Windows x64)

RECOMMENDED: Open $name-setup.exe, then launch Aion Companion from Start.
Setup installs for your Windows account, adds an uninstaller, preserves saved
settings and combat logs, and installs Microsoft Edge WebView2 if missing.
An internet connection is required if WebView2 needs to be installed.
Maps download separately when first opened, then remain cached for offline use.
Each map is verified before use. Map packs accompany this release as separate
.acmap assets; do not extract or put them in the app's installation folder.
Quit Aion Companion from its tray before installing an upgrade or uninstalling.

PORTABLE: Extract the ZIP and open $name.exe. Maps also download on first use.
Install WebView2 yourself if
needed: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
The ZIP uses the same local app-data folder; it is not a self-contained data folder.
To update a portable copy, quit the app and replace the executable, or use Setup.

LIVE CAPTURE: Install Npcap separately from https://npcap.com/#download
Quit Aion Companion from its tray before running Npcap Setup with its default
options, then reopen it. If Npcap Setup stalls while starting the driver, quit
the companion and let Setup finish. Home and Settings check driver access and
provide setup help. Npcap is not bundled.
Driver installation may require administrator approval. The companion does not
require administrator access by default; restricted Npcap installations may need
permissions adjusted. Help: https://npcap.com/guide/npcap-users-guide.html
Start AION 2 and log into a character. Capture connects automatically.
Use windowed or borderless game display for overlays. Offline logs, reminders
and manual tracking remain available without Npcap or the game running.

WINDOWS: x64 Windows 10/11 is the distribution target. See the installation guide
for current validation coverage; other Windows architectures are not packaged.
Node.js, Rust and C++ Build Tools are for developers, not players.

UPDATES: Installed copies can download verified releases and restart when you
choose. Public releases need no GitHub CLI. While releases are private, automatic
updates and first-use map downloads require GitHub CLI (https://cli.github.com/) with a repository-authorized
account. Settings > App updates guides CLI installation, interactive GitHub
sign-in and checking access. The owner must invite the account and the recipient
must accept the invitation; check access again after that. Alternatively download
Setup using browser sign-in. An installer shared by a friend can be installed
and used before repository access is granted. GitHub CLI is not needed to install
or run an already downloaded copy. Previously cached maps remain usable offline.
Downloads: https://github.com/nicholascostadev/aion-companion-public/releases/latest
Guide: https://github.com/nicholascostadev/aion-companion-public/blob/master/docs/INSTALLATION.md

$trust
SHA-256 checksums and third-party notices accompany the release.
Settings and recordings stay local. Gameplay data is never uploaded.
"@
[IO.File]::WriteAllText((Join-Path $output 'README.txt'),$readme)
Compress-Archive -LiteralPath $portable,(Join-Path $output 'README.txt'),(Join-Path $output 'THIRD_PARTY_NOTICES.txt') -DestinationPath (Join-Path $output "$name.zip")
$sums=Get-ChildItem -LiteralPath $output -File | Sort-Object Name | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(),$_.Name
}
[IO.File]::WriteAllLines((Join-Path $output 'SHA256SUMS.txt'),$sums)
if($env:GITHUB_OUTPUT){"version=$version" | Out-File $env:GITHUB_OUTPUT -Append -Encoding utf8; "artifact-name=$name" | Out-File $env:GITHUB_OUTPUT -Append -Encoding utf8}
Write-Output "Packaged $name in $output"
