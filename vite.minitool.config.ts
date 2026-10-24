import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Xiaohongshu mini-tool build (offline H5 zip): one classic script targeting Chrome 61 /
 * ES2017, no IWSDK runtime ('@iwsdk/core' is mapped to plain Three.js), no public/ folder.
 * scripts/minitool/package.mjs turns dist-minitool/ into the uploadable zip.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/minitool'),
  base: './',
  publicDir: false,
  define: { __MINITOOL__: 'true' },
  resolve: {
    alias: { '@iwsdk/core': resolve(__dirname, 'src/minitool/three-shim.ts') },
    dedupe: ['three'],
  },
  build: {
    outDir: resolve(__dirname, 'dist-minitool'),
    emptyOutDir: true,
    target: ['es2017', 'chrome61'],
    cssTarget: 'chrome61',
    sourcemap: false,
    modulePreload: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  esbuild: { target: 'es2017' },
});
