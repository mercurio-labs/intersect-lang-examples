import init, {catalog_samples, check_catalog} from './pkg/examples_web.js';
try {
  await init();
  self.postMessage({type:'ready', samples:JSON.parse(catalog_samples())});
  self.onmessage = ({data}) => {
    try { self.postMessage({type:'result', value:JSON.parse(check_catalog(data.types, data.shop))}); }
    catch(error) { self.postMessage({type:'error', message:String(error.message || error)}); }
  };
} catch(error) { self.postMessage({type:'error', message:String(error)}); }
