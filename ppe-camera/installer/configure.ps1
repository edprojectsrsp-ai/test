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

function Find-RegisteredPythonHome([string]$Version) {
    # Emits every registered candidate rather than the first, because a broken
    # install registers itself just as loudly as a good one. Find-PythonHome
    # validates them.
    foreach ($root in @(
        "HKLM:\SOFTWARE\Python\PythonCore",
        "HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore",
        "HKCU:\SOFTWARE\Python\PythonCore"
    )) {
        $key = Join-Path $root $Version
        $installKey = Join-Path $key "InstallPath"
        try {
            # NOT $home: that is a read-only automatic variable, so assigning to
            # it throws, the catch below swallows it, and this whole registry
            # lookup silently finds nothing on every machine.
            $pyHome = (Get-ItemProperty -Path $installKey -ErrorAction Stop).'(default)'
            if (-not $pyHome) {
                $pyHome = (Get-ItemProperty -Path $installKey -ErrorAction Stop).ExecutablePath
            }
            if ($pyHome) {
                if ($pyHome -like "*.exe") { $pyHome = Split-Path -Parent $pyHome }
                if (Test-Path (Join-Path $pyHome "python.exe")) {
                    $pyHome.TrimEnd('\')
                }
            }
        } catch { }
        $pathKey = Join-Path $key "PythonPath"
        try {
            $pythonPath = (Get-ItemProperty -Path $pathKey -ErrorAction Stop).'(default)'
            foreach ($entry in ($pythonPath -split ';')) {
                if (-not $entry) { continue }
                $candidate = $entry.TrimEnd('\')
                if ($candidate -like '*\Lib') { $candidate = Split-Path -Parent $candidate }
                if (Test-Path (Join-Path $candidate "python.exe")) {
                    $candidate.TrimEnd('\')
                }
            }
        } catch { }
    }
}

function Test-PythonHome([string]$PythonRoot) {
    if (-not $PythonRoot) { return $false }
    $py = Join-Path $PythonRoot "python.exe"
    $stdlib = Join-Path $PythonRoot "Lib\os.py"
    if (-not (Test-Path $py) -or -not (Test-Path $stdlib)) { return $false }
    $oldNativePref = $PSNativeCommandUseErrorActionPreference
    try {
        $PSNativeCommandUseErrorActionPreference = $false
        & $py -c "import encodings, sys; print(sys.base_prefix)" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $PSNativeCommandUseErrorActionPreference = $oldNativePref
    }
}

# ------------------------------------------------------------------ 1. venv
$VenvDir = Join-Path $InstallDir "python"
$Cfg     = Join-Path $VenvDir "pyvenv.cfg"

$WantVer = (Get-Content (Join-Path $InstallDir "PYTHON_VERSION") -ErrorAction SilentlyContinue)
if (-not $WantVer) { $WantVer = "3.12" }
$WantVer = $WantVer.Trim()

function Get-PythonHomeCandidates([string]$Version) {
    # The launcher is the reliable way to ask for a specific minor version;
    # "python" on PATH may be any version, or the Store alias stub.
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $oldNativePref = $PSNativeCommandUseErrorActionPreference
        try {
            $PSNativeCommandUseErrorActionPreference = $false
            $found = & py "-$Version" -c "import sys, os; print(os.path.dirname(sys.executable))" 2>$null
            if ($LASTEXITCODE -eq 0 -and $found) { $found.Trim() }
        } catch { }
        finally {
            $PSNativeCommandUseErrorActionPreference = $oldNativePref
        }
    }
    Find-RegisteredPythonHome $Version
    $tag = "Python" + $Version.Replace(".", "")
    foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $base) { continue }
        Join-Path $base "Programs\Python\$tag"
        Join-Path $base $tag
    }
    if ($env:SystemDrive) { Join-Path $env:SystemDrive $tag }
}

function Find-PythonHome([string]$Version) {
    # Every candidate is verified before it is accepted, and a bad one only
    # moves the search along. Returning the first hit unchecked is how this
    # lands on a half-installed CPython -- a python.exe with no Lib\ next to it
    # registers itself with the py launcher exactly like a working one, wins
    # because the launcher is asked first, and then the venv gets repointed at
    # an interpreter that cannot import encodings.
    $seen = @{}
    foreach ($cand in (Get-PythonHomeCandidates $Version)) {
        if (-not $cand) { continue }
        $c = $cand.TrimEnd('\')
        if ($seen.ContainsKey($c.ToLower())) { continue }
        $seen[$c.ToLower()] = $true
        if (-not (Test-Path (Join-Path $c "python.exe"))) { continue }
        if (Test-PythonHome $c) { return $c }
        Write-Step "skipping incomplete CPython at $c"
    }
    return ""
}

if (-not $PythonHome) { $PythonHome = Find-PythonHome $WantVer }
if ($PythonHome -and -not (Test-PythonHome $PythonHome)) {
    Write-Warning "ignoring incomplete CPython at $PythonHome"
    $PythonHome = ""
}

if (-not $PythonHome -and $RedistDir -and (Test-Path $RedistDir)) {
    # No suitable interpreter, but the installer bundled one.
    $redist = Get-ChildItem -Path $RedistDir -Filter "python-*-amd64.exe" -ErrorAction SilentlyContinue |
              Select-Object -First 1
    if ($redist) {
        $targetDir = Join-Path $env:SystemDrive ("Python" + $WantVer.Replace(".", ""))
        Write-Step "installing CPython $WantVer from $($redist.Name)"
        # PrependPath=0 deliberately: this PC may already have a Python that
        # other software depends on, and silently taking over PATH during an
        # unattended install is not ours to do. The service uses an absolute path.
        $p = Start-Process -FilePath $redist.FullName -Wait -PassThru -ArgumentList @(
            "/quiet", "InstallAllUsers=1", "PrependPath=0", "Include_launcher=0",
            "AssociateFiles=0", "Shortcuts=0", "Include_core=1", "Include_exe=1",
            "Include_lib=1", "Include_pip=0", "Include_tcltk=0", "Include_dev=0",
            "Include_doc=0", "Include_test=0", "SimpleInstall=1",
            "TargetDir=$targetDir")
        if ($p.ExitCode -ne 0) {
            Write-Warning "python installer exited with $($p.ExitCode)"
        }
        $PythonHome = Find-PythonHome $WantVer
        if ($PythonHome -and -not (Test-PythonHome $PythonHome)) {
            Write-Warning "CPython install at $PythonHome is still incomplete after repair"
            $PythonHome = ""
        }
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
# The parentheses around the concatenation are load-bearing: PowerShell's comma
# operator binds tighter than +, so `@("a", "b", "c" + $x)` builds a FOUR-element
# array -- which wrote pyvenv.cfg with "version =" and the number on separate
# lines. Python tolerated it because only `home` actually matters, so this would
# have sat there looking fine.
$pyFullVer = (& (Join-Path $PythonHome "python.exe") -c "import sys; print('%d.%d.%d' % sys.version_info[:3])").Trim()
$lines = @(
    "home = $PythonHome",
    "include-system-site-packages = false",
    ("version = " + $pyFullVer)
)
Set-Content -Path $Cfg -Value $lines -Encoding ascii

# The venv's python.exe is a copy of the base one. If the bundled copy and the
# installed base disagree (a 3.12 payload on a 3.13 host, say) the interpreter
# loads the wrong python3xx.dll and dies with an unhelpful access violation.
Copy-Item -Force (Join-Path $PythonHome "python.exe") (Join-Path $VenvDir "Scripts\python.exe")
Copy-Item -Force (Join-Path $PythonHome "pythonw.exe") (Join-Path $VenvDir "Scripts\pythonw.exe") -ErrorAction SilentlyContinue

# python.exe cannot start without python3xx.dll, and a venv's Scripts\ does not
# contain one -- interactively it is found through the base install's entry on
# the *user* PATH. The services run as LocalSystem, which has no user PATH, so
# without this the process dies before it can reach the service dispatcher and
# the SCM reports only "did not respond to the start request in a timely
# fashion", with nothing written to any log.
#
# This is not an edge case: python.org's installer defaults to a per-user
# install, so the DLL is almost always somewhere LocalSystem cannot see.
$dllCopied = @()
foreach ($pattern in @("python3*.dll", "vcruntime*.dll")) {
    Get-ChildItem -Path $PythonHome -Filter $pattern -File -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item -Force $_.FullName (Join-Path $VenvDir "Scripts\$($_.Name)")
        $dllCopied += $_.Name
    }
}
if ($dllCopied) {
    Write-Step "staged interpreter DLLs next to python.exe: $($dllCopied -join ', ')"
} else {
    Write-Warning "no python3*.dll found in $PythonHome -- the services may not start"
}

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
# A native Windows service via pywin32, not a third-party wrapper. NSSM and
# WinSW are both fine, but both are binaries fetched from a download host, and
# this has to install on plant networks that block them. pywin32 comes from
# PyPI, which is already required to install anything here.
function Remove-ServiceIfPresent([string]$Name, [string]$RemoveCmd) {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    Write-Step "removing existing service $Name"
    try {
        Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Push-Location $InstallDir
        try {
            & $VenvPy -m app.service_win $RemoveCmd 2>&1 | Out-Null
        } finally {
            Pop-Location
        }
        Start-Sleep -Seconds 1
        if (Get-Service -Name $Name -ErrorAction SilentlyContinue) {
            & sc.exe delete $Name | Out-Null
            Start-Sleep -Seconds 2
        }
    } catch { Write-Warning "could not remove ${Name}: $_" }
}

Write-Step "ensuring pywin32 is present"
& $VenvPy -c "import win32serviceutil" 2>$null
if ($LASTEXITCODE -ne 0) {
    # Bundled in the payload normally; this is the offline-install fallback.
    & $VenvPy -m pip install --no-index --find-links (Join-Path $InstallDir "wheels") pywin32 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { & $VenvPy -m pip install pywin32 2>&1 | Out-Null }
    & $VenvPy -c "import win32serviceutil" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "pywin32 is required to register the service" }
}

# Even when pywin32 is already bundled in the payload, its post-install still
# needs to run on the target machine so the service host DLLs are registered
# against the Python that was just installed there rather than the build box.
$PyWinPost = Join-Path $VenvDir "Scripts\pywin32_postinstall.py"
if (Test-Path $PyWinPost) {
    Write-Step "finalizing pywin32 service registration"
    & $VenvPy $PyWinPost -install 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "pywin32 post-install failed ($LASTEXITCODE)"
    }
}

Remove-ServiceIfPresent $ServiceName "remove-agent"

Write-Step "registering service $ServiceName"
Push-Location $InstallDir
try {
    & $VenvPy -m app.service_win install-agent "--root=$InstallDir" "--port=$Port" "--host=$bindHost"
    if ($LASTEXITCODE -ne 0) { throw "service registration failed ($LASTEXITCODE)" }
} finally { Pop-Location }

Start-Service -Name $ServiceName -ErrorAction SilentlyContinue

Start-Sleep -Seconds 5
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Step "agent running on http://${bindHost}:$Port"
} else {
    Write-Warning "service did not reach Running. Check $DataDir\agent.err.log"
    # Capture sc query for support; install.ps1 will still try /health.
    try {
        & sc.exe query $ServiceName | Out-File (Join-Path $DataDir "service_query.txt") -Encoding ascii
    } catch {}
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

Remove-ServiceIfPresent $ConsoleService "remove-console"

if ((Test-Path (Join-Path $ConsoleRoot "server.js")) -and (Test-Path $NodeExe)) {
    Write-Step "registering console service on port $ConsolePort"
    Push-Location $InstallDir
    try {
        & $VenvPy -m app.service_win install-console "--root=$InstallDir" `
            "--port=$ConsolePort" "--agent-port=$Port" "--lan-key=$LanKey"
    } finally { Pop-Location }
    Start-Service -Name $ConsoleService -ErrorAction SilentlyContinue

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
