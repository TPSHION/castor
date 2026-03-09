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

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SystemdLogOutputMode {
    Journal,
    File,
    None,
}

fn default_log_output_mode() -> SystemdLogOutputMode {
    SystemdLogOutputMode::Journal
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
    #[serde(default = "default_log_output_mode")]
    pub log_output_mode: SystemdLogOutputMode,
    #[serde(default)]
    pub log_output_path: Option<String>,
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
    pub log_output_mode: Option<SystemdLogOutputMode>,
    pub log_output_path: Option<String>,
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
pub struct GetSystemdDeployServiceLogsRequest {
    pub id: String,
    pub lines: Option<u32>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SystemdServiceLogsResult {
    pub lines: Vec<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListRemoteSystemdServicesRequest {
    pub profile_id: String,
    pub scope: Option<SystemdScope>,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct RemoteSystemdServiceItem {
    pub service_name: String,
    pub unit_file_state: String,
}

#[derive(Debug, Deserialize)]
pub struct GetRemoteSystemdServiceTemplateRequest {
    pub profile_id: String,
    pub service_name: String,
    pub scope: Option<SystemdScope>,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct RemoteSystemdServiceTemplate {
    pub service_name: String,
    pub description: Option<String>,
    pub working_dir: Option<String>,
    pub exec_start: Option<String>,
    pub exec_stop: Option<String>,
    pub service_user: Option<String>,
    pub environment: Option<Vec<String>>,
    pub log_output_mode: Option<SystemdLogOutputMode>,
    pub log_output_path: Option<String>,
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
    pub log_output_mode: Option<SystemdLogOutputMode>,
    pub log_output_path: Option<String>,
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
        request.log_output_mode,
        request.log_output_path.as_deref(),
    )?;

    let _services_lock = systemd_services_store_lock()
        .lock()
        .map_err(|_| "systemd services store lock poisoned".to_string())?;
    let mut services = load_systemd_services(app)?;
    let now = now_unix();
    let normalized_service_name = normalize_service_name(&request.service_name)?;
    let (log_output_mode, log_output_path) =
        normalize_log_output(request.log_output_mode, request.log_output_path)?;
    ensure_unique_service_name(
        &services,
        &normalized_service_name,
        request.id.as_deref(),
    )?;

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
            existing.log_output_mode = log_output_mode;
            existing.log_output_path = log_output_path.clone();
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
            log_output_mode,
            log_output_path,
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
    let removed = {
        let _services_lock = systemd_services_store_lock()
            .lock()
            .map_err(|_| "systemd services store lock poisoned".to_string())?;
        let services = load_systemd_services(app)?;
        services
            .iter()
            .find(|service| service.id == request.id)
            .cloned()
            .ok_or_else(|| format!("systemd deploy service {} not found", request.id.clone()))?
    };

    let profile = find_profile(app, &removed.profile_id)?;
    let service_file = service_file_name(&removed.service_name);
    let remove_script = build_remove_script(&service_file, removed.scope, removed.use_sudo);

    with_pooled_session(&profile, |session| {
        let (stdout, stderr, exit_status) = run_remote_script(session, &remove_script)?;
        if exit_status != 0 {
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            return Err(format!(
                "failed to remove {} (exit code {exit_status}): {}",
                service_file,
                if detail.is_empty() {
                    "unknown error"
                } else {
                    detail
                }
            ));
        }
        Ok(())
    })?;

    let _services_lock = systemd_services_store_lock()
        .lock()
        .map_err(|_| "systemd services store lock poisoned".to_string())?;
    let mut services = load_systemd_services(app)?;
    let previous_len = services.len();
    services.retain(|service| service.id != request.id);
    if services.len() == previous_len {
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
        request.log_output_mode,
        request.log_output_path.as_deref(),
    )?;

    let normalized_service_name = normalize_service_name(&request.service_name)?;
    let (log_output_mode, log_output_path) =
        normalize_log_output(request.log_output_mode, request.log_output_path)?;
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
        log_output_mode,
        log_output_path.as_deref(),
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
        service.log_output_mode,
        service.log_output_path.as_deref(),
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

pub fn list_remote_systemd_services(
    app: &AppHandle,
    request: ListRemoteSystemdServicesRequest,
) -> Result<Vec<RemoteSystemdServiceItem>, String> {
    validate_profile_exists(app, &request.profile_id)?;
    let profile = find_profile(app, &request.profile_id)?;
    let scope = request.scope.unwrap_or(SystemdScope::System);
    let use_sudo = request.use_sudo.unwrap_or(matches!(scope, SystemdScope::System));

    with_pooled_session(&profile, |session| {
        query_remote_systemd_services(session, scope, use_sudo)
    })
}

pub fn get_remote_systemd_service_template(
    app: &AppHandle,
    request: GetRemoteSystemdServiceTemplateRequest,
) -> Result<RemoteSystemdServiceTemplate, String> {
    validate_profile_exists(app, &request.profile_id)?;
    let profile = find_profile(app, &request.profile_id)?;
    let scope = request.scope.unwrap_or(SystemdScope::System);
    let use_sudo = request.use_sudo.unwrap_or(matches!(scope, SystemdScope::System));
    let normalized_service_name = normalize_service_name(&request.service_name)?;

    with_pooled_session(&profile, |session| {
        query_remote_systemd_service_template(session, &normalized_service_name, scope, use_sudo)
    })
}

pub fn get_systemd_deploy_service_logs(
    app: &AppHandle,
    request: GetSystemdDeployServiceLogsRequest,
) -> Result<SystemdServiceLogsResult, String> {
    let service = load_systemd_services(app)?
        .into_iter()
        .find(|item| item.id == request.id)
        .ok_or_else(|| format!("systemd deploy service {} not found", request.id))?;

    if matches!(service.log_output_mode, SystemdLogOutputMode::None) {
        return Ok(SystemdServiceLogsResult {
            lines: Vec::new(),
            cursor: None,
        });
    }

    let profile = find_profile(app, &service.profile_id)?;
    with_pooled_session(&profile, |session| {
        match service.log_output_mode {
            SystemdLogOutputMode::Journal => query_service_logs(
                session,
                &service.service_name,
                service.scope,
                service.use_sudo,
                request.lines,
                request.cursor.as_deref(),
            ),
            SystemdLogOutputMode::File => query_service_file_logs(
                session,
                service
                    .log_output_path
                    .as_deref()
                    .ok_or_else(|| "log_output_path is required when log_output_mode is file".to_string())?,
                service.scope,
                service.use_sudo,
                request.lines,
                request.cursor.as_deref(),
            ),
            SystemdLogOutputMode::None => Ok(SystemdServiceLogsResult {
                lines: Vec::new(),
                cursor: None,
            }),
        }
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
    log_output_mode: SystemdLogOutputMode,
    log_output_path: Option<&str>,
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
        log_output_mode,
        log_output_path,
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

fn query_service_logs(
    session: &mut Session,
    service_name: &str,
    scope: SystemdScope,
    use_sudo: bool,
    lines: Option<u32>,
    cursor: Option<&str>,
) -> Result<SystemdServiceLogsResult, String> {
    let service_file = service_file_name(service_name);
    let prefix = journalctl_prefix(scope, use_sudo);
    let line_limit = lines.unwrap_or(200).clamp(20, 1000);
    let mut command = format!(
        "{prefix} -u {} --no-pager --quiet --output=short-iso --show-cursor -n {line_limit}",
        shell_quote(&service_file)
    );
    if let Some(value) = cursor.map(str::trim).filter(|item| !item.is_empty()) {
        command.push_str(&format!(" --after-cursor {}", shell_quote(value)));
    }
    let script = format!("set -euo pipefail\n{command}");

    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to read logs for {} (exit code {exit_status}): {}",
            service_file,
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    Ok(parse_journalctl_output(&stdout, cursor))
}

fn query_remote_systemd_services(
    session: &mut Session,
    scope: SystemdScope,
    use_sudo: bool,
) -> Result<Vec<RemoteSystemdServiceItem>, String> {
    let prefix = systemctl_prefix(scope, use_sudo);
    let custom_dir = match scope {
        SystemdScope::System => "/etc/systemd/system",
        SystemdScope::User => "$HOME/.config/systemd/user",
    };
    let script = format!(
        r#"set -euo pipefail
list_output="$({prefix} list-unit-files --type=service --no-legend --no-pager 2>/dev/null || true)"
if [ ! -d "{custom_dir}" ]; then
  exit 0
fi
find "{custom_dir}" -maxdepth 1 \( -type f -o -type l \) -name '*.service' -print 2>/dev/null | while read -r path; do
  [ -z "$path" ] && continue
  unit="$(basename "$path")"
  case "$unit" in
    *@.service) continue ;;
  esac
  state="$(printf '%s\n' "$list_output" | awk -v unit="$unit" '$1==unit {{ print $2; exit }}')"
  if [ -z "$state" ]; then
    state="unknown"
  fi
  printf "%s\t%s\n" "$unit" "$state"
done
"#
    );
    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to list remote systemd services (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }
    Ok(parse_remote_systemd_service_items(&stdout))
}

fn query_remote_systemd_service_template(
    session: &mut Session,
    service_name: &str,
    scope: SystemdScope,
    use_sudo: bool,
) -> Result<RemoteSystemdServiceTemplate, String> {
    let prefix = systemctl_prefix(scope, use_sudo);
    let service_file = service_file_name(service_name);
    let script = format!(
        "set -euo pipefail\n{prefix} cat {}",
        shell_quote(&service_file)
    );
    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to read remote systemd service {} (exit code {exit_status}): {}",
            service_file,
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }
    Ok(parse_remote_service_template_from_unit_content(
        &stdout,
        service_name,
    ))
}

fn query_service_file_logs(
    session: &mut Session,
    log_path: &str,
    scope: SystemdScope,
    use_sudo: bool,
    lines: Option<u32>,
    cursor: Option<&str>,
) -> Result<SystemdServiceLogsResult, String> {
    let line_limit = lines.unwrap_or(200).clamp(20, 1000);
    let tail_prefix = match scope {
        SystemdScope::System if use_sudo => "sudo",
        _ => "",
    };
    let (cursor_inode, cursor_offset) = parse_file_log_cursor(cursor);
    let cursor_number = cursor_offset
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-1".to_string());
    let cursor_inode_number = cursor_inode
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-1".to_string());

    let tail_command = if tail_prefix.is_empty() {
        "tail".to_string()
    } else {
        format!("{tail_prefix} tail")
    };
    let wc_command = if tail_prefix.is_empty() {
        "wc -c".to_string()
    } else {
        format!("{tail_prefix} wc -c")
    };
    let script = format!(
        r#"set -euo pipefail
log_path={log_path}
line_limit={line_limit}
cursor_offset={cursor_offset}
cursor_inode={cursor_inode}
size=$({wc_command} < "$log_path" 2>/dev/null | tr -d '[:space:]' || true)
inode=$(stat -c '%i' "$log_path" 2>/dev/null | tr -d '[:space:]' || true)
if [ -z "$size" ]; then
  size=0
fi
if [ -z "$inode" ]; then
  inode=0
fi
if [ "$size" -eq 0 ]; then
  echo "-- cursor: ${{inode}}:0"
  exit 0
fi
if [ "$cursor_offset" -ge 0 ]; then
  if [ "$cursor_inode" -ge 0 ] && [ "$cursor_inode" -ne "$inode" ]; then
    {tail_command} -n "$line_limit" "$log_path" || true
  elif [ "$cursor_offset" -lt "$size" ]; then
    start=$((cursor_offset + 1))
    {tail_command} -c +"$start" "$log_path" || true
  fi
else
  {tail_command} -n "$line_limit" "$log_path" || true
fi
echo "-- cursor: ${{inode}}:$size"
"#,
        log_path = shell_quote(log_path),
        line_limit = line_limit,
        cursor_offset = cursor_number,
        cursor_inode = cursor_inode_number,
        wc_command = wc_command,
        tail_command = tail_command
    );
    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to read file logs (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    Ok(parse_journalctl_output(&stdout, cursor))
}

fn parse_file_log_cursor(cursor: Option<&str>) -> (Option<u64>, Option<u64>) {
    let value = match cursor.map(str::trim).filter(|item| !item.is_empty()) {
        Some(value) => value,
        None => return (None, None),
    };

    if let Some((inode_part, offset_part)) = value.split_once(':') {
        let inode = inode_part.trim().parse::<u64>().ok();
        let offset = offset_part.trim().parse::<u64>().ok();
        return (inode, offset);
    }

    (None, value.parse::<u64>().ok())
}

fn parse_remote_systemd_service_items(raw: &str) -> Vec<RemoteSystemdServiceItem> {
    let mut items = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let unit_file = parts.next().unwrap_or("");
        if !unit_file.ends_with(".service") || unit_file.ends_with("@.service") {
            continue;
        }
        let state = parts.next().unwrap_or("unknown");
        let service_name = match unit_file.strip_suffix(".service") {
            Some(name) if !name.trim().is_empty() => name.trim(),
            _ => continue,
        };
        items.push(RemoteSystemdServiceItem {
            service_name: service_name.to_string(),
            unit_file_state: state.to_string(),
        });
    }
    items.sort_by(|a, b| a.service_name.cmp(&b.service_name));
    items
}

fn parse_remote_service_template_from_unit_content(
    raw: &str,
    service_name: &str,
) -> RemoteSystemdServiceTemplate {
    let mut section = String::new();
    let mut description: Option<String> = None;
    let mut working_dir: Option<String> = None;
    let mut exec_start: Option<String> = None;
    let mut exec_stop: Option<String> = None;
    let mut service_user: Option<String> = None;
    let mut environment: Vec<String> = Vec::new();
    let mut standard_output: Option<String> = None;
    let mut standard_error: Option<String> = None;

    for line in unit_file_logical_lines(raw) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            section = trimmed[1..trimmed.len() - 1].trim().to_ascii_lowercase();
            continue;
        }

        let Some((raw_key, raw_value)) = trimmed.split_once('=') else {
            continue;
        };
        let key = raw_key.trim();
        let value = normalize_unit_file_value(raw_value);
        if value.is_empty() {
            continue;
        }

        if section == "unit" {
            if key.eq_ignore_ascii_case("Description") && description.is_none() {
                description = Some(value);
            }
            continue;
        }

        if section == "service" {
            if key.eq_ignore_ascii_case("WorkingDirectory") && working_dir.is_none() {
                working_dir = Some(value.clone());
            } else if key.eq_ignore_ascii_case("ExecStart") && exec_start.is_none() {
                exec_start = Some(value.clone());
            } else if key.eq_ignore_ascii_case("ExecStop") && exec_stop.is_none() {
                exec_stop = Some(value.clone());
            } else if key.eq_ignore_ascii_case("User") && service_user.is_none() {
                service_user = Some(value.clone());
            } else if key.eq_ignore_ascii_case("Environment") {
                environment.push(value.clone());
            } else if key.eq_ignore_ascii_case("StandardOutput") && standard_output.is_none() {
                standard_output = Some(value.clone());
            } else if key.eq_ignore_ascii_case("StandardError") && standard_error.is_none() {
                standard_error = Some(value.clone());
            }
        }
    }

    let (log_output_mode, log_output_path) =
        parse_remote_log_output_mode(standard_output.as_deref(), standard_error.as_deref());

    RemoteSystemdServiceTemplate {
        service_name: service_name.to_string(),
        description,
        working_dir,
        exec_start,
        exec_stop,
        service_user,
        environment: if environment.is_empty() {
            None
        } else {
            Some(environment)
        },
        log_output_mode,
        log_output_path,
    }
}

fn parse_remote_log_output_mode(
    standard_output: Option<&str>,
    standard_error: Option<&str>,
) -> (Option<SystemdLogOutputMode>, Option<String>) {
    let stdout = standard_output.map(str::trim).filter(|item| !item.is_empty());
    let stderr = standard_error.map(str::trim).filter(|item| !item.is_empty());
    let primary = stdout.or(stderr);

    let Some(value) = primary else {
        return (None, None);
    };

    if value.eq_ignore_ascii_case("null") {
        return (Some(SystemdLogOutputMode::None), None);
    }

    if value.eq_ignore_ascii_case("journal") || value.eq_ignore_ascii_case("journal+console") {
        return (Some(SystemdLogOutputMode::Journal), None);
    }

    if let Some(path) = value.strip_prefix("append:").or_else(|| value.strip_prefix("file:")) {
        let normalized = path.trim();
        if !normalized.is_empty() {
            return (
                Some(SystemdLogOutputMode::File),
                Some(normalized.to_string()),
            );
        }
    }

    (Some(SystemdLogOutputMode::Journal), None)
}

fn unit_file_logical_lines(raw: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();

    for raw_line in raw.lines() {
        let line = raw_line.trim_end_matches('\r');
        if current.is_empty() {
            current.push_str(line);
        } else {
            current.push_str(line.trim_start());
        }

        if current.ends_with('\\') {
            current.pop();
            continue;
        }

        lines.push(current.clone());
        current.clear();
    }

    if !current.trim().is_empty() {
        lines.push(current);
    }

    lines
}

fn normalize_unit_file_value(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0];
        let last = trimmed.as_bytes()[trimmed.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return trimmed[1..trimmed.len() - 1].trim().to_string();
        }
    }
    trimmed.to_string()
}

fn parse_journalctl_output(raw: &str, previous_cursor: Option<&str>) -> SystemdServiceLogsResult {
    let mut lines = Vec::new();
    let mut next_cursor = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed == "-- No entries --" || trimmed.starts_with("-- Logs begin at ") {
            continue;
        }
        if let Some(cursor) = line.strip_prefix("-- cursor: ") {
            let value = cursor.trim();
            if !value.is_empty() {
                next_cursor = Some(value.to_string());
            }
            continue;
        }
        lines.push(strip_ansi_escape_codes(line));
    }

    if next_cursor.is_none() {
        next_cursor = previous_cursor
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
    }

    SystemdServiceLogsResult {
        lines,
        cursor: next_cursor,
    }
}

fn strip_ansi_escape_codes(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == 0x1B {
            index += 1;
            if index >= bytes.len() {
                break;
            }

            match bytes[index] {
                b'[' => {
                    // CSI: ESC [ ... final-byte
                    index += 1;
                    while index < bytes.len() {
                        let b = bytes[index];
                        if (0x40..=0x7E).contains(&b) {
                            index += 1;
                            break;
                        }
                        index += 1;
                    }
                }
                b']' => {
                    // OSC: ESC ] ... (BEL or ESC \)
                    index += 1;
                    while index < bytes.len() {
                        let b = bytes[index];
                        if b == 0x07 {
                            index += 1;
                            break;
                        }
                        if b == 0x1B && index + 1 < bytes.len() && bytes[index + 1] == b'\\' {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                _ => {
                    // Other 2-byte escape sequences.
                    index += 1;
                }
            }
            continue;
        }

        output.push(bytes[index] as char);
        index += 1;
    }

    output
}

fn journalctl_prefix(scope: SystemdScope, use_sudo: bool) -> String {
    match scope {
        SystemdScope::System => {
            if use_sudo {
                "sudo journalctl".to_string()
            } else {
                "journalctl".to_string()
            }
        }
        SystemdScope::User => "journalctl --user".to_string(),
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
    log_output_mode: Option<SystemdLogOutputMode>,
    log_output_path: Option<&str>,
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

    validate_log_output(
        log_output_mode.unwrap_or_else(default_log_output_mode),
        log_output_path,
    )?;

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

fn normalize_log_output(
    mode: Option<SystemdLogOutputMode>,
    path: Option<String>,
) -> Result<(SystemdLogOutputMode, Option<String>), String> {
    let normalized_mode = mode.unwrap_or_else(default_log_output_mode);
    let normalized_path = sanitize_optional(path);
    validate_log_output(normalized_mode, normalized_path.as_deref())?;
    if matches!(normalized_mode, SystemdLogOutputMode::File) {
        Ok((normalized_mode, normalized_path))
    } else {
        Ok((normalized_mode, None))
    }
}

fn validate_log_output(mode: SystemdLogOutputMode, path: Option<&str>) -> Result<(), String> {
    if matches!(mode, SystemdLogOutputMode::File) {
        let value = path
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .ok_or_else(|| "log_output_path is required when log_output_mode is file".to_string())?;
        assert_no_newline(value, "log_output_path")?;
    }
    Ok(())
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
    log_output_mode: SystemdLogOutputMode,
    log_output_path: Option<&str>,
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

    match log_output_mode {
        SystemdLogOutputMode::Journal => {
            lines.push("StandardOutput=journal".to_string());
            lines.push("StandardError=journal".to_string());
        }
        SystemdLogOutputMode::File => {
            let path = log_output_path
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .ok_or_else(|| "log_output_path is required when log_output_mode is file".to_string())?;
            lines.push(format!("StandardOutput=append:{path}"));
            lines.push(format!("StandardError=append:{path}"));
        }
        SystemdLogOutputMode::None => {
            lines.push("StandardOutput=null".to_string());
            lines.push("StandardError=null".to_string());
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

fn build_remove_script(service_file: &str, scope: SystemdScope, use_sudo: bool) -> String {
    let prefix = systemctl_prefix(scope, use_sudo);
    let unit_path = unit_path(scope, service_file);
    let remove_cmd = match scope {
        SystemdScope::System => {
            if use_sudo {
                "sudo rm -f \"$unit_path\"".to_string()
            } else {
                "rm -f \"$unit_path\"".to_string()
            }
        }
        SystemdScope::User => "rm -f \"$unit_path\"".to_string(),
    };

    format!(
        r#"set -euo pipefail
service_file={service_file_quoted}
unit_path="{unit_path}"
{prefix} stop "$service_file" >/dev/null 2>&1 || true
{prefix} disable "$service_file" >/dev/null 2>&1 || true
{remove_cmd}
{prefix} daemon-reload >/dev/null 2>&1 || true
{prefix} reset-failed "$service_file" >/dev/null 2>&1 || true
"#,
        service_file_quoted = shell_quote(service_file),
        unit_path = unit_path,
        prefix = prefix,
        remove_cmd = remove_cmd
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

fn systemd_services_store_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn ensure_unique_service_name(
    services: &[SystemdDeployService],
    normalized_service_name: &str,
    current_id: Option<&str>,
) -> Result<(), String> {
    let duplicated = services.iter().any(|item| {
        if current_id.is_some_and(|id| item.id == id) {
            return false;
        }
        item.service_name.eq_ignore_ascii_case(normalized_service_name)
    });
    if duplicated {
        return Err(format!(
            "service_name already exists: {}",
            normalized_service_name
        ));
    }
    Ok(())
}
