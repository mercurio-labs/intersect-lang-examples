import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const cargo = (args) => {
  const result = spawnSync(...args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
cargo(["cargo", ["fetch", "--locked"]]);
cargo([process.env.PYTHON ?? "python3", [
  "-B", "tools/compiler_build.py", "--", "build", "--lib", "--locked",
  "--offline", "--release", "--target", "wasm32-unknown-unknown",
]]);
const destination = "web/generated";
await mkdir(destination, { recursive: true });
await copyFile(
  resolve(process.env.CARGO_TARGET_DIR ?? "target", "wasm32-unknown-unknown/release/intersect_example_state_machine.wasm"),
  resolve(destination, "state_machine.wasm"),
);
