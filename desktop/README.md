# Desktop wrapper

This directory documents the desktop packaging boundary for the dev web app.
The app is intentionally a thin wrapper that opens the dev web app; no
credentials or server files are embedded in the desktop bundle. The packaged
frontend is an isolated redirect page under `web/`, not the repository root.

The repository includes a real Tauri 2 source tree under `src-tauri/` and
`tauri.conf.json`. Install Rust stable, the Tauri Windows prerequisites, and
the Tauri CLI (`cargo install tauri-cli --version '^2'`). Run `cargo tauri dev`
for development or `cargo tauri build` to create MSI and NSIS installers.
The current machine does not yet have a usable Rust toolchain, so installer
generation remains unverified here.
