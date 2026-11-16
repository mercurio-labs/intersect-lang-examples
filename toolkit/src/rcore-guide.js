import {createDefinitionGuide} from './definition-guide.js';

export function createRcoreGuide(definitions) {
  return createDefinitionGuide(definitions,'rcore','Rcore',`
    <p>Define your model's structure in Rcore, then use Xtext to give it a textual syntax. Compile to check the definitions and refresh the diagram.</p>
    <details open><summary>Start a metamodel</summary><pre><code>rcore 1;
package example version "1";
metamodel "urn:example" prefix example {
  class Item {
    attr name: String [1,1];
  }
}</code></pre><p>The namespace identifies the model. Match it in your Xtext import. The syntax version is <code>rcore 1</code>.</p></details>
    <details open><summary>Classes and inheritance</summary><pre><code>abstract class Named {
  attr name: String [1,1];
}
class Item extends Named {
  attr enabled: Bool [1,1] default true;
}</code></pre><p>Concrete classes can be instantiated. Inheritance shares features; the compiler checks conflicts.</p></details>
    <details open><summary>Attributes and multiplicities</summary><pre><code>attr title: String [1,1];
attr count: Int32 [0,1];
attr tags: String [0,*];</code></pre><p><code>[1,1]</code> is required, <code>[0,1]</code> optional, and <code>[0,*]</code> a collection. Structural types include String, Bool, Int32, Int64, Float32 and Float64.</p></details>
    <details><summary>References and containment</summary><pre><code>class Folder {
  ref items: Item [0,*] containment;
}
class Item {
  attr name: String [1,1];
  ref related: Item [0,*];
}</code></pre><p>Containment owns child objects. Ordinary references link to existing objects. Use <code>opposite Owner.feature</code> to declare a paired reference.</p></details>
    <details><summary>Enums and defaults</summary><pre><code>enum State {
  OPEN = 0;
  CLOSED = 1 literal "closed";
}
class Task {
  attr state: State [1,1] default State.OPEN;
}</code></pre><p>Enum defaults must name a declared literal. Attribute defaults preserve their declared types.</p></details>
    <details><summary>Operations and behavior</summary><pre><code>class Item {
  op label(text: String [1,1]) -&gt; String [1,1];
  op clear() -&gt; void;
}</code></pre><p>An operation signature declares its contract. Executable behavior needs an explicit supported implementation. A <code>derived</code> feature also needs an implementation; its declaration alone does not compute a value.</p></details>
    <details><summary>Editing and exporting</summary><p>Use the diagram to inspect structure or edit the source directly. Compile after changes. File → Download ready-to-run ZIP includes the compiled language, model snapshot, source definitions and a Rust harness.</p><p>Source acceptance, type checking and executable support have separate boundaries. Unsupported constructs produce diagnostics.</p></details>
    <a href="https://github.com/mercurio-labs/intersect-model/blob/main/docs/rcore-guide.md" target="_blank" rel="noopener">Full Rcore language reference ↗</a>
  `);
}
