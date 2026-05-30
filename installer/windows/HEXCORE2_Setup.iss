#define AppVersion "2.0.25"
#define SourceRoot "..\.."

[Setup]
AppId={{9B94251F-0F44-4E2E-9F58-4D5C4C4F5245}
AppName=HEXCORE 2.0
AppVersion={#AppVersion}
AppPublisher=HEXCORE
DefaultDirName={localappdata}\HEXCORE2
DefaultGroupName=HEXCORE 2.0
OutputDir=..\..\output
OutputBaseFilename=HEXCORE2_Setup_v{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\scripts\windows\Open-HEXCORE2.cmd

[Languages]
Name: "default"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceRoot}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\CHANGELOG.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\Dockerfile"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\docker-compose.yml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\.dockerignore"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\.env.example"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\.env.docker.example"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\apps\*"; DestDir: "{app}\apps"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\packages\*"; DestDir: "{app}\packages"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "__pycache__\*"
Source: "{#SourceRoot}\docs\multiplayer\*"; DestDir: "{app}\docs\multiplayer"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\docs\user-guides\Win11_Docker_PostgreSQL_安装说明.md"; DestDir: "{app}\docs\user-guides"; Flags: ignoreversion
Source: "{#SourceRoot}\deploy\*"; DestDir: "{app}\deploy"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\启动 HEXCORE2"; Filename: "{app}\scripts\windows\Start-HEXCORE2.cmd"; WorkingDir: "{app}"
Name: "{group}\停止 HEXCORE2"; Filename: "{app}\scripts\windows\Stop-HEXCORE2.cmd"; WorkingDir: "{app}"
Name: "{group}\打开裁判页面"; Filename: "{app}\scripts\windows\Open-HEXCORE2.cmd"; WorkingDir: "{app}"
Name: "{group}\查看服务日志"; Filename: "{app}\scripts\windows\Show-HEXCORE2-Logs.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\HEXCORE2"; Filename: "{app}\scripts\windows\Start-HEXCORE2.cmd"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面启动快捷方式"; GroupDescription: "快捷方式："; Flags: checkedonce

[Run]
Filename: "{app}\scripts\windows\Start-HEXCORE2.cmd"; Description: "启动 HEXCORE2 Docker PostgreSQL 版本"; Flags: postinstall skipifsilent nowait unchecked

[Code]
function InitializeSetup(): Boolean;
begin
  MsgBox('HEXCORE2 安装包不内置 Docker Desktop。首次启动时会检测 docker 命令；如未安装，请按脚本提示安装并启动 Docker Desktop。', mbInformation, MB_OK);
  Result := True;
end;
