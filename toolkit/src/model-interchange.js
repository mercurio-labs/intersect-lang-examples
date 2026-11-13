import { zipSync, unzipSync } from 'fflate';
import { createResourceControls } from './resource-controls.js';

// Host file handling only. Registered Rust codecs own serialization/validation.
export function createModelInterchange(getClient, report) {
  const resourceControls=createResourceControls(getClient,report);
  const controls = document.createElement('div'); controls.className = 'model-format-actions';
  controls.innerHTML = '<label>Format <select id="model-format" aria-label="Model file format"></select></label><button id="import-model" class="text-button" disabled>Import model</button><button id="export-model" class="text-button" disabled>Export model ↓</button><input id="model-files" type="file" multiple hidden><span id="interchange-status" role="status"></span>';
  document.querySelector('.inspector .panel-heading').after(controls);
  const select = controls.querySelector('select');
  const input = controls.querySelector('input');
  const importing = controls.querySelector('#import-model');
  const exporting = controls.querySelector('#export-model');
  const exportActions = document.createElement('div'); exportActions.className = 'model-export-actions';
  const jsonExport = document.querySelector('#export');
  jsonExport.before(exportActions); exportActions.append(jsonExport, exporting);
  const status = controls.querySelector('#interchange-status');
  let formats = []; let context = null; let busy = false; let valid = false; let active = false;
  function update() {
    importing.disabled = busy || !active; exporting.disabled = busy || !active || !valid;
    exporting.textContent = `Export ${select.value ? select.value.toUpperCase() : 'model'} ↓`;
  }
  select.onchange = update;
  function message(text) { status.textContent = text; }
  async function run(action) {
    busy = true; update();
    try { await action(); } catch (error) { message(error.message); report(error.message); }
    finally { busy = false; update(); }
  }
  importing.onclick = () => run(async () => {
    const client = getClient();
    context = { ...(await client.request('intersect/inspect')), client, format: select.value };
    input.accept = [...(formats.find(f => f.id === select.value)?.extensions || []).map(e => `.${e}`), '.zip'].join(',');
    input.value = ''; input.click();
  });
  input.onchange = () => run(async () => {
    if (!input.files.length || !context) return;
    const snapshot = context;
    let total = 0; const resources = [];
    function add(uri, bytes) {
      if (resources.length >= 64 || bytes.length + total > 500_000) throw new Error('Browser import limit: 64 resources and 500 KB total.');
      if (/^(?:\/|[a-z]+:)/i.test(uri) || uri.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('Import paths must stay within the selected resource set.');
      total += bytes.length; resources.push({ uri: encodeURI(uri), bytes: Array.from(bytes) });
    }
    for (const file of input.files) {
      if (file.size > 500_000) throw new Error('Browser import limit: 500 KB per file.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (file.name.toLowerCase().endsWith('.zip')) {
        let expanded = total; let count = resources.length; const seen = new Set();
        const entries = unzipSync(bytes, { filter: entry => {
          if (seen.has(entry.name)) throw new Error('Duplicate resource path in ZIP.');
          seen.add(entry.name);
          if (entry.name.endsWith('/')) return false;
          expanded += entry.originalSize; count += 1;
          if (expanded > 500_000 || count > 64) throw new Error('ZIP exceeds browser import limits.');
          return true;
        } });
        for (const [uri, value] of Object.entries(entries)) add(uri, value);
      } else add(file.name, bytes);
    }
    if (!resources.length) throw new Error('No model resources selected.');
    if (snapshot.client !== getClient()) throw new Error('Runtime restarted. Retry import.');
    await snapshot.client.request('intersect/modelImport', { format: snapshot.format, resources, interfaceRevision: snapshot.interfaceRevision, generation: snapshot.generation });
    message(`Imported ${resources.length} resource(s). Editing language text or recompiling replaces the imported model.`);
  });
  exporting.onclick = () => run(async () => {
    const format = formats.find(f => f.id === select.value);
    const result = await getClient().request('intersect/modelExport', { format: select.value });
    const resources = result.resources;
    const files = Object.fromEntries(resources.map(r => [r.uri, [new Uint8Array(r.bytes), { mtime: new Date(1980, 0, 1) }]]));
    const single = resources.length === 1;
    const blob = new Blob([single ? new Uint8Array(resources[0].bytes) : zipSync(files)], { type: single ? format.media_type : 'application/zip' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = single ? resources[0].uri : `intersect-model-${format.id}.zip`; a.click(); URL.revokeObjectURL(url);
    message(`Exported ${resources.length} resource(s).`);
  });
  return {
    async ready() {
      const client = getClient(); const result = await client.request('intersect/modelFormats');
      if (client !== getClient()) return;
      formats = result; select.replaceChildren(...formats.map(f => { const option = document.createElement('option'); option.value = f.id; option.textContent = f.id.toUpperCase(); return option; }));
      active = true; update();
    },
    model(result) { resourceControls.model(result); valid = result.diagnostics.length === 0; update(); if (result.modelOrigin === 'text') message(''); },
    reset() { resourceControls.reset(); active = false; valid = false; context = null; message(''); update(); },
  };
}
