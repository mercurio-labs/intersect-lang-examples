import {migrateDefinitionFixture} from './migration-fixtures.js';
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const cwd = new URL('../.runtime/intersect-text/', import.meta.url);
const source = (uri, kind, text, dependencies = []) => {
  const original = {id:{uri,sha256:createHash('sha256').update(text).digest('hex')},kind,text,dependencies};
  return kind === 'ecore' ? migrateDefinitionFixture(original, native) : original;
};
const scalar = (name, payload) => ({ ty: { Scalar: name }, payload });
const request = (body, args = []) => {
  const src = source('memory:scalar-behavior.rcore', 'rcore_behavior', `rcore 1; package scalar version "1"; ${body}`);
  return { bundle: { version: 1, sources: [src], namespaces: [] }, entry: src.id, selected: { source: src.id, declaration: 0 }, arguments: args };
};
const native = params => JSON.parse(execFileSync(process.env.INTERSECT_TEST_NATIVE_ORACLE || 'cargo', process.env.INTERSECT_TEST_NATIVE_ORACLE ? [] : ['run', '-q', '-p', 'intersect-web', '--example', 'rcore_behavior_parse', '--locked'], { cwd, input: JSON.stringify({ method: 'rcore_behavior/evaluateScalar', ...params }), encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
async function parity(page, params, ok = true) {
  const response = await page.evaluate(params => window.workbench.request('intersect/evaluateScalarRcore', params), params);
  expect(response).toEqual(native(params)); expect(response.ok).toBe(ok); expect(response.source_backed).toBe(true);
  return response;
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('#compile-status')).toContainText('Language compiled', { timeout: 30000 }); });

test('every scalar transports exact arguments and results through native and WASM', async ({ page }) => {
  test.setTimeout(180000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const cases = [
    ['Bool', true], ['String', 'e\u0301😀'], ['Bytes', { kind: 'bytes', hex: '00ABFF' }],
    ['Char16', { kind: 'char16', unit: 55296 }], ['DateInstant', { kind: 'date', milliseconds: '-9223372036854775808' }], ['Unit', { kind: 'unit' }],
    ['Int8', -128], ['Int16', -32768], ['Int32', -2147483648], ['Int64', { kind: 'int64', value: '-9223372036854775808' }],
    ['UInt8', 255], ['UInt16', 65535], ['UInt32', 4294967295], ['UInt64', { kind: 'uint64', value: '18446744073709551615' }],
    ['BigInt', { kind: 'bigint', value: '123456789012345678901234567890' }], ['Decimal', { kind: 'decimal', coefficient: '1234567890123456789012300', scale: 4 }],
    ['Float32', { kind: 'float32', bits: '7fc01234' }], ['Float64', { kind: 'float64', bits: '8000000000000000' }],
  ];
  for (const [name, payload] of cases) {
    const value = scalar(name, payload);
    const response = await parity(page, request(`fn main(x:${name})->${name}=x;`, [value]));
    expect(response.evaluation.value).toEqual(value);
    const comparison = await parity(page, request(`fn main(x:${name},y:${name})->Bool=x==y;`, [value, value]));
    expect(comparison.evaluation.value.payload).toBe(name !== 'Float32');
  }
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('all numeric domains execute arithmetic with exact cross-host results', async ({ page }) => {
  test.setTimeout(180000);
  const cases = [
    ['Int8', 7], ['Int16', 7], ['Int32', 7], ['Int64', { kind: 'int64', value: '7' }],
    ['UInt8', 7], ['UInt16', 7], ['UInt32', 7], ['UInt64', { kind: 'uint64', value: '7' }],
    ['BigInt', { kind: 'bigint', value: '7' }], ['Decimal', { kind: 'decimal', coefficient: '7', scale: 0 }],
    ['Float32', { kind: 'float32', bits: '40e00000' }], ['Float64', { kind: 'float64', bits: '401c000000000000' }],
  ];
  for (const [name, payload] of cases) {
    const response = await parity(page, request(`fn main(x:${name})->${name}=((x+2)*3-1)/2%10;`, [scalar(name, payload)]));
    expect(response.evaluation.value.ty).toEqual({ Scalar: name });
  }
  for (const [name, expected] of [['Float32', '7fc00000'], ['Float64', '7ff8000000000000']]) {
    const response = await parity(page, request(`fn main()->${name}=0/0;`));
    expect(response.evaluation.value.payload.bits).toBe(expected);
  }
  const exact = await parity(page, request('fn main()->Decimal=1/8;'));
  expect(exact.evaluation.value.payload).toEqual({ kind: 'decimal', coefficient: '125', scale: 3 });
  await parity(page, request('fn main()->Decimal=1/3;'), false);
  await parity(page, request('fn main()->Int8=127+1;'), false);
});

test('short circuit scalar matches and nested live values execute selected branches', async ({ page }) => {
  test.setTimeout(120000);
  for (const [body, args, expected] of [
    ['fn main()->Bool=false && (1/0==0);', [], false],
    ['fn main()->Bool=true || (1/0==0);', [], true],
    ['fn main(flag:Bool)->Int8=10+(if flag {4}else{1/0})*2;', [scalar('Bool', true)], 18],
    ['fn main(x:Int8)->Int8=match x {0=>1, rest=>if rest>0 {rest+1}else{rest-1}};', [scalar('Int8', 4)], 5],
    ['fn main(x:Decimal)->Bool=match x {1=>true,_=>false};', [scalar('Decimal', { kind: 'decimal', coefficient: '100', scale: 2 })], true],
    ['fn main(x:Float64)->Bool=match x {0=>true,_=>false};', [scalar('Float64', { kind: 'float64', bits: '8000000000000000' })], true],
  ]) {
    const response = await parity(page, request(body, args)); expect(response.evaluation.value.payload).toEqual(expected);
  }
  const bits = { kind: 'float64', bits: 'fff0000000000001' };
  const nan = await parity(page, request('fn main(x:Float64)->Float64=match x {0=>1,rest=>rest};', [scalar('Float64', bits)]));
  expect(nan.evaluation.value.payload).toEqual(bits);
  const failing = await parity(page, request('fn main()->Int8=if false {1}else{1/0};'), false);
  expect(failing.failure.arithmetic_kind).toBe('division_by_zero'); expect(failing.failure.span.end).toBeGreaterThan(failing.failure.span.start);
  await parity(page, request('fn main()->Int8=if true {1}else{{let x=2;x}};'), false);
});

test('fresh scalar replay and budget failures preserve the active language and recover', async ({ page }) => {
  test.setTimeout(120000);
  const initial = await page.evaluate(() => window.workbench.inspect());
  const input = request('fn main(x:Int8)->Int8=x+1;', [scalar('Int8', 3)]);
  const first = await parity(page, input);
  expect(await parity(page, { ...input, expected_program: first.program })).toEqual(first);
  const forged = structuredClone(first.program); forged.blocks[0].instructions[0].kind.Constant.payload = 9;
  const replay = await parity(page, { ...input, expected_program: forged }, false); expect(replay.stage).toBe('scalar_replay');
  const limits = { max_steps: 0, max_value_bytes: 4194304, values: { max_value_bytes: 262144, max_digits: 4096 }, numeric: { max_digits: 4096, max_intermediate_digits: 8192, max_scale_alignment: 4096, max_value_bytes: 262144, max_total_value_bytes: 1048576, max_work: 16777216 } };
  const exhausted = await parity(page, { ...input, execution_limits: limits }, false); expect(exhausted.failure.kind).toBe('ResourceExhausted');
  const malformed = structuredClone(input); malformed.arguments[0].payload = 128; await parity(page, malformed, false);
  expect(await parity(page, input)).toEqual(first);
  expect(await page.evaluate(() => window.workbench.inspect())).toEqual(initial);
});

test('nominal enum aliases execute with exact identities and fresh replay', async ({ page }) => {
  test.setTimeout(120000);
  const model = source('memory:scalar.ecore', 'ecore', '<e:EPackage xmlns:e="http://www.eclipse.org/emf/2002/Ecore" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" name="m" nsURI="urn:scalar"><eClassifiers x:type="e:EEnum" name="Mode"><eLiterals name="First" value="0"/><eLiterals name="Alias" value="0"/></eClassifiers></e:EPackage>');
  const enumRequest = (body, args = []) => {
    const src = source('memory:enum-behavior.rcore', 'rcore_behavior', `rcore 1; package enums version "1"; import model "urn:scalar" as m; ${body}`, [model.id]);
    return { bundle: { version: 1, sources: [model, src], namespaces: [] }, entry: src.id, selected: { source: src.id, declaration: 1 }, arguments: args };
  };
  const first = (await parity(page, enumRequest('fn main()->m.Mode=m.Mode.First;'))).evaluation.value;
  const alias = (await parity(page, enumRequest('fn main()->m.Mode=m.Mode.Alias;'))).evaluation.value;
  expect(first).not.toEqual(alias);
  const equality = await parity(page, enumRequest('fn main(a:m.Mode,b:m.Mode)->Bool=a==b;', [first, alias]));
  expect(equality.evaluation.value.payload).toBe(false);
  const input = enumRequest('fn main(x:m.Mode)->m.Mode=match x {m.Mode.First=>m.Mode.Alias,m.Mode.Alias=>m.Mode.First};', [first]);
  const result = await parity(page, input); expect(result.evaluation.value).toEqual(alias);
  input.bundle.sources.reverse(); expect(await parity(page, { ...input, expected_program: result.program })).toEqual(result);
  const bad = structuredClone(input); bad.arguments[0].payload.extra = 'forged'; await parity(page, bad, false);
  for (const identity of ['enumeration', 'literal']) {
    const nested = structuredClone(input); nested.arguments[0].payload[identity].verified = true;
    const rejected = await parity(page, nested, false); expect(rejected.failure.kind).toBe('Arguments');
  }

});
