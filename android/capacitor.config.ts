import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cyou.catten.english.dev',
  appName: 'AI English Chat Dev',
  webDir: '../',
  server: {
    url: 'https://www.catten.cyou/english?version=dev',
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
