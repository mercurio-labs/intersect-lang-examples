// Handwritten host envelope only. Rust owns source identity and all semantics.
export const PREPARED_DRAFT_FORMAT = 'intersect.toolkit.project.v7';
export const PREPARED_DRAFT_MODE = 'prepared-draft';
export const PREPARED_DRAFT_LIMITS = Object.freeze({
  project: 2_000_000, request: 4_000_000, originals: 1_000_000,
  model: 256_000, response: 3_000_000, work: 10_000_000, watchdog: 120_000,
});
const encoder = new TextEncoder();
const bytes = text => encoder.encode(text).length;
function record(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !fields.includes(key))) throw new Error(`Invalid ${label}.`);
}
function identity(value) {
  record(value, ['uri', 'sha256'], 'original source identity');
  if (typeof value.uri !== 'string' || !value.uri || typeof value.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid original source identity.');
}
export function validatePreparedDraftOriginal(original) {
  record(original, ['bundle', 'ecore', 'xtext', 'rcore_behavior', 'namespace', 'materialized_types'], 'original draft recipe');
  if (typeof original.namespace !== 'string' || !Array.isArray(original.materialized_types)
      || original.materialized_types.length !== 0) throw new Error('Invalid original draft roles.');
  for (const role of ['ecore', 'xtext', 'rcore_behavior']) identity(original[role]);
  const bundle = original.bundle;
  record(bundle, ['version', 'sources', 'namespaces'], 'original definition bundle');
  if (bundle.version !== 1 || !Array.isArray(bundle.sources) || bundle.sources.length !== 4
      || !Array.isArray(bundle.namespaces)) throw new Error('Draft requires four original definition sources.');
  let total = 0;
  for (const source of bundle.sources) {
    record(source, ['id', 'kind', 'text', 'dependencies'], 'original definition source');
    identity(source.id);
    if (!['ecore', 'xtext', 'rcore_behavior'].includes(source.kind) || typeof source.text !== 'string'
        || !Array.isArray(source.dependencies)) throw new Error('Invalid original definition source.');
    source.dependencies.forEach(identity);
    total += bytes(source.text);
    if (total > PREPARED_DRAFT_LIMITS.originals) throw new Error('Draft original source byte budget exceeded.');
  }
  for (const binding of bundle.namespaces) {
    record(binding, ['namespace', 'source'], 'original namespace binding');
    if (typeof binding.namespace !== 'string') throw new Error('Invalid original namespace binding.');
    identity(binding.source);
  }
  // Preserve the complete recipe. Content hashes, dependency closure and selected
  // roles are checked again by the actual registered native language facade.
  return original;
}
export function validatePreparedDraftModel(model) {
  record(model, ['uri', 'text'], 'draft model source');
  if (typeof model.uri !== 'string' || !model.uri || typeof model.text !== 'string') throw new Error('Invalid draft model source.');
  if (bytes(model.text) > PREPARED_DRAFT_LIMITS.model) throw new Error('Draft model source byte budget exceeded.');
  return model;
}
export function validatePreparedDraftProject(value) {
  record(value, ['format', 'mode', 'original', 'model', 'presentation'], 'prepared draft project');
  if (value.format !== PREPARED_DRAFT_FORMAT || value.mode !== PREPARED_DRAFT_MODE) throw new Error('Unsupported prepared draft project format.');
  if (bytes(JSON.stringify(value)) > PREPARED_DRAFT_LIMITS.project) throw new Error('Project exceeds the 2 MB limit.');
  validatePreparedDraftOriginal(value.original);
  validatePreparedDraftModel(value.model);
  record(value.presentation, ['activeSource'], 'draft presentation');
  const active = value.presentation.activeSource;
  if (typeof active !== 'string' || ![value.model.uri, ...value.original.bundle.sources.map(source => source.id.uri)].includes(active)) throw new Error('Invalid draft presentation source.');
  return value;
}
export function createPreparedDraftProject(original, model, presentation = {activeSource: model.uri}) {
  return structuredClone(validatePreparedDraftProject({
    format: PREPARED_DRAFT_FORMAT, mode: PREPARED_DRAFT_MODE, original, model, presentation,
  }));
}
export function encodePreparedDraftProject(value) {
  const text = JSON.stringify(validatePreparedDraftProject(value), null, 2) + '\n';
  if (bytes(text) > PREPARED_DRAFT_LIMITS.project) throw new Error('Project exceeds the 2 MB limit.');
  return text;
}
export function decodePreparedDraftProject(text) {
  if (typeof text !== 'string' || bytes(text) > PREPARED_DRAFT_LIMITS.project) throw new Error('Project exceeds the 2 MB limit.');
  return validatePreparedDraftProject(JSON.parse(text));
}
export function preparedDraftRequest(original, source, {work} = {}) {
  validatePreparedDraftOriginal(original);
  validatePreparedDraftModel(source);
  if (work !== undefined && (!Number.isSafeInteger(work) || work < 0 || work > PREPARED_DRAFT_LIMITS.work)) throw new Error('Invalid draft work grant.');
  const value = {method: 'draft/kerml/analyze', original, source, ...(work === undefined ? {} : {work})};
  if (bytes(JSON.stringify(value)) > PREPARED_DRAFT_LIMITS.request) throw new Error('Draft request byte budget exceeded.');
  return value;
}

// Explicit source-only multi-resource sibling; this data installs no authority.
export const PREPARED_PHYSICAL_PROJECT_FORMAT = 'intersect.toolkit.project.v8';
export const PREPARED_PHYSICAL_PROJECT_MODE = 'prepared-physical-project';
// The native frozen-engine KerML load (construction and parse diagnostics).
export const FROZEN_KERML_PROJECT_MODE = 'frozen-kerml-load.v1';
function exactUnicode(text) {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Unpaired UTF-16 source surrogate.');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error('Unpaired UTF-16 source surrogate.');
  }
}
export function validatePreparedPhysicalSources(sources) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 8) throw new Error('Physical project requires 1 to 8 sources.');
  const uris = new Set();
  let total = 0;
  for (const source of sources) {
    validatePreparedDraftModel(source);
    exactUnicode(source.uri); exactUnicode(source.text);
    if (uris.has(source.uri)) throw new Error('Duplicate physical project raw source URI.');
    uris.add(source.uri); // Deliberately no URL parsing, trimming or normalization.
    total += bytes(source.text);
    if (total > PREPARED_DRAFT_LIMITS.model) throw new Error('Physical project total UTF-8 model byte budget exceeded.');
  }
  return sources;
}
export function isPreparedPhysicalProject(value) {
  return value?.format === PREPARED_PHYSICAL_PROJECT_FORMAT;
}
export function validatePreparedPhysicalProject(value) {
  record(value, ['format', 'mode', 'original', 'sources', 'presentation'], 'physical draft project');
  if (value.format !== PREPARED_PHYSICAL_PROJECT_FORMAT || value.mode !== PREPARED_PHYSICAL_PROJECT_MODE) throw new Error('Unsupported physical draft project format.');
  if (bytes(JSON.stringify(value)) > PREPARED_DRAFT_LIMITS.project) throw new Error('Project exceeds the 2 MB limit.');
  validatePreparedDraftOriginal(value.original);
  validatePreparedPhysicalSources(value.sources);
  record(value.presentation, ['activeSource'], 'physical draft presentation');
  if (![...value.sources.map(source => source.uri), ...value.original.bundle.sources.map(source => source.id.uri)].includes(value.presentation.activeSource)) throw new Error('Invalid physical draft presentation source.');
  return value;
}
export function createPreparedPhysicalProject(original, sources, presentation = {activeSource: sources?.[0]?.uri}) {
  return structuredClone(validatePreparedPhysicalProject({format: PREPARED_PHYSICAL_PROJECT_FORMAT,
    mode: PREPARED_PHYSICAL_PROJECT_MODE, original, sources, presentation}));
}
export function encodePreparedDraftSourceProject(value) {
  if (!isPreparedPhysicalProject(value)) return encodePreparedDraftProject(value);
  const text = JSON.stringify(validatePreparedPhysicalProject(value), null, 2) + '\n';
  if (bytes(text) > PREPARED_DRAFT_LIMITS.project) throw new Error('Project exceeds the 2 MB limit.');
  return text;
}
export function decodePreparedDraftSourceProject(text) {
  if (typeof text !== 'string' || bytes(text) > PREPARED_DRAFT_LIMITS.project) throw new Error('Project exceeds the 2 MB limit.');
  const value = JSON.parse(text);
  return isPreparedPhysicalProject(value) ? validatePreparedPhysicalProject(value) : validatePreparedDraftProject(value);
}
export function preparedPhysicalProjectRequest(original, sources, {work} = {}) {
  validatePreparedDraftOriginal(original); validatePreparedPhysicalSources(sources);
  if (work !== undefined && (!Number.isSafeInteger(work) || work < 0 || work > PREPARED_DRAFT_LIMITS.work)) throw new Error('Invalid physical project work grant.');
  const value = {method: 'draft/kerml/project/analyze', version: 1, mode: FROZEN_KERML_PROJECT_MODE,
    original, sources, ...(work === undefined ? {} : {work})};
  if (bytes(JSON.stringify(value)) > PREPARED_DRAFT_LIMITS.request) throw new Error('Physical project request byte budget exceeded.');
  return value;
}
