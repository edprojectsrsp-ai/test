<#
    Builds the PPE Agent installer payload.

    Produces build/payload/ containing a complete, self-contained runtime:

        payload/
          python/      a full venv with torch + ultralytics + opencv
          app/         the FastAPI application
          weights/     model checkpoints (optional, see -IncludeWeights)
          nssm.exe     service wrapper (fetched or supplied)

    Deliberately NOT PyInstaller. Freezing torch and ultralytics means chasing
    hidden imports, CUDA DLL discovery and ultralytics' runtime importlib calls
    for days, and the result is a 3 GB onedir that breaks on the next
    ultralytics release. A pre-built venv is bigger on disk and enormously more
    predictable -- and on a plant PC that is installed once, disk is the cheap
    resource.

    Usage:
        .\build.ps1                      # CPU-only, ~800 MB
        .\build.ps1 -Gpu                 # CUDA 12.1 torch, ~2.5 GB
        .\build.ps1 -Gpu -IncludeWeights # also bundle data/weights/*.pt
#>
[CmdletBinding()]
param(
    [switch]$Gpu,
    [switch]$IncludeWeights,
    [string]$PythonExe = "python"
)

$ErrorActionPreference = "Stop"

$Root      = Split-Path -Parent $PSScriptRoot          # ppe-camera/
$Backend   = Join-Path $Root "backend"
$BuildDir  = Join-Path $PSScriptRoot "build"
$Payload   = Join-Path $BuildDir "payload"
$VenvDir   = Join-Path $Payload "python"

Write-Host "== PPE Agent installer build ==" -ForegroundColor Cyan
Write-Host "   backend : $Backend"
Write-Host "   payload : $Payload"
Write-Host "   gpu     : $Gpu"

if (-not (Test-Path (Join-Path $Backend "app\main.py"))) {
    throw "Cannot find app\main.py under $Backend"
}

if (Test-Path $Payload) {
    Write-Host "-- cleaning previous payload"
    Remove-Item -Recurse -Force $Payload
}
New-Item -ItemType Directory -Force -Path $Payload | Out-Null

# ---------------------------------------------------------------- venv
Write-Host "-- creating venv" -ForegroundColor Yellow
& $PythonExe -m venv $VenvDir
if ($LASTEXITCODE -ne 0) { throw "venv creation failed" }

$VenvPy = Join-Path $VenvDir "Scripts\python.exe"
& $VenvPy -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }

if ($Gpu) {
    # Must precede requirements.txt: ultralytics would otherwise resolve the
    # CPU-only torch wheel first, and pip will not replace a satisfied
    # dependency afterwards. The install silently "succeeds" with no CUDA.
    Write-Host "-- installing CUDA torch (cu121)" -ForegroundColor Yellow
    & $VenvPy -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
    if ($LASTEXITCODE -ne 0) { throw "CUDA torch install failed" }
}

Write-Host "-- installing requirements.txt" -ForegroundColor Yellow
& $VenvPy -m pip install -r (Join-Path $Backend "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "requirements install failed" }

# A Windows venv is NOT self-contained: Scripts\python.exe is a copy of the base
# interpreter and locates the standard library through the `home` line in
# pyvenv.cfg. Ship the venv without that base present on the target and every
# launch dies with "No module named encodings".
#
# So the installer installs CPython itself and configure.ps1 repoints `home` at
# it. That requires the SAME minor version this venv was built against, which is
# recorded here for the installer to check rather than discovered at 2am on a
# plant PC.
$pyVer = (& $VenvPy -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
Set-Content -Path (Join-Path $Payload "PYTHON_VERSION") -Value $pyVer -Encoding ascii
Write-Host "-- built against CPython $pyVer" -ForegroundColor Yellow

# The activate scripts hard-code this build machine's paths and are useless on
# the target. Remove them so nobody uses one and gets a half-broken interpreter.
Get-ChildItem -Path (Join-Path $VenvDir "Scripts") -Include "activate*" -Recurse |
    Remove-Item -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------- app
Write-Host "-- staging application" -ForegroundColor Yellow
$AppDst = Join-Path $Payload "app"
Copy-Item -Recurse -Force (Join-Path $Backend "app") $AppDst
Get-ChildItem -Path $AppDst -Include "__pycache__" -Recurse -Directory |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Copy-Item -Force (Join-Path $Backend "requirements.txt") $Payload
Copy-Item -Force (Join-Path $Backend ".env.example") $Payload
if (Test-Path (Join-Path $Backend "README.md")) {
    Copy-Item -Force (Join-Path $Backend "README.md") $Payload
}

# ---------------------------------------------------------------- weights
if ($IncludeWeights) {
    $WeightsSrc = Join-Path $Root "data\weights"
    if (Test-Path $WeightsSrc) {
        Write-Host "-- bundling weights" -ForegroundColor Yellow
        $WeightsDst = Join-Path $Payload "weights"
        New-Item -ItemType Directory -Force -Path $WeightsDst | Out-Null
        Get-ChildItem -Path $WeightsSrc -Filter "*.pt" |
            ForEach-Object {
                Write-Host ("   + {0} ({1:N0} MB)" -f $_.Name, ($_.Length / 1MB))
                Copy-Item -Force $_.FullName $WeightsDst
            }
        $reg = Join-Path $WeightsSrc "registry.json"
        if (Test-Path $reg) { Copy-Item -Force $reg $WeightsDst }
    } else {
        Write-Warning "no weights at $WeightsSrc -- the agent will download on first run"
    }
}

# ---------------------------------------------------------------- nssm
$Nssm = Join-Path $Payload "nssm.exe"
$NssmLocal = Join-Path $PSScriptRoot "nssm.exe"
if (Test-Path $NssmLocal) {
    Copy-Item -Force $NssmLocal $Nssm
    Write-Host "-- nssm.exe taken from installer/"
} else {
    Write-Warning @"
nssm.exe not found.

Download the 64-bit binary from https://nssm.cc/download and place it at:
    $NssmLocal

It is not vendored here because it is a third-party binary and should be
fetched and checksummed by whoever builds the installer.
"@
}

$size = (Get-ChildItem -Recurse $Payload | Measure-Object -Property Length -Sum).Sum / 1GB
Write-Host ""
Write-Host ("== payload ready: {0:N2} GB ==" -f $size) -ForegroundColor Green
Write-Host "Next: compile installer\setup.iss with Inno Setup 6 (iscc setup.iss)"
