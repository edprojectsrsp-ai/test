$backendDir = Join-Path $PSScriptRoot "backend"
$bundledPython = "C:\Users\Vivek\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (Test-Path -LiteralPath $bundledPython) {
    & $bundledPython -m uvicorn --app-dir $backendDir app.main:app --host 127.0.0.1 --port 8001
} else {
    & python -m uvicorn --app-dir $backendDir app.main:app --host 127.0.0.1 --port 8001
}
