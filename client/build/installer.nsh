!include "FileFunc.nsh"

; Адрес сервера можно задать именем установщика: Electron_s192.168.1.2-3000.exe
; Всё, что идёт после _s, кладём в server.cfg рядом с приложением — клиент подставит
; это в поле адреса при первом запуске. Двоеточие в именах файлов Windows недопустимо,
; поэтому порт отделяется дефисом.
;
; Поиск подстроки сделан циклом, а не через StrFunc: та объявляет функцию StrLoc,
; которая не попадает в код деинсталлятора, и сборка падает на предупреждении
; «install function not referenced» (в electron-builder они трактуются как ошибки).
!macro customInstall
  ${GetFileName} "$EXEPATH" $R0
  ${GetBaseName} "$R0" $R1

  StrCpy $R2 ""
  StrLen $R3 $R1
  StrCpy $R4 0

  find_loop:
    IntCmp $R4 $R3 find_done 0 find_done
    StrCpy $R5 $R1 2 $R4
    StrCmp $R5 "_s" 0 find_next
    IntOp $R6 $R4 + 2
    StrCpy $R2 $R1 "" $R6
    Goto find_done
  find_next:
    IntOp $R4 $R4 + 1
    Goto find_loop
  find_done:

  StrCmp $R2 "" skip_server_cfg
  FileOpen $R7 "$INSTDIR\server.cfg" w
  FileWrite $R7 "$R2"
  FileClose $R7
  skip_server_cfg:

  ; Запускаем приложение от имени обычного пользователя, а не от установщика. ExecShell наследовал
  ; права установщика: после установки или обновления «для всех» (UAC) приложение оказывалось
  ; запущенным от администратора, и Windows (UIPI) не пропускала в него файлы, перетащенные
  ; из обычного Проводника. Так же запускает приложение сам electron-builder (macro StartApp).
  ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\Electron.exe" "open" ""
!macroend
