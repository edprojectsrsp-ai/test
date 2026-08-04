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
    # Optional. The APK asks for the server address on first launch, so one
    # build works at any site; this only pre-fills the box as a convenience.
    [string]$AppUrl = "",
    [switch]$Release
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "== PPE APK build ==" -ForegroundColor Cyan
if ($AppUrl) { Write-Host "   prefilled URL : $AppUrl" } else { Write-Host "   prefilled URL : (none - asked on first launch)" }

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
    if (-not (Test-Path (Join-Path $Root "node_modules"))) {
        Write-Host "-- npm install" -ForegroundColor Yellow
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }

    # Stage the bootstrap screen as the app's bundled web content.
    $out = Join-Path $Root "out"
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    $boot = Join-Path $Root "mobile\index.html"
    if (-not (Test-Path $boot)) { throw "missing mobile\index.html (the bootstrap screen)" }
    $html = Get-Content $boot -Raw
    if ($AppUrl) {
        # Pre-fill the address box only. It is still editable, and still stored
        # per device, so the APK stays site-independent.
        $html = $html.Replace('placeholder="http://192.168.1.50:3000"',
                              'placeholder="http://192.168.1.50:3000" value="' + $AppUrl + '"')
    }
    Set-Content -Path (Join-Path $out "index.html") -Value $html -Encoding utf8

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
        # The wrapper downloads Gradle from services.gradle.org on first run.
        # If that host is blocked, set GRADLE_DISTRIBUTION_URL to a mirror you
        # trust, or install Gradle and build with it directly.
        if ($env:GRADLE_DISTRIBUTION_URL) {
            $props = "gradle\wrapper\gradle-wrapper.properties"
            (Get-Content $props) -replace '^distributionUrl=.*',
                ("distributionUrl=" + $env:GRADLE_DISTRIBUTION_URL.Replace(":", "\:")) |
                Set-Content $props -Encoding ascii
            Write-Host "-- gradle distribution overridden" -ForegroundColor Yellow
        }
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
    Pop-Location
}
