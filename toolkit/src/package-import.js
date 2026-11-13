// Handwritten host extraction only. Rust verifies manifests and recompiles sources.
import { unzipSync } from 'fflate';

export function unpackLanguageArchive(bytes) {
  if (bytes.length > 2_000_000) throw new Error('Language ZIP exceeds 2 MB.');
  let expanded = 0;
  const seen = new Set();
  const entries = unzipSync(bytes, { filter(entry) {
    const path = entry.name;
    if (seen.has(path)) throw new Error(`Duplicate language ZIP entry: ${path}`);
    seen.add(path);
    if (!path || /[\\:]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid language ZIP path.');
    expanded += entry.originalSize;
    if (seen.size > 64 || expanded > 2_000_000) throw new Error('Language ZIP exceeds expanded limits.');
    return true;
  } });
  // Preserve an initial BOM as source content: manifest digests cover exact bytes.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  return Object.fromEntries(Object.entries(entries).map(([path, data]) => [path, decoder.decode(data)]));
}
