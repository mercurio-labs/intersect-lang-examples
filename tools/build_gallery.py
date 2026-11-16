#!/usr/bin/env python3
"""Generate the gallery from the exact definitions used by its runnable examples."""
from pathlib import Path
import hashlib
import html
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
REPO = "https://github.com/mercurio-labs/intersect-lang-examples"
PIN = json.loads((ROOT / "toolkit/runtime.json").read_text(encoding="utf-8"))
TEXT = ROOT / "toolkit/.runtime/intersect-text"

EXAMPLES = [
    dict(slug="stopwatch", title="Stopwatch", kind="State machine", tags=["Rcore", "Xtext", "Run"],
         description="A small command language drives a stopwatch. Follow its states and see exactly which time counts.",
         runtime="stopwatch.html", height=1050,
         explanation="Rcore defines the legal state transitions. Xtext turns start, wait and stop into command objects. Intersect Run schedules those commands in logical milliseconds and records the result.",
         steps=["Start the watch, wait two seconds, then stop it.", "Wait while stopped, then start again: elapsed time resumes rather than resetting.", "Change a duration and rerun. Step through the trace to compare simulation time with elapsed time."],
         result="The sample ends at 3250 ms of simulation time with 2750 ms on the watch. The 500 ms spent stopped does not count.",
         samples=["languages/stopwatch/models/demo.watch"]),
    dict(slug="petri", title="Timed Petri nets", kind="Simulation", tags=["Rcore", "Timed events", "Replay"],
         description="Turn a coffee-machine net into an animated run. Explore tokens, delayed transitions and external inputs.",
         runtime="petri.html", height=1300,
         explanation="Places hold tokens and arcs connect them to transitions. Rcore supplies structure, scoping and validation; the language's Rust semantics consume tokens when a firing starts and produce them when its delay expires. Run schedules and traces those events.",
         steps=["Run the bundled two-coin scenario and play the token trace.", "Change the brew delay or add a third coin to the scenario, then run again.", "Inspect the final marking and event log, or download the trace for replay."],
         result="Two coins produce two cups, with brew completions at 3000 and 6000 ms. The diagram, markings and event log describe the same recorded run.",
         samples=["languages/petri/models/coffee.petri", "languages/petri/scenarios/two-coins.scenario.json"]),
    dict(slug="library", title="Library", kind="Model ↔ text", tags=["Objects", "References", "Source preservation"],
         description="Edit books, members and loans as objects or as text. Keep both views synchronized, including references and history.",
         runtime="toolkit/library-text.html", height=1150,
         explanation="The Library editor exposes one accepted model through object controls and authored text. Object changes produce checked source edits; accepted text changes refresh the model. Derived availability and validation use the shared Rcore runtime.",
         steps=["Select a book and change its title. The source changes with the object.", "Rename a book, add a loan, or change a reference. Inspect the updated source and try undo/redo.", "Edit the source directly and apply it. Invalid text stays visible while the last accepted model is retained."],
         result="Model and text agree after each accepted edit. References follow renames, and history restores both the model and the authored source.",
         samples=["@text/fixtures/library/catalog.library", "@text/fixtures/library/loans.library"]),
    dict(slug="catalog", title="Catalog", kind="Linked models", tags=["Two resources", "Scoping", "Reflection"],
         description="Build a linked model from two files. Follow imports, type references and inheritance across resource boundaries.",
         runtime="catalog.html", height=1000,
         explanation="The grammar constructs packages, entities and features. Rcore scope functions resolve names relative to packages, imports and qualified paths. The explorer uses the resulting frozen model to show each reference's actual target.",
         steps=["Rebuild the two bundled resources and inspect their objects.", "Follow a type or superclass link to highlight the resolved target.", "Change a resource and rebuild. Try an unresolved name to observe a linking error."],
         result="The sample resolves nine type and superclass references across the two resources. This is model exploration; the language has no timed firing behavior.",
         samples=["languages/catalog/models/types.catalog", "languages/catalog/models/shop.catalog"]),
]


def esc(value):
    return html.escape(str(value), quote=True)


TOKEN = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|\b(?:rcore|package|version|metamodel|prefix|abstract|class|extends|attr|ref|op|enum|containment|opposite|derived|default|behavior|import|model|as|pub|fn|derive|validate|require|code|message|if|else|let|match|bind|scope|grammar|with|returns|terminal|fragment)\b|\b\d+\b')


def highlight(text):
    parts, end = [], 0
    for token in TOKEN.finditer(text):
        value = token.group()
        kind = "comment" if value.startswith(("//", "/*")) else "string" if value.startswith(('"', "'")) else "number" if value.isdigit() else "keyword"
        parts.extend([esc(text[end:token.start()]), f'<span class="{kind}">{esc(value)}</span>'])
        end = token.end()
    return "".join(parts) + esc(text[end:])


def read_source(path, filename=None):
    if path.startswith("@text/"):
        relative = path.removeprefix("@text/")
        physical = TEXT / relative
        origin = f'https://github.com/mercurio-labs/intersect-text/blob/{PIN["revision"]}/{relative}'
    else:
        physical = ROOT / path
        origin = f"{REPO}/blob/develop/{path}"
    raw = physical.read_bytes()
    return dict(text=raw.decode("utf-8").replace("\r\n", "\n"), raw=raw, filename=filename or physical.name,
                path=path, origin=origin, sha256=hashlib.sha256(raw).hexdigest())


def thumbnail(slug):
    # Small, code-native illustrations preview the subject of each live example.
    common = '<svg viewBox="0 0 540 235" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g font-family="system-ui,sans-serif" font-size="13" fill="#42526a">'
    if slug == "toolkit":
        body = '<rect x="38" y="30" width="464" height="175" rx="6" fill="white" stroke="#b5c8e5"/><path d="M38 61h464M175 61v144" stroke="#d4ddea"/><circle cx="54" cy="46" r="4" fill="#8aaff7"/><circle cx="68" cy="46" r="4" fill="#a6d9b6"/><text x="191" y="49" font-size="11">Model ↔ text</text><text x="54" y="88" font-weight="600">Language</text><text x="54" y="115">Metamodel</text><text x="54" y="142">Grammar</text><text x="54" y="169">Models</text><rect x="188" y="75" width="300" height="116" rx="4" fill="#142238"/><text x="204" y="103" fill="#c1c9ff" font-family="monospace">class Item {</text><text x="218" y="132" fill="#a6d9b6" font-family="monospace">attr name: String;</text><text x="204" y="161" fill="#d7e3f2" font-family="monospace">}</text>'
    elif slug == "stopwatch":
        body = '<circle cx="132" cy="112" r="65" fill="white" stroke="#d4ddea" stroke-width="3"/><path d="M132 112V66M132 112l33 18" stroke="#2563eb" stroke-width="4" stroke-linecap="round"/><rect x="117" y="31" width="30" height="9" rx="3" fill="#2563eb"/><text x="132" y="205" text-anchor="middle" fill="#647080">2750 ms elapsed</text>'
        for y, label, active in [(62, "idle", False), (117, "running", True), (172, "stopped", False)]:
            body += f'<rect x="279" y="{y-17}" width="133" height="34" rx="17" fill="{"#e7efff" if active else "white"}" stroke="{"#8aaff7" if active else "#d4ddea"}"/><text x="345" y="{y+5}" text-anchor="middle">{label}</text>'
        body += '<path d="M345 79v20m0 35v20" stroke="#91a6c2" stroke-width="2"/><text x="430" y="94" font-size="11">start</text><text x="430" y="149" font-size="11">stop</text>'
    elif slug == "petri":
        body = '<path d="M107 112h105m36 0h112m36 0h50" stroke="#93a6c0" stroke-width="2"/>'
        for x, label, tokens in [(85, "idle", 1), (382, "cups", 2)]:
            body += f'<circle cx="{x}" cy="112" r="33" fill="white" stroke="#8ca2c1" stroke-width="2"/><text x="{x}" y="179" text-anchor="middle">{label}</text>'
            for offset in ([-0] if tokens == 1 else [-9, 9]):
                body += f'<circle cx="{x+offset}" cy="112" r="5" fill="#2563eb"/>'
        body += '<rect x="213" y="77" width="36" height="70" rx="3" fill="#e3edff" stroke="#8aaff7" stroke-width="2"/><text x="231" y="179" text-anchor="middle">brew</text><text x="231" y="56" text-anchor="middle" font-size="11">after 3s</text><text x="460" y="117" font-size="12" fill="#2563eb">+1 cup</text>'
    elif slug == "library":
        body = '<rect x="38" y="43" width="200" height="148" rx="6" fill="white" stroke="#d4ddea"/><text x="57" y="72" font-weight="600">BookCopy</text><path d="M38 87h200" stroke="#e2e6ec"/><text x="57" y="114">name: earthsea</text><text x="57" y="143">edition: 2</text><text x="57" y="172" fill="#268769">available: true</text><text x="265" y="123" text-anchor="middle" font-size="23" fill="#2563eb">↔</text><rect x="296" y="43" width="206" height="148" rx="6" fill="#142238"/><text x="313" y="82" fill="#c1c9ff" font-family="monospace">copy earthsea</text><text x="313" y="111" fill="#a6d9b6" font-family="monospace">"Earthsea"</text><text x="313" y="140" fill="#d7e3f2" font-family="monospace">edition 2;</text>'
    else:
        body = '<path d="M188 76h145M188 162h145M402 94v50" stroke="#91a6c2" stroke-width="2"/>'
        for x, y, label, file in [(46, 47, "Customer", "shop.catalog"), (46, 133, "Order", "shop.catalog"), (333, 47, "Named", "types.catalog"), (333, 133, "Int", "types.catalog")]:
            body += f'<rect x="{x}" y="{y}" width="142" height="57" rx="5" fill="white" stroke="#b5c8e5"/><text x="{x+14}" y="{y+24}">{label}</text><text x="{x+14}" y="{y+43}" font-size="10" fill="#7a8799">{file}</text>'
        body += '<text x="260" y="66" font-size="10" text-anchor="middle">superType</text><text x="260" y="152" font-size="10" text-anchor="middle">type</text>'
    return common + body + '</g></svg>'


def shell(title, content, depth=""):
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · Intersect examples</title><link rel="stylesheet" href="{depth}gallery.css"><script src="{depth}gallery.js" defer></script></head>
<body><header class="site-header"><a class="brand" href="{depth or './'}">intersect<span>/ examples</span></a><nav class="header-links" aria-label="Site"><a href="{depth or './'}">Gallery</a><a href="{REPO}">GitHub ↗</a><a href="{depth}toolkit/">Toolkit ↗</a></nav></header>
<main>{content}</main><footer><span>Intersect examples · Rust + WebAssembly</span><a href="{REPO}">Source, build instructions and downloads ↗</a></footer></body></html>
'''


def code_panel(source, output, identity):
    destination = output / "sources" / source["filename"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(source["raw"])
    return f'''<div class="code-panel"><div class="code-heading"><span>{esc(source['filename'])}</span><div class="code-actions"><button type="button" data-copy="{identity}" aria-label="Copy {esc(source['filename'])}">Copy</button><a href="sources/{esc(source['filename'])}" download>Download ↓</a></div></div><pre><code id="{identity}" data-source="{esc(source['filename'])}">{highlight(source['text'])}</code></pre></div>'''


def build():
    migrated = subprocess.run(["cargo", "run", "--quiet", "--locked", "--profile", "test-fast", "-p", "examples-catalog", "--example", "catalog_rcore"], cwd=ROOT, capture_output=True, check=True).stdout
    for example in EXAMPLES:
        slug = example["slug"]
        output = WEB / "examples" / slug
        output.mkdir(parents=True, exist_ok=True)
        if slug == "catalog":
            metamodel = dict(raw=migrated, text=migrated.decode("utf-8"), filename="catalog.rcore", path="generated from languages/catalog/language/catalog.ecore", origin=f"{REPO}/blob/develop/languages/catalog/language/catalog.ecore", sha256=hashlib.sha256(migrated).hexdigest())
            parser = read_source("languages/catalog/language/catalog.xtext")
            note = 'Catalog retains an Ecore metamodel. The Rcore below is generated by the same native migration API used during loading. <a href="sources/catalog.ecore" download>Download the original Ecore</a>.'
            original = read_source("languages/catalog/language/catalog.ecore")
            (output / "sources").mkdir(exist_ok=True)
            (output / "sources/catalog.ecore").write_bytes(original["raw"])
        elif slug == "library":
            metamodel = read_source("@text/fixtures/library/library-project.rcore")
            parser = read_source("@text/fixtures/library/library.xtext")
            note = f'These are the exact Library definitions used by the interactive Toolkit solution, pinned to Text revision <code>{PIN["revision"][:8]}</code>. The linked Rust walkthrough is a smaller related Library consumer with an additional operation.'
        else:
            metamodel = read_source(f"languages/{slug}/language/{slug}.rcore")
            parser = read_source(f"languages/{slug}/language/{slug}.xtext")
            note = "These authored definitions are compiled by the same Rust language package used by the live example."
        sources = [metamodel, parser]
        samples = [read_source(path) for path in example["samples"]]
        solution = read_source(f"languages/{slug}/examples/{slug}_lifecycle.rs")
        content = f'''<div class="breadcrumb"><a href="../../">Examples</a> / {esc(example['title'])}</div>
<div class="example-intro"><div><p class="eyebrow">{esc(example['kind'])}</p><h1>{esc(example['title'])}</h1><p class="lede">{esc(example['description'])}</p><div class="actions"><a class="button" href="#solution">Try the solution ↓</a><a href="{solution['origin']}">Rust walkthrough ↗</a></div></div><div class="thumbnail">{thumbnail(slug)}</div></div>
<nav class="section-nav" aria-label="Example sections"><a href="#metamodel">01 Metamodel</a><a href="#parser">02 Parser</a><a href="#example-text">03 Example text</a><a href="#solution">04 Solution</a></nav>
<section class="section" id="definitions"><div class="section-title"><span class="number">01 / 02</span><h2>The language</h2></div><p>{esc(example['explanation'])}</p><div class="notice">{note}</div><div class="source-grid"><section id="metamodel"><h3>Metamodel</h3><p class="muted">Structure and behavior in Rcore</p>{code_panel(metamodel, output, 'metamodel-code')}<div class="source-caption"><a href="{metamodel['origin']}">Source / provenance ↗</a></div></section><section id="parser"><h3>Parser</h3><p class="muted">Concrete syntax in Xtext</p>{code_panel(parser, output, 'parser-code')}<div class="source-caption"><a href="{parser['origin']}">Source / provenance ↗</a></div></section></div>'''
        if slug in ("petri", "catalog"):
            binding = read_source(f"languages/{slug}/language/{'petri-bindings' if slug == 'petri' else 'catalog-scoping'}.rcore")
            sources.append(binding)
            content += f'<details class="implementation"><summary>Scoping and validation bindings (.rcore)</summary>{code_panel(binding, output, "bindings-code")}</details>'
        content += f'''</section><section class="section" id="example-text"><div class="section-title"><span class="number">03</span><h2>Example text</h2></div><div class="sample-grid"><div class="sample-sources">{''.join(code_panel(source, output, f'sample-{i}') for i, source in enumerate(samples))}</div><div><h3>What to try</h3><ul>{''.join(f'<li>{esc(step)}</li>' for step in example['steps'])}</ul><p>{esc(example['result'])}</p></div></div></section>
<section class="section" id="solution"><div class="solution-heading"><div><div class="section-title"><span class="number">04</span><h2>The solution</h2></div><p>Run and explore this example below.</p></div><a class="button secondary" href="../../{example['runtime']}" target="_blank" rel="noopener">Open full screen ↗</a></div><div class="solution-frame"><div class="frame-bar"><span>Live example · WebAssembly</span><a href="../../{example['runtime']}" target="_blank" rel="noopener">Open separately ↗</a></div><iframe title="{esc(example['title'])} live solution" src="../../{example['runtime']}" loading="lazy" style="height:{example['height']}px"></iframe></div><p class="solution-help">The controls above run locally in your browser. Definition listings are reference source; edit the example text inside the live tool to try a new model or run.</p>
<details class="implementation"><summary>Read the Rust lifecycle solution</summary><p>The native walkthrough shows the public API calls and checks its results.</p>{code_panel(solution, output, 'solution-code')}<p class="source-caption"><a href="{solution['origin']}">Read the Rust lifecycle walkthrough</a></p></details></section>
<nav class="next-examples" aria-label="More examples"><a href="../../">← Back to the gallery</a><a href="../{EXAMPLES[(EXAMPLES.index(example)+1)%len(EXAMPLES)]['slug']}/">Next example →</a></nav>'''
        (output / "index.html").write_text(shell(example["title"], content, "../../"), encoding="utf-8", newline="\n")
        (output / "source-manifest.json").write_text(json.dumps([dict(filename=s["filename"], source=s["path"], origin=s["origin"], sha256=s["sha256"]) for s in sources + samples + [solution]], indent=2) + "\n", encoding="utf-8", newline="\n")
    cards = "".join(f'''<a class="example-card" href="examples/{e['slug']}/"><div class="thumbnail">{thumbnail(e['slug'])}</div><div class="card-body"><p class="eyebrow">{esc(e['kind'])}</p><h3>{esc(e['title'])}<span aria-hidden="true">↗</span></h3><p>{esc(e['description'])}</p><div class="tags">{''.join(f'<span class="tag">{esc(t)}</span>' for t in e['tags'])}</div></div></a>''' for e in EXAMPLES)
    toolkit_card = f'''<a class="example-card" href="toolkit/"><div class="thumbnail">{thumbnail('toolkit')}</div><div class="card-body"><p class="eyebrow">Language workbench</p><h3>Toolkit<span aria-hidden="true">↗</span></h3><p>Author metamodels and grammars, explore models, and work with synchronized model and text views in your browser.</p><div class="tags"><span class="tag">Rcore</span><span class="tag">Xtext</span><span class="tag">Model ↔ text</span></div></div></a>'''
    (WEB / "index.html").write_text(shell("Gallery", f'''<div class="intro"><p class="eyebrow">Language gallery</p><h1>Intersect examples</h1><p class="lede">Explore a language from its definition to its working result. Each example includes the Rcore metamodel, Xtext parser, sample text and an interactive solution.</p></div><div class="gallery-heading"><h2>All examples</h2><span class="muted">Toolkit + 4 examples · source included</span></div><div class="gallery">{toolkit_card}{cards}</div><section class="gallery-note"><h2>Read it. Run it.<br>Change it.</h2><div><p>Start with a small language, see how its objects and syntax fit together, then try the result in your browser. Follow a timed run, inspect linked references, or edit an object model and its text together.</p><a href="toolkit/">Open the full language Toolkit ↗</a></div></section>'''), encoding="utf-8", newline="\n")
    print("Generated gallery and four source-backed example pages.")


if __name__ == "__main__":
    build()
