# TempoCue

TempoCue is an offline-first desktop stage timer for local presenter and OBS browser-source outputs.

This repository currently contains the first vertical slice:

- Tauri desktop shell configuration
- React controller at `/control`
- Presenter output at `/viewer`
- Transparent OBS overlay at `/obs`
- Lower-third output at `/lower-third`
- Agenda output at `/agenda`
- Local timer state model with start, pause, reset, skip, add/subtract time
- Rust-owned application state and Axum WebSocket server design on `127.0.0.1:4310`
- Port fallback through `4319`

## Development

Install dependencies:

```bash
npm install
```

Run the frontend only:

```bash
npm run dev
```

Run the Tauri app:

```bash
npm run tauri dev
```

The Tauri run requires a Rust toolchain. This shell did not have `rustc` or `cargo` available when the initial slice was created.

## Local URLs

When running inside Tauri, TempoCue starts a local read-only output server:

```text
http://localhost:4310/control
http://localhost:4310/viewer
http://localhost:4310/obs?transparent=true
http://localhost:4310/lower-third
http://localhost:4310/agenda
```

If `4310` is unavailable, the app tries the next available port up to `4319` and reports the active URLs in the controller.

## Next Implementation Steps

1. Add SQLite persistence for projects, rundowns, themes, and messages.
2. Add CSV import/export and project package export/import.
3. Expand timer modes beyond countdown/count-up.
4. Add LAN mode with explicit user opt-in and output-only access controls.
5. Add automated tests for timer math, duration parsing, WebSocket snapshot delivery, and port fallback.
