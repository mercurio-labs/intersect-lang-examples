import {PREPARED_DRAFT_LIMITS} from './prepared-draft-project.js';
export class LanguageClient {
  constructor(onNotification, onFailure) {
    this.disposed = false;
    this.pendingDocumentChange = null;
    this.documentFlushScheduled = false;
    this.onFailure = onFailure;
    this.worker = new Worker(new URL('./language.worker.js', import.meta.url), { type: 'module' });
    this.next = 0;
    this.pending = new Map();
    this.worker.onmessage = ({ data }) => {
      if (data.id !== undefined) {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        clearTimeout(pending.timer); pending.detach(); this.pending.delete(data.id);
        if (data.error) pending.reject(new Error(data.error.message)); else pending.resolve(data.result);
      } else onNotification(data.method, data.params);
    };
    this.worker.onerror = event => { this.dispose(); onFailure(event.message || 'Worker failed'); };
  }
  request(method, params = {}, { signal } = {}) {
    if (this.disposed) return Promise.reject(new Error('Language worker stopped'));
    try { this.flushDocumentChange(); }
    catch (error) { return Promise.reject(error); }
    const callable = method === 'intersect/evaluateFunctionRcore';
    const draft = method === 'intersect/prepareKerMLDraft' || method === 'intersect/prepareKerMLPhysicalProject';
    if (signal && !callable && !draft) return Promise.reject(new Error('AbortSignal is supported only for callable Rcore evaluation or draft analysis.'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      let cancellationRequested = false;
      const cancel = () => {
        const pending = this.pending.get(id);
        if (!pending || cancellationRequested) return;
        cancellationRequested = true;
        clearTimeout(pending.timer);
        if (draft) { this.dispose(new Error('Draft analysis stopped. Restart to analyze again.')); return; }
        // Cancellation remains a Rust terminal result. This timer is only a
        // transport watchdog for a worker unable to acknowledge cancellation.
        pending.timer = setTimeout(() => this.dispose(new Error('Worker did not respond to cancellation. Restart the runtime.')), 5000);
        try { this.notify('$/cancelRequest', { id }); }
        catch (error) { this.dispose(error); }
      };
      const detach = () => signal?.removeEventListener('abort', cancel);
      const timer = setTimeout(callable ? cancel : () => this.dispose(new Error('Worker exceeded its time budget. Restart the runtime.')), draft ? PREPARED_DRAFT_LIMITS.watchdog : 15000);
      this.pending.set(id, { resolve, reject, timer, detach });
      try {
        signal?.addEventListener('abort', cancel, { once: true });
        this.worker.postMessage({ jsonrpc: '2.0', id, method, params });
        if (signal?.aborted) cancel();
      } catch (error) {
        clearTimeout(this.pending.get(id)?.timer ?? timer); detach(); this.pending.delete(id); reject(error);
      }
    });
  }
  // Full synchronization makes intermediate versions replaceable within one
  // synchronous editor burst. Requests, other notifications and another URI
  // are barriers; their ordering and semantic execution remain unchanged.
  notify(method, params) {
    const fullChange = method === 'textDocument/didChange'
      && typeof params?.textDocument?.uri === 'string'
      && Number.isInteger(params.textDocument.version)
      && Array.isArray(params.contentChanges) && params.contentChanges.length > 0
      && params.contentChanges.every(change => !change.range && typeof change.text === 'string');
    if (!fullChange) {
      this.flushDocumentChange();
      this.worker.postMessage({ jsonrpc: '2.0', method, params });
      return;
    }
    if (this.pendingDocumentChange?.textDocument.uri !== params.textDocument.uri) this.flushDocumentChange();
    // The worker ignores non-increasing versions. Preserve the first payload
    // for an equal version, and snapshot caller input before deferring it.
    if (!this.pendingDocumentChange || params.textDocument.version > this.pendingDocumentChange.textDocument.version) {
      this.pendingDocumentChange = structuredClone(params);
    }
    if (this.documentFlushScheduled) return;
    this.documentFlushScheduled = true;
    queueMicrotask(() => {
      this.documentFlushScheduled = false;
      if (this.disposed) return;
      try { this.flushDocumentChange(); }
      catch (error) { this.dispose(error); this.onFailure(error.message); }
    });
  }
  flushDocumentChange() {
    const params = this.pendingDocumentChange;
    this.pendingDocumentChange = null;
    if (params) this.worker.postMessage({ jsonrpc: '2.0', method: 'textDocument/didChange', params });
  }
  dispose(reason = new Error('Language worker stopped')) {
    this.disposed = true;
    this.pendingDocumentChange = null;
    this.worker.terminate();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.detach(); p.reject(reason); }
    this.pending.clear();
  }
}
