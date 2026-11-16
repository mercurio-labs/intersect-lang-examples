//! Toolkit's portable pack recipe. Model owns the binary container and checksums.
use intersect_model::definitions::pack::{
    FileDigest, LanguagePack, PackBuilder, PackHeader, PackRecipe, PackSectionFlags, canonical_json,
};
use serde_json::Value;

pub const RECIPE: &str = "intersect.toolkit.runner";
const SECTIONS: [&str; 5] = [
    "package",
    "model",
    "sources",
    "language-files",
    "entry-rule",
];

pub fn build_pack(input: &Value) -> Result<Vec<u8>, String> {
    let language = input["package"]["schema"]["uri"]
        .as_str()
        .ok_or("Missing compiled language namespace")?;
    let digest = FileDigest::of(&canonical_json(input).map_err(|e| e.to_string())?).sha256;
    let header = PackHeader {
        language: language.into(),
        recipe: PackRecipe {
            name: RECIPE.into(),
            version: "1".into(),
        },
        compiler: [
            ("intersect-model".into(), "0.1.0-alpha.1".into()),
            ("intersect-text".into(), "0.1.0-alpha.1".into()),
        ]
        .into(),
        recipe_constants: Default::default(),
        inputs: Default::default(),
        parts: vec![],
        requires_hooks: vec![],
        depends_on: vec![],
    };
    let mut builder = PackBuilder::new(header);
    for name in SECTIONS {
        let value = input.get(name).ok_or_else(|| format!("Missing {name}"))?;
        let payload = canonical_json(value).map_err(|e| e.to_string())?;
        let output = FileDigest::of(&payload).sha256;
        builder = builder.section(
            name,
            format!("{RECIPE}.{name}.v1"),
            PackSectionFlags::REQUIRED,
            payload,
            &digest,
            output,
        );
    }
    builder.build().map_err(|e| e.to_string())
}

/// Reads data only. The runner recompiles retained sources before using a package.
pub fn read_pack(bytes: Vec<u8>) -> Result<Value, String> {
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("Toolkit pack exceeds 16 MiB".into());
    }
    let pack = LanguagePack::read(bytes).map_err(|e| e.to_string())?;
    let manifest = pack.manifest();
    if manifest.recipe.name != RECIPE
        || manifest.recipe.version != "1"
        || manifest.sections.len() != SECTIONS.len()
        || !manifest.requires_hooks.is_empty()
        || !manifest.depends_on.is_empty()
    {
        return Err("Unsupported Toolkit pack recipe".into());
    }
    let mut input = serde_json::Map::new();
    for name in SECTIONS {
        let section = pack
            .section_entry(name)
            .ok_or_else(|| format!("Missing {name}"))?;
        if section.kind != format!("{RECIPE}.{name}.v1") {
            return Err(format!("Unexpected {name} section"));
        }
        input.insert(
            name.into(),
            pack.section_json(name).map_err(|e| e.to_string())?,
        );
    }
    if input["package"]["schema"]["uri"].as_str() != Some(manifest.language.as_str()) {
        return Err("Pack namespace does not match the compiled language".into());
    }
    Ok(Value::Object(input))
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::cell::RefCell;
    thread_local! {
        static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
        static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn input_buffer(length: usize) -> *mut u8 {
        if length > 4_000_000 {
            return std::ptr::null_mut();
        }
        INPUT.with(|input| {
            let mut input = input.borrow_mut();
            input.resize(length, 0);
            input.as_mut_ptr()
        })
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn execute() -> usize {
        let result = INPUT.with(|input| {
            serde_json::from_slice::<serde_json::Value>(&input.borrow())
                .map_err(|e| e.to_string())
                .and_then(|input| super::build_pack(&input))
        });
        let value = match result {
            Ok(bytes) => serde_json::json!({"bytes": bytes}),
            Err(error) => serde_json::json!({"error": error}),
        };
        OUTPUT.with(|output| {
            let mut output = output.borrow_mut();
            *output = value.to_string().into_bytes();
            output.len()
        })
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn output_buffer() -> *const u8 {
        OUTPUT.with(|output| output.borrow().as_ptr())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn container_is_deterministic_and_preserves_all_model_data() -> Result<(), String> {
        let input = serde_json::json!({"package":{"schema":{"uri":"urn:test"}},
            "model":{"elements":[{"id":"one"}]},"sources":[{"uri":"one.model","text":"one"}],
            "language-files":{"manifest.json":"{}"},"entry-rule":null});
        let bytes = build_pack(&input)?;
        assert_eq!(bytes, build_pack(&input)?);
        assert_eq!(&bytes[..8], b"IXLPACK\0");
        assert_eq!(read_pack(bytes.clone())?, input);
        let mut corrupt = bytes;
        if let Some(byte) = corrupt.last_mut() {
            *byte ^= 1;
        }
        assert!(read_pack(corrupt).is_err());
        Ok(())
    }
}
