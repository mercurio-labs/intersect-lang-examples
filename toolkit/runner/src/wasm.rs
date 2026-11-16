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
        serde_json::from_slice::<serde_json::Value>(&input.borrow()).map_err(|e| e.to_string())
            .and_then(|input| Ok(serde_json::json!({"bytes":super::build_pack(&input)?,"files":super::editable_files(&input)?})))
    });
    let value = result.unwrap_or_else(|error| serde_json::json!({"error":error}));
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
