@echo off
setlocal

set "BACKEND_DIR=%~dp0backend"
set "BUNDLED_PYTHON=C:\Users\Vivek\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if exist "%BUNDLED_PYTHON%" (
  "%BUNDLED_PYTHON%" -m uvicorn --app-dir "%BACKEND_DIR%" app.main:app --host 127.0.0.1 --port 8001
) else (
  python -m uvicorn --app-dir "%BACKEND_DIR%" app.main:app --host 127.0.0.1 --port 8001
)
