#!/usr/bin/env python3
"""Run the compiler-context wrapper from the pinned Model dependency."""

import argparse
import json
import os
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
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


def run(arguments, env=None):
    return subprocess.call([sys.executable, "-B", str(launcher), *arguments], cwd=root, env=env)


arguments = sys.argv[1:]
if arguments[:1] == ["pack"]:
    parser = argparse.ArgumentParser(description="Build a SysML pack for this analysis compiler")
    parser.add_argument("output", type=Path)
    parser.add_argument("--previous", type=Path)
    options = parser.parse_args(arguments[1:])
    (language,) = (
        package for package in metadata["packages"] if package["name"] == "intersect-kerml"
    )
    crate = Path(language["manifest_path"]).parent
    builder = root / "target/sysml-pack-builder"
    builder.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.setdefault("CARGO_TARGET_DIR", str(builder / "target"))
    with TemporaryDirectory(prefix="project-", dir=builder) as temporary:
        project = Path(temporary)
        manifest = project / "Cargo.toml"
        example = json.dumps((crate / "examples/sysml_pack.rs").as_posix(), ensure_ascii=False)
        manifest.write_text(
            (root / "Cargo.toml").read_text(encoding="utf-8")
            + f'\n[[bin]]\nname = "sysml-pack"\npath = {example}\n',
            encoding="utf-8",
        )
        shutil.copyfile(root / "Cargo.lock", project / "Cargo.lock")
        arguments = [
            "--", "run", "--locked", "--offline", "--release", "--manifest-path", str(manifest),
            "--", "build", str(crate.parents[1]), str(options.output.resolve()), "--library",
        ]
        if options.previous:
            arguments.extend(["--previous", str(options.previous.resolve())])
        raise SystemExit(run(arguments, env))

raise SystemExit(run(arguments))
