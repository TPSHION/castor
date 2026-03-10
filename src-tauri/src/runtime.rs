use std::collections::HashSet;
use std::io::Read;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ssh2::Session;
use tauri::AppHandle;

use crate::profiles::{list_connection_profiles, ConnectionProfile};
use crate::ssh::AuthConfig;

const MAX_RUNTIME_MATCHES: usize = 8;

#[derive(Debug, Deserialize)]
pub struct ProbeServerRuntimesRequest {
    pub profile_id: String,
    pub probe_id: String,
}

#[derive(Debug, Deserialize)]
pub struct PreflightServerRuntimeProbeRequest {
    pub profile_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CancelServerRuntimeProbeRequest {
    pub probe_id: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeLanguage {
    Node,
    Java,
    Go,
    Python,
}

#[derive(Debug, Serialize)]
pub struct RuntimeProbeMatch {
    pub binary_path: String,
    pub version: Option<String>,
    pub message: Option<String>,
    pub active: bool,
}

#[derive(Debug, Serialize)]
pub struct RuntimeProbeResult {
    pub language: RuntimeLanguage,
    pub found: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub message: Option<String>,
    pub checked_at: u64,
    pub matches: Vec<RuntimeProbeMatch>,
}

pub fn probe_server_runtimes(
    app: &AppHandle,
    request: ProbeServerRuntimesRequest,
) -> Result<Vec<RuntimeProbeResult>, String> {
    let profile_id = request.profile_id.trim();
    let probe_id = request.probe_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }
    if probe_id.is_empty() {
        return Err("probe_id is required".to_string());
    }

    let _cancel_guard = RuntimeProbeCancelGuard::new(probe_id);
    if is_runtime_probe_cancelled(probe_id)? {
        return Err("runtime probe canceled".to_string());
    }

    let profile = find_profile_by_id(app, profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;
    let mut results = Vec::new();

    for probe in [
        probe_node as fn(&mut Session) -> RuntimeProbeResult,
        probe_java,
        probe_go,
        probe_python,
    ] {
        if is_runtime_probe_cancelled(probe_id)? {
            return Err("runtime probe canceled".to_string());
        }
        results.push(probe(&mut session));
    }

    Ok(results)
}

pub fn preflight_server_runtime_probe(
    app: &AppHandle,
    request: PreflightServerRuntimeProbeRequest,
) -> Result<(), String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }

    let profile = find_profile_by_id(app, profile_id)?;
    let socket_addr = resolve_first_socket_addr(&profile.host, profile.port)?;
    let timeout = Duration::from_secs(3);
    TcpStream::connect_timeout(&socket_addr, timeout)
        .map_err(|err| format!("failed to connect {}:{}: {err}", profile.host, profile.port))?;
    Ok(())
}

pub fn cancel_server_runtime_probe(request: CancelServerRuntimeProbeRequest) -> Result<(), String> {
    let probe_id = request.probe_id.trim();
    if probe_id.is_empty() {
        return Err("probe_id is required".to_string());
    }
    mark_runtime_probe_cancelled(probe_id)
}

fn probe_node(session: &mut Session) -> RuntimeProbeResult {
    probe_runtime_with_path_resolver(
        session,
        RuntimeLanguage::Node,
        resolve_node_binary_paths,
        |path| {
            let quoted = shell_quote(path);
            format!("{quoted} -v 2>/dev/null || {quoted} --version 2>/dev/null || true")
        },
    )
}

fn probe_java(session: &mut Session) -> RuntimeProbeResult {
    probe_runtime_with_path_resolver(
        session,
        RuntimeLanguage::Java,
        resolve_java_binary_paths,
        |path| {
            let quoted = shell_quote(path);
            format!("{quoted} -version 2>&1 || true")
        },
    )
}

fn probe_go(session: &mut Session) -> RuntimeProbeResult {
    probe_runtime_with_path_resolver(
        session,
        RuntimeLanguage::Go,
        resolve_go_binary_paths,
        |path| {
            let quoted = shell_quote(path);
            format!("{quoted} version 2>/dev/null || {quoted} --version 2>/dev/null || true")
        },
    )
}

fn probe_python(session: &mut Session) -> RuntimeProbeResult {
    probe_runtime_with_path_resolver(
        session,
        RuntimeLanguage::Python,
        resolve_python_binary_paths,
        |path| {
            let quoted = shell_quote(path);
            format!("{quoted} --version 2>&1 || {quoted} -V 2>&1 || true")
        },
    )
}

fn probe_runtime_with_path_resolver<F, G>(
    session: &mut Session,
    language: RuntimeLanguage,
    resolve_binary_paths: F,
    build_version_command: G,
) -> RuntimeProbeResult
where
    F: FnOnce(&mut Session) -> Result<Vec<String>, String>,
    G: Fn(&str) -> String,
{
    let checked_at = now_unix();
    let candidate_paths = match resolve_binary_paths(session) {
        Ok(paths) => paths,
        Err(err) => {
            return RuntimeProbeResult {
                language,
                found: false,
                binary_path: None,
                version: None,
                message: Some(err),
                checked_at,
                matches: vec![],
            };
        }
    };

    if candidate_paths.is_empty() {
        return RuntimeProbeResult {
            language,
            found: false,
            binary_path: None,
            version: None,
            message: Some("not found in current shell PATH or related environment variables".to_string()),
            checked_at,
            matches: vec![],
        };
    }

    let active_binary_path = candidate_paths.first().cloned();
    let mut matches = Vec::new();
    for binary_path in candidate_paths.into_iter().take(MAX_RUNTIME_MATCHES) {
        let is_active = active_binary_path
            .as_ref()
            .map(|path| path == &binary_path)
            .unwrap_or(false);
        let version_command = build_version_command(&binary_path);
        match run_remote_command(session, &version_command) {
            Ok((stdout, stderr, _)) => {
                let version = first_non_empty_line(&stdout)
                    .or_else(|| first_non_empty_line(&stderr))
                    .map(str::to_string);
                let message = if version.is_none() {
                    Some("version output is empty".to_string())
                } else {
                    None
                };
                matches.push(RuntimeProbeMatch {
                    binary_path,
                    version,
                    message,
                    active: is_active,
                });
            }
            Err(err) => {
                matches.push(RuntimeProbeMatch {
                    binary_path,
                    version: None,
                    message: Some(err),
                    active: is_active,
                });
            }
        }
    }

    let primary = matches
        .iter()
        .find(|item| item.active)
        .or_else(|| matches.iter().find(|item| item.version.is_some()))
        .or_else(|| matches.first());

    let message = if matches.iter().all(|item| item.version.is_none()) {
        Some("detected candidate binaries, but failed to parse version output".to_string())
    } else {
        None
    };

    RuntimeProbeResult {
        language,
        found: true,
        binary_path: primary.map(|item| item.binary_path.clone()),
        version: primary.and_then(|item| item.version.clone()),
        message,
        checked_at,
        matches,
    }
}

fn first_non_empty_line(source: &str) -> Option<&str> {
    source.lines().map(str::trim).find(|line| !line.is_empty())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn resolve_node_binary_paths(session: &mut Session) -> Result<Vec<String>, String> {
    resolve_binary_paths_by_script(
        session,
        r#"
set +e
if command -v node >/dev/null 2>&1; then command -v node; fi
if command -v which >/dev/null 2>&1; then which -a node 2>/dev/null || true; fi
if [ -n "$NVM_BIN" ] && [ -x "$NVM_BIN/node" ]; then echo "$NVM_BIN/node"; fi
if [ -n "$VOLTA_HOME" ] && [ -x "$VOLTA_HOME/bin/node" ]; then echo "$VOLTA_HOME/bin/node"; fi
if [ -n "$FNM_DIR" ] && [ -x "$FNM_DIR/current/bin/node" ]; then echo "$FNM_DIR/current/bin/node"; fi
if [ -n "$ASDF_DIR" ] && [ -x "$ASDF_DIR/shims/node" ]; then echo "$ASDF_DIR/shims/node"; fi

exit 0
"#,
    )
}

fn resolve_java_binary_paths(session: &mut Session) -> Result<Vec<String>, String> {
    resolve_binary_paths_by_script(
        session,
        r#"
set +e
if command -v java >/dev/null 2>&1; then command -v java; fi
if command -v which >/dev/null 2>&1; then which -a java 2>/dev/null || true; fi
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then echo "$JAVA_HOME/bin/java"; fi
if [ -n "$SDKMAN_DIR" ] && [ -x "$SDKMAN_DIR/candidates/java/current/bin/java" ]; then
  echo "$SDKMAN_DIR/candidates/java/current/bin/java"
fi

exit 0
"#,
    )
}

fn resolve_go_binary_paths(session: &mut Session) -> Result<Vec<String>, String> {
    resolve_binary_paths_by_script(
        session,
        r#"
set +e
if command -v go >/dev/null 2>&1; then command -v go; fi
if command -v which >/dev/null 2>&1; then which -a go 2>/dev/null || true; fi
if [ -n "$GOROOT" ] && [ -x "$GOROOT/bin/go" ]; then echo "$GOROOT/bin/go"; fi
if [ -n "$GOBIN" ] && [ -x "$GOBIN/go" ]; then echo "$GOBIN/go"; fi
if [ -n "$ASDF_DIR" ] && [ -x "$ASDF_DIR/shims/go" ]; then echo "$ASDF_DIR/shims/go"; fi

exit 0
"#,
    )
}

fn resolve_python_binary_paths(session: &mut Session) -> Result<Vec<String>, String> {
    resolve_binary_paths_by_script(
        session,
        r#"
set +e
if command -v python3 >/dev/null 2>&1; then command -v python3; fi
if command -v python >/dev/null 2>&1; then command -v python; fi
if command -v which >/dev/null 2>&1; then
  which -a python3 2>/dev/null || true
  which -a python 2>/dev/null || true
fi
if [ -n "$VIRTUAL_ENV" ] && [ -x "$VIRTUAL_ENV/bin/python" ]; then echo "$VIRTUAL_ENV/bin/python"; fi
if [ -n "$PYENV_ROOT" ] && [ -x "$PYENV_ROOT/shims/python3" ]; then echo "$PYENV_ROOT/shims/python3"; fi
if [ -n "$PYENV_ROOT" ] && [ -x "$PYENV_ROOT/shims/python" ]; then echo "$PYENV_ROOT/shims/python"; fi
if [ -n "$CONDA_PREFIX" ] && [ -x "$CONDA_PREFIX/bin/python" ]; then echo "$CONDA_PREFIX/bin/python"; fi
if [ -n "$ASDF_DIR" ] && [ -x "$ASDF_DIR/shims/python3" ]; then echo "$ASDF_DIR/shims/python3"; fi
if [ -n "$ASDF_DIR" ] && [ -x "$ASDF_DIR/shims/python" ]; then echo "$ASDF_DIR/shims/python"; fi

exit 0
"#,
    )
}

fn resolve_binary_paths_by_script(session: &mut Session, script: &str) -> Result<Vec<String>, String> {
    let (stdout, _, _) = run_remote_bash_script(session, script)?;
    Ok(normalize_candidate_paths(&stdout))
}

fn normalize_candidate_paths(source: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();

    for raw in source.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("alias ") || trimmed.starts_with("function ") {
            continue;
        }

        let candidate = if let Some(index) = trimmed.find(" is ") {
            let rhs = trimmed[index + 4..].trim();
            if rhs.is_empty() { trimmed } else { rhs }
        } else {
            trimmed
        };

        if candidate.is_empty() {
            continue;
        }
        if seen.insert(candidate.to_string()) {
            result.push(candidate.to_string());
        }
        if result.len() >= MAX_RUNTIME_MATCHES * 2 {
            break;
        }
    }

    result
}

fn find_profile_by_id(app: &AppHandle, profile_id: &str) -> Result<ConnectionProfile, String> {
    let profiles = list_connection_profiles(app)?;
    profiles
        .into_iter()
        .find(|item| item.id == profile_id)
        .ok_or_else(|| format!("connection profile {} not found", profile_id))
}

fn connect_ssh_profile(profile: &ConnectionProfile) -> Result<Session, String> {
    let auth = auth_from_profile(profile)?;
    let timeout = Duration::from_secs(6);
    let socket_addr = resolve_first_socket_addr(&profile.host, profile.port)?;
    let tcp = TcpStream::connect_timeout(&socket_addr, timeout)
        .map_err(|err| format!("failed to connect {}:{}: {err}", profile.host, profile.port))?;
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(10)));

    let mut session = Session::new().map_err(|err| format!("failed to create SSH session: {err}"))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|err| format!("ssh handshake failed: {err}"))?;

    match auth {
        AuthConfig::Password { password } => session
            .userauth_password(&profile.username, &password)
            .map_err(|err| format!("password authentication failed: {err}"))?,
        AuthConfig::PrivateKey {
            private_key,
            passphrase,
        } => session
            .userauth_pubkey_memory(&profile.username, None, &private_key, passphrase.as_deref())
            .map_err(|err| format!("private key authentication failed: {err}"))?,
    }

    if !session.authenticated() {
        return Err("ssh authentication was rejected".to_string());
    }
    Ok(session)
}

fn resolve_first_socket_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    let mut addrs = (host, port)
        .to_socket_addrs()
        .map_err(|err| format!("failed to resolve {host}:{port}: {err}"))?;
    addrs
        .next()
        .ok_or_else(|| format!("no socket address resolved for {host}:{port}"))
}

fn auth_from_profile(profile: &ConnectionProfile) -> Result<AuthConfig, String> {
    match profile.auth_kind.as_str() {
        "password" => {
            let password = profile
                .password
                .clone()
                .ok_or_else(|| format!("profile {} is missing password", profile.name))?;
            Ok(AuthConfig::Password { password })
        }
        "private_key" => {
            let private_key = profile
                .private_key
                .clone()
                .filter(|item| !item.trim().is_empty())
                .ok_or_else(|| format!("profile {} is missing private_key", profile.name))?;
            Ok(AuthConfig::PrivateKey {
                private_key,
                passphrase: profile.passphrase.clone().filter(|item| !item.is_empty()),
            })
        }
        _ => Err(format!("unsupported auth kind: {}", profile.auth_kind)),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn run_remote_bash_script(
    session: &mut Session,
    script: &str,
) -> Result<(String, String, i32), String> {
    let command = format!("bash -lc {}", shell_quote(script));
    run_remote_command(session, &command)
}

fn run_remote_command(
    session: &mut Session,
    command: &str,
) -> Result<(String, String, i32), String> {
    let mut channel = session
        .channel_session()
        .map_err(|err| format!("failed to open channel: {err}"))?;
    channel
        .exec(command)
        .map_err(|err| format!("failed to execute remote command: {err}"))?;

    let mut stdout = String::new();
    channel
        .read_to_string(&mut stdout)
        .map_err(|err| format!("failed reading remote stdout: {err}"))?;

    let mut stderr = String::new();
    channel
        .stderr()
        .read_to_string(&mut stderr)
        .map_err(|err| format!("failed reading remote stderr: {err}"))?;

    channel
        .wait_close()
        .map_err(|err| format!("failed waiting remote command close: {err}"))?;
    let exit_status = channel
        .exit_status()
        .map_err(|err| format!("failed to read remote exit status: {err}"))?;

    Ok((stdout, stderr, exit_status))
}

fn runtime_probe_canceled_set() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mark_runtime_probe_cancelled(probe_id: &str) -> Result<(), String> {
    let mut set = runtime_probe_canceled_set()
        .lock()
        .map_err(|_| "runtime probe cancel set lock poisoned".to_string())?;
    set.insert(probe_id.to_string());
    Ok(())
}

fn unmark_runtime_probe_cancelled(probe_id: &str) -> Result<(), String> {
    let mut set = runtime_probe_canceled_set()
        .lock()
        .map_err(|_| "runtime probe cancel set lock poisoned".to_string())?;
    set.remove(probe_id);
    Ok(())
}

fn is_runtime_probe_cancelled(probe_id: &str) -> Result<bool, String> {
    let set = runtime_probe_canceled_set()
        .lock()
        .map_err(|_| "runtime probe cancel set lock poisoned".to_string())?;
    Ok(set.contains(probe_id))
}

struct RuntimeProbeCancelGuard {
    probe_id: String,
}

impl RuntimeProbeCancelGuard {
    fn new(probe_id: &str) -> Self {
        let _ = unmark_runtime_probe_cancelled(probe_id);
        Self {
            probe_id: probe_id.to_string(),
        }
    }
}

impl Drop for RuntimeProbeCancelGuard {
    fn drop(&mut self) {
        let _ = unmark_runtime_probe_cancelled(&self.probe_id);
    }
}
