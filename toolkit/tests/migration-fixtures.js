// Qualification-only adapters. Imported oracle fixtures are converted explicitly
// before exercising canonical Rcore consumers; these methods are never sent to
// the production dispatcher.
export function migratedFixtureRequest(request, invoke) {
  if (!['fixture/compile', 'fixture/compileBundle', 'fixture/export'].includes(request.method)) return {request};
  let compilation = request.compilation;
  if (compilation) {
    const targets = compilation.bundle.sources.filter(s=>s.kind==='ecore').map(s=>({source:s.id,uri:s.id.uri+'.rcore'}));
    if (targets.length) {
      const migrated = invoke({method:'ecore/migrateCompilation',compilation,targets});
      if (!migrated.ok) return {result:migrated};
      compilation = migrated.compilation;
    }
    if (request.method === 'fixture/compileBundle') return {request:{...request,method:'compile_bundle',compilation}};
  }
  if (!compilation) {
    const migrated = invoke({method:'ecore/migrate',uri:'memory:ecore',text:request.ecore,target_uri:'memory:model.rcore'});
    if (!migrated.ok) return {result:migrated};
    const {ecore, ...options} = request;
    const key = declaration => JSON.stringify([declaration.source.uri,declaration.source.sha256,declaration.path]);
    const declarations = new Map(migrated.report.correspondence.map(row => [key(row.original), row.converted]));
    const remap = value => {
      if (Array.isArray(value)) return value.map(remap);
      if (!value || typeof value !== 'object') return value;
      if (value.source && Array.isArray(value.path)) {
        const found = declarations.get(key(value));
        if (found) return found;
      }
      return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,remap(item)]));
    };
    const canonical = {...remap(options), method:'compile_rcore', rcore:migrated.report.converted.text};
    if (request.method === 'fixture/compile') return {request:canonical};
    const compiled = invoke(canonical);
    if (!compiled.ok) return {result:compiled};
    compilation = compiled.package.compilation;
  }
  return {request:{...request, method:'package/export', compilation}};
}

// Explicit oracle-fixture adapter for browser tests. Production dispatch never
// accepts these fixture methods or compiles the original Ecore source.
export async function loadFixtureRuntime() {
  const {loadRuntime} = await import('../src/runtime.js');
  const invoke = await loadRuntime();
  return request => {
    const prepared = migratedFixtureRequest(request, invoke);
    return prepared.result ?? invoke(prepared.request);
  };
}

// Fixture construction remains explicit so executable tests cannot accidentally
// exercise an Ecore compilation path. Keep declaration correspondence outside
// serialized sources; malformed IDs used by negative tests are preserved.
const fixtureCorrespondence = new Map();
export function migrateDefinitionFixture(original, invoke) {
  const migrated = invoke({method:'ecore/migrate',uri:original.id.uri,text:original.text,target_uri:original.id.uri+'.rcore'});
  if (!migrated.ok) throw new Error(JSON.stringify(migrated));
  // Reference-context digests use the typed serializer's field order.
  const identity = id => ({uri:id.uri,sha256:id.sha256});
  const result = migrated.report.converted;
  const converted = {id:identity(result.id),kind:result.kind,text:result.text,dependencies:result.dependencies.map(identity)};
  fixtureCorrespondence.set(JSON.stringify(converted.id), new Map(migrated.report.correspondence.map(row=>[JSON.stringify(row.original.path),{source:identity(row.converted.source),path:row.converted.path}])));
  return converted;
}
export function fixtureDeclaration(source, path) {
  return fixtureCorrespondence.get(JSON.stringify(source.id))?.get(JSON.stringify(path)) ?? {source:source.id,path};
}
