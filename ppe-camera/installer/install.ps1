<#
    PPE Agent installer.

    Run this from the extracted distribution folder, in an elevated PowerShell:

        Right-click Start -> Terminal (Admin)
        cd <extracted folder>
        .\install.ps1

    It will ask for the few things it needs. Everything can also be passed as a
    parameter for an unattended rollout:

        .\install.ps1 -CloudUrl https://ppe.example.com -JoinCode ABC123 `
                      -LanAccess -Unattended

    Why a script rather than a setup.exe: both Inno Setup and NSIS are now
    distributed only through hosts (GitHub releases, SourceForge) that are
    blocked on many plant and corporate networks, including the one this was
    built on. A PowerShell script needs no compiler, is readable before you run
    it -- which matters for something that installs a service and opens a
    firewall port -- and does the same work.

    Idempotent: safe to re-run over an existing install. Your .env, your
    violation database and your trained weights are preserved.
#>
[CmdletBinding()]
param(
    [string]$InstallDir  = "$env:ProgramFiles\PPEAgent",
    [string]$CloudUrl    = "",
    [string]$JoinCode    = "",
    [string]$AgentName   = "",
    [string]$ControlRoom = "",
    [string]$Port        = "8004",
    [string]$ConsolePort = "3000",
    [switch]$LanAccess,
    [switch]$AutoSync,
    [switch]$Unattended
)

$ErrorActionPreference = "Stop"
$Src = $PSScriptRoot

function Say($m)  { Write-Host "[ppe] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[ppe] $m" -ForegroundColor Yellow }

# ------------------------------------------------------------------ checks
$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    throw "Run this in an elevated PowerShell (right-click Start -> Terminal (Admin))."
}
if (-not (Test-Path (Join-Path $Src "payload\app\main.py"))) {
    throw "payload\ not found next to this script. Extract the whole ZIP and run it from there."
}
if ([Environment]::Is64BitOperatingSystem -eq $false) {
    throw "64-bit Windows is required (torch ships no 32-bit build)."
}

Write-Host ""
Write-Host "  PPE Detection Agent" -ForegroundColor White
Write-Host "  Installs cameras, inference and recording on THIS machine." -ForegroundColor DarkGray
Write-Host ""

# ------------------------------------------------------------------ prompts
if (-not $Unattended) {
    Say "Press Enter to accept the default shown in brackets."
    Write-Host ""

    $r = Read-Host "Install location [$InstallDir]"
    if ($r) { $InstallDir = $r }

    Write-Host ""
    Write-Host "  Cloud dashboard (optional)" -ForegroundColor White
    Write-Host "  Leave blank to run fully offline; you can join later." -ForegroundColor DarkGray
    if (-not $CloudUrl)  { $CloudUrl  = Read-Host "  Cloud URL" }
    if ($CloudUrl -and -not $JoinCode) {
        $JoinCode = Read-Host "  Join code"
    }
    if ($CloudUrl -and -not $AgentName) {
        $AgentName = Read-Host "  Name for this PC [$env:COMPUTERNAME]"
        if (-not $AgentName) { $AgentName = $env:COMPUTERNAME }
    }
    if (-not $ControlRoom) {
        $ControlRoom = Read-Host "  Control room (web dashboard) URL, optional"
    }

    Write-Host ""
    Write-Host "  Wall displays and phones" -ForegroundColor White
    Write-Host "  Allowing this lets any browser on the plant network open the" -ForegroundColor DarkGray
    Write-Host "  console at http://$env:COMPUTERNAME`:$ConsolePort - wall TVs and" -ForegroundColor DarkGray
    Write-Host "  phones included, nothing to install on them. Live camera feeds" -ForegroundColor DarkGray
    Write-Host "  are protected by a generated key." -ForegroundColor DarkGray
    if (-not $LanAccess) {
        $r = Read-Host "  Allow wall TVs / phones on the plant network? (y/N)"
        if ($r -match '^(y|yes)$') { $LanAccess = $true }
    }

    if ($CloudUrl -and -not $AutoSync) {
        Write-Host ""
        $r = Read-Host "  Also push violations automatically every 4 hours? (y/N)"
        if ($r -match '^(y|yes)$') { $AutoSync = $true }
    }
    Write-Host ""
}

# Both or neither: a half-configured agent looks joined in the UI and fails on
# the first push, long after anyone is watching the installer.
if (($CloudUrl -and -not $JoinCode) -or ($JoinCode -and -not $CloudUrl)) {
    throw "Cloud URL and join code must be given together, or both left blank."
}

# ------------------------------------------------------------------ copy
Say "installing to $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Stop services first: files under an running service cannot be replaced, and
# a half-copied python\ is far worse than a refused upgrade.
foreach ($svc in @("PPEAgent", "PPEConsole")) {
    if (Get-Service -Name $svc -ErrorAction SilentlyContinue) {
        Say "stopping $svc"
        Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

Say "copying files (this takes a minute)"
foreach ($item in Get-ChildItem (Join-Path $Src "payload")) {
    # Never clobber plant data on upgrade/reinstall: violations DB, evidence,
    # recordings and fine-tuned weights live under data\.
    if ($item.Name -eq "data" -and (Test-Path (Join-Path $InstallDir "data"))) {
        Say "keeping existing data\ (violations, evidence, weights)"
        continue
    }
    Copy-Item -Recurse -Force $item.FullName $InstallDir
}
foreach ($f in @("configure.ps1", "uninstall.ps1", "verify.ps1", "Install.bat")) {
    $p = Join-Path $Src $f
    if (Test-Path $p) { Copy-Item -Force $p $InstallDir }
}

# ------------------------------------------------------------------ configure
$cfgArgs = @{
    InstallDir  = $InstallDir
    RedistDir   = (Join-Path $Src "redist")
    Port        = $Port
    ConsolePort = $ConsolePort
    JoinCode    = $JoinCode
    AgentName   = $AgentName
    SyncUrl     = $CloudUrl
    CorsOrigins = $(
        $base = "http://localhost:$ConsolePort,http://127.0.0.1:$ConsolePort"
        if ($ControlRoom) {
            # An Origin header carries scheme://host[:port] and never a path.
            try {
                $u = [Uri]$ControlRoom
                "$base,$($u.Scheme)://$($u.Authority)"
            } catch { $base }
        } else { $base }
    )
}
if ($LanAccess) { $cfgArgs["LanAccess"] = $true }
if ($AutoSync)  { $cfgArgs["AutoSync"]  = $true }

Say "configuring"
& (Join-Path $InstallDir "configure.ps1") @cfgArgs

# ------------------------------------------------------------------ shortcuts
try {
    $room = if ($ControlRoom) { $ControlRoom } else { "http://127.0.0.1:$Port/docs" }
    $sh = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
    $lnk = $sh.CreateShortcut((Join-Path $desktop "PPE Control Room.url"))
    $lnk.TargetPath = $room
    $lnk.Save()

    $startMenu = Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "PPE Agent"
    New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
    foreach ($s in @(
        @{ n = "PPE Control Room"; t = $room },
        @{ n = "Agent API";        t = "http://127.0.0.1:$Port/docs" }
    )) {
        $l = $sh.CreateShortcut((Join-Path $startMenu "$($s.n).url"))
        $l.TargetPath = $s.t
        $l.Save()
    }
    Say "shortcuts created"
} catch {
    Warn "could not create shortcuts: $_"
}

# Register in Programs & Features so it uninstalls the way anything else does.
try {
    $key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PPEAgent"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name DisplayName -Value "PPE Detection Agent"
    Set-ItemProperty -Path $key -Name DisplayVersion -Value "0.2.1"
    Set-ItemProperty -Path $key -Name Publisher -Value "Project Brain"
    Set-ItemProperty -Path $key -Name InstallLocation -Value $InstallDir
    Set-ItemProperty -Path $key -Name UninstallString -Value (
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`" -InstallDir `"$InstallDir`"")
    Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
    Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord
} catch {
    Warn "could not register in Programs & Features: $_"
}

# ------------------------------------------------------------------ health
Say "waiting for agent health (first model load can take up to 90s)..."
$healthy = $false
$healthInfo = $null
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    try {
        $healthInfo = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
        if ($healthInfo.status -eq "ok") { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
if ($healthy) {
    Say "health OK  model=$($healthInfo.active_model) v$($healthInfo.active_version)"
} else {
    Warn "agent did not answer /health yet. Check: Get-Service PPEAgent; Get-Content `"$InstallDir\data\agent.err.log`" -Tail 40"
    Warn "You can re-check later with: .\verify.ps1 -InstallDir `"$InstallDir`" -Port $Port"
}

# ------------------------------------------------------------------ summary
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
       Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
       Select-Object -First 1).IPAddress

Write-Host ""
if ($healthy) {
    Write-Host "  Done. Install verified." -ForegroundColor Green
} else {
    Write-Host "  Install finished, but health check is still pending." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Agent      http://127.0.0.1:$Port/docs"
if ($LanAccess) {
    Write-Host "  Console    http://${ip}:$ConsolePort/ppe/          <- open this on a wall TV"
    Write-Host "  Phones     same address, or the APK's first-run screen"
    $envFile = Join-Path $InstallDir ".env"
    if (Test-Path $envFile) {
        $m = Select-String -Path $envFile -Pattern '^PPE_LAN_TOKEN=(.+)$' -ErrorAction SilentlyContinue
        if ($m) { Write-Host "  LAN key    $($m.Matches.Groups[1].Value)" }
    }
} else {
    Write-Host "  Console    this PC only (re-run with -LanAccess to allow wall TVs)"
}
Write-Host ""
Write-Host "  Logs       $InstallDir\data\"
Write-Host "  Config     $InstallDir\.env   (restart PPEAgent after editing)"
Write-Host "  Verify     $InstallDir\verify.ps1"
Write-Host ""
Write-Host "  Get-Service PPEAgent, PPEConsole" -ForegroundColor DarkGray
Write-Host ""
if (-not $healthy) { exit 2 }
