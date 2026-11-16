This Rust project demonstrates two tasks: **load an existing compiled model**
and **regenerate a pack after editing its source files**.

Install Rust 1.88 or newer. The first run downloads the public crates and builds
the program. Run commands from this extracted folder.

## Load the included model

```sh
cargo run --release --locked -- load model.pack
```

This loads the saved model, validates it, evaluates derived values, prints a
summary, and writes the result to `output/model.json`. With no arguments,
`cargo run --release --locked` does the same thing.

To load another Toolkit pack, substitute its path. To inspect a native pack's
language, recipe, checksums and sections:

```sh
cargo run --release --locked -- inspect other.pack
```

`load` runs Toolkit runner packs (recipe version 1). `inspect` can also describe
other Intersect pack recipes; their execution requires their language's loader.

## Edit sources and regenerate a pack

`project.json` lists the editable `.rcore` / `.xtext` definitions and model
files by filename and original URI. Edit those files under `definitions/` and
`models/`, then run:

```sh
cargo run --release --locked -- build project.json rebuilt.pack
cargo run --release --locked -- load rebuilt.pack
```

`build` recompiles the definitions, parses and links all model files, validates
the result, and saves a new pack. Source hashes and dependency references are
updated together. A compilation or validation error leaves the output pack
unchanged. The `language/` folder supplies the original language's compilation
settings; the files listed in `project.json` supply your edits.

`load` uses the snapshot stored in a pack. `build` creates a new snapshot from
the editable text files, including any changes you made to those files.

## Start from an existing pack

```sh
cargo run --release --locked -- unpack existing.pack editable
# Edit editable/definitions/ and editable/models/.
cargo run --release --locked -- build editable/project.json updated.pack
cargo run --release --locked -- load updated.pack
```

Choose a new or empty folder for `unpack`. It extracts the original sources,
`project.json`, and a copy of the pack.

## Use the Rust API directly

Start with these short programs:

```sh
cargo run --release --locked --example load_pack
cargo run --release --locked --example build_pack
```

- `examples/load_pack.rs` loads the model and walks its objects.
- `examples/build_pack.rs` compiles the editable project into `rebuilt.pack`.
- `src/main.rs` connects the four commands to those same library functions.
- Support modules handle source verification, pack encoding and filesystem I/O.

The pack includes retained language sources. Loading verifies them against a
fresh compilation before using the saved model. Runtime versions are pinned
to Intersect Model/Text `0.1.0-alpha.1` in Cargo.toml and Cargo.lock.
