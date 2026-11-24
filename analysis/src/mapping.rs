use intersect_model::{
    core::model::{Element, Model},
    definitions::schema::{Feature, Schema},
};
use intersect_run::analysis::{
    AnalysisError, Constraint, ErrorCode, Expression, Quantity, Source, Unit, Variable, Variables,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mapping {
    pub root: String,
    pub subject_name: String,
    pub subject_cases: String,
    pub case_name: String,
    pub quantity: QuantityMapping,
    pub cases: BTreeMap<String, CaseMapping>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuantityMapping {
    class: String,
    value: String,
    unit: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseMapping {
    pub variables: BTreeMap<String, Binding>,
    pub operation: Operation,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Scope {
    Subject,
    Case,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    unit: Unit,
    from: Option<Scope>,
    feature: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    Check {
        constraint: Constraint,
        tolerance: f64,
    },
    Solve {
        constraint: Constraint,
        unknown: String,
    },
    Sweep {
        constraint: Constraint,
        unknown: String,
        parameter: String,
        samples: String,
    },
    Simulate {
        initial: String,
        rate: String,
        threshold: String,
        next_rate: Expression,
        end: String,
        interval: String,
        deadline: Option<String>,
    },
}

pub struct Selection<'a> {
    pub name: String,
    pub subject: &'a Element,
    pub case: &'a Element,
    pub mapping: &'a CaseMapping,
}

pub type Objects<'a> = BTreeMap<&'a str, &'a Element>;

impl Mapping {
    pub fn validate(&self, schema: &Schema) -> Result<(), String> {
        if self.cases.is_empty() {
            return Err("analysis mapping must declare at least one case class".into());
        }
        attribute(schema, &self.root, &self.subject_name, &["EString"])?;
        attribute(
            schema,
            &self.quantity.class,
            &self.quantity.value,
            &["EDouble", "EFloat", "EInt", "ELong", "EString"],
        )?;
        attribute(
            schema,
            &self.quantity.class,
            &self.quantity.unit,
            &["EString"],
        )?;
        for (class, mapping) in &self.cases {
            containment(schema, &self.root, &self.subject_cases, class, true)?;
            attribute(schema, class, &self.case_name, &["EString"])?;
            for (name, binding) in &mapping.variables {
                match (binding.from, &binding.feature) {
                    (Some(scope), Some(field)) => containment(
                        schema,
                        self.owner(scope, class),
                        field,
                        &self.quantity.class,
                        false,
                    )?,
                    (None, None) => (),
                    _ => return Err(format!("variable {name} needs both a scope and a feature")),
                }
            }
            let require = |name: &str| {
                mapping
                    .variables
                    .contains_key(name)
                    .then_some(())
                    .ok_or_else(|| format!("case {class} has no variable {name}"))
            };
            match &mapping.operation {
                Operation::Check { constraint, .. } => constraint_variables(constraint, &require)?,
                Operation::Solve {
                    constraint,
                    unknown,
                } => {
                    require(unknown)?;
                    constraint_variables(constraint, &require)?;
                }
                Operation::Sweep {
                    constraint,
                    unknown,
                    parameter,
                    samples,
                } => {
                    if unknown == parameter {
                        return Err(format!("case {class} sweeps its requested unknown"));
                    }
                    require(unknown)?;
                    require(parameter)?;
                    constraint_variables(constraint, &require)?;
                    containment(schema, class, samples, &self.quantity.class, true)?;
                }
                Operation::Simulate {
                    initial,
                    rate,
                    threshold,
                    next_rate,
                    end,
                    interval,
                    deadline,
                } => {
                    for name in [initial, rate, threshold, end, interval]
                        .into_iter()
                        .chain(deadline)
                    {
                        require(name)?;
                    }
                    expression_variables(next_rate, &require)?;
                }
            }
        }
        Ok(())
    }

    fn owner<'a>(&'a self, scope: Scope, case: &'a str) -> &'a str {
        match scope {
            Scope::Subject => &self.root,
            Scope::Case => case,
        }
    }

    pub fn select<'a>(
        &'a self,
        model: &'a Model,
        objects: &Objects<'a>,
        only: Option<&str>,
    ) -> Result<Vec<Selection<'a>>, AnalysisError> {
        let mut selections = BTreeMap::new();
        let mut subjects = BTreeMap::new();
        for subject in model
            .elements
            .iter()
            .filter(|element| element.class == self.root)
        {
            let subject_name = name(subject, &self.subject_name)?;
            if subjects.insert(subject_name, ()).is_some() {
                return Err(at(
                    ErrorCode::Invalid,
                    format!("duplicate subject {subject_name}"),
                    subject,
                ));
            }
            for case in children(subject, &self.subject_cases, objects)? {
                let case_name = name(case, &self.case_name)?;
                let name = format!("{subject_name}::{case_name}");
                if only.is_some_and(|name_to_run| name_to_run != name) {
                    continue;
                }
                let mapping = self.cases.get(&case.class).ok_or_else(|| {
                    at(
                        ErrorCode::Unsupported,
                        format!("no analysis mapping for {}", case.class),
                        case,
                    )
                })?;
                let selection = Selection {
                    name: name.clone(),
                    subject,
                    case,
                    mapping,
                };
                if selections.insert(name.clone(), selection).is_some() {
                    return Err(at(
                        ErrorCode::Invalid,
                        format!("duplicate case {name}"),
                        case,
                    ));
                }
            }
        }
        Ok(selections.into_values().collect())
    }

    pub fn variables(
        &self,
        selection: &Selection<'_>,
        objects: &Objects<'_>,
        overrides: &[&str],
    ) -> Result<Variables, AnalysisError> {
        selection
            .mapping
            .variables
            .iter()
            .map(|(name, binding)| {
                let mut variable = Variable {
                    unit: binding.unit,
                    value: None,
                    source: Some(location(selection.case)),
                };
                if !overrides.contains(&name.as_str())
                    && let (Some(scope), Some(field)) = (binding.from, &binding.feature)
                {
                    let owner = match scope {
                        Scope::Subject => selection.subject,
                        Scope::Case => selection.case,
                    };
                    let raw = owner.values.get(field).unwrap_or(&Value::Null);
                    if !raw.is_null() {
                        let element = child(owner, raw, objects)?;
                        let source = location(element);
                        variable.value = Some(
                            self.read_quantity(element)?
                                .in_unit(binding.unit, Some(&source))?,
                        );
                        variable.source = Some(source);
                    }
                }
                Ok((name.clone(), variable))
            })
            .collect()
    }

    pub fn sweep_values(
        &self,
        selection: &Selection<'_>,
        feature: &str,
        objects: &Objects<'_>,
    ) -> Result<Vec<(Quantity, Source)>, AnalysisError> {
        let children = children(selection.case, feature, objects)?;
        if children.is_empty() || children.len() > 1000 {
            return Err(at(
                ErrorCode::Budget,
                "a sweep needs between 1 and 1000 samples",
                selection.case,
            ));
        }
        children
            .into_iter()
            .map(|e| Ok((self.read_quantity(e)?, location(e))))
            .collect()
    }

    fn read_quantity(&self, element: &Element) -> Result<Quantity, AnalysisError> {
        let value = element
            .values
            .get(&self.quantity.value)
            .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
            .ok_or_else(|| {
                at(
                    ErrorCode::Invalid,
                    "quantity is missing a numeric value",
                    element,
                )
            })?;
        let raw_unit = element
            .values
            .get(&self.quantity.unit)
            .ok_or_else(|| at(ErrorCode::Dimension, "quantity is missing a unit", element))?;
        let unit = Unit::deserialize(raw_unit).map_err(|_| {
            at(
                ErrorCode::Dimension,
                format!("unsupported unit {raw_unit}"),
                element,
            )
        })?;
        Ok(Quantity { value, unit })
    }
}

fn constraint_variables(
    constraint: &Constraint,
    require: &impl Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    expression_variables(&constraint.left, require)?;
    expression_variables(&constraint.right, require)
}

fn expression_variables(
    expression: &Expression,
    require: &impl Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    match expression {
        Expression::Literal { .. } => Ok(()),
        Expression::Variable { name } => require(name),
        Expression::Add { left, right }
        | Expression::Subtract { left, right }
        | Expression::Multiply { left, right }
        | Expression::Divide { left, right } => {
            expression_variables(left, require)?;
            expression_variables(right, require)
        }
    }
}

fn attribute(schema: &Schema, class: &str, feature: &str, types: &[&str]) -> Result<(), String> {
    let field = field(schema, class, feature)?;
    if field.reference
        || field.derived
        || field.upper != 1
        || !types.contains(&field.target.as_str())
    {
        return Err(format!(
            "{class}.{feature} must be a stored single-valued {types:?} attribute (found {})",
            field.target
        ));
    }
    Ok(())
}

fn containment(
    schema: &Schema,
    class: &str,
    feature: &str,
    target: &str,
    many: bool,
) -> Result<(), String> {
    let field = field(schema, class, feature)?;
    let is_many = field.upper == -1 || field.upper > 1;
    if !field.reference
        || !field.containment
        || field.derived
        || many != is_many
        || !schema.ancestry(target)?.contains(&field.target.as_str())
    {
        return Err(format!(
            "{class}.{feature} must contain {target} with the declared multiplicity"
        ));
    }
    Ok(())
}

fn field(schema: &Schema, class: &str, feature: &str) -> Result<Feature, String> {
    schema
        .features(class)?
        .remove(feature)
        .ok_or_else(|| format!("{class} has no feature {feature}"))
}

fn name<'a>(element: &'a Element, feature: &str) -> Result<&'a str, AnalysisError> {
    element
        .values
        .get(feature)
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty() && !name.contains("::"))
        .ok_or_else(|| {
            at(
                ErrorCode::Invalid,
                format!("missing or invalid name in {feature}"),
                element,
            )
        })
}

fn children<'a>(
    element: &Element,
    feature: &str,
    model: &Objects<'a>,
) -> Result<Vec<&'a Element>, AnalysisError> {
    element
        .values
        .get(feature)
        .and_then(Value::as_array)
        .ok_or_else(|| {
            at(
                ErrorCode::Invalid,
                format!("missing collection {feature}"),
                element,
            )
        })?
        .iter()
        .map(|value| child(element, value, model))
        .collect()
}

fn child<'a>(
    owner: &Element,
    value: &Value,
    model: &Objects<'a>,
) -> Result<&'a Element, AnalysisError> {
    let id = value
        .as_str()
        .ok_or_else(|| at(ErrorCode::Invalid, "invalid model reference", owner))?;
    model.get(id).copied().ok_or_else(|| {
        at(
            ErrorCode::Invalid,
            format!("missing model object {id}"),
            owner,
        )
    })
}

pub fn location(element: &Element) -> Source {
    Source {
        uri: element.resource.clone(),
        start: element.start,
        end: element.end,
    }
}

fn at(code: ErrorCode, message: impl Into<String>, element: &Element) -> AnalysisError {
    AnalysisError::new(code, message, Some(&location(element)))
}
