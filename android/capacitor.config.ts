import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cyou.catten.english.dev',
  appName: 'AI English Chat Dev',
  // Keep the generated native project outside the web source tree. The APK
  // uses the remote dev URL below; this tiny local page is only a fallback.
  webDir: 'web',
  server: {
    url: 'https://www.catten.cyou/english?version=dev',
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
