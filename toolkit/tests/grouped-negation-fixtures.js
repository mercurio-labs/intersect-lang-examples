// Exact retained source recipes and successful full-oracle resources only.
// Native compilation owns all operand projection, binding and execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundleSourceSnapshot} from '../src/bundle-project.js';
export const profile = 'intersect.xtext.native.v62';
export const fixtures = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/grouped-terminal-negation/expanded-native-cases.json', import.meta.url), 'utf8'));
export const positive = JSON.parse(readFileSync(new URL('../.runtime/intersect-text/fixtures/xtext/grouped-terminal-negation/expanded-positive-resources.json', import.meta.url), 'utf8'));
export function get(id) { const row = fixtures.cases.find(c => c.id === id); assert.ok(row, id); return row; }
export function successes(c) { return positive.filter(row => row.id === c.id); }
export function projectFor(c) {
  const compilation = structuredClone(c.compilation);
  const text = c.id === 'explicit_parent_multi' ? 'x' : successes(c)[0].text;
  return {format:'intersect.toolkit.project.v3', mode:'language', profile:'default', compilerProfile:profile, structureSource:'rcore', definitionBundle:compilation, definitionRecovery:{compilation:structuredClone(compilation), compilerProfile:profile}, definitions:bundleSourceSnapshot(compilation), models:{catalog:text, loans:text}, python:'', layout:{version:1, positions:{}, zoom:1}};
}
