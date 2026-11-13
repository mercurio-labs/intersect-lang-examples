// Worker-owned transport state. Every analysis rebuilds through the native facade.
import {createPreparedDraftProject, preparedDraftRequest, PREPARED_DRAFT_LIMITS} from './prepared-draft-project.js';
import {createPreparedPhysicalProject, preparedPhysicalProjectRequest} from './prepared-draft-project.js';
const encoder = new TextEncoder();
function version(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid draft document version.');
}
// The native frozen-engine KerML load response: the unlinked construction of
// exactly the requested sources and its parse diagnostics. It never grants
// language validation or publication.
function nativeEnvelope(response, uris) {
  if (!response || response.version !== 1 || response.kind !== 'frozen_kerml_load'
      || response.language_validated !== false || response.publication_permitted !== false
      || response.linked !== false || Object.hasOwn(response, 'package')
      || JSON.stringify(response.sources) !== JSON.stringify(uris)) throw new Error('Invalid native KerML load response.');
  if (encoder.encode(JSON.stringify(response)).length > PREPARED_DRAFT_LIMITS.response) throw new Error('KerML load response byte budget exceeded.');
  if (!Array.isArray(response.diagnostics)) throw new Error('Invalid native KerML load diagnostics.');
  if (response.model !== null && (!response.model || typeof response.model !== 'object'
      || !Array.isArray(response.model.elements))) throw new Error('Invalid native KerML load model.');
  return response;
}
function loadStatus(response) {
  return response.model && response.diagnostics.length === 0 ? 'available' : 'rejected';
}
export class PreparedDraftSession {
  constructor(execute) {
    this.execute = execute;
    this.epoch = 0;
    this.clear();
  }
  clear() {
    this.epoch += 1;
    this.original = null;
    this.source = null;
    this.version = null;
    this.preview = null;
    this.status = 'idle';
  }
  get active() { return this.original !== null; }
  invalidate() {
    this.epoch += 1;
    this.preview = null;
    this.status = 'unavailable';
  }
  async open(original, source, documentVersion) {
    // Validate before replacing the previous recipe. The worker's application
    // barrier clears executable state separately before entering this mode.
    version(documentVersion);
    const project = createPreparedDraftProject(original, source);
    this.clear();
    this.original = project.original;
    this.source = project.model;
    this.version = documentVersion;
    return this.analyze();
  }
  async change(source, documentVersion) {
    if (!this.active || source.uri !== this.source.uri) throw new Error('Document does not belong to the prepared draft.');
    version(documentVersion);
    if (documentVersion <= this.version) return this.inspect();
    // Build the bounded native request before accepting new source state.
    preparedDraftRequest(this.original, source);
    this.source = structuredClone(source);
    this.version = documentVersion;
    return this.analyze();
  }
  close(uri) {
    if (!this.active || uri !== this.source.uri) return false;
    this.clear();
    return true;
  }
  async analyze() {
    if (!this.active) throw new Error('No prepared draft source recipe.');
    const epoch = ++this.epoch;
    const request = preparedDraftRequest(this.original, this.source);
    this.preview = null;
    this.status = 'analyzing';
    try {
      const response = await this.execute(request);
      if (epoch !== this.epoch) throw new Error('Draft response is obsolete.');
      this.preview = nativeEnvelope(response, [this.source.uri]);
      this.status = loadStatus(response);
      return this.inspect();
    } catch (error) {
      if (epoch === this.epoch) { this.preview = null; this.status = 'unavailable'; }
      throw error;
    }
  }
  inspect() {
    if (!this.active) return null;
    return {kind: 'prepared_draft', uri: this.source.uri, version: this.version,
      generation: this.epoch, status: this.status, preview: this.preview,
      language_validated: false, publication_permitted: false};
  }
  project(presentation) {
    if (!this.active) throw new Error('No prepared draft source recipe.');
    return createPreparedDraftProject(this.original, this.source, presentation);
  }
}

// Shares the single-source epoch/invalidation transport. Every call executes the
// same native load; no model state is reconstructed in JavaScript.
export class PreparedPhysicalProjectSession extends PreparedDraftSession {
  clear() { super.clear(); this.sources = null; this.versions = new Map(); }
  get active() { return this.original !== null && this.sources !== null; }
  async open(original, sources, documentVersion) {
    version(documentVersion);
    const project = createPreparedPhysicalProject(original, sources);
    this.clear(); this.original = project.original; this.sources = project.sources;
    this.version = documentVersion;
    this.versions = new Map(this.sources.map(source => [source.uri, documentVersion]));
    return this.analyze();
  }
  async change(source, documentVersion) {
    if (!this.active || !this.versions.has(source.uri)) throw new Error('Document does not belong to the physical project.');
    version(documentVersion);
    if (documentVersion <= this.versions.get(source.uri)) return this.inspect();
    const sources = this.sources.map(old => old.uri === source.uri ? source : old);
    preparedPhysicalProjectRequest(this.original, sources);
    version(this.version + 1);
    this.sources = structuredClone(sources); this.versions.set(source.uri, documentVersion); this.version += 1;
    return this.analyze();
  }
  close(uri) {
    if (!this.active || !this.versions.has(uri)) return false;
    this.clear(); return true; // A closed resource invalidates the entire closed-input observation.
  }
  async analyze() {
    if (!this.active) throw new Error('No physical project source recipe.');
    const epoch = ++this.epoch;
    const request = preparedPhysicalProjectRequest(this.original, this.sources);
    this.preview = null; this.status = 'analyzing';
    try {
      const response = await this.execute(request);
      if (epoch !== this.epoch) throw new Error('Physical project response is obsolete.');
      this.preview = nativeEnvelope(response, this.sources.map(source => source.uri));
      this.status = loadStatus(response);
      return this.inspect();
    } catch (error) {
      if (epoch === this.epoch) { this.preview = null; this.status = 'unavailable'; }
      throw error;
    }
  }
  inspect() {
    if (!this.active) return null;
    return {kind: 'prepared_physical_project', version: this.version, generation: this.epoch,
      sources: this.sources.map(source => ({uri: source.uri, version: this.versions.get(source.uri)})),
      status: this.status, preview: this.preview, language_validated: false, publication_permitted: false};
  }
  project(presentation) {
    if (!this.active) throw new Error('No physical project source recipe.');
    return createPreparedPhysicalProject(this.original, this.sources, presentation);
  }
}
