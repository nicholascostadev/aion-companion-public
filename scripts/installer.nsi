; Aion Companion Setup: an ordinary per-user setup.exe for the stable channel.
;
; It installs the same layout publish-desktop.ps1 creates, so the permanent
; launcher and the in-app updater keep working unchanged:
;   %LOCALAPPDATA%\AionCompanion\Aion Companion.exe      permanent launcher
;   %LOCALAPPDATA%\AionCompanion\launcher.protocol       "2"
;   %LOCALAPPDATA%\AionCompanion\channel.txt             "stable"
;   %LOCALAPPDATA%\AionCompanion\current.txt             versions\<SHA-256>\aion-companion.exe
;   %LOCALAPPDATA%\AionCompanion\versions\<SHA-256>\     immutable app build and notices
; Saved data in %APPDATA%\org.aioncompanion.prototype is never touched.
;
; Build contract (all paths absolute):
;   makensis /DVERSION=x.y.z /DPAYLOAD_DIR=<stage> /DAPP_HASH=<64 lowercase hex>
;            /DOUTPUT_FILE=<setup.exe> /DICON_FILE=<icon.ico>
;            /DBOOTSTRAPPER=<MicrosoftEdgeWebview2Setup.exe> installer.nsi
;   PAYLOAD_DIR is a root published by publish-desktop.ps1 -Channel Stable -NoShortcuts.
;   Optional: /DSIGN_SCRIPT=<sign-windows.ps1> signs the generated uninstaller.
; Isolated fixture builds only (never publish them):
;   /DTEST_INSTALL_ROOT=<absolute temp root> /DTEST_SHORTCUTS=1 [/DTEST_WEBVIEW2_READY=1]
;   installs into that root, creates no shortcuts or uninstall registration and,
;   with TEST_WEBVIEW2_READY, never installs a runtime on the workstation.
;
; Exit codes: 0 installed, 1 the installed app is running (nothing changed),
; 2 refused or failed (the previously selected version stays active).

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user
AllowSkipFiles off

!macro RequireDefine NAME
  !ifndef ${NAME}
    !error "Define ${NAME}; see the build contract at the top of installer.nsi."
  !endif
!macroend
!insertmacro RequireDefine VERSION
!insertmacro RequireDefine PAYLOAD_DIR
!insertmacro RequireDefine APP_HASH
!insertmacro RequireDefine OUTPUT_FILE
!insertmacro RequireDefine ICON_FILE
!insertmacro RequireDefine BOOTSTRAPPER

!searchparse "${VERSION}" "" VERSION_MAJOR "." VERSION_MINOR "." VERSION_PATCH
; The hash names the version folder, so it must be lowercase hexadecimal only.
!searchreplace HASH_REST0 "${APP_HASH}" "0" ""
!searchreplace HASH_REST1 "${HASH_REST0}" "1" ""
!searchreplace HASH_REST2 "${HASH_REST1}" "2" ""
!searchreplace HASH_REST3 "${HASH_REST2}" "3" ""
!searchreplace HASH_REST4 "${HASH_REST3}" "4" ""
!searchreplace HASH_REST5 "${HASH_REST4}" "5" ""
!searchreplace HASH_REST6 "${HASH_REST5}" "6" ""
!searchreplace HASH_REST7 "${HASH_REST6}" "7" ""
!searchreplace HASH_REST8 "${HASH_REST7}" "8" ""
!searchreplace HASH_REST9 "${HASH_REST8}" "9" ""
!searchreplace HASH_RESTA "${HASH_REST9}" "a" ""
!searchreplace HASH_RESTB "${HASH_RESTA}" "b" ""
!searchreplace HASH_RESTC "${HASH_RESTB}" "c" ""
!searchreplace HASH_RESTD "${HASH_RESTC}" "d" ""
!searchreplace HASH_RESTE "${HASH_RESTD}" "e" ""
!searchreplace HASH_RESTF "${HASH_RESTE}" "f" ""
!if "${HASH_RESTF}" != ""
  !error "APP_HASH must be lowercase hexadecimal."
!endif
!searchparse /file "${PAYLOAD_DIR}\current.txt" "versions\" PAYLOAD_POINTER_HASH "\aion-companion.exe"
!if "${PAYLOAD_POINTER_HASH}" != "${APP_HASH}"
  !error "APP_HASH does not match the payload's current.txt."
!endif
!if ! /FileExists "${PAYLOAD_DIR}\versions\${APP_HASH}\aion-companion.exe"
  !error "The payload is missing versions\${APP_HASH}\aion-companion.exe."
!endif

!ifdef TEST_INSTALL_ROOT
  !if "${TEST_SHORTCUTS}" != "1"
    !error "TEST_INSTALL_ROOT builds must also define TEST_SHORTCUTS=1."
  !endif
!else
  !ifdef TEST_SHORTCUTS | TEST_WEBVIEW2_READY
    !error "Test switches are only accepted together with TEST_INSTALL_ROOT."
  !endif
!endif
!ifdef TEST_WEBVIEW2_READY
  !if "${TEST_WEBVIEW2_READY}" != "1"
    !error "TEST_WEBVIEW2_READY must be 1."
  !endif
!endif

!define APP_NAME "Aion Companion"
!define LAUNCHER "Aion Companion.exe"
!define UNINSTALLER "Uninstall.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AionCompanion"
!define LAUNCH_GATE "Local\AionCompanion.Launch"
!define WEBVIEW2_CLIENT "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WEBVIEW2_DOWNLOAD "https://developer.microsoft.com/microsoft-edge/webview2/consumer/"
!define DATA_FOLDER "%APPDATA%\org.aioncompanion.prototype"
!define EXIT_BUSY 1
!define EXIT_REFUSED 2
!define MOVEFILE_REPLACE_WRITE_THROUGH 9 ; MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

Name "${APP_NAME}"
OutFile "${OUTPUT_FILE}"
BrandingText "${APP_NAME} ${VERSION}"
; The root is fixed: the in-app updater and the launcher both expect it.
InstallDir "$LOCALAPPDATA\AionCompanion"
ShowInstDetails hide
ShowUninstDetails hide

!ifdef SIGN_SCRIPT
  !uninstfinalize 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${SIGN_SCRIPT}" -Path "%1" -RequireSigning' = 0
!endif

Var LaunchGate
Var DesktopFolder
Var ProgramsFolder
Var DesktopDefault
Var Installed
Var PreviousVersion

;--------------------------------
; Pages

!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TEXT "Setup will install ${APP_NAME} ${VERSION} for your Windows account. Administrator rights are not needed.$\r$\n$\r$\nIf ${APP_NAME} is already installed, it is updated and your settings, pets and recordings are kept. Quit ${APP_NAME} from its tray menu before continuing.$\r$\n$\r$\nClick Install to continue."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TEXT "${APP_NAME} is installed.$\r$\n$\r$\nLive combat capture needs the free Npcap driver, which is installed separately; ${APP_NAME} will guide you through it. Everything else works without it."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP_NAME}"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenInstalledApp
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a Desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE FinishLeave
!insertmacro MUI_PAGE_FINISH

!define MUI_UNCONFIRMPAGE_TEXT_TOP "${APP_NAME} will be removed from your Windows account. Your settings, pets and recordings in ${DATA_FOLDER} are kept."
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

!pragma warning disable 9100 ; No LegalCopyright key: the project does not state one.
VIProductVersion "${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH}.0"
VIFileVersion "${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH}.0"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${VERSION}"

;--------------------------------
; Shared helpers, defined once for the installer and once for the uninstaller.

!macro Refuse CODE MESSAGE
  DetailPrint "${MESSAGE}"
  MessageBox MB_OK|MB_ICONEXCLAMATION "${MESSAGE}" /SD IDOK
  SetErrorLevel ${CODE}
  Abort
!macroend

!macro DefineHelpers UN
; $0 in: path. $0 out: absolute long path without a trailing backslash.
Function ${UN}NormalizePath
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i .r2'
  ${If} $2 <> 0
    StrCpy $0 $1
  ${EndIf}
  System::Call 'kernel32::GetLongPathNameW(w r0, w .r1, i ${NSIS_MAX_STRLEN}) i .r2'
  ${If} $2 <> 0
    StrCpy $0 $1
  ${EndIf}
  ${Do}
    StrLen $1 $0
    StrCpy $2 $0 1 -1
    ${IfThen} $1 <= 3 ${|} ${ExitDo} ${|}
    ${IfThen} $2 != "\" ${|} ${ExitDo} ${|}
    StrCpy $0 $0 -1
  ${Loop}
FunctionEnd

; $0 in: path. $1 out: 1 when it is a junction or symbolic link, else 0.
Function ${UN}IsReparsePoint
  System::Call 'kernel32::GetFileAttributesW(w r0) i .r1'
  ${If} $1 = -1
    StrCpy $1 0
  ${Else}
    IntOp $1 $1 & 0x400 ; FILE_ATTRIBUTE_REPARSE_POINT
    ${IfThen} $1 <> 0 ${|} StrCpy $1 1 ${|}
  ${EndIf}
FunctionEnd

; Holds the launcher's own gate while files change, so shortcuts and the
; updater wait instead of starting a half-written installation.
; Must be acquired and released on the same (section) thread.
Function ${UN}AcquireLaunchGate
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "${LAUNCH_GATE}") p .r0'
  ${If} $0 = 0
    !insertmacro Refuse ${EXIT_REFUSED} "Setup could not coordinate with ${APP_NAME}. Nothing was changed. Restart Windows and run it again."
  ${EndIf}
  System::Call 'kernel32::WaitForSingleObject(p r0, i 0) i .r1'
  ${If} $1 = 0     ; WAIT_OBJECT_0
  ${OrIf} $1 = 128 ; WAIT_ABANDONED: the previous owner exited, the gate is now ours
    StrCpy $LaunchGate $0
  ${Else}
    System::Call 'kernel32::CloseHandle(p r0)'
    !insertmacro Refuse ${EXIT_BUSY} "${APP_NAME} is starting or updating. Nothing was changed. Wait until it has finished, quit it from its tray menu, then run this again."
  ${EndIf}
FunctionEnd

Function ${UN}ReleaseLaunchGate
  ${If} $LaunchGate <> 0
    System::Call 'kernel32::ReleaseMutex(p $LaunchGate)'
    System::Call 'kernel32::CloseHandle(p $LaunchGate)'
    StrCpy $LaunchGate 0
  ${EndIf}
FunctionEnd

; Runs this build's launcher, extracted to $PLUGINSDIR, as a side-effect-free probe.
; Older installed launchers are never run: they do not know the flag and would open the app.
Function ${UN}RequireIdle
  ClearErrors
  ExecWait '"$PLUGINSDIR\installation-probe.exe" --installation-idle "$INSTDIR"' $0
  ${If} ${Errors}
    StrCpy $0 2
  ${EndIf}
  ${If} $0 = 1
    Call ${UN}ReleaseLaunchGate
    !insertmacro Refuse ${EXIT_BUSY} "${APP_NAME} is running. Nothing was changed.$\r$\n$\r$\nQuit it with Quit ${APP_NAME} in its tray menu, so your current session is saved, then run this again."
  ${ElseIf} $0 <> 0
    Call ${UN}ReleaseLaunchGate
    !insertmacro Refuse ${EXIT_REFUSED} "Setup could not check whether ${APP_NAME} is running. Nothing was changed. Restart Windows and run it again."
  ${EndIf}
FunctionEnd

Function ${UN}ExtractProbe
  InitPluginsDir
  File "/oname=$PLUGINSDIR\installation-probe.exe" "${PAYLOAD_DIR}\${LAUNCHER}"
FunctionEnd

Function ${UN}SelectRoot
  !ifdef TEST_INSTALL_ROOT
    StrCpy $0 "${TEST_INSTALL_ROOT}"
    StrCpy $DesktopFolder ""
    StrCpy $ProgramsFolder ""
  !else
    ${If} $LOCALAPPDATA == ""
      !insertmacro Refuse ${EXIT_REFUSED} "Windows did not report your local application data folder, so ${APP_NAME} cannot be installed for this account."
    ${EndIf}
    StrCpy $0 "$LOCALAPPDATA\AionCompanion"
    StrCpy $DesktopFolder "$DESKTOP"
    StrCpy $ProgramsFolder "$SMPROGRAMS\${APP_NAME}"
  !endif
  Call ${UN}NormalizePath
FunctionEnd
!macroend
!insertmacro DefineHelpers ""
!insertmacro DefineHelpers "un."

;--------------------------------
; Installer

Function .onInit
  ${IfNot} ${AtLeastWin10}
  ${OrIfNot} ${IsNativeAMD64}
    !insertmacro Refuse ${EXIT_REFUSED} "${APP_NAME} needs 64-bit (x64) Windows 10 or Windows 11."
  ${EndIf}
  ; Ignores /D=: the updater and launcher only work from the fixed root.
  Call SelectRoot
  StrCpy $INSTDIR $0
  Call IsReparsePoint
  ${If} $1 = 1
    !insertmacro Refuse ${EXIT_REFUSED} "$INSTDIR is a link to another folder. Nothing was changed. Remove the link, then run Setup again."
  ${EndIf}
  StrCpy $LaunchGate 0
  StrCpy $Installed 0
  Call ExtractProbe
  ; Early, friendly check. The section checks again while holding the gate.
  Call RequireIdle
  StrCpy $DesktopDefault ${BST_CHECKED}
  ${If} ${FileExists} "$INSTDIR\${LAUNCHER}"
  ${AndIfNot} ${FileExists} "$DesktopFolder\${APP_NAME}.lnk"
    StrCpy $DesktopDefault ${BST_UNCHECKED} ; Keep an upgrade's earlier choice.
  ${EndIf}
FunctionEnd

; $0 out: 1 when the Evergreen WebView2 Runtime is installed per-user or per-machine.
Function HasWebView2
  StrCpy $0 0
  !macro ReadWebView2 VIEW HIVE
    SetRegView ${VIEW}
    ReadRegStr $1 ${HIVE} "SOFTWARE\${WEBVIEW2_CLIENT}" "pv"
    ${If} $1 != ""
    ${AndIf} $1 != "0.0.0.0"
      StrCpy $0 1
    ${EndIf}
  !macroend
  ; View 32 reads HKLM\SOFTWARE\WOW6432Node on 64-bit Windows, as documented by Microsoft.
  !insertmacro ReadWebView2 32 HKLM
  !insertmacro ReadWebView2 64 HKLM
  !insertmacro ReadWebView2 32 HKCU
  !insertmacro ReadWebView2 64 HKCU
  SetRegView default
FunctionEnd

Function EnsureWebView2
  !ifdef TEST_WEBVIEW2_READY
    DetailPrint "Fixture build: the WebView2 Runtime check is skipped."
  !else
    Call HasWebView2
    ${If} $0 = 1
      Return
    ${EndIf}
    DetailPrint "Installing the Microsoft Edge WebView2 Runtime..."
    File "/oname=$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" "${BOOTSTRAPPER}"
    ClearErrors
    ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $2
    ${If} ${Errors}
      StrCpy $2 "not started"
    ${EndIf}
    Call HasWebView2
    ${If} $0 <> 1
      !insertmacro Refuse ${EXIT_REFUSED} "${APP_NAME} needs the Microsoft Edge WebView2 Runtime, and Setup could not install it (result: $2). Nothing was changed.$\r$\n$\r$\nConnect to the internet and run Setup again, or install the Evergreen WebView2 Runtime from ${WEBVIEW2_DOWNLOAD} first."
    ${EndIf}
  !endif
FunctionEnd

; Replaces TARGET with the fully written STAGED file in one step. Windows refuses
; to replace a running executable, so a race can never overwrite one in use.
!macro Publish STAGED TARGET
  System::Call 'kernel32::MoveFileExW(w "${STAGED}", w "${TARGET}", i ${MOVEFILE_REPLACE_WRITE_THROUGH}) i .r0'
  ${If} $0 = 0
    Delete "${STAGED}"
    Call ReleaseLaunchGate
    !insertmacro Refuse ${EXIT_REFUSED} "Setup could not write ${TARGET}. The previously installed version is unchanged. Quit ${APP_NAME}, then run Setup again."
  ${EndIf}
!macroend

!macro PublishText CONTENT TARGET
  ClearErrors
  FileOpen $1 "${TARGET}.setup.tmp" w
  FileWrite $1 "${CONTENT}"
  FileClose $1
  ${If} ${Errors}
    Delete "${TARGET}.setup.tmp"
    Call ReleaseLaunchGate
    !insertmacro Refuse ${EXIT_REFUSED} "Setup could not write ${TARGET}. The previously installed version is unchanged."
  ${EndIf}
  !insertmacro Publish "${TARGET}.setup.tmp" "${TARGET}"
!macroend

!macro RequirePlainFolder PATH
  StrCpy $0 "${PATH}"
  Call IsReparsePoint
  ${If} $1 = 1
    Call ReleaseLaunchGate
    !insertmacro Refuse ${EXIT_REFUSED} "${PATH} is a link to another folder. Nothing was changed."
  ${EndIf}
  ClearErrors
  CreateDirectory "${PATH}"
  ${If} ${Errors}
    Call ReleaseLaunchGate
    !insertmacro Refuse ${EXIT_REFUSED} "Setup could not create ${PATH}. Nothing was changed."
  ${EndIf}
!macroend

Section "${APP_NAME}" SectionApp
  SectionIn RO
  ; Everything up to the pointer switch leaves the active version untouched.
  Call EnsureWebView2
  Call AcquireLaunchGate
  Call RequireIdle
  StrCpy $PreviousVersion ""
  ${If} ${FileExists} "$INSTDIR\current.txt"
    FileOpen $1 "$INSTDIR\current.txt" r
    FileRead $1 $PreviousVersion
    FileClose $1
  ${EndIf}

  !define VERSION_DIR "$INSTDIR\versions\${APP_HASH}"
  !insertmacro RequirePlainFolder "$INSTDIR"
  !insertmacro RequirePlainFolder "$INSTDIR\versions"
  !insertmacro RequirePlainFolder "${VERSION_DIR}"

  ; 1. The immutable version folder.
  DetailPrint "Installing ${APP_NAME} ${VERSION}..."
  File "/oname=${VERSION_DIR}\aion-companion.exe.setup.tmp" "${PAYLOAD_DIR}\versions\${APP_HASH}\aion-companion.exe"
  !insertmacro Publish "${VERSION_DIR}\aion-companion.exe.setup.tmp" "${VERSION_DIR}\aion-companion.exe"
  File "/oname=${VERSION_DIR}\THIRD_PARTY_NOTICES.txt.setup.tmp" "${PAYLOAD_DIR}\versions\${APP_HASH}\THIRD_PARTY_NOTICES.txt"
  !insertmacro Publish "${VERSION_DIR}\THIRD_PARTY_NOTICES.txt.setup.tmp" "${VERSION_DIR}\THIRD_PARTY_NOTICES.txt"

  ; 2. The permanent launcher and its metadata. The new launcher still reads the
  ;    previous pointer, so a failure before step 3 keeps the earlier version working.
  File "/oname=$INSTDIR\${LAUNCHER}.setup.tmp" "${PAYLOAD_DIR}\${LAUNCHER}"
  !insertmacro Publish "$INSTDIR\${LAUNCHER}.setup.tmp" "$INSTDIR\${LAUNCHER}"
  !insertmacro PublishText "2" "$INSTDIR\launcher.protocol"
  !insertmacro PublishText "stable" "$INSTDIR\channel.txt"

  ; 3. The uninstaller, then the active pointer last.
  WriteUninstaller "$INSTDIR\${UNINSTALLER}.setup.tmp"
  !insertmacro Publish "$INSTDIR\${UNINSTALLER}.setup.tmp" "$INSTDIR\${UNINSTALLER}"
  ${If} $PreviousVersion != "versions\${APP_HASH}\aion-companion.exe"
    !insertmacro PublishText "$PreviousVersion" "$INSTDIR\previous.txt"
  ${EndIf}
  !insertmacro PublishText "versions\${APP_HASH}\aion-companion.exe" "$INSTDIR\current.txt"
  !undef VERSION_DIR
  StrCpy $Installed 1

  ; 4. Shortcuts and Apps & features registration.
  !ifndef TEST_SHORTCUTS
    SetOutPath "$INSTDIR"
    CreateDirectory "$ProgramsFolder"
    CreateShortcut "$ProgramsFolder\${APP_NAME}.lnk" "$INSTDIR\${LAUNCHER}" "" "$INSTDIR\${LAUNCHER}" 0 SW_SHOWNORMAL "" "Open ${APP_NAME}"
    ${If} ${FileExists} "$DesktopFolder\${APP_NAME}.lnk"
      Call CreateDesktopShortcut ; Refreshes an existing shortcut, including in silent mode.
    ${EndIf}
  !endif
  !ifndef TEST_INSTALL_ROOT
    ${GetSize} "$INSTDIR" "/S=0K /G=1" $0 $1 $2
    SetRegView 64
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${LAUNCHER},0"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
    WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /S'
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
    SetRegView default
  !endif

  Call ReleaseLaunchGate
  ; The helper takes the same gate itself and refuses busy installations. Run
  ; after releasing ours so another process never deadlocks on the installer.
  ; Cleanup is best effort; it must not turn a successful installation into failure.
  ExecWait '"$PLUGINSDIR\installation-probe.exe" --maintain-installation "$INSTDIR"' $0
  SetErrorLevel 0
SectionEnd

Function CreateDesktopShortcut
  !ifndef TEST_SHORTCUTS
    ${If} $Installed = 1
      SetOutPath "$INSTDIR"
      CreateShortcut "$DesktopFolder\${APP_NAME}.lnk" "$INSTDIR\${LAUNCHER}" "" "$INSTDIR\${LAUNCHER}" 0 SW_SHOWNORMAL "" "Open ${APP_NAME}"
    ${EndIf}
  !endif
FunctionEnd

Function FinishShow
  SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} $DesktopDefault 0
FunctionEnd

Function FinishLeave
  ; An unticked box removes only this app's own Desktop shortcut.
  SendMessage $mui.FinishPage.ShowReadme ${BM_GETCHECK} 0 0 $0
  ${If} $0 <> ${BST_CHECKED}
  ${AndIf} $Installed = 1
    !ifndef TEST_SHORTCUTS
      Delete "$DesktopFolder\${APP_NAME}.lnk"
    !endif
  ${EndIf}
FunctionEnd

Function OpenInstalledApp
  ${If} $Installed = 1
    SetOutPath "$INSTDIR"
    Exec '"$INSTDIR\${LAUNCHER}"'
  ${EndIf}
FunctionEnd

Function .onInstFailed
  Call ReleaseLaunchGate
FunctionEnd

Function .onGUIEnd
  Call ReleaseLaunchGate
FunctionEnd

;--------------------------------
; Uninstaller

; $R0 in: folder name. $R1 out: 1 for a 64-character lowercase SHA-256 name.
Function un.IsHashName
  StrCpy $R1 0
  StrLen $R2 $R0
  ${IfThen} $R2 <> 64 ${|} Return ${|}
  StrCpy $R2 0
  ${Do}
    StrCpy $R3 $R0 1 $R2
    StrCpy $R4 0
    StrCpy $R5 0
    ${Do}
      StrCpy $R6 "0123456789abcdef" 1 $R5
      ${If} $R3 S== $R6
        StrCpy $R4 1
        ${ExitDo}
      ${EndIf}
      IntOp $R5 $R5 + 1
    ${LoopUntil} $R5 >= 16
    ${IfThen} $R4 = 0 ${|} Return ${|}
    IntOp $R2 $R2 + 1
  ${LoopUntil} $R2 >= 64
  StrCpy $R1 1
FunctionEnd

; Deletes the named app-owned files in each direct subfolder of PARENT, then the
; emptied folders. Linked folders and anything unexpected are left in place.
!macro UnRemoveOwnedFolders PARENT HASH_NAMES FIRST SECOND THIRD
  StrCpy $0 "${PARENT}"
  Call un.IsReparsePoint
  ${If} $1 = 0
  ${AndIf} ${FileExists} "${PARENT}\*.*"
    FindFirst $R8 $R0 "${PARENT}\*"
    ${DoWhile} $R0 != ""
      ${If} $R0 != "."
      ${AndIf} $R0 != ".."
      ${AndIf} ${FileExists} "${PARENT}\$R0\*.*"
        StrCpy $R1 1
        !if "${HASH_NAMES}" == "1"
          Call un.IsHashName
        !endif
        StrCpy $0 "${PARENT}\$R0"
        Call un.IsReparsePoint
        ${If} $R1 = 1
        ${AndIf} $1 = 0
          Delete "${PARENT}\$R0\${FIRST}"
          Delete "${PARENT}\$R0\${SECOND}"
          Delete "${PARENT}\$R0\${THIRD}"
          RMDir "${PARENT}\$R0"
        ${EndIf}
      ${EndIf}
      FindNext $R8 $R0
    ${Loop}
    FindClose $R8
    RMDir "${PARENT}"
  ${EndIf}
!macroend

Function un.onInit
  StrCpy $LaunchGate 0
  ; Only the fixed root may be removed; a copied or relocated uninstaller,
  ; or one started with a different _?= folder, refuses to delete anything.
  StrCpy $0 $INSTDIR
  Call un.NormalizePath
  StrCpy $3 $0
  Call un.SelectRoot
  ${If} $3 != $0
    !insertmacro Refuse ${EXIT_REFUSED} "This uninstaller only removes ${APP_NAME} from $0. Nothing was changed."
  ${EndIf}
  StrCpy $INSTDIR $0
  Call un.IsReparsePoint
  ${If} $1 = 1
    !insertmacro Refuse ${EXIT_REFUSED} "$INSTDIR is a link to another folder. Nothing was changed."
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\channel.txt"
    ClearErrors
    FileOpen $1 "$INSTDIR\channel.txt" r
    FileRead $1 $2 32
    FileClose $1
    ${Do}
      StrCpy $4 $2 1 -1
      ${If} $4 != "$\r"
      ${AndIf} $4 != "$\n"
        ${ExitDo}
      ${EndIf}
      StrCpy $2 $2 -1
    ${Loop}
    ${If} $2 != "stable"
      !insertmacro Refuse ${EXIT_REFUSED} "$INSTDIR is not a stable ${APP_NAME} installation. Nothing was changed."
    ${EndIf}
  ${EndIf}
  Call un.ExtractProbe
  Call un.RequireIdle
FunctionEnd

Section "Uninstall"
  Call un.AcquireLaunchGate
  Call un.RequireIdle

  ; The pointer goes first, so a partly removed installation never starts.
  Delete "$INSTDIR\current.txt"
  Delete "$INSTDIR\previous.txt"
  !insertmacro UnRemoveOwnedFolders "$INSTDIR\versions" 1 "aion-companion.exe" "THIRD_PARTY_NOTICES.txt" "*.tmp"
  !insertmacro UnRemoveOwnedFolders "$INSTDIR\updates" 0 "AionCompanion-*-windows-x64.exe" "THIRD_PARTY_NOTICES.txt" "*.tmp"
  Delete "$INSTDIR\${LAUNCHER}"
  Delete "$INSTDIR\launcher.protocol"
  Delete "$INSTDIR\launcher.sha256"
  Delete "$INSTDIR\channel.txt"
  Delete "$INSTDIR\workspace.txt" ; Left by script-based stable installs.
  Delete "$INSTDIR\*.setup.tmp"

  !ifndef TEST_SHORTCUTS
    Delete "$DesktopFolder\${APP_NAME}.lnk"
    Delete "$ProgramsFolder\${APP_NAME}.lnk"
    RMDir "$ProgramsFolder"
  !endif
  !ifndef TEST_INSTALL_ROOT
    SetRegView 64
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    SetRegView default
  !endif

  Delete "$INSTDIR\${UNINSTALLER}"
  ; Not recursive: unexpected files keep the folder, and saved data lives elsewhere.
  RMDir "$INSTDIR"
  Call un.ReleaseLaunchGate
SectionEnd

Function un.onUninstFailed
  Call un.ReleaseLaunchGate
FunctionEnd

Function un.onGUIEnd
  Call un.ReleaseLaunchGate
FunctionEnd
