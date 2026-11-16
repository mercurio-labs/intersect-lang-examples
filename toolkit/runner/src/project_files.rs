//! Files shared by browser downloads and the native `unpack` command.
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn filename(uri: &str, fallback: &str) -> String {
    let name = uri
        .rsplit('/')
        .next()
        .unwrap_or(uri)
        .rsplit(':')
        .next()
        .unwrap_or(uri);
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    if name.is_empty() || name == "." || name == ".." {
        fallback.into()
    } else {
        name
    }
}

/// Make the editable project; source URIs stay separate from filesystem paths.
pub fn editable_files(input: &Value) -> Result<BTreeMap<String, String>, String> {
    let mut files = BTreeMap::new();
    let language: BTreeMap<String, String> =
        serde_json::from_value(input["language-files"].clone()).map_err(|e| e.to_string())?;
    for (path, text) in language {
        files.insert(format!("language/{path}"), text);
    }
    let mut definitions = vec![];
    let sources = input["package"]["compilation"]["bundle"]["sources"]
        .as_array()
        .or_else(|| input["package"]["xtext_inference"]["bundle"]["sources"].as_array())
        .ok_or("The pack has no retained definition sources")?;
    for (index, source) in sources.iter().enumerate() {
        let uri = source["id"]["uri"]
            .as_str()
            .ok_or("Missing definition URI")?;
        let path = format!(
            "definitions/{}-{}",
            index + 1,
            filename(uri, "definition.txt")
        );
        files.insert(
            path.clone(),
            source["text"]
                .as_str()
                .ok_or("Missing definition text")?
                .into(),
        );
        definitions.push(json!({"uri":uri,"file":path}));
    }
    let mut models = vec![];
    for (index, source) in input["sources"]
        .as_array()
        .ok_or("Missing model sources")?
        .iter()
        .enumerate()
    {
        let uri = source["uri"].as_str().ok_or("Missing model URI")?;
        let path = format!("models/{}-{}", index + 1, filename(uri, "model.txt"));
        files.insert(
            path.clone(),
            source["text"].as_str().ok_or("Missing model text")?.into(),
        );
        models.push(json!({"uri":uri,"file":path}));
    }
    let project = json!({"version":1,"language_directory":"language","definitions":definitions,"models":models,"entry_rule":input["entry-rule"]});
    files.insert(
        "project.json".into(),
        serde_json::to_string_pretty(&project).map_err(|e| e.to_string())? + "\n",
    );
    files.insert(
        "model.json".into(),
        serde_json::to_string_pretty(&input["model"]).map_err(|e| e.to_string())? + "\n",
    );
    Ok(files)
}
