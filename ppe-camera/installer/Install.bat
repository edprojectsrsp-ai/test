@echo off
REM PPE Detection Agent - double-click installer
REM Elevates to Administrator, then runs install.ps1 from this folder.

setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator rights...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "Start-Process -FilePath '%~f0' -Verb RunAs -WorkingDirectory '%~dp0'"
    exit /b
)

echo.
echo  PPE Detection Agent installer
echo  --------------------------------
echo  This window is elevated. Installing...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set ERR=%ERRORLEVEL%

echo.
if %ERR% neq 0 (
    echo  INSTALL FAILED  exit code %ERR%
    echo  See messages above. Press any key to close.
) else (
    echo  Press any key to close.
)
pause >nul
exit /b %ERR%
