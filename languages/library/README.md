# Library

- **Imported.** The structure and Rcore rules are from
  `fixtures/library/library-project.rcore` in core at
  `ee380404832746031e326062646e2b6ef1baeaea`. The grammar and sample are
  copied from that revision's `fixtures/library/library.xtext` and
  `fixtures/library/catalog.library`. This example adds the authored
  `inventoryLabel` operation and its Rcore function.
- **Consumed.** The ordinary Xtext path loads the sample and checks it.
  The Rcore package binds the operation to the Rcore function and exposes
  the same model to its derived-feature and operation APIs.
- **Semantically verified.** The quick test verifies the loaded sample,
  `copyCount = 2`, and `inventoryLabel() = "Catalog inventory"`.

The example uses Rcore providers only. It covers read-only model behavior
and does not run a time-based simulation.
