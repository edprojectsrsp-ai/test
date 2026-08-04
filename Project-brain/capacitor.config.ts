import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The APK is a thin shell around the already-deployed console, not a bundled
 * copy of it.
 *
 * The bundled-assets route (webDir: 'out') needs `next export`, which this app
 * cannot do: the /api/ppe proxy route is a server route, and the SSG pages call
 * the :8000 backend at build time. That config was carried here for a long time
 * and never worked — `out/` has never existed.
 *
 * Pointing at a URL instead means the phone shows exactly what the browser
 * shows, updates when you redeploy, and needs no export step:
 *
 *   PPE_APP_URL=https://your-app.vercel.app     off-site: violations + analytics
 *   PPE_APP_URL=http://192.168.1.50:3000        on-site: full console, live video
 *
 * allowMixedContent matters for the second case. A WebView, unlike a browser
 * tab, can be told to permit http — which is what lets a phone on plant WiFi
 * reach the agent at all.
 */
const config: CapacitorConfig = {
  appId: 'in.projectbrain.diary',
  appName: 'Project Brain PPE',
  // The bundled bootstrap screen (mobile/index.html, staged into out/ by
  // scripts/build-apk.ps1). It asks for the server address once, stores it, and
  // navigates there. Deliberately NOT server.url: that bakes an address in at
  // build time, which means one APK per site and a rebuild whenever an address
  // changes. One build now installs on any phone at any site.
  webDir: 'out',
  android: {
    // The plant PC serves the console over plain http and has no certificate;
    // a WebView, unlike a browser tab, can be told to allow that.
    allowMixedContent: true,
    backgroundColor: '#09090b',  // matches dark theme
  },
  server: {
    // http so the local bootstrap page and an http LAN console share a scheme.
    androidScheme: 'http',
    cleartext: true,
    // Let the WebView navigate to whichever server the user entered instead of
    // handing it to the system browser, which would leave the app on a blank
    // screen behind it.
    allowNavigation: ['*'],
  },
  plugins: {
    Camera: {
      // ask Android permission on first use, not at startup
      androidPermissions: {
        camera: true,
        readMediaImages: true,
      },
    },
    Geolocation: {
      androidPermissions: {
        coarseLocation: true,
        fineLocation: true,
      },
    },
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#09090b',
      showSpinner: false,
    },
  },
};

export default config;
