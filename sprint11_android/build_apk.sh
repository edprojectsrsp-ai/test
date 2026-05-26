#!/bin/bash
# ============================================================================
# Project Brain Diary — Android APK Builder
# ============================================================================
# Run this on your dev machine (Linux/macOS/WSL). Requires:
#   - Node.js 20+
#   - Java JDK 17+ (Android Gradle 8 requires it)
#   - Android SDK (or Android Studio installed)
#
# Sets up Capacitor wrapper, builds Next.js to static, syncs to Android,
# and produces a debug APK that you can sideload to any Android phone.
#
# Usage:
#   chmod +x build_apk.sh
#   ./build_apk.sh                    # full build → APK at android/app/build/outputs/apk/debug/
#   ./build_apk.sh --install          # also install to connected adb device
#   ./build_apk.sh --release          # build release (signed) APK instead
#
# First-time setup steps (only once):
#   1. Install Android Studio: https://developer.android.com/studio
#   2. Open it once, install SDK Platform 34 + Build Tools
#   3. Set ANDROID_HOME env var (Android Studio shows the path under Settings > SDK)
#   4. Add JDK 17 to PATH (Android Studio ships one at /opt/android-studio/jbr or /Applications/Android Studio.app/Contents/jbr)
#   5. Run this script.
# ============================================================================
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$SCRIPT_DIR/.."
FRONTEND="$ROOT/frontend"
APK_DIR="$SCRIPT_DIR"

INSTALL_AFTER=0
RELEASE=0
for arg in "$@"; do
  case $arg in
    --install) INSTALL_AFTER=1 ;;
    --release) RELEASE=1 ;;
  esac
done

# ----------------------------------------------------------------------------
# 1. PRE-FLIGHT CHECKS
# ----------------------------------------------------------------------------
echo "🔍 Pre-flight checks..."
command -v node >/dev/null 2>&1 || { echo "❌ Node.js not found. Install: https://nodejs.org"; exit 1; }
command -v npm >/dev/null 2>&1  || { echo "❌ npm not found"; exit 1; }
command -v java >/dev/null 2>&1 || { echo "❌ Java not found. Need JDK 17+"; exit 1; }
JAVA_VER=$(java -version 2>&1 | head -1 | awk -F\" '{print $2}' | cut -d. -f1)
if [ "$JAVA_VER" -lt 17 ]; then
    echo "❌ Java $JAVA_VER detected. Need JDK 17+"
    exit 1
fi
if [ -z "$ANDROID_HOME" ]; then
    echo "⚠️  ANDROID_HOME not set. Trying common paths..."
    for p in "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" "/opt/android-sdk"; do
        if [ -d "$p" ]; then
            export ANDROID_HOME="$p"
            echo "   Using: $ANDROID_HOME"
            break
        fi
    done
    if [ -z "$ANDROID_HOME" ]; then
        echo "❌ ANDROID_HOME not found. Install Android Studio and set ANDROID_HOME."
        exit 1
    fi
fi
echo "✅ Node $(node -v), Java $JAVA_VER, ANDROID_HOME=$ANDROID_HOME"

# ----------------------------------------------------------------------------
# 2. CONFIGURE FRONTEND for static export (Capacitor needs this)
# ----------------------------------------------------------------------------
echo ""
echo "🔧 Configuring frontend for static export..."

# Backup existing next.config
if [ -f "$FRONTEND/next.config.js" ] && [ ! -f "$FRONTEND/next.config.js.bak" ]; then
    cp "$FRONTEND/next.config.js" "$FRONTEND/next.config.js.bak"
fi

# Write Capacitor-friendly next.config
cat > "$FRONTEND/next.config.js" << 'CONFEOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',         // static export for Capacitor
  images: { unoptimized: true },
  trailingSlash: true,
};
module.exports = nextConfig;
CONFEOF

# Copy native.ts into frontend/lib if not there
mkdir -p "$FRONTEND/lib"
if [ ! -f "$FRONTEND/lib/native.ts" ]; then
    cp "$APK_DIR/native.ts" "$FRONTEND/lib/native.ts"
    echo "   ↳ Installed native.ts bridge to frontend/lib/"
fi

# Install Capacitor packages in the frontend project if missing
cd "$FRONTEND"
if ! grep -q "@capacitor/core" package.json; then
    echo "   ↳ Installing Capacitor packages in frontend..."
    npm install --save \
        @capacitor/core@^6.1.0 \
        @capacitor/camera@^6.0.0 \
        @capacitor/geolocation@^6.0.0 \
        @capacitor/preferences@^6.0.0 \
        @capacitor/network@^6.0.0 \
        @capacitor/toast@^6.0.0 \
        @capacitor/app@^6.0.0 \
        @capacitor/status-bar@^6.0.0 \
        @capacitor/splash-screen@^6.0.0
    npm install --save-dev @capacitor/cli@^6.1.0
fi

# ----------------------------------------------------------------------------
# 3. BUILD WEB ASSETS
# ----------------------------------------------------------------------------
echo ""
echo "📦 Building Next.js static export..."
cd "$FRONTEND"
npm run build
# Next 13+ exports automatically with output:export — outputs to ./out

if [ ! -d "$FRONTEND/out" ]; then
    echo "❌ Static export failed - no 'out/' directory found"
    exit 1
fi
echo "✅ Static export → $FRONTEND/out"

# ----------------------------------------------------------------------------
# 4. INIT CAPACITOR (first time only)
# ----------------------------------------------------------------------------
cd "$APK_DIR"
if [ ! -d "android" ]; then
    echo ""
    echo "🚀 First-time Capacitor setup..."

    # Use the package.json + capacitor.config we shipped
    if [ ! -d "node_modules" ]; then
        npm install
    fi

    # Symlink/copy webDir from frontend
    rm -rf out
    cp -r "$FRONTEND/out" .

    npx cap init "Project Brain Diary" "in.projectbrain.diary" --web-dir=out
    npx cap add android

    echo "✅ Android project scaffolded"
fi

# ----------------------------------------------------------------------------
# 5. SYNC web assets into Android project
# ----------------------------------------------------------------------------
echo ""
echo "🔄 Syncing web assets to Android..."
rm -rf "$APK_DIR/out"
cp -r "$FRONTEND/out" "$APK_DIR/"
npx cap sync android
echo "✅ Synced"

# ----------------------------------------------------------------------------
# 6. PATCH AndroidManifest for permissions
# ----------------------------------------------------------------------------
echo ""
echo "🔐 Ensuring AndroidManifest permissions..."
MANIFEST="$APK_DIR/android/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ]; then
    for perm in CAMERA ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION INTERNET ACCESS_NETWORK_STATE \
                READ_EXTERNAL_STORAGE WRITE_EXTERNAL_STORAGE; do
        if ! grep -q "android.permission.$perm" "$MANIFEST"; then
            sed -i.bak "s|<application|<uses-permission android:name=\"android.permission.$perm\" />\n    <application|" "$MANIFEST"
        fi
    done
    echo "✅ Permissions ensured"
fi

# ----------------------------------------------------------------------------
# 7. BUILD APK
# ----------------------------------------------------------------------------
echo ""
if [ $RELEASE -eq 1 ]; then
    echo "📱 Building RELEASE APK (requires signing setup)..."
    cd "$APK_DIR/android"
    ./gradlew assembleRelease
    APK_PATH="$APK_DIR/android/app/build/outputs/apk/release/app-release-unsigned.apk"
else
    echo "📱 Building DEBUG APK..."
    cd "$APK_DIR/android"
    chmod +x gradlew
    ./gradlew assembleDebug
    APK_PATH="$APK_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
fi

if [ -f "$APK_PATH" ]; then
    APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo ""
    echo "🎉 BUILD SUCCESS!"
    echo "   APK: $APK_PATH"
    echo "   Size: $APK_SIZE"
    echo ""
    echo "📲 To install on phone:"
    echo "   Option 1 (cable + USB debugging on):"
    echo "      adb install -r '$APK_PATH'"
    echo "   Option 2 (sideload):"
    echo "      1. Copy the .apk to your phone"
    echo "      2. Open it - Android will ask to allow install from unknown sources"
    echo "      3. Confirm and install"
    echo ""
else
    echo "❌ APK not found at expected path: $APK_PATH"
    echo "   Check the Gradle output above for errors."
    exit 1
fi

# ----------------------------------------------------------------------------
# 8. OPTIONAL: install via adb
# ----------------------------------------------------------------------------
if [ $INSTALL_AFTER -eq 1 ]; then
    echo "📲 Installing to connected device via adb..."
    if ! command -v adb >/dev/null 2>&1; then
        echo "❌ adb not in PATH. Either add Android SDK platform-tools to PATH or sideload manually."
        exit 1
    fi
    adb devices
    adb install -r "$APK_PATH"
    echo "✅ Installed"
fi

echo ""
echo "🚀 Done. Look for 'Project Brain Diary' on your phone."
