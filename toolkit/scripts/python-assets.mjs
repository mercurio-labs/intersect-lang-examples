// Build-time copies only. All Python services load from the static origin.
import { mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
for (const dir of ['public/python', 'public/python/pyodide']) await mkdir(new URL(dir, root), { recursive: true });
await copyFile(new URL('node_modules/browser-basedpyright/dist/pyright.worker.js', root), new URL('public/python/pyright.worker.js', root));
await copyFile(new URL('node_modules/browser-basedpyright/LICENSE.txt', root), new URL('public/python/basedpyright-LICENSE.txt', root));
for (const name of ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) await copyFile(new URL(`node_modules/pyodide/${name}`, root), new URL(`public/python/pyodide/${name}`, root));
for (const name of ['PYODIDE.txt', 'CPYTHON.txt']) await copyFile(new URL(`licenses/${name}`, root), new URL(`public/python/${name}`, root));
