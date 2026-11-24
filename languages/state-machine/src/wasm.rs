//! Adapt the combined language and run host to the shared Views WASM worker.
use crate::Harness;
use serde_json::{Value, json};
use std::cell::RefCell;

#[derive(Default)]
struct Wire {
    host: Option<Harness>,
    input: Vec<u8>,
    output: Vec<u8>,
}

impl Wire {
    fn dispatch(&mut self) -> Result<Value, String> {
        let request = serde_json::from_slice(&self.input).map_err(|error| error.to_string())?;
        if self.host.is_none() {
            self.host = Some(Harness::new()?);
        }
        self.host
            .as_mut()
            .ok_or("Missing machine host")?
            .dispatch(request)
    }
}

thread_local! { static WIRE: RefCell<Wire> = RefCell::new(Wire::default()); }

#[unsafe(no_mangle)]
pub extern "C" fn input_buffer(length: usize) -> *mut u8 {
    WIRE.with(|wire| {
        let mut wire = wire.borrow_mut();
        wire.input.clear();
        if length > 256 * 1024 {
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
        let result = wire
            .dispatch()
            .unwrap_or_else(|error| json!({"error":error}));
        wire.output = result.to_string().into_bytes();
        wire.output.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn output_buffer() -> *const u8 {
    WIRE.with(|wire| wire.borrow().output.as_ptr())
}
