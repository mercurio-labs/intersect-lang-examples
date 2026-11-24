import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const result = spawnSync("cargo", [
  "build", "--lib", "--locked", "--release", "--target", "wasm32-unknown-unknown",
], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await mkdir("web/generated", { recursive: true });
await copyFile(
  resolve(process.env.CARGO_TARGET_DIR ?? "target", "wasm32-unknown-unknown/release/intersect_thermal_profile.wasm"),
  "web/generated/thermal.wasm",
);
