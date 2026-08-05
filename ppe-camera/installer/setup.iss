; PPE Detection Agent -- customer-facing GUI installer (Inno Setup 6)
;
; Build the payload first:
;   .\build.ps1 -IncludeWeights -IncludeConsole
;
; Then compile:
;   iscc setup.iss
;
; Compile from a SHORT path. torch ships license files nested ~193 characters
; deep (torch-*.dist-info\licenses\third_party\kineto\...\duktape-*\LICENSE.txt),
; so from a normal checkout the absolute path crosses MAX_PATH and ISCC aborts
; with only "The system cannot find the path specified" and no line number.
; A junction is enough and costs nothing:
;
;   New-Item -ItemType Junction -Path C:\Users\<you>\pb -Target <this folder>
;   cd C:\Users\<you>\pb ; iscc setup.iss
;
; Product flow:
;   - install silently with hosted URLs baked in
;   - do NOT ask for join code during setup
;   - open the PPE dashboard after install
;   - let the operator link this PC from the dashboard UI

#define AppName                 "PPE Detection Agent"
#define AppVersion              "0.2.1"
#define AppPublisher            "Project Brain"
#define DefaultPort             "8004"
#define DefaultConsolePort      "3000"
#define DefaultControlRoomUrl   "https://projectbrain-git-main-hitman007.vercel.app/ppe/"

[Setup]
AppId={{8F3C1A24-6B7E-4D19-9E2A-1C5B7A9D4E30}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#DefaultControlRoomUrl}
AppSupportURL={#DefaultControlRoomUrl}
AppUpdatesURL={#DefaultControlRoomUrl}
DefaultDirName={autopf}\PPEAgent
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename=PPEAgent-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
UsePreviousAppDir=yes
DisableWelcomePage=no
DisableDirPage=no
UninstallDisplayIcon={app}\python\Scripts\python.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; data\ is deliberately excluded. It is the operator's: the violations
; database, captured evidence, recordings and any locally fine-tuned weights.
; Shipping it would push the build machine's own ppe.db onto every customer,
; and "ignoreversion" would then overwrite theirs on the next upgrade.
; configure.ps1 creates data\ and seeds it from {app}\weights only where a
; file is not already there.
Source: "build\payload\*"; DestDir: "{app}"; Excludes: "data,data\*"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "redist\python-*-amd64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist
Source: "install.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "configure.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "verify.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "Install.bat"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\PPE Dashboard"; Filename: "{#DefaultControlRoomUrl}"
Name: "{group}\Agent API (local)"; Filename: "http://127.0.0.1:{#DefaultPort}/docs"
Name: "{group}\Agent Logs"; Filename: "{app}\data"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\PPE Dashboard"; Filename: "{#DefaultControlRoomUrl}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to the PPE dashboard"; GroupDescription: "Shortcuts:"
; unchecked deliberately. An Inno task with no flags is ticked by default, and
; this one opens the firewall and puts live camera feeds on the plant network.
; Clicking straight through the wizard must not widen the trust boundary from
; "this PC" to "anyone on the network" -- install.ps1's own prompt defaults to
; No for the same reason, and a silent/unattended install inherits this default.
Name: "lanaccess"; Description: "Allow wall TVs and phones on the plant network"; GroupDescription: "Network access:"; Flags: unchecked
Name: "launchdashboard"; Description: "Open the PPE dashboard after setup"; GroupDescription: "After setup:"; Flags: checkedonce

[Run]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install.ps1"" -InstallDir ""{app}"" -Port ""{#DefaultPort}"" -ConsolePort ""{#DefaultConsolePort}"" -RedistDir ""{tmp}"" -CloudUrl """" -JoinCode """" -ControlRoom ""{#DefaultControlRoomUrl}"" -AgentName """" -Unattended -NoLaunch -SkipCopy -NoUninstallEntry {code:GetLanFlag}"; \
  StatusMsg: "Installing services and local runtime..."; \
  Flags: runhidden waituntilterminated
Filename: "{#DefaultControlRoomUrl}"; \
  Description: "Open the PPE dashboard"; \
  Flags: postinstall shellexec skipifsilent; \
  Tasks: launchdashboard

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "RemovePPEService"

[Code]
function GetLanFlag(Param: String): String;
begin
  if WizardIsTaskSelected('lanaccess') then
    Result := '-LanAccess'
  else
    Result := '';
end;

function GetCorsOrigins(Param: String): String;
begin
  Result := 'http://localhost:3000,http://127.0.0.1:3000,https://projectbrain-git-main-hitman007.vercel.app';
end;
