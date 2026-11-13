// Source recipes only. Native activation validates the shipped Rust contract.
import structure from '../.runtime/intersect-text/fixtures/rcore/bindings/model.rcore?raw';
import behavior from '../.runtime/intersect-text/fixtures/rcore/bindings/behavior.rcore?raw';
import source from '../.runtime/intersect-text/fixtures/rcore/bindings/behavior.rhai?raw';
export function mixedBindingsProject() {
  return {
    format: 'intersect.toolkit.project.v2', mode: 'structure', profile: 'default',
    compilerProfile: 'intersect.workbench.v1', structureSource: 'rcore',
    definitions: {ecore:'', rcore:structure, rcore_behavior:behavior, xtext:''},
    models: {catalog:'', loans:''}, python: 'from intersect_api import Meter\nmeter = Meter(value={"kind":"int64","value":"21"})\nprint("METER_ID=" + meter.handle)\n',
    layout: {version:1, positions:{}, zoom:1}, windows: undefined,
    bindings: {version:3, preset:'shipped-rust-rhai-v1', present:true, source, arguments:'["21"]'},
  };
}
