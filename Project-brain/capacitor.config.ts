import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.projectbrain.diary',
  appName: 'Project Brain Diary',
  webDir: 'out',  // Next.js exports static files here
  bundledWebRuntime: false,
  server: {
    // POINT THIS AT YOUR ACTUAL SERVER ON DEMO DAY
    // Options:
    //   1. Local LAN demo: 'http://192.168.1.X:3000' (your laptop's IP on phone's WiFi)
    //   2. Deployed: 'https://projectbrain.yourdomain.com'
    //   3. Bundled static: leave url undefined, use webDir
    //
    // For Sunday demo, RECOMMEND option 1 - laptop+phone on same WiFi
    url: 'http://10.118.1.136:3000',
    cleartext: true,  // allow http (LAN dev). REMOVE in production.
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#09090b',  // matches dark theme
    // No splash needed - keep it instant
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
