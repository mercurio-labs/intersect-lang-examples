// Uses the same three-call buffer protocol as the thermal browser worker.
use crate::pack::{Archive, MAX_ARCHIVE_WIRE_BYTES, RunRequest};
use serde::Deserialize;
use serde_json::json;
use std::cell::RefCell;

#[derive(Default)]
struct Buffers {
    input: Vec<u8>,
    output: Vec<u8>,
}

thread_local! { static WIRE: RefCell<Buffers> = RefCell::new(Buffers::default()); }

#[derive(Deserialize)]
#[serde(untagged)]
enum Request {
    Archive(ArchiveRequest),
    Source(SourceRequest),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveRequest {
    archive: Archive,
    request: RunRequest,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceRequest {
    uri: String,
    source: String,
}

fn dispatch(bytes: &[u8]) -> Result<Vec<u8>, String> {
    match serde_json::from_slice(bytes).map_err(|error| error.to_string())? {
        Request::Archive(call) => serde_json::to_vec(&call.archive.run(call.request)?),
        Request::Source(call) => {
            let result =
                crate::run_source(&call.uri, &call.source).map_err(|error| error.to_string())?;
            serde_json::to_vec(&result)
        }
    }
    .map_err(|error| error.to_string())
}

#[unsafe(no_mangle)]
pub extern "C" fn input_buffer(length: usize) -> *mut u8 {
    WIRE.with(|wire| {
        let mut wire = wire.borrow_mut();
        wire.input.clear();
        if length > MAX_ARCHIVE_WIRE_BYTES {
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
        wire.output = dispatch(&wire.input)
            .unwrap_or_else(|error| json!({ "error": error }).to_string().into_bytes());
        wire.output.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn output_buffer() -> *const u8 {
    WIRE.with(|wire| wire.borrow().output.as_ptr())
}
