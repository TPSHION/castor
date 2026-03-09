# Castor Desktop (Tauri + Rust + React)

Castor is a desktop SSH + SFTP client built with React (frontend) and Rust (Tauri backend).

## Current Capabilities (v1.0.0)

- SSH terminal sessions (password / private key auth)
- Local terminal sessions
- Multi-tab session workspace with status + retry
- Server profile management (create/edit/delete/test)
- Dual-pane file manager (Local / Remote SFTP)
- Upload / download with progress, ETA, speed, cancel
- Conflict strategies for upload (auto rename / overwrite / manual rename)
- Drag-and-drop transfer (pane drag + system file drop upload)
- Remote permission editing (chmod bits + special bits)
- Transfer task panel (in-progress / completed + clear completed)

## Architecture

- Frontend:
  - `src/App.tsx`: app orchestration and state flow
  - `src/components/*`: terminal, SFTP, dialogs, menus, task panel
  - `src/app/hooks/*`: transfer progress, context menu dismiss, system drop queue
- Backend:
  - `src-tauri/src/ssh/mod.rs`: SSH/local PTY session runtime
  - `src-tauri/src/sftp.rs`: SFTP operations + transfer progress + cancel
  - `src-tauri/src/localfs.rs`: local filesystem operations
  - `src-tauri/src/profiles.rs`: profile persistence
  - `src-tauri/src/commands.rs`: Tauri command bridge

## Development

1. Install dependencies:

```bash
pnpm install
```

2. Ensure Rust toolchain is available:

```bash
curl https://sh.rustup.rs -sSf | sh
```

3. Start desktop app in dev mode:

```bash
pnpm tauri dev
```

## Build

- Frontend only:

```bash
pnpm run build
```

## Notes

- Connection profiles are stored in app config as `connection_profiles.json`.
- Sensitive secrets (password/private key/passphrase) are currently persisted in plain text in that file.
- See implementation summary: `docs/v1.0.0-implementation-summary.md`
- See developer module map: `docs/developer-module-quick-reference.md`
