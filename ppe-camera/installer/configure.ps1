<#
    Post-install configuration, invoked by setup.iss.

    Three jobs:
      1. Repoint the bundled venv at the CPython the installer just placed.
      2. Write .env from the wizard's answers.
      3. Register (or re-register) the Windows service.

    Written to be idempotent: an upgrade over an existing install re-runs this
    whole script, and re-running it must never destroy an operator's tuned
    configuration or their violation history.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [string]$PythonHome  = "",
    [string]$RedistDir   = "",
    [string]$AgentId     = "",
    [string]$AgentToken  = "",
    [string]$SyncUrl     = "",
    [string]$CorsOrigins = "",
    [string]$Port        = "8004",
    [switch]$AutoSync
)

$ErrorActionPreference = "Stop"
$ServiceName = "PPEAgent"

function Write-Step($m) { Write-Host "[ppe-agent] $m" }

# ------------------------------------------------------------------ 1. venv
$VenvDir = Join-Path $InstallDir "python"
$Cfg     = Join-Path $VenvDir "pyvenv.cfg"

$WantVer = (Get-Content (Join-Path $InstallDir "PYTHON_VERSION") -ErrorAction SilentlyContinue)
if (-not $WantVer) { $WantVer = "3.12" }
$WantVer = $WantVer.Trim()

function Find-PythonHome([string]$Version) {
    # The launcher is the reliable way to ask for a specific minor version;
    # "python" on PATH may be any version, or the Store alias stub.
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $found = & py "-$Version" -c "import sys, os; print(os.path.dirname(sys.executable))" 2>$null
        if ($LASTEXITCODE -eq 0 -and $found) { return $found.Trim() }
    }
    foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles)) {
        if (-not $base) { continue }
        $c = Join-Path $base ("Programs\Python\Python" + $Version.Replace(".", "") + "\python.exe")
        if (Test-Path $c) { return (Split-Path -Parent $c) }
        $c = Join-Path $base ("Python" + $Version.Replace(".", "") + "\python.exe")
        if (Test-Path $c) { return (Split-Path -Parent $c) }
    }
    return ""
}

if (-not $PythonHome) { $PythonHome = Find-PythonHome $WantVer }

if (-not $PythonHome -and $RedistDir -and (Test-Path $RedistDir)) {
    # No suitable interpreter, but the installer bundled one.
    $redist = Get-ChildItem -Path $RedistDir -Filter "python-*-amd64.exe" -ErrorAction SilentlyContinue |
              Select-Object -First 1
    if ($redist) {
        Write-Step "installing CPython $WantVer from $($redist.Name)"
        # PrependPath=0 deliberately: this PC may already have a Python that
        # other software depends on, and silently taking over PATH during an
        # unattended install is not ours to do. The service uses an absolute path.
        $p = Start-Process -FilePath $redist.FullName -Wait -PassThru -ArgumentList @(
            "/quiet", "InstallAllUsers=1", "PrependPath=0", "Include_launcher=1",
            "Include_test=0", "SimpleInstall=1")
        if ($p.ExitCode -ne 0) {
            Write-Warning "python installer exited with $($p.ExitCode)"
        }
        $PythonHome = Find-PythonHome $WantVer
    }
}

if (-not $PythonHome -or -not (Test-Path (Join-Path $PythonHome "python.exe"))) {
    throw @"
Could not find or install CPython $WantVer.

The bundled runtime was built against $WantVer and needs that exact minor
version present. Either install it from https://python.org/downloads and re-run
this installer, or re-run with -PythonHome pointing at an existing install.
"@
}
Write-Step "using CPython at $PythonHome"

Write-Step "pointing venv at $PythonHome"
$lines = @(
    "home = $PythonHome",
    "include-system-site-packages = false",
    "version = " + (& (Join-Path $PythonHome "python.exe") -c "import sys; print('%d.%d.%d' % sys.version_info[:3])").Trim()
)
Set-Content -Path $Cfg -Value $lines -Encoding ascii

# The venv's python.exe is a copy of the base one. If the bundled copy and the
# installed base disagree (a 3.12 payload on a 3.13 host, say) the interpreter
# loads the wrong python3xx.dll and dies with an unhelpful access violation.
Copy-Item -Force (Join-Path $PythonHome "python.exe") (Join-Path $VenvDir "Scripts\python.exe")
Copy-Item -Force (Join-Path $PythonHome "pythonw.exe") (Join-Path $VenvDir "Scripts\pythonw.exe") -ErrorAction SilentlyContinue

$VenvPy = Join-Path $VenvDir "Scripts\python.exe"
Write-Step "verifying interpreter"
& $VenvPy -c "import fastapi, uvicorn, sqlalchemy; print('deps ok')"
if ($LASTEXITCODE -ne 0) { throw "bundled interpreter cannot import its dependencies" }

# ------------------------------------------------------------------ 2. .env
$DataDir = Join-Path $InstallDir "data"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "weights") | Out-Null

# Seed bundled weights only where none exist. Overwriting would replace a model
# the site has actually fine-tuned with the generic one shipped in the box.
$BundledWeights = Join-Path $InstallDir "weights"
if (Test-Path $BundledWeights) {
    Get-ChildItem $BundledWeights -File | ForEach-Object {
        $dst = Join-Path $DataDir "weights\$($_.Name)"
        if (-not (Test-Path $dst)) {
            Write-Step "seeding weight $($_.Name)"
            Copy-Item -Force $_.FullName $dst
        }
    }
}

$EnvFile = Join-Path $InstallDir ".env"
if (Test-Path $EnvFile) {
    # An upgrade must not silently rewrite a configuration someone tuned by
    # hand. Keep it, back it up, and let them merge.
    Write-Step ".env exists -- keeping it (new template at .env.new)"
    $EnvFile = Join-Path $InstallDir ".env.new"
}

$autoVal = if ($AutoSync) { "1" } else { "0" }
$cors = if ($CorsOrigins) { $CorsOrigins } else { "http://localhost:3000,http://127.0.0.1:3000" }

$envLines = @(
    "# Written by the PPE Agent installer. Restart the PPEAgent service after editing.",
    "PPE_ROLE=edge",
    "PPE_PORT=$Port",
    "PPE_ROOT=$InstallDir",
    "",
    "# The control-room page is served over HTTPS but calls this agent on",
    "# http://127.0.0.1:$Port, so its origin must appear here.",
    "PPE_CORS_ORIGINS=$cors",
    "",
    "# --- cloud sync (outbound only) ---",
    "PPE_SYNC_URL=$SyncUrl",
    "PPE_AGENT_ID=$AgentId",
    "PPE_AGENT_TOKEN=$AgentToken",
    "",
    "# 0 = nothing leaves this PC until someone presses Push in the UI.",
    "PPE_AUTO_SYNC=$autoVal",
    "PPE_SYNC_INTERVAL_S=14400",
    "PPE_SYNC_BATCH=100",
    "PPE_SYNC_THUMB_WIDTH=640",
    "PPE_SYNC_THUMB_QUALITY=75"
)
Set-Content -Path $EnvFile -Value $envLines -Encoding ascii
Write-Step "wrote $EnvFile"

# The token is a credential: keep it off other users' reach on a shared PC.
try {
    icacls $EnvFile /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(F)" | Out-Null
    Write-Step "restricted .env to SYSTEM + Administrators"
} catch {
    Write-Warning "could not restrict .env permissions: $_"
}

# --------------------------------------------------------------- 3. service
$Nssm = Join-Path $InstallDir "nssm.exe"
if (-not (Test-Path $Nssm)) { throw "nssm.exe missing from $InstallDir" }

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Step "stopping existing service"
    & $Nssm stop $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 2
    & $Nssm remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

Write-Step "registering service $ServiceName"
& $Nssm install $ServiceName $VenvPy | Out-Null

# Bind to loopback. Nothing but the browser on this PC talks to the agent --
# the cloud is push-only and never dials in -- so there is no reason to expose
# camera streams to the plant LAN.
& $Nssm set $ServiceName AppParameters "-m uvicorn app.main:app --host 127.0.0.1 --port $Port" | Out-Null
& $Nssm set $ServiceName AppDirectory $InstallDir | Out-Null
& $Nssm set $ServiceName DisplayName "PPE Detection Agent" | Out-Null
& $Nssm set $ServiceName Description "Local PPE detection: cameras, inference, recording. Pushes violations to the cloud dashboard on request." | Out-Null
& $Nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $Nssm set $ServiceName AppStdout (Join-Path $DataDir "agent.log") | Out-Null
& $Nssm set $ServiceName AppStderr (Join-Path $DataDir "agent.err.log") | Out-Null
& $Nssm set $ServiceName AppRotateFiles 1 | Out-Null
& $Nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
& $Nssm set $ServiceName AppExit Default Restart | Out-Null
# A camera that drops at 3am should not leave the service flapping in a tight
# restart loop and filling the disk with logs.
& $Nssm set $ServiceName AppRestartDelay 5000 | Out-Null

Write-Step "starting service"
& $Nssm start $ServiceName | Out-Null

Start-Sleep -Seconds 5
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Step "service is running on http://127.0.0.1:$Port"
} else {
    Write-Warning "service did not reach Running. Check $DataDir\agent.err.log"
}
