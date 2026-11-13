// Curated teaching projects; all smaller compiler cases retain their exact IDs.
export const demoChoices = [
  ['library', 'Library'],
  ['library-implementations', 'Library w/ Implementations'],
  ['rcore', 'KerML specialization'],
  ['xtext-converters', 'KerML syntax and references'],
  ['xtext-arguments', 'KerML nested calls'],
];
export const testCaseChoices = [
  ['xtext-projected', 'Xtext shared-prefix alternatives'],
  ['xtext-nary', 'Xtext multiple alternatives'],
  ['xtext-filtered', 'Xtext shared-prefix repetition'],
  ['xtext-discovery', 'Xtext optional-prefix discovery'],
  ['xtext-library-composed', 'Library composed Xtext syntax'],
  ['xtext-expressions-composed', 'KerML nested expression construction'],
  ['xtext-library-advanced', 'Library Xtext syntax'],
  ['xtext-expressions-advanced', 'KerML expression actions'],

  [
    "xtext-double",
    "KerML real values"
  ],
  [
    "xtext-recursive",
    "Xtext recursive predicates"
  ],
  [
    "xtext-enums",
    "KerML enum rules"
  ],
  [
    "xtext-predicates",
    "Xtext first-token predicates"
  ],
  [
    "xtext-current",
    "Xtext expression construction"
  ],
  [
    "xtext-inference",
    "KerML inferred datatypes"
  ],
  [
    "xtext-showcase",
    "KerML Xtext showcase"
  ],
  [
    "xtext-kerml",
    "KerML syntax (bounded)"
  ],
  [
    "xtext-dispatch",
    "KerML syntax (dispatch)"
  ],
  [
    "xtext-fragments",
    "KerML syntax (fragments)"
  ],
  [
    "xtext-punctuation",
    "KerML syntax (punctuation)"
  ],
  [
    "xtext-datatypes",
    "KerML syntax (qualified names)"
  ],
  [
    "xtext-actions",
    "KerML syntax (simple actions)"
  ],
  [
    "xtext-terminals",
    "Xtext terminal spellings"
  ],
  [
    "xtext-lexical",
    "KerML terminal declarations"
  ],
  [
    "xtext-prediction",
    "KerML lexer prediction"
  ],
  [
    "xtext-inheritance",
    "Xtext grammar inheritance"
  ],
  [
    "xtext-overrides",
    "Xtext parser overrides"
  ]
];
export function showDemoChoices(select, current = 'library') {
  const choices = [...demoChoices];
  const extra = testCaseChoices.find(([id]) => id === current);
  if (extra) choices.push([extra[0], 'Test case: ' + extra[1]]);
  select.replaceChildren(...choices.map(([id, label]) => new Option(label, id)));
  select.value = current;
}
