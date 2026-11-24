use intersect_thermal_profile::{Equilibrium, Inputs, Method, Request, ThermalRun, compare};

fn samples(run: &ThermalRun) -> Vec<f64> {
    run.trace
        .entries
        .iter()
        .filter_map(|entry| entry.observation.as_ref()?.get("temperatureC")?.as_f64())
        .collect()
}

#[test]
fn both_profiles_sample_at_the_same_times_and_match_the_analytic_reference()
-> Result<(), Box<dyn std::error::Error>> {
    let inputs = Inputs {
        power: 250.0,
        loss: 5.0,
    };
    let analytic = compare(Request {
        method: Method::Analytic,
        current: inputs,
    })?;
    let ode = compare(Request {
        method: Method::Ode,
        current: inputs,
    })?;
    for (analytical, numerical) in analytic.cases.iter().zip(&ode.cases) {
        let (reference, integrated) = (samples(analytical), samples(numerical));
        assert_eq!(reference.len(), 121);
        assert_eq!(integrated.len(), reference.len());
        for (expected, actual) in reference.iter().zip(integrated) {
            assert!((expected - actual).abs() < 2e-8);
        }
        assert_eq!(analytical.case, numerical.case);
        assert_eq!(
            analytical.trace.header.profile.nanos_per_tick,
            1_000_000_000
        );
        assert_eq!(
            analytical.trace.entries.last().ok_or("Missing end")?.time,
            1800
        );
    }
    let current = &ode.cases[1];
    assert!((samples(current)[40] - 65.89575006880507).abs() < 2e-8);
    assert!(
        matches!(current.summary.equilibrium, Equilibrium::Solved { celsius } if (celsius - 70.0).abs() < 1e-8)
    );
    Ok(())
}

#[test]
fn zero_loss_and_insufficient_heating_report_the_right_outcome()
-> Result<(), Box<dyn std::error::Error>> {
    for method in [Method::Analytic, Method::Ode] {
        let zero_loss = compare(Request {
            method,
            current: Inputs {
                power: 120.0,
                loss: 0.0,
            },
        })?;
        let run = &zero_loss.cases[1];
        assert!(matches!(
            run.summary.equilibrium,
            Equilibrium::NoFiniteSolution
        ));
        assert!((run.summary.target_seconds.ok_or("Missing target time")? - 200.0).abs() < 1e-8);
        assert!((samples(run)[40] - 80.0).abs() < 1e-8);
        let zero_power = compare(Request {
            method,
            current: Inputs {
                power: 0.0,
                loss: 0.0,
            },
        })?;
        assert!(matches!(
            zero_power.cases[1].summary.equilibrium,
            Equilibrium::Underdetermined
        ));
        assert!(zero_power.cases[1].summary.target_seconds.is_none());
        let too_cool = compare(Request {
            method,
            current: Inputs {
                power: 120.0,
                loss: 15.0,
            },
        })?;
        assert!(too_cool.cases[1].summary.target_seconds.is_none());
        assert!(!too_cool.cases[1].summary.target_reachable);
        let after_horizon = compare(Request {
            method,
            current: Inputs {
                power: 100.01,
                loss: 5.0,
            },
        })?;
        assert!(after_horizon.cases[1].summary.target_seconds.is_none());
        assert!(after_horizon.cases[1].summary.target_reachable);
    }
    assert!(
        compare(Request {
            method: Method::Ode,
            current: Inputs {
                power: f64::NAN,
                loss: 5.0
            }
        })
        .is_err()
    );
    Ok(())
}
