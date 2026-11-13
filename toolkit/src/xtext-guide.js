import { createDefinitionGuide } from './definition-guide.js';

// Examples follow the native grammar compiler's supported profile.
export function createXtextGuide(definitions) {
  return createDefinitionGuide(definitions, 'xtext', 'Xtext', `
      <p>The Example picker contains Library and three focused KerML demos. Use <strong>File → Language test cases</strong> for individual grammar mechanisms; saved projects and existing example links retain their sources and compiler profiles.</p>
      <p>Write syntax for the classes and features in your Ecore metamodel. Basic examples use the Library sample. Boolean assignments, delegation, fragments, datatype rules and simple actions require the native Xtext profile selected by the bounded KerML syntax examples; saved projects retain that selection. Library and the Rcore example retain their original profile.</p>
      <p><strong>KerML Xtext showcase</strong> combines the verified grammar features in two linked resources: inherited and overridden rules, typed fragments, simple actions, Boolean keywords, qualified names, integer/exponent/quoted-string tokens, hidden notes and significant documentation. Save/reopen or export its language ZIP to retain both grammar sources. It is a bounded authored demonstration; full pinned KerML and domain scoping remain unfinished.</p>
      <p>Select <strong>Xtext expression construction</strong> for NativeV5 assigned-current actions: <code>{k::OperatorExpression.operand += current}</code> wraps the preceding object. <code>Demo = 1 + 2 - 3;</code> builds a left-associated object graph; it does not calculate an arithmetic result. Writable containment, compatible concrete types and a current object are required. This independent metamodel does not implement the actual KerML derived operand setter. That NativeV5 example excludes mixed simple/current actions; the separate NativeV27 expression example demonstrates branch-local creation. Fragment delegation in current-flow rules remains restricted.</p>
      <p>Under <strong>File → Language test cases</strong>, <strong>Library Xtext syntax</strong> combines shared-prefix choices, typed fragments, parenthesized forwarding and keyword values with the existing Library references and validation. <strong>KerML expression actions</strong> combines simple actions and current captures with grouped expressions. Both use NativeV27; they build model objects, not arithmetic results, and do not claim full KerML support. The Library starter remains unchanged.</p>
      <p>Under <strong>File → Language test cases</strong>, try <strong>Xtext shared-prefix alternatives</strong>, <strong>Xtext multiple alternatives</strong>, <strong>Xtext shared-prefix repetition</strong> and <strong>Xtext optional-prefix discovery</strong>. These projects build expression objects with a literal <code>operator</code> value. Edit the grammar and model text together, then save the project or export its language ZIP to retain the selected compiler profile.</p>
      <details open><summary>Grammar &amp; Ecore import</summary>
        <pre><code>grammar example.Library
  with org.eclipse.xtext.common.Terminals
import "urn:intersect:example:library:1" as lib</code></pre>
        <p>Use one aliased import matching your EPackage’s namespace URI. <code>lib::BookCopy</code> names a class in that package.</p>
      </details>
      <details><summary>Inherited grammar sources</summary>
        <pre><code>grammar example.Model with example.Base</code></pre>
        <p>Select <strong>Xtext parser overrides</strong> to replace an inherited model parser rule. In this V3 example, the inherited Model rule accepts <code>class Wheel;</code> through the child's Member rule; the base source alone accepts <code>type Wheel;</code>. Optional <code>@Override</code> annotations require an inherited target. Replaced declarations stay in the project and archive. Only non-fragment parser rules with identical model return types are supported; terminal/datatype overrides, qualified parent calls and other annotations reject.</p>
        <p>Select <strong>Xtext grammar inheritance</strong> to execute rules and hidden tokens from an exact parent source. The child grammar is editable here; base.xtext is retained in the saved project and exported language archive. Parent declarations keep their own locations. In this V2 example, missing parents and rule overrides reject; multiple inheritance, full KerML and general Xtext remain unsupported.</p>
      </details>
      <p>Select <strong>KerML inferred datatypes</strong> for omitted-return Name, QualifiedName, Number and ConditionalOperator rules. The shared native analyzer preserves inferred return provenance, including inherited scalar calls. Recursive/nullable scalar execution and additional datatype conversions remain unsupported.</p>
      <details open><summary>Parser rules &amp; keywords</summary>
        <pre><code>Member returns lib::Member:
  'member' name=ID ';';</code></pre>
        <p>The first nonfragment parser rule is the entry point. <code>returns</code> selects an EClass; in older profiles omit it when the rule and class names match. In NativeV4, omitted-return rules containing only keywords, terminals and scalar calls infer EString; use an explicit return to retain a model class. Quoted text matches literal input. The final unquoted semicolon ends the rule.</p>
      </details>
      <details open><summary>Assignments &amp; containment</summary>
        <pre><code>name=ID
title=STRING
edition=INT
copies+=BookCopy</code></pre>
        <p><code>=</code> sets one feature; <code>+=</code> adds to a collection. A parser rule assigned to a containment reference creates a child. Names, types, and multiplicities must match Ecore.</p>
        <p><code>+=</code> does not repeat by itself: use <code>(copies+=BookCopy)*</code> for multiple copies.</p>
      </details>
      <details><summary>Boolean keyword assignments</summary>
        <pre><code>isAbstract?='abstract'? 'type' name=ID ';'</code></pre>
        <p>A matched keyword sets a writable single Boolean attribute to true. An absent optional keyword preserves its default and unset state. Only keyword right-hand sides are supported in this increment.</p>
        <p>Select <strong>KerML syntax (bounded)</strong> to try the simplified example. Its separate metamodel is illustrative; actual KerML grammar and semantic qualification remain open. Library continues to use the same Rust/WASM engine.</p>
      </details>
      <details><summary>Pure parser delegation</summary>
        <pre><code>Member returns k::Element: Type | Feature;</code></pre>
        <p>A rule made only of parser calls returns the selected child object, retaining its concrete type and source identity. Single-call aliases and grouped calls are supported. Targets must return compatible types, consume input, and have distinguishable first tokens.</p>
        <p>Select <strong>KerML syntax (dispatch)</strong> for an example. Calls mixed with assignments or surrounding keywords, nullable calls, and recursive alias cycles remain unsupported.</p>
      </details>
      <details><summary>Typed parser fragments</summary>
        <pre><code>fragment Identification returns k::Element: name=ID;
Type returns k::Type: 'type' Identification ';';</code></pre>
        <p>A fragment writes its caller instead of creating another object. Explicit return types, compatible caller features and acyclic fragment calls are required. Fragment calls cannot be assigned as values or executed as standalone entries.</p>
        <p>Select <strong>KerML syntax (fragments)</strong> to try shared identification and reference fields. Optional endings are checked against what follows at every caller; conflicts reject explicitly. Inferred fragment types and recursive fragments remain unsupported.</p>
      </details>
      <details><summary>Punctuation keywords</summary>
        <pre><code>'import' name=ID ('::' (recursive?='**' | all?='*'))? ';'</code></pre>
        <p>The native profile matches operators such as <code>::</code>, <code>**</code>, <code>:&gt;</code> and <code>:&gt;&gt;</code> as whole keywords, choosing the longest defined match. Spaces or comments cannot split a keyword. Strings keep their contents.</p>
        <p>Select <strong>KerML syntax (punctuation)</strong> for examples. This punctuation example retains its inherited lexical policy; use the separate terminal examples for declared terminals and significant comments. The example records syntax values; it does not implement KerML import or specialization semantics.</p>
      </details>
      <details><summary>String datatype rules</summary>
        <pre><code>QualifiedName returns ecore::EString: ID ('::' ID)*;
'feature' name=ID ':' target=[k::Type|QualifiedName] ';'</code></pre>
        <p>Select <strong>KerML syntax (qualified names)</strong> to match string values and reference spellings without creating extra objects. The native profile supports nonempty, acyclic EString rules made from keywords, common terminals and other EString rules.</p>
        <p>Raw quoted spelling is retained and hidden gaps become spaces. Matching reference spellings must agree exactly; this example does not implement KerML namespace scope or quoted-name interpretation. Nullable rules, other return types and custom datatype conversion remain unsupported.</p>
      </details>
      <details><summary>Leading simple actions</summary>
        <pre><code>Type returns k::Element:
  {k::Type} 'type' name=ID ';';</code></pre>
        <p>Select <strong>KerML syntax (simple actions)</strong> to construct a concrete subtype before its initializer runs. Subtype fields and fragment assignments use that same object.</p>
        <p>The native profile accepts one unconditional leading simple action per object rule, including mandatory groups. Conditional and replacement simple actions, and actions in fragments or datatype rules, remain unsupported. NativeV5 assigned-current construction is demonstrated separately by Xtext expression construction.</p>
      </details>
      <details><summary>Overlapping tokens and prediction</summary>
        <p>Select <strong>KerML lexer prediction</strong> for all nine pinned terminal declarations with the native V2 profile. The lexer distinguishes decimal and exponent tokens, line and block notes, and significant documentation comments. An incomplete selected token such as <code>1e+</code> rejects input rather than falling back to a shorter decimal.</p>
        <p>The example preserves integer values and raw exponent/quoted-name spellings. It is an independent parser example, not the complete KerML grammar. General parser predicates and KerML name/real-value conversion remain unfinished; the separate inheritance and override examples demonstrate bounded source composition. Saved projects and archives retain the V2 profile; earlier examples keep their previous contracts.</p>
      </details>
      <details><summary>Grammar-defined whitespace and comments</summary>
        <pre><code>grammar example.Syntax hidden(WS)
terminal WS: (' ' | '\\t' | '\\r' | '\\n')+;
terminal REGULAR_COMMENT: '/*' -&gt; '*/';</code></pre>
        <p>Select <strong>KerML terminal declarations</strong> for five terminal declarations retained from the pinned grammar. Explicit hidden declarations make named tokens ignorable; other comments remain significant and must occur where the parser accepts them. Quoted names and strings retain their raw spelling in this example.</p>
        <p>Without a parent grammar, explicit lexical policy supports negated single-character sets, until delimiters and acyclic terminal calls/fragments. Declare every terminal used by parser rules. Token starts must remain disjoint; overlapping numeric/note prediction, inherited hidden policy and KerML value converters are still unsupported.</p>
      </details>
      <details><summary>Custom terminal spellings</summary>
        <pre><code>terminal TAG: '@' ('a'..'z')+;
Name returns ecore::EString: TAG;</code></pre>
        <p>Select <strong>Xtext terminal spellings</strong> for an independent example. Native EString terminals support literals, UTF-16 character ranges, disjoint choices, sequences and cardinalities. Exact raw spelling is preserved; a selected incomplete token is rejected.</p>
        <p>This increment requires disjoint punctuation starts outside inherited identifier, number, quote, whitespace and comment starts. Conflicting keywords, overlapping terminals, calls/fragments, negation and until patterns require the separate explicit lexical policy described above. The tagged names in this example are not standard KerML syntax.</p>
      </details>
      <details><summary>Groups, choices &amp; repetition</summary>
        <pre><code>('edition' edition=INT)?
(copies+=BookCopy | members+=Member)*</code></pre>
        <dl><dt><code>A B</code></dt><dd>Sequence, in order</dd><dt><code>A | B</code></dt><dd>Alternative</dd><dt><code>(…)</code></dt><dd>Group expressions</dd><dt><code>?</code></dt><dd>Zero or one</dd><dt><code>*</code></dt><dd>Zero or more</dd><dt><code>+</code></dt><dd>One or more</dd></dl>
        <p>Earlier profiles require distinguishable first tokens for alternatives. NativeV27 also admits shared prefixes when the shared prediction graph proves the choice unambiguous. Empty repetitions, left recursion and unresolved continuation conflicts remain rejected.</p>
      </details>
      <details><summary>Cross-references</summary>
        <pre><code>copy=[lib::BookCopy|ID]
member=[lib::Member|ID]</code></pre>
        <p>Refer to an existing object instead of creating a child. Toolkit resolves the ID against a unique name across open model resources; missing or ambiguous names are errors. The original profile supports ID spelling; the native profile also supports admitted EString datatype rules.</p>
      </details>
      <details><summary>Values &amp; comments</summary>
        <pre><code>ID      // dune
STRING  // "Dune"
INT     // 2
/* a block comment */</code></pre>
        <p>Toolkit supplies ID, STRING, and INT with a bounded lexer. Escaped Xtext identifiers and custom value converters are not supported. Native custom terminals have the explicit restrictions described above.</p>
      </details>
      <details><summary>Toolkit limits</summary>
        <p>Ecore enums, numeric aliases, defaults, and enum-valued model attributes are supported. Use <strong>+ Enum</strong> and <strong>+ Literal</strong> in the Ecore editor, then select the enum as an attribute type. Xtext enum rules require an appropriate Native profile; the <strong>KerML enum rules</strong> test case demonstrates the admitted syntax.</p>
        <p>Use an explicit metamodel for the ordinary imported-model path. Grammar-driven inference with <code>generate</code> is a separate path with its own profile and source requirements; see the <strong>KerML inferred datatypes</strong> test case.</p>
        <p>Support for actions, predicates, fragments, imports and rule calls depends on the selected grammar profile. The bounded default profile and the Native test cases have different admission rules. Keep the profile with the project's original grammar sources when saving and reopening.</p>
        <p>Compile reports unsupported constructs for the selected path. Successful compilation does not establish arbitrary Xtext compatibility, custom Java/Xtend semantics, or support for every editing workflow.</p>
      </details>
      <a href="https://eclipse.dev/Xtext/documentation/301_grammarlanguage.html" target="_blank" rel="noopener noreferrer">Full Xtext language reference ↗</a>
  `);
}
