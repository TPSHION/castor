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

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemdScope {
    System,
    User,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SystemdDeployService {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub service_name: String,
    pub description: Option<String>,
    pub working_dir: String,
    pub exec_start: String,
    pub exec_stop: Option<String>,
    pub service_user: Option<String>,
    pub environment: Option<Vec<String>>,
    pub enable_on_boot: bool,
    pub scope: SystemdScope,
    pub use_sudo: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct UpsertSystemdDeployServiceRequest {
    pub id: Option<String>,
    pub profile_id: String,
    pub name: String,
    pub service_name: String,
    pub description: Option<String>,
    pub working_dir: String,
    pub exec_start: String,
    pub exec_stop: Option<String>,
    pub service_user: Option<String>,
    pub environment: Option<Vec<String>>,
    pub enable_on_boot: Option<bool>,
    pub scope: Option<SystemdScope>,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteSystemdDeployServiceRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct ApplySystemdDeployServiceRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct GetSystemdDeployServiceStatusRequest {
    pub id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemdControlAction {
    Start,
    Stop,
    Restart,
}

#[derive(Debug, Deserialize)]
pub struct ControlSystemdDeployServiceRequest {
    pub id: String,
    pub action: SystemdControlAction,
}

#[derive(Debug, Serialize)]
pub struct SystemdServiceStatus {
    pub active_state: String,
    pub sub_state: String,
    pub unit_file_state: String,
    pub summary: String,
    pub checked_at: u64,
}

#[derive(Debug, Serialize)]
pub struct SystemdServiceActionResult {
    pub id: String,
    pub action: SystemdControlAction,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub status: SystemdServiceStatus,
}

#[derive(Debug, Deserialize)]
pub struct DeploySystemdServiceRequest {
    pub profile_id: String,
    pub service_name: String,
    pub description: Option<String>,
    pub working_dir: String,
    pub exec_start: String,
    pub exec_stop: Option<String>,
    pub service_user: Option<String>,
    pub environment: Option<Vec<String>>,
    pub enable_on_boot: Option<bool>,
    pub scope: Option<SystemdScope>,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct DeploySystemdServiceResult {
    pub host: String,
    pub service_name: String,
    pub scope: String,
    pub unit_path: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct SystemdConnectionKey {
    host: String,
    port: u16,
    username: String,
    auth_fingerprint: u64,
}

pub fn list_systemd_deploy_services(app: &AppHandle) -> Result<Vec<SystemdDeployService>, String> {
    let mut services = load_systemd_services(app)?;
    services.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(services)
}

pub fn upsert_systemd_deploy_service(
    app: &AppHandle,
    request: UpsertSystemdDeployServiceRequest,
) -> Result<SystemdDeployService, String> {
    validate_profile_exists(app, &request.profile_id)?;
    validate_fields(
        &request.profile_id,
        &request.name,
        &request.service_name,
        &request.working_dir,
        &request.exec_start,
        request.exec_stop.as_deref(),
        request.description.as_deref(),
        request.service_user.as_deref(),
        request.environment.as_ref(),
    )?;

    let mut services = load_systemd_services(app)?;
    let now = now_unix();
    let normalized_service_name = normalize_service_name(&request.service_name)?;

    let updated = if let Some(id) = request.id {
        if let Some(existing) = services.iter_mut().find(|service| service.id == id) {
            existing.profile_id = request.profile_id.trim().to_string();
            existing.name = request.name.trim().to_string();
            existing.service_name = normalized_service_name;
            existing.description = sanitize_optional(request.description);
            existing.working_dir = request.working_dir.trim().to_string();
            existing.exec_start = request.exec_start.trim().to_string();
            existing.exec_stop = sanitize_optional(request.exec_stop);
            existing.service_user = sanitize_optional(request.service_user);
            existing.environment = sanitize_environment(request.environment);
            existing.enable_on_boot = request.enable_on_boot.unwrap_or(true);
            existing.scope = request.scope.unwrap_or(SystemdScope::System);
            existing.use_sudo = request.use_sudo.unwrap_or(true);
            existing.updated_at = now;
            existing.clone()
        } else {
            return Err(format!("systemd deploy service {} not found", id));
        }
    } else {
        let item = SystemdDeployService {
            id: Uuid::new_v4().to_string(),
            profile_id: request.profile_id.trim().to_string(),
            name: request.name.trim().to_string(),
            service_name: normalized_service_name,
            description: sanitize_optional(request.description),
            working_dir: request.working_dir.trim().to_string(),
            exec_start: request.exec_start.trim().to_string(),
            exec_stop: sanitize_optional(request.exec_stop),
            service_user: sanitize_optional(request.service_user),
            environment: sanitize_environment(request.environment),
            enable_on_boot: request.enable_on_boot.unwrap_or(true),
            scope: request.scope.unwrap_or(SystemdScope::System),
            use_sudo: request.use_sudo.unwrap_or(true),
            created_at: now,
            updated_at: now,
        };
        services.push(item.clone());
        item
    };

    save_systemd_services(app, &services)?;
    Ok(updated)
}

pub fn delete_systemd_deploy_service(
    app: &AppHandle,
    request: DeleteSystemdDeployServiceRequest,
) -> Result<(), String> {
    let mut services = load_systemd_services(app)?;
    let before = services.len();
    services.retain(|service| service.id != request.id);
    if services.len() == before {
        return Err(format!("systemd deploy service {} not found", request.id));
    }
    save_systemd_services(app, &services)
}

pub fn deploy_systemd_service(
    app: &AppHandle,
    request: DeploySystemdServiceRequest,
) -> Result<DeploySystemdServiceResult, String> {
    validate_fields(
        &request.profile_id,
        "systemd service",
        &request.service_name,
        &request.working_dir,
        &request.exec_start,
        request.exec_stop.as_deref(),
        request.description.as_deref(),
        request.service_user.as_deref(),
        request.environment.as_ref(),
    )?;

    let normalized_service_name = normalize_service_name(&request.service_name)?;
    deploy_with_profile(
        app,
        &request.profile_id,
        &normalized_service_name,
        request.description.as_deref(),
        &request.working_dir,
        &request.exec_start,
        request.exec_stop.as_deref(),
        request.service_user.as_deref(),
        request.environment.as_ref(),
        request.enable_on_boot.unwrap_or(true),
        request.scope.unwrap_or(SystemdScope::System),
        request.use_sudo.unwrap_or(true),
    )
}

pub fn apply_systemd_deploy_service(
    app: &AppHandle,
    request: ApplySystemdDeployServiceRequest,
) -> Result<DeploySystemdServiceResult, String> {
    let service = load_systemd_services(app)?
        .into_iter()
        .find(|item| item.id == request.id)
        .ok_or_else(|| format!("systemd deploy service {} not found", request.id))?;

    deploy_with_profile(
        app,
        &service.profile_id,
        &service.service_name,
        service.description.as_deref(),
        &service.working_dir,
        &service.exec_start,
        service.exec_stop.as_deref(),
        service.service_user.as_deref(),
        service.environment.as_ref(),
        service.enable_on_boot,
        service.scope,
        service.use_sudo,
    )
}

pub fn get_systemd_deploy_service_status(
    app: &AppHandle,
    request: GetSystemdDeployServiceStatusRequest,
) -> Result<SystemdServiceStatus, String> {
    let service = load_systemd_services(app)?
        .into_iter()
        .find(|item| item.id == request.id)
        .ok_or_else(|| format!("systemd deploy service {} not found", request.id))?;

    let profile = find_profile(app, &service.profile_id)?;
    with_pooled_session(&profile, |session| {
        query_service_status(session, &service.service_name, service.scope, service.use_sudo)
    })
}

pub fn control_systemd_deploy_service(
    app: &AppHandle,
    request: ControlSystemdDeployServiceRequest,
) -> Result<SystemdServiceActionResult, String> {
    let service = load_systemd_services(app)?
        .into_iter()
        .find(|item| item.id == request.id)
        .ok_or_else(|| format!("systemd deploy service {} not found", request.id))?;

    let profile = find_profile(app, &service.profile_id)?;
    let service_file = service_file_name(&service.service_name);
    let systemctl_prefix = systemctl_prefix(service.scope, service.use_sudo);

    let control_cmd = format!(
        "set -euo pipefail\n{} {} {}",
        systemctl_prefix,
        action_name(request.action),
        service_file
    );

    with_pooled_session(&profile, |session| {
        let (stdout, stderr, exit_status) = run_remote_script(session, &control_cmd)?;
        if exit_status != 0 {
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            return Err(format!(
                "{} {} failed (exit code {exit_status}): {}",
                service_file,
                action_name(request.action),
                if detail.is_empty() {
                    "unknown error"
                } else {
                    detail
                }
            ));
        }

        let status = query_service_status(session, &service.service_name, service.scope, service.use_sudo)?;

        Ok(SystemdServiceActionResult {
            id: service.id.clone(),
            action: request.action,
            stdout,
            stderr,
            exit_status,
            status,
        })
    })
}

fn action_name(action: SystemdControlAction) -> &'static str {
    match action {
        SystemdControlAction::Start => "start",
        SystemdControlAction::Stop => "stop",
        SystemdControlAction::Restart => "restart",
    }
}

#[allow(clippy::too_many_arguments)]
fn deploy_with_profile(
    app: &AppHandle,
    profile_id: &str,
    service_name: &str,
    description: Option<&str>,
    working_dir: &str,
    exec_start: &str,
    exec_stop: Option<&str>,
    service_user: Option<&str>,
    environment: Option<&Vec<String>>,
    enable_on_boot: bool,
    scope: SystemdScope,
    use_sudo: bool,
) -> Result<DeploySystemdServiceResult, String> {
    let profile = find_profile(app, profile_id)?;
    let normalized_service_name = normalize_service_name(service_name)?;
    let service_file = service_file_name(&normalized_service_name);
    let unit_content = build_unit_content(
        description,
        working_dir,
        exec_start,
        exec_stop,
        service_user,
        environment,
        scope,
    )?;
    let unit_path = unit_path(scope, &service_file);

    let script = build_deploy_script(
        &unit_content,
        &service_file,
        &unit_path,
        scope,
        use_sudo,
        enable_on_boot,
    );
    let host = profile.host.clone();

    with_pooled_session(&profile, |session| {
        let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
        if exit_status != 0 {
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            return Err(format!(
                "systemd deployment failed (exit code {exit_status}): {}",
                if detail.is_empty() {
                    "unknown error"
                } else {
                    detail
                }
            ));
        }

        Ok(DeploySystemdServiceResult {
            host: host.clone(),
            service_name: service_file.clone(),
            scope: match scope {
                SystemdScope::System => "system".to_string(),
                SystemdScope::User => "user".to_string(),
            },
            unit_path: unit_path.clone(),
            stdout,
            stderr,
            exit_status,
        })
    })
}

fn query_service_status(
    session: &mut Session,
    service_name: &str,
    scope: SystemdScope,
    use_sudo: bool,
) -> Result<SystemdServiceStatus, String> {
    let service_file = service_file_name(service_name);
    let prefix = systemctl_prefix(scope, use_sudo);
    let script = format!(
        "set -euo pipefail\n{} show {} --property=ActiveState --property=SubState --property=UnitFileState --value",
        prefix, service_file
    );
    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to read status for {} (exit code {exit_status}): {}",
            service_file,
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    let mut lines = stdout.lines();
    let active_state = lines.next().unwrap_or("unknown").trim().to_string();
    let sub_state = lines.next().unwrap_or("unknown").trim().to_string();
    let unit_file_state = lines.next().unwrap_or("unknown").trim().to_string();

    let summary = if active_state == "active" {
        "running".to_string()
    } else if active_state == "failed" {
        "failed".to_string()
    } else if active_state == "inactive" || active_state == "deactivating" {
        "stopped".to_string()
    } else {
        "unknown".to_string()
    };

    Ok(SystemdServiceStatus {
        active_state,
        sub_state,
        unit_file_state,
        summary,
        checked_at: now_unix(),
    })
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

#[allow(clippy::too_many_arguments)]
fn validate_fields(
    profile_id: &str,
    name: &str,
    service_name: &str,
    working_dir: &str,
    exec_start: &str,
    exec_stop: Option<&str>,
    description: Option<&str>,
    service_user: Option<&str>,
    environment: Option<&Vec<String>>,
) -> Result<(), String> {
    if profile_id.trim().is_empty() {
        return Err("profile_id is required".to_string());
    }
    if name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    normalize_service_name(service_name)?;

    if working_dir.trim().is_empty() {
        return Err("working_dir is required".to_string());
    }
    if exec_start.trim().is_empty() {
        return Err("exec_start is required".to_string());
    }
    assert_no_newline(working_dir, "working_dir")?;
    assert_no_newline(exec_start, "exec_start")?;

    if let Some(value) = exec_stop.filter(|item| !item.trim().is_empty()) {
        assert_no_newline(value, "exec_stop")?;
    }

    if let Some(value) = description.filter(|item| !item.trim().is_empty()) {
        assert_no_newline(value, "description")?;
    }

    if let Some(value) = service_user.filter(|item| !item.trim().is_empty()) {
        assert_no_newline(value, "service_user")?;
    }

    if let Some(entries) = environment {
        for line in entries {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            assert_no_newline(trimmed, "environment")?;
            if !trimmed.contains('=') {
                return Err(format!("invalid environment entry: {trimmed}"));
            }
        }
    }

    Ok(())
}

fn assert_no_newline(value: &str, field: &str) -> Result<(), String> {
    if value.contains('\n') || value.contains('\r') {
        return Err(format!("{field} cannot contain new lines"));
    }
    Ok(())
}

fn normalize_service_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("service_name is required".to_string());
    }

    let name = trimmed
        .strip_suffix(".service")
        .unwrap_or(trimmed)
        .to_string();
    let valid = name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' || ch == '@');
    if !valid {
        return Err("service_name can only contain letters, numbers, _, -, ., @".to_string());
    }
    Ok(name)
}

fn sanitize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn sanitize_environment(value: Option<Vec<String>>) -> Option<Vec<String>> {
    value.and_then(|entries| {
        let next: Vec<String> = entries
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
        if next.is_empty() {
            None
        } else {
            Some(next)
        }
    })
}

fn service_file_name(service_name: &str) -> String {
    format!(
        "{}.service",
        service_name
            .trim()
            .strip_suffix(".service")
            .unwrap_or(service_name.trim())
    )
}

fn unit_path(scope: SystemdScope, service_file: &str) -> String {
    match scope {
        SystemdScope::System => format!("/etc/systemd/system/{service_file}"),
        SystemdScope::User => format!("$HOME/.config/systemd/user/{service_file}"),
    }
}

fn systemctl_prefix(scope: SystemdScope, use_sudo: bool) -> String {
    match scope {
        SystemdScope::System => {
            if use_sudo {
                "sudo systemctl".to_string()
            } else {
                "systemctl".to_string()
            }
        }
        SystemdScope::User => "systemctl --user".to_string(),
    }
}

fn build_unit_content(
    description: Option<&str>,
    working_dir: &str,
    exec_start: &str,
    exec_stop: Option<&str>,
    service_user: Option<&str>,
    environment: Option<&Vec<String>>,
    scope: SystemdScope,
) -> Result<String, String> {
    let text = description
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .unwrap_or("Managed by Castor");

    let mut lines = Vec::new();
    lines.push("[Unit]".to_string());
    lines.push(format!("Description={text}"));
    lines.push("After=network.target".to_string());
    lines.push("Wants=network.target".to_string());
    lines.push(String::new());

    lines.push("[Service]".to_string());
    lines.push("Type=simple".to_string());
    lines.push(format!("WorkingDirectory={}", working_dir.trim()));
    lines.push(format!("ExecStart={}", exec_start.trim()));

    if let Some(value) = exec_stop.map(str::trim).filter(|item| !item.is_empty()) {
        lines.push(format!("ExecStop={value}"));
    }

    if matches!(scope, SystemdScope::System) {
        if let Some(value) = service_user.map(str::trim).filter(|item| !item.is_empty()) {
            lines.push(format!("User={value}"));
        }
    }

    if let Some(values) = environment {
        for item in values {
            if item.trim().is_empty() {
                continue;
            }
            lines.push(format!(
                "Environment=\"{}\"",
                escape_systemd_quoted(item.trim())
            ));
        }
    }

    lines.push("Restart=always".to_string());
    lines.push("RestartSec=5".to_string());
    lines.push(String::new());

    lines.push("[Install]".to_string());
    lines.push(format!(
        "WantedBy={}",
        match scope {
            SystemdScope::System => "multi-user.target",
            SystemdScope::User => "default.target",
        }
    ));

    lines.push(String::new());
    if lines.len() < 4 {
        return Err("failed to build unit content".to_string());
    }
    Ok(lines.join("\n"))
}

fn escape_systemd_quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn build_deploy_script(
    unit_content: &str,
    service_file: &str,
    unit_path: &str,
    scope: SystemdScope,
    use_sudo: bool,
    enable_on_boot: bool,
) -> String {
    let prefix = systemctl_prefix(scope, use_sudo);
    let install_cmd = match scope {
        SystemdScope::System => {
            if use_sudo {
                format!("sudo install -D -m 0644 \"$tmp_unit\" \"{unit_path}\"")
            } else {
                format!("install -D -m 0644 \"$tmp_unit\" \"{unit_path}\"")
            }
        }
        SystemdScope::User => format!(
            "mkdir -p \"$HOME/.config/systemd/user\"\ninstall -D -m 0644 \"$tmp_unit\" \"{unit_path}\""
        ),
    };

    let enable_cmd = if enable_on_boot {
        format!("{prefix} enable {service_file}")
    } else {
        String::new()
    };

    format!(
        r#"set -euo pipefail
tmp_unit="$(mktemp)"
cat >"$tmp_unit" <<'CASTOR_SYSTEMD_UNIT_EOF'
{unit_content}
CASTOR_SYSTEMD_UNIT_EOF
{install_cmd}
rm -f "$tmp_unit"
{prefix} daemon-reload
{enable_cmd}
{prefix} restart {service_file}
{prefix} --no-pager --full status {service_file} | sed -n '1,40p'
"#
    )
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

fn build_connection_key(profile: &ConnectionProfile, auth: &AuthConfig) -> SystemdConnectionKey {
    SystemdConnectionKey {
        host: profile.host.clone(),
        port: profile.port,
        username: profile.username.clone(),
        auth_fingerprint: auth_fingerprint(auth),
    }
}

fn systemd_connection_pool() -> &'static Mutex<HashMap<SystemdConnectionKey, Arc<Mutex<Session>>>> {
    static POOL: OnceLock<Mutex<HashMap<SystemdConnectionKey, Arc<Mutex<Session>>>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remove_pooled_connection(key: &SystemdConnectionKey) {
    if let Ok(mut pool) = systemd_connection_pool().lock() {
        pool.remove(key);
    }
}

fn get_or_create_pooled_connection(
    key: &SystemdConnectionKey,
    profile: &ConnectionProfile,
) -> Result<Arc<Mutex<Session>>, String> {
    if let Some(existing) = systemd_connection_pool()
        .lock()
        .map_err(|_| "systemd connection pool lock poisoned".to_string())?
        .get(key)
        .cloned()
    {
        return Ok(existing);
    }

    let session = Arc::new(Mutex::new(connect_ssh_profile(profile)?));
    let mut pool = systemd_connection_pool()
        .lock()
        .map_err(|_| "systemd connection pool lock poisoned".to_string())?;
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
            .map_err(|_| "systemd pooled ssh session lock poisoned".to_string())?;

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

    Err("systemd pooled ssh operation failed".to_string())
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

fn load_systemd_services(app: &AppHandle) -> Result<Vec<SystemdDeployService>, String> {
    let path = systemd_services_file_path(app)?;
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.trim().is_empty() {
                return Ok(vec![]);
            }
            serde_json::from_str(&content)
                .map_err(|err| format!("failed to parse systemd deploy services: {err}"))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(format!("failed to read systemd deploy services: {err}")),
    }
}

fn save_systemd_services(app: &AppHandle, services: &[SystemdDeployService]) -> Result<(), String> {
    let path = systemd_services_file_path(app)?;
    let body = serde_json::to_string_pretty(services)
        .map_err(|err| format!("failed to encode systemd deploy services: {err}"))?;
    fs::write(path, body).map_err(|err| format!("failed to write systemd deploy services: {err}"))
}

fn systemd_services_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("failed to resolve app config dir: {err}"))?;
    fs::create_dir_all(&config_dir)
        .map_err(|err| format!("failed to initialize app config dir: {err}"))?;
    Ok(config_dir.join("systemd_deploy_services.json"))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
