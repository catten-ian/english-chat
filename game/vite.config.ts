import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const shippingAssets = [
  'assets/characters/protagonist.glb',
  'assets/characters/eli-turner.glb',
  'assets/environment/bellweather-harbor-v2.glb'
];

export default defineConfig(({ command }) => ({
  base: '/world-game/',
  publicDir: command === 'build' ? false : 'public',
  plugins: [{ name: 'shipping-assets', closeBundle() {
    if (command !== 'build') return;
    for (const asset of shippingAssets) {
      const target = resolve('dist', asset);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(resolve('public', asset), target);
    }
  } }],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: 'assets'
  },
  server: {
    fs: { strict: true }
  }
}));
