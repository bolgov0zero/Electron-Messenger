!include "FileFunc.nsh"
!include "StrFunc.nsh"
${StrLoc}

; Адрес сервера можно задать именем установщика: Electron_s192.168.1.2-3000.exe
; Всё, что идёт после _s, кладём в server.cfg рядом с приложением — клиент
; подставит это в поле адреса при первом запуске. Двоеточие в именах файлов
; Windows недопустимо, поэтому порт отделяется дефисом.
!macro customInstall
  ${GetFileName} "$EXEPATH" $R0
  ${GetBaseName} "$R0" $R1
  ${StrLoc} $R2 "$R1" "_s" ">"
  StrCmp $R2 "" skip_server_cfg
  IntOp $R3 $R2 + 2
  StrCpy $R4 "$R1" "" $R3
  StrCmp $R4 "" skip_server_cfg
  FileOpen $R5 "$INSTDIR\server.cfg" w
  FileWrite $R5 "$R4"
  FileClose $R5
  skip_server_cfg:
  ExecShell "" "$INSTDIR\Electron.exe"
!macroend
