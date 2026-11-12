import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const characterFiles = ['protagonist.glb', 'eli-turner.glb', 'mara-quinn.glb', 'jonah-reed.glb']
  .filter(file => existsSync(resolve('public/assets/characters', file)));
const shippingAssets = [
  ...characterFiles.map(file => `assets/characters/${file}`),
  'assets/environment/bellweather-harbor-v4.glb',
  'assets/environment/small-harbour-sunset.hdr'
];

export default defineConfig(({ command }) => ({
  base: '/world-game/',
  define: { 'import.meta.env.WORLD_GAME_CHARACTER_FILES': JSON.stringify(characterFiles) },
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
