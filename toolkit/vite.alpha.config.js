import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.TOOLKIT_BASE || '/',
  publicDir: false,
  build: {
    outDir: 'alpha-dist',
    rollupOptions: { input: Object.fromEntries(
      ['alpha', 'library-text', 'model-text'].map(name => [name, fileURLToPath(new URL(`./${name}.html`, import.meta.url))]),
    ) },
  },
});
