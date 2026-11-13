import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBindings} from '../src/binding-state.js';
const old={version:2,present:true,source:'fn f() {}',arguments:'[]'};
const mixed={...old,version:3,preset:'shipped-rust-rhai-v1'};
test('old file drafts retain their validation contract',()=>{assert.equal(validateBindings(undefined),undefined);assert.equal(validateBindings(old),undefined);assert.throws(()=>validateBindings({...old,version:1}),/legacy/);});
test('fixed example persists only source recipe and preset',()=>{assert.equal(validateBindings(mixed),undefined);assert.throws(()=>validateBindings({...mixed,preset:'arbitrary-rust'}),/Unsupported Rust/);assert.throws(()=>validateBindings({...mixed,implementations:[]}),/Unsupported Rust/);assert.throws(()=>validateBindings({...mixed,revision:'invented'}),/Unsupported Rust/);});
test('fixed example source bounds and EOL rules remain enforced',()=>{assert.throws(()=>validateBindings({...mixed,source:'x'.repeat(262145)}),/Invalid Rhai/);assert.throws(()=>validateBindings({...mixed,source:'a\r\nb\n'}),/Mixed/);});
