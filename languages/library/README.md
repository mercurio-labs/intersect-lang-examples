# Library

- **Imported.** The structure and Rcore rules are from
  `fixtures/library/library-project.rcore` in core at
  `ee380404832746031e326062646e2b6ef1baeaea`. The grammar and sample are
  copied from that revision's `fixtures/library/library.xtext` and
  `fixtures/library/catalog.library`. This example adds the authored
  `inventoryLabel` operation and its Rcore function.
- **Consumed.** The ordinary Xtext path loads the sample and checks it.
  The runtime imports the checked model into a frozen store using the exact
  authored class declarations and retains the original identities and spans.
  The Rcore package binds the operation to the Rcore function and exposes
  the same model to its derived-feature and operation APIs.
- **Semantically verified.** The quick test verifies the loaded sample,
  `copyCount = 2`, and `inventoryLabel() = "Catalog inventory"`.

The example uses Rcore providers only. It covers read-only model behavior
and does not run a time-based simulation.

## Full lifecycle in Rust

Run the commented [Library lifecycle example](examples/library_lifecycle.rs)
from the repository root:

```sh
cargo run --profile test-fast -p examples-library --example library_lifecycle
```

It loads text with the authored definitions, checks model structure and Rcore
rules separately, inspects source identities and spans, reads `copyCount`, and
invokes `inventoryLabel`. It writes the model, source definitions and operation
bindings to `target/runs/library-lifecycle/library.model.json`, then reloads
them and verifies both the exported model and the behavior results. Expected
results are `copyCount = 2` and `inventoryLabel() = "Catalog inventory"`.

Reload verifies the saved sources and recompiles the definitions. This model
persistence API is distinct from Catalog and Petri's compiled language packs.
The [language loader](src/lib.rs) shows the text-to-runtime declaration mapping
and explicit operation binding.
