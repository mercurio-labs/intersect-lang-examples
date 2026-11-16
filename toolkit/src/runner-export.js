// Host packaging only. Rust owns the .pack container and native model execution.
import {zipSync, strToU8} from 'fflate';
import cargo from '../runner/Cargo.toml?raw';
import lock from '../runner/Cargo.lock?raw';
import lib from '../runner/src/lib.rs?raw';
import main from '../runner/src/main.rs?raw';
import license from '../runner/LICENSE?raw';

let host;
async function packHost(input) {
  host ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}toolkit_pack.wasm`);
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
  return new Uint8Array(output.bytes);
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
  const pack = await packHost(input);
  const entries = {'model.pack':pack, 'Cargo.toml':strToU8(cargo), 'Cargo.lock':strToU8(lock),
    'src/lib.rs':strToU8(lib), 'src/main.rs':strToU8(main), 'LICENSE':strToU8(license),
    'model.json':strToU8(JSON.stringify(input.model,null,2)+'\n'),
    'sources.json':strToU8(JSON.stringify(input.sources,null,2)+'\n')};
  for (const [path,text] of Object.entries(files)) entries[`language/${path}`] = strToU8(text);
  // Source URIs remain in sources.json; filenames below never become filesystem paths.
  snapshot.sources.forEach((source,index) => {
    const name = source.uri.split('/').at(-1).replace(/[^A-Za-z0-9._-]/g,'_') || 'model.txt';
    entries[`sources/${index+1}-${name}`] = strToU8(source.text);
  });
  const definitions = distribution.package.compilation?.bundle?.sources ?? distribution.package.xtext_inference?.bundle?.sources ?? [];
  definitions.forEach((source,index) => {
    const name=source.id.uri.split('/').at(-1).replace(/[^A-Za-z0-9._-]/g,'_') || `definition.${source.kind}`;
    entries[`definitions/${index+1}-${name}`]=strToU8(source.text);
  });
  if(snapshot.project) entries['project.intersect.json']=strToU8(JSON.stringify(snapshot.project,null,2)+'\n');
  entries['README.md'] = strToU8(`# ${distribution.manifest.metadata.display_name}\n\nUnzip this folder, install Rust 1.88 or newer, then run:\n\n\`\`\`sh\ncargo run --release --locked\n\`\`\`\n\nThe first run downloads the pinned crates.io dependencies and compiles the Rust harness. No private repositories, Java, Node.js, or browser are required.\n\nmodel.pack contains the full compiled language, checked model snapshot, model sources and retained language definitions. The runner verifies the pack checksums, recompiles and verifies the retained definitions, restores the model and evaluates its validation and derived values. Results are written to output/model.json.\n\nEdit src/main.rs to add your model operations. To run another compatible exported pack: cargo run --release --locked -- /path/to/model.pack\n\nSources are in sources/, definitions/ and language/definitions/; sources.json preserves the original model URIs. The pack is the runtime input: editing these reference files does not rebuild it. Recompile and export from Toolkit to incorporate source changes.\n\nRuntime versions: intersect-model =0.1.0-alpha.1, intersect-text =0.1.0-alpha.1.\n`);
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
