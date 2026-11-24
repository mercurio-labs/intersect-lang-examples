import { serveWasmHost } from "@intersect/visualization/wasm-worker";
import wasmUrl from "./generated/thermal.wasm?url";
serveWasmHost(wasmUrl);
