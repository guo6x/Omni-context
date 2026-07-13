# Generated Brain Server staging directory

The desktop packaging scripts replace this directory with the built Brain Server,
its production dependencies, and the embedded Node runtime. This tracked file keeps
the Tauri resource glob valid in a clean source checkout so `cargo check`, Clippy,
and Rust tests do not depend on untracked packaging output.
