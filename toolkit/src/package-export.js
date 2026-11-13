// Handwritten host packaging. Definition identity and compilation stay in Rust.
import { zipSync, strToU8 } from 'fflate';
import { generatePythonApi, PYTHON_BINDING_VERSION } from './python-api.js';

export async function packageArchive(distribution, includePython) {
  const manifest = structuredClone(distribution.manifest);
  const files = { ...distribution.files };
  if (includePython) {
    const api = generatePythonApi(distribution.package, manifest.revision);
    files['python/intersect_api.py'] = api.source;
    files['python/intersect_api.pyi'] = api.stub;
    manifest.python = {
      generator: 'intersect-python-api', version: PYTHON_BINDING_VERSION,
      revision: manifest.revision, host_api: 'intersect.script.v1',
      source: 'python/intersect_api.py', stub: 'python/intersect_api.pyi',
    };
  }
  const inferred = Object.hasOwn(manifest.definitions ?? {}, 'inference');
  // The legacy compiler identity pins its complete format-2 container bytes,
  // including this historical advisory text. Current APIs live in Xtext;
  // new Xtext-owned archive profiles name that loader directly.
  const loader = manifest.compiler?.name === 'intersect-model'
    ? 'intersect_model::definitions::distribution::import_files'
    : 'intersect_text::distribution::import_files';
  const runtimeName = manifest.compiler?.name === 'intersect-model' ? 'intersect_xtext' : 'intersect_text';
  const retained = inferred ? 'full retained inference source request' : 'full retained compilation bundle';
  files['README.txt'] = `Intersect language package — format 2

manifest.json identifies the language, exact definition revision, compiler,
runtime profile and SHA-256 digest of each payload file. Release is a label;
it does not prove compatibility. The content revision covers the exact retained
definition inputs, including the ${retained}. File digests also identify compiled and generated artifacts.

To use with the current runtime, verify and recompile using
${loader},
then evaluate model sources with
${runtimeName}. Validate compatibility and digests before consuming files.
Hosts can verify extracted files with ${loader}.
The workbench does not yet provide a language ZIP import UI.

${includePython ? `python/intersect_api.py and .pyi are generated bindings, not a standalone runtime.
They require Python 3.11+ and an _intersect_host.request(JSON) bridge implementing
intersect.script.v1 against the shared Rust model transaction services.
The bridge must bind the transaction to manifest.revision, which is embedded in
the wrapper. The browser currently uses session-bound bindings generated afresh.
No Python interpreter, host bridge, user script or model instance is bundled.
` : 'Python bindings were not requested.\n'}
This package covers the bounded compiler profile declared in the manifest. No external
dependencies, custom executable providers or adornments are supported here.
${inferred ? 'definitions/inference.json retains exact original sources, dependencies/namespace\nselections and the selected grammar. Compilation rebuilds inference from that request.' : 'definitions/bundle.json retains exact authored sources and explicit compiler\nselections. Compilation rebuilds from that bundle.'} The archive does not execute
cached schema or behavior programs without checking their retained inputs.
Original definitions retain their upstream ownership and licensing.
`;
  for (const path of Object.keys(files).sort()) {
    const bytes = strToU8(files[path]);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    manifest.files[path] = { sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), bytes: bytes.length };
  }
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  const entries = Object.fromEntries(Object.keys(files).sort().map(path => [path, strToU8(files[path])]));
  // A fixed DOS timestamp makes repeated exports independent of the clock.
  return zipSync(entries, { level: 6, mtime: new Date(1980, 0, 1) });
}

export function createPackageExport(getClient, hasPendingEdits) {
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="package-dialog" aria-labelledby="package-title" aria-describedby="package-snapshot">
      <form id="package-form">
        <div class="package-heading"><div><div class="eyebrow">LANGUAGE PACKAGE</div><h2 id="package-title">Export your language</h2></div><button type="button" id="package-close" class="text-button" aria-label="Close export dialog">✕</button></div>
        <p id="package-snapshot"></p>
        <div class="package-fields">
          <label>Package ID<input name="package_id" required maxlength="160" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]*" placeholder="org.example.library" spellcheck="false"><span>A stable identifier for this language distribution.</span></label>
          <label>Release<input name="release" required maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]*" placeholder="0.1.0" spellcheck="false"><span>A release label, such as 1.0.0 or 1.0.0-beta.1.</span></label>
          <label class="package-wide">Display name<input name="display_name" required maxlength="120"></label>
          <label class="package-wide">Description <span>(optional)</span><textarea name="description" maxlength="2000" rows="3"></textarea></label>
        </div>
        <label class="package-python"><input name="python" type="checkbox" checked> Include Python wrappers and type stubs (.py / .pyi)</label>
        <p class="package-help">Python bindings require the Intersect runtime and host bridge. Definitions and the compiled package are always included.</p>
        <details class="package-details"><summary>Package contents and identity</summary><p>manifest.json · package.json · definitions/ · optional python/ · README.txt</p><p>The content revision and file checksums are calculated automatically. The model namespace is preserved.</p><code id="package-namespace"></code></details>
        <p id="package-error" role="alert"></p>
        <div class="package-footer"><button type="button" id="package-cancel" class="quiet">Cancel</button><button type="submit" id="package-download" class="primary">Download ZIP</button></div>
      </form>
    </dialog>`);
  const dialog = document.getElementById('package-dialog');
  const form = document.getElementById('package-form');
  const error = document.getElementById('package-error');
  const submit = document.getElementById('package-download');
  let snapshot, saved, busy = false, attempt = 0;
  document.getElementById('package-close').onclick = () => dialog.close();
  document.getElementById('package-cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { attempt += 1; busy = false; submit.disabled = false; submit.textContent = 'Download ZIP'; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const ticket = ++attempt;
    const metadata = Object.fromEntries(['package_id', 'release', 'display_name', 'description'].map(key => [key, form.elements.namedItem(key).value.trim()]));
    const includePython = form.elements.namedItem('python').checked;
    error.textContent = ''; busy = true; submit.disabled = true; submit.textContent = 'Preparing ZIP…';
    try {
      const distribution = await getClient().request('intersect/packageExport', { revision: snapshot.interfaceRevision, metadata });
      const bytes = await packageArchive(distribution, includePython);
      if (ticket !== attempt || !dialog.open) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const link = document.createElement('a'); link.href = url; link.download = `${metadata.package_id}-${metadata.release}.zip`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      saved = { ...metadata, python: includePython }; dialog.close();
    } catch (e) {
      if (ticket === attempt) error.textContent = `${e.message}${includePython && e.message.includes('Python binding') ? ' Uncheck Python bindings to export the language alone.' : ''}`;
    } finally {
      if (ticket === attempt) { busy = false; submit.disabled = false; submit.textContent = 'Download ZIP'; }
    }
  });
  return async () => {
    if (dialog.open) return;
    snapshot = null;
    error.textContent = '';
    try {
      snapshot = await getClient().request('intersect/inspect');
      if (!snapshot.package) throw new Error('Compile a language before exporting a package.');
      const defaults = saved || { package_id: snapshot.package.schema.name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '') || 'language', release: '0.1.0', display_name: snapshot.package.schema.name, description: '', python: true };
      for (const [key, value] of Object.entries(defaults)) {
        const field = form.elements.namedItem(key);
        if (key === 'python') field.checked = value; else field.value = value;
      }
      document.getElementById('package-snapshot').textContent = `Exports compiled language revision ${snapshot.revision}.${hasPendingEdits(snapshot.package.sources) ? ' Uncompiled definition edits are excluded. Compile them first to include them.' : ''}`;
      document.getElementById('package-namespace').textContent = snapshot.package.schema.uri;
    } catch (e) { error.textContent = e.message; }
    submit.disabled = !snapshot?.package;
    dialog.showModal();
  };
}
