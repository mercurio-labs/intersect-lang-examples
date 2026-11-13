// Demonstrates the shared runtime's Rcore enum values; no Xtext enum rule required.
export const enumSample = {
  definitions: {
    ecore: '',
    rcore: `rcore 1;
package workflow version "1";
metamodel "urn:intersect:example:workflow:1" prefix workflow {
  enum Status {
    DRAFT = 7 literal "draft";
    ACTIVE = 7 literal "active";
    CLOSED = 42 literal "closed";
  }
  class Item {
    attr name: String [0,1];
    attr status: Status [0,1] default "active";
  }
}
`,
    xtext: '', rcore_behavior: '',
  },
  models: { catalog: '', loans: '' },
  python: `from intersect_api import Item, model

# The explicit default selects ACTIVE by literal spelling.
# DRAFT and ACTIVE share numeric value 7 but remain distinct identities.
item = model.create(Item, name="Example item")
print("Status:", item.status)
assert item.status["kind"] == "enum"
print("Enum default created successfully. Inspect the item's properties.")
`,
};
