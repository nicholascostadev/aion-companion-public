$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('aion-launcher-verify-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$launcher=Join-Path $testRoot 'Aion Companion.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll "/out:$launcher" (Join-Path $PSScriptRoot 'Launcher.cs')
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed'}
$bytes=[Text.Encoding]::UTF8.GetBytes('Isolated launcher validation fixture. This file is never executed.')
$sha=[Security.Cryptography.SHA256]::Create()
$checksum=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
$folder=Join-Path $testRoot "versions/$checksum"
[void][IO.Directory]::CreateDirectory($folder)
$candidate=Join-Path $folder 'aion-companion.exe'
[IO.File]::WriteAllBytes($candidate,$bytes)
$pointer=Join-Path $testRoot 'current.txt'
[IO.File]::WriteAllText($pointer,'previous-version')
function VerifyExit([string]$value,[int]$expected){
  $process=Start-Process -FilePath $launcher -ArgumentList @('--verify-update',$value) -PassThru -Wait -WindowStyle Hidden
  if($process.ExitCode -ne $expected){throw "Wrong verification exit code: $($process.ExitCode), expected $expected"}
}
VerifyExit $checksum 0
[IO.File]::WriteAllText($candidate,'changed')
VerifyExit $checksum 1
VerifyExit ('f'*64) 1
VerifyExit '../outside' 1
if([IO.File]::ReadAllText($pointer) -ne 'previous-version'){throw 'Verification changed the active version'}
Write-Output 'PASS launcher compilation, checksum verification, tampering and traversal rejection; active version preserved.'

# The launcher must quit a hidden tray app without sending its hide-only WM_CLOSE.
$quitSource=Join-Path $testRoot 'QuitDriver.cs'
@'
using System;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
internal static class QuitSmoke {
  [STAThread] private static int Main() {
    var request=typeof(Launcher).GetMethod("RequestQuit",BindingFlags.Static|BindingFlags.NonPublic);
    int id=System.Diagnostics.Process.GetCurrentProcess().Id;
    using(var signal=new EventWaitHandle(false,EventResetMode.AutoReset,@"Local\AionCompanion.SaveAndQuit."+id)) {
      for(int i=0;i<2;i++) {
        if(signal.WaitOne(0)) return 1;
        if(!(bool)request.Invoke(null,new object[]{id,IntPtr.Zero}) || !signal.WaitOne(1000)) return 2;
      }
    }
    using(var legacy=new Form()) {
      bool closed=false;
      legacy.FormClosing+=(s,e)=>{closed=true;e.Cancel=true;};
      if(!(bool)request.Invoke(null,new object[]{id,legacy.Handle})) return 3;
      Application.DoEvents();
      if(!closed) return 4;
    }
    if((bool)request.Invoke(null,new object[]{id,IntPtr.Zero})) return 5;
    return 0;
  }
}
'@ | Set-Content -LiteralPath $quitSource
$quitDriver=Join-Path $testRoot 'QuitDriver.exe'
& $compiler /nologo /target:winexe /main:QuitSmoke /reference:System.Windows.Forms.dll "/out:$quitDriver" (Join-Path $PSScriptRoot 'Launcher.cs') $quitSource
if($LASTEXITCODE -ne 0){throw 'Quit driver compilation failed'}
$quitTest=Start-Process -FilePath $quitDriver -PassThru -Wait -WindowStyle Hidden
if($quitTest.ExitCode -ne 0){throw "Quit signal test failed: $($quitTest.ExitCode)"}
Write-Output 'PASS explicit quit of hidden tray app, retry after failed save, legacy WM_CLOSE fallback and missing window rejection.'


$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('aion-launcher-handoff-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$launcherSource=Join-Path $PSScriptRoot 'Launcher.cs'
$driverSource=Join-Path $testRoot 'Driver.cs'
@'
using System;
using System.Reflection;
internal static class UpdateSmoke {
  [STAThread] private static int Main(string[] args) {
    try { return (int)typeof(Launcher).GetMethod("ApplyUpdate",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,args); }
    catch { return 2; }
  }
}
'@ | Set-Content -LiteralPath $driverSource
$driver=Join-Path $testRoot 'Driver.exe'
& $compiler /nologo /target:winexe /main:UpdateSmoke /reference:System.Windows.Forms.dll "/out:$driver" $launcherSource $driverSource
if($LASTEXITCODE -ne 0){throw 'Handoff driver compilation failed'}
$fixtureSource=Join-Path $testRoot 'Fixture.cs'
@'
using System;
using System.Threading;
using System.Windows.Forms;
internal static class Fixture {
  [STAThread] private static void Main(string[] args) {
    if(args.Length>0) {Thread.Sleep(300);return;}
    var form=new Form { Text="Aion Companion test · Combat workspace", Opacity=0, ShowInTaskbar=false };
    var timer=new System.Windows.Forms.Timer {Interval=1400};
    timer.Tick+=(s,e)=>form.Close(); timer.Start(); Application.Run(form);
  }
}
'@ | Set-Content -LiteralPath $fixtureSource -Encoding UTF8
$fixture=Join-Path $testRoot 'Fixture.exe'
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$fixture" $fixtureSource
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
$hash=(Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
$folder=Join-Path $testRoot "versions/$hash"
[void][IO.Directory]::CreateDirectory($folder)
Copy-Item -LiteralPath $fixture -Destination (Join-Path $folder 'aion-companion.exe') -Force
$pointer=Join-Path $testRoot 'current.txt'
function OldBuild([string]$content) {
    $file = Join-Path $testRoot 'old-fixture.bin'
    [IO.File]::WriteAllText($file, $content)
    $digest = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $directory = Join-Path $testRoot "versions/$digest"
    [void][IO.Directory]::CreateDirectory($directory)
    Copy-Item -LiteralPath $file -Destination (Join-Path $directory 'aion-companion.exe') -Force
    return "versions\$digest\aion-companion.exe"
}
$oldPointer = OldBuild 'previous active build'
$obsoletePointer = OldBuild 'obsolete fallback build'
[IO.File]::WriteAllText($pointer, $oldPointer)
[IO.File]::WriteAllText((Join-Path $testRoot 'channel.txt'), 'stable')
[IO.File]::WriteAllText((Join-Path $testRoot 'previous.txt'), $obsoletePointer)
$parent=Start-Process -FilePath $fixture -ArgumentList '--parent' -WindowStyle Hidden -PassThru
$helper=Start-Process -FilePath $driver -ArgumentList @(('"'+$testRoot+'"'),$hash,$parent.Id.ToString()) -PassThru -Wait -WindowStyle Hidden
if($helper.ExitCode -ne 0){throw "Handoff failed: $($helper.ExitCode)"}
if([IO.File]::ReadAllText($pointer) -ne "versions\$hash\aion-companion.exe"){throw 'Active version was not committed'}
if (-not (Test-Path -LiteralPath (Join-Path $testRoot $oldPointer))) { throw 'Update removed previous active build.' }
if (Test-Path -LiteralPath (Join-Path $testRoot $obsoletePointer)) { throw 'Update retained obsolete fallback.' }
if ([IO.File]::ReadAllText((Join-Path $testRoot 'previous.txt')) -ne $oldPointer) { throw 'Update selected the wrong fallback.' }
# A verified executable that exits during startup must restore the previous pointer.
$failureSource=Join-Path $testRoot 'Fail.cs'
'internal static class Fail {private static void Main(){}}' | Set-Content -LiteralPath $failureSource
$failure=Join-Path $testRoot 'Fail.exe'
& $compiler /nologo /target:winexe "/out:$failure" $failureSource
if($LASTEXITCODE -ne 0){throw 'Failure fixture compilation failed'}
$badHash=(Get-FileHash -LiteralPath $failure -Algorithm SHA256).Hash.ToLowerInvariant()
$badFolder=Join-Path $testRoot "versions/$badHash"
[void][IO.Directory]::CreateDirectory($badFolder)
Copy-Item -LiteralPath $failure -Destination (Join-Path $badFolder 'aion-companion.exe') -Force
[IO.File]::WriteAllText($pointer, $oldPointer)
# Let the successful fixture's own timer end it before testing another handoff.
Start-Sleep -Milliseconds 1500
$parent=Start-Process -FilePath $fixture -ArgumentList '--parent' -WindowStyle Hidden -PassThru
$helper=Start-Process -FilePath $driver -ArgumentList @(('"'+$testRoot+'"'),$badHash,$parent.Id.ToString()) -PassThru -Wait -WindowStyle Hidden
if($helper.ExitCode -ne 2){throw 'Expected rejected startup'}
if([IO.File]::ReadAllText($pointer) -ne $oldPointer){throw 'Failed startup did not roll back'}
if (Test-Path -LiteralPath (Join-Path $badFolder 'aion-companion.exe')) { throw 'Failed update was retained as a future fallback.' }
Write-Output 'PASS isolated update handoff: wait for old app, atomic activation, current plus fallback retention, startup, rollback and failed-build removal.'

& (Join-Path $PSScriptRoot 'test-installation-cleanup.ps1')
