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
    # Setup.exe stages the CPython redist into its own {tmp}, not next to this
    # script, so it has to be able to say where it put it. Defaults to the
    # layout the ZIP has.
    [string]$RedistDir   = "",
    [switch]$LanAccess,
    [switch]$AutoSync,
    [switch]$Unattended,
    [switch]$NoLaunch,
    [switch]$SkipCopy,
    # Setup.exe registers its own Add/Remove Programs entry and calls
    # uninstall.ps1 from it. Without this we add a second entry for the same
    # product, and whichever one the customer picks orphans the other -- the
    # survivor then points at a folder that no longer exists.
    [switch]$NoUninstallEntry,
    # Same story for shortcuts: Setup.exe makes its own, pointing at the local
    # console launcher. Letting both run produced two desktop icons for the same
    # thing and two Start Menu folders for one product.
    [switch]$NoShortcuts
)

$ErrorActionPreference = "Stop"
$Src = $PSScriptRoot
$ManagedCloudUrl = "https://project-brain-ppe-lite.onrender.com"
$ManagedControlRoom = "https://projectbrain-git-main-hitman007.vercel.app/ppe/"

if (-not $CloudUrl) { $CloudUrl = $ManagedCloudUrl }
if (-not $ControlRoom) { $ControlRoom = $ManagedControlRoom }
if (-not $AgentName) { $AgentName = $env:COMPUTERNAME }

# A customer install registers later, from the console's own banner, so no join
# code is asked for here. The cloud URL is still written to .env: it is not a
# secret, it is where this product's cloud lives, and blanking it meant the
# operator had to know and type our hostname before Register could work.
# Registration remains gated on the code, which is the part that is actually
# a credential.

function Say($m)  { Write-Host "[ppe] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[ppe] $m" -ForegroundColor Yellow }

function Copy-TreeRobust([string]$SourcePath, [string]$DestinationPath) {
    $null = New-Item -ItemType Directory -Force -Path $DestinationPath
    $args = @(
        $SourcePath,
        $DestinationPath,
        "/E",
        "/R:2",
        "/W:2",
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/NP"
    )
    & robocopy @args | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "robocopy failed for $SourcePath -> $DestinationPath (exit $LASTEXITCODE)"
    }
}

# ------------------------------------------------------------------ checks
$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    throw "Run this in an elevated PowerShell (right-click Start -> Terminal (Admin))."
}
if ([Environment]::Is64BitOperatingSystem -eq $false) {
    throw "64-bit Windows is required (torch ships no 32-bit build)."
}

$PayloadRoot = ""
if (Test-Path (Join-Path $Src "payload\app\main.py")) {
    $PayloadRoot = Join-Path $Src "payload"
} elseif (Test-Path (Join-Path $Src "app\main.py")) {
    # Setup.exe already stages the application directly into {app}, so there is
    # no payload\ wrapper at runtime.
    $PayloadRoot = $Src
    $SkipCopy = $true
} else {
    throw "payload\ not found next to this script. Extract the whole ZIP and run it from there."
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
    Write-Host "  Managed cloud connection" -ForegroundColor White
    Write-Host "  Cloud URL is pre-configured for this installer." -ForegroundColor DarkGray
    Write-Host "  Cloud URL: $CloudUrl" -ForegroundColor DarkGray
    if ($CloudUrl -and -not $JoinCode) {
        $JoinCode = Read-Host "  Join code"
    }
    if ($CloudUrl -and -not $AgentName) {
        $AgentName = Read-Host "  Name for this PC [$env:COMPUTERNAME]"
        if (-not $AgentName) { $AgentName = $env:COMPUTERNAME }
    }
    Write-Host "  Control room URL: $ControlRoom" -ForegroundColor DarkGray

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

# A code with nowhere to send it is the broken combination. The reverse is the
# normal customer state: the PC knows where the cloud is and has simply not been
# registered yet, which the console's banner then prompts for.
if ($JoinCode -and -not $CloudUrl) {
    throw "A join code was given with no cloud URL to redeem it against."
}

if ($Unattended) {
    Say "running in customer install mode"
    Say "cloud dashboard is pre-configured; this PC can be linked later from the PPE UI"
    Write-Host ""
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

if (-not $SkipCopy) {
    Say "copying files (this takes a minute)"
    foreach ($item in Get-ChildItem $PayloadRoot) {
        # Never clobber plant data on upgrade/reinstall: violations DB, evidence,
        # recordings and fine-tuned weights live under data\.
        if ($item.Name -eq "data" -and (Test-Path (Join-Path $InstallDir "data"))) {
            Say "keeping existing data\ (violations, evidence, weights)"
            continue
        }
        $dst = Join-Path $InstallDir $item.Name
        if ($item.PSIsContainer) {
            Copy-TreeRobust $item.FullName $dst
        } else {
            Copy-Item -Force $item.FullName $dst
        }
    }
    foreach ($f in @("configure.ps1", "uninstall.ps1", "verify.ps1", "Install.bat")) {
        $p = Join-Path $Src $f
        if (Test-Path $p) { Copy-Item -Force $p $InstallDir }
    }
} else {
    Say "files already staged by Setup.exe"
}

# ------------------------------------------------------------------ configure
if (-not $RedistDir) { $RedistDir = Join-Path $Src "redist" }
if (-not (Test-Path $RedistDir)) {
    # Not fatal: a PC that already has the right CPython never needs this. But
    # it is the difference between "installs offline" and "fails on a plant PC
    # with no internet", so it should be visible now rather than at that point.
    Warn "no CPython redist at $RedistDir -- Python $((Get-Content (Join-Path $PayloadRoot 'PYTHON_VERSION') -EA SilentlyContinue)) must already be installed on this PC"
}

$cfgArgs = @{
    InstallDir  = $InstallDir
    RedistDir   = $RedistDir
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
if (-not $NoShortcuts) {
try {
    $sh = New-Object -ComObject WScript.Shell
    $desktop   = [Environment]::GetFolderPath("CommonDesktopDirectory")
    $startMenu = Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "PPE Agent"
    New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

    $launcher = Join-Path $InstallDir "PpeConsole.exe"
    $icon     = Join-Path $InstallDir "ppe.ico"

    if (Test-Path $launcher) {
        # Point at the console THIS PC serves, not the hosted dashboard. The
        # old shortcut opened a browser tab against the cloud URL, so the
        # product needed internet to show its own machine's cameras.
        foreach ($dir in @($desktop, $startMenu)) {
            $l = $sh.CreateShortcut((Join-Path $dir "PPE Control Room.lnk"))
            $l.TargetPath       = $launcher
            $l.Arguments        = "$ConsolePort /ppe/"
            $l.WorkingDirectory = $InstallDir
            $l.Description      = "Open the PPE control room running on this PC"
            if (Test-Path $icon) { $l.IconLocation = $icon }
            $l.Save()
        }
        # A .url from an earlier version, pointing at the cloud.
        Remove-Item (Join-Path $desktop "PPE Control Room.url") -Force -ErrorAction SilentlyContinue
    } else {
        Warn "PpeConsole.exe not in the payload -- falling back to a browser shortcut"
        $l = $sh.CreateShortcut((Join-Path $desktop "PPE Control Room.url"))
        $l.TargetPath = "http://127.0.0.1:$ConsolePort/ppe/"
        $l.Save()
    }

    foreach ($s in @(
        @{ n = "Agent API";          t = "http://127.0.0.1:$Port/docs" },
        @{ n = "PPE Cloud Dashboard"; t = $ControlRoom }
    )) {
        if (-not $s.t) { continue }
        $l = $sh.CreateShortcut((Join-Path $startMenu "$($s.n).url"))
        $l.TargetPath = $s.t
        $l.Save()
    }
    Say "shortcuts created"
} catch {
    Warn "could not create shortcuts: $_"
}
}

# Register in Programs & Features so it uninstalls the way anything else does.
# Skipped under Setup.exe, which has already made an entry of its own.
if (-not $NoUninstallEntry) {
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
if (-not $NoLaunch) {
    try {
        Say "opening the PPE dashboard"
        Start-Process $ControlRoom | Out-Null
    } catch {
        Warn "could not open the PPE dashboard automatically: $_"
    }
}
if (-not $healthy) { exit 2 }
