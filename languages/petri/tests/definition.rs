use examples_support::Source;
use intersect_model::core::frozen::Severity;

fn source(uri: &str, text: &str) -> Source {
    Source {
        uri: uri.into(),
        text: text.into(),
    }
}

#[test]
fn valid_nets_resolve_arcs_and_validate() -> Result<(), String> {
    for (uri, text, expected_arcs) in [
        ("coffee.petri", include_str!("../models/coffee.petri"), 7),
        (
            "conflict.petri",
            include_str!("../models/conflict.petri"),
            4,
        ),
        ("zeno.petri", include_str!("../models/zeno.petri"), 4),
    ] {
        let loaded = examples_petri::load(&[source(uri, text)])?;
        assert!(
            loaded.diagnostics.is_empty(),
            "{uri}: {:?}",
            loaded.diagnostics
        );
        let mut arcs = 0;
        for object in loaded.model.objects() {
            if let Some(feature) = object.feature("place") {
                let targets: Vec<_> = object.refs(feature).collect();
                let [target] = targets.as_slice() else {
                    return Err(format!("{} must have one place", object.identity()));
                };
                assert_eq!(target.resource(), uri);
                assert!(target.feature("tokens").is_some(), "{}", target.identity());
                arcs += 1;
            }
        }
        assert_eq!(arcs, expected_arcs, "{uri}");
    }
    Ok(())
}

#[test]
fn invalid_nets_have_exactly_one_located_rule_issue() -> Result<(), String> {
    for (uri, text, code, snippet) in [
        (
            "invalid-weight.petri",
            include_str!("../models/invalid-weight.petri"),
            "petri.arc.weight",
            "0*a",
        ),
        (
            "invalid-no-arcs.petri",
            include_str!("../models/invalid-no-arcs.petri"),
            "petri.transition.arcs",
            "transition bad external : ->",
        ),
        (
            "invalid-no-input.petri",
            include_str!("../models/invalid-no-input.petri"),
            "petri.transition.input",
            "transition bad : -> a",
        ),
        (
            "invalid-duplicate-place.petri",
            include_str!("../models/invalid-duplicate-place.petri"),
            "petri.net.place_names",
            "net InvalidDuplicatePlace",
        ),
    ] {
        let loaded = examples_petri::load(&[source(uri, text)])?;
        let [diagnostic] = loaded.diagnostics.as_slice() else {
            return Err(format!(
                "{uri}: expected one issue, got {:?}",
                loaded.diagnostics
            ));
        };
        assert_eq!(diagnostic.issue.severity, Severity::Error);
        assert_eq!(diagnostic.issue.code, code);
        let location = diagnostic
            .location
            .as_ref()
            .ok_or("Missing object location")?;
        assert_eq!(location.resource, uri);
        assert!(!location.identity.is_empty());
        let (start, end) = location.span.ok_or("Missing source span")?;
        let slice = text.get(start..end).ok_or("Invalid source span")?;
        assert!(slice.starts_with(snippet), "{uri}: {slice:?}");
    }
    Ok(())
}
