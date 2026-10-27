param([Parameter(Mandatory=$true)][string]$TargetDirectory)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$devRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AionCompanionDev'
[void][IO.Directory]::CreateDirectory($devRoot)
$gate = New-Object Threading.Mutex($false, 'Local\AionCompanion.DevHost')
$held = $false
$transcript = $false
$previousTarget = $env:CARGO_TARGET_DIR
$previousConfig = $env:TAURI_CONFIG
$previousPort = $env:AION_DEV_PORT
try {
    try { $held = $gate.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { Write-Output 'Development is already running. Use the Dev shortcut to return to its window.'; return }
    Start-Transcript -LiteralPath (Join-Path $devRoot 'development.log') -Append | Out-Null
    $transcript = $true
    $exe = Join-Path $TargetDirectory 'debug/aion-companion.exe'
    & (Join-Path $PSScriptRoot 'publish-desktop.ps1') -Live -DevExecutable $exe
    $port = 1421
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Development port $port is already occupied. Stop the other server before starting this checkout."
    }
    # The launcher's workspace selection handles tray-only/hidden apps too;
    # Process.CloseMainWindow could close a secondary overlay instead.
    $prepare = Start-Process -FilePath (Join-Path $devRoot 'Aion Companion Dev.exe') -ArgumentList '--prepare-dev' -Wait -PassThru -WindowStyle Hidden
    if ($prepare.ExitCode -ne 0) { throw 'The running app could not finish saving. Quit it from its tray menu, then start Dev again.' }
    & (Join-Path $PSScriptRoot 'initialize-dev-profile.ps1')
    $env:CARGO_TARGET_DIR = $TargetDirectory
    $env:AION_DEV_PORT = "$port"
    $env:TAURI_CONFIG = '{"build":{"devUrl":"http://127.0.0.1:1421"}}'
    Push-Location $workspaceRoot
    try {
        # Route native tool output through the host so the transcript captures
        # compiler/Vite errors even when the shortcut has no console attached.
        $savedPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & npm.cmd run tauri -- dev --features development --config (Join-Path $PSScriptRoot '../src-tauri/tauri.dev.conf.json') 2>&1 | ForEach-Object { Write-Host $_.ToString() }
            $devExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedPreference }
        if ($devExitCode -ne 0) { throw "Desktop development server failed. See $devRoot\development.log" }
    } finally { Pop-Location }
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:TAURI_CONFIG = $previousConfig
    $env:AION_DEV_PORT = $previousPort
    if ($transcript) { Stop-Transcript | Out-Null }
    if ($held) { $gate.ReleaseMutex() }
    $gate.Dispose()
}
