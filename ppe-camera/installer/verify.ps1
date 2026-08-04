<#
    Post-install health check for PPE Agent.

        .\verify.ps1
        .\verify.ps1 -Port 8014 -InstallDir "C:\Program Files\PPEAgent"
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:ProgramFiles\PPEAgent",
    [string]$Port = "",
    [int]$WaitSeconds = 90
)

$ErrorActionPreference = "Continue"
$fail = 0

function Ok($m)   { Write-Host "  OK   $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  FAIL $m" -ForegroundColor Red; $script:fail++ }
function Info($m) { Write-Host "  --   $m" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  PPE Agent verify" -ForegroundColor White
Write-Host ""

if (-not (Test-Path $InstallDir)) {
    Bad "install dir missing: $InstallDir"
    exit 1
}
Ok "install dir $InstallDir"

$envFile = Join-Path $InstallDir ".env"
if (Test-Path $envFile) {
    Ok ".env present"
    if (-not $Port) {
        $m = Select-String -Path $envFile -Pattern '^PPE_PORT=(.+)$' -ErrorAction SilentlyContinue
        if ($m) { $Port = $m.Matches.Groups[1].Value.Trim() }
    }
} else {
    Bad ".env missing (configure did not finish?)"
}
if (-not $Port) { $Port = "8004" }

$py = Join-Path $InstallDir "python\Scripts\python.exe"
if (Test-Path $py) { Ok "python $py" } else { Bad "bundled python missing" }

$weights = Join-Path $InstallDir "data\weights\ppe_active.pt"
if (Test-Path $weights) {
    Ok ("weights $([math]::Round((Get-Item $weights).Length/1MB)) MB")
} else {
    Bad "data\weights\ppe_active.pt missing"
}

foreach ($name in @("PPEAgent", "PPEConsole")) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) {
        if ($name -eq "PPEConsole") {
            Info "PPEConsole not registered (console not bundled or install skipped it)"
        } else {
            Bad "$name service not registered"
        }
        continue
    }
    if ($svc.Status -eq "Running") {
        Ok "$name Running"
    } else {
        Bad "$name status=$($svc.Status)"
        try { Start-Service $name -ErrorAction Stop; Start-Sleep 3 } catch {
            Bad "could not start ${name}: $_"
        }
    }
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$health = $null
Info "waiting up to ${WaitSeconds}s for http://127.0.0.1:${Port}/health"
while ((Get-Date) -lt $deadline) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
        if ($health.status -eq "ok") { break }
    } catch {
        $health = $null
    }
    Start-Sleep -Seconds 2
}

if ($health -and $health.status -eq "ok") {
    Ok "health status=ok role=$($health.role) model=$($health.active_model) v$($health.active_version)"
} else {
    Bad "health endpoint not OK on port $Port"
    $errLog = Join-Path $InstallDir "data\agent.err.log"
    if (Test-Path $errLog) {
        Info "tail of data\agent.err.log:"
        Get-Content $errLog -Tail 15 | ForEach-Object { Info $_ }
    }
}

$console = Get-Service -Name PPEConsole -ErrorAction SilentlyContinue
if ($console -and $console.Status -eq "Running") {
    $cport = "3000"
    if (Test-Path $envFile) {
        # console port is not always in .env; try common default
    }
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$cport/ppe/" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
            Ok "console http://127.0.0.1:$cport/ppe/ -> $($r.StatusCode)"
        } else {
            Bad "console returned $($r.StatusCode)"
        }
    } catch {
        Info "console not reachable on :$cport (may still be starting)"
    }
}

Write-Host ""
if ($fail -eq 0) {
    Write-Host "  VERIFY PASSED" -ForegroundColor Green
    Write-Host "  Agent docs  http://127.0.0.1:$Port/docs"
    Write-Host ""
    exit 0
} else {
    Write-Host "  VERIFY FAILED ($fail issue(s))" -ForegroundColor Red
    Write-Host ""
    exit 1
}
