import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Third-party notices kept in the shipped script (the minifier drops source comments; the
// package may only contain web files, so they cannot travel as a separate text file).
const NOTICES = `/*! Folk Motion Studies mini-tool. Third-party software and fonts:
 * three.js — MIT License — Copyright © 2010-2025 three.js authors.
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 *   documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 *   the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 *   to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above
 *   copyright notice and this permission notice shall be included in all copies or substantial portions of the
 *   Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
 * IBM Plex Mono — Copyright 2017 IBM Corp. — SIL Open Font License 1.1.
 * Instrument Serif — Copyright 2022 The Instrument Serif Project Authors — SIL Open Font License 1.1.
 */`;

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
  plugins: [{
    // The motion clips record where they were measured; the package carries no outside URLs
    // (the source is credited in the notes as text).
    name: 'strip-motion-source-url',
    transform(code, id) {
      if (!/public\/motion\/[^/]+\.json$/.test(id.split('?')[0])) return null;
      return code.replace(/"url"\s*:\s*"https?:\/\/[^"]*"\s*,?/g, '');
    },
  }, {
    name: 'third-party-notices',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') chunk.code = `${NOTICES}\n${chunk.code}`;
    },
  }],
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
