import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { packageArchive } from '../src/package-export.js';
import { PYTHON_BINDING_VERSION } from '../src/python-api.js';
import { unpackLanguageArchive } from '../src/package-import.js';

const root = fileURLToPath(new URL('../.runtime/intersect-text/', import.meta.url));
const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
for (const args of [
  ['build', '-p', 'intersect-text-acceptance', '--example', 'compatibility_corpus', '--locked'],
  ['build', '-p', 'intersect-web', '--target', 'wasm32-unknown-unknown', '--locked'],
]) {
  const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit' });
  assert.equal(result.status, 0, result.error?.message);
}
const output = spawnSync(resolve(target, `debug/examples/compatibility_corpus${process.platform === 'win32' ? '.exe' : ''}`), [], { cwd: root, encoding: 'utf8', maxBuffer: 10_000_000 });
assert.equal(output.status, 0, output.stderr);
const corpus = JSON.parse(output.stdout);
const binary = readFileSync(resolve(target, 'wasm32-unknown-unknown/debug/intersect_web.wasm'));
async function runtime() {
  const { instance: { exports: e } } = await WebAssembly.instantiate(binary, {});
  return request => {
    const bytes = new TextEncoder().encode(JSON.stringify(request));
    const p = e.input_buffer(bytes.length); assert.ok(p, 'WASM request budget');
    new Uint8Array(e.memory.buffer, p, bytes.length).set(bytes);
    const length = e.execute();
    const value = JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.output_buffer(), length)));
    if (value.error) throw new Error(value.error);
    return value;
  };
}
function normalized(schema, model) {
  const ids = new Map(model.elements.map(e => [e.id, `${schema.uri}#//${e.class}:${e.values.name}`]));
  assert.equal(new Set(ids.values()).size, model.elements.length, 'comparison must be bijective');
  const features = name => Object.assign({}, ...schema.classes[name].parents.map(features), schema.classes[name].features);
  return Object.fromEntries(model.elements.map(e => [ids.get(e.id), Object.fromEntries(Object.entries(e.values).map(([name, value]) => {
    if (!features(e.class)[name].reference || value === null) return [name, value];
    const ref = id => { assert.ok(ids.has(id), `unresolved ${id}`); return ids.get(id); };
    return [name, Array.isArray(value) ? value.map(ref) : ref(value)];
  }))]));
}

for (const python of [false, true]) test(`real language ZIP -> verified WASM import -> text/dynamic equivalence -> XMI ZIP (Python ${python})`, async () => {
  const archive = await packageArchive(corpus.distribution, python);
  assert.deepEqual(await packageArchive(corpus.distribution, python), archive, 'deterministic archive');
  const files = unpackLanguageArchive(archive);
  const invoke = await runtime();
  const loaded = invoke({ method: 'package/import', files });
  assert.deepEqual(loaded.package, corpus.distribution.package);
  assert.deepEqual(loaded.package.sources, corpus.distribution.package.sources);
  for (const c of corpus.cases) {
    const evaluated = invoke({ method: 'evaluate', package: loaded.package, sources: c.sources });
    assert.deepEqual(evaluated.diagnostics, []);
    assert.deepEqual(evaluated.model, c.model, `native/WASM text seed ${c.seed}`);
    assert.deepEqual(normalized(loaded.package.schema, evaluated.model), c.normalized);
    assert.deepEqual(normalized(c.dynamic_schema, c.dynamic), c.normalized);
    assert.notEqual(c.dynamic.schema_revision, evaluated.model.schema_revision);
    const exported = invoke({ method: 'model/export', format: 'xmi', package: loaded.package, model: evaluated.model });
    const zipped = zipSync(Object.fromEntries(exported.resources.map(r => [r.uri, new Uint8Array(r.bytes)])));
    const resources = Object.entries(unzipSync(zipped)).reverse().map(([uri, bytes]) => ({ uri, bytes: [...bytes] }));
    const imported = invoke({ method: 'model/import', format: 'xmi', package: loaded.package, resources });
    assert.deepEqual(imported.diagnostics, []);
    assert.deepEqual(imported.model, evaluated.model, `exact XMI identity/provenance seed ${c.seed}`);
    assert.deepEqual(imported.derived, evaluated.derived);
  }
});

test('archive tampering, stale IR and incompatible profiles fail before execution', async () => {
  const files = unpackLanguageArchive(await packageArchive(corpus.distribution, false));
  const invoke = await runtime();
  const sha = text => createHash('sha256').update(text).digest('hex');
  for (const mutation of ['source', 'ir', 'profile', 'version', 'future-version', 'revision', 'extra', 'missing', 'unknown-manifest-field']) {
    const damaged = structuredClone(files); const manifest = JSON.parse(damaged['manifest.json']);
    assert.ok(manifest.definitions.bundle in damaged, 'canonical compilation bundle is present');
    if (mutation === 'source') {
      const compilation = JSON.parse(damaged[manifest.definitions.bundle]);
      const source = compilation.bundle.sources.find(source => source.kind === 'rcore');
      assert.ok(source, 'canonical Rcore source is present');
      source.text += '\n';
      damaged[manifest.definitions.bundle] = JSON.stringify(compilation);
    }
    if (mutation === 'ir') {
      const ir = JSON.parse(damaged['package.json']); ir.schema.classes.Node.features.count.default = 99;
      damaged['package.json'] = JSON.stringify(ir);
      manifest.files['package.json'] = { bytes: Buffer.byteLength(damaged['package.json']), sha256: sha(damaged['package.json']) };
    }
    if (mutation === 'profile') manifest.runtime.profile = 'unknown';
    if (mutation === 'version') manifest.format_version = 1;
    if (mutation === 'future-version') manifest.format_version += 1;
    if (mutation === 'revision') manifest.revision = 'sha256:bad';
    if (mutation === 'extra') damaged['extra.txt'] = 'not inventoried';
    if (mutation === 'missing') delete damaged[manifest.definitions.bundle];
    if (mutation === 'unknown-manifest-field') manifest.executable_delegate = 'not supported';
    damaged['manifest.json'] = JSON.stringify(manifest);
    assert.throws(() => invoke({ method: 'package/import', files: damaged }), undefined, mutation);
  }
});

test('ZIP extraction rejects traversal, duplicates, oversized expansion and invalid UTF-8', () => {
  assert.equal(unpackLanguageArchive(zipSync({ 'bom.txt': strToU8('\ufeffexact source') }))['bom.txt'], '\ufeffexact source');
  for (const path of ['../escape', '/absolute', 'a/./b', 'a\\b', 'C:drive']) assert.throws(() => unpackLanguageArchive(zipSync({ [path]: strToU8('x') })), /path/);
  assert.throws(() => unpackLanguageArchive(zipSync({ 'large.txt': new Uint8Array(2_000_001) })), /limits/);
  assert.throws(() => unpackLanguageArchive(zipSync(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`${i}.txt`, strToU8('x')])))), /limits/);
  assert.throws(() => unpackLanguageArchive(zipSync({ 'bad.txt': new Uint8Array([255]) })), /encoded data|encoding/i);
  const bytes = Buffer.from(zipSync({ 'a.txt': strToU8('a'), 'b.txt': strToU8('b') }));
  let at = 0; while ((at = bytes.indexOf('b.txt', at)) !== -1) { bytes.write('a.txt', at); at += 5; }
  assert.throws(() => unpackLanguageArchive(bytes), /Duplicate/);
  assert.throws(() => unpackLanguageArchive(new Uint8Array([1, 2, 3])));
});

test('pinned upstream fixture bytes match recorded provenance', () => {
  const directory = resolve(root, 'fixtures/compatibility/upstream');
  const provenance = JSON.parse(readFileSync(resolve(directory, 'provenance.json')));
  assert.equal(provenance.files.length, 14);
  for (const f of provenance.files) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(directory, f.file))).digest('hex'), f.sha256, f.file);
    assert.equal(f.modified, false); assert.match(f.commit, /^[a-f0-9]{40}$/);
  }
});

test('cached independent EMF observations retain their file and oracle provenance', () => {
  const directory = resolve(root, 'fixtures/compatibility/emf-oracle');
  const provenance = JSON.parse(readFileSync(resolve(directory, 'provenance.json')));
  const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(provenance.cases_verified, 16);
  for (const f of provenance.files) assert.equal(digest(resolve(directory, f.file)), f.sha256, f.file);
  assert.equal(digest(resolve(root, provenance.oracle)), provenance.oracle_sha256);
  assert.equal(digest(resolve(root, 'fixtures/compatibility/graph.ecore')), provenance.schema_sha256);
});


test('Python binding metadata accepts the current generator and rejects unknown contracts', async () => {
  const files = unpackLanguageArchive(await packageArchive(corpus.distribution, true));
  const invoke = await runtime();
  assert.equal(invoke({ method: 'package/import', files }).manifest.python.version, PYTHON_BINDING_VERSION);
  for (const [key, value] of [
    ['version', 0], ['version', PYTHON_BINDING_VERSION + 1], ['generator', 'unknown'],
    ['revision', 'wrong'], ['host_api', 'intersect.script.v2'],
    ['source', 'absent.py'], ['stub', 'python/intersect_api.py'],
  ]) {
    const damaged = structuredClone(files);
    const manifest = JSON.parse(damaged['manifest.json']);
    manifest.python[key] = value;
    damaged['manifest.json'] = JSON.stringify(manifest);
    assert.throws(() => invoke({ method: 'package/import', files: damaged }), /Python binding metadata/, `${key}=${value}`);
  }
});


test('Rcore collection validation preserves the per-target loan bound in real WASM', async () => {
  const fixture = name => readFileSync(resolve(root, 'fixtures/library', name), 'utf8');
  const invoke = await runtime();
  const xml = fixture('library.ecore').replace('name="copy" lowerBound="1"', 'name="copy" lowerBound="1" upperBound="-1"');
  const migration = invoke({method:'ecore/migrate',uri:'memory:library.ecore',text:xml,target_uri:'memory:library.rcore'});
  assert.equal(migration.ok, true);
  assert.equal(migration.report.original.text, xml);
  const rcore_behavior = fixture('library-behavior.rcore').replace(
    'size(incoming::<m.`Loan`>(self.`copy`, "copy")) <= 1',
    'forAll(self.copy, |copy:m.BookCopy| size(incoming::<m.Loan>(copy, "copy")) <= 1)',
  );
  const params = {method:'compile_rcore',rcore:migration.report.converted.text,
    xtext:fixture('library.xtext').replace('copy=[lib::BookCopy|ID]', "copy+=[lib::BookCopy|ID] (',' copy+=[lib::BookCopy|ID])*"), rcore_behavior};
  const compiled = invoke(params);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  const sources = [{uri:'loan',text:'library Loans { loan both copy second,first to reader; }'},
    {uri:'catalog',text:'library Catalog { copy first "First"; copy second "Second"; member reader; }'}];
  const valid = invoke({method:'evaluate',package:compiled.package,sources});
  assert.deepEqual(valid.diagnostics, []);
  assert.deepEqual(valid.model.elements.find(e=>e.id==='loan#1').values.copy,['catalog#2','catalog#1']);
  sources[0].text = 'library Loans { loan both copy second,first to reader; loan duplicate copy first to reader; }';
  const invalid = invoke({method:'evaluate',package:compiled.package,sources});
  assert.equal(invalid.diagnostics.length, 2);
  assert.ok(invalid.diagnostics.every(d=>d.message==='A book copy cannot have more than one active loan.'));
  const nonunique = invoke({method:'ecore/migrate',uri:'memory:library.ecore',text:xml.replace('name="copy"','name="copy" unique="false"'),target_uri:'memory:library.rcore'});
  assert.equal(nonunique.ok, true);
  const unsupported = invoke({...params,rcore:nonunique.report.converted.text});
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.diagnostics.some(d=>d.message.includes('requires a unique reference')));
  const mismatched = invoke({...params,rcore_behavior:rcore_behavior.replace('incoming::<m.Loan>(copy,','incoming::<m.Loan>(if true { copy } else { copy },')});
  assert.equal(mismatched.ok, false);
  assert.ok(mismatched.diagnostics.some(d=>d.message.includes('Validation must count')));
});
