import { createTransactionPanel } from './transactions.js';
import { PythonLsp } from './python-lsp.js';
import { generatePythonApi, exampleScript } from './python-api.js';

export function createPythonPane(monaco, options, getClient, config = {}) {
  const prefix = config.prefix || '';
  const scope = document.createElement('div');
  const nodes = new Map();
  const $ = id => nodes.get(id);
  const workspace = config.host || document.querySelector('.workspace');
  scope.insertAdjacentHTML('beforeend', `<article class="panel python-panel"><div class="panel-heading"><div><h2>Python script</h2></div><button id="python-enable" class="text-button">Enable Python</button></div><div class="python-actions"><button id="python-bind" disabled>Bind current API</button><button id="python-run" class="primary" disabled>Run script</button><button id="python-test" disabled title="Run assertions against a fresh model, validate, then discard it">Run tests</button><button id="python-cancel" disabled>Cancel</button></div><div class="file-path"><span>script.py</span><span id="python-binding">Optional · loads on demand</span></div><div id="python-editor" class="editor"></div><div id="python-status" class="panel-footer" role="status">Enable Python to generate the active language API.</div></article>`);
  scope.insertAdjacentHTML('beforeend', `<section class="results python-results" data-usage hidden><article class="panel"><div class="panel-heading"><div><h2>Generated API</h2></div><div><button id="api-stub" class="text-button">Type stubs (.pyi)</button><button id="api-wrapper" class="text-button">Wrappers (.py)</button></div></div><div id="api-editor" class="editor"></div></article><article class="panel"><div class="panel-heading"><h2>Python output & errors</h2></div><pre id="python-output" aria-live="polite">Output appears here. Changes commit only after successful validation.</pre><pre id="python-error" aria-live="polite"></pre><div id="python-diagnostics" aria-live="polite"></div></article></section>`);
  for (const element of scope.querySelectorAll('[id]')) { nodes.set(element.id, element); element.id = prefix + element.id; }
  const panel = scope.querySelector('.python-panel');
  const results = scope.querySelector('.python-results');
  const [apiPanel, outputPanel] = results.children;
  workspace.append(panel);
  workspace.after(results);
  const transactions = config.transactions || createTransactionPanel();
  const subscriptions = [];
  panel.querySelector('.file-path span').textContent = config.name || 'script.py';
  monaco.languages.register({ id: 'python' });
  monaco.languages.setMonarchTokensProvider('python', { tokenizer: { root: [[/#.*$/, 'comment'], [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, 'string'], [/\b(from|import|as|class|def|return|if|else|for|in|while|True|False|None|raise|try|except|print)\b/, 'keyword'], [/\d+/, 'number']] } });
  const model = monaco.editor.createModel(config.source ?? exampleScript, 'python', monaco.Uri.parse('file:///project/' + (config.name || 'script.py')));
  const editor = monaco.editor.create($('python-editor'), { ...options, model, ariaLabel: 'Python script', tabSize: 4 });
  const apiModel = monaco.editor.createModel('# Enable Python to generate a revision-bound API.', 'python', monaco.Uri.parse('file:///generated/' + prefix + 'intersect_api.pyi'));
  const apiEditor = monaco.editor.create($('api-editor'), { ...options, model: apiModel, readOnly: true, ariaLabel: 'Generated Python API', tabSize: 4 });
  let enabled = false, api = null, lsp = null, boundRevision = null, currentRevision = null, epoch = 0, worker = null, deadline = null, running = false;
  let job = null;
  let diagnostics = [], lastError = null, lastResult = null, view = 'stub';
  function status(text) { $('python-status').textContent = text; }
  function buttons() { $('python-run').disabled = !lsp || running || !api || boundRevision !== currentRevision; $('python-test').disabled = $('python-run').disabled; $('python-bind').disabled = !enabled || running || !api; $('python-cancel').disabled = !running || job?.phase === 'publishing' || job?.phase === 'closing'; }
  function error(value) { lastError = value; $('python-error').textContent = JSON.stringify(value, null, 2); status(`${value.kind}: changes rolled back.`); }
  function stop(current) {
    current?.worker?.terminate(); clearTimeout(current?.deadline); current?.finish?.();
    if (job === current) { worker = null; deadline = null; job = null; running = false; buttons(); }
  }
  async function abort(current, value, cancelled = false, complete = false) {
    if (current.phase === 'closing' || current.phase === 'done' || current.phase === 'publishing') return;
    current.phase = 'closing'; current.worker?.terminate(); clearTimeout(current.deadline); buttons();
    try {
      const snapshot = await current.snapshot;
      if (!current.entry) current.entry = transactions.begin(snapshot, current.script);
      const terminalStatus = ['rolled_back', 'cancelled'].includes(current.entry.report.status) ? current.entry.report.status : cancelled ? 'cancelled' : 'rolled_back';
      const receipt = await current.client.request('intersect/transactionFinish', { id: snapshot.transaction.context.id, transaction: current.entry.report, status: terminalStatus, reason: value.message, changes_complete: complete });
      transactions.update(current.entry, receipt, true);
    } catch (e) {
      // If the model worker died, preserve the last observed audit explicitly as
      // incomplete host information; this cannot publish a model.
      if (current.entry) transactions.update(current.entry, { ...current.entry.report, status: cancelled ? 'cancelled' : 'rolled_back', reason: `${value.message} (${e.message})`, changes_complete: false }, true);
    } finally { current.phase = 'done'; stop(current); error(value); }
  }
  function cancel(kind = 'Cancelled', message = 'Script cancelled; no changes were committed.') {
    if (!job) return Promise.resolve();
    if (['publishing', 'closing', 'done'].includes(job.phase)) return job.finished || Promise.resolve();
    if (!job.aborting) job.aborting = abort(job, { kind, message }, kind === 'Cancelled' || kind === 'Timeout', false);
    return job.aborting;
  }
  const range = r => ({ startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 });
  async function refresh(bind = false) {
    if (!enabled) return;
    const ticket = ++epoch;
    lsp?.dispose(); lsp = null; api = null; buttons();
    monaco.editor.setModelMarkers(model, 'python', []); diagnostics = []; $('python-diagnostics').textContent = '';
    try {
      const snapshot = await getClient().request('intersect/inspect');
      if (ticket !== epoch) return;
      if (!snapshot.package) throw new Error('Compile a language first.');
      api = generatePythonApi(snapshot.package, snapshot.interfaceRevision); currentRevision = api.revision;
      apiModel.setValue(api[view]);
      const server = new PythonLsp(p => {
        if (ticket !== epoch || p.uri !== model.uri.toString() || p.version !== model.getVersionId()) return;
        diagnostics = p.diagnostics;
        monaco.editor.setModelMarkers(model, 'python', diagnostics.map(d => ({ ...range(d.range), message: d.message, severity: d.severity === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning })));
        $('python-diagnostics').textContent = diagnostics.map(d => `Line ${d.range.start.line + 1}: ${d.message}`).join('\n');
      }, model.uri.toString());
      lsp = server;
      status('Loading browser Python language server…');
      const version = model.getVersionId();
      await server.initialize(api.stub, model.getValue(), version);
      if (ticket !== epoch) { server.dispose(); return; }
      // An edit may have occurred during server initialization.
      if (model.getVersionId() !== version) server.change(model.getValue(), model.getVersionId());
      if (bind) boundRevision = currentRevision;
      $('python-binding').textContent = boundRevision === currentRevision ? `Bound to revision ${snapshot.revision}` : `STALE script · API revision ${snapshot.revision}`;
      status(boundRevision === currentRevision ? 'Python ready · execution loads Pyodide on demand.' : 'Language recompiled. Review the new API and bind the script before running.');
      buttons();
    } catch (e) { if (ticket === epoch) { lsp?.dispose(); lsp = null; error({ kind: 'InterfaceError', message: e.message }); buttons(); } }
  }
  async function run(disposable = false) {
    if (running) return;
    if (!api || boundRevision !== currentRevision) { error({ kind: 'StaleInterface', message: 'Bind the script to the active API first.' }); return; }
    const binding = api, script = model.getValue();
    if (new TextEncoder().encode(script).length > 131072) { error({ kind: 'RunError', message: 'Script budget exceeded (128 KiB)' }); return; }
    const current = { client: getClient(), script, disposable, phase: 'starting', entry: null, worker: null, deadline: null };
    current.finished = new Promise(resolve => { current.finish = resolve; });
    job = current; running = true; buttons(); lastError = null; lastResult = null; $('python-error').textContent = ''; $('python-output').textContent = '';
    status(disposable ? 'Starting tests…' : 'Starting Python…');
    current.snapshot = current.client.request('intersect/transactionBegin', { disposable });
    try {
      const snapshot = await current.snapshot;
      if (current.phase !== 'starting') return;
      current.entry = transactions.begin(snapshot, script);
      if (snapshot.interfaceRevision !== binding.revision) throw new Error('Stale Python interface; bind to the active language revision.');
      status('Loading Pyodide in a worker…');
      const execution = new Worker(new URL('./python.worker.js', import.meta.url), { type: 'module' }); worker = execution; current.worker = execution;
      current.phase = 'running';
      deadline = setTimeout(() => cancel('Timeout', 'Script exceeded the 60 second run budget; rolled back.'), 60000); current.deadline = deadline;
      execution.onerror = e => { if (job === current) void abort(current, { kind: 'WorkerError', message: e.message }); };
      execution.onmessage = async ({ data }) => {
        if (job !== current || current.phase !== 'running') return;
        if (data.type === 'transaction') { if (data.transaction) transactions.update(current.entry, data.transaction); }
        else if (data.type === 'output') $('python-output').textContent += `${data.stream === 'stderr' ? '[stderr] ' : ''}${data.text}\n`;
        else if (data.type === 'running') status(disposable ? 'Running tests - disposable fixture' : 'Running Python - transaction open');
        else if (data.type === 'error') {
          if (data.transaction) transactions.update(current.entry, data.transaction);
          await abort(current, data.error, false, Boolean(data.transaction));
        } else if (data.type === 'complete') {
          transactions.update(current.entry, data.evaluation.transaction);
          current.phase = 'publishing'; execution.terminate(); clearTimeout(current.deadline); buttons();
          try {
            lastResult = await current.client.request(disposable ? 'intersect/testFinish' : 'intersect/scriptCommit', { transactionId: snapshot.transaction.context.id, interfaceRevision: binding.revision, generation: snapshot.generation, model: data.evaluation.model });
            transactions.update(current.entry, lastResult.transaction, true);
            current.phase = 'done'; stop(current);
            status(disposable ? 'Tests passed - assertions and model validation passed - fixture discarded' : 'Committed - model inspection and derived values updated - validation passed');
          } catch (e) { current.phase = 'running'; await abort(current, { kind: 'CommitError', message: e.message }, false, true); }
        }
      };
      execution.postMessage({ api: binding, package: snapshot.package, bindings: snapshot.bindings, model: snapshot.evaluation.model, context: snapshot.transaction.context, script });
    } catch (e) { await abort(current, { kind: 'RunError', message: e.message }); }
  }
  model.onDidChangeContent(() => { cancel('ScriptChanged', 'Script edited during execution; changes rolled back.'); lsp?.change(model.getValue(), model.getVersionId()); });
  async function request(method, position, token) {
    const server = lsp, version = model.getVersionId(), ticket = epoch;
    if (!server) return null;
    try { const result = await server.at(method, position.lineNumber - 1, position.column - 1); return token.isCancellationRequested || version !== model.getVersionId() || ticket !== epoch ? null : result; } catch { return null; }
  }
  subscriptions.push(monaco.languages.registerCompletionItemProvider('python', { triggerCharacters: ['.'], async provideCompletionItems(m, p, _context, token) {
    if (m !== model) return { suggestions: [] };
    const result = await request('completion', p, token); const word = m.getWordUntilPosition(p);
    return { suggestions: (result?.items || result || []).map(item => ({ label: item.label, sortText: item.sortText, detail: item.detail, insertText: item.textEdit?.newText || item.insertText || item.label, kind: item.kind === 10 ? monaco.languages.CompletionItemKind.Property : item.kind === 7 ? monaco.languages.CompletionItemKind.Class : monaco.languages.CompletionItemKind.Method, range: item.textEdit?.range ? range(item.textEdit.range) : { startLineNumber: p.lineNumber, endLineNumber: p.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn } })) };
  } }));
  subscriptions.push(monaco.languages.registerHoverProvider('python', { async provideHover(m, p, token) { if (m !== model) return null; const result = await request('hover', p, token); return result ? { contents: [{ value: typeof result.contents === 'string' ? result.contents : result.contents.value, isTrusted: false }] } : null; } }));
  subscriptions.push(monaco.languages.registerSignatureHelpProvider('python', { signatureHelpTriggerCharacters: ['(', ','], async provideSignatureHelp(m, p, token) { if (m !== model) return null; const result = await request('signatureHelp', p, token); return result ? { value: { ...result, activeSignature: result.activeSignature || 0, activeParameter: result.activeParameter || 0 }, dispose() {} } : null; } }));
  $('python-enable').onclick = async () => { enabled = true; $('python-enable').disabled = true; $('python-enable').textContent = 'Python enabled'; await refresh(true); };
  $('python-bind').onclick = () => refresh(true);
  $('python-run').onclick = () => run(); $('python-test').onclick = () => run(true); $('python-cancel').onclick = () => cancel();
  $('api-stub').onclick = () => { view = 'stub'; if (api) apiModel.setValue(api.stub); };
  $('api-wrapper').onclick = () => { view = 'source'; if (api) apiModel.setValue(api.source); };
  return { panel, results, apiPanel, outputPanel,
    clearProject() {
      epoch += 1; lsp?.dispose(); lsp = null; enabled = false; api = null; boundRevision = null; currentRevision = null;
      diagnostics = []; lastError = null; lastResult = null;
      monaco.editor.setModelMarkers(model, 'python', []); apiModel.setValue('# Enable Python to generate a revision-bound API.');
      $('python-enable').disabled = false; $('python-enable').textContent = 'Enable Python';
      $('python-binding').textContent = 'Optional · loads on demand';
      $('python-output').textContent = ''; $('python-error').textContent = ''; $('python-diagnostics').textContent = '';
      status('Enable Python to generate the active language API.'); buttons();
    }, dispose() { epoch += 1; cancel(); lsp?.dispose(); subscriptions.forEach(s => s.dispose()); editor.dispose(); apiEditor.dispose(); model.dispose(); apiModel.dispose(); panel.remove(); apiPanel.remove(); outputPanel.remove(); results.remove(); }, transactions, model, editor, apiEditor, run, test: () => run(true), cancel, compiled: () => { cancel('StaleInterface', 'Language recompiled during execution; rolled back.'); return refresh(false); }, reset: () => { epoch += 1; cancel(); boundRevision = null; currentRevision = null; lsp?.dispose(); lsp = null; buttons(); }, get api() { return api; }, get diagnostics() { return diagnostics; }, get lastError() { return lastError; }, get lastResult() { return lastResult; }, request: (method, line, character) => lsp.at(method, line, character) };
}
