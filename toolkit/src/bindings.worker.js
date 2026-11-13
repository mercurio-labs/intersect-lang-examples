import { loadRuntime } from './runtime.js';
const runtime = loadRuntime();
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try { self.postMessage({ token: data.token, response: (await runtime)(data.request) }); }
    catch (error) { self.postMessage({ token: data.token, error: error.message }); }
  });
};
