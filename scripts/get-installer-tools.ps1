param([string]$ToolsDirectory = (Join-Path $PSScriptRoot '../.tools/installer'))
$ErrorActionPreference = 'Stop'
$toolsRoot = [IO.Path]::GetFullPath($ToolsDirectory)
[void][IO.Directory]::CreateDirectory($toolsRoot)
$archive = Join-Path $toolsRoot 'nsis-3.zip'
# Pinned Tauri-maintained NSIS toolchain; never execute an unchecked cached download.
$expected = '1bb9fc85ee5b220d3869325dbb9d191dfe6537070f641c30fbb275c97051fd0c'
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3/nsis-3.zip' -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'NSIS download failed checksum verification.' }
$destination = Join-Path $toolsRoot 'nsis'
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
$compiler = Get-ChildItem -LiteralPath $destination -Filter makensis.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
if (-not $compiler) { throw 'NSIS compiler was not found in the verified toolchain.' }
return $compiler
