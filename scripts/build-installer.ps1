param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$OutputFile,
    [string]$Makensis,
    [string]$Bootstrapper,
    [switch]$RequireSigning
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = & node (Join-Path $PSScriptRoot 'release-version.mjs') --check
if ($LASTEXITCODE -ne 0) { throw 'Version validation failed.' }
$output = [IO.Path]::GetFullPath($OutputFile)
if (Test-Path -LiteralPath $output) { throw 'Installer output must be a new file.' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('aion-installer-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($stage)
if ($RequireSigning -and (Get-AuthenticodeSignature -LiteralPath $Executable).Status -ne 'Valid') { throw 'The installer payload must be signed before building a signed release.' }
# The executable is already signed, if configured, before its immutable hash is computed.
$payload = Join-Path $stage 'payload'
& (Join-Path $PSScriptRoot 'publish-desktop.ps1') -Executable $Executable -Channel Stable -InstallRoot $payload -NoShortcuts
Remove-Item -LiteralPath (Join-Path $payload 'workspace.txt')
& (Join-Path $PSScriptRoot 'sign-windows.ps1') -Path (Join-Path $payload 'Aion Companion.exe') -RequireSigning:$RequireSigning
$pointer = [IO.File]::ReadAllText((Join-Path $payload 'current.txt')).Trim()
$hash = Split-Path (Split-Path $pointer -Parent) -Leaf
if ($hash -notmatch '^[a-f0-9]{64}$') { throw 'Invalid installer payload hash.' }
if (-not $Makensis) { $Makensis = & (Join-Path $PSScriptRoot 'get-installer-tools.ps1') }
if (-not $Bootstrapper) {
    $Bootstrapper = Join-Path $stage 'MicrosoftEdgeWebview2Setup.exe'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $Bootstrapper
}
$signature = Get-AuthenticodeSignature -LiteralPath $Bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
    throw 'WebView2 bootstrapper must have a valid Microsoft Authenticode signature.'
}
$arguments = @('/V2', "/DVERSION=$version", "/DPAYLOAD_DIR=$payload", "/DAPP_HASH=$hash", "/DOUTPUT_FILE=$output", "/DICON_FILE=$(Join-Path $root 'src-tauri/icons/icon.ico')", "/DBOOTSTRAPPER=$([IO.Path]::GetFullPath($Bootstrapper))")
if ($env:AION_SIGN_CERT_THUMBPRINT) { $arguments += "/DSIGN_SCRIPT=$(Join-Path $PSScriptRoot 'sign-windows.ps1')" }
$arguments += (Join-Path $PSScriptRoot 'installer.nsi')
& $Makensis @arguments
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) { throw 'Windows installer compilation failed.' }
& (Join-Path $PSScriptRoot 'sign-windows.ps1') -Path $output -RequireSigning:$RequireSigning
Write-Output "Installer: $output"
