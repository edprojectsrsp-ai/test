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
    # One code, swapped for this PC's own credentials on first start. Replaces
    # inventing an agent id, generating a token, and adding the pair to a server
    # environment variable -- four steps across two systems, any of which
    # silently yields a 401 much later.
    [string]$JoinCode    = "",
    [string]$AgentName   = "",
    [string]$SyncUrl     = "",
    [string]$CorsOrigins = "",
    [string]$Port        = "8004",
    [switch]$AutoSync,
    # Wall TVs and phones are different machines, so they need a real LAN bind
    # rather than loopback. Opt-in: it moves the trust boundary from "this PC"
    # to "anyone on the plant network", camera feeds included.
    [switch]$LanAccess,
    [string]$LanKey      = "",
    [string]$ConsolePort = "3000"
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
# the site has actually fine-tuned with the generic one shipped in the box --
# on an upgrade, that silently undoes however many weeks of plant-specific
# training, and the only symptom is accuracy quietly getting worse.
$BundledWeights = Join-Path $InstallDir "weights"
if (Test-Path $BundledWeights) {
    New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "weights\zoo") | Out-Null
    $seeded = 0
    $kept = 0
    Get-ChildItem $BundledWeights -File -Recurse | ForEach-Object {
        $rel = $_.FullName.Substring($BundledWeights.Length).TrimStart('\')
        $dst = Join-Path $DataDir "weights\$rel"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
        if (Test-Path $dst) {
            $kept++
        } else {
            Copy-Item -Force $_.FullName $dst
            $seeded++
        }
    }
    Write-Step "weights: seeded $seeded, kept $kept existing"

    $active = Join-Path $DataDir "weights\ppe_active.pt"
    if (Test-Path $active) {
        Write-Step "trained model in place ($([math]::Round((Get-Item $active).Length/1MB)) MB)"
    } else {
        Write-Warning "no ppe_active.pt -- the agent will fall back to base weights and may try to download them"
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
$bindHost = if ($LanAccess) { "0.0.0.0" } else { "127.0.0.1" }

# A LAN bind with no key would leave live camera feeds open to anyone on the
# plant network. Generate one rather than asking, so the safe path is also the
# default path.
if ($LanAccess -and -not $LanKey) {
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $LanKey = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    Write-Step "generated a LAN key"
}

$corsRegex = ""
if ($LanAccess) {
    # A TV reaches the console at http://<ip-or-hostname>:<port>, and on DHCP
    # that address is not knowable here -- so match private LAN origins by
    # pattern. Only RFC1918 ranges and plain hostnames; a public origin still
    # has to be listed explicitly.
    $me = $env:COMPUTERNAME
    $cors = "$cors,http://${me}:$ConsolePort,http://localhost:$ConsolePort"
    $corsRegex = '^http://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[A-Za-z0-9][A-Za-z0-9\-]*)(:\d+)?$'
}

$envLines = @(
    "# Written by the PPE Agent installer. Restart the PPEAgent service after editing.",
    "PPE_ROLE=edge",
    "PPE_PORT=$Port",
    "PPE_ROOT=$InstallDir",
    "",
    "# The control-room page is served over HTTPS but calls this agent on",
    "# http://127.0.0.1:$Port, so its origin must appear here.",
    "PPE_CORS_ORIGINS=$cors",
    "PPE_CORS_ORIGIN_REGEX=$corsRegex",
    "",
    "# 127.0.0.1 = this PC only. 0.0.0.0 = reachable from wall TVs and phones",
    "# on the plant network, in which case PPE_LAN_TOKEN is what protects it.",
    "PPE_HOST=$bindHost",
    "PPE_LAN_TOKEN=$LanKey",
    "",
    "# --- cloud sync (outbound only) ---",
    "# PPE_AGENT_ID / PPE_AGENT_TOKEN are written here by enrollment below.",
    "PPE_SYNC_URL=$SyncUrl",
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

# Loopback unless -LanAccess. The cloud is push-only and never dials in, so the
# only reason to open this to the plant network is wall TVs and phones -- and
# that is a decision with a real cost, since it exposes live camera feeds.
& $Nssm set $ServiceName AppParameters "-m uvicorn app.main:app --host $bindHost --port $Port" | Out-Null
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
    Write-Step "agent running on http://${bindHost}:$Port"
} else {
    Write-Warning "service did not reach Running. Check $DataDir\agent.err.log"
}

# ------------------------------------------------------- 3b. join the cloud
# Done through the running agent rather than here, so there is one
# implementation of "join" -- the same endpoint the control room's Join button
# calls. A failure is reported and never fatal: an agent that cannot reach the
# cloud must still come up and record violations locally, which is the whole
# reason the queue is durable.
if ($JoinCode -and $SyncUrl) {
    Write-Step "joining $SyncUrl"
    $body = @{ cloud_url = $SyncUrl; code = $JoinCode
               name = $AgentName } | ConvertTo-Json -Compress
    $joined = $false
    foreach ($attempt in 1..5) {
        try {
            $r = Invoke-RestMethod -Method Post -TimeoutSec 30 `
                -Uri "http://127.0.0.1:$Port/api/sync/enroll" `
                -ContentType "application/json" -Body $body
            Write-Step "joined as agent '$($r.agent_id)'"
            $joined = $true
            break
        } catch {
            # The service may still be starting; the model loads on boot and
            # that can take a few seconds on a cold cache.
            if ($attempt -lt 5) { Start-Sleep -Seconds 4 }
            else {
                Write-Warning "could not join: $($_.Exception.Message)"
                Write-Warning "The agent works offline. Retry from the control room's Cloud panel."
            }
        }
    }
    if ($joined) {
        # Enrollment rewrote .env; reload so the running process pushes with
        # the new credentials rather than after the next restart.
        try { Restart-Service -Name $ServiceName -Force -ErrorAction Stop } catch {}
    }
} elseif ($SyncUrl) {
    Write-Step "no join code given -- agent runs offline until you join"
}

# ------------------------------------------------------- 4. console service
# The Next.js control room, served over plain http from this PC. This is what
# makes a wall TV possible at all: an HTTPS page may call http://127.0.0.1
# (browsers exempt loopback from mixed-content blocking) but never a LAN IP, so
# a TV loading the cloud site could never reach this agent. Same-scheme, same
# host, no such problem -- and nothing to install on the TV.
$ConsoleService = "PPEConsole"
$ConsoleRoot = Join-Path $InstallDir "console"
$NodeExe = Join-Path $InstallDir "node.exe"

$existingConsole = Get-Service -Name $ConsoleService -ErrorAction SilentlyContinue
if ($existingConsole) {
    & $Nssm stop $ConsoleService confirm | Out-Null
    Start-Sleep -Seconds 2
    & $Nssm remove $ConsoleService confirm | Out-Null
    Start-Sleep -Seconds 1
}

if ((Test-Path (Join-Path $ConsoleRoot "server.js")) -and (Test-Path $NodeExe)) {
    Write-Step "registering console service on port $ConsolePort"
    & $Nssm install $ConsoleService $NodeExe | Out-Null
    & $Nssm set $ConsoleService AppParameters "server.js" | Out-Null
    & $Nssm set $ConsoleService AppDirectory $ConsoleRoot | Out-Null
    & $Nssm set $ConsoleService DisplayName "PPE Control Room (local web console)" | Out-Null
    & $Nssm set $ConsoleService Description "Serves the PPE console over http so wall displays and phones on the plant network can use it." | Out-Null
    & $Nssm set $ConsoleService Start SERVICE_AUTO_START | Out-Null
    # 0.0.0.0 regardless of -LanAccess: a console nobody else can open is the
    # same as no console. The AGENT binding is the security decision, and it is
    # the one gated by the key.
    & $Nssm set $ConsoleService AppEnvironmentExtra `
        "HOSTNAME=0.0.0.0" "PORT=$ConsolePort" "NODE_ENV=production" `
        "NEXT_PUBLIC_PPE_AGENT_PORT=$Port" "NEXT_PUBLIC_PPE_LAN_KEY=$LanKey" | Out-Null
    & $Nssm set $ConsoleService AppStdout (Join-Path $DataDir "console.log") | Out-Null
    & $Nssm set $ConsoleService AppStderr (Join-Path $DataDir "console.err.log") | Out-Null
    & $Nssm set $ConsoleService AppRotateFiles 1 | Out-Null
    & $Nssm set $ConsoleService AppExit Default Restart | Out-Null
    & $Nssm set $ConsoleService AppRestartDelay 5000 | Out-Null
    & $Nssm start $ConsoleService | Out-Null

    Start-Sleep -Seconds 4
    $c = Get-Service -Name $ConsoleService -ErrorAction SilentlyContinue
    if ($c -and $c.Status -eq "Running") {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
               Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
               Select-Object -First 1).IPAddress
        Write-Step "console running -- open http://${ip}:$ConsolePort on the wall TV"
        if ($LanKey) { Write-Step "LAN key: $LanKey  (stored in .env)" }
    } else {
        Write-Warning "console did not start. Check $DataDir\console.err.log"
    }

    if ($LanAccess) {
        # Without these the service is listening and completely unreachable,
        # which presents as "the TV cannot see it" with nothing in any log.
        Write-Step "opening firewall for ports $Port and $ConsolePort"
        foreach ($p in @($Port, $ConsolePort)) {
            $ruleName = "PPE Agent $p"
            try {
                Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
                New-NetFirewallRule -DisplayName $ruleName -Direction Inbound `
                    -Action Allow -Protocol TCP -LocalPort $p -Profile Private,Domain | Out-Null
            } catch {
                Write-Warning "could not add firewall rule for port ${p}: $_"
            }
        }
    }
} else {
    Write-Step "no console bundled (build with -IncludeConsole) -- skipping"
}
