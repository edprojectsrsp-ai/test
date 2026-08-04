<#
    Removes PPE Agent Windows services and optional install files.

    Invoked from Programs & Features, or manually (elevated):

        .\uninstall.ps1
        .\uninstall.ps1 -InstallDir "C:\Program Files\PPEAgent" -RemoveFiles

    Deliberately leaves data\ by default: violations, evidence, recordings and
    fine-tuned weights are the plant's safety record. Pass -RemoveData only
    when you intend to wipe that permanently.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:ProgramFiles\PPEAgent",
    [switch]$RemoveFiles,
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"

$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    throw "Run uninstall in an elevated PowerShell (Terminal Admin)."
}

function Write-Step($m) { Write-Host "[ppe-agent] $m" }

$VenvPy = Join-Path $InstallDir "python\Scripts\python.exe"
$Services = @(
    @{ Name = "PPEAgent";   Cmd = "remove-agent" },
    @{ Name = "PPEConsole"; Cmd = "remove-console" }
)

# Ports for firewall cleanup: prefer values from .env
$ports = @("8004", "3000")
$envFile = Join-Path $InstallDir ".env"
if (Test-Path $envFile) {
    $pm = Select-String -Path $envFile -Pattern '^PPE_PORT=(.+)$' -ErrorAction SilentlyContinue
    if ($pm) { $ports[0] = $pm.Matches.Groups[1].Value.Trim() }
}

foreach ($svc in $Services) {
    $existing = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
    if (-not $existing) { continue }
    try {
        Write-Step "stopping $($svc.Name)"
        Stop-Service -Name $svc.Name -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        if (Test-Path $VenvPy) {
            Push-Location $InstallDir
            try { & $VenvPy -m app.service_win $svc.Cmd 2>&1 | Out-Null } finally { Pop-Location }
        }
        if (Get-Service -Name $svc.Name -ErrorAction SilentlyContinue) {
            & sc.exe delete $svc.Name | Out-Null
        }
        Write-Step "removed $($svc.Name)"
    } catch {
        Write-Warning "could not fully remove $($svc.Name): $_"
        Write-Warning "remove it manually with: sc.exe delete $($svc.Name)"
    }
}

foreach ($p in $ports) {
    try { Remove-NetFirewallRule -DisplayName "PPE Agent $p" -ErrorAction SilentlyContinue } catch {}
}

# Shortcuts
try {
    $desktop = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "PPE Control Room.url"
    if (Test-Path $desktop) { Remove-Item -Force $desktop }
    $startMenu = Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "PPE Agent"
    if (Test-Path $startMenu) { Remove-Item -Recurse -Force $startMenu }
} catch {}

# Programs & Features entry
try {
    $key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PPEAgent"
    if (Test-Path $key) { Remove-Item -Path $key -Recurse -Force }
} catch {}

if ($RemoveFiles -and (Test-Path $InstallDir)) {
    if ($RemoveData) {
        Write-Step "removing entire install tree including data\"
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    } else {
        Write-Step "removing program files, keeping data\"
        Get-ChildItem $InstallDir -Force | Where-Object { $_.Name -ne "data" } | ForEach-Object {
            Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
        }
        Write-Step "data\ left at $(Join-Path $InstallDir 'data')"
    }
} else {
    Write-Step "data\ left in place (violations, evidence, recordings, weights)"
    Write-Step "to remove files later: uninstall.ps1 -RemoveFiles   (add -RemoveData to wipe evidence)"
}

Write-Step "uninstall complete"
