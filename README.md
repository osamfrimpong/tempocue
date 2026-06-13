# TempoCue

TempoCue is an offline production timer for local presenter, stage, and OBS browser-source outputs. It is built as a Tauri 2 desktop app with a React/Vite frontend and a Rust backend that owns the shared timer/rundown state.

## Current State

TempoCue currently includes:

- A desktop controller at `/control`
- Presenter output at `/viewer`
- Transparent OBS overlay at `/obs?transparent=true`
- Lower-third output at `/lower-third`
- Agenda output at `/agenda`
- Timer color threshold settings at `/settings`
- Countdown and "end at time" timer control
- Start, pause, reset, next-item, add/subtract time, and direct remaining-time adjustment
- Editable rundown items with title, speaker, duration, notes, and supporting file paths/URLs
- Per-rundown-item timer state while switching between items
- Blackout and hide-timer controls for outputs
- Lower-third message display with body styling, color options, flash, and hide
- Keyboard shortcuts for common show-control actions
- WebSocket snapshot/update delivery for output windows
- Local frontend fallback behavior when running outside Tauri

State is currently in memory. Restarting the app resets the rundown, timer state, and output state to the built-in defaults. Timer color thresholds are stored in browser local storage.

## Architecture

- Frontend: React 19, React Router, Zustand, Tailwind CSS, Vite
- Desktop shell: Tauri 2
- Backend: Rust commands plus an Axum output server
- Realtime transport: WebSocket endpoint at `/ws`
- Embedded production assets: `rust-embed` serves the built `dist` bundle from the Tauri server

When running in Tauri, frontend actions call Rust commands through `@tauri-apps/api`. The Rust state broadcasts snapshots and updates over WebSocket so browser outputs stay in sync.

## Development

Install dependencies:

```bash
npm install
```

Run the frontend only:

```bash
npm run dev
```

Run the Tauri desktop app:

```bash
npm run tauri dev
```

Build the frontend:

```bash
npm run build
```

Build the Tauri app:

```bash
npm run tauri build
```

Tauri development and builds require a Rust toolchain with Cargo.

## Local URLs

In the desktop app, TempoCue starts an output server on port `4310` by default and falls back through `4319` if earlier ports are unavailable.

Typical local URLs:

```text
http://localhost:4310/control
http://localhost:4310/viewer
http://localhost:4310/obs?transparent=true
http://localhost:4310/lower-third
http://localhost:4310/agenda
```

If the backend can detect a non-loopback local IPv4 address, it binds to all interfaces and advertises URLs using that LAN address. Otherwise it binds to localhost. The active URLs and port are shown in the controller.

## Keyboard Shortcuts

- `Space`: start or pause the timer
- `R`: reset the timer
- `N`: select the next rundown item
- `B`: toggle blackout
- `+`: add one minute
- `-`: subtract one minute
- `Esc`: hide the active message

Shortcuts are ignored while typing in text inputs or textareas.

## Supporting Files

Rundown items can include supporting file entries, one per line. HTTP and HTTPS entries open directly. Local file paths are served back through the TempoCue output server at `/supporting-file/...` so the controller can open them from the active item.

## Not Yet Implemented

- Durable project/rundown persistence
- CSV import/export
- Project package export/import
- Explicit LAN sharing controls and output-only access restrictions
- Additional timer modes surfaced in the UI
- Automated test coverage for timer math, WebSocket delivery, and server port fallback
