import { source as repository } from './prepare-runtime.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(resolve(root, 'public'), { recursive: true });
// INTERSECT_WEB_WASM names a prebuilt host module with the same ABI, for
// example intersect-lang-kerml's intersect_kerml_web.wasm, which adds the
// KerML draft methods (`draft/kerml/*`) this repository no longer contains.
const prebuilt = process.env.INTERSECT_WEB_WASM;
if (prebuilt) {
  copyFileSync(resolve(prebuilt), resolve(root, 'public/intersect_web.wasm'));
} else {
  const build = spawnSync('cargo', ['build', '-p', 'intersect-web', '--release', '--target', 'wasm32-unknown-unknown', '--locked'], { cwd: repository, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status || 1);
  copyFileSync(resolve(repository, process.env.CARGO_TARGET_DIR || 'target', 'wasm32-unknown-unknown/release/intersect_web.wasm'), resolve(root, 'public/intersect_web.wasm'));
}
