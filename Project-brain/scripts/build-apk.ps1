<#
    Builds the PPE Android APK.

    The APK is a shell around a deployed URL (see capacitor.config.ts), so there
    is no web build step here and no static export -- which is the point, since
    this app cannot be exported.

    Requirements on the build machine:
      - JDK 17+            (Capacitor 6 will not build on 11)
      - Android SDK        (Android Studio, or cmdline-tools + platform 34)
      - ANDROID_HOME set

    Usage:
      .\build-apk.ps1 -AppUrl https://your-app.vercel.app
      .\build-apk.ps1 -AppUrl http://192.168.1.50:3000 -Release
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AppUrl,
    [switch]$Release
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "== PPE APK build ==" -ForegroundColor Cyan
Write-Host "   target URL : $AppUrl"

# Fail early and specifically. "gradle failed" fifty lines into a build tells
# you nothing; "your JDK is 11 and Capacitor needs 17" tells you everything.
$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) { throw "java not found. Install JDK 17+." }
$verLine = (& java -version 2>&1 | Select-Object -First 1) -join ""
if ($verLine -match '"(\d+)') {
    $major = [int]$Matches[1]
    if ($major -lt 17) {
        throw "JDK $major found, Capacitor 6 needs 17+. Set JAVA_HOME to a 17+ JDK."
    }
}
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
    throw "ANDROID_HOME not set. Install the Android SDK (Android Studio)."
}

Push-Location $Root
try {
    $env:PPE_APP_URL = $AppUrl

    if (-not (Test-Path (Join-Path $Root "node_modules"))) {
        Write-Host "-- npm install" -ForegroundColor Yellow
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }

    # webDir must exist for the CLI even though the shell loads a remote URL.
    $out = Join-Path $Root "out"
    if (-not (Test-Path $out)) {
        New-Item -ItemType Directory -Force -Path $out | Out-Null
        Set-Content -Path (Join-Path $out "index.html") -Encoding utf8 -Value @"
<!doctype html><meta charset="utf-8"><title>PPE</title>
<body style="background:#09090b;color:#e7eef6;font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0">
Loading PPE console…
</body>
"@
    }

    if (-not (Test-Path (Join-Path $Root "android"))) {
        Write-Host "-- adding android platform" -ForegroundColor Yellow
        & npx cap add android
        if ($LASTEXITCODE -ne 0) { throw "cap add android failed" }
    }

    Write-Host "-- syncing config" -ForegroundColor Yellow
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }

    Push-Location (Join-Path $Root "android")
    try {
        $task = if ($Release) { "assembleRelease" } else { "assembleDebug" }
        Write-Host "-- gradlew $task" -ForegroundColor Yellow
        & .\gradlew.bat $task
        if ($LASTEXITCODE -ne 0) { throw "gradle $task failed" }
    } finally {
        Pop-Location
    }

    $apk = Get-ChildItem -Path (Join-Path $Root "android\app\build\outputs\apk") `
        -Filter *.apk -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($apk) {
        Write-Host ""
        Write-Host ("== APK: {0} ({1:N1} MB) ==" -f $apk.FullName, ($apk.Length / 1MB)) -ForegroundColor Green
        if (-not $Release) {
            Write-Host "Debug build - installs directly via: adb install -r `"$($apk.FullName)`""
        } else {
            Write-Host "Release build is UNSIGNED. Sign it before distributing:"
            Write-Host "  apksigner sign --ks my.keystore $($apk.Name)"
        }
    } else {
        Write-Warning "build reported success but no .apk was found"
    }
} finally {
    Remove-Item Env:\PPE_APP_URL -ErrorAction SilentlyContinue
    Pop-Location
}
