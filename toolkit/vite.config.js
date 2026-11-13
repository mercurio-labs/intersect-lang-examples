import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({base:process.env.TOOLKIT_BASE || '/',build:{rollupOptions:{input:{
  main:fileURLToPath(new URL('./index.html',import.meta.url)),
  libraryText:fileURLToPath(new URL('./library-text.html',import.meta.url)),
  modelText:fileURLToPath(new URL('./model-text.html',import.meta.url)),
  preparedDraft:fileURLToPath(new URL('./prepared-draft.html',import.meta.url)),
}}}});
