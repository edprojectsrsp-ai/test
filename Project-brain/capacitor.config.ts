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
const APP_URL = process.env.PPE_APP_URL || '';

const config: CapacitorConfig = {
  appId: 'in.projectbrain.diary',
  appName: 'Project Brain PPE',
  // Kept only to satisfy the CLI when no server URL is given. Nothing is built
  // into it; set PPE_APP_URL.
  webDir: 'out',
  android: {
    allowMixedContent: true,
    backgroundColor: '#09090b',  // matches dark theme
  },
  ...(APP_URL
    ? {
        server: {
          url: APP_URL,
          // Plain http is required for the on-site LAN case; the agent has no
          // certificate and a plant PC cannot easily get one.
          cleartext: APP_URL.startsWith('http://'),
        },
      }
    : {}),
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
