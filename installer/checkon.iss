; Inno Setup script for 체크온 (CheckOn) — subject-teacher desktop app.
;
; Build (requires Inno Setup 6):
;   ISCC.exe installer\checkon.iss
; Optional overrides:
;   ISCC.exe /DAppVersion=1.0.1 /DSourceExe=..\dist\checkon_build\NEIS_Subject_Teacher.exe installer\checkon.iss
;
; Produces: dist\installer\CheckOn-Setup-<version>.exe
; Installs per-user (no admin prompt) so it works on locked-down school PCs.

#define AppName "체크온"
#define AppNameEn "CheckOn"
#ifndef AppVersion
  #define AppVersion "1.0.10"
#endif
#define AppPublisher "체크온"
#define AppExeName "NEIS_Subject_Teacher.exe"

#ifndef SourceExe
  #define SourceExe "..\dist\checkon_build\NEIS_Subject_Teacher.exe"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist\installer"
#endif

[Setup]
AppId={{8F2A5C7E-3D14-4B96-A0E8-1C9F7B24D6A3}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppNameEn}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
OutputDir={#OutputDir}
OutputBaseFilename=CheckOn-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Per-user install: no administrator rights required.
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; NEIS 인증서 비밀번호는 언인스톨 시 함께 파기 (개인정보처리방침의 파기 조항과 일치).
; sync_key.bin(E2E 열쇠)·토큰·설정은 재설치 시 복구에 필요할 수 있어 삭제하지 않는다.
Type: files; Name: "{localappdata}\NeisSubject\password.bin"

[Code]
// Warn (do not block) when the Evergreen WebView2 Runtime is missing — the UI needs it.
function WebView2Installed(): Boolean;
var
  pv: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv) or
    RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not WebView2Installed() then
    MsgBox('이 프로그램의 화면 표시에는 Microsoft Edge WebView2 런타임이 필요합니다.' + #13#10 +
           '대부분의 Windows에는 이미 설치되어 있습니다. 설치 후 프로그램이 열리지 않으면' + #13#10 +
           '아래에서 "Evergreen 부트스트래퍼"를 내려받아 설치하세요:' + #13#10 +
           'https://developer.microsoft.com/microsoft-edge/webview2/',
           mbInformation, MB_OK);
end;
