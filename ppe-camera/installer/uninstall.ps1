<#
    Removes the Windows service. Invoked by the uninstaller.

    Deliberately leaves data\ in place: it holds the violation database,
    evidence images, recordings and any fine-tuned weights. That is the plant's
    safety record and the system of record for anything the cloud shows —
    an uninstall (or an upgrade, which uninstalls first) must not destroy it.
    Deleting it is a separate, explicit act.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$InstallDir)

$ServiceName = "PPEAgent"
$Nssm = Join-Path $InstallDir "nssm.exe"

function Write-Step($m) { Write-Host "[ppe-agent] $m" }

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Step "service not installed, nothing to remove"
    exit 0
}

try {
    if (Test-Path $Nssm) {
        Write-Step "stopping $ServiceName"
        & $Nssm stop $ServiceName confirm | Out-Null
        Start-Sleep -Seconds 3
        Write-Step "removing $ServiceName"
        & $Nssm remove $ServiceName confirm | Out-Null
    } else {
        # nssm is gone (partial install, manual deletion). sc.exe still works.
        Write-Step "nssm.exe missing -- falling back to sc.exe"
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        & sc.exe delete $ServiceName | Out-Null
    }
    Write-Step "service removed"
} catch {
    Write-Warning "could not fully remove the service: $_"
    Write-Warning "remove it manually with: sc.exe delete $ServiceName"
}

Write-Step "data\ left in place (violations, evidence, recordings, weights)"
