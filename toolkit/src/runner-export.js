// Host packaging only. Rust owns the .pack container and native model execution.
import {zipSync, strToU8} from 'fflate';
import cargo from '../runner/templates/Cargo.toml?raw';
import lock from '../runner/Cargo.lock?raw';
import lib from '../runner/templates/lib.rs?raw';
import packSource from '../runner/src/pack.rs?raw';
import projectSource from '../runner/src/project.rs?raw';
import filesSource from '../runner/src/project_files.rs?raw';
import loadExample from '../runner/examples/load_pack.rs?raw';
import buildExample from '../runner/examples/build_pack.rs?raw';
import readme from '../runner/templates/README.md?raw';
import main from '../runner/src/main.rs?raw';
import license from '../runner/LICENSE?raw';

let host;
async function packHost(input) {
  host ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}toolkit_pack.wasm?v=2`);
    if (!response.ok) throw new Error('The compiled-model exporter is unavailable. Reload and try again.');
    return (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance;
  })().catch(error => { host = null; throw error; });
  const instance = await host;
  const bytes = strToU8(JSON.stringify(input));
  const pointer = instance.exports.input_buffer(bytes.length);
  if (!pointer) throw new Error('The model exceeds the compiled export size limit.');
  new Uint8Array(instance.exports.memory.buffer, pointer, bytes.length).set(bytes);
  const length = instance.exports.execute();
  const output = JSON.parse(new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, instance.exports.output_buffer(), length)));
  if (output.error) throw new Error(output.error);
  return {bytes:new Uint8Array(output.bytes),files:output.files};
}

export async function runnerArchive(distribution, snapshot) {
  const schema=distribution.package.schema;
  if (['conversion_contracts','applied_conversion_contracts','constructor_contracts'].some(key=>schema[key]?.length)
      || distribution.package.grammar?.computed_settings?.length) {
    throw new Error('This language requires native providers that the standalone Rust harness does not include. Save the project to retain those provider definitions.');
  }
  const files = {...distribution.files, 'manifest.json': JSON.stringify(distribution.manifest)};
  const input = {package: distribution.package, model: snapshot.evaluation.model,
    sources: snapshot.sources, 'language-files': files, 'entry-rule': snapshot.entry_rule ?? null};
  const result = await packHost(input);
  const entries = Object.fromEntries(Object.entries(result.files).map(([path,text])=>[path,strToU8(text)]));
  Object.assign(entries, {
    'model.pack':result.bytes, 'Cargo.toml':strToU8(cargo), 'Cargo.lock':strToU8(lock),
    'src/lib.rs':strToU8(lib), 'src/main.rs':strToU8(main), 'src/pack.rs':strToU8(packSource),
    'src/project.rs':strToU8(projectSource), 'src/project_files.rs':strToU8(filesSource),
    'examples/load_pack.rs':strToU8(loadExample), 'examples/build_pack.rs':strToU8(buildExample),
    'README.md':strToU8(`# ${distribution.manifest.metadata.display_name}: load and rebuild models\n\n`+readme),
    'LICENSE':strToU8(license),
  });
  if(snapshot.project) entries['toolkit/project.intersect.json']=strToU8(JSON.stringify(snapshot.project,null,2)+'\n');
  return zipSync(entries,{level:6,mtime:new Date(1980,0,1)});
}

export function createRunnerExport(getClient, hasPendingEdits, report, getProject) {
  const button = document.createElement('button'); button.id='export-runner';
  button.textContent='Download ready-to-run ZIP';
  button.onclick=async()=>{
    button.disabled=true;
    try {
      if(hasPendingEdits()) throw new Error('Compile your definition edits before downloading a runnable model.');
      const snapshot=await getClient().request('intersect/runnerSnapshot');
      snapshot.project=getProject?.();
      const metadata={package_id:'toolkit-model',release:'0.1.0',display_name:snapshot.package.schema.name,description:''};
      const distribution=await getClient().request('intersect/packageExport',{revision:snapshot.interfaceRevision,metadata});
      const bytes=await runnerArchive(distribution,snapshot);
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
      const a=document.createElement('a');a.href=url;a.download='toolkit-model-ready-to-run.zip';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      report('Ready-to-run ZIP downloaded. Unzip it and run cargo run --release --locked.');
    } catch(error) {report(error.message,true);}
    finally {button.disabled=false;}
  };
  return button;
}
