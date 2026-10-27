param(
    [string]$Executable,
    [ValidateSet('Development','Stable')][string]$Channel='Development',
    [switch]$Live,
    [string]$DevExecutable,
    [string]$InstallRoot,
    [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($Live -and $Channel -ne 'Development') { throw 'Live reload belongs to Development only.' }
if (-not $InstallRoot) {
    $folder = if ($Channel -eq 'Development') {'AionCompanionDev'} else {'AionCompanion'}
    $InstallRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $folder
}
$appName = if ($Channel -eq 'Development') {'Aion Companion Dev'} else {'Aion Companion'}
[void][IO.Directory]::CreateDirectory($InstallRoot)
if (-not $Live) {
$source = (Resolve-Path -LiteralPath $Executable).Path
$product = [Diagnostics.FileVersionInfo]::GetVersionInfo($source).ProductName
$expectedProduct = if ($Channel -eq 'Development') {'Aion Companion Dev'} else {'Aion Companion Prototype'}
if ($product -ne $expectedProduct) { throw "Executable channel mismatch: expected '$expectedProduct', found '$product'. No active version was changed." }
$checksum = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$versionFolder = Join-Path $installRoot "versions\$checksum"
$publishedExe = Join-Path $versionFolder 'aion-companion.exe'
[void][IO.Directory]::CreateDirectory($versionFolder)
if (-not (Test-Path -LiteralPath $publishedExe)) {
    $stagingExe = Join-Path $versionFolder ([Guid]::NewGuid().ToString('N') + '.tmp')
    Copy-Item -LiteralPath $source -Destination $stagingExe
    if ((Get-FileHash -LiteralPath $stagingExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) {
        throw 'Published executable did not match the successful build.'
    }
    [IO.File]::Move($stagingExe, $publishedExe)
} elseif ((Get-FileHash -LiteralPath $publishedExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) {
    throw 'Existing published build failed its checksum. No shortcuts were changed.'
}
Copy-Item -LiteralPath (Join-Path $workspaceRoot 'THIRD_PARTY_NOTICES.txt') -Destination (Join-Path $versionFolder 'THIRD_PARTY_NOTICES.txt') -Force
}

$launcherSource = Join-Path $PSScriptRoot 'Launcher.cs'
$iconSource = Join-Path $workspaceRoot 'src-tauri/icons/icon.ico'
$launcherExe = Join-Path $installRoot "$appName.exe"
$launcherStamp = Join-Path $installRoot 'launcher.sha256'
$launcherSourceHash = (Get-FileHash -LiteralPath $launcherSource -Algorithm SHA256).Hash
$launcherIconHash = (Get-FileHash -LiteralPath $iconSource -Algorithm SHA256).Hash
# The launcher embeds its icon: an artwork-only update must rebuild it as well.
$launcherHash = "$launcherSourceHash`:$launcherIconHash"
$savedHash = if (Test-Path -LiteralPath $launcherStamp) {[IO.File]::ReadAllText($launcherStamp)} else {''}
if (-not (Test-Path -LiteralPath $launcherExe) -or $savedHash -ne $launcherHash) {
    # The launcher targets .NET Framework, even when this script runs in PowerShell 7.
    $framework = if ([Environment]::Is64BitOperatingSystem) {'Framework64'} else {'Framework'}
    $compiler = Join-Path $env:WINDIR "Microsoft.NET/$framework/v4.0.30319/csc.exe"
    if (-not (Test-Path -LiteralPath $compiler)) { throw "Windows .NET Framework compiler not found: $compiler" }
    $stagingLauncher = Join-Path $installRoot ([Guid]::NewGuid().ToString('N') + '.exe')
    & $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll "/win32icon:$iconSource" "/out:$stagingLauncher" $launcherSource
    if ($LASTEXITCODE -ne 0) {throw 'Windows launcher compilation failed.'}
    if (Test-Path -LiteralPath $launcherExe) {[IO.File]::Replace($stagingLauncher, $launcherExe, [System.Management.Automation.Language.NullString]::Value)}
    else {[IO.File]::Move($stagingLauncher, $launcherExe)}
    [IO.File]::WriteAllText($launcherStamp, $launcherHash)
}
[IO.File]::WriteAllText((Join-Path $installRoot 'launcher.protocol'), '2')
[IO.File]::WriteAllText((Join-Path $installRoot 'channel.txt'), $Channel.ToLowerInvariant())
[IO.File]::WriteAllText((Join-Path $installRoot 'workspace.txt'), $workspaceRoot)
if ($DevExecutable) { [IO.File]::WriteAllText((Join-Path $installRoot 'dev-executable.txt'), [IO.Path]::GetFullPath($DevExecutable)) }
if (-not $Live) {
$pointer = Join-Path $installRoot 'current.txt'
$stagingPointer = Join-Path $installRoot ([Guid]::NewGuid().ToString('N') + '.tmp')
[IO.File]::WriteAllText($stagingPointer, "versions\$checksum\aion-companion.exe")
if (Test-Path -LiteralPath $pointer) {[IO.File]::Replace($stagingPointer, $pointer, [System.Management.Automation.Language.NullString]::Value)}
else {[IO.File]::Move($stagingPointer, $pointer)}
}

if (-not $NoShortcuts) {
$shell = New-Object -ComObject WScript.Shell
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"
$startFolder = Join-Path ([Environment]::GetFolderPath('Programs')) $appName
[void][IO.Directory]::CreateDirectory($startFolder)
$startShortcut = Join-Path $startFolder "$appName.lnk"
foreach ($shortcutPath in @($desktopShortcut, $startShortcut)) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $launcherExe
    $shortcut.WorkingDirectory = $installRoot
    $shortcut.Description = if ($Channel -eq 'Development') {'Develop Aion Companion with live reload'} else {'Open the stable Aion Companion release'}
    $shortcut.IconLocation = "$launcherExe,0"
    $shortcut.Save()
}
Write-Output "Desktop: $desktopShortcut"
Write-Output "Start menu: $startShortcut"
}
if ($Live) { Write-Output "Development shortcut ready: $launcherExe" }
else { Write-Output "Published $Channel build: $publishedExe" }
