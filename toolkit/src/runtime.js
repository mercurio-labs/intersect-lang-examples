// Thin WASM host transport. No parser, model engine or semantic rules in JS.
export async function loadRuntime({ retainedEncodedLimit } = {}) {
  const response = await fetch(new URL(`${import.meta.env.BASE_URL}intersect_web.wasm`, self.location.origin));
  if (!response.ok) throw new Error('WASM runtime missing. Run npm run wasm.');
  const moduleBytes=await response.arrayBuffer();
  const runtimeIdentity=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',moduleBytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const { instance } = await WebAssembly.instantiate(moduleBytes, {});
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const invoke = (request) => {
    const bytes = encoder.encode(JSON.stringify(request.method?.startsWith('model/cache')?{...request,runtime_identity:runtimeIdentity}:request));
    const pointer = instance.exports.input_buffer(bytes.length);
    if (!pointer) throw new Error('Runtime input budget exceeded (4 MB).');
    new Uint8Array(instance.exports.memory.buffer, pointer, bytes.length).set(bytes);
    const length = instance.exports.execute();
    const output = instance.exports.output_buffer();
    const result = JSON.parse(decoder.decode(new Uint8Array(instance.exports.memory.buffer, output, length)));
    if (result?.error) throw new Error(result.error);
    return result;
  };
  invoke({ method: 'rcore_behavior/jobHost', namespace: crypto.randomUUID(), retained_encoded_limit: retainedEncodedLimit });
  return invoke;
}
