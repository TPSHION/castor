# Castor SSH Desktop (Tauri + Rust + React)

SSH desktop MVP with:

- React + xterm.js terminal UI
- Tauri command bridge
- Rust backend SSH session manager (`ssh2`)

## Implemented MVP

- Connect via password or private key (PEM)
- Interactive shell terminal
- Terminal input forwarding
- PTY resize forwarding
- Disconnect command
- Backend session cleanup when remote closes
- Connection profile management (save/load/delete)
- Profiles persisted in app config: `connection_profiles.json`
- Sensitive secrets (password/private key body/passphrase) are persisted in profiles stored in app config; protect `connection_profiles.json` accordingly

## Run

1. Install frontend deps (already done):

```bash
pnpm install
```

2. Install Rust toolchain (required by Tauri backend):

```bash
curl https://sh.rustup.rs -sSf | sh
```

3. Start app:

```bash
pnpm tauri dev
```

## Build frontend only

```bash
pnpm run build
```
