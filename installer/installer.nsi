; Windows installer for Effort Estimation (built by scripts/build-windows.mjs).
; Per-user install: no administrator rights needed.
;   Program:   %LOCALAPPDATA%\Programs\EffortEstimation
;   Settings:  %LOCALAPPDATA%\EffortEstimation\config.json   (kept on uninstall)
;   Data:      %LOCALAPPDATA%\EffortEstimation\data          (kept on uninstall)
;
; Expected defines: VERSION, EXE (path to EffortEstimation.exe), ICON, OUTFILE

Unicode true
!include "MUI2.nsh"

!define APPNAME "Effort Estimation"
!define APPKEY "EffortEstimation"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${APPNAME}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APPKEY}"
InstallDirRegKey HKCU "Software\${APPKEY}" "InstallDir"
SetCompressor /SOLID lzma
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\EffortEstimation.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "--open"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APPNAME} now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "German"

!macro StopRunningInstance
  IfFileExists "$INSTDIR\EffortEstimation.exe" 0 +3
    ExecWait '"$INSTDIR\EffortEstimation.exe" --stop'
    Sleep 1500
!macroend

Section "${APPNAME}" SecMain
  SectionIn RO
  ; A running instance locks the exe, so stop it before replacing it (updates).
  !insertmacro StopRunningInstance

  SetOutPath "$INSTDIR"
  File "/oname=EffortEstimation.exe" "${EXE}"
  File "/oname=EffortEstimation.ico" "${ICON}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\EffortEstimation.exe" "--open" "$INSTDIR\EffortEstimation.ico"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Stop ${APPNAME}.lnk" "$INSTDIR\EffortEstimation.exe" "--stop" "$INSTDIR\EffortEstimation.ico"
  CreateDirectory "$LOCALAPPDATA\${APPKEY}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME} settings and data.lnk" "$LOCALAPPDATA\${APPKEY}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; "Apps & features" entry (per user)
  WriteRegStr HKCU "Software\${APPKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\EffortEstimation.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" 95000

  ; Reset autostart; the optional section below re-adds it when selected.
  DeleteRegValue HKCU "${RUNKEY}" "${APPKEY}"
SectionEnd

Section "Start automatically when Windows starts" SecAutostart
  WriteRegStr HKCU "${RUNKEY}" "${APPKEY}" '"$INSTDIR\EffortEstimation.exe"'
  ; Start it in the background right away, too.
  Exec '"$INSTDIR\EffortEstimation.exe"'
SectionEnd

Section /o "Desktop shortcut" SecDesktop
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\EffortEstimation.exe" "--open" "$INSTDIR\EffortEstimation.ico"
SectionEnd

Section "Uninstall"
  !insertmacro StopRunningInstance
  DeleteRegValue HKCU "${RUNKEY}" "${APPKEY}"

  Delete "$INSTDIR\EffortEstimation.exe"
  Delete "$INSTDIR\EffortEstimation.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APPNAME}\*.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"

  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPKEY}"
  ; Settings and saved estimations in $LOCALAPPDATA\${APPKEY} are kept on purpose.
SectionEnd
