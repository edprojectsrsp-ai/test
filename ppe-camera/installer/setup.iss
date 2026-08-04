; PPE Detection Agent -- Windows installer (Inno Setup 6)
;
; Build the payload first:   .\build.ps1 -Gpu -IncludeWeights
; Then compile this script:  iscc setup.iss
;
; What gets installed:
;   - a bundled venv with torch/ultralytics/opencv  (python\)
;   - the FastAPI application                       (app\)
;   - CPython, if the required version is absent    (redist\)
;   - a Windows service, auto-start, restart-on-crash
;
; The agent binds to 127.0.0.1 only. The cloud dashboard never connects inward;
; the agent pushes violations out over HTTPS when an operator asks it to.

#define AppName        "PPE Detection Agent"
#define AppVersion     "0.2.0"
#define AppPublisher   "Project Brain"
#define ServiceName    "PPEAgent"
#define DefaultPort    "8004"
#define DefaultConsolePort "3000"

[Setup]
AppId={{8F3C1A24-6B7E-4D19-9E2A-1C5B7A9D4E30}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\PPEAgent
DefaultGroupName={#AppName}
OutputBaseFilename=PPEAgent-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
; torch and the CUDA runtime are 64-bit only.
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
; Registering a service and writing under Program Files both need elevation.
PrivilegesRequired=admin
DisableDirPage=no
WizardStyle=modern
UninstallDisplayIcon={app}\python\Scripts\python.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "build\payload\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; Optional: drop python-3.12.x-amd64.exe here so the target needs no internet.
; configure.ps1 runs it only if no suitable CPython is already present.
Source: "redist\python-*-amd64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist
Source: "configure.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\PPE Control Room"; Filename: "{code:GetControlRoomUrl}"
Name: "{group}\Agent API (local)"; Filename: "http://127.0.0.1:{code:GetPort}/docs"
Name: "{group}\Agent logs"; Filename: "{app}\data"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\PPE Control Room"; Filename: "{code:GetControlRoomUrl}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to the control room"; GroupDescription: "Shortcuts:"

[Run]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\configure.ps1"" -InstallDir ""{app}"" -RedistDir ""{tmp}"" -Port ""{code:GetPort}"" -ConsolePort ""{code:GetConsolePort}"" -AgentId ""{code:GetAgentId}"" -AgentToken ""{code:GetAgentToken}"" -SyncUrl ""{code:GetSyncUrl}"" -CorsOrigins ""{code:GetCorsOrigins}"" {code:GetAutoSyncFlag} {code:GetLanFlag}"; \
  StatusMsg: "Configuring the agent and registering the service..."; \
  Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "RemovePPEService"

[Code]
var
  SyncPage: TInputQueryWizardPage;
  OptionsPage: TInputOptionWizardPage;
  LanPage: TInputOptionWizardPage;
  LanPortPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  SyncPage := CreateInputQueryPage(wpSelectTasks,
    'Cloud connection',
    'Where should this plant PC send violations?',
    'Leave these blank to run fully offline — the agent works standalone and ' +
    'you can fill them in later by editing .env in the install folder.' + #13#10 +
    'The Agent ID and token must match an entry in the cloud service''s ' +
    'PPE_SYNC_AGENTS setting.');
  SyncPage.Add('Cloud sync URL (e.g. https://your-app.onrender.com):', False);
  SyncPage.Add('Agent ID (e.g. rsp-plant-01):', False);
  SyncPage.Add('Agent token:', True);
  SyncPage.Add('Control room URL (Vercel web dashboard):', False);
  SyncPage.Add('Local port:', False);

  SyncPage.Values[4] := '{#DefaultPort}';

  OptionsPage := CreateInputOptionPage(SyncPage.ID,
    'Sync behaviour',
    'When should violations leave this PC?',
    'By default nothing is sent until someone presses Push in the control ' +
    'room. Automatic sync is a convenience on top of that, not a replacement — ' +
    'you can change it at any time.',
    False, False);
  OptionsPage.Add('Manual only — I press Push when I want to send (recommended)');
  OptionsPage.Add('Also sync automatically every 4 hours');
  OptionsPage.SelectedValueIndex := 0;

  LanPage := CreateInputOptionPage(OptionsPage.ID,
    'Wall displays and phones',
    'Should other devices on the plant network reach this PC?',
    'Off, only this PC can see the cameras and the console.' + #13#10 +
    'On, any browser on the plant network can open the control room at ' +
    'http://<this-pc>:3000 — wall TVs and phones included, with nothing to ' +
    'install on them. A random access key is generated and written to .env; ' +
    'live camera feeds are behind it.',
    False, False);
  LanPage.Add('This PC only (recommended if you have no wall display)');
  LanPage.Add('Allow wall TVs and phones on the plant network');
  LanPage.SelectedValueIndex := 0;

  LanPortPage := CreateInputQueryPage(LanPage.ID,
    'Console port',
    'Which port should the control room be served on?',
    'Only used when wall/phone access is enabled above.');
  LanPortPage.Add('Console port:', False);
  LanPortPage.Values[0] := '{#DefaultConsolePort}';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  { The port only matters if LAN access was chosen. }
  Result := (PageID = LanPortPage.ID) and (LanPage.SelectedValueIndex <> 1);
end;

function GetLanFlag(Param: String): String;
begin
  if LanPage.SelectedValueIndex = 1 then
    Result := '-LanAccess'
  else
    Result := '';
end;

function GetConsolePort(Param: String): String;
begin
  Result := Trim(LanPortPage.Values[0]);
  if Result = '' then
    Result := '{#DefaultConsolePort}';
end;

function GetSyncUrl(Param: String): String;
begin
  Result := Trim(SyncPage.Values[0]);
end;

function GetAgentId(Param: String): String;
begin
  Result := Trim(SyncPage.Values[1]);
end;

function GetAgentToken(Param: String): String;
begin
  Result := Trim(SyncPage.Values[2]);
end;

function GetPort(Param: String): String;
begin
  Result := Trim(SyncPage.Values[4]);
  if Result = '' then
    Result := '{#DefaultPort}';
end;

function GetControlRoomUrl(Param: String): String;
begin
  Result := Trim(SyncPage.Values[3]);
  if Result = '' then
    Result := 'http://127.0.0.1:' + GetPort('') + '/docs';
end;

{ The control-room page is served over HTTPS and calls this agent on
  http://127.0.0.1. That is a cross-origin request, so the agent has to allow
  the dashboard's origin explicitly or every camera call fails as a CORS error. }
function GetCorsOrigins(Param: String): String;
var
  Url: String;
  P: Integer;
begin
  Result := 'http://localhost:3000,http://127.0.0.1:3000';
  Url := Trim(SyncPage.Values[3]);
  if Url = '' then
    Exit;
  { Reduce a full URL to scheme://host — an Origin header never carries a path. }
  P := Pos('://', Url);
  if P > 0 then
  begin
    P := Pos('/', Copy(Url, P + 3, Length(Url)));
    if P > 0 then
      Url := Copy(Url, 1, P + 1);
  end;
  while (Length(Url) > 0) and (Url[Length(Url)] = '/') do
    Url := Copy(Url, 1, Length(Url) - 1);
  Result := Result + ',' + Url;
end;

function GetAutoSyncFlag(Param: String): String;
begin
  if OptionsPage.SelectedValueIndex = 1 then
    Result := '-AutoSync'
  else
    Result := '';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  HasUrl, HasId, HasToken: Boolean;
begin
  Result := True;
  if CurPageID = SyncPage.ID then
  begin
    HasUrl   := GetSyncUrl('') <> '';
    HasId    := GetAgentId('') <> '';
    HasToken := GetAgentToken('') <> '';
    { All three or none. A half-filled form produces an agent that looks
      configured in the UI and fails on the first push. }
    if (HasUrl or HasId or HasToken) and not (HasUrl and HasId and HasToken) then
    begin
      MsgBox('Cloud URL, Agent ID and token must be filled in together, or all ' +
             'left blank to run offline.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
