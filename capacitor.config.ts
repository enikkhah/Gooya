import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.enikkhah.gooya',
  appName: 'گویا',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
