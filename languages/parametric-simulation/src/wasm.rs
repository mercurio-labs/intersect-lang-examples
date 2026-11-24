//! Bounded transport for the shared Intersect Views WASM worker.
use super::{Request, compare, configuration};
use serde_json::{Value, json};
use std::cell::RefCell;

#[derive(Default)]
struct Buffers {
    input: Vec<u8>,
    output: Vec<u8>,
}
thread_local! { static WIRE: RefCell<Buffers> = RefCell::new(Buffers::default()); }

fn dispatch(bytes: &[u8]) -> Result<Value, String> {
    let request: Value = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    if request["method"] == "thermal/config" {
        return Ok(configuration());
    }
    if request["method"] != "thermal/compare" {
        return Err("Unknown thermal run request".into());
    }
    let params: Request =
        serde_json::from_value(request["params"].clone()).map_err(|error| error.to_string())?;
    let result = compare(params).map_err(|error| error.to_string())?;
    serde_json::to_value(result).map_err(|error| error.to_string())
}

#[unsafe(no_mangle)]
pub extern "C" fn input_buffer(length: usize) -> *mut u8 {
    WIRE.with(|wire| {
        let mut wire = wire.borrow_mut();
        wire.input.clear();
        if length > 4096 {
            return std::ptr::null_mut();
        }
        wire.input.resize(length, 0);
        wire.input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn execute() -> usize {
    WIRE.with(|wire| {
        let mut wire = wire.borrow_mut();
        let result = dispatch(&wire.input).unwrap_or_else(|error| json!({"error":error}));
        wire.output = result.to_string().into_bytes();
        wire.output.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn output_buffer() -> *const u8 {
    WIRE.with(|wire| wire.borrow().output.as_ptr())
}
