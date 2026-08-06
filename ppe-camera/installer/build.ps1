<#
    Builds the PPE Agent installer payload.

    Produces build/payload/ containing a complete, self-contained runtime:

        payload/
          python/      a full venv with torch + ultralytics + opencv
          app/         the FastAPI application
          weights/     model checkpoints (optional, see -IncludeWeights)
          ppeagent.exe / ppeconsole.exe   WinSW service hosts
          redist/      CPython installer, so the target needs no internet

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
    # Bundle the Next.js control room so wall TVs and phones on the plant
    # network can open it over http. Without this the console is browser-only
    # from the cloud, and the agent is reachable from the plant PC alone.
    [switch]$IncludeConsole,
    [string]$PythonExe = "python",
    [string]$ConsoleDir = "",
    [string]$NodeExe = "node"
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
# The whole point of shipping weights is that the plant PC works the moment it
# is installed. Without them the agent tries to pull a base checkpoint from the
# internet on first boot -- on a plant network that is often blocked, and the
# result is a service that starts, looks healthy, and detects nothing.
if ($IncludeWeights) {
    $WeightsSrc = Join-Path $Root "data\weights"
    if (Test-Path $WeightsSrc) {
        Write-Host "-- bundling weights" -ForegroundColor Yellow
        $WeightsDst = Join-Path $Payload "weights"
        New-Item -ItemType Directory -Force -Path $WeightsDst | Out-Null
        $bytes = 0

        # Every format the model picker can actually activate. Filtering to
        # *.pt alone silently dropped nduka1999.onnx, which the registry lists
        # four times -- so four entries in the picker pointed at a file that
        # was never in the box.
        $ckptExt = @(".pt", ".onnx", ".engine", ".torchscript")

        # The fine-tuned checkpoint actually in service.
        Get-ChildItem -Path $WeightsSrc -File |
            Where-Object { $ckptExt -contains $_.Extension.ToLower() } | ForEach-Object {
            Write-Host ("   + {0} ({1:N0} MB)" -f $_.Name, ($_.Length / 1MB))
            Copy-Item -Force $_.FullName $WeightsDst
            $bytes += $_.Length
        }

        # registry.json is not optional: it records which version is active and
        # what each checkpoint is. Ship the .pt files without it and the model
        # picker is empty and nothing can be switched back to.
        $reg = Join-Path $WeightsSrc "registry.json"
        if (Test-Path $reg) {
            Copy-Item -Force $reg $WeightsDst
            Write-Host "   + registry.json"
        } else {
            Write-Warning "   registry.json missing -- the model picker will be empty"
        }

        # The zoo: every alternative model an operator can switch to from the
        # dashboard. Skipping it leaves those entries listed but unusable.
        $zooSrc = Join-Path $WeightsSrc "zoo"
        if (Test-Path $zooSrc) {
            $zooDst = Join-Path $WeightsDst "zoo"
            New-Item -ItemType Directory -Force -Path $zooDst | Out-Null
            Get-ChildItem -Path $zooSrc -File |
                Where-Object { $ckptExt -contains $_.Extension.ToLower() } | ForEach-Object {
                Write-Host ("   + zoo\{0} ({1:N0} MB)" -f $_.Name, ($_.Length / 1MB))
                Copy-Item -Force $_.FullName $zooDst
                $bytes += $_.Length
            }
            Get-ChildItem -Path $zooSrc -Filter "*.json" -ErrorAction SilentlyContinue |
                ForEach-Object { Copy-Item -Force $_.FullName $zooDst }
        }

        Write-Host ("-- weights bundled: {0:N0} MB" -f ($bytes / 1MB)) -ForegroundColor Yellow
        if ($bytes -eq 0) {
            Write-Warning "no .pt files found -- the agent will try to download on first run"
        }
    } else {
        Write-Warning "no weights at $WeightsSrc -- the agent will download on first run"
    }
}

# ---------------------------------------------------------------- console
if ($IncludeConsole) {
    if (-not $ConsoleDir) {
        $ConsoleDir = Join-Path (Split-Path -Parent $Root) "Project-brain"
    }
    if (-not (Test-Path (Join-Path $ConsoleDir "package.json"))) {
        throw "No Next.js project at $ConsoleDir (pass -ConsoleDir)"
    }

    Write-Host "-- building control room (standalone)" -ForegroundColor Yellow
    Push-Location $ConsoleDir
    try {
        $env:PPE_STANDALONE = "1"
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "next build failed" }
    } finally {
        Remove-Item Env:\PPE_STANDALONE -ErrorAction SilentlyContinue
        Pop-Location
    }

    $standalone = Join-Path $ConsoleDir ".next\standalone"
    if (-not (Test-Path $standalone)) {
        throw "no .next\standalone -- is output:'standalone' active for PPE_STANDALONE=1?"
    }

    $ConsoleDst = Join-Path $Payload "console"
    New-Item -ItemType Directory -Force -Path $ConsoleDst | Out-Null
    Copy-Item -Recurse -Force (Join-Path $standalone "*") $ConsoleDst

    # standalone deliberately omits these two -- Next documents that they must be
    # copied alongside, and without them every asset and image 404s while the
    # HTML still renders, which looks like a broken stylesheet rather than a
    # packaging mistake.
    $staticSrc = Join-Path $ConsoleDir ".next\static"
    if (Test-Path $staticSrc) {
        $staticDst = Join-Path $ConsoleDst ".next\static"
        New-Item -ItemType Directory -Force -Path $staticDst | Out-Null
        Copy-Item -Recurse -Force (Join-Path $staticSrc "*") $staticDst
    }
    $publicSrc = Join-Path $ConsoleDir "public"
    if (Test-Path $publicSrc) {
        Copy-Item -Recurse -Force $publicSrc (Join-Path $ConsoleDst "public")
    }

    # A Node runtime, so the plant PC needs nothing preinstalled.
    $nodePath = (Get-Command $NodeExe -ErrorAction SilentlyContinue).Source
    if ($nodePath) {
        Copy-Item -Force $nodePath (Join-Path $Payload "node.exe")
        Write-Host "-- bundled node.exe from $nodePath"
    } else {
        Write-Warning "node not found -- install Node 20+ or the console service cannot start"
    }
}

# ------------------------------------------------------------- desktop launcher
# A small windowless exe that opens the console this PC serves, in a browser
# app window. Ships in the payload so the ZIP and the Setup.exe both get it.
# csc.exe is part of the .NET Framework that is already on every supported
# Windows, so this adds no build dependency.
Write-Host "-- building desktop launcher" -ForegroundColor Yellow
$Branding = Join-Path $PSScriptRoot "branding"
New-Item -ItemType Directory -Force -Path $Branding | Out-Null
$IconOut = Join-Path $Branding "ppe.ico"
$IconSrc = Join-Path $Payload "console\public\icon-192.png"
if (-not (Test-Path $IconSrc)) {
    $IconSrc = Join-Path (Split-Path -Parent $Root) "Project-brain\public\icon-192.png"
}
if (Test-Path $IconSrc) {
    & (Join-Path $PSScriptRoot "make_icon.ps1") -Source $IconSrc -OutFile $IconOut
} else {
    Write-Warning "no icon-192.png found -- shortcuts will use the default icon"
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$LauncherExe = Join-Path $Branding "PpeConsole.exe"
if (Test-Path $csc) {
    $cscArgs = @("/nologo", "/target:winexe", "/optimize+",
                 "/out:$LauncherExe",
                 "/reference:System.dll", "/reference:System.Windows.Forms.dll",
                 "/reference:System.Drawing.dll",
                 (Join-Path $PSScriptRoot "launcher\PpeConsole.cs"))
    if (Test-Path $IconOut) { $cscArgs = @("/win32icon:$IconOut") + $cscArgs }
    & $csc @cscArgs
    if ($LASTEXITCODE -ne 0) { throw "launcher compile failed ($LASTEXITCODE)" }
    Copy-Item -Force $LauncherExe $Payload
    if (Test-Path $IconOut) { Copy-Item -Force $IconOut $Payload }
    Write-Host ("   + PpeConsole.exe ({0:N0} KB)" -f ((Get-Item $LauncherExe).Length / 1KB))
} else {
    Write-Warning "csc.exe not found -- no desktop launcher; shortcuts fall back to a browser tab"
}

# ------------------------------------------------------------- service host
# No third-party service wrapper is bundled. The agent registers itself as a
# native Windows service through pywin32 (app/service_win.py), which comes from
# PyPI -- the one download host a plant network is guaranteed to allow, since
# nothing here installs without it. NSSM and WinSW would both mean fetching a
# binary from a site that is frequently blocked.
Write-Host "-- service host: native (pywin32)"

# ------------------------------------------------------------- python redist
# Bundle CPython so the installer works on a machine with no Python and no
# internet -- a plant PC is frequently both.
$RedistDir = Join-Path $PSScriptRoot "redist"
New-Item -ItemType Directory -Force -Path $RedistDir | Out-Null
$pyVerFull = (& $VenvPy -c "import sys; print('%d.%d.%d' % sys.version_info[:3])").Trim()
$redistExe = Join-Path $RedistDir "python-$pyVerFull-amd64.exe"
if (-not (Test-Path $redistExe)) {
    Write-Host "-- fetching CPython $pyVerFull installer" -ForegroundColor Yellow
    $url = "https://www.python.org/ftp/python/$pyVerFull/python-$pyVerFull-amd64.exe"
    try {
        Invoke-WebRequest -Uri $url -OutFile $redistExe -UseBasicParsing -TimeoutSec 300
        Write-Host ("   + {0:N0} MB" -f ((Get-Item $redistExe).Length / 1MB))
    } catch {
        Write-Warning "could not fetch CPython $pyVerFull ($_)."
        Write-Warning "The installer will need Python $pyVer already present on the target."
        Remove-Item $redistExe -ErrorAction SilentlyContinue
    }
}

$size = (Get-ChildItem -Recurse $Payload | Measure-Object -Property Length -Sum).Sum / 1GB
Write-Host ""
Write-Host ("== payload ready: {0:N2} GB ==" -f $size) -ForegroundColor Green
Write-Host "Next: .\package.ps1   ->  dist\PPEAgent-<version>-<flavour>.zip"
