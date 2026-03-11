use std::collections::{hash_map::DefaultHasher, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ssh2::Session;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::profiles::{list_connection_profiles, ConnectionProfile};
use crate::ssh::AuthConfig;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NginxService {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub nginx_bin: String,
    pub conf_path: Option<String>,
    pub pid_path: Option<String>,
    pub use_sudo: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct UpsertNginxServiceRequest {
    pub id: Option<String>,
    pub profile_id: String,
    pub name: String,
    pub nginx_bin: Option<String>,
    pub conf_path: Option<String>,
    pub pid_path: Option<String>,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteNginxServiceRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct DiscoverRemoteNginxRequest {
    pub profile_id: String,
}

#[derive(Debug, Serialize)]
pub struct RemoteNginxDiscoveryResult {
    pub installed: bool,
    pub nginx_bin: Option<String>,
    pub conf_path: Option<String>,
    pub pid_path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportNginxServiceByParamsRequest {
    pub id: Option<String>,
    pub profile_id: String,
    pub name: String,
    pub nginx_bin: String,
    pub conf_path: Option<String>,
    pub pid_path: Option<String>,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct GetNginxServiceStatusRequest {
    pub id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NginxControlAction {
    Start,
    Stop,
    Reload,
    Restart,
}

#[derive(Debug, Deserialize)]
pub struct ControlNginxServiceRequest {
    pub id: String,
    pub action: NginxControlAction,
}

#[derive(Debug, Deserialize)]
pub struct TestNginxServiceConfigRequest {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub struct NginxServiceStatus {
    pub summary: String,
    pub running: bool,
    pub master_pid: Option<u32>,
    pub checked_at: u64,
}

#[derive(Debug, Serialize)]
pub struct NginxServiceActionResult {
    pub id: String,
    pub action: NginxControlAction,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub status: NginxServiceStatus,
}

#[derive(Debug, Serialize)]
pub struct NginxConfigTestResult {
    pub id: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub checked_at: u64,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct NginxConnectionKey {
    host: String,
    port: u16,
    username: String,
    auth_fingerprint: u64,
}

pub fn list_nginx_services(app: &AppHandle) -> Result<Vec<NginxService>, String> {
    let mut services = load_nginx_services(app)?;
    services.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(services)
}

pub fn upsert_nginx_service(
    app: &AppHandle,
    request: UpsertNginxServiceRequest,
) -> Result<NginxService, String> {
    validate_profile_exists(app, &request.profile_id)?;
    validate_fields(
        &request.profile_id,
        &request.name,
        request.nginx_bin.as_deref(),
        request.conf_path.as_deref(),
        request.pid_path.as_deref(),
    )?;

    let _services_lock = nginx_services_store_lock()
        .lock()
        .map_err(|_| "nginx services store lock poisoned".to_string())?;
    let mut services = load_nginx_services(app)?;
    let now = now_unix();

    let normalized_nginx_bin = normalize_nginx_bin(request.nginx_bin)?;
    let normalized_conf_path = sanitize_optional(request.conf_path);
    let normalized_pid_path = sanitize_optional(request.pid_path);
    let use_sudo = request.use_sudo.unwrap_or(false);

    ensure_unique_name(
        &services,
        request.profile_id.trim(),
        request.name.trim(),
        request.id.as_deref(),
    )?;

    let updated = if let Some(id) = request.id {
        if let Some(existing) = services.iter_mut().find(|service| service.id == id) {
            existing.profile_id = request.profile_id.trim().to_string();
            existing.name = request.name.trim().to_string();
            existing.nginx_bin = normalized_nginx_bin;
            existing.conf_path = normalized_conf_path;
            existing.pid_path = normalized_pid_path;
            existing.use_sudo = use_sudo;
            existing.updated_at = now;
            existing.clone()
        } else {
            return Err(format!("nginx service {} not found", id));
        }
    } else {
        let service = NginxService {
            id: Uuid::new_v4().to_string(),
            profile_id: request.profile_id.trim().to_string(),
            name: request.name.trim().to_string(),
            nginx_bin: normalized_nginx_bin,
            conf_path: normalized_conf_path,
            pid_path: normalized_pid_path,
            use_sudo,
            created_at: now,
            updated_at: now,
        };
        services.push(service.clone());
        service
    };

    save_nginx_services(app, &services)?;
    Ok(updated)
}

pub fn delete_nginx_service(
    app: &AppHandle,
    request: DeleteNginxServiceRequest,
) -> Result<(), String> {
    let _services_lock = nginx_services_store_lock()
        .lock()
        .map_err(|_| "nginx services store lock poisoned".to_string())?;
    let mut services = load_nginx_services(app)?;
    let before = services.len();
    services.retain(|item| item.id != request.id);
    if services.len() == before {
        return Err(format!("nginx service {} not found", request.id));
    }
    save_nginx_services(app, &services)
}

pub fn discover_remote_nginx(
    app: &AppHandle,
    request: DiscoverRemoteNginxRequest,
) -> Result<RemoteNginxDiscoveryResult, String> {
    validate_profile_exists(app, &request.profile_id)?;
    let profile = find_profile(app, &request.profile_id)?;
    with_pooled_session(&profile, |session| query_remote_nginx(session))
}

pub fn import_nginx_service_by_params(
    app: &AppHandle,
    request: ImportNginxServiceByParamsRequest,
) -> Result<NginxService, String> {
    validate_profile_exists(app, &request.profile_id)?;
    validate_fields(
        &request.profile_id,
        &request.name,
        Some(request.nginx_bin.as_str()),
        request.conf_path.as_deref(),
        request.pid_path.as_deref(),
    )?;

    let profile = find_profile(app, &request.profile_id)?;
    let conf_path = sanitize_optional(request.conf_path.clone());
    let pid_path = sanitize_optional(request.pid_path.clone());
    let use_sudo = request.use_sudo.unwrap_or(false);

    let verified = with_pooled_session(&profile, |session| {
        verify_remote_nginx_params(
            session,
            request.nginx_bin.as_str(),
            conf_path.as_deref(),
            use_sudo,
        )
    })?;

    let upsert_request = UpsertNginxServiceRequest {
        id: request.id,
        profile_id: request.profile_id,
        name: request.name,
        nginx_bin: Some(request.nginx_bin),
        conf_path,
        pid_path: pid_path.or(verified.pid_path),
        use_sudo: Some(use_sudo),
    };

    upsert_nginx_service(app, upsert_request)
}

pub fn get_nginx_service_status(
    app: &AppHandle,
    request: GetNginxServiceStatusRequest,
) -> Result<NginxServiceStatus, String> {
    let service = find_nginx_service_by_id(app, &request.id)?;
    let profile = find_profile(app, &service.profile_id)?;
    with_pooled_session(&profile, |session| query_nginx_status(session, &service))
}

pub fn control_nginx_service(
    app: &AppHandle,
    request: ControlNginxServiceRequest,
) -> Result<NginxServiceActionResult, String> {
    let service = find_nginx_service_by_id(app, &request.id)?;
    let profile = find_profile(app, &service.profile_id)?;

    with_pooled_session(&profile, |session| {
        let command_script = build_control_script(&service, request.action);
        let (stdout, stderr, exit_status) = run_remote_script(session, &command_script)?;
        if exit_status != 0 {
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            return Err(format!(
                "failed to {} nginx (exit code {exit_status}): {}",
                action_label(request.action),
                if detail.is_empty() {
                    "unknown error"
                } else {
                    detail
                }
            ));
        }

        let status = query_nginx_status(session, &service)?;
        Ok(NginxServiceActionResult {
            id: service.id.clone(),
            action: request.action,
            stdout,
            stderr,
            exit_status,
            status,
        })
    })
}

pub fn test_nginx_service_config(
    app: &AppHandle,
    request: TestNginxServiceConfigRequest,
) -> Result<NginxConfigTestResult, String> {
    let service = find_nginx_service_by_id(app, &request.id)?;
    let profile = find_profile(app, &service.profile_id)?;

    with_pooled_session(&profile, |session| {
        let command_script = build_test_config_script(&service);
        let (stdout, stderr, exit_status) = run_remote_script(session, &command_script)?;
        Ok(NginxConfigTestResult {
            id: service.id.clone(),
            success: exit_status == 0,
            stdout,
            stderr,
            exit_status,
            checked_at: now_unix(),
        })
    })
}

fn query_remote_nginx(session: &mut Session) -> Result<RemoteNginxDiscoveryResult, String> {
    let script = r#"set -euo pipefail
nginx_bin="$(which nginx 2>/dev/null || true)"
if [ -z "$nginx_bin" ]; then
  echo "__CASTOR_INSTALLED=0"
  exit 0
fi

echo "__CASTOR_INSTALLED=1"
echo "__CASTOR_NGINX_BIN=$nginx_bin"
echo "__CASTOR_VERSION_BEGIN__"
"$nginx_bin" -V 2>&1 || true
echo "__CASTOR_VERSION_END__"
"#;

    let (stdout, stderr, exit_status) = run_remote_script(session, script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to discover nginx by `which nginx` (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    Ok(parse_discovery_output(&stdout))
}

fn parse_discovery_output(raw: &str) -> RemoteNginxDiscoveryResult {
    let mut installed = false;
    let mut nginx_bin: Option<String> = None;
    let mut version_lines: Vec<String> = Vec::new();
    let mut collecting_version = false;

    for line in raw.lines() {
        if line == "__CASTOR_VERSION_BEGIN__" {
            collecting_version = true;
            continue;
        }
        if line == "__CASTOR_VERSION_END__" {
            collecting_version = false;
            continue;
        }

        if collecting_version {
            version_lines.push(line.to_string());
            continue;
        }

        if let Some(value) = line.strip_prefix("__CASTOR_INSTALLED=") {
            installed = value.trim() == "1";
            continue;
        }

        if let Some(value) = line.strip_prefix("__CASTOR_NGINX_BIN=") {
            let value = value.trim();
            if !value.is_empty() {
                nginx_bin = Some(value.to_string());
            }
        }
    }

    let version_output = if version_lines.is_empty() {
        None
    } else {
        Some(version_lines.join("\n"))
    };

    let conf_path = version_output
        .as_deref()
        .and_then(|text| parse_nginx_configure_flag(text, "--conf-path="));
    let pid_path = version_output
        .as_deref()
        .and_then(|text| parse_nginx_configure_flag(text, "--pid-path="));
    let version = version_output
        .as_deref()
        .and_then(|text| parse_nginx_version(text));

    RemoteNginxDiscoveryResult {
        installed,
        nginx_bin,
        conf_path,
        pid_path,
        version,
    }
}

fn parse_nginx_version(raw: &str) -> Option<String> {
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(version) = trimmed.strip_prefix("nginx version:") {
            let normalized = version.trim();
            if !normalized.is_empty() {
                return Some(normalized.to_string());
            }
        }
    }
    None
}

fn parse_nginx_configure_flag(raw: &str, prefix: &str) -> Option<String> {
    for line in raw.lines() {
        let trimmed = line.trim();
        if !trimmed.contains("configure arguments:") {
            continue;
        }

        for token in trimmed.split_whitespace() {
            if let Some(value) = token.strip_prefix(prefix) {
                let cleaned = value.trim_matches('"').trim_matches('\'').trim();
                if !cleaned.is_empty() {
                    return Some(cleaned.to_string());
                }
            }
        }
    }
    None
}

struct VerifiedNginxParams {
    pid_path: Option<String>,
}

fn verify_remote_nginx_params(
    session: &mut Session,
    nginx_bin: &str,
    conf_path: Option<&str>,
    use_sudo: bool,
) -> Result<VerifiedNginxParams, String> {
    let command_prefix = if use_sudo { "sudo " } else { "" };
    let conf_arg = conf_path
        .map(|path| format!(" -c {}", shell_quote(path)))
        .unwrap_or_default();

    let script = format!(
        r#"set -euo pipefail
nginx_bin={nginx_bin}
{command_prefix}"$nginx_bin" -v >/dev/null 2>&1
{command_prefix}"$nginx_bin" -t{conf_arg}
echo "__CASTOR_VERSION_BEGIN__"
{command_prefix}"$nginx_bin" -V 2>&1 || true
echo "__CASTOR_VERSION_END__"
"#,
        nginx_bin = shell_quote(nginx_bin),
        command_prefix = command_prefix,
        conf_arg = conf_arg,
    );

    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "nginx 参数校验失败 (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    let mut collecting_version = false;
    let mut version_lines: Vec<String> = Vec::new();
    for line in stdout.lines() {
        if line == "__CASTOR_VERSION_BEGIN__" {
            collecting_version = true;
            continue;
        }
        if line == "__CASTOR_VERSION_END__" {
            collecting_version = false;
            continue;
        }
        if collecting_version {
            version_lines.push(line.to_string());
        }
    }

    let pid_path = if version_lines.is_empty() {
        None
    } else {
        parse_nginx_configure_flag(&version_lines.join("\n"), "--pid-path=")
    };

    Ok(VerifiedNginxParams { pid_path })
}

fn query_nginx_status(
    session: &mut Session,
    service: &NginxService,
) -> Result<NginxServiceStatus, String> {
    let script = format!(
        r#"set -uo pipefail
pid_path={pid_path}
pid=""

if [ -n "$pid_path" ] && [ -f "$pid_path" ]; then
  pid="$(tr -d '[:space:]' < "$pid_path" 2>/dev/null || true)"
fi

if [ -z "$pid" ]; then
  pid="$(ps -eo pid,command | awk '/nginx: master process/ && !/awk/ {{ print $1; exit }}' || true)"
fi

if [ -n "$pid" ] && ps -p "$pid" -o pid= >/dev/null 2>&1; then
  summary="running"
else
  summary="stopped"
  pid=""
fi

echo "__CASTOR_SUMMARY=$summary"
echo "__CASTOR_MASTER_PID=$pid"
"#,
        pid_path = shell_quote(service.pid_path.as_deref().unwrap_or("")),
    );

    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to query nginx status (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    let mut summary = "unknown".to_string();
    let mut master_pid: Option<u32> = None;

    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("__CASTOR_SUMMARY=") {
            let normalized = value.trim();
            if !normalized.is_empty() {
                summary = normalized.to_string();
            }
            continue;
        }

        if let Some(value) = line.strip_prefix("__CASTOR_MASTER_PID=") {
            master_pid = value.trim().parse::<u32>().ok();
        }
    }

    Ok(NginxServiceStatus {
        running: summary == "running",
        summary,
        master_pid,
        checked_at: now_unix(),
    })
}

fn build_control_script(service: &NginxService, action: NginxControlAction) -> String {
    let conf_arg = service
        .conf_path
        .as_deref()
        .map(|path| format!(" -c {}", shell_quote(path)))
        .unwrap_or_default();
    let prefix = if service.use_sudo { "sudo " } else { "" };
    let nginx_bin = shell_quote(service.nginx_bin.as_str());

    let body = match action {
        NginxControlAction::Start => format!("{prefix}{nginx_bin}{conf_arg}"),
        NginxControlAction::Stop => format!("{prefix}{nginx_bin} -s quit{conf_arg}"),
        NginxControlAction::Reload => format!("{prefix}{nginx_bin} -s reload{conf_arg}"),
        NginxControlAction::Restart => format!(
            "{prefix}{nginx_bin} -s quit{conf_arg} >/dev/null 2>&1 || true\nsleep 1\n{prefix}{nginx_bin}{conf_arg}"
        ),
    };

    format!("set -euo pipefail\n{body}\n")
}

fn build_test_config_script(service: &NginxService) -> String {
    let conf_arg = service
        .conf_path
        .as_deref()
        .map(|path| format!(" -c {}", shell_quote(path)))
        .unwrap_or_default();
    let prefix = if service.use_sudo { "sudo " } else { "" };
    let nginx_bin = shell_quote(service.nginx_bin.as_str());
    format!("set -euo pipefail\n{prefix}{nginx_bin} -t{conf_arg}\n")
}

fn action_label(action: NginxControlAction) -> &'static str {
    match action {
        NginxControlAction::Start => "start",
        NginxControlAction::Stop => "stop",
        NginxControlAction::Reload => "reload",
        NginxControlAction::Restart => "restart",
    }
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        "''".to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

fn find_profile(app: &AppHandle, profile_id: &str) -> Result<ConnectionProfile, String> {
    list_connection_profiles(app)?
        .into_iter()
        .find(|item| item.id == profile_id)
        .ok_or_else(|| format!("connection profile {} not found", profile_id))
}

fn validate_profile_exists(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    if profile_id.trim().is_empty() {
        return Err("profile_id is required".to_string());
    }
    find_profile(app, profile_id).map(|_| ())
}

fn validate_fields(
    profile_id: &str,
    name: &str,
    nginx_bin: Option<&str>,
    conf_path: Option<&str>,
    pid_path: Option<&str>,
) -> Result<(), String> {
    if profile_id.trim().is_empty() {
        return Err("profile_id is required".to_string());
    }
    if name.trim().is_empty() {
        return Err("name is required".to_string());
    }

    let normalized_nginx_bin = normalize_nginx_bin(nginx_bin.map(|item| item.to_string()))?;
    assert_no_newline(&normalized_nginx_bin, "nginx_bin")?;

    if let Some(path) = conf_path.and_then(|item| sanitize_optional(Some(item.to_string()))) {
        assert_no_newline(path.as_str(), "conf_path")?;
    }

    if let Some(path) = pid_path.and_then(|item| sanitize_optional(Some(item.to_string()))) {
        assert_no_newline(path.as_str(), "pid_path")?;
    }

    Ok(())
}

fn normalize_nginx_bin(raw: Option<String>) -> Result<String, String> {
    let value = raw
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "/usr/sbin/nginx".to_string());
    assert_no_newline(value.as_str(), "nginx_bin")?;
    Ok(value)
}

fn assert_no_newline(value: &str, field: &str) -> Result<(), String> {
    if value.contains('\n') || value.contains('\r') {
        return Err(format!("{field} cannot contain new lines"));
    }
    Ok(())
}

fn sanitize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn find_nginx_service_by_id(app: &AppHandle, service_id: &str) -> Result<NginxService, String> {
    load_nginx_services(app)?
        .into_iter()
        .find(|item| item.id == service_id)
        .ok_or_else(|| format!("nginx service {} not found", service_id))
}

fn auth_fingerprint(auth: &AuthConfig) -> u64 {
    let mut hasher = DefaultHasher::new();
    match auth {
        AuthConfig::Password { password } => {
            1u8.hash(&mut hasher);
            password.hash(&mut hasher);
        }
        AuthConfig::PrivateKey {
            private_key,
            passphrase,
        } => {
            2u8.hash(&mut hasher);
            private_key.hash(&mut hasher);
            passphrase.hash(&mut hasher);
        }
    }
    hasher.finish()
}

fn build_connection_key(profile: &ConnectionProfile, auth: &AuthConfig) -> NginxConnectionKey {
    NginxConnectionKey {
        host: profile.host.clone(),
        port: profile.port,
        username: profile.username.clone(),
        auth_fingerprint: auth_fingerprint(auth),
    }
}

fn nginx_connection_pool() -> &'static Mutex<HashMap<NginxConnectionKey, Arc<Mutex<Session>>>> {
    static POOL: OnceLock<Mutex<HashMap<NginxConnectionKey, Arc<Mutex<Session>>>>> =
        OnceLock::new();
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remove_pooled_connection(key: &NginxConnectionKey) {
    if let Ok(mut pool) = nginx_connection_pool().lock() {
        pool.remove(key);
    }
}

fn get_or_create_pooled_connection(
    key: &NginxConnectionKey,
    profile: &ConnectionProfile,
) -> Result<Arc<Mutex<Session>>, String> {
    if let Some(existing) = nginx_connection_pool()
        .lock()
        .map_err(|_| "nginx connection pool lock poisoned".to_string())?
        .get(key)
        .cloned()
    {
        return Ok(existing);
    }

    let session = Arc::new(Mutex::new(connect_ssh_profile(profile)?));
    let mut pool = nginx_connection_pool()
        .lock()
        .map_err(|_| "nginx connection pool lock poisoned".to_string())?;
    if let Some(existing) = pool.get(key).cloned() {
        return Ok(existing);
    }
    pool.insert(key.clone(), session.clone());
    Ok(session)
}

fn is_retryable_connection_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("failed to open channel")
        || lower.contains("failed to execute remote shell")
        || lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("failed to write remote script")
}

fn with_pooled_session<T, F>(profile: &ConnectionProfile, mut task: F) -> Result<T, String>
where
    F: FnMut(&mut Session) -> Result<T, String>,
{
    let auth = auth_from_profile(profile)?;
    let key = build_connection_key(profile, &auth);

    for attempt in 0..2 {
        let pooled = get_or_create_pooled_connection(&key, profile)?;
        let mut session = pooled
            .lock()
            .map_err(|_| "nginx pooled ssh session lock poisoned".to_string())?;

        match task(&mut session) {
            Ok(value) => return Ok(value),
            Err(err) => {
                if attempt == 0 && is_retryable_connection_error(&err) {
                    drop(session);
                    remove_pooled_connection(&key);
                    continue;
                }
                return Err(err);
            }
        }
    }

    Err("nginx pooled ssh operation failed".to_string())
}

fn connect_ssh_profile(profile: &ConnectionProfile) -> Result<Session, String> {
    let auth = auth_from_profile(profile)?;
    let addr = format!("{}:{}", profile.host, profile.port);
    let tcp =
        TcpStream::connect(&addr).map_err(|err| format!("failed to connect {addr}: {err}"))?;

    let mut session =
        Session::new().map_err(|err| format!("failed to create SSH session: {err}"))?;
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

fn run_remote_script(session: &mut Session, script: &str) -> Result<(String, String, i32), String> {
    let mut channel = session
        .channel_session()
        .map_err(|err| format!("failed to open channel: {err}"))?;
    channel
        .exec("bash -s")
        .map_err(|err| format!("failed to execute remote shell: {err}"))?;

    channel
        .write_all(script.as_bytes())
        .map_err(|err| format!("failed to write remote script: {err}"))?;
    channel
        .send_eof()
        .map_err(|err| format!("failed to send script eof: {err}"))?;

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

fn load_nginx_services(app: &AppHandle) -> Result<Vec<NginxService>, String> {
    let path = nginx_services_file_path(app)?;
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.trim().is_empty() {
                return Ok(vec![]);
            }
            serde_json::from_str(&content)
                .map_err(|err| format!("failed to parse nginx services: {err}"))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(format!("failed to read nginx services: {err}")),
    }
}

fn save_nginx_services(app: &AppHandle, services: &[NginxService]) -> Result<(), String> {
    let path = nginx_services_file_path(app)?;
    let body = serde_json::to_string_pretty(services)
        .map_err(|err| format!("failed to encode nginx services: {err}"))?;
    fs::write(path, body).map_err(|err| format!("failed to write nginx services: {err}"))
}

fn nginx_services_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("failed to resolve app config dir: {err}"))?;
    fs::create_dir_all(&config_dir)
        .map_err(|err| format!("failed to initialize app config dir: {err}"))?;
    Ok(config_dir.join("nginx_services.json"))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn nginx_services_store_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn ensure_unique_name(
    services: &[NginxService],
    profile_id: &str,
    name: &str,
    current_id: Option<&str>,
) -> Result<(), String> {
    let duplicated = services.iter().any(|item| {
        if current_id.is_some_and(|id| item.id == id) {
            return false;
        }
        item.profile_id == profile_id && item.name.eq_ignore_ascii_case(name)
    });

    if duplicated {
        return Err(format!("name already exists on selected profile: {name}"));
    }

    Ok(())
}
