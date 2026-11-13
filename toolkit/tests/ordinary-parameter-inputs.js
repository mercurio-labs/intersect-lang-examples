// Exact frozen provider/grammar test adapter; migration remains explicit in Rust.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
export function ordinaryInputs(c){
 const models=c.metamodels.map(m=>({id:{uri:m.uri,sha256:hash(m.source)},kind:'ecore',text:m.source,dependencies:[]}));
 const modelIds=models.map(m=>m.id);for(const m of models)m.dependencies=modelIds.filter(id=>id!==m.id);
 const ids=new Map(),sources=[...models];
 for(const g of c.sources){assert.equal(hash(g.source),g.sha256);const id={uri:g.uri,sha256:g.sha256};sources.push({id,kind:'xtext',text:g.source,dependencies:[...modelIds,...g.dependencies.map(n=>ids.get(n))]});ids.set(g.id,id);}
 const text='rcore 1; package ordinary version "1";',behavior={id:{uri:`memory:/ordinary-parameters/${c.id}/behavior.rcore`,sha256:hash(text)},kind:'rcore_behavior',text,dependencies:modelIds};sources.push(behavior);
 return{bundle:{version:1,sources,namespaces:c.metamodels.map((m,i)=>({namespace:m.namespace,source:modelIds[i]}))},ecore:modelIds[0],namespace:c.metamodels[0].namespace,xtext:ids.get(c.entry),rcore_behavior:behavior.id,materialized_types:[]};
}
