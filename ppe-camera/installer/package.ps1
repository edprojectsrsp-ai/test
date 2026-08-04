<#
    Packages build\payload into a distributable ZIP.

        .\build.ps1 -IncludeWeights -IncludeConsole
        .\package.ps1

    Produces dist\PPEAgent-<version>-<cpu|gpu>.zip containing payload\,
    install.ps1, configure.ps1, uninstall.ps1 and a README the operator
    actually sees.

    A ZIP rather than a setup.exe because both Inno Setup and NSIS are now
    distributed only through GitHub releases and SourceForge respectively, and
    both are blocked on many plant and corporate networks. This needs no
    compiler at all, and the operator can read install.ps1 before running
    something that registers a service and opens a firewall port.
#>
[CmdletBinding()]
param(
    [string]$Version = "0.2.1",
    [string]$Flavour = ""
)

$ErrorActionPreference = "Stop"
$Payload = Join-Path $PSScriptRoot "build\payload"
$Dist    = Join-Path $PSScriptRoot "dist"

if (-not (Test-Path (Join-Path $Payload "app\main.py"))) {
    throw "no payload -- run build.ps1 first"
}

# Infer the flavour from what is actually in the venv rather than trusting a
# parameter: a ZIP labelled gpu that carries the CPU wheel is a support call
# nobody can diagnose from the outside.
if (-not $Flavour) {
    $torchLib = Join-Path $Payload "python\Lib\site-packages\torch\lib"
    $Flavour = if (Test-Path $torchLib) {
        if (Get-ChildItem $torchLib -Filter "*cudart*" -ErrorAction SilentlyContinue) { "gpu" } else { "cpu" }
    } else { "cpu" }
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
$stage = Join-Path $Dist "PPEAgent-$Version-$Flavour"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host "-- staging $Flavour distribution" -ForegroundColor Yellow
Copy-Item -Recurse -Force $Payload (Join-Path $stage "payload")
foreach ($f in @("install.ps1", "configure.ps1", "uninstall.ps1", "verify.ps1", "Install.bat")) {
    $src = Join-Path $PSScriptRoot $f
    if (Test-Path $src) { Copy-Item -Force $src $stage }
}
$redist = Join-Path $PSScriptRoot "redist"
if (Test-Path $redist) {
    Copy-Item -Recurse -Force $redist (Join-Path $stage "redist")
}

Set-Content -Path (Join-Path $stage "READ ME FIRST.txt") -Encoding utf8 -Value @"
PPE Detection Agent $Version ($Flavour)
=======================================

EASIEST INSTALL (any Windows 10/11 64-bit PC)

  1. Extract this whole ZIP (right-click -> Extract All). Keep the folder
     together - do not run install from inside the ZIP viewer.
  2. Double-click  Install.bat
  3. Click Yes on the UAC prompt (Administrator required).
  4. Press Enter to accept defaults, or answer the short prompts.

  No internet is required. Python is installed from redist\ if missing.
  Models are bundled - detection works immediately after install.

ALTERNATE (elevated PowerShell)

  cd "<extracted folder>"
  .\install.ps1

  Unattended:
  .\install.ps1 -Unattended -LanAccess

WHAT IT INSTALLS

  - PPEAgent    Windows service. Cameras, detection, recording. Auto-starts.
  - PPEConsole  Windows service. Web console for wall TVs / phones (if allowed).
  - Trained models (active + zoo) - nothing downloaded on first run.
  - CPython redist so the target PC needs no pre-installed Python.

AFTER INSTALLING

  Agent      http://127.0.0.1:8004/docs
  Console    http://<this-pc>:3000/ppe/     (if wall/phone access was allowed)
  Verify     .\verify.ps1
  Logs       <install folder>\data\
  Config     <install folder>\.env

  Get-Service PPEAgent, PPEConsole
  Restart-Service PPEAgent

TO UNINSTALL

  Programs & Features -> PPE Detection Agent
  or:  .\uninstall.ps1
  (data\ is KEPT by default. Use -RemoveData only to wipe evidence.)

$(if ($Flavour -eq 'cpu') {
"NOTE: this is the CPU build. It runs on any PC but inference is slower.
Use the GPU build on machines with an NVIDIA card for more cameras."
} else {
"NOTE: this is the GPU build (CUDA 12.1). Needs an NVIDIA card + recent driver.
Falls back to CPU if no GPU is found."
})

REQUIREMENTS

  - Windows 10 or 11, 64-bit
  - Administrator rights (for services + optional firewall rules)
  - ~3 GB free disk after extract
  - No internet required for install or first detection
"@

$zip = Join-Path $Dist "PPEAgent-$Version-$Flavour.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Write-Host "-- compressing (this takes a while)" -ForegroundColor Yellow
# Fastest: payload is mostly already-compressed weights/binaries; Optimal
# spends minutes for almost no size win.
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Fastest

$mb = (Get-Item $zip).Length / 1MB
Write-Host ""
Write-Host ("== {0}  ({1:N0} MB) ==" -f $zip, $mb) -ForegroundColor Green

# A checksum the operator can verify, since this arrives as a plain ZIP rather
# than a signed installer.
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
Set-Content -Path "$zip.sha256" -Value "$hash  $(Split-Path $zip -Leaf)" -Encoding ascii
Write-Host "   SHA256 $hash"
