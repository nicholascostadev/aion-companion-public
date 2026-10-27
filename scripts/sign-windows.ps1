param([Parameter(Mandatory)][string]$Path, [switch]$RequireSigning)
$ErrorActionPreference = 'Stop'
$file = (Resolve-Path -LiteralPath $Path).Path
$thumbprint = $env:AION_SIGN_CERT_THUMBPRINT
if (-not $thumbprint) {
    if ($RequireSigning) { throw 'Signing is required. Set AION_SIGN_CERT_THUMBPRINT to a verified code-signing certificate in the Windows certificate store.' }
    return
}
if ($thumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'AION_SIGN_CERT_THUMBPRINT must be a SHA-1 certificate thumbprint.' }
$tool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($tool) { $signTool = $tool.Source }
else {
    $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    $signTool = Get-ChildItem -LiteralPath $sdk -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -eq 'x64' } | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signTool) { throw 'Windows SDK signtool.exe is required for code signing.' }
& $signTool sign /sha1 $thumbprint /fd SHA256 /tr https://timestamp.digicert.com /td SHA256 $file
if ($LASTEXITCODE -ne 0) { throw 'Windows code signing failed.' }
if ((Get-AuthenticodeSignature -LiteralPath $file).Status -ne 'Valid') { throw 'The signed file did not pass Authenticode verification.' }
