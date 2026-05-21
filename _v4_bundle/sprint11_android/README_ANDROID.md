# Project Brain Diary — Android APK

A native Android wrapper around the existing Mobile Diary PWA. **Same codebase, two outputs:**
- PWA at `localhost:3000/mobile/diary` (browser, works on any phone)
- Native APK that you can sideload to demo (better camera, true offline support)

## What This Gives You vs PWA

| Feature | PWA | Native APK |
|---|---|---|
| Works in browser | ✅ | n/a |
| Camera | Via `<input type="file">` | Native camera plugin (high quality, no chrome) |
| GPS | `navigator.geolocation` | Native GPS plugin (more accurate, background-friendly) |
| Offline queue | localStorage | Capacitor Preferences (survives app reinstall) |
| Auto-sync when online | Listens to `online` event | Native network change listener |
| Install on phone | Add to home screen | Real app icon, real APK |
| Looks like an app | Mostly | Yes, splash screen and all |
| **Demo value** | "Look at our PWA" | "Here's the APK — install it" |

## File Layout

```
sprint11_android/
├── package.json              # Capacitor deps
├── capacitor.config.ts       # App ID, server URL, permissions
├── native.ts                 # Native bridge module (copy to frontend/lib/)
├── page_v2.tsx               # Updated diary page using native bridge
├── build_apk.sh              # One-command build script
└── README_ANDROID.md         # This file
```

## How It Works

The trick: `native.ts` uses **runtime detection** to pick between:
- `Capacitor.isNativePlatform() === true` → use native plugins (Camera, Geolocation, Preferences, Network)
- Otherwise → fall back to browser APIs (`navigator.geolocation`, `<input type="file">`, `localStorage`)

So the **same frontend code** ships to both PWA users and APK users. No fork.

## Pre-build Setup (one-time)

You need these installed on your Linux/macOS/WSL machine:
1. **Node.js 20+** — `node --version`
2. **Java JDK 17+** — `java --version` (must say `17` or higher)
3. **Android SDK** — install via [Android Studio](https://developer.android.com/studio)
   - After install, open Android Studio once and let it download SDK Platform 34 + Build Tools
   - Set `ANDROID_HOME` env var (Android Studio shows the SDK path in Settings → SDK)

```bash
# On Linux/macOS - add to ~/.bashrc or ~/.zshrc:
export ANDROID_HOME=$HOME/Android/Sdk          # adjust path
export PATH=$PATH:$ANDROID_HOME/platform-tools  # adds adb
```

## Build Steps

### One-shot build:
```bash
cd sprint11_android
./build_apk.sh
```

Output: `sprint11_android/android/app/build/outputs/apk/debug/app-debug.apk`

### Build + install to connected phone:
```bash
# Enable USB debugging on your phone first (Settings → About Phone → tap Build Number 7x → Developer Options → USB Debugging ON)
# Plug phone in, accept the debug prompt
./build_apk.sh --install
```

## Critical: Edit `capacitor.config.ts` BEFORE building

Find this in `capacitor.config.ts`:

```typescript
server: {
  url: 'http://192.168.1.100:3000',  // <<<< CHANGE THIS
  cleartext: true,
}
```

For **Sunday demo**, the easiest setup is:

1. Make sure your laptop is running the Next.js dev server (`npm run dev` in `frontend/`)
2. Find your laptop's LAN IP: `ip addr` (Linux) or `ifconfig` (Mac)
3. Set `url` to `http://<laptop-IP>:3000`
4. Phone needs to be on same WiFi as laptop
5. Build and install APK
6. App opens → it loads the page from your laptop

For **production** with a real domain:
- `url: 'https://projectbrain.yourdomain.com'`
- `cleartext: false`

## After Install on Phone

First time launch: Android will ask for Camera + Location permissions. Tap Allow.

Then you'll see the same UI as the PWA, but with:
- Native camera (clean, no browser chrome)
- Faster GPS
- Top bar shows `Native android · online/offline`
- Offline queue badge shows pending entries

## Demo Day Script

```
1. Open phone → tap "Project Brain Diary" app icon (looks pro)
2. Show login (uses same JWT auth as web)
3. Tap "Submit Entry" → camera opens natively
4. Take photo of "the construction" (point at anything)
5. GPS auto-fills coordinates (show the accuracy in meters)
6. Pick package + activity + remarks → submit
7. Show it appearing in the manager dashboard on your laptop instantly
8. Bonus: turn off WiFi, submit another entry → shows "queued offline"
9. Turn WiFi back on → auto-syncs

This kills the friend's Tkinter app dead. Tkinter has no mobile story at all.
```

## Troubleshooting

**Build fails with "JAVA_HOME not set"** — install JDK 17, point `JAVA_HOME` at it:
```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
```

**"SDK location not found"** — set ANDROID_HOME (see Pre-build Setup)

**Can't install APK on phone** — enable "Install from Unknown Sources" in Settings → Security

**App opens but shows blank screen** — your laptop server URL is wrong in `capacitor.config.ts`, or phone isn't on the same WiFi. Open Chrome DevTools for Android: `chrome://inspect`, see the console errors.

**Camera permission denied** — go to phone Settings → Apps → Project Brain Diary → Permissions → enable Camera + Location

## What's NOT in this Wrapper

- Push notifications (would need Firebase setup)
- Play Store distribution (would need signed AAB + Google Play account)
- iOS version (Capacitor supports iOS too, but Mac needed)

These are all add-on capabilities — Capacitor handles them, just not in scope for Sunday.
