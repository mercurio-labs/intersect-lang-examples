use crate::{
    TEXT_LIMITS, diagnostic,
    mapping::{Objects, Operation},
    pack::{self, LoadedPack},
    report::{AFFINE, Case, Report, ResultValue},
    resource_uri,
};
use intersect_kerml::{
    frozen_load::prediction_memo_mode_from_env,
    language_pack::{
        LibraryOptions, load_pack_sysml_bindings, pack_library_payload, prepare_library,
    },
    native_pilot::NativePilotSession,
    sysml_host::{SysmlBindings, with_sysml_host},
};
use intersect_kerml_eval::{
    EvalError, EvalMode, Evaluator, Model, ObjId,
    analysis_case::{Operator, ScalarUnit, SolveBody, SolveCase, Term},
};
use intersect_model::{
    core::frozen::SnapshotTrust,
    definitions::{
        conversion::InvocationContext,
        pack::{FileDigest, LanguagePack},
    },
};
use intersect_run::analysis::{
    AnalysisError, Comparison, Constraint, ErrorCode, Expression, Quantity, Source, Unit, Variable,
    Variables, solve,
};
use intersect_text::{Source as TextSource, grammar::RuntimeAdmissionLoadMode};
use std::{collections::BTreeMap, path::Path};

struct InputFile {
    values: BTreeMap<String, Quantity>,
    source: Source,
    digest: String,
}

impl InputFile {
    fn read(path: &Path) -> Result<Self, String> {
        let text = pack::read_source(path)?;
        let values =
            serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;
        Ok(Self {
            values,
            source: Source {
                uri: resource_uri(path),
                start: 0,
                end: text.len(),
            },
            digest: FileDigest::of(text.as_bytes()).sha256,
        })
    }
}

pub fn run(
    pack_file: &Path,
    model: &Path,
    name: &str,
    body_file: Option<&Path>,
    input_file: Option<&Path>,
) -> Result<Report, String> {
    let bytes = pack::read(pack_file, 512 * 1024 * 1024)?;
    let pack_digest = FileDigest::of(&bytes).sha256;
    let pack = LanguagePack::read(bytes).map_err(|error| error.to_string())?;
    let body = body_file.map(pack::load).transpose()?;
    let inputs = input_file.map(InputFile::read).transpose()?;
    let text = TextSource {
        uri: resource_uri(model),
        text: pack::read_source(model)?,
    };
    let model_digest = FileDigest::of(text.text.as_bytes()).sha256;
    let session = NativePilotSession::from_pack(&pack, RuntimeAdmissionLoadMode::HostCache)?;
    let (bundle, scopes) = load_pack_sysml_bindings(&pack)?;
    let identity = intersect_kerml::sdk::bindings_identity(&bundle);
    let bindings = SysmlBindings {
        bundle: &bundle,
        scopes: &scopes,
        identity: &identity,
    };
    let cases = with_sysml_host(
        &session,
        &InvocationContext::default(),
        bindings,
        prediction_memo_mode_from_env()?,
        |host| {
            let payload = pack_library_payload(&pack).transpose()?;
            let prepared = prepare_library(
                payload,
                None,
                host.context(),
                LibraryOptions {
                    use_snapshot: true,
                    trust: SnapshotTrust::HostCache,
                },
                |sources| host.parse_library(sources, &|_| {}).map(|(model, _)| model),
            )?;
            let loaded =
                host.load_on_library(&prepared.model, std::slice::from_ref(&text), &|_| {})?;
            if !loaded.is_clean() {
                let mut errors: Vec<_> = loaded
                    .diagnostics
                    .into_iter()
                    .filter(|d| d.is_error())
                    .map(|d| {
                        let source = d
                            .resource
                            .zip(d.start.zip(d.end))
                            .map(|(uri, (start, end))| Source { uri, start, end });
                        Case::error(
                            name,
                            AnalysisError::new(ErrorCode::Invalid, d.message, source.as_ref()),
                        )
                    })
                    .collect();
                if errors.is_empty() {
                    errors.push(Case::error(
                        name,
                        AnalysisError::new(
                            ErrorCode::Invalid,
                            "SysML model did not load cleanly",
                            None,
                        ),
                    ));
                }
                return Ok(errors);
            }
            let model = loaded.model.ok_or("missing validated SysML model")?;
            let evaluator =
                Evaluator::new(&model, EvalMode::Extended).map_err(|error| error.to_string())?;
            let result = match evaluator.describe_solve(name) {
                Ok(case) => execute(&model, &text, name, case, body.as_ref(), inputs.as_ref()),
                Err(error) => {
                    let source = match &error {
                        EvalError::Model { object, .. } => model
                            .objects()
                            .find(|o| o.identity() == object)
                            .and_then(|object| location(&model, object.id())),
                        _ => None,
                    };
                    Case::error(
                        name,
                        AnalysisError::new(
                            ErrorCode::Unsupported,
                            error.to_string(),
                            source.as_ref(),
                        ),
                    )
                }
            };
            Ok(vec![result])
        },
    )?;
    let mut report = Report::new(pack_digest, model_digest, cases);
    report.body_pack_sha256 = body.map(|pack| pack.digest);
    report.inputs_sha256 = inputs.map(|file| file.digest);
    Ok(report)
}

fn execute(
    model: &Model,
    text: &TextSource,
    name: &str,
    case: SolveCase,
    body_pack: Option<&LoadedPack>,
    inputs: Option<&InputFile>,
) -> Case {
    let source = location(model, case.object);
    match solve_case(model, text, case, body_pack, inputs) {
        Ok((result, inputs)) => Case::result(
            name,
            source.unwrap_or(Source {
                uri: text.uri.clone(),
                start: 0,
                end: text.text.len(),
            }),
            result,
            inputs,
            None,
        ),
        Err(error) => Case::error(name, error),
    }
}

fn solve_case(
    model: &Model,
    text: &TextSource,
    case: SolveCase,
    body_pack: Option<&LoadedPack>,
    inputs: Option<&InputFile>,
) -> Result<(ResultValue, Variables), AnalysisError> {
    let mut variables: Variables = case
        .parameters
        .into_iter()
        .map(|(name, parameter)| {
            let unit = convert_unit(parameter.unit);
            let source = location(model, parameter.source);
            let value = parameter
                .value
                .map(|(value, unit_found)| {
                    Quantity {
                        value,
                        unit: convert_unit(unit_found),
                    }
                    .in_unit(unit, source.as_ref())
                })
                .transpose()?;
            Ok((
                name,
                Variable {
                    unit,
                    value,
                    source,
                },
            ))
        })
        .collect::<Result<_, _>>()?;
    bind_inputs(&mut variables, &case.result, inputs)?;
    let value = match case.body {
        SolveBody::Equation {
            object,
            left,
            right,
        } => solve(
            &Constraint {
                left: expression(left),
                comparison: Comparison::Equal,
                right: expression(right),
                source: location(model, object),
            },
            &variables,
            &case.result,
        )?,
        SolveBody::Representation {
            object,
            language,
            body,
        } => {
            let source = location(model, object);
            let unsupported =
                |message| AnalysisError::new(ErrorCode::Unsupported, message, source.as_ref());
            let pack = body_pack
                .ok_or_else(|| unsupported("the selected SysML analysis requires --body-pack"))?;
            if !language.eq_ignore_ascii_case(&pack.language.schema.uri) {
                return Err(unsupported(
                    "the body pack does not match the declared language",
                ));
            }
            let (body, offsets) = embedded_source(text, source.as_ref(), body)?;
            let embedded_uri = body.uri.clone();
            embedded_solve(body, pack, &variables, &case.result).map_err(|mut error| {
                if let Some(location) = error.source.as_mut()
                    && location.uri == embedded_uri
                {
                    if let (Some(start), Some(end)) =
                        (offsets.get(location.start), offsets.get(location.end))
                    {
                        *location = Source {
                            uri: text.uri.clone(),
                            start: *start,
                            end: *end,
                        };
                    } else {
                        error.source = source.clone();
                    }
                }
                error
            })?
        }
    };
    Ok((
        ResultValue::Solve {
            backend: AFFINE,
            unknown: case.result,
            value,
        },
        variables,
    ))
}

fn bind_inputs(
    variables: &mut Variables,
    result: &str,
    file: Option<&InputFile>,
) -> Result<(), AnalysisError> {
    if let Some(file) = file {
        for (name, value) in &file.values {
            let source = Some(&file.source);
            let variable = variables.get_mut(name).ok_or_else(|| {
                AnalysisError::new(
                    ErrorCode::Unbound,
                    format!("no analysis input {name}"),
                    source,
                )
            })?;
            if name == result || variable.value.is_some() {
                return Err(AnalysisError::new(
                    ErrorCode::Invalid,
                    format!("cannot bind analysis result or fixed input {name}"),
                    source,
                ));
            }
            variable.value = Some(value.in_unit(variable.unit, source)?);
            variable.source = Some(file.source.clone());
        }
    }
    for (name, variable) in variables {
        if name != result && variable.value.is_none() {
            return Err(AnalysisError::new(
                ErrorCode::Unbound,
                format!("no value for SysML input {name}"),
                variable.source.as_ref(),
            ));
        }
    }
    Ok(())
}

fn embedded_source(
    text: &TextSource,
    source: Option<&Source>,
    stored: String,
) -> Result<(TextSource, Vec<usize>), AnalysisError> {
    let bad_span = || {
        AnalysisError::new(
            ErrorCode::Invalid,
            "cannot locate exact embedded body in SysML source",
            source,
        )
    };
    let source = source
        .filter(|source| source.uri == text.uri)
        .ok_or_else(bad_span)?;
    let representation = text
        .text
        .get(source.start..source.end)
        .ok_or_else(bad_span)?;
    let start = representation.find("/*").ok_or_else(bad_span)? + 2;
    let end = representation.rfind("*/").ok_or_else(bad_span)?;
    let body = representation.get(start..end).ok_or_else(bad_span)?;
    let offsets = comment_offsets(body, &stored, source.start + start).ok_or_else(bad_span)?;
    Ok((
        TextSource {
            uri: format!("{}.body", source.uri),
            text: stored,
        },
        offsets,
    ))
}

// The KerML loader strips line indentation and optional comment stars.
// Map each retained byte back to the corresponding raw line suffix.
fn comment_offsets(raw: &str, stored: &str, base: usize) -> Option<Vec<usize>> {
    let mut separators = raw.match_indices(['\r', '\n']).peekable();
    let mut lines = Vec::new();
    let mut start = 0;
    while let Some((end, separator)) = separators.next() {
        lines.push(start..end);
        start = end + 1;
        if separator == "\r" && separators.peek() == Some(&(start, "\n")) {
            separators.next();
            start += 1;
        }
    }
    lines.push(start..raw.len());
    let stored_lines: Vec<_> = stored.split('\n').collect();
    let omit_first =
        lines.len() == stored_lines.len() + 1 && raw.get(lines.first()?.clone())?.trim().is_empty();
    let lines = &lines[usize::from(omit_first)..];
    if lines.len() != stored_lines.len() {
        return None;
    }
    let mut offsets = Vec::with_capacity(stored.len() + 1);
    for (line, stored_line) in lines.iter().zip(stored_lines) {
        let removed = raw.get(line.clone())?.strip_suffix(stored_line)?;
        if !matches!(removed.trim(), "" | "*") {
            return None;
        }
        // Include the newline's original position or the final position.
        offsets.extend((base + line.start + removed.len())..=(base + line.end));
    }
    (offsets.len() == stored.len() + 1).then_some(offsets)
}

fn embedded_solve(
    source: TextSource,
    pack: &LoadedPack,
    inputs: &Variables,
    result_name: &str,
) -> Result<Quantity, AnalysisError> {
    let evaluation = intersect_text::evaluate_with_limits(&pack.language, &[source], TEXT_LIMITS);
    if let Some(first) = evaluation.diagnostics.first() {
        return Err(diagnostic(first));
    }
    let model = evaluation.model;
    let objects: Objects<'_> = model
        .elements
        .iter()
        .map(|object| (object.id.as_str(), object))
        .collect();
    let selections = pack.mapping.select(&model, &objects, None)?;
    let [selection] = selections.as_slice() else {
        return Err(AnalysisError::new(
            ErrorCode::Invalid,
            "embedded body must declare one analysis case",
            None,
        ));
    };
    let source = crate::mapping::location(selection.case);
    let invalid = |message| AnalysisError::new(ErrorCode::Invalid, message, Some(&source));
    let Operation::Solve {
        constraint,
        unknown,
    } = &selection.mapping.operation
    else {
        return Err(invalid("embedded analysis must be a solve case"));
    };
    if unknown != result_name {
        return Err(invalid(
            "embedded unknown must match the SysML return parameter",
        ));
    }
    let mut variables = pack.mapping.variables(selection, &objects, &[unknown])?;
    for (name, input) in inputs {
        let target = variables.get_mut(name).ok_or_else(|| {
            AnalysisError::new(
                ErrorCode::Unbound,
                format!("embedded case has no parameter {name}"),
                Some(&source),
            )
        })?;
        let typed = Quantity {
            value: input.value.unwrap_or(0.0),
            unit: input.unit,
        };
        let converted = typed.in_unit(target.unit, Some(&source))?;
        target.value = input.value.map(|_| converted);
        target.source = input.source.clone();
    }
    let mut constraint = constraint.clone();
    constraint.source = Some(source.clone());
    let value = solve(&constraint, &variables, unknown)?;
    let unit = inputs
        .get(result_name)
        .ok_or_else(|| invalid("missing SysML return parameter"))?
        .unit;
    Ok(Quantity {
        value: value.in_unit(unit, Some(&source))?,
        unit,
    })
}

fn convert_unit(unit: ScalarUnit) -> Unit {
    match unit {
        ScalarUnit::Scalar => Unit::Scalar,
        ScalarUnit::Litre => Unit::Litre,
        ScalarUnit::Second => Unit::Second,
        ScalarUnit::LitresPerSecond => Unit::LitresPerSecond,
    }
}

fn expression(term: Term) -> Expression {
    match term {
        Term::Parameter(name) => Expression::Variable { name },
        Term::Literal(value, unit) => Expression::Literal {
            quantity: Quantity {
                value,
                unit: convert_unit(unit),
            },
        },
        Term::Binary {
            operator,
            left,
            right,
        } => {
            let left = Box::new(expression(*left));
            let right = Box::new(expression(*right));
            match operator {
                Operator::Add => Expression::Add { left, right },
                Operator::Subtract => Expression::Subtract { left, right },
                Operator::Multiply => Expression::Multiply { left, right },
                Operator::Divide => Expression::Divide { left, right },
            }
        }
    }
}

fn location(model: &Model, object: ObjId) -> Option<Source> {
    let object = model.obj(object)?;
    let (start, end) = object.span();
    Some(Source {
        uri: object.resource().into(),
        start,
        end,
    })
}

#[cfg(test)]
mod tests {
    use super::comment_offsets;

    #[test]
    fn embedded_offsets_follow_utf8_and_normalized_comment_lines() {
        let raw = "\r\n * café\r * 2 L\r\n  ";
        let stored = "café\n2 L\n";
        let base = 30;
        let offsets = comment_offsets(raw, stored, base).unwrap();
        let start = stored.find("2 L").unwrap();
        let original = offsets[start] - base..offsets[start + 3] - base;
        assert_eq!(&raw[original], "2 L");
    }
}
