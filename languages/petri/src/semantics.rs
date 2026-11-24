//! Checked-model adapter for the timed token-flow engine.
use crate::engine::{Arc, Net, Place, TimedPetri, Transition, error};
use examples_support::Loaded;
use intersect_model::core::frozen::{Obj, Severity, ValueRef};
use intersect_run::RunError;

fn value<'a>(object: Obj<'a>, name: &str) -> Result<ValueRef<'a>, RunError> {
    object
        .feature(name)
        .and_then(|id| object.get(id))
        .ok_or_else(|| error(format!("{} has no {name}", object.identity())))
}

fn string<'a>(object: Obj<'a>, name: &str) -> Result<&'a str, RunError> {
    object
        .feature(name)
        .and_then(|id| object.str(id))
        .ok_or_else(|| error(format!("{} has no string {name}", object.identity())))
}

fn integer(object: Obj<'_>, name: &str, default: u64) -> Result<u64, RunError> {
    match value(object, name)? {
        ValueRef::Int(value) => {
            u64::try_from(value).map_err(|_| error(format!("{name} is negative")))
        }
        ValueRef::Null => Ok(default),
        ValueRef::Default(value) if value.is_null() => Ok(default),
        ValueRef::Default(value) | ValueRef::Json(value) => value
            .as_u64()
            .ok_or_else(|| error(format!("{} has an invalid {name}", object.identity()))),
        _ => Err(error(format!(
            "{} has a noninteger {name}",
            object.identity()
        ))),
    }
}

fn references<'a>(object: Obj<'a>, name: &str) -> Result<impl Iterator<Item = Obj<'a>>, RunError> {
    let id = object
        .feature(name)
        .ok_or_else(|| error(format!("{} has no reference {name}", object.identity())))?;
    Ok(object.refs(id))
}

fn arcs(object: Obj<'_>, name: &str) -> Result<Vec<Arc>, RunError> {
    references(object, name)?
        .map(|arc| {
            let place = references(arc, "place")?
                .next()
                .ok_or_else(|| error(format!("Unresolved arc {}", arc.identity())))?;
            Ok(Arc {
                place: place.identity().to_owned(),
                weight: integer(arc, "weight", 1)?,
            })
        })
        .collect()
}

fn delay(object: Obj<'_>) -> Result<u64, RunError> {
    let Some(delay) = references(object, "delay")?.next() else {
        return Ok(0);
    };
    let multiplier = match string(delay, "unit")? {
        "ms" => 1,
        "s" => 1_000,
        unit => return Err(error(format!("Unsupported delay unit {unit}"))),
    };
    integer(delay, "amount", 0)?
        .checked_mul(multiplier)
        .ok_or_else(|| error("Delay exceeds the millisecond time range"))
}

impl TimedPetri {
    /// Read one validated frozen net, retaining source-derived object identities.
    pub fn from_loaded(loaded: &Loaded) -> Result<Self, RunError> {
        if let Some(diagnostic) = loaded
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.issue.severity == Severity::Error)
        {
            return Err(error(format!(
                "{}: {}",
                diagnostic.issue.code, diagnostic.issue.message
            )));
        }

        let roots: Vec<_> = loaded
            .model
            .objects()
            .filter(|object| object.container().is_none())
            .collect();
        let [root] = roots.as_slice() else {
            return Err(error("Execution requires exactly one net"));
        };
        let places = references(*root, "places")?
            .map(|place| {
                Ok(Place {
                    id: place.identity().to_owned(),
                    name: string(place, "name")?.to_owned(),
                    tokens: integer(place, "tokens", 0)?,
                })
            })
            .collect::<Result<Vec<_>, RunError>>()?;
        let transitions = references(*root, "transitions")?
            .map(|transition| {
                Ok(Transition {
                    id: transition.identity().to_owned(),
                    name: string(transition, "name")?.to_owned(),
                    external: matches!(value(transition, "external")?, ValueRef::Bool(true)),
                    delay_ms: delay(transition)?,
                    inputs: arcs(transition, "inputs")?,
                    outputs: arcs(transition, "outputs")?,
                })
            })
            .collect::<Result<Vec<_>, RunError>>()?;
        Self::from_net(Net {
            name: string(*root, "name")?.to_owned(),
            places,
            transitions,
        })
    }
}
