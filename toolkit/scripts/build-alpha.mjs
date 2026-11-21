// The alpha artifact always builds the pinned host; custom-host overrides are
// useful in development but cannot describe the qualified release pair.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.env.INTERSECT_WEB_WASM) throw new Error('Alpha builds require the pinned Text host; unset INTERSECT_WEB_WASM');
const base = process.env.TOOLKIT_BASE || '/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('TOOLKIT_BASE must be an absolute URL path ending in /');
for (const [command, args] of [
  [process.execPath, ['scripts/build-wasm.mjs']],
  [process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.alpha.config.js']],
  [process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-B', 'scripts/alpha-assets.py']],
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error || result.status}`);
}
