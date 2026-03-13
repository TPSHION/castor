use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use ssh2::Session;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthConfig {
    Password {
        password: String,
    },
    PrivateKey {
        private_key: String,
        passphrase: Option<String>,
    },
}

fn with_temp_private_key_file<T, F>(private_key: &str, task: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String>,
{
    let temp_path = env::temp_dir().join(format!("castor-ssh-key-{}.pem", Uuid::new_v4()));
    fs::write(&temp_path, private_key)
        .map_err(|err| format!("failed to prepare temporary private key file: {err}"))?;
    let result = task(&temp_path);
    let _ = fs::remove_file(&temp_path);
    result
}

fn authenticate_with_private_key(
    session: &mut Session,
    username: &str,
    private_key: &str,
    passphrase: Option<&str>,
) -> Result<(), String> {
    let trimmed = private_key.trim();
    if trimmed.starts_with("-----BEGIN ") {
        return with_temp_private_key_file(private_key, |key_path| {
            session
                .userauth_pubkey_file(username, None, key_path, passphrase)
                .map_err(|err| format!("private key authentication failed: {err}"))
        });
    }

    let key_path = Path::new(trimmed);
    if !key_path.exists() {
        return Err(format!("private key file not found: {trimmed}"));
    }

    session
        .userauth_pubkey_file(username, None, key_path, passphrase)
        .map_err(|err| format!("private key authentication failed: {err}"))
}

pub fn authenticate_session(
    session: &mut Session,
    username: &str,
    auth: &AuthConfig,
) -> Result<(), String> {
    match auth {
        AuthConfig::Password { password } => session
            .userauth_password(username, password)
            .map_err(|err| format!("password authentication failed: {err}"))?,
        AuthConfig::PrivateKey {
            private_key,
            passphrase,
        } => authenticate_with_private_key(session, username, private_key, passphrase.as_deref())?,
    }

    if !session.authenticated() {
        return Err("ssh authentication was rejected".to_string());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ConnectRequest {
    pub session_id: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub auth: AuthConfig,
    pub cols: Option<u32>,
    pub rows: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct LocalConnectRequest {
    pub session_id: Option<String>,
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub cols: Option<u32>,
    pub rows: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SendInputRequest {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct ResizeRequest {
    pub session_id: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Deserialize)]
pub struct DisconnectRequest {
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub host: String,
    pub username: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct OutputPayload {
    pub session_id: String,
    pub stream: String,
    pub data: String,
}

enum SessionCommand {
    Input(String),
    Resize { cols: u32, rows: u32 },
    Disconnect,
}

struct SessionControl {
    cmd_tx: mpsc::Sender<SessionCommand>,
    summary: SessionSummary,
}

struct SessionRuntime {
    cmd_tx: mpsc::Sender<SessionCommand>,
}

enum LocalRuntimeEvent {
    Output(String),
    Ended(String),
}

#[derive(Default)]
pub struct SshState {
    sessions: Arc<Mutex<HashMap<String, SessionControl>>>,
}

impl SshState {
    pub async fn connect(
        &self,
        app: AppHandle,
        mut request: ConnectRequest,
    ) -> Result<SessionSummary, String> {
        let session_id = request
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        {
            let sessions = self.sessions.lock().map_err(|_| "session lock poisoned")?;
            if sessions.contains_key(&session_id) {
                return Err(format!("session {} already exists", session_id));
            }
        }

        request.session_id = Some(session_id.clone());
        let host = request.host.clone();
        let username = request.username.clone();

        let sessions_for_cleanup = Arc::clone(&self.sessions);
        let runtime = tauri::async_runtime::spawn_blocking(move || {
            connect_blocking(app, request, sessions_for_cleanup)
        })
        .await
        .map_err(|err| format!("join error: {err}"))??;

        let summary = SessionSummary {
            session_id: session_id.clone(),
            host,
            username,
        };

        let mut sessions = self.sessions.lock().map_err(|_| "session lock poisoned")?;
        sessions.insert(
            session_id,
            SessionControl {
                cmd_tx: runtime.cmd_tx,
                summary: summary.clone(),
            },
        );

        Ok(summary)
    }

    pub async fn connect_local(
        &self,
        app: AppHandle,
        mut request: LocalConnectRequest,
    ) -> Result<SessionSummary, String> {
        let session_id = request
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        {
            let sessions = self.sessions.lock().map_err(|_| "session lock poisoned")?;
            if sessions.contains_key(&session_id) {
                return Err(format!("session {} already exists", session_id));
            }
        }

        request.session_id = Some(session_id.clone());
        let username = env::var("USER")
            .or_else(|_| env::var("USERNAME"))
            .unwrap_or_else(|_| "local".to_string());
        let host = "localhost".to_string();

        let sessions_for_cleanup = Arc::clone(&self.sessions);
        let runtime = tauri::async_runtime::spawn_blocking(move || {
            connect_local_blocking(app, request, sessions_for_cleanup)
        })
        .await
        .map_err(|err| format!("join error: {err}"))??;

        let summary = SessionSummary {
            session_id: session_id.clone(),
            host,
            username,
        };

        let mut sessions = self.sessions.lock().map_err(|_| "session lock poisoned")?;
        sessions.insert(
            session_id,
            SessionControl {
                cmd_tx: runtime.cmd_tx,
                summary: summary.clone(),
            },
        );

        Ok(summary)
    }

    pub fn send_input(&self, request: SendInputRequest) -> Result<(), String> {
        self.send_command(&request.session_id, SessionCommand::Input(request.data))
    }

    pub fn resize(&self, request: ResizeRequest) -> Result<(), String> {
        self.send_command(
            &request.session_id,
            SessionCommand::Resize {
                cols: request.cols,
                rows: request.rows,
            },
        )
    }

    pub fn disconnect(&self, request: DisconnectRequest) -> Result<(), String> {
        let control = {
            let mut sessions = self.sessions.lock().map_err(|_| "session lock poisoned")?;
            sessions.remove(&request.session_id)
        };

        if let Some(control) = control {
            control
                .cmd_tx
                .send(SessionCommand::Disconnect)
                .map_err(|_| "failed to notify session thread".to_string())?;
            return Ok(());
        }

        Err(format!("session {} not found", request.session_id))
    }

    pub fn list_sessions(&self) -> Vec<SessionSummary> {
        self.sessions
            .lock()
            .ok()
            .map(|sessions| {
                sessions
                    .values()
                    .map(|session| session.summary.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn send_command(&self, session_id: &str, command: SessionCommand) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "session lock poisoned")?;
        let control = sessions
            .get(session_id)
            .ok_or_else(|| format!("session {} not found", session_id))?;

        control
            .cmd_tx
            .send(command)
            .map_err(|_| "failed to send command to ssh thread".to_string())
    }

    pub async fn test_connection(&self, mut request: ConnectRequest) -> Result<String, String> {
        request.session_id = None;
        tauri::async_runtime::spawn_blocking(move || test_connection_blocking(request))
            .await
            .map_err(|err| format!("join error: {err}"))??;
        Ok("connection test passed".to_string())
    }
}

fn connect_blocking(
    app: AppHandle,
    request: ConnectRequest,
    sessions: Arc<Mutex<HashMap<String, SessionControl>>>,
) -> Result<SessionRuntime, String> {
    let session_id = request
        .session_id
        .clone()
        .ok_or_else(|| "session_id missing".to_string())?;
    let host = request.host;
    let port = request.port.unwrap_or(22);
    let username = request.username;
    let cols = request.cols.unwrap_or(120);
    let rows = request.rows.unwrap_or(40);

    let addr = format!("{host}:{port}");
    let tcp =
        TcpStream::connect(&addr).map_err(|err| format!("failed to connect {addr}: {err}"))?;

    let mut session =
        Session::new().map_err(|err| format!("failed to create SSH session: {err}"))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|err| format!("ssh handshake failed: {err}"))?;

    authenticate_session(&mut session, &username, &request.auth)?;

    let mut channel = session
        .channel_session()
        .map_err(|err| format!("failed to open channel: {err}"))?;
    channel
        .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
        .map_err(|err| format!("failed to request PTY: {err}"))?;
    channel
        .shell()
        .map_err(|err| format!("failed to start shell: {err}"))?;
    // Keep connect/auth/channel setup in blocking mode; switch to non-blocking
    // only after the interactive shell is ready to avoid EAGAIN on open.
    session.set_blocking(false);

    emit(
        &app,
        OutputPayload {
            session_id: session_id.clone(),
            stream: "status".to_string(),
            data: format!("connected to {username}@{host}:{port}"),
        },
    );

    let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>();
    let session_id_for_thread = session_id.clone();
    thread::spawn(move || {
        let mut stdout_buf = [0_u8; 8192];
        let mut stderr_buf = [0_u8; 4096];
        let mut status_message: Option<String> = None;

        loop {
            while let Ok(cmd) = cmd_rx.try_recv() {
                match cmd {
                    SessionCommand::Input(data) => {
                        if let Err(err) = channel.write_all(data.as_bytes()) {
                            status_message = Some(format!("input write failed: {err}"));
                            break;
                        }
                        let _ = channel.flush();
                    }
                    SessionCommand::Resize { cols, rows } => {
                        let _ = channel.request_pty_size(cols, rows, None, None);
                    }
                    SessionCommand::Disconnect => {
                        status_message = Some("disconnected".to_string());
                        break;
                    }
                }
            }
            if status_message.is_some() {
                break;
            }

            match channel.read(&mut stdout_buf) {
                Ok(bytes_read) if bytes_read > 0 => {
                    let data = String::from_utf8_lossy(&stdout_buf[..bytes_read]).to_string();
                    emit(
                        &app,
                        OutputPayload {
                            session_id: session_id_for_thread.clone(),
                            stream: "stdout".to_string(),
                            data,
                        },
                    );
                }
                Ok(_) => {}
                Err(err) if err.kind() == ErrorKind::WouldBlock => {}
                Err(err) => {
                    status_message = Some(format!("stdout read failed: {err}"));
                    break;
                }
            }

            {
                let mut stderr = channel.stderr();
                match stderr.read(&mut stderr_buf) {
                    Ok(bytes_read) if bytes_read > 0 => {
                        let data = String::from_utf8_lossy(&stderr_buf[..bytes_read]).to_string();
                        emit(
                            &app,
                            OutputPayload {
                                session_id: session_id_for_thread.clone(),
                                stream: "stderr".to_string(),
                                data,
                            },
                        );
                    }
                    Ok(_) => {}
                    Err(err) if err.kind() == ErrorKind::WouldBlock => {}
                    Err(err) => {
                        status_message = Some(format!("stderr read failed: {err}"));
                        break;
                    }
                }
            }
            if status_message.is_some() {
                break;
            }

            if channel.eof() {
                status_message = Some("remote session closed".to_string());
                break;
            }

            thread::sleep(Duration::from_millis(10));
        }

        let _ = channel.close();
        let _ = channel.wait_close();

        if let Some(message) = status_message {
            emit(
                &app,
                OutputPayload {
                    session_id: session_id_for_thread.clone(),
                    stream: "status".to_string(),
                    data: message,
                },
            );
        }

        if let Ok(mut open_sessions) = sessions.lock() {
            open_sessions.remove(&session_id_for_thread);
        }
    });

    Ok(SessionRuntime { cmd_tx })
}

fn connect_local_blocking(
    app: AppHandle,
    request: LocalConnectRequest,
    sessions: Arc<Mutex<HashMap<String, SessionControl>>>,
) -> Result<SessionRuntime, String> {
    let session_id = request
        .session_id
        .clone()
        .ok_or_else(|| "session_id missing".to_string())?;
    let shell = request.shell.unwrap_or_else(default_local_shell);
    let cols = request.cols.unwrap_or(120);
    let rows = request.rows.unwrap_or(40);

    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(to_pty_size(cols, rows))
        .map_err(|err| format!("failed to create local pty: {err}"))?;

    let mut command = CommandBuilder::new(shell.clone());
    if let Some(cwd) = request.cwd {
        if !cwd.trim().is_empty() {
            command.cwd(cwd);
        }
    }

    let mut child = pty_pair
        .slave
        .spawn_command(command)
        .map_err(|err| format!("failed to start local shell {shell}: {err}"))?;
    drop(pty_pair.slave);

    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("failed to clone local pty reader: {err}"))?;
    let mut writer = pty_pair
        .master
        .take_writer()
        .map_err(|err| format!("failed to open local pty writer: {err}"))?;
    let master = pty_pair.master;

    emit(
        &app,
        OutputPayload {
            session_id: session_id.clone(),
            stream: "status".to_string(),
            data: format!("local terminal started: {shell}"),
        },
    );

    let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>();
    let session_id_for_thread = session_id.clone();
    thread::spawn(move || {
        let (runtime_tx, runtime_rx) = mpsc::channel::<LocalRuntimeEvent>();
        thread::spawn(move || {
            let mut output_buf = [0_u8; 8192];
            loop {
                match reader.read(&mut output_buf) {
                    Ok(0) => {
                        let _ = runtime_tx
                            .send(LocalRuntimeEvent::Ended("local session closed".to_string()));
                        break;
                    }
                    Ok(bytes_read) => {
                        let data = String::from_utf8_lossy(&output_buf[..bytes_read]).to_string();
                        let _ = runtime_tx.send(LocalRuntimeEvent::Output(data));
                    }
                    Err(err) => {
                        let _ = runtime_tx.send(LocalRuntimeEvent::Ended(format!(
                            "local terminal read failed: {err}"
                        )));
                        break;
                    }
                }
            }
        });

        let mut status_message: Option<String> = None;
        loop {
            while let Ok(runtime_event) = runtime_rx.try_recv() {
                match runtime_event {
                    LocalRuntimeEvent::Output(data) => emit(
                        &app,
                        OutputPayload {
                            session_id: session_id_for_thread.clone(),
                            stream: "stdout".to_string(),
                            data,
                        },
                    ),
                    LocalRuntimeEvent::Ended(message) => {
                        status_message = Some(message);
                        break;
                    }
                }
            }
            if status_message.is_some() {
                break;
            }

            while let Ok(cmd) = cmd_rx.try_recv() {
                match cmd {
                    SessionCommand::Input(data) => {
                        if let Err(err) = writer.write_all(data.as_bytes()) {
                            status_message = Some(format!("input write failed: {err}"));
                            break;
                        }
                        let _ = writer.flush();
                    }
                    SessionCommand::Resize { cols, rows } => {
                        let _ = master.resize(to_pty_size(cols, rows));
                    }
                    SessionCommand::Disconnect => {
                        status_message = Some("disconnected".to_string());
                        break;
                    }
                }
            }
            if status_message.is_some() {
                break;
            }

            thread::sleep(Duration::from_millis(10));
        }

        let _ = child.kill();
        let _ = child.wait();

        if let Some(message) = status_message {
            emit(
                &app,
                OutputPayload {
                    session_id: session_id_for_thread.clone(),
                    stream: "status".to_string(),
                    data: message,
                },
            );
        }

        if let Ok(mut open_sessions) = sessions.lock() {
            open_sessions.remove(&session_id_for_thread);
        }
    });

    Ok(SessionRuntime { cmd_tx })
}

fn to_pty_size(cols: u32, rows: u32) -> PtySize {
    let clamped_cols = cols.clamp(1, u16::MAX as u32) as u16;
    let clamped_rows = rows.clamp(1, u16::MAX as u32) as u16;
    PtySize {
        rows: clamped_rows,
        cols: clamped_cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn default_local_shell() -> String {
    if cfg!(target_os = "windows") {
        return "powershell.exe".to_string();
    }

    env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

fn emit(app: &AppHandle, payload: OutputPayload) {
    let _ = app.emit("ssh-output", payload);
}

fn test_connection_blocking(request: ConnectRequest) -> Result<(), String> {
    let host = request.host;
    let port = request.port.unwrap_or(22);
    let username = request.username;

    let addr = format!("{host}:{port}");
    let tcp =
        TcpStream::connect(&addr).map_err(|err| format!("failed to connect {addr}: {err}"))?;

    let mut session =
        Session::new().map_err(|err| format!("failed to create SSH session: {err}"))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|err| format!("ssh handshake failed: {err}"))?;

    authenticate_session(&mut session, &username, &request.auth)?;

    let mut channel = session
        .channel_session()
        .map_err(|err| format!("failed to open channel: {err}"))?;
    channel
        .close()
        .map_err(|err| format!("failed to close test channel: {err}"))?;
    channel
        .wait_close()
        .map_err(|err| format!("failed to finalize test channel: {err}"))?;
    Ok(())
}
