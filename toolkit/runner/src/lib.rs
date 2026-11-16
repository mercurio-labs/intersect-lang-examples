//! Load saved models or rebuild them from editable source files.
mod pack;
mod project_files;
pub use pack::{build_pack, read_pack};
pub use project_files::editable_files;
#[cfg(feature = "native")]
mod project;
#[cfg(feature = "native")]
pub use project::{LoadedModel, build_project, inspect_pack, load_pack, unpack_pack};
#[cfg(target_arch = "wasm32")]
mod wasm;
