$ErrorActionPreference = "Stop"

$port = 8001
$hostName = "127.0.0.1"
$backendDir = Join-Path $PSScriptRoot "project-brain-web\backend"
$preferredPython = "C:\Users\Vivek\AppData\Local\Programs\Python\Python314\python.exe"
$python = if (Test-Path -LiteralPath $preferredPython) { $preferredPython } else { "python" }

Write-Host "Checking backend port $port..."
$listeners = netstat -ano | Select-String -Pattern "^\s*TCP\s+$hostName`:$port\s+\S+\s+LISTENING\s+(\d+)"
$pids = @()
foreach ($listener in $listeners) {
    $pidText = $listener.Matches[0].Groups[1].Value
    if ($pidText) {
        $pids += [int]$pidText
    }
}

$pids = $pids | Sort-Object -Unique
foreach ($listenerPid in $pids) {
    Write-Host "Stopping existing backend process on port ${port}: PID $listenerPid"
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
}

Write-Host "Starting backend on http://$hostName`:$port"
Write-Host "Press Ctrl+C to stop this server."
& $python -m uvicorn --app-dir $backendDir app.main:app --host $hostName --port $port
