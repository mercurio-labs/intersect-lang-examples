import {migrateDefinitionFixture,fixtureDeclaration} from './migration-fixtures.js';
const nativeFixture = request => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run','-q','-p','intersect-web','--example','rcore_behavior_parse','--locked'], {cwd:new URL('../.runtime/intersect-text/',import.meta.url),input:JSON.stringify(request),encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024}));
function definitionFixture(uri,kind,text,dependencies=[]) {
  const original={id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies};
  return kind==='ecore' ? migrateDefinitionFixture(original,nativeFixture) : original;
}
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('installed sequence aliases preserve nested defaults and source replay in WASM', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 });
  const definition = definitionFixture;
  const source = definition('memory:wildcard-defaults.ecore', 'ecore', readFileSync(new URL('../.runtime/intersect-text/fixtures/ecore-generics/wildcard-defaults.ecore', import.meta.url), 'utf8'));
  const id = n => (fixtureDeclaration(source, [n]));
  const type = (n, args = []) => ({ kind: 'classifier', declaration: id(n), arguments: args, raw: false });
  const native = request => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd: new URL('../.runtime/intersect-text/', import.meta.url), input: JSON.stringify(request), encoding: 'utf8', timeout: 90000 }));
  for (const diamond of [false, true]) {
    const name = diamond ? 'Diamond' : 'Defaults';
    const grammar = definition('memory:wildcard-defaults.xtext', 'xtext', `grammar example.Defaults import "urn:wildcard-defaults" as d Root returns d::${name}: 'root' name=ID ('values' values=STRING)?;`, [source.id]);
    const semantics = definition('memory:wildcard-defaults-behavior.rcore', 'rcore_behavior', 'rcore 1; package emptyRules version "1";', [source.id]);
    const bundle = { version: 1, sources: [source, grammar, semantics], namespaces: [] };
    const applied = (n, argument, member) => ({ application: type(n, [argument]), conversion: { datatype: id(n), provider: { name: 'intersect.sequence', version: '1' }, serializable: true, declarations: [], members: [{ nullable: false, value: member }] } });
    const sequence = applied(2, type(0), { kind: 'datatype', declaration: id(0) });
    const alias = applied(3, type(0), { kind: 'datatype', declaration: id(0) });
    const envelope = applied(4, alias.application, { kind: 'applied', contract: alias });
    const constructors = [];
    if (!diamond) {
      for (const n of [2, 3]) {
        const request = { bundle, datatype: id(n), provider: { name: 'intersect.sequence.constructor', version: '1' } };
        const result = await page.evaluate(p => window.workbench.request('intersect/constructorContract', p), request);
        expect(result).toEqual(native({ method: 'conversion/constructor', ...request }));
        expect(result.ok).toBe(true);
        constructors.push(result.contract);
      }
    }
    const compilation = { bundle, ecore: source.id, namespace: 'urn:wildcard-defaults', xtext: grammar.id, rcore_behavior: semantics.id, materialized_types: [type(diamond ? 8 : 9)] };
    const request = { compilation, applied_conversions: diamond ? [sequence] : [envelope], constructors };
    const compiled = await page.evaluate(p => window.workbench.request('intersect/compileBundle', p), request);
    const expected = native({ method: 'compile_bundle', ...request });
    expect(compiled.ok).toBe(true);
    expect(compiled.package).toEqual(expected.package);
    const sources = await page.evaluate(() => {
      window.workbench.modelModels.catalog.setValue('root First');
      window.workbench.modelModels.loans.setValue('root Second');
      return Object.values(window.workbench.modelModels).map(m => ({ uri: m.uri.toString(), text: m.getValue() }));
    });
    await expect(page.locator('#element-count')).toHaveText('2 elements');
    await expect(page.locator('#diagnostic-list')).toContainText('All checks passed');
    const active = await page.evaluate(() => window.workbench.inspect());
    expect(active.evaluation).toEqual(native({ method: 'evaluate', package: compiled.package, sources }));
    for (const element of active.evaluation.model.elements) expect(element.values.values.application).toEqual(diamond ? sequence.application : envelope.application);
    const retained = JSON.parse(JSON.stringify(compiled.package));
    const replay = await page.evaluate(p => window.workbench.request('intersect/compileBundle', p), { compilation: retained.compilation, conversions: retained.schema.conversion_contracts, applied_conversions: retained.schema.applied_conversion_contracts, constructors: retained.schema.constructor_contracts });
    expect(replay.package).toEqual(retained);
    if (!diamond) {
      const rejected = await page.evaluate(p => window.workbench.request('intersect/compileBundle', p), { ...request, constructors: [] });
      expect(rejected.ok).toBe(false);
      expect(rejected.package).toBeUndefined();
    }
  }
});
