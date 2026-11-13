# Catalog

- **Imported.** The Ecore metamodel, Xtext grammar, Rcore scoping rules and two
  models come from `fixtures/frozen-text-catalog` in core at
  `ee380404832746031e326062646e2b6ef1baeaea`. The unmodified Xtext common
  terminals come from core's `fixtures/definition-conformance/upstream/xtext`.
  The terminals retain their upstream EPL-2.0 header.
- **Consumed.** The shared support crate prepares the definitions, parses both
  resources into the frozen store, links with the declared Rcore scoping and
  checks structural validity.
- **Semantically verified.** The quick test checks all nine reference targets
  across local, enclosing-package, imported and fully qualified names.

The example covers the declarations and references in these two models.
Behavior, execution and validation rules beyond the metamodel are out of scope.

## Full lifecycle in Rust

Run the commented [Catalog lifecycle example](examples/catalog_lifecycle.rs)
from the repository root:

```sh
cargo run --profile test-fast -p examples-catalog --example catalog_lifecycle
```

It prepares the retained definitions, parses both sources into one store, links
and structurally validates the model, and prints all nine resolved references.
It then writes `target/runs/catalog-lifecycle/catalog.pack`, restores the
compiled definitions, reloads the original sources and checks that every
reference retains the same source and target identities. Packs contain the
language definition; the two model resources remain explicit loader inputs.

The [shared loader](../../support/src/lib.rs) shows the preparation, parsing,
linking and validation operations. [The scoping test](tests/scoping.rs) checks
the independently listed expected targets, including cross-resource references.
