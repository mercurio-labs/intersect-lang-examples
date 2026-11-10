# Timed Petri nets

- **Imported.** The example authors its own Ecore, Xtext, and Rcore definitions.
- **Consumed.** The shared support crate parses `.petri` models, resolves arc
  places within their owning net, validates structure, and runs the Rcore
  validation rules. Rule issues include the source resource and object span.
- **Semantically verified.** The definition tests cover three valid nets and one
  located negative control for each validation rule.

The grammar admits integer token counts and arc weights, and delays in
milliseconds or seconds. A place with an omitted initial count starts empty.
An omitted arc weight represents one token.
