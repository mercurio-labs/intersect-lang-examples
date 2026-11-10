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
