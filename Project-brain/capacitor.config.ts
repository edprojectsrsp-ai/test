import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.projectbrain.diary',
  appName: 'Project Brain Diary',
  webDir: 'out',
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
