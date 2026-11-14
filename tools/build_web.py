#!/usr/bin/env python3
"""Build the gallery, Rust/WASM examples, and independent Toolkit.

Requires Rust's wasm32-unknown-unknown target and wasm-pack 0.14.0.
Toolkit requires its npm dependencies at build time. The output needs only a static HTTP server.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    wasm_pack = shutil.which("wasm-pack")
    if not wasm_pack:
        raise SystemExit("Install wasm-pack: cargo install wasm-pack --version 0.14.0 --locked")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    env = os.environ.copy()
    # Definition preparation uses recursive descent. Give the WASM main stack
    # room just as native development does; this is independent of worker stacks.
    key = "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS"
    env[key] = (env.get(key, "") + " -C link-arg=-zstack-size=16777216").strip()
    subprocess.run([
        wasm_pack, "build", str(ROOT / "browser"), "--target", "web",
        "--release", "--out-dir", str(dist / "pkg"), "--out-name", "examples_web",
        "--no-typescript", "--no-pack", "--locked",
    ], cwd=ROOT, env=env, check=True)
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise SystemExit("Node.js and npm are required to build Toolkit")
    toolkit_env = os.environ.copy()
    toolkit_env["TOOLKIT_BASE"] = os.environ.get("SITE_BASE", "/") + "toolkit/"
    subprocess.run([npm, "run", "build"], cwd=ROOT / "toolkit", env=toolkit_env, check=True)
    subprocess.run([sys.executable, "-B", str(ROOT / "tools/build_gallery.py")], cwd=ROOT, check=True)
    for source in (ROOT / "web").iterdir():
        if source.is_file() and source.suffix in {".html", ".css", ".js"}:
            shutil.copy2(source, dist / source.name)
    shutil.copytree(ROOT / "web" / "examples", dist / "examples", dirs_exist_ok=True)
    shutil.copytree(ROOT / "toolkit" / "dist", dist / "toolkit", dirs_exist_ok=True)
    shutil.copytree(ROOT / "toolkit" / "licenses", dist / "toolkit" / "licenses", dirs_exist_ok=True)
    shutil.copy2(ROOT / "LICENSE", dist / "LICENSE")
    (dist / "viewer").mkdir(exist_ok=True)
    for name in ("index.html", "viewer.css", "viewer.js"):
        shutil.copy2(ROOT / "viewer" / name, dist / "viewer" / name)
    (dist / ".nojekyll").touch()
    (dist / "README.txt").write_text("Run python -m http.server 8000 in this folder, then open http://localhost:8000/\n", encoding="utf-8")
    print("Built dist/. Preview: python -m http.server 8000 --directory dist")


if __name__ == "__main__":
    main()
