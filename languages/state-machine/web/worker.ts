import { serveWasmHost } from "@intersect/visualization/wasm-worker";
import wasmUrl from "./generated/state_machine.wasm?url";

serveWasmHost(wasmUrl);
