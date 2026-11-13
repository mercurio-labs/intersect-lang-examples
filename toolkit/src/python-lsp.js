// Handwritten LSP transport. Generated language APIs enter the server's VFS.
export class PythonLsp {
  constructor(onDiagnostics = () => {}, uri = 'file:///project/script.py') {
    this.uri = uri;
    this.pending = new Map(); this.workers = []; this.next = 0; this.onDiagnostics = onDiagnostics;
    const url = `${import.meta.env.BASE_URL}python/pyright.worker.js`;
    this.worker = new Worker(url, { name: 'Python foreground' }); this.workers.push(this.worker);
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'browser/newWorker') {
        const worker = new Worker(url, { name: 'Python analysis' }); this.workers.push(worker);
        worker.postMessage({ type: 'browser/boot', mode: 'background', initialData: data.initialData, port: data.port }, [data.port]);
      } else if (data.method && data.id !== undefined) {
        this.worker.postMessage({ jsonrpc: '2.0', id: data.id, result: data.method === 'workspace/configuration' ? data.params.items.map(() => ({})) : null });
      } else if (data.method === 'textDocument/publishDiagnostics') this.onDiagnostics(data.params);
      else if (data.id !== undefined) { const p = this.pending.get(data.id); if (p) { clearTimeout(p.timer); this.pending.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); } }
    };
    this.worker.onerror = e => this.dispose(e.message);
    this.worker.postMessage({ type: 'browser/boot', mode: 'foreground' });
  }
  request(method, params) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Python LSP timed out: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.worker.postMessage({ jsonrpc: '2.0', method, params }); }
  async initialize(stub, text, version = 1) {
    const result = await this.request('initialize', { processId: null, rootUri: 'file:///project', capabilities: { textDocument: { publishDiagnostics: { versionSupport: true } } }, initializationOptions: { files: { '/project/intersect_api.pyi': stub, '/project/pyrightconfig.json': JSON.stringify({ typeCheckingMode: 'standard', pythonVersion: '3.13', typeshedPath: '/typeshed-fallback' }) } } });
    this.notify('initialized', {});
    this.notify('textDocument/didOpen', { textDocument: { uri: this.uri, languageId: 'python', version, text } });
    return result;
  }
  change(text, version) { this.notify('textDocument/didChange', { textDocument: { uri: this.uri, version }, contentChanges: [{ text }] }); }
  at(method, line, character) { return this.request(`textDocument/${method}`, { textDocument: { uri: this.uri }, position: { line, character } }); }
  dispose(message = 'Python interface replaced') { for (const worker of this.workers) worker.terminate(); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } this.pending.clear(); }
}
