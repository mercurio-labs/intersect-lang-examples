# Intersect language examples

Small language packages that use [Intersect](https://github.com/mercurio-labs/intersect).
[Catalog](languages/catalog/README.md) demonstrates parsing and Rcore scoping
across two resources. The support crate prepares the definitions and loads
the model through the shared frozen engine. [Petri](languages/petri/README.md)
adds net-local scoping and Rcore validation with source locations.

## Checks

Run quick tests from the repository root with the test reporter.

```sh
cargo fmt --all --check
cargo clippy --all-targets -p examples-support -p examples-catalog -p examples-petri -- -D warnings
python -B tools/test_report.py run -- --profile test-fast -p examples-support -p examples-catalog -p examples-petri --lib --bins --tests
```

CI needs an `INTERSECT_CORE_TOKEN` with read access to the private core repository.
The workspace manifest pins all core dependencies to one revision.

### Working with a local core

Check out the pinned revision in a sibling directory named `intersect`.
Until the revision is available upstream, supply Cargo's path patches on the
command line. Use the same patches for Clippy.

```sh
python -B tools/test_report.py run -- --profile test-fast -p examples-support -p examples-catalog -p examples-petri --lib --bins --tests \
  --config 'patch."https://github.com/mercurio-labs/intersect".intersect-model.path="../intersect/crates/intersect-model"' \
  --config 'patch."https://github.com/mercurio-labs/intersect".intersect-xtext.path="../intersect/crates/intersect-xtext"' \
  --config 'patch."https://github.com/mercurio-labs/intersect".intersect-run.path="../intersect/crates/intersect-run"'
```

The patches can rewrite the local lockfile. Keep the committed lockfile
resolved to the git revision. A fresh offline build also needs the revision
in Cargo's Git cache.
