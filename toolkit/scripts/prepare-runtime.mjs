// Fetch immutable build inputs; never discover or depend on sibling checkouts.
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const source = fileURLToPath(new URL('../.runtime/intersect-text/', import.meta.url));
const pin = JSON.parse(readFileSync(new URL('../runtime.json', import.meta.url)));
if (!/^[0-9a-f]{40}$/.test(pin.revision)) throw new Error('Runtime revision must be a full Git SHA');
function git(args, capture = false) {
  const result = spawnSync('git', args, {cwd: source, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit'});
  if (result.status !== 0) throw new Error(`Runtime Git command failed: ${args[0]} ${result.stderr || result.error || ''}`);
  return result.stdout?.trim();
}
mkdirSync(source, {recursive: true});
if (!existsSync(new URL('../.runtime/intersect-text/.git', import.meta.url))) {
  git(['init']);
  git(['config', 'core.longpaths', 'true']);
  git(['remote', 'add', 'origin', pin.repository]);
}
const current = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding: 'utf8'});
if (current.status !== 0 || current.stdout.trim() !== pin.revision) {
  git(['fetch', '--depth', '1', 'origin', pin.revision]);
  git(['checkout', '--detach', pin.revision]);
}
if (git(['rev-parse', 'HEAD'], true) !== pin.revision) throw new Error('Runtime revision mismatch');
