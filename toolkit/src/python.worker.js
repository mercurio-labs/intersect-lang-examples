import { loadRuntime } from './runtime.js';

// One disposable worker and Rust transaction per run. Termination is rollback.
self.onmessage = async ({ data }) => {
  let outputBytes = 0;
  let runtime;
  let begun = false;
  const report = () => begun ? runtime({ method: 'script/transaction', revision: data.api.revision }) : null;
  const progress = () => self.postMessage({ type: 'transaction', transaction: report() });
  const output = (stream, text) => {
    outputBytes += text.length + 1; // Include the newline, including empty prints.
    if (outputBytes > 65536) throw new Error('Script output budget exceeded (64 KiB)');
    self.postMessage({ type: 'output', stream, text });
  };
  try {
    const base = new URL(`${import.meta.env.BASE_URL}python/pyodide/`, self.location.origin).href;
    const { loadPyodide } = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
    const [python, native] = await Promise.all([loadPyodide({ indexURL: base, stdout: text => output('stdout', text), stderr: text => output('stderr', text) }), loadRuntime()]);
    runtime = native;
    runtime({ method: 'script/begin', package: data.package, bindings: data.bindings, model: data.model, revision: data.api.revision, context: data.context });
    begun = true; progress();
    python.registerJsModule('_intersect_host', { request: input => {
      try {
        const request = JSON.parse(input), value = runtime(request);
        if (['script/create', 'script/set', 'script/unset', 'script/collection','script/delete','script/reparent'].includes(request.method)) progress();
        return JSON.stringify({ value });
      } catch (error) { progress(); return JSON.stringify({ error: error.message }); }
    } });
    python.FS.writeFile('/home/pyodide/intersect_api.py', data.api.source);
    python.globals.set('_script_source', data.script);
    self.postMessage({ type: 'running' });
    const result = JSON.parse(await python.runPythonAsync(`
import json, traceback
try:
    exec(compile(_script_source, 'script.py', 'exec'), {'__name__': '__main__'})
    _outcome = {'ok': True}
except BaseException as error:
    _outcome = {'ok': False, 'error': {'kind': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc(), 'frames': [{'file': f.filename, 'line': f.lineno, 'name': f.name} for f in traceback.extract_tb(error.__traceback__)]}}
json.dumps(_outcome)
`));
    // Pyodide translates stream callback failures to OSError. Preserve the host
    // limit as a structured error, even if Python catches that OSError.
    if (outputBytes > 65536) throw new Error('Script output budget exceeded (64 KiB)');
    if (!result.ok) { self.postMessage({ type: 'error', error: result.error, transaction: report() }); return; }
    const evaluation = runtime({ method: 'script/commit', revision: data.api.revision });
    self.postMessage({ type: 'complete', evaluation });
  } catch (error) {
    let transaction = null; try { transaction = report(); } catch { /* Keep the original error if the runtime itself failed. */ }
    self.postMessage({ type: 'error', transaction, error: { kind: outputBytes > 65536 ? 'OutputLimit' : 'RuntimeError', message: error.message } });
  }
};
