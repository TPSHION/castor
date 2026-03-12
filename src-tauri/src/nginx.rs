use std::collections::{hash_map::DefaultHasher, HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ssh2::Session;
use tauri::{AppHandle, Emitter, Manager};
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
pub struct DeployNginxServiceRequest {
    pub id: String,
    pub deploy_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TestNginxServiceConfigRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct ParseNginxServiceConfigRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct ReadNginxServiceConfigFileRequest {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub struct NginxServiceConfigFileResult {
    pub id: String,
    pub source_path: String,
    pub content: String,
    pub loaded_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct SaveNginxServiceConfigFileRequest {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct NginxServiceConfigFileSaveResult {
    pub id: String,
    pub source_path: String,
    pub bytes: u64,
    pub saved_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct ValidateNginxServiceConfigContentRequest {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct NginxConfigValidationResult {
    pub id: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub checked_at: u64,
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
pub struct DeployNginxServiceResult {
    pub id: String,
    pub deploy_id: String,
    pub installed_before: bool,
    pub nginx_bin: String,
    pub conf_path: Option<String>,
    pub pid_path: Option<String>,
    pub version: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub deployed_at: u64,
}

#[derive(Clone, Debug, Serialize)]
struct NginxDeployLogPayload {
    deploy_id: String,
    service_id: String,
    line: String,
    timestamp: u64,
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

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NginxConfigNodeType {
    Directive,
    Block,
}

#[derive(Clone, Debug, Serialize)]
pub struct NginxParsedConfigNode {
    pub id: String,
    pub node_type: NginxConfigNodeType,
    pub name: String,
    pub args: Vec<String>,
    pub line_start: u32,
    pub line_end: u32,
    pub children: Vec<NginxParsedConfigNode>,
}

#[derive(Debug, Serialize)]
pub struct NginxParsedConfigSummary {
    pub server_count: u32,
    pub upstream_count: u32,
    pub location_count: u32,
    pub include_count: u32,
    pub listen: Vec<String>,
    pub server_names: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct NginxParsedConfigResult {
    pub id: String,
    pub source_path: String,
    pub parsed_at: u64,
    pub summary: NginxParsedConfigSummary,
    pub root: NginxParsedConfigNode,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct NginxConnectionKey {
    host: String,
    port: u16,
    username: String,
    auth_fingerprint: u64,
}

const NGINX_DEPLOY_LOG_EVENT: &str = "nginx-deploy-log";

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

pub fn deploy_nginx_service(
    app: &AppHandle,
    request: DeployNginxServiceRequest,
) -> Result<DeployNginxServiceResult, String> {
    let deploy_id = request
        .deploy_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let service = find_nginx_service_by_id(app, &request.id)?;
    let profile = find_profile(app, &service.profile_id)?;

    push_nginx_deploy_log(
        app,
        &deploy_id,
        &service.id,
        format!(
            "开始部署：{} ({})",
            service.name,
            profile.host
        ),
    );

    let (stdout, stderr, exit_status, installed_before, discovery) = with_pooled_session(
        &profile,
        |session| {
            let command_script = build_deploy_script(&service);
            let (stdout, exit_status) = run_remote_script_streaming_stdout(
                session,
                &command_script,
                |line| push_nginx_deploy_log(app, &deploy_id, &service.id, line),
            )?;
            let stderr = String::new();
            if exit_status != 0 {
                let detail = if stderr.trim().is_empty() {
                    stdout.trim()
                } else {
                    stderr.trim()
                };
                push_nginx_deploy_log(
                    app,
                    &deploy_id,
                    &service.id,
                    format!("部署失败：{}", detail),
                );
                return Err(format!(
                    "部署 nginx 失败 (exit code {exit_status}): {}",
                    if detail.is_empty() {
                        "unknown error"
                    } else {
                        detail
                    }
                ));
            }

            let installed_before = parse_deploy_output_installed_before(&stdout);
            let discovery = query_remote_nginx(session)?;
            Ok((stdout, stderr, exit_status, installed_before, discovery))
        },
    )?;

    let discovered_bin = discovery
        .nginx_bin
        .clone()
        .ok_or_else(|| "部署完成但未检测到 nginx 命令路径".to_string())?;

    let _services_lock = nginx_services_store_lock()
        .lock()
        .map_err(|_| "nginx services store lock poisoned".to_string())?;
    let mut services = load_nginx_services(app)?;
    let target = services
        .iter_mut()
        .find(|item| item.id == service.id)
        .ok_or_else(|| format!("nginx service {} not found", service.id))?;
    target.nginx_bin = discovered_bin.clone();
    if discovery.conf_path.is_some() {
        target.conf_path = discovery.conf_path.clone();
    }
    if discovery.pid_path.is_some() {
        target.pid_path = discovery.pid_path.clone();
    }
    target.updated_at = now_unix();
    save_nginx_services(app, &services)?;

    let target_service_id = service.id.clone();
    push_nginx_deploy_log(
        app,
        &deploy_id,
        &target_service_id,
        format!(
            "部署完成：nginx_bin={}{}",
            discovered_bin,
            discovery
                .version
                .as_deref()
                .map(|value| format!(", version={value}"))
                .unwrap_or_default()
        ),
    );

    Ok(DeployNginxServiceResult {
        id: service.id,
        deploy_id,
        installed_before,
        nginx_bin: discovered_bin,
        conf_path: discovery.conf_path,
        pid_path: discovery.pid_path,
        version: discovery.version,
        stdout,
        stderr,
        exit_status,
        deployed_at: now_unix(),
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

pub fn parse_nginx_service_config(
    app: &AppHandle,
    request: ParseNginxServiceConfigRequest,
) -> Result<NginxParsedConfigResult, String> {
    let service = find_nginx_service_by_id(app, &request.id)?;
    let profile = find_profile(app, &service.profile_id)?;

    with_pooled_session(&profile, |session| {
        let (source_path, raw_config) = load_nginx_config_text(session, &service)?;
        let root = parse_nginx_config_tree(&raw_config)?;
        let summary = summarize_nginx_config(&root);

        Ok(NginxParsedConfigResult {
            id: service.id.clone(),
            source_path,
            parsed_at: now_unix(),
            summary,
            root,
        })
    })
}

pub fn read_nginx_service_config_file(
    app: &AppHandle,
    request: ReadNginxServiceConfigFileRequest,
) -> Result<NginxServiceConfigFileResult, String> {
    let service = find_nginx_service_by_id(app, &request.id)?;
    let profile = find_profile(app, &service.profile_id)?;

    with_pooled_session(&profile, |session| {
        let (source_path, content) = load_nginx_config_file_content(session, &service)?;
        Ok(NginxServiceConfigFileResult {
            id: service.id.clone(),
            source_path,
            content,
            loaded_at: now_unix(),
        })
    })
}

pub fn save_nginx_service_config_file(
    app: &AppHandle,
    request: SaveNginxServiceConfigFileRequest,
) -> Result<NginxServiceConfigFileSaveResult, String> {
    let service = find_nginx_service_by_id(app, &request.id)?;
    let profile = find_profile(app, &service.profile_id)?;

    with_pooled_session(&profile, |session| {
        let (source_path, bytes) =
            save_nginx_config_file_content(session, &service, request.content.as_str())?;
        Ok(NginxServiceConfigFileSaveResult {
            id: service.id.clone(),
            source_path,
            bytes,
            saved_at: now_unix(),
        })
    })
}

pub fn validate_nginx_service_config_content(
    app: &AppHandle,
    request: ValidateNginxServiceConfigContentRequest,
) -> Result<NginxConfigValidationResult, String> {
    let service = find_nginx_service_by_id(app, &request.id)?;
    let profile = find_profile(app, &service.profile_id)?;

    with_pooled_session(&profile, |session| {
        let (stdout, stderr, exit_status) =
            validate_nginx_config_file_content(session, &service, request.content.as_str())?;
        Ok(NginxConfigValidationResult {
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

fn resolve_nginx_config_path(service: &NginxService) -> String {
    service
        .conf_path
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("/etc/nginx/nginx.conf")
        .to_string()
}

fn load_nginx_config_file_content(
    session: &mut Session,
    service: &NginxService,
) -> Result<(String, String), String> {
    let config_path = resolve_nginx_config_path(service);
    let command_prefix = if service.use_sudo { "sudo " } else { "" };
    let script = format!(
        r#"set -euo pipefail
conf_path={conf_path}
echo "__CASTOR_CONF_PATH=$conf_path"
echo "__CASTOR_CONF_BEGIN__"
{command_prefix}cat "$conf_path"
echo "__CASTOR_CONF_END__"
"#,
        conf_path = shell_quote(config_path.as_str()),
        command_prefix = command_prefix,
    );

    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "读取 nginx 配置文件失败 (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    let mut source_path: Option<String> = None;
    let mut collecting = false;
    let mut content_lines: Vec<String> = Vec::new();
    let mut found_begin = false;
    let mut found_end = false;

    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("__CASTOR_CONF_PATH=") {
            let normalized = value.trim();
            if !normalized.is_empty() {
                source_path = Some(normalized.to_string());
            }
            continue;
        }
        if line == "__CASTOR_CONF_BEGIN__" {
            collecting = true;
            found_begin = true;
            continue;
        }
        if line == "__CASTOR_CONF_END__" {
            collecting = false;
            found_end = true;
            continue;
        }
        if collecting {
            content_lines.push(line.to_string());
        }
    }

    if !found_begin || !found_end {
        return Err("读取 nginx 配置文件失败：未找到配置输出边界标记".to_string());
    }

    Ok((source_path.unwrap_or(config_path), content_lines.join("\n")))
}

fn save_nginx_config_file_content(
    session: &mut Session,
    service: &NginxService,
    content: &str,
) -> Result<(String, u64), String> {
    let config_path = resolve_nginx_config_path(service);
    let command_prefix = if service.use_sudo { "sudo " } else { "" };
    let heredoc_marker = {
        let mut marker = format!("__CASTOR_NGINX_CONF_{}__", Uuid::new_v4().simple());
        while content.contains(marker.as_str()) {
            marker.push('_');
        }
        marker
    };

    let script = format!(
        r#"set -euo pipefail
conf_path={conf_path}
tmp_file="$(mktemp)"
cleanup() {{
  rm -f "$tmp_file"
}}
trap cleanup EXIT

cat > "$tmp_file" <<'{heredoc_marker}'
{content}
{heredoc_marker}

bytes="$(wc -c < "$tmp_file" | tr -d '[:space:]')"
if [ -z "$bytes" ]; then
  bytes=0
fi

if [ "{use_sudo}" = "1" ]; then
  {command_prefix}tee "$conf_path" >/dev/null < "$tmp_file"
else
  cat "$tmp_file" > "$conf_path"
fi

echo "__CASTOR_CONF_PATH=$conf_path"
echo "__CASTOR_SAVED_BYTES=$bytes"
"#,
        conf_path = shell_quote(config_path.as_str()),
        heredoc_marker = heredoc_marker,
        content = content,
        use_sudo = if service.use_sudo { "1" } else { "0" },
        command_prefix = command_prefix,
    );

    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "保存 nginx 配置文件失败 (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    let mut source_path: Option<String> = None;
    let mut bytes: Option<u64> = None;

    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("__CASTOR_CONF_PATH=") {
            let normalized = value.trim();
            if !normalized.is_empty() {
                source_path = Some(normalized.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_SAVED_BYTES=") {
            bytes = value.trim().parse::<u64>().ok();
        }
    }

    Ok((source_path.unwrap_or(config_path), bytes.unwrap_or(0)))
}

fn validate_nginx_config_file_content(
    session: &mut Session,
    service: &NginxService,
    content: &str,
) -> Result<(String, String, i32), String> {
    let config_path = resolve_nginx_config_path(service);
    let command_prefix = if service.use_sudo { "sudo " } else { "" };
    let nginx_bin = shell_quote(service.nginx_bin.as_str());
    let heredoc_marker = {
        let mut marker = format!("__CASTOR_NGINX_VALIDATE_{}__", Uuid::new_v4().simple());
        while content.contains(marker.as_str()) {
            marker.push('_');
        }
        marker
    };

    let script = format!(
        r#"set -uo pipefail
nginx_bin={nginx_bin}
conf_path={conf_path}
conf_dir="$(dirname "$conf_path")"
tmp_file="$(mktemp)"
cleanup() {{
  rm -f "$tmp_file"
}}
trap cleanup EXIT

cat > "$tmp_file" <<'{heredoc_marker}'
{content}
{heredoc_marker}

{command_prefix}"$nginx_bin" -t -c "$tmp_file" -p "$conf_dir"
"#,
        nginx_bin = nginx_bin,
        conf_path = shell_quote(config_path.as_str()),
        heredoc_marker = heredoc_marker,
        content = content,
        command_prefix = command_prefix,
    );

    run_remote_script(session, &script)
}

fn load_nginx_config_text(
    session: &mut Session,
    service: &NginxService,
) -> Result<(String, String), String> {
    let config_path = service
        .conf_path
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("/etc/nginx/nginx.conf");
    let command_prefix = if service.use_sudo { "sudo " } else { "" };
    let conf_arg = format!(" -c {}", shell_quote(config_path));
    let nginx_bin = shell_quote(service.nginx_bin.as_str());

    let script = format!(
        r#"set -euo pipefail
nginx_bin={nginx_bin}
conf_path={conf_path}
echo "__CASTOR_CONF_PATH=$conf_path"
echo "__CASTOR_CONF_BEGIN__"
if {command_prefix}"$nginx_bin" -T{conf_arg} 2>&1; then
  echo "__CASTOR_CONF_MODE=nginx_t"
else
  echo "__CASTOR_CONF_MODE=fallback"
  {command_prefix}cat "$conf_path"
fi
echo "__CASTOR_CONF_END__"
"#,
        nginx_bin = nginx_bin,
        conf_path = shell_quote(config_path),
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
            "读取 nginx 配置失败 (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    let mut source_path: Option<String> = None;
    let mut collecting = false;
    let mut config_lines: Vec<String> = Vec::new();
    let mut found_begin = false;
    let mut found_end = false;
    let mut mode = "fallback".to_string();

    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("__CASTOR_CONF_PATH=") {
            let normalized = value.trim();
            if !normalized.is_empty() {
                source_path = Some(normalized.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_CONF_MODE=") {
            let normalized = value.trim();
            if !normalized.is_empty() {
                mode = normalized.to_string();
            }
            continue;
        }
        if line == "__CASTOR_CONF_BEGIN__" {
            collecting = true;
            found_begin = true;
            continue;
        }
        if line == "__CASTOR_CONF_END__" {
            collecting = false;
            found_end = true;
            continue;
        }
        if collecting {
            config_lines.push(line.to_string());
        }
    }

    if !found_begin || !found_end {
        return Err("读取 nginx 配置失败：未找到配置输出边界标记".to_string());
    }

    let raw_config = config_lines.join("\n");
    let normalized_config = if mode == "nginx_t" {
        extract_nginx_t_config_dump(&raw_config).unwrap_or(raw_config)
    } else {
        raw_config
    };

    Ok((
        source_path.unwrap_or_else(|| config_path.to_string()),
        normalized_config,
    ))
}

fn extract_nginx_t_config_dump(raw: &str) -> Option<String> {
    let mut found_file_markers = false;
    let mut lines: Vec<String> = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim_end();
        if trimmed.starts_with("# configuration file ") && trimmed.ends_with(':') {
            found_file_markers = true;
            continue;
        }

        if !found_file_markers {
            continue;
        }

        if trimmed.starts_with("nginx: ") {
            continue;
        }

        lines.push(line.to_string());
    }

    if !found_file_markers {
        return None;
    }

    Some(lines.join("\n"))
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

#[derive(Clone, Debug)]
enum NginxTokenKind {
    Word(String),
    LBrace,
    RBrace,
    Semicolon,
}

#[derive(Clone, Debug)]
struct NginxToken {
    kind: NginxTokenKind,
    line: u32,
}

fn tokenize_nginx_config(raw: &str) -> Result<Vec<NginxToken>, String> {
    let mut tokens: Vec<NginxToken> = Vec::new();
    let mut chars = raw.chars().peekable();
    let mut line: u32 = 1;
    let mut current = String::new();
    let mut current_line = line;
    let mut quote: Option<char> = None;
    let mut current_quoted = false;

    let push_current = |tokens: &mut Vec<NginxToken>,
                        current: &mut String,
                        current_line: u32,
                        current_quoted: &mut bool|
     -> Result<(), String> {
        if !current.is_empty() || *current_quoted {
            tokens.push(NginxToken {
                kind: NginxTokenKind::Word(current.clone()),
                line: current_line,
            });
            current.clear();
            *current_quoted = false;
        }
        Ok(())
    };

    while let Some(ch) = chars.next() {
        if let Some(quote_char) = quote {
            if ch == '\n' {
                line += 1;
            }

            if ch == quote_char {
                quote = None;
                continue;
            }

            if quote_char == '"' && ch == '\\' {
                if let Some(next) = chars.next() {
                    if next == '\n' {
                        line += 1;
                    }
                    current.push(next);
                    continue;
                }
                current.push(ch);
                continue;
            }

            current.push(ch);
            continue;
        }

        match ch {
            '\'' | '"' => {
                if current.is_empty() {
                    current_line = line;
                    current_quoted = true;
                }
                quote = Some(ch);
            }
            '#' => {
                push_current(&mut tokens, &mut current, current_line, &mut current_quoted)?;
                while let Some(next) = chars.next() {
                    if next == '\n' {
                        line += 1;
                        break;
                    }
                }
            }
            '{' => {
                if current.is_empty() {
                    push_current(&mut tokens, &mut current, current_line, &mut current_quoted)?;
                    tokens.push(NginxToken {
                        kind: NginxTokenKind::LBrace,
                        line,
                    });
                } else {
                    current.push(ch);
                }
            }
            '}' => {
                if current.is_empty() {
                    push_current(&mut tokens, &mut current, current_line, &mut current_quoted)?;
                    tokens.push(NginxToken {
                        kind: NginxTokenKind::RBrace,
                        line,
                    });
                } else {
                    current.push(ch);
                }
            }
            ';' => {
                push_current(&mut tokens, &mut current, current_line, &mut current_quoted)?;
                tokens.push(NginxToken {
                    kind: NginxTokenKind::Semicolon,
                    line,
                });
            }
            c if c.is_whitespace() => {
                push_current(&mut tokens, &mut current, current_line, &mut current_quoted)?;
                if c == '\n' {
                    line += 1;
                }
            }
            _ => {
                if current.is_empty() {
                    current_line = line;
                }
                current.push(ch);
            }
        }
    }

    if quote.is_some() {
        return Err(format!(
            "nginx 配置解析失败：第 {current_line} 行存在未闭合的字符串"
        ));
    }

    push_current(&mut tokens, &mut current, current_line, &mut current_quoted)?;
    Ok(tokens)
}

fn parse_nginx_config_tree(raw: &str) -> Result<NginxParsedConfigNode, String> {
    let tokens = tokenize_nginx_config(raw)?;
    let mut index = 0usize;
    let mut next_id = 0u64;
    let children = parse_nginx_block_items(&tokens, &mut index, &mut next_id, false)?;
    if index < tokens.len() {
        return Err(format!(
            "nginx 配置解析失败：第 {} 行存在未处理内容",
            tokens[index].line
        ));
    }

    let line_end = raw.lines().count().max(1) as u32;
    Ok(NginxParsedConfigNode {
        id: "root".to_string(),
        node_type: NginxConfigNodeType::Block,
        name: "main".to_string(),
        args: Vec::new(),
        line_start: 1,
        line_end,
        children,
    })
}

fn parse_nginx_block_items(
    tokens: &[NginxToken],
    index: &mut usize,
    next_id: &mut u64,
    stop_on_rbrace: bool,
) -> Result<Vec<NginxParsedConfigNode>, String> {
    let mut nodes: Vec<NginxParsedConfigNode> = Vec::new();

    while *index < tokens.len() {
        let token = &tokens[*index];
        match &token.kind {
            NginxTokenKind::RBrace => {
                if stop_on_rbrace {
                    *index += 1;
                    return Ok(nodes);
                }
                return Err(format!(
                    "nginx 配置解析失败：第 {} 行出现意外的 `}}`",
                    token.line
                ));
            }
            NginxTokenKind::Semicolon => {
                *index += 1;
                continue;
            }
            _ => {}
        }

        let start_line = token.line;
        let mut words: Vec<String> = Vec::new();

        loop {
            if *index >= tokens.len() {
                return Err(format!(
                    "nginx 配置解析失败：第 {start_line} 行缺少 `;` 或 `{{`"
                ));
            }

            let current = &tokens[*index];
            match &current.kind {
                NginxTokenKind::Word(value) => {
                    words.push(value.clone());
                    *index += 1;
                }
                NginxTokenKind::Semicolon => {
                    *index += 1;
                    if words.is_empty() {
                        break;
                    }
                    let name = words[0].clone();
                    let args = words[1..].to_vec();
                    *next_id += 1;
                    nodes.push(NginxParsedConfigNode {
                        id: format!("n{next_id}"),
                        node_type: NginxConfigNodeType::Directive,
                        name,
                        args,
                        line_start: start_line,
                        line_end: current.line,
                        children: Vec::new(),
                    });
                    break;
                }
                NginxTokenKind::LBrace => {
                    *index += 1;
                    if words.is_empty() {
                        return Err(format!(
                            "nginx 配置解析失败：第 {} 行在 `{{` 前缺少块名称",
                            current.line
                        ));
                    }
                    let name = words[0].clone();
                    let args = words[1..].to_vec();
                    let children = parse_nginx_block_items(tokens, index, next_id, true)?;
                    let end_line = if *index == 0 {
                        current.line
                    } else {
                        tokens[*index - 1].line
                    };
                    *next_id += 1;
                    nodes.push(NginxParsedConfigNode {
                        id: format!("n{next_id}"),
                        node_type: NginxConfigNodeType::Block,
                        name,
                        args,
                        line_start: start_line,
                        line_end: end_line,
                        children,
                    });
                    break;
                }
                NginxTokenKind::RBrace => {
                    if stop_on_rbrace && words.is_empty() {
                        *index += 1;
                        return Ok(nodes);
                    }
                    return Err(format!(
                        "nginx 配置解析失败：第 {} 行在 `}}` 前缺少 `;`",
                        current.line
                    ));
                }
            }
        }
    }

    if stop_on_rbrace {
        return Err("nginx 配置解析失败：存在未闭合的 `{`".to_string());
    }

    Ok(nodes)
}

fn summarize_nginx_config(root: &NginxParsedConfigNode) -> NginxParsedConfigSummary {
    let mut summary = NginxParsedConfigSummary {
        server_count: 0,
        upstream_count: 0,
        location_count: 0,
        include_count: 0,
        listen: Vec::new(),
        server_names: Vec::new(),
    };
    let mut seen_listen: HashSet<String> = HashSet::new();
    let mut seen_server_names: HashSet<String> = HashSet::new();

    fn walk(
        node: &NginxParsedConfigNode,
        summary: &mut NginxParsedConfigSummary,
        seen_listen: &mut HashSet<String>,
        seen_server_names: &mut HashSet<String>,
    ) {
        match node.node_type {
            NginxConfigNodeType::Block => match node.name.as_str() {
                "server" => summary.server_count += 1,
                "upstream" => summary.upstream_count += 1,
                "location" => summary.location_count += 1,
                _ => {}
            },
            NginxConfigNodeType::Directive => {
                if node.name == "include" {
                    summary.include_count += 1;
                }
                if node.name == "listen" {
                    let value = node.args.join(" ");
                    if !value.is_empty()
                        && seen_listen.insert(value.clone())
                        && summary.listen.len() < 24
                    {
                        summary.listen.push(value);
                    }
                }
                if node.name == "server_name" {
                    for name in &node.args {
                        let normalized = name.trim();
                        if normalized.is_empty() {
                            continue;
                        }
                        if seen_server_names.insert(normalized.to_string())
                            && summary.server_names.len() < 48
                        {
                            summary.server_names.push(normalized.to_string());
                        }
                    }
                }
            }
        }

        for child in &node.children {
            walk(child, summary, seen_listen, seen_server_names);
        }
    }

    walk(root, &mut summary, &mut seen_listen, &mut seen_server_names);
    summary
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

fn build_deploy_script(service: &NginxService) -> String {
    let command_prefix = if service.use_sudo { "sudo " } else { "" };
    format!(
        r#"set -euo pipefail
installed_before=0
if command -v nginx >/dev/null 2>&1; then
  installed_before=1
fi
echo "__CASTOR_INSTALLED_BEFORE=$installed_before"
echo "[step] 检查 nginx 安装状态完成"

if [ "$installed_before" = "0" ]; then
  echo "[step] 未检测到 nginx，开始安装"
  if command -v apt-get >/dev/null 2>&1; then
    echo "[step] 使用 apt-get 安装 nginx"
    {command_prefix}DEBIAN_FRONTEND=noninteractive apt-get update
    {command_prefix}DEBIAN_FRONTEND=noninteractive apt-get install -y nginx
  elif command -v dnf >/dev/null 2>&1; then
    echo "[step] 使用 dnf 安装 nginx"
    {command_prefix}dnf install -y nginx
  elif command -v yum >/dev/null 2>&1; then
    echo "[step] 使用 yum 安装 nginx"
    {command_prefix}yum install -y nginx
  elif command -v zypper >/dev/null 2>&1; then
    echo "[step] 使用 zypper 安装 nginx"
    {command_prefix}zypper --non-interactive install nginx
  elif command -v apk >/dev/null 2>&1; then
    echo "[step] 使用 apk 安装 nginx"
    {command_prefix}apk add --no-cache nginx
  elif command -v pacman >/dev/null 2>&1; then
    echo "[step] 使用 pacman 安装 nginx"
    {command_prefix}pacman -Sy --noconfirm nginx
  else
    echo "unsupported package manager: cannot install nginx automatically" >&2
    exit 41
  fi
else
  echo "[step] 检测到已安装 nginx，跳过安装"
fi

if command -v systemctl >/dev/null 2>&1; then
  echo "[step] 执行 systemctl enable/start nginx"
  {command_prefix}systemctl daemon-reload >/dev/null 2>&1 || true
  {command_prefix}systemctl enable nginx >/dev/null 2>&1 || true
  {command_prefix}systemctl start nginx >/dev/null 2>&1 || true
else
  echo "[step] 当前系统无 systemctl，跳过服务管理"
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx command still not found after deploy" >&2
  exit 42
fi

echo "[step] nginx 部署脚本执行完成"
"#,
        command_prefix = command_prefix,
    )
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

fn parse_deploy_output_installed_before(raw: &str) -> bool {
    for line in raw.lines() {
        if let Some(value) = line.strip_prefix("__CASTOR_INSTALLED_BEFORE=") {
            return value.trim() == "1";
        }
    }
    false
}

fn push_nginx_deploy_log(
    app: &AppHandle,
    deploy_id: &str,
    service_id: &str,
    line: impl Into<String>,
) {
    let line = line.into();
    let normalized = line.trim();
    if normalized.is_empty() {
        return;
    }
    let _ = app.emit(
        NGINX_DEPLOY_LOG_EVENT,
        NginxDeployLogPayload {
            deploy_id: deploy_id.to_string(),
            service_id: service_id.to_string(),
            line: normalized.to_string(),
            timestamp: now_unix(),
        },
    );
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

fn run_remote_script_streaming_stdout<F>(
    session: &mut Session,
    script: &str,
    mut on_line: F,
) -> Result<(String, i32), String>
where
    F: FnMut(String),
{
    let mut channel = session
        .channel_session()
        .map_err(|err| format!("failed to open channel: {err}"))?;
    channel
        .exec("bash -s 2>&1")
        .map_err(|err| format!("failed to execute remote shell: {err}"))?;

    channel
        .write_all(script.as_bytes())
        .map_err(|err| format!("failed to write remote script: {err}"))?;
    channel
        .send_eof()
        .map_err(|err| format!("failed to send script eof: {err}"))?;

    let mut output = String::new();
    let mut pending = String::new();
    let mut buffer = [0u8; 4096];

    loop {
        let read_size = channel
            .read(&mut buffer)
            .map_err(|err| format!("failed reading remote stdout: {err}"))?;
        if read_size == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buffer[..read_size]).to_string();
        output.push_str(&chunk);
        pending.push_str(&chunk);

        while let Some(newline_index) = pending.find('\n') {
            let line = pending[..newline_index].trim_end_matches('\r').to_string();
            on_line(line);
            pending.drain(..=newline_index);
        }
    }

    let tail = pending.trim_end_matches('\r').trim().to_string();
    if !tail.is_empty() {
        on_line(tail);
    }

    channel
        .wait_close()
        .map_err(|err| format!("failed waiting remote command close: {err}"))?;
    let exit_status = channel
        .exit_status()
        .map_err(|err| format!("failed to read remote exit status: {err}"))?;

    Ok((output, exit_status))
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
