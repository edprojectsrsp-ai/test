<#
    Removes the Windows service. Invoked by the uninstaller.

    Deliberately leaves data\ in place: it holds the violation database,
    evidence images, recordings and any fine-tuned weights. That is the plant's
    safety record and the system of record for anything the cloud shows --
    an uninstall (or an upgrade, which uninstalls first) must not destroy it.
    Deleting it is a separate, explicit act.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$InstallDir)

$VenvPy = Join-Path $InstallDir "python\Scripts\python.exe"
$Services = @(
    @{ Name = "PPEAgent";   Cmd = "remove-agent" },
    @{ Name = "PPEConsole"; Cmd = "remove-console" }
)

function Write-Step($m) { Write-Host "[ppe-agent] $m" }

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
        # The interpreter may already be gone (partial install); sc.exe still
        # knows how to delete the registration.
        if (Get-Service -Name $svc.Name -ErrorAction SilentlyContinue) {
            & sc.exe delete $svc.Name | Out-Null
        }
    } catch {
        Write-Warning "could not fully remove $($svc.Name): $_"
        Write-Warning "remove it manually with: sc.exe delete $($svc.Name)"
    }
}

# Firewall rules were added only for LAN access; leaving them behind would
# keep holes open for a service that no longer exists.
foreach ($p in @(8004, 3000)) {
    try { Remove-NetFirewallRule -DisplayName "PPE Agent $p" -ErrorAction SilentlyContinue } catch {}
}

Write-Step "data\ left in place (violations, evidence, recordings, weights)"
