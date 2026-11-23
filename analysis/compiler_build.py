#!/usr/bin/env python3
"""Run the compiler-context wrapper from the pinned Model dependency."""

import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
metadata = json.loads(subprocess.check_output(
    ["cargo", "metadata", "--format-version", "1", "--locked", "--offline"],
    cwd=root,
))
packages = [
    package for package in metadata["packages"]
    if package["name"] == "intersect-build-support"
    and (package.get("source") or "").startswith(
        "git+https://github.com/mercurio-labs/intersect-model.git?"
    )
]
if len(packages) != 1:
    raise SystemExit("Expected one pinned Model build-support package")
model_root = Path(packages[0]["manifest_path"]).parents[2]
launcher = model_root / "tools/compiler_build.py"
raise SystemExit(subprocess.call(
    [sys.executable, "-B", str(launcher), *sys.argv[1:]],
    cwd=root,
))
