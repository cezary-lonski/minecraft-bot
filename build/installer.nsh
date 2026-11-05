; Program na dysku D (jesli jest): instalator proponuje D:\Minecraft Bot\Program.
; Tez przy automatycznej aktualizacji - starsza kopia z dysku C (lub swieza instalacja) trafia na D.
; Instalacji na innym dysku (np. E:) nie ruszamy. Dane programu sa obok, w D:\Minecraft Bot\Dane (main.js).
!macro preInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCpy $1 $0 1
  StrCmp $1 "" mbSetD
  StrCmp $1 "C" mbSetD
  StrCmp $1 "c" mbSetD
  Goto mbDone
  mbSetD:
  IfFileExists "D:\*.*" 0 mbDone
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\Minecraft Bot\Program"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\Minecraft Bot\Program"
  mbDone:
!macroend
