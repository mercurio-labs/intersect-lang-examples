// File editing and worker lifecycle only. Rust owns contracts, stub generation,
// implementation compilation, model admission and invocation.
import { validateBindings } from './binding-state.js';
import { registerRhaiEditor } from './rhai-editor.js';
import './bindings-file.css';

function transport() {
  const worker = new Worker(new URL('./bindings.worker.js', import.meta.url), { type: 'module' });
  let pending, sequence = 0;
  const stop = () => { worker.terminate(); pending?.reject(new Error('Execution cancelled.')); pending = null; };
  worker.onerror = stop;
  worker.onmessage = ({ data }) => {
    if (data.token !== pending?.token) return;
    const request = pending; pending = null;
    if (data.error || !data.response?.ok) request.reject(new Error(data.error || data.response?.message || data.response?.diagnostic?.message || 'Binding request failed.'));
    else request.resolve(data.response);
  };
  return { stop, send(request) {
    if (pending) return Promise.reject(new Error('A function is running. Cancel it first.'));
    return new Promise((resolve, reject) => { pending = { resolve, reject, token: ++sequence }; worker.postMessage({ token: sequence, request }); });
  } };
}
export function createBindingsFile({ monaco, editorOptions, definitions, open, changed, inspectModel }) {
  const panel = document.createElement('section'); panel.id = 'rhai-file'; panel.hidden = true;
  panel.innerHTML = '<div class="rhai-editor"></div><div class="rhai-run"><label>Function <select id="rhai-function" aria-label="Function"></select></label><label>Arguments <input id="rhai-arguments" aria-label="Function arguments" value="[]" spellcheck="false"></label><button id="rhai-run">Run</button><button id="rhai-cancel">Cancel</button><button id="save-rhai">Save Rhai</button></div><p id="rhai-example" hidden>Rust twice uses the shipped example contract. Edit Rhai doubled here; changing its Rcore definitions requires a runtime rebuild. Run doubled with a Meter created in Test; it reads a copy of that model.</p><p id="rhai-status" role="status">Fill in the stubs, then Compile.</p><p id="rhai-implementation" class="rhai-implementation" aria-label="Result implementation"></p><pre id="rhai-result" aria-label="Function result"></pre>';
  document.querySelector('.structure-diagram-panel').append(panel);
  const $ = id => panel.querySelector('#' + id);
  const model = monaco.editor.createModel('', 'rhai', monaco.Uri.parse('file:///implementations.rhai'));
  const editor = monaco.editor.create(panel.firstElementChild, { ...editorOptions, model, ariaLabel: 'Rhai source' });
  const language = registerRhaiEditor({ monaco, model });
  const tab = document.createElement('button'); tab.className = 'tab'; tab.textContent = 'implementations.rhai'; tab.dataset.ecoreView = 'rhai'; tab.hidden = true;
  document.getElementById('ecore-views').append(tab); tab.onclick = open;
  let present = false, active = null, running = null, epoch = 0, generation = null, preset = null;
  const status = text => { $('rhai-status').textContent = text; };
  model.onDidChangeContent(() => { epoch++; changed(); status('Rhai changed. Compile to use this version.'); });
  const snapshot = () => ({ version: preset ? 3 : 2, ...(preset ? {preset} : {}), present, source: model.getValue(), arguments: $('rhai-arguments').value });
  const sourceRequest = values => ({ structure: values.rcore, behavior: values.rcore_behavior, project: !preset });
  function deactivate() { $('rhai-implementation').textContent = ''; active = null; language.clear(); $('rhai-function').replaceChildren(); status('Compile the project to use its implementations.'); }
  function cancel() { running?.stop(); running = null; generation?.stop(); generation = null; epoch++; status('Execution cancelled.'); }
  function restore(value) {
    validateBindings(value); preset = value?.version === 3 ? value.preset : null; $('rhai-example').hidden = !preset; cancel(); active = null; language.clear(); present = value?.present ?? false; tab.hidden = !present;
    model.setValue(value?.source ?? ''); model.setEOL(value?.source.includes('\r\n') ? 1 : 0);
    $('rhai-implementation').textContent = '';
    $('rhai-arguments').value = value?.arguments ?? '[]'; $('rhai-function').replaceChildren(); $('rhai-result').textContent = '';
    status('Compile the project to use its implementations.');
  }
  async function createStub() {
    if (generation) throw new Error('Stub generation is already running.');
    const draft = definitions(), original = model.getValue(), revision = epoch;
    const worker = transport(); generation = worker;
    try {
      const result = await worker.send({ method: 'bindings/stubs', ...sourceRequest(draft), source: original });
      if (revision !== epoch || JSON.stringify(draft) !== JSON.stringify(definitions())) throw new Error('Sources changed during generation. Create Stub again.');
      if (!result.contracts.some(c => c.descriptor.external)) throw new Error('No external functions declared. Add extern fn declarations to Rcore first.');
      present = true; tab.hidden = false;
      language.update(result.contracts);
      if (result.source !== original) { model.pushStackElement(); model.pushEditOperations([], [{ range: model.getFullModelRange(), text: result.source }], () => null); model.pushStackElement(); }
      open(); editor.focus(); status(result.added ? `${result.added} stub(s) created. Fill in the bodies, then Compile.` : 'Existing implementations preserved. No missing stubs.');
    } finally { worker.stop(); if (generation === worker) generation = null; }
  }
  async function prepare(values) {
    const source = model.getValue(), revision = epoch, worker = transport();
    try {
      const inspected = await worker.send({ method: preset ? 'bindings/inspect' : 'bindings/projectInspect', ...sourceRequest(values) });
      if (!inspected.contracts.length) { worker.stop(); return { commit: deactivate, discard() {} }; }
      // This fixed example requests existing native registration; Rust checks exact source-bound contract identity.
      if (preset && inspected.contracts.filter(c => c.descriptor.name === 'twice').length !== 1) throw new Error('The Rust/Rhai example requires one twice declaration.');
      const implementations = inspected.contracts.map(c => ({ contract: c.descriptor.id, backend: preset ? (c.descriptor.name === 'twice' ? 'rust-generated' : 'rhai') : (c.descriptor.external ? 'rhai' : 'rcore'), source }));
      const request = { method: 'bindings/activate', ...sourceRequest(values), implementations };
      await worker.send(request);
      if (revision !== epoch) throw new Error('Rhai changed during compilation. Compile again.');
      return {
        modelBehavior: inspected.model_behavior,
        // The example registry has its original fixture source identity, separate from the workbench language.
        ...(!preset ? {request} : {}),
        commit() {
          active = { request, contracts: inspected.contracts }; worker.stop();
          language.update(inspected.contracts);
          const previous = $('rhai-function').value; $('rhai-function').replaceChildren();
          for (const c of inspected.contracts) { const option = document.createElement('option'); option.value = c.descriptor.id; option.textContent = c.descriptor.name; $('rhai-function').append(option); }
          if (inspected.contracts.some(c => c.descriptor.id === previous)) $('rhai-function').value = previous;
          status('Compiled. Run a function with JSON arguments; write Int64 values as strings.');
        }, discard() { worker.stop(); },
      };
    } catch (error) { worker.stop(); status(error.message); throw error; }
  }
  $('rhai-run').onclick = async () => {
    if (!active) { status('Compile the project first.'); return; }
    if (running) { status('A function is running. Cancel it first.'); return; }
    const current = active, revision = epoch, contract = $('rhai-function').value;
    const worker = transport(); running = worker; status('Running compiled function…'); $('rhai-result').textContent = ''; $('rhai-implementation').textContent = '';
    try {
      const arguments_ = JSON.parse($('rhai-arguments').value);
      const descriptor = current.contracts.find(c => c.descriptor.id === contract)?.descriptor;
      const needsModel = descriptor?.parameters.some(id => descriptor.types[id]?.Model);
      const elements = needsModel ? await inspectModel(current.request.structure) : [];
      await worker.send(current.request);
      const result = await worker.send({ method: 'bindings/invoke', contract, arguments: arguments_, model: elements });
      if (revision !== epoch || active !== current) return;
      $('rhai-result').textContent = JSON.stringify(result.result.evaluation.value, null, 2);
      const implementation = result.result.implementation;
      $('rhai-implementation').textContent = `Implementation: ${implementation.backend} · ${implementation.revision}`;
      status(`Completed with ${result.result.implementation.backend}. Running the last compiled source.`);
    } catch (error) { if (revision === epoch) status(error.message); }
    finally { worker.stop(); if (running === worker) running = null; }
  };
  $('rhai-cancel').onclick = cancel;
  $('save-rhai').onclick = () => {
    const url = URL.createObjectURL(new Blob([model.getValue()], { type: 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'implementations.rhai'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return { model, snapshot, restore, cancel, prepare, createStub, deactivate, show(visible) { panel.hidden = !visible; if (visible) editor.layout(); } };
}
