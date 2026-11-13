import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative,dirname} from 'node:path';
const toolkit=fileURLToPath(new URL('../',import.meta.url));
test('runtime and fixture inputs are pinned to one immutable source',()=>{
  const pin=JSON.parse(readFileSync(resolve(toolkit,'runtime.json')));
  assert.equal(pin.repository,'https://github.com/mercurio-labs/intersect-text.git');
  assert.match(pin.revision,/^[0-9a-f]{40}$/);
});
test('application and test imports stay inside the independent Toolkit directory',()=>{
  for(const dir of ['src','tests'])for(const entry of readdirSync(resolve(toolkit,dir))){
    if(!entry.endsWith('.js') || entry === 'standalone.node.js')continue;
    const path=resolve(toolkit,dir,entry),text=readFileSync(path,'utf8');
    assert.ok(!text.includes('../../fixtures/')&&!text.includes('../../crates/'),path);
    for(const match of text.matchAll(/(?:^import[^\n]*from\s*|new URL\(\s*)['"](\.\.?\/[^'"`]+)['"]/gm)){
      const target=resolve(dirname(path),match[1].split('?')[0]);
      assert.ok(!relative(toolkit,target).startsWith('..'),`${path}: ${match[1]} escapes Toolkit`);
      assert.ok(existsSync(target),`${path}: missing input ${match[1]} (run npm run prepare:runtime)`);
    }
  }
});
