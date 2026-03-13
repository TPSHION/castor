use std::collections::{hash_map::DefaultHasher, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE};
use base64::Engine;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ssh2::Session;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::profiles::{list_connection_profiles, ConnectionProfile};
use crate::ssh::{authenticate_session, AuthConfig};

const DEFAULT_PROXY_MIXED_PORT: u16 = 7890;
const PROXY_APPLY_LOG_EVENT: &str = "proxy-apply-log";
const MIHOMO_APPLY_LOG_EVENT: &str = "mihomo-apply-log";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProxyApplyMode {
    Application,
    TunGlobal,
}

impl ProxyApplyMode {
    fn from_raw(value: Option<&str>) -> Self {
        match value.map(str::trim).unwrap_or_default() {
            "tun_global" => Self::TunGlobal,
            _ => Self::Application,
        }
    }

    fn as_raw(self) -> &'static str {
        match self {
            Self::Application => "application",
            Self::TunGlobal => "tun_global",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProxyNode {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub server: String,
    pub port: u16,
    pub method: String,
    pub password: String,
    pub plugin: Option<String>,
    pub supported: bool,
    pub unsupported_reason: Option<String>,
    pub raw_uri: String,
    pub latency_ms: Option<u64>,
    pub reachability_status: Option<String>,
    pub reachability_error: Option<String>,
    pub tested_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerProxyConfig {
    pub id: String,
    pub profile_id: String,
    pub subscription_url: String,
    pub nodes: Vec<ProxyNode>,
    pub active_node_id: Option<String>,
    pub local_http_proxy: Option<String>,
    pub local_socks_proxy: Option<String>,
    pub status: String,
    pub last_error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct ListServerProxyConfigsRequest {
    pub profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SyncServerProxySubscriptionRequest {
    pub profile_id: Option<String>,
    pub subscription_url: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteServerProxyConfigRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct ApplyServerProxyNodeRequest {
    pub id: String,
    pub node_id: String,
    pub apply_id: Option<String>,
    pub profile_id: Option<String>,
    pub use_sudo: Option<bool>,
    pub local_mixed_port: Option<u16>,
    pub apply_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ApplyMihomoProxyNodeRequest {
    pub id: String,
    pub node_id: String,
    pub apply_id: Option<String>,
    pub profile_id: Option<String>,
    pub use_sudo: Option<bool>,
    pub local_mixed_port: Option<u16>,
    pub apply_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CancelServerProxyApplyRequest {
    pub apply_id: String,
    pub profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GetServerProxyRuntimeStatusRequest {
    pub profile_id: String,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct GetServerProxyRuntimeConfigRequest {
    pub profile_id: String,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct GetMihomoRuntimeStatusRequest {
    pub profile_id: String,
    pub use_sudo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct TestServerProxyConnectivityRequest {
    pub id: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ServerProxyApplyResult {
    pub config: ServerProxyConfig,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct MihomoProxyApplyResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub message: String,
    pub service_name: String,
    pub config_path: String,
    pub apply_mode: String,
    pub local_http_proxy: Option<String>,
    pub local_socks_proxy: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ServerProxyCancelResult {
    pub apply_id: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProxyApplyLogPayload {
    pub apply_id: String,
    pub level: String,
    pub line: String,
    pub timestamp: u64,
}

#[derive(Debug, Serialize)]
pub struct ServerProxyRuntimeStatusResult {
    pub profile_id: String,
    pub service_name: String,
    pub installed: bool,
    pub active: bool,
    pub enabled: bool,
    pub config_exists: bool,
    pub checked_at: u64,
    pub message: String,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Serialize)]
pub struct MihomoRuntimeStatusResult {
    pub profile_id: String,
    pub service_name: String,
    pub config_path: String,
    pub installed: bool,
    pub active: bool,
    pub enabled: bool,
    pub config_exists: bool,
    pub apply_mode: Option<String>,
    pub mode: Option<String>,
    pub proxy_name: Option<String>,
    pub proxy_type: Option<String>,
    pub proxy_server: Option<String>,
    pub proxy_port: Option<u16>,
    pub proxy_cipher: Option<String>,
    pub checked_at: u64,
    pub message: String,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Serialize)]
pub struct ServerProxyRuntimeConfigResult {
    pub profile_id: String,
    pub service_name: String,
    pub config_path: String,
    pub installed: bool,
    pub active: bool,
    pub enabled: bool,
    pub config_exists: bool,
    pub checked_at: u64,
    pub message: String,
    pub raw_config: Option<String>,
    pub parse_error: Option<String>,
    pub summary: Option<ServerProxyRuntimeConfigSummary>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Serialize)]
pub struct ServerProxyRuntimeConfigSummary {
    pub inbound_count: usize,
    pub outbound_count: usize,
    pub route_final: Option<String>,
    pub route_rule_count: usize,
    pub dns_server_count: usize,
    pub inbounds: Vec<ServerProxyRuntimeInboundSummary>,
    pub outbounds: Vec<ServerProxyRuntimeOutboundSummary>,
}

#[derive(Debug, Serialize)]
pub struct ServerProxyRuntimeInboundSummary {
    pub tag: Option<String>,
    pub r#type: String,
    pub listen: Option<String>,
    pub listen_port: Option<u16>,
}

#[derive(Debug, Serialize)]
pub struct ServerProxyRuntimeOutboundSummary {
    pub tag: Option<String>,
    pub r#type: String,
    pub server: Option<String>,
    pub server_port: Option<u16>,
    pub method: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ServerProxyConnectivityResult {
    pub config: ServerProxyConfig,
    pub tested: usize,
    pub reachable: usize,
    pub failed: usize,
    pub timeout_ms: u64,
    pub message: String,
}

pub fn list_server_proxy_configs(
    app: &AppHandle,
    request: ListServerProxyConfigsRequest,
) -> Result<Vec<ServerProxyConfig>, String> {
    let mut configs = load_server_proxy_configs(app)?;
    if let Some(profile_id) = request.profile_id.as_deref().map(str::trim) {
        if profile_id.is_empty() {
            return Err("profile_id is empty".to_string());
        }
        configs.retain(|item| item.profile_id == profile_id);
    }
    configs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(configs)
}

pub fn sync_server_proxy_subscription(
    app: &AppHandle,
    request: SyncServerProxySubscriptionRequest,
) -> Result<ServerProxyConfig, String> {
    let profile_id = request
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let subscription_url = request.subscription_url.trim();
    if subscription_url.is_empty() {
        return Err("subscription_url is required".to_string());
    }
    if let Some(profile_id) = profile_id.as_deref() {
        ensure_profile_exists(app, profile_id)?;
    }

    let response_body = fetch_subscription(subscription_url)?;
    let parsed_nodes = parse_subscription_nodes(&response_body)?;
    let nodes = test_nodes_connectivity(parsed_nodes, default_connectivity_timeout_ms());
    if nodes.is_empty() {
        return Err("no proxy nodes found in subscription".to_string());
    }

    let _lock = server_proxy_store_lock()
        .lock()
        .map_err(|_| "proxy store lock poisoned".to_string())?;
    let mut configs = load_server_proxy_configs(app)?;
    let now = now_unix();
    let next_config = if let Some(existing) = configs
        .iter_mut()
        .find(|item| item.subscription_url == subscription_url)
    {
        if let Some(profile_id) = profile_id.as_deref() {
            existing.profile_id = profile_id.to_string();
        }
        existing.subscription_url = subscription_url.to_string();
        existing.nodes = nodes;
        existing.active_node_id = None;
        existing.local_http_proxy = None;
        existing.local_socks_proxy = None;
        existing.status = "pending".to_string();
        existing.last_error = None;
        existing.updated_at = now;
        existing.clone()
    } else {
        let config = ServerProxyConfig {
            id: Uuid::new_v4().to_string(),
            profile_id: profile_id.unwrap_or_default(),
            subscription_url: subscription_url.to_string(),
            nodes,
            active_node_id: None,
            local_http_proxy: None,
            local_socks_proxy: None,
            status: "pending".to_string(),
            last_error: None,
            created_at: now,
            updated_at: now,
        };
        configs.push(config.clone());
        config
    };

    save_server_proxy_configs(app, &configs)?;
    Ok(next_config)
}

pub fn delete_server_proxy_config(
    app: &AppHandle,
    request: DeleteServerProxyConfigRequest,
) -> Result<(), String> {
    let id = request.id.trim();
    if id.is_empty() {
        return Err("id is required".to_string());
    }

    let _lock = server_proxy_store_lock()
        .lock()
        .map_err(|_| "proxy store lock poisoned".to_string())?;
    let mut configs = load_server_proxy_configs(app)?;
    let before = configs.len();
    configs.retain(|item| item.id != id);
    if configs.len() == before {
        return Err(format!("server proxy config {} not found", id));
    }
    save_server_proxy_configs(app, &configs)
}

pub fn apply_server_proxy_node(
    app: &AppHandle,
    request: ApplyServerProxyNodeRequest,
) -> Result<ServerProxyApplyResult, String> {
    let id = request.id.trim();
    let node_id = request.node_id.trim();
    if id.is_empty() || node_id.is_empty() {
        return Err("id and node_id are required".to_string());
    }
    let apply_id = request
        .apply_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut config = find_server_proxy_config_by_id(app, id)?;
    let requested_profile_id = request
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let target_profile_id = requested_profile_id
        .or_else(|| {
            let saved = config.profile_id.trim();
            if saved.is_empty() {
                None
            } else {
                Some(saved.to_string())
            }
        })
        .ok_or_else(|| "profile_id is required when applying proxy node".to_string())?;
    config.profile_id = target_profile_id.clone();
    let _running_guard = RunningProxyApplyGuard::new(apply_id.clone(), target_profile_id.clone())?;
    let node = config
        .nodes
        .iter()
        .find(|item| item.id == node_id)
        .cloned()
        .ok_or_else(|| format!("proxy node {} not found", node_id))?;

    if !node.supported {
        push_proxy_apply_log(
            app,
            &apply_id,
            "error",
            "当前节点暂不支持自动部署，操作已终止。",
        );
        config.status = "failed".to_string();
        // 部署/应用阶段的错误不写入订阅配置的 last_error，避免污染订阅错误展示。
        config.updated_at = now_unix();
        update_server_proxy_config(app, &config)?;
        return Ok(ServerProxyApplyResult {
            config,
            success: false,
            stdout: String::new(),
            stderr: node
                .unsupported_reason
                .unwrap_or_else(|| "proxy node is unsupported".to_string()),
            exit_status: -1,
            message: "当前节点暂不支持自动部署。".to_string(),
        });
    }

    let profile = find_profile(app, &target_profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;
    let use_sudo = request.use_sudo.unwrap_or(true);
    let apply_mode = ProxyApplyMode::from_raw(request.apply_mode.as_deref());
    let local_mixed_port = request
        .local_mixed_port
        .unwrap_or(DEFAULT_PROXY_MIXED_PORT)
        .clamp(1024, 65535);
    let preuploaded_archive = prepare_remote_sing_box_archive(app, &mut session, &apply_id)
        .map_err(|err| format!("failed to prepare local sing-box package: {err}"))?;
    if let Some(path) = preuploaded_archive.as_deref() {
        push_proxy_apply_log(
            app,
            &apply_id,
            "info",
            format!("已准备本地安装包，远程路径：{path}"),
        );
    } else {
        push_proxy_apply_log(
            app,
            &apply_id,
            "warn",
            "未匹配到本地安装包，将回退在线下载 sing-box。",
        );
    }
    let script = build_apply_proxy_script(
        &node,
        use_sudo,
        local_mixed_port,
        apply_mode,
        &apply_id,
        preuploaded_archive.as_deref(),
    )?;
    push_proxy_apply_log(
        app,
        &apply_id,
        "info",
        format!(
            "开始应用代理节点：{} ({}:{})",
            node.name, node.server, node.port
        ),
    );
    let mut recovered_after_transport_read = false;
    let (stdout, exit_status) = match run_remote_script_streaming_stdout(
        &mut session,
        &script,
        |line| {
            let normalized = line.trim();
            if normalized.is_empty() {
                return;
            }
            if normalized == "__CASTOR_PROXY_CANCELED=1" {
                push_proxy_apply_log(app, &apply_id, "warn", "收到取消指令，正在终止代理部署。");
                return;
            }
            let level = if normalized.contains("failed")
                || normalized.contains("error")
                || normalized.contains("ERROR")
            {
                "error"
            } else {
                "stdout"
            };
            push_proxy_apply_log(app, &apply_id, level, normalized.to_string());
        },
    ) {
        Ok(result) => result,
        Err(err) if apply_mode == ProxyApplyMode::TunGlobal && is_transport_read_error(&err) => {
            push_proxy_apply_log(
                app,
                &apply_id,
                "warn",
                "SSH 连接在 tun 切换后中断，正在执行自动恢复校验。",
            );
            recover_proxy_apply_after_transport_disconnect(&profile, use_sudo, &node).map_err(
                |recovery_err| {
                    format!("failed reading remote stdout: {err}; recovery check failed: {recovery_err}")
                },
            )?;
            recovered_after_transport_read = true;
            push_proxy_apply_log(
                app,
                &apply_id,
                "warn",
                "自动恢复校验成功，已确认远程代理服务生效。",
            );
            ("__CASTOR_PROXY_TRANSPORT_RECOVERED=1\n".to_string(), 0)
        }
        Err(err) => return Err(err),
    };
    let stderr = String::new();
    let canceled = exit_status == 130
        || stdout
            .lines()
            .any(|line| line.trim() == "__CASTOR_PROXY_CANCELED=1");

    if canceled {
        config.status = "pending".to_string();
        config.updated_at = now_unix();
        update_server_proxy_config(app, &config)?;
        push_proxy_apply_log(app, &apply_id, "done", "代理部署已取消。");
        return Ok(ServerProxyApplyResult {
            config,
            success: false,
            stdout,
            stderr,
            exit_status,
            message: "已取消代理部署。".to_string(),
        });
    }

    if exit_status != 0 {
        config.status = "failed".to_string();
        // 部署失败仅通过实时日志和本次执行结果返回，不写入订阅 last_error。
        config.updated_at = now_unix();
        update_server_proxy_config(app, &config)?;

        return Ok(ServerProxyApplyResult {
            config,
            success: false,
            stdout,
            stderr,
            exit_status,
            message: "代理节点应用失败，请检查输出日志。".to_string(),
        });
    }

    config.active_node_id = Some(node.id.clone());
    config.local_http_proxy = if apply_mode == ProxyApplyMode::Application {
        Some(format!("http://127.0.0.1:{local_mixed_port}"))
    } else {
        None
    };
    config.local_socks_proxy = if apply_mode == ProxyApplyMode::Application {
        Some(format!("socks5://127.0.0.1:{local_mixed_port}"))
    } else {
        None
    };
    config.status = "active".to_string();
    config.last_error = None;
    config.updated_at = now_unix();
    update_server_proxy_config(app, &config)?;
    push_proxy_apply_log(app, &apply_id, "done", "代理节点应用成功。");

    Ok(ServerProxyApplyResult {
        config,
        success: true,
        stdout,
        stderr,
        exit_status,
        message: match (apply_mode, recovered_after_transport_read) {
            (ProxyApplyMode::Application, false) => format!(
                "代理节点已应用（应用层代理版），远程本地代理地址：http://127.0.0.1:{local_mixed_port} / socks5://127.0.0.1:{local_mixed_port}"
            ),
            (ProxyApplyMode::Application, true) => format!(
                "代理节点已应用（应用层代理版），SSH 会话中断后自动恢复校验通过。远程本地代理地址：http://127.0.0.1:{local_mixed_port} / socks5://127.0.0.1:{local_mixed_port}"
            ),
            (ProxyApplyMode::TunGlobal, false) => {
                "代理节点已应用（tun 全局版），系统流量将通过 tun 接管转发。".to_string()
            }
            (ProxyApplyMode::TunGlobal, true) => {
                "代理节点已应用（tun 全局版），SSH 会话中断后自动恢复校验通过。".to_string()
            }
        },
    })
}

pub fn apply_mihomo_proxy_node(
    app: &AppHandle,
    request: ApplyMihomoProxyNodeRequest,
) -> Result<MihomoProxyApplyResult, String> {
    let id = request.id.trim();
    if id.is_empty() {
        return Err("id is required".to_string());
    }
    let node_id = request.node_id.trim();
    if node_id.is_empty() {
        return Err("node_id is required".to_string());
    }

    let apply_id = request
        .apply_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let config = find_server_proxy_config_by_id(app, id)?;
    let requested_profile_id = request
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let target_profile_id = requested_profile_id
        .or_else(|| {
            let saved = config.profile_id.trim();
            if saved.is_empty() {
                None
            } else {
                Some(saved.to_string())
            }
        })
        .ok_or_else(|| "profile_id is required when applying mihomo node".to_string())?;

    let node = config
        .nodes
        .iter()
        .find(|item| item.id == node_id)
        .cloned()
        .ok_or_else(|| format!("proxy node {} not found", node_id))?;
    if !node.supported {
        return Ok(MihomoProxyApplyResult {
            success: false,
            stdout: String::new(),
            stderr: node
                .unsupported_reason
                .unwrap_or_else(|| "proxy node is unsupported".to_string()),
            exit_status: -1,
            message: "当前节点暂不支持 Mihomo 自动部署。".to_string(),
            service_name: "castor-mihomo.service".to_string(),
            config_path: "/etc/castor/mihomo/config.yaml".to_string(),
            apply_mode: ProxyApplyMode::from_raw(request.apply_mode.as_deref())
                .as_raw()
                .to_string(),
            local_http_proxy: None,
            local_socks_proxy: None,
        });
    }

    let profile = find_profile(app, &target_profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;
    let use_sudo = request.use_sudo.unwrap_or(true);
    let apply_mode = ProxyApplyMode::from_raw(request.apply_mode.as_deref());
    let local_mixed_port = request
        .local_mixed_port
        .unwrap_or(DEFAULT_PROXY_MIXED_PORT)
        .clamp(1024, 65535);
    let preuploaded_package = prepare_remote_mihomo_package(app, &mut session, &apply_id)?;
    if let Some(path) = preuploaded_package.as_deref() {
        push_mihomo_apply_log(
            app,
            &apply_id,
            "info",
            format!("已准备本地 Mihomo 安装包，远程路径：{path}"),
        );
    } else {
        push_mihomo_apply_log(
            app,
            &apply_id,
            "warn",
            "未匹配到本地 Mihomo 安装包，将尝试在线下载安装。",
        );
    }

    let script = build_apply_mihomo_script(
        &node,
        use_sudo,
        local_mixed_port,
        apply_mode,
        &apply_id,
        preuploaded_package.as_deref(),
    )?;
    push_mihomo_apply_log(
        app,
        &apply_id,
        "info",
        format!(
            "开始应用 Mihomo 代理节点：{} ({}:{})",
            node.name, node.server, node.port
        ),
    );

    let mut recovered_after_transport_read = false;
    let (stdout, exit_status) = match run_remote_script_streaming_stdout(
        &mut session,
        &script,
        |line| {
            let normalized = line.trim();
            if normalized.is_empty() {
                return;
            }
            let level = if normalized.contains("failed")
                || normalized.contains("error")
                || normalized.contains("ERROR")
            {
                "error"
            } else {
                "stdout"
            };
            push_mihomo_apply_log(app, &apply_id, level, normalized.to_string());
        },
    ) {
        Ok(result) => result,
        Err(err) if apply_mode == ProxyApplyMode::TunGlobal && is_transport_read_error(&err) => {
            push_mihomo_apply_log(
                app,
                &apply_id,
                "warn",
                "SSH 连接在 TUN 切换后中断，正在执行自动恢复校验。",
            );
            recover_mihomo_apply_after_transport_disconnect(&profile, use_sudo).map_err(
                |recovery_err| {
                    format!("failed reading remote stdout: {err}; recovery check failed: {recovery_err}")
                },
            )?;
            recovered_after_transport_read = true;
            ("__CASTOR_MIHOMO_TRANSPORT_RECOVERED=1\n".to_string(), 0)
        }
        Err(err) => return Err(err),
    };
    let stderr = String::new();

    if exit_status != 0 {
        return Ok(MihomoProxyApplyResult {
            success: false,
            stdout,
            stderr,
            exit_status,
            message: "Mihomo 代理部署失败，请检查日志。".to_string(),
            service_name: "castor-mihomo.service".to_string(),
            config_path: "/etc/castor/mihomo/config.yaml".to_string(),
            apply_mode: apply_mode.as_raw().to_string(),
            local_http_proxy: None,
            local_socks_proxy: None,
        });
    }

    push_mihomo_apply_log(app, &apply_id, "done", "Mihomo 代理部署完成。");
    Ok(MihomoProxyApplyResult {
        success: true,
        stdout,
        stderr,
        exit_status,
        message: match (apply_mode, recovered_after_transport_read) {
            (ProxyApplyMode::Application, false) => format!(
                "Mihomo 部署成功（应用层代理版），远程本地代理地址：http://127.0.0.1:{local_mixed_port} / socks5://127.0.0.1:{local_mixed_port}"
            ),
            (ProxyApplyMode::Application, true) => format!(
                "Mihomo 部署成功（应用层代理版），SSH 中断后自动恢复校验通过。远程本地代理地址：http://127.0.0.1:{local_mixed_port} / socks5://127.0.0.1:{local_mixed_port}"
            ),
            (ProxyApplyMode::TunGlobal, false) => {
                "Mihomo 部署成功（tun 全局版），系统流量将由 TUN 接管。".to_string()
            }
            (ProxyApplyMode::TunGlobal, true) => {
                "Mihomo 部署成功（tun 全局版），SSH 中断后自动恢复校验通过。".to_string()
            }
        },
        service_name: "castor-mihomo.service".to_string(),
        config_path: "/etc/castor/mihomo/config.yaml".to_string(),
        apply_mode: apply_mode.as_raw().to_string(),
        local_http_proxy: if apply_mode == ProxyApplyMode::Application {
            Some(format!("http://127.0.0.1:{local_mixed_port}"))
        } else {
            None
        },
        local_socks_proxy: if apply_mode == ProxyApplyMode::Application {
            Some(format!("socks5://127.0.0.1:{local_mixed_port}"))
        } else {
            None
        },
    })
}

pub fn cancel_server_proxy_apply(
    app: &AppHandle,
    request: CancelServerProxyApplyRequest,
) -> Result<ServerProxyCancelResult, String> {
    let apply_id = request.apply_id.trim();
    if apply_id.is_empty() {
        return Err("apply_id is required".to_string());
    }

    let profile_id = request
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| resolve_running_proxy_apply_profile_id(apply_id))
        .ok_or_else(|| "profile_id is required to cancel apply".to_string())?;

    let profile = find_profile(app, &profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;
    let script = build_cancel_apply_script(apply_id);
    let (stdout, stderr, exit_status) = run_remote_script(&mut session, &script)?;
    let success = exit_status == 0;
    Ok(ServerProxyCancelResult {
        apply_id: apply_id.to_string(),
        success,
        stdout,
        stderr,
        exit_status,
        message: if success {
            "取消请求已发送，等待当前步骤安全终止。".to_string()
        } else {
            "发送取消请求失败，请检查日志。".to_string()
        },
    })
}

pub fn test_server_proxy_connectivity(
    app: &AppHandle,
    request: TestServerProxyConnectivityRequest,
) -> Result<ServerProxyConnectivityResult, String> {
    let id = request.id.trim();
    if id.is_empty() {
        return Err("id is required".to_string());
    }

    let timeout_ms = clamp_connectivity_timeout_ms(request.timeout_ms);
    let mut config = find_server_proxy_config_by_id(app, id)?;
    config.nodes = test_nodes_connectivity(config.nodes.clone(), timeout_ms);
    config.updated_at = now_unix();

    let tested = config.nodes.len();
    let reachable = config
        .nodes
        .iter()
        .filter(|item| item.reachability_status.as_deref() == Some("ok"))
        .count();
    let failed = tested.saturating_sub(reachable);
    if config
        .last_error
        .as_deref()
        .map(is_connectivity_summary_message)
        .unwrap_or(false)
    {
        config.last_error = None;
    }
    update_server_proxy_config(app, &config)?;

    Ok(ServerProxyConnectivityResult {
        config,
        tested,
        reachable,
        failed,
        timeout_ms,
        message: format!(
            "连通性测试完成：成功 {} / 失败 {}（超时 {}ms）",
            reachable, failed, timeout_ms
        ),
    })
}

pub fn get_server_proxy_runtime_status(
    app: &AppHandle,
    request: GetServerProxyRuntimeStatusRequest,
) -> Result<ServerProxyRuntimeStatusResult, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }

    let profile = find_profile(app, profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;
    let use_sudo = request.use_sudo.unwrap_or(true);
    let script = build_runtime_status_script(use_sudo);
    let (stdout, stderr, exit_status) = run_remote_script(&mut session, &script)?;
    let parsed = parse_runtime_status_markers(&stdout);

    let installed = parsed.installed.unwrap_or(false);
    let active = parsed.active.unwrap_or(false);
    let enabled = parsed.enabled.unwrap_or(false);
    let config_exists = parsed.config_exists.unwrap_or(false);
    let message = if exit_status != 0 {
        "远程代理状态查询失败，请检查日志。".to_string()
    } else if active && config_exists {
        "远程服务器已应用代理配置。".to_string()
    } else if installed && config_exists {
        "已检测到代理配置文件，但服务未运行。".to_string()
    } else if installed {
        "已安装代理组件，但未检测到可用配置。".to_string()
    } else {
        "远程服务器尚未应用代理配置。".to_string()
    };

    Ok(ServerProxyRuntimeStatusResult {
        profile_id: profile_id.to_string(),
        service_name: "castor-proxy.service".to_string(),
        installed,
        active,
        enabled,
        config_exists,
        checked_at: now_unix(),
        message,
        stdout,
        stderr,
    })
}

pub fn get_mihomo_runtime_status(
    app: &AppHandle,
    request: GetMihomoRuntimeStatusRequest,
) -> Result<MihomoRuntimeStatusResult, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }

    let profile = find_profile(app, profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;
    let use_sudo = request.use_sudo.unwrap_or(true);
    let script = build_mihomo_runtime_status_script(use_sudo);
    let (stdout, stderr, exit_status) = run_remote_script(&mut session, &script)?;
    let parsed = parse_mihomo_runtime_status_markers(&stdout);

    let installed = parsed.installed.unwrap_or(false);
    let active = parsed.active.unwrap_or(false);
    let enabled = parsed.enabled.unwrap_or(false);
    let config_exists = parsed.config_exists.unwrap_or(false);
    let apply_mode = parsed.apply_mode;
    let mode = parsed.mode;
    let proxy_name = parsed.proxy_name;
    let proxy_type = parsed.proxy_type;
    let proxy_server = parsed.proxy_server;
    let proxy_port = parsed.proxy_port;
    let proxy_cipher = parsed.proxy_cipher;
    let message = if exit_status != 0 {
        "Mihomo 运行状态查询失败，请检查日志。".to_string()
    } else if active && config_exists {
        "远程服务器已应用 Mihomo 代理配置。".to_string()
    } else if installed && config_exists {
        "已检测到 Mihomo 配置文件，但服务未运行。".to_string()
    } else if installed {
        "已安装 Mihomo，但未检测到可用配置。".to_string()
    } else {
        "远程服务器尚未部署 Mihomo。".to_string()
    };

    Ok(MihomoRuntimeStatusResult {
        profile_id: profile_id.to_string(),
        service_name: "castor-mihomo.service".to_string(),
        config_path: "/etc/castor/mihomo/config.yaml".to_string(),
        installed,
        active,
        enabled,
        config_exists,
        apply_mode,
        mode,
        proxy_name,
        proxy_type,
        proxy_server,
        proxy_port,
        proxy_cipher,
        checked_at: now_unix(),
        message,
        stdout,
        stderr,
    })
}

pub fn get_server_proxy_runtime_config(
    app: &AppHandle,
    request: GetServerProxyRuntimeConfigRequest,
) -> Result<ServerProxyRuntimeConfigResult, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }

    let profile = find_profile(app, profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;
    let use_sudo = request.use_sudo.unwrap_or(true);
    let script = build_runtime_config_script(use_sudo);
    let (stdout, stderr, exit_status) = run_remote_script(&mut session, &script)?;
    let parsed = parse_runtime_config_markers(&stdout);

    let installed = parsed.installed.unwrap_or(false);
    let active = parsed.active.unwrap_or(false);
    let enabled = parsed.enabled.unwrap_or(false);
    let config_exists = parsed.config_exists.unwrap_or(false);
    let config_path = parsed
        .config_path
        .unwrap_or_else(|| "/etc/castor/proxy/config.json".to_string());

    let mut parse_error = None;
    let summary = match parsed.raw_config.as_deref() {
        Some(raw_config) => match build_runtime_config_summary(raw_config) {
            Ok(summary) => Some(summary),
            Err(err) => {
                parse_error = Some(err);
                None
            }
        },
        None => None,
    };
    if let Some(read_error) = parsed.read_error {
        let detail = format!("读取远程配置失败，退出码：{read_error}");
        parse_error = Some(match parse_error {
            Some(existing) => format!("{existing}；{detail}"),
            None => detail,
        });
    }

    let message = if exit_status != 0 {
        "远程代理配置查询失败，请检查日志。".to_string()
    } else if !config_exists {
        "远程服务器尚未生成 sing-box 配置文件。".to_string()
    } else if parse_error.is_some() {
        "已读取远程配置文件，但解析失败，请检查原始配置。".to_string()
    } else {
        "已成功读取远程 sing-box 配置。".to_string()
    };

    Ok(ServerProxyRuntimeConfigResult {
        profile_id: profile_id.to_string(),
        service_name: "castor-proxy.service".to_string(),
        config_path,
        installed,
        active,
        enabled,
        config_exists,
        checked_at: now_unix(),
        message,
        raw_config: parsed.raw_config,
        parse_error,
        summary,
        stdout: parsed.stdout_without_config,
        stderr,
    })
}

fn fetch_subscription(url: &str) -> Result<String, String> {
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(12))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|err| format!("failed to initialize subscription client: {err}"))?;
    let response = client
        .get(url)
        .header("user-agent", "castor/1.2.0")
        .send()
        .map_err(|err| format!("failed to fetch subscription: {err}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "failed to fetch subscription: HTTP {}",
            response.status()
        ));
    }
    response
        .text()
        .map_err(|err| format!("failed to read subscription body: {err}"))
}

fn parse_subscription_nodes(body: &str) -> Result<Vec<ProxyNode>, String> {
    let raw = body.trim();
    if raw.is_empty() {
        return Err("subscription content is empty".to_string());
    }

    let mut candidates = vec![raw.to_string()];
    if let Some(decoded) = decode_subscription_payload(raw) {
        candidates.insert(0, decoded);
    }

    for candidate in candidates {
        let mut nodes = Vec::new();
        for line in candidate.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("ss://") {
                if let Ok(node) = parse_ss_node(trimmed) {
                    nodes.push(node);
                }
                continue;
            }
            if trimmed.starts_with("vmess://") {
                if let Ok(node) = parse_vmess_node(trimmed) {
                    nodes.push(node);
                }
                continue;
            }
            if let Some(node) = parse_unsupported_node(trimmed) {
                nodes.push(node);
            }
        }
        if !nodes.is_empty() {
            return Ok(nodes);
        }
    }

    Err("unsupported subscription format (no recognizable proxy nodes found)".to_string())
}

fn decode_subscription_payload(raw: &str) -> Option<String> {
    let compact: String = raw.chars().filter(|ch| !ch.is_whitespace()).collect();
    if compact.is_empty() {
        return None;
    }
    if !compact.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=' || ch == '-' || ch == '_'
    }) {
        return None;
    }
    decode_base64_flexible(compact.as_bytes()).and_then(|bytes| String::from_utf8(bytes).ok())
}

fn decode_base64_flexible(input: &[u8]) -> Option<Vec<u8>> {
    let try_decode =
        |engine: &base64::engine::GeneralPurpose, value: &[u8]| engine.decode(value).ok();
    if let Some(decoded) = try_decode(&STANDARD, input) {
        return Some(decoded);
    }
    if let Some(decoded) = try_decode(&URL_SAFE, input) {
        return Some(decoded);
    }
    let mut padded = input.to_vec();
    let rem = padded.len() % 4;
    if rem > 0 {
        for _ in 0..(4 - rem) {
            padded.push(b'=');
        }
    }
    try_decode(&STANDARD, &padded).or_else(|| try_decode(&URL_SAFE, &padded))
}

fn parse_ss_node(raw_uri: &str) -> Result<ProxyNode, String> {
    let uri_without_scheme = raw_uri
        .strip_prefix("ss://")
        .ok_or_else(|| "invalid ss uri".to_string())?;
    let (no_fragment, fragment) = split_once(uri_without_scheme, '#');
    let (no_query, query) = split_once(no_fragment, '?');
    let plugin = extract_query_param(query, "plugin");

    let (method, password, host, port) = if no_query.contains('@') {
        let at_index = no_query
            .rfind('@')
            .ok_or_else(|| "invalid ss uri".to_string())?;
        let credential_part = &no_query[..at_index];
        let host_part = &no_query[at_index + 1..];
        let credential = decode_base64_flexible(credential_part.as_bytes())
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .unwrap_or_else(|| percent_decode(credential_part));
        let (method, password) = split_method_password(&credential)?;
        let (host, port) = split_host_port(host_part)?;
        (method, password, host, port)
    } else {
        let decoded = decode_base64_flexible(no_query.as_bytes())
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or_else(|| "invalid ss base64 payload".to_string())?;
        let (credential, host_part) = decoded
            .rsplit_once('@')
            .ok_or_else(|| "invalid ss payload: missing host".to_string())?;
        let (method, password) = split_method_password(credential)?;
        let (host, port) = split_host_port(host_part)?;
        (method, password, host, port)
    };

    let suggested_name = fragment
        .map(percent_decode)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| format!("ss-{host}:{port}"));
    let supported = plugin.as_deref().is_none();
    let unsupported_reason = if supported {
        None
    } else {
        Some("当前节点包含 plugin 参数，暂不支持自动部署。".to_string())
    };

    Ok(ProxyNode {
        id: proxy_node_id(raw_uri),
        name: suggested_name,
        protocol: "ss".to_string(),
        server: host,
        port,
        method,
        password,
        plugin,
        supported,
        unsupported_reason,
        raw_uri: raw_uri.to_string(),
        latency_ms: None,
        reachability_status: None,
        reachability_error: None,
        tested_at: None,
    })
}

fn parse_vmess_node(raw_uri: &str) -> Result<ProxyNode, String> {
    let uri_without_scheme = raw_uri
        .strip_prefix("vmess://")
        .ok_or_else(|| "invalid vmess uri".to_string())?;
    let (payload, fragment) = split_once(uri_without_scheme, '#');
    let decoded = decode_base64_flexible(payload.as_bytes())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .ok_or_else(|| "invalid vmess payload".to_string())?;
    let parsed: Value = serde_json::from_str(&decoded)
        .map_err(|err| format!("invalid vmess payload json: {err}"))?;

    let server = parsed
        .get("add")
        .or_else(|| parsed.get("server"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let port = match parsed.get("port") {
        Some(Value::Number(number)) => number
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .unwrap_or(0),
        Some(Value::String(text)) => text.parse::<u16>().unwrap_or(0),
        _ => 0,
    };

    let suggested_name = fragment
        .map(percent_decode)
        .filter(|name| !name.trim().is_empty())
        .or_else(|| {
            parsed
                .get("ps")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| format!("vmess-{server}:{port}"));

    Ok(ProxyNode {
        id: proxy_node_id(raw_uri),
        name: suggested_name,
        protocol: "vmess".to_string(),
        server,
        port,
        method: "-".to_string(),
        password: "-".to_string(),
        plugin: None,
        supported: false,
        unsupported_reason: Some("当前仅支持 ss 节点自动部署，vmess 节点暂不支持。".to_string()),
        raw_uri: raw_uri.to_string(),
        latency_ms: None,
        reachability_status: None,
        reachability_error: None,
        tested_at: None,
    })
}

fn parse_unsupported_node(raw_uri: &str) -> Option<ProxyNode> {
    let (protocol, _) = raw_uri.split_once("://")?;
    let normalized = protocol.trim().to_ascii_lowercase();
    let known_unsupported = [
        "vless",
        "trojan",
        "ssr",
        "hysteria",
        "hysteria2",
        "tuic",
        "socks5",
        "http",
    ];
    if !known_unsupported.contains(&normalized.as_str()) {
        return None;
    }

    let (server, port) =
        extract_host_port_from_generic_uri(raw_uri).unwrap_or_else(|| ("unknown".to_string(), 0));
    let (_, fragment) = split_once(raw_uri, '#');
    let name = fragment
        .map(percent_decode)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{}-{server}:{port}", normalized));

    Some(ProxyNode {
        id: proxy_node_id(raw_uri),
        name,
        protocol: normalized.clone(),
        server,
        port,
        method: "-".to_string(),
        password: "-".to_string(),
        plugin: None,
        supported: false,
        unsupported_reason: Some(format!(
            "当前仅支持 ss 节点自动部署，{} 节点暂不支持。",
            normalized
        )),
        raw_uri: raw_uri.to_string(),
        latency_ms: None,
        reachability_status: None,
        reachability_error: None,
        tested_at: None,
    })
}

fn test_nodes_connectivity(nodes: Vec<ProxyNode>, timeout_ms: u64) -> Vec<ProxyNode> {
    if nodes.is_empty() {
        return nodes;
    }

    let mut nodes = nodes;
    let parallelism = nodes.len().min(16).max(1);
    for chunk in nodes.chunks_mut(parallelism) {
        std::thread::scope(|scope| {
            for node in chunk {
                scope.spawn(move || {
                    *node = test_single_node_connectivity(node.clone(), timeout_ms);
                });
            }
        });
    }
    nodes
}

fn test_single_node_connectivity(mut node: ProxyNode, timeout_ms: u64) -> ProxyNode {
    node.tested_at = Some(now_unix());
    let host = node.server.trim();
    if host.is_empty() || node.port == 0 {
        node.latency_ms = None;
        node.reachability_status = Some("failed".to_string());
        node.reachability_error = Some("节点地址不完整，无法测试连通性。".to_string());
        return node;
    }

    let timeout = Duration::from_millis(timeout_ms);
    let mut success_samples_us: Vec<u64> = Vec::new();
    let mut last_error: Option<String> = None;
    let address_text = format!("{host}:{}", node.port);
    let socket_addresses = match address_text.to_socket_addrs() {
        Ok(value) => value.collect::<Vec<_>>(),
        Err(err) => {
            node.latency_ms = None;
            node.reachability_status = Some("failed".to_string());
            node.reachability_error = Some(format!("DNS 解析失败: {err}"));
            return node;
        }
    };

    if socket_addresses.is_empty() {
        node.latency_ms = None;
        node.reachability_status = Some("failed".to_string());
        node.reachability_error = Some("未解析到可用地址。".to_string());
        return node;
    }

    const MAX_TEST_ADDRESSES: usize = 2;
    const CONNECTIVITY_SAMPLES: usize = 3;

    for address in socket_addresses.into_iter().take(MAX_TEST_ADDRESSES) {
        match tcp_connect_latency_us(&address, timeout) {
            Ok(sample) => {
                success_samples_us.push(sample);
                for _ in 1..CONNECTIVITY_SAMPLES {
                    if let Ok(extra_sample) = tcp_connect_latency_us(&address, timeout) {
                        success_samples_us.push(extra_sample);
                    }
                }
                break;
            }
            Err(err) => {
                last_error = Some(err);
            }
        }
    }

    if !success_samples_us.is_empty() {
        let latency_ms = normalize_latency_ms(&success_samples_us);
        node.latency_ms = Some(latency_ms);
        node.reachability_status = Some("ok".to_string());
        node.reachability_error = None;
        return node;
    }

    node.latency_ms = None;
    node.reachability_status = Some("failed".to_string());
    node.reachability_error = last_error.or_else(|| Some("连接失败".to_string()));
    node
}

fn tcp_connect_latency_us(
    address: &std::net::SocketAddr,
    timeout: Duration,
) -> Result<u64, String> {
    let started_at = Instant::now();
    let stream = TcpStream::connect_timeout(address, timeout).map_err(|err| err.to_string())?;
    let _ = stream.shutdown(std::net::Shutdown::Both);
    let elapsed_us = started_at.elapsed().as_micros() as u64;
    Ok(elapsed_us.max(1))
}

fn normalize_latency_ms(samples_us: &[u64]) -> u64 {
    let mut values = samples_us.to_vec();
    values.sort_unstable();
    let median_us = if values.len() % 2 == 1 {
        values[values.len() / 2]
    } else {
        let right = values.len() / 2;
        let left = right.saturating_sub(1);
        (values[left] + values[right]) / 2
    };
    ((median_us + 999) / 1_000).max(1)
}

fn extract_host_port_from_generic_uri(raw_uri: &str) -> Option<(String, u16)> {
    let (_, without_scheme) = raw_uri.split_once("://")?;
    let (no_fragment, _) = split_once(without_scheme, '#');
    let (no_query, _) = split_once(no_fragment, '?');
    let host_part = no_query
        .rsplit_once('@')
        .map(|(_, value)| value)
        .unwrap_or(no_query)
        .trim();
    if host_part.is_empty() {
        return None;
    }

    if let Ok((host, port)) = split_host_port(host_part) {
        return Some((host, port));
    }
    if host_part.starts_with('[') {
        if let Some(index) = host_part.find(']') {
            let host = &host_part[1..index];
            return Some((host.to_string(), 0));
        }
    }
    Some((host_part.to_string(), 0))
}

fn split_method_password(raw: &str) -> Result<(String, String), String> {
    let (method, password) = raw
        .split_once(':')
        .ok_or_else(|| "invalid ss credential".to_string())?;
    let method = percent_decode(method.trim());
    let password = percent_decode(password.trim());
    if method.is_empty() || password.is_empty() {
        return Err("invalid ss credential".to_string());
    }
    Ok((method, password))
}

fn split_host_port(raw: &str) -> Result<(String, u16), String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("invalid ss host".to_string());
    }
    if value.starts_with('[') {
        let bracket_end = value
            .find(']')
            .ok_or_else(|| "invalid ipv6 host format".to_string())?;
        let host = &value[1..bracket_end];
        let remainder = value[bracket_end + 1..].trim();
        if !remainder.starts_with(':') {
            return Err("invalid ss host port".to_string());
        }
        let port = remainder[1..]
            .trim()
            .parse::<u16>()
            .map_err(|_| "invalid ss port".to_string())?;
        return Ok((host.to_string(), port));
    }

    let (host, port_text) = value
        .rsplit_once(':')
        .ok_or_else(|| "invalid ss host port".to_string())?;
    let port = port_text
        .trim()
        .parse::<u16>()
        .map_err(|_| "invalid ss port".to_string())?;
    Ok((host.trim().to_string(), port))
}

fn split_once<'a>(source: &'a str, delimiter: char) -> (&'a str, Option<&'a str>) {
    if let Some(index) = source.find(delimiter) {
        (&source[..index], Some(&source[index + 1..]))
    } else {
        (source, None)
    }
}

fn extract_query_param(query: Option<&str>, key: &str) -> Option<String> {
    let query = query?.trim();
    if query.is_empty() {
        return None;
    }
    for pair in query.split('&') {
        let (param_key, param_value) = pair.split_once('=').unwrap_or((pair, ""));
        if param_key == key {
            return Some(percent_decode(param_value));
        }
    }
    None
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = hex_value(bytes[index + 1]);
            let low = hex_value(bytes[index + 2]);
            if let (Some(high), Some(low)) = (high, low) {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }

        if bytes[index] == b'+' {
            decoded.push(b' ');
        } else {
            decoded.push(bytes[index]);
        }
        index += 1;
    }

    match String::from_utf8(decoded) {
        Ok(value) => value,
        Err(err) => String::from_utf8_lossy(&err.into_bytes()).into_owned(),
    }
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn proxy_node_id(source: &str) -> String {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    format!("node-{:x}", hasher.finish())
}

fn prepare_remote_sing_box_archive(
    app: &AppHandle,
    session: &mut Session,
    apply_id: &str,
) -> Result<Option<String>, String> {
    let arch = match detect_remote_arch(session) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let local_package = match find_local_sing_box_package(app, &arch) {
        Some(path) => path,
        None => return Ok(None),
    };
    let short_apply_id = short_id(&sanitize_file_id(apply_id), 12);
    let remote_path = format!("/tmp/castor-sing-box-{arch}-{short_apply_id}.tar.gz");
    upload_file_to_remote(session, &local_package, &remote_path)?;
    Ok(Some(remote_path))
}

fn detect_remote_arch(session: &mut Session) -> Result<String, String> {
    let (stdout, stderr, exit_status) = run_remote_script(session, "uname -m\n")?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to detect remote arch (exit {exit_status}): {detail}"
        ));
    }

    let raw_arch = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    match raw_arch {
        "x86_64" | "amd64" => Ok("amd64".to_string()),
        "aarch64" | "arm64" => Ok("arm64".to_string()),
        value => Err(format!("unsupported remote architecture: {value}")),
    }
}

fn find_local_sing_box_package(app: &AppHandle, arch: &str) -> Option<PathBuf> {
    let suffix = format!("linux-{arch}.tar.gz");
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join("proxy-packages"));
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/proxy-packages"));
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.join("src-tauri/resources/proxy-packages"));
    }

    for root in roots {
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        let mut candidates: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("sing-box-") && name.ends_with(&suffix))
                    .unwrap_or(false)
            })
            .collect();
        if candidates.is_empty() {
            continue;
        }
        candidates.sort_by(|left, right| {
            let left_name = left
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let right_name = right
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            right_name.cmp(left_name)
        });
        return candidates.into_iter().next();
    }
    None
}

fn prepare_remote_mihomo_package(
    app: &AppHandle,
    session: &mut Session,
    apply_id: &str,
) -> Result<Option<String>, String> {
    let arch = match detect_remote_arch(session) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let local_package = match find_local_mihomo_package(app, &arch) {
        Some(path) => path,
        None => return Ok(None),
    };
    let extension = local_package
        .extension()
        .and_then(|value| value.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| "pkg".to_string());
    let short_apply_id = short_id(&sanitize_file_id(apply_id), 12);
    let remote_path = format!("/tmp/castor-mihomo-{arch}-{short_apply_id}.{extension}");
    upload_file_to_remote(session, &local_package, &remote_path)?;
    Ok(Some(remote_path))
}

fn find_local_mihomo_package(app: &AppHandle, arch: &str) -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join("proxy-packages"));
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/proxy-packages"));
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.join("src-tauri/resources/proxy-packages"));
    }

    for root in roots {
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        let mut candidates: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| {
                        let lower = name.to_ascii_lowercase();
                        lower.contains("mihomo")
                            && lower.contains("linux")
                            && lower.contains(arch)
                            && (lower.ends_with(".gz")
                                || lower.ends_with(".tgz")
                                || lower.ends_with(".tar.gz")
                                || lower.ends_with(".bin"))
                    })
                    .unwrap_or(false)
            })
            .collect();
        if candidates.is_empty() {
            continue;
        }
        candidates.sort_by(|left, right| {
            let left_name = left
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let right_name = right
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            right_name.cmp(left_name)
        });
        return candidates.into_iter().next();
    }
    None
}

fn upload_file_to_remote(
    session: &mut Session,
    local_path: &Path,
    remote_path: &str,
) -> Result<(), String> {
    let metadata = fs::metadata(local_path)
        .map_err(|err| format!("failed to read local package metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("local package path is not a file".to_string());
    }
    let mut local_file =
        fs::File::open(local_path).map_err(|err| format!("failed to open local package: {err}"))?;
    let mut remote_file = session
        .scp_send(Path::new(remote_path), 0o644, metadata.len(), None)
        .map_err(|err| format!("failed to open remote upload stream: {err}"))?;
    std::io::copy(&mut local_file, &mut remote_file)
        .map_err(|err| format!("failed to upload local package: {err}"))?;
    remote_file
        .flush()
        .map_err(|err| format!("failed to flush remote upload stream: {err}"))?;
    drop(remote_file);

    let verify_script = format!(
        "set -e\nTARGET={}\nif [ ! -f \"$TARGET\" ]; then\n  echo \"__CASTOR_UPLOAD_SIZE=-1\"\n  exit 9\nfi\nSIZE=$(wc -c < \"$TARGET\" | tr -d '[:space:]')\necho \"__CASTOR_UPLOAD_SIZE=$SIZE\"\n",
        shell_quote(remote_path)
    );
    let (verify_stdout, verify_stderr, verify_status) = run_remote_script(session, &verify_script)?;
    if verify_status != 0 {
        let detail = if verify_stderr.trim().is_empty() {
            verify_stdout.trim()
        } else {
            verify_stderr.trim()
        };
        return Err(format!(
            "remote upload verification failed (exit {verify_status}): {detail}"
        ));
    }
    let remote_size = verify_stdout
        .lines()
        .find_map(|line| line.trim().strip_prefix("__CASTOR_UPLOAD_SIZE="))
        .and_then(|value| value.trim().parse::<u64>().ok())
        .ok_or_else(|| "failed to parse remote upload size marker".to_string())?;
    if remote_size != metadata.len() {
        return Err(format!(
            "remote upload size mismatch: local={} remote={remote_size}",
            metadata.len()
        ));
    }
    Ok(())
}

fn sanitize_file_id(source: &str) -> String {
    source
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn short_id(source: &str, max_len: usize) -> String {
    source.chars().take(max_len).collect()
}

fn build_apply_proxy_script(
    node: &ProxyNode,
    use_sudo: bool,
    local_mixed_port: u16,
    apply_mode: ProxyApplyMode,
    apply_id: &str,
    preuploaded_archive: Option<&str>,
) -> Result<String, String> {
    let inbounds = match apply_mode {
        ProxyApplyMode::Application => vec![json!({
            "type": "mixed",
            "tag": "mixed-in",
            "listen": "127.0.0.1",
            "listen_port": local_mixed_port
        })],
        ProxyApplyMode::TunGlobal => vec![json!({
            "type": "tun",
            "tag": "tun-in",
            "interface_name": "castor-tun",
            "address": [
                "172.19.0.1/30",
                "fdfe:dcba:9876::1/126"
            ],
            "auto_route": true,
            "auto_redirect": true,
            "strict_route": true
        })],
    };
    let config_json = serde_json::to_string_pretty(&json!({
        "log": {
            "level": "warn",
            "timestamp": true
        },
        "inbounds": inbounds,
        "outbounds": [
            {
                "type": "shadowsocks",
                "tag": "proxy",
                "server": node.server,
                "server_port": node.port,
                "method": node.method,
                "password": node.password,
                "detour": "direct"
            },
            {
                "type": "direct",
                "tag": "direct"
            }
        ],
        "route": build_proxy_route(node)
    }))
    .map_err(|err| format!("failed to build sing-box config json: {err}"))?;

    let mut unit_content = String::from(
        r#"[Unit]
Description=Castor Proxy (sing-box)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sing-box run -c /etc/castor/proxy/config.json
Restart=always
RestartSec=3
LimitNOFILE=1048576
"#,
    );
    if apply_mode == ProxyApplyMode::TunGlobal {
        unit_content.push_str("AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW\n");
        unit_content.push_str("CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW\n");
    }
    unit_content.push_str(
        r#"

[Install]
WantedBy=multi-user.target
"#,
    );

    let mut script = String::new();
    script.push_str("set -e\n");
    script.push_str(&format!("APPLY_ID={}\n", shell_quote(apply_id)));
    script.push_str(&format!(
        "CASTOR_PROXY_MODE={}\n",
        shell_quote(apply_mode.as_raw())
    ));
    script.push_str(&format!(
        "PREUPLOADED_ARCHIVE={}\n",
        shell_quote(preuploaded_archive.unwrap_or(""))
    ));
    script.push_str("CANCEL_FILE=\"/tmp/castor-proxy-apply-${APPLY_ID}.cancel\"\n");
    script.push_str("check_cancel(){ if [ -f \"$CANCEL_FILE\" ]; then echo \"__CASTOR_PROXY_CANCELED=1\"; rm -f \"$CANCEL_FILE\" >/dev/null 2>&1 || true; exit 130; fi }\n");
    script.push_str("rm -f \"$CANCEL_FILE\" >/dev/null 2>&1 || true\n");
    script.push_str("echo \"[1/6] 准备权限与执行环境\"\n");
    script.push_str("check_cancel\n");
    script.push_str(&format!(
        "CASTOR_USE_SUDO={}\n",
        if use_sudo { "1" } else { "0" }
    ));
    script.push_str("SUDO=\"\"\n");
    script.push_str("if [ \"$CASTOR_USE_SUDO\" = \"1\" ] && [ \"$(id -u)\" -ne 0 ]; then\n");
    script.push_str("  if command -v sudo >/dev/null 2>&1; then\n");
    script.push_str("    SUDO=\"sudo\"\n");
    script.push_str("  else\n");
    script.push_str("    echo \"sudo is required to apply proxy node\" >&2\n");
    script.push_str("    exit 78\n");
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script
        .push_str("run_as_root(){ if [ -n \"$SUDO\" ]; then \"$SUDO\" \"$@\"; else \"$@\"; fi }\n");
    script.push_str("echo \"[2/6] 检查并安装 sing-box\"\n");
    script.push_str("check_cancel\n");
    script.push_str("if ! command -v sing-box >/dev/null 2>&1; then\n");
    script.push_str("  ARCH_RAW=\"$(uname -m)\"\n");
    script.push_str("  case \"$ARCH_RAW\" in\n");
    script.push_str("    x86_64|amd64) ARCH=\"amd64\" ;;\n");
    script.push_str("    aarch64|arm64) ARCH=\"arm64\" ;;\n");
    script.push_str("    *) echo \"unsupported architecture: $ARCH_RAW\" >&2; exit 79 ;;\n");
    script.push_str("  esac\n");
    script.push_str("  VERSION=\"1.10.5\"\n");
    script.push_str("  URL=\"https://github.com/SagerNet/sing-box/releases/download/v${VERSION}/sing-box-${VERSION}-linux-${ARCH}.tar.gz\"\n");
    script.push_str("  TMP_DIR=\"$(mktemp -d)\"\n");
    script.push_str("  ARCHIVE_PATH=\"$TMP_DIR/sing-box.tar.gz\"\n");
    script.push_str(
        "  if [ -n \"$PREUPLOADED_ARCHIVE\" ] && [ -f \"$PREUPLOADED_ARCHIVE\" ]; then\n",
    );
    script.push_str("    cp \"$PREUPLOADED_ARCHIVE\" \"$ARCHIVE_PATH\"\n");
    script.push_str("  elif command -v curl >/dev/null 2>&1; then\n");
    script.push_str("    curl -fL \"$URL\" -o \"$ARCHIVE_PATH\"\n");
    script.push_str("  elif command -v wget >/dev/null 2>&1; then\n");
    script.push_str("    wget -qO \"$ARCHIVE_PATH\" \"$URL\"\n");
    script.push_str("  else\n");
    script.push_str("    echo \"curl or wget is required to install sing-box\" >&2\n");
    script.push_str("    rm -rf \"$TMP_DIR\"\n");
    script.push_str("    exit 80\n");
    script.push_str("  fi\n");
    script.push_str("  tar -xzf \"$ARCHIVE_PATH\" -C \"$TMP_DIR\"\n");
    script.push_str("  BIN_PATH=\"$(find \"$TMP_DIR\" -type f -name sing-box | head -n 1)\"\n");
    script.push_str("  if [ -z \"$BIN_PATH\" ]; then\n");
    script.push_str("    echo \"failed to find sing-box binary in downloaded archive\" >&2\n");
    script.push_str("    rm -rf \"$TMP_DIR\"\n");
    script.push_str("    exit 81\n");
    script.push_str("  fi\n");
    script.push_str("  run_as_root install -m 0755 \"$BIN_PATH\" /usr/local/bin/sing-box\n");
    script.push_str("  rm -rf \"$TMP_DIR\"\n");
    script.push_str("fi\n");
    script.push_str("if [ -n \"$PREUPLOADED_ARCHIVE\" ]; then run_as_root rm -f \"$PREUPLOADED_ARCHIVE\" >/dev/null 2>&1 || true; fi\n");
    script.push_str("echo \"[3/6] 写入代理配置与服务文件\"\n");
    script.push_str("check_cancel\n");
    script.push_str("run_as_root mkdir -p /etc/castor/proxy\n");
    script.push_str("TMP_CONFIG=\"$(mktemp)\"\n");
    script.push_str("cat > \"$TMP_CONFIG\" <<'CASTOR_PROXY_CONFIG_EOF'\n");
    script.push_str(&config_json);
    script.push('\n');
    script.push_str("CASTOR_PROXY_CONFIG_EOF\n");
    script.push_str("run_as_root install -m 0644 \"$TMP_CONFIG\" /etc/castor/proxy/config.json\n");
    script.push_str("rm -f \"$TMP_CONFIG\"\n");
    script.push_str("TMP_UNIT=\"$(mktemp)\"\n");
    script.push_str("cat > \"$TMP_UNIT\" <<'CASTOR_PROXY_UNIT_EOF'\n");
    script.push_str(&unit_content);
    script.push_str("CASTOR_PROXY_UNIT_EOF\n");
    script.push_str(
        "run_as_root install -m 0644 \"$TMP_UNIT\" /etc/systemd/system/castor-proxy.service\n",
    );
    script.push_str("rm -f \"$TMP_UNIT\"\n");
    script.push_str("echo \"[4/6] 重载并重启代理服务\"\n");
    script.push_str("check_cancel\n");
    script.push_str("run_as_root systemctl daemon-reload\n");
    script.push_str("run_as_root systemctl enable castor-proxy.service >/dev/null 2>&1 || true\n");
    script.push_str("run_as_root systemctl restart castor-proxy.service\n");
    script.push_str("echo \"[5/6] 校验代理服务状态\"\n");
    script.push_str("check_cancel\n");
    script.push_str("run_as_root systemctl is-active castor-proxy.service\n");
    script.push_str("echo \"[6/6] 部署后自动验通与关键诊断\"\n");
    script.push_str("check_cancel\n");
    script.push_str("diag_proxy(){\n");
    script.push_str("  echo \"[diag] systemctl status castor-proxy.service\"\n");
    script
        .push_str("  run_as_root systemctl status castor-proxy.service --no-pager -n 30 || true\n");
    script.push_str("  echo \"[diag] journalctl -u castor-proxy.service\"\n");
    script.push_str("  run_as_root journalctl -u castor-proxy.service -n 80 --no-pager || true\n");
    script.push_str("}\n");
    script.push_str(
        "if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then\n",
    );
    script.push_str("  echo \"自动验通失败：缺少 curl 或 wget，无法执行连通性验证。\" >&2\n");
    script.push_str("  diag_proxy\n");
    script.push_str("  exit 85\n");
    script.push_str("fi\n");
    script.push_str("if [ \"$CASTOR_PROXY_MODE\" = \"application\" ]; then\n");
    script.push_str(&format!(
        "  PROXY_URL=\"http://127.0.0.1:{}\"\n",
        local_mixed_port
    ));
    script.push_str("  LISTEN_READY=0\n");
    script.push_str("  for _TRY in 1 2 3 4 5 6 7 8 9 10; do\n");
    script.push_str(&format!(
        "    if ss -lnt 2>/dev/null | grep -q ':{}'; then LISTEN_READY=1; break; fi\n",
        local_mixed_port
    ));
    script.push_str("    sleep 1\n");
    script.push_str("  done\n");
    script.push_str("  if [ \"$LISTEN_READY\" -ne 1 ]; then\n");
    script.push_str("    echo \"自动验通失败：应用层代理端口未就绪。\" >&2\n");
    script.push_str("    echo \"[diag] 代理监听端口\"\n");
    script.push_str(&format!(
        "    ss -lntp 2>/dev/null | grep ':{}' || true\n",
        local_mixed_port
    ));
    script.push_str("    diag_proxy\n");
    script.push_str("    exit 86\n");
    script.push_str("  fi\n");
    script.push_str("  TEST_OK=0\n");
    script.push_str("  for URL in https://google.com; do\n");
    script.push_str("    echo \"[diag] 验通测试: $URL\"\n");
    script.push_str("    if command -v curl >/dev/null 2>&1; then\n");
    script.push_str("      for _TRY in 1 2; do\n");
    script.push_str("        echo \"[diag] curl 重试 #$_TRY\"\n");
    script.push_str(
        "        if curl -4 -fsSL --connect-timeout 4 --max-time 8 --proxy \"$PROXY_URL\" \"$URL\" -o /dev/null 2>/dev/null; then TEST_OK=1; break 2; fi\n",
    );
    script.push_str("        sleep 1\n");
    script.push_str("      done\n");
    script.push_str("    elif command -v wget >/dev/null 2>&1; then\n");
    script.push_str("      for _TRY in 1 2; do\n");
    script.push_str("        echo \"[diag] wget 重试 #$_TRY\"\n");
    script.push_str(
        "        if wget -q -T 8 -e use_proxy=yes -e http_proxy=\"$PROXY_URL\" -e https_proxy=\"$PROXY_URL\" -O /dev/null \"$URL\"; then TEST_OK=1; break 2; fi\n",
    );
    script.push_str("        sleep 1\n");
    script.push_str("      done\n");
    script.push_str("    fi\n");
    script.push_str("  done\n");
    script.push_str("  echo \"[diag] 代理监听端口\"\n");
    script.push_str(&format!(
        "  ss -lntp 2>/dev/null | grep ':{}' || true\n",
        local_mixed_port
    ));
    script.push_str("  if [ \"$TEST_OK\" -ne 1 ]; then\n");
    script.push_str("    echo \"自动验通失败：应用层代理版无法通过本地代理访问外网。\" >&2\n");
    script.push_str("    diag_proxy\n");
    script.push_str("    exit 82\n");
    script.push_str("  fi\n");
    script.push_str("  echo \"自动验通成功：应用层代理版可用。\"\n");
    script.push_str("  if command -v curl >/dev/null 2>&1; then\n");
    script.push_str(
        "    EGRESS_IP=\"$(curl -4 -fsSL --connect-timeout 4 --max-time 10 --proxy \"$PROXY_URL\" https://api.ipify.org 2>/dev/null || true)\"\n",
    );
    script.push_str(
        "    if [ -n \"$EGRESS_IP\" ]; then echo \"[diag] 代理出口 IP: $EGRESS_IP\"; fi\n",
    );
    script.push_str("  fi\n");
    script.push_str("else\n");
    script.push_str("  echo \"[diag] tun 网卡状态\"\n");
    script.push_str("  TUN_READY=0\n");
    script.push_str("  for _TRY in 1 2 3 4 5 6 7 8 9 10; do\n");
    script.push_str(
        "    if run_as_root ip link show castor-tun >/dev/null 2>&1; then TUN_READY=1; break; fi\n",
    );
    script.push_str("    sleep 1\n");
    script.push_str("  done\n");
    script.push_str("  if [ \"$TUN_READY\" -ne 1 ]; then\n");
    script.push_str("    echo \"自动验通失败：未检测到 castor-tun 网卡。\" >&2\n");
    script.push_str("    diag_proxy\n");
    script.push_str("    run_as_root ip link show || true\n");
    script.push_str("    exit 83\n");
    script.push_str("  fi\n");
    script.push_str("  run_as_root ip addr show castor-tun || true\n");
    script.push_str("  echo \"[diag] 路由规则\"\n");
    script.push_str("  run_as_root ip rule show || true\n");
    script.push_str("  run_as_root ip route show table main || true\n");
    script.push_str("  run_as_root ip route show table 2022 || true\n");
    script.push_str("  run_as_root ip -6 route show table 2022 || true\n");
    script.push_str("  TEST_OK=0\n");
    script.push_str("  for URL in https://google.com; do\n");
    script.push_str("    echo \"[diag] 验通测试: $URL\"\n");
    script.push_str("    if command -v curl >/dev/null 2>&1; then\n");
    script.push_str("      for _TRY in 1 2; do\n");
    script.push_str("        echo \"[diag] curl 重试 #$_TRY\"\n");
    script.push_str(
        "        if curl -4 -fsSL --connect-timeout 4 --max-time 8 \"$URL\" -o /dev/null 2>/dev/null; then TEST_OK=1; break 2; fi\n",
    );
    script.push_str("        sleep 1\n");
    script.push_str("      done\n");
    script.push_str("    elif command -v wget >/dev/null 2>&1; then\n");
    script.push_str("      for _TRY in 1 2; do\n");
    script.push_str("        echo \"[diag] wget 重试 #$_TRY\"\n");
    script.push_str("        if wget -q -T 8 -O /dev/null \"$URL\"; then TEST_OK=1; break 2; fi\n");
    script.push_str("        sleep 1\n");
    script.push_str("      done\n");
    script.push_str("    fi\n");
    script.push_str("  done\n");
    script.push_str("  if [ \"$TEST_OK\" -ne 1 ]; then\n");
    script.push_str("    echo \"自动验通失败：tun 全局版无法直接访问外网。\" >&2\n");
    script.push_str("    diag_proxy\n");
    script.push_str("    exit 84\n");
    script.push_str("  fi\n");
    script.push_str("  echo \"自动验通成功：tun 全局版可用。\"\n");
    script.push_str("  if command -v curl >/dev/null 2>&1; then\n");
    script.push_str(
        "    EGRESS_IP=\"$(curl -4 -fsSL --connect-timeout 4 --max-time 10 https://api.ipify.org 2>/dev/null || true)\"\n",
    );
    script.push_str(
        "    if [ -n \"$EGRESS_IP\" ]; then echo \"[diag] 当前出口 IP: $EGRESS_IP\"; fi\n",
    );
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script.push_str("rm -f \"$CANCEL_FILE\" >/dev/null 2>&1 || true\n");
    script.push_str(&format!(
        "echo \"__CASTOR_PROXY_APPLY_MODE={}\"\n",
        apply_mode.as_raw()
    ));
    if apply_mode == ProxyApplyMode::Application {
        script.push_str(&format!(
            "echo \"__CASTOR_PROXY_HTTP=http://127.0.0.1:{}\"\n",
            local_mixed_port
        ));
        script.push_str(&format!(
            "echo \"__CASTOR_PROXY_SOCKS=socks5://127.0.0.1:{}\"\n",
            local_mixed_port
        ));
    }
    Ok(script)
}

fn build_apply_mihomo_script(
    node: &ProxyNode,
    use_sudo: bool,
    local_mixed_port: u16,
    apply_mode: ProxyApplyMode,
    apply_id: &str,
    preuploaded_package: Option<&str>,
) -> Result<String, String> {
    let config_yaml = build_mihomo_config_yaml(node, local_mixed_port, apply_mode);

    let mut unit_content = String::from(
        r#"[Unit]
Description=Castor Proxy (Mihomo)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/mihomo -f /etc/castor/mihomo/config.yaml
Restart=always
RestartSec=3
LimitNOFILE=1048576
"#,
    );
    if apply_mode == ProxyApplyMode::TunGlobal {
        unit_content.push_str("AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW\n");
        unit_content.push_str("CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW\n");
    }
    unit_content.push_str(
        r#"

[Install]
WantedBy=multi-user.target
"#,
    );

    let mut script = String::new();
    script.push_str("set -e\n");
    script.push_str(&format!("APPLY_ID={}\n", shell_quote(apply_id)));
    script.push_str(&format!(
        "CASTOR_PROXY_MODE={}\n",
        shell_quote(apply_mode.as_raw())
    ));
    script.push_str(&format!(
        "PREUPLOADED_PACKAGE={}\n",
        shell_quote(preuploaded_package.unwrap_or(""))
    ));
    script.push_str("CANCEL_FILE=\"/tmp/castor-proxy-apply-${APPLY_ID}.cancel\"\n");
    script.push_str("check_cancel(){ if [ -f \"$CANCEL_FILE\" ]; then echo \"__CASTOR_PROXY_CANCELED=1\"; rm -f \"$CANCEL_FILE\" >/dev/null 2>&1 || true; exit 130; fi }\n");
    script.push_str("rm -f \"$CANCEL_FILE\" >/dev/null 2>&1 || true\n");
    script.push_str("echo \"[1/6] 准备权限与执行环境\"\n");
    script.push_str("check_cancel\n");
    script.push_str(&format!(
        "CASTOR_USE_SUDO={}\n",
        if use_sudo { "1" } else { "0" }
    ));
    script.push_str("SUDO=\"\"\n");
    script.push_str("if [ \"$CASTOR_USE_SUDO\" = \"1\" ] && [ \"$(id -u)\" -ne 0 ]; then\n");
    script.push_str("  if command -v sudo >/dev/null 2>&1; then\n");
    script.push_str("    SUDO=\"sudo\"\n");
    script.push_str("  else\n");
    script.push_str("    echo \"sudo is required to apply mihomo node\" >&2\n");
    script.push_str("    exit 78\n");
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script
        .push_str("run_as_root(){ if [ -n \"$SUDO\" ]; then \"$SUDO\" \"$@\"; else \"$@\"; fi }\n");
    script.push_str("download_file(){\n");
    script.push_str("  URL=\"$1\"\n");
    script.push_str("  TARGET=\"$2\"\n");
    script.push_str("  if command -v curl >/dev/null 2>&1; then\n");
    script.push_str("    curl -fL \"$URL\" -o \"$TARGET\"\n");
    script.push_str("    return $?\n");
    script.push_str("  fi\n");
    script.push_str("  if command -v wget >/dev/null 2>&1; then\n");
    script.push_str("    wget -qO \"$TARGET\" \"$URL\"\n");
    script.push_str("    return $?\n");
    script.push_str("  fi\n");
    script.push_str("  return 127\n");
    script.push_str("}\n");
    script.push_str("extract_mihomo_binary(){\n");
    script.push_str("  SRC=\"$1\"\n");
    script.push_str("  DST_DIR=\"$2\"\n");
    script.push_str("  BIN=\"$DST_DIR/mihomo\"\n");
    script.push_str("  rm -f \"$BIN\" >/dev/null 2>&1 || true\n");
    script.push_str("  if tar -tzf \"$SRC\" >/dev/null 2>&1; then\n");
    script.push_str("    tar -xzf \"$SRC\" -C \"$DST_DIR\"\n");
    script.push_str("    FOUND=\"$(find \"$DST_DIR\" -type f \\( -name mihomo -o -name clash-meta -o -name 'mihomo-linux-*' \\) | head -n 1)\"\n");
    script.push_str("    if [ -n \"$FOUND\" ]; then cp \"$FOUND\" \"$BIN\"; fi\n");
    script.push_str("  elif gzip -t \"$SRC\" >/dev/null 2>&1; then\n");
    script.push_str("    gzip -dc \"$SRC\" > \"$BIN\"\n");
    script.push_str("  else\n");
    script.push_str("    cp \"$SRC\" \"$BIN\"\n");
    script.push_str("  fi\n");
    script.push_str("  if [ ! -f \"$BIN\" ]; then return 1; fi\n");
    script.push_str("  chmod +x \"$BIN\" >/dev/null 2>&1 || true\n");
    script.push_str("  echo \"$BIN\"\n");
    script.push_str("  return 0\n");
    script.push_str("}\n");
    script.push_str("resolve_latest_mihomo_asset(){\n");
    script.push_str("  ARCH=\"$1\"\n");
    script
        .push_str("  API_URL=\"https://api.github.com/repos/MetaCubeX/mihomo/releases/latest\"\n");
    script.push_str("  BODY=\"\"\n");
    script.push_str("  if command -v curl >/dev/null 2>&1; then\n");
    script.push_str("    BODY=\"$(curl -fsSL \"$API_URL\" 2>/dev/null || true)\"\n");
    script.push_str("  elif command -v wget >/dev/null 2>&1; then\n");
    script.push_str("    BODY=\"$(wget -qO- \"$API_URL\" 2>/dev/null || true)\"\n");
    script.push_str("  fi\n");
    script.push_str("  if [ -z \"$BODY\" ]; then return 1; fi\n");
    script.push_str("  URL=\"$(printf '%s\\n' \"$BODY\" | sed -n 's/.*\"browser_download_url\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' | sed 's#\\\\/#/#g' | grep -E \"mihomo-linux-${ARCH}(-compatible)?(-v[0-9][0-9A-Za-z._-]*)?\\\\.gz$\" | head -n 1)\"\n");
    script.push_str("  if [ -z \"$URL\" ]; then\n");
    script.push_str("    URL=\"$(printf '%s\\n' \"$BODY\" | sed -n 's/.*\"browser_download_url\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' | sed 's#\\\\/#/#g' | grep -E \"mihomo-linux-${ARCH}(-compatible)?(-v[0-9][0-9A-Za-z._-]*)?(\\\\.tar\\\\.gz)?$\" | head -n 1)\"\n");
    script.push_str("  fi\n");
    script.push_str("  if [ -z \"$URL\" ]; then return 1; fi\n");
    script.push_str("  echo \"$URL\"\n");
    script.push_str("  return 0\n");
    script.push_str("}\n");
    script.push_str("echo \"[2/6] 检查并安装 Mihomo\"\n");
    script.push_str("check_cancel\n");
    script.push_str("if ! command -v mihomo >/dev/null 2>&1; then\n");
    script.push_str("  ARCH_RAW=\"$(uname -m)\"\n");
    script.push_str("  case \"$ARCH_RAW\" in\n");
    script.push_str("    x86_64|amd64) ARCH=\"amd64\" ;;\n");
    script.push_str("    aarch64|arm64) ARCH=\"arm64\" ;;\n");
    script.push_str("    *) echo \"unsupported architecture: $ARCH_RAW\" >&2; exit 79 ;;\n");
    script.push_str("  esac\n");
    script.push_str("  TMP_DIR=\"$(mktemp -d)\"\n");
    script.push_str("  PACKAGE_PATH=\"$TMP_DIR/mihomo.package\"\n");
    script.push_str(
        "  if [ -n \"$PREUPLOADED_PACKAGE\" ] && [ -f \"$PREUPLOADED_PACKAGE\" ]; then\n",
    );
    script.push_str("    cp \"$PREUPLOADED_PACKAGE\" \"$PACKAGE_PATH\"\n");
    script.push_str("  else\n");
    script.push_str("    ASSET_URL=\"$(resolve_latest_mihomo_asset \"$ARCH\" || true)\"\n");
    script.push_str("    if [ -z \"$ASSET_URL\" ]; then\n");
    script.push_str("      echo \"failed to resolve Mihomo release asset URL\" >&2\n");
    script.push_str("      rm -rf \"$TMP_DIR\"\n");
    script.push_str("      exit 80\n");
    script.push_str("    fi\n");
    script.push_str("    if ! download_file \"$ASSET_URL\" \"$PACKAGE_PATH\"; then\n");
    script.push_str("      echo \"failed to download Mihomo package\" >&2\n");
    script.push_str("      rm -rf \"$TMP_DIR\"\n");
    script.push_str("      exit 81\n");
    script.push_str("    fi\n");
    script.push_str("  fi\n");
    script.push_str(
        "  BIN_PATH=\"$(extract_mihomo_binary \"$PACKAGE_PATH\" \"$TMP_DIR\" || true)\"\n",
    );
    script.push_str("  if [ -z \"$BIN_PATH\" ] || [ ! -f \"$BIN_PATH\" ]; then\n");
    script.push_str("    echo \"failed to extract Mihomo binary from package\" >&2\n");
    script.push_str("    rm -rf \"$TMP_DIR\"\n");
    script.push_str("    exit 82\n");
    script.push_str("  fi\n");
    script.push_str("  run_as_root install -m 0755 \"$BIN_PATH\" /usr/local/bin/mihomo\n");
    script.push_str("  rm -rf \"$TMP_DIR\"\n");
    script.push_str("fi\n");
    script.push_str("if [ -n \"$PREUPLOADED_PACKAGE\" ]; then run_as_root rm -f \"$PREUPLOADED_PACKAGE\" >/dev/null 2>&1 || true; fi\n");
    script.push_str("echo \"[3/6] 写入 Mihomo 配置与服务文件\"\n");
    script.push_str("check_cancel\n");
    script.push_str("run_as_root mkdir -p /etc/castor/mihomo\n");
    script.push_str("TMP_CONFIG=\"$(mktemp)\"\n");
    script.push_str("cat > \"$TMP_CONFIG\" <<'CASTOR_MIHOMO_CONFIG_EOF'\n");
    script.push_str(&config_yaml);
    script.push('\n');
    script.push_str("CASTOR_MIHOMO_CONFIG_EOF\n");
    script.push_str("run_as_root install -m 0644 \"$TMP_CONFIG\" /etc/castor/mihomo/config.yaml\n");
    script.push_str("rm -f \"$TMP_CONFIG\"\n");
    script.push_str("TMP_UNIT=\"$(mktemp)\"\n");
    script.push_str("cat > \"$TMP_UNIT\" <<'CASTOR_MIHOMO_UNIT_EOF'\n");
    script.push_str(&unit_content);
    script.push_str("CASTOR_MIHOMO_UNIT_EOF\n");
    script.push_str(
        "run_as_root install -m 0644 \"$TMP_UNIT\" /etc/systemd/system/castor-mihomo.service\n",
    );
    script.push_str("rm -f \"$TMP_UNIT\"\n");
    script.push_str("echo \"[4/6] 重载并重启 Mihomo 服务\"\n");
    script.push_str("check_cancel\n");
    script.push_str("run_as_root systemctl daemon-reload\n");
    script.push_str("run_as_root systemctl enable castor-mihomo.service >/dev/null 2>&1 || true\n");
    script.push_str("run_as_root systemctl restart castor-mihomo.service\n");
    script.push_str("echo \"[5/6] 校验 Mihomo 服务状态\"\n");
    script.push_str("check_cancel\n");
    script.push_str("run_as_root systemctl is-active castor-mihomo.service\n");
    script.push_str("echo \"[6/6] 部署后自动验通与关键诊断\"\n");
    script.push_str("check_cancel\n");
    script.push_str("diag_proxy(){\n");
    script.push_str("  echo \"[diag] systemctl status castor-mihomo.service\"\n");
    script.push_str(
        "  run_as_root systemctl status castor-mihomo.service --no-pager -n 30 || true\n",
    );
    script.push_str("  echo \"[diag] journalctl -u castor-mihomo.service\"\n");
    script.push_str("  run_as_root journalctl -u castor-mihomo.service -n 80 --no-pager || true\n");
    script.push_str("  echo \"[diag] mihomo version\"\n");
    script.push_str("  mihomo -v 2>/dev/null || true\n");
    script.push_str("}\n");
    script.push_str(
        "if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then\n",
    );
    script.push_str("  echo \"自动验通失败：缺少 curl 或 wget，无法执行连通性验证。\" >&2\n");
    script.push_str("  diag_proxy\n");
    script.push_str("  exit 85\n");
    script.push_str("fi\n");
    script.push_str("if [ \"$CASTOR_PROXY_MODE\" = \"application\" ]; then\n");
    script.push_str(&format!(
        "  PROXY_URL=\"http://127.0.0.1:{}\"\n",
        local_mixed_port
    ));
    script.push_str("  LISTEN_READY=0\n");
    script.push_str("  for _TRY in 1 2 3 4 5 6 7 8 9 10; do\n");
    script.push_str(&format!(
        "    if ss -lnt 2>/dev/null | grep -q ':{}'; then LISTEN_READY=1; break; fi\n",
        local_mixed_port
    ));
    script.push_str("    sleep 1\n");
    script.push_str("  done\n");
    script.push_str("  if [ \"$LISTEN_READY\" -ne 1 ]; then\n");
    script.push_str("    echo \"自动验通失败：应用层代理端口未就绪。\" >&2\n");
    script.push_str("    echo \"[diag] 代理监听端口\"\n");
    script.push_str(&format!(
        "    ss -lntp 2>/dev/null | grep ':{}' || true\n",
        local_mixed_port
    ));
    script.push_str("    diag_proxy\n");
    script.push_str("    exit 86\n");
    script.push_str("  fi\n");
    script.push_str("  TEST_OK=0\n");
    script.push_str("  for URL in https://google.com; do\n");
    script.push_str("    echo \"[diag] 验通测试: $URL\"\n");
    script.push_str("    if command -v curl >/dev/null 2>&1; then\n");
    script.push_str("      for _TRY in 1 2; do\n");
    script.push_str("        echo \"[diag] curl 重试 #$_TRY\"\n");
    script.push_str(
        "        if curl -4 -fsSL --connect-timeout 4 --max-time 8 --proxy \"$PROXY_URL\" \"$URL\" -o /dev/null 2>/dev/null; then TEST_OK=1; break 2; fi\n",
    );
    script.push_str("        sleep 1\n");
    script.push_str("      done\n");
    script.push_str("    elif command -v wget >/dev/null 2>&1; then\n");
    script.push_str("      for _TRY in 1 2; do\n");
    script.push_str("        echo \"[diag] wget 重试 #$_TRY\"\n");
    script.push_str(
        "        if wget -q -T 8 -e use_proxy=yes -e http_proxy=\"$PROXY_URL\" -e https_proxy=\"$PROXY_URL\" -O /dev/null \"$URL\"; then TEST_OK=1; break 2; fi\n",
    );
    script.push_str("        sleep 1\n");
    script.push_str("      done\n");
    script.push_str("    fi\n");
    script.push_str("  done\n");
    script.push_str("  echo \"[diag] 代理监听端口\"\n");
    script.push_str(&format!(
        "  ss -lntp 2>/dev/null | grep ':{}' || true\n",
        local_mixed_port
    ));
    script.push_str("  if [ \"$TEST_OK\" -ne 1 ]; then\n");
    script.push_str("    echo \"自动验通失败：应用层代理版无法通过本地代理访问外网。\" >&2\n");
    script.push_str("    diag_proxy\n");
    script.push_str("    exit 87\n");
    script.push_str("  fi\n");
    script.push_str("  echo \"自动验通成功：应用层代理版可用。\"\n");
    script.push_str("  if command -v curl >/dev/null 2>&1; then\n");
    script.push_str(
        "    EGRESS_IP=\"$(curl -4 -fsSL --connect-timeout 4 --max-time 10 --proxy \"$PROXY_URL\" https://api.ipify.org 2>/dev/null || true)\"\n",
    );
    script.push_str(
        "    if [ -n \"$EGRESS_IP\" ]; then echo \"[diag] 代理出口 IP: $EGRESS_IP\"; fi\n",
    );
    script.push_str("  fi\n");
    script.push_str("else\n");
    script.push_str("  echo \"[diag] tun 网卡状态\"\n");
    script.push_str("  TUN_READY=0\n");
    script.push_str("  for _TRY in 1 2 3 4 5 6 7 8 9 10; do\n");
    script.push_str(
        "    if run_as_root ip link show castor-tun >/dev/null 2>&1; then TUN_READY=1; break; fi\n",
    );
    script.push_str("    sleep 1\n");
    script.push_str("  done\n");
    script.push_str("  if [ \"$TUN_READY\" -ne 1 ]; then\n");
    script.push_str("    echo \"自动验通失败：未检测到 castor-tun 网卡。\" >&2\n");
    script.push_str("    diag_proxy\n");
    script.push_str("    run_as_root ip link show || true\n");
    script.push_str("    exit 88\n");
    script.push_str("  fi\n");
    script.push_str("  run_as_root ip addr show castor-tun || true\n");
    script.push_str("  echo \"[diag] 路由规则\"\n");
    script.push_str("  run_as_root ip rule show || true\n");
    script.push_str("  run_as_root ip route show table main || true\n");
    script.push_str("  TEST_OK=0\n");
    script.push_str("  for URL in https://google.com; do\n");
    script.push_str("    echo \"[diag] 验通测试: $URL\"\n");
    script.push_str("    if command -v curl >/dev/null 2>&1; then\n");
    script.push_str("      for _TRY in 1 2; do\n");
    script.push_str("        echo \"[diag] curl 重试 #$_TRY\"\n");
    script.push_str(
        "        if curl -4 -fsSL --connect-timeout 4 --max-time 8 \"$URL\" -o /dev/null 2>/dev/null; then TEST_OK=1; break 2; fi\n",
    );
    script.push_str("        sleep 1\n");
    script.push_str("      done\n");
    script.push_str("    elif command -v wget >/dev/null 2>&1; then\n");
    script.push_str("      for _TRY in 1 2; do\n");
    script.push_str("        echo \"[diag] wget 重试 #$_TRY\"\n");
    script.push_str("        if wget -q -T 8 -O /dev/null \"$URL\"; then TEST_OK=1; break 2; fi\n");
    script.push_str("        sleep 1\n");
    script.push_str("      done\n");
    script.push_str("    fi\n");
    script.push_str("  done\n");
    script.push_str("  if [ \"$TEST_OK\" -ne 1 ]; then\n");
    script.push_str("    echo \"自动验通失败：tun 全局版无法直接访问外网。\" >&2\n");
    script.push_str("    diag_proxy\n");
    script.push_str("    exit 89\n");
    script.push_str("  fi\n");
    script.push_str("  echo \"自动验通成功：tun 全局版可用。\"\n");
    script.push_str("  if command -v curl >/dev/null 2>&1; then\n");
    script.push_str(
        "    EGRESS_IP=\"$(curl -4 -fsSL --connect-timeout 4 --max-time 10 https://api.ipify.org 2>/dev/null || true)\"\n",
    );
    script.push_str(
        "    if [ -n \"$EGRESS_IP\" ]; then echo \"[diag] 当前出口 IP: $EGRESS_IP\"; fi\n",
    );
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script.push_str("rm -f \"$CANCEL_FILE\" >/dev/null 2>&1 || true\n");
    script.push_str(&format!(
        "echo \"__CASTOR_MIHOMO_APPLY_MODE={}\"\n",
        apply_mode.as_raw()
    ));
    if apply_mode == ProxyApplyMode::Application {
        script.push_str(&format!(
            "echo \"__CASTOR_MIHOMO_HTTP=http://127.0.0.1:{}\"\n",
            local_mixed_port
        ));
        script.push_str(&format!(
            "echo \"__CASTOR_MIHOMO_SOCKS=socks5://127.0.0.1:{}\"\n",
            local_mixed_port
        ));
    }
    Ok(script)
}

fn build_mihomo_config_yaml(
    node: &ProxyNode,
    local_mixed_port: u16,
    apply_mode: ProxyApplyMode,
) -> String {
    let proxy_name = if node.name.trim().is_empty() {
        "castor-proxy"
    } else {
        node.name.trim()
    };
    let mut lines: Vec<String> = vec![
        format!("mixed-port: {}", local_mixed_port),
        "allow-lan: false".to_string(),
        "mode: rule".to_string(),
        "log-level: warning".to_string(),
        "ipv6: true".to_string(),
        "proxies:".to_string(),
        format!("  - name: {}", yaml_quote(proxy_name)),
        "    type: ss".to_string(),
        format!("    server: {}", yaml_quote(&node.server)),
        format!("    port: {}", node.port),
        format!("    cipher: {}", yaml_quote(&node.method)),
        format!("    password: {}", yaml_quote(&node.password)),
        "proxy-groups:".to_string(),
        "  - name: \"PROXY\"".to_string(),
        "    type: select".to_string(),
        "    proxies:".to_string(),
        format!("      - {}", yaml_quote(proxy_name)),
        "rules:".to_string(),
    ];

    lines.push(format!("  - {}", build_mihomo_direct_rule(node)));
    lines.push("  - \"MATCH,PROXY\"".to_string());

    if apply_mode == ProxyApplyMode::TunGlobal {
        lines.push("tun:".to_string());
        lines.push("  enable: true".to_string());
        lines.push("  stack: system".to_string());
        lines.push("  device: castor-tun".to_string());
        lines.push("  auto-route: true".to_string());
        lines.push("  auto-detect-interface: true".to_string());
        lines.push("  strict-route: true".to_string());
        lines.push("  dns-hijack:".to_string());
        lines.push("    - \"any:53\"".to_string());
        lines.push("dns:".to_string());
        lines.push("  enable: true".to_string());
        lines.push("  ipv6: true".to_string());
        lines.push("  enhanced-mode: fake-ip".to_string());
        lines.push("  nameserver:".to_string());
        lines.push("    - \"8.8.8.8\"".to_string());
        lines.push("    - \"1.1.1.1\"".to_string());
    }

    lines.join("\n")
}

fn build_mihomo_direct_rule(node: &ProxyNode) -> String {
    let server = node.server.trim();
    if let Ok(ip) = server.parse::<IpAddr>() {
        let cidr = match ip {
            IpAddr::V4(value) => format!("{value}/32"),
            IpAddr::V6(value) => format!("{value}/128"),
        };
        return format!("\"IP-CIDR,{cidr},DIRECT,no-resolve\"");
    }
    format!("\"DOMAIN,{},DIRECT\"", node.server.trim())
}

fn yaml_quote(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    format!("\"{escaped}\"")
}

fn build_proxy_route(node: &ProxyNode) -> Value {
    let mut rules = Vec::new();
    rules.push(build_proxy_server_direct_rule(node));
    json!({
        "auto_detect_interface": true,
        "final": "proxy",
        "rules": rules
    })
}

fn build_proxy_server_direct_rule(node: &ProxyNode) -> Value {
    let server = node.server.trim();
    if let Ok(ip) = server.parse::<IpAddr>() {
        let cidr = match ip {
            IpAddr::V4(value) => format!("{value}/32"),
            IpAddr::V6(value) => format!("{value}/128"),
        };
        return json!({
            "ip_cidr": [cidr],
            "outbound": "direct"
        });
    }

    json!({
        "domain": [server],
        "outbound": "direct"
    })
}

fn is_transport_read_error(err: &str) -> bool {
    let normalized = err.to_ascii_lowercase();
    normalized.contains("transport read") || normalized.contains("session disconnected")
}

fn recover_proxy_apply_after_transport_disconnect(
    profile: &ConnectionProfile,
    use_sudo: bool,
    expected_node: &ProxyNode,
) -> Result<(), String> {
    let mut last_error = String::new();
    for attempt in 1..=4 {
        if attempt > 1 {
            std::thread::sleep(Duration::from_millis(1200));
        }
        let mut session = match connect_ssh_profile(profile) {
            Ok(session) => session,
            Err(err) => {
                last_error = format!("reconnect attempt {attempt} failed: {err}");
                continue;
            }
        };
        let script = build_runtime_config_script(use_sudo);
        let (stdout, stderr, exit_status) = match run_remote_script(&mut session, &script) {
            Ok(result) => result,
            Err(err) => {
                last_error = format!("runtime config probe attempt {attempt} failed: {err}");
                continue;
            }
        };
        if exit_status != 0 {
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            last_error = format!(
                "runtime config probe attempt {attempt} exited with {exit_status}: {detail}"
            );
            continue;
        }

        let markers = parse_runtime_config_markers(&stdout);
        let active = markers.active.unwrap_or(false);
        let config_exists = markers.config_exists.unwrap_or(false);
        if !active || !config_exists {
            last_error = format!(
                "runtime config probe attempt {attempt} not ready: active={active}, config_exists={config_exists}"
            );
            continue;
        }

        let Some(raw_config) = markers.raw_config.as_deref() else {
            last_error = format!("runtime config probe attempt {attempt} missing raw config");
            continue;
        };
        let summary = match build_runtime_config_summary(raw_config) {
            Ok(value) => value,
            Err(err) => {
                last_error =
                    format!("runtime config probe attempt {attempt} failed parsing config: {err}");
                continue;
            }
        };
        if runtime_config_matches_expected_node(&summary, expected_node) {
            return Ok(());
        }
        last_error = format!(
            "runtime config probe attempt {attempt} active but target node mismatch (expected {}:{})",
            expected_node.server, expected_node.port
        );
    }

    Err(if last_error.is_empty() {
        "recovery check failed with unknown reason".to_string()
    } else {
        last_error
    })
}

fn recover_mihomo_apply_after_transport_disconnect(
    profile: &ConnectionProfile,
    use_sudo: bool,
) -> Result<(), String> {
    let mut last_error = String::new();
    for attempt in 1..=4 {
        if attempt > 1 {
            std::thread::sleep(Duration::from_millis(1200));
        }
        let mut session = match connect_ssh_profile(profile) {
            Ok(session) => session,
            Err(err) => {
                last_error = format!("reconnect attempt {attempt} failed: {err}");
                continue;
            }
        };

        let mut script = String::new();
        script.push_str("set +e\n");
        script.push_str(&format!(
            "CASTOR_USE_SUDO={}\n",
            if use_sudo { "1" } else { "0" }
        ));
        script.push_str("SUDO=\"\"\n");
        script.push_str("if [ \"$CASTOR_USE_SUDO\" = \"1\" ] && [ \"$(id -u)\" -ne 0 ]; then\n");
        script.push_str("  if command -v sudo >/dev/null 2>&1; then SUDO=\"sudo\"; fi\n");
        script.push_str("fi\n");
        script.push_str(
            "run_as_root(){ if [ -n \"$SUDO\" ]; then \"$SUDO\" \"$@\"; else \"$@\"; fi }\n",
        );
        script.push_str("ACTIVE=0\n");
        script.push_str("CONFIG_EXISTS=0\n");
        script.push_str("TUN_EXISTS=0\n");
        script.push_str("if [ -f /etc/castor/mihomo/config.yaml ]; then CONFIG_EXISTS=1; fi\n");
        script.push_str("if command -v systemctl >/dev/null 2>&1; then\n");
        script
            .push_str("  run_as_root systemctl is-active castor-mihomo.service >/dev/null 2>&1\n");
        script.push_str("  if [ \"$?\" -eq 0 ]; then ACTIVE=1; fi\n");
        script.push_str("fi\n");
        script.push_str("if command -v ip >/dev/null 2>&1; then\n");
        script.push_str("  run_as_root ip link show castor-tun >/dev/null 2>&1\n");
        script.push_str("  if [ \"$?\" -eq 0 ]; then TUN_EXISTS=1; fi\n");
        script.push_str("fi\n");
        script.push_str("echo \"__CASTOR_MIHOMO_RECOVER__ACTIVE=$ACTIVE\"\n");
        script.push_str("echo \"__CASTOR_MIHOMO_RECOVER__CONFIG_EXISTS=$CONFIG_EXISTS\"\n");
        script.push_str("echo \"__CASTOR_MIHOMO_RECOVER__TUN_EXISTS=$TUN_EXISTS\"\n");
        script.push_str("exit 0\n");

        let (stdout, stderr, exit_status) = match run_remote_script(&mut session, &script) {
            Ok(result) => result,
            Err(err) => {
                last_error = format!("recovery probe attempt {attempt} failed: {err}");
                continue;
            }
        };
        if exit_status != 0 {
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            last_error =
                format!("recovery probe attempt {attempt} exited with {exit_status}: {detail}");
            continue;
        }

        let mut active = false;
        let mut config_exists = false;
        let mut tun_exists = false;
        for raw_line in stdout.lines() {
            let line = raw_line.trim();
            if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_RECOVER__ACTIVE=") {
                active = parse_marker_bool(value).unwrap_or(false);
                continue;
            }
            if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_RECOVER__CONFIG_EXISTS=") {
                config_exists = parse_marker_bool(value).unwrap_or(false);
                continue;
            }
            if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_RECOVER__TUN_EXISTS=") {
                tun_exists = parse_marker_bool(value).unwrap_or(false);
                continue;
            }
        }
        if active && config_exists && tun_exists {
            return Ok(());
        }
        last_error = format!(
            "recovery probe attempt {attempt} not ready: active={active}, config_exists={config_exists}, tun_exists={tun_exists}"
        );
    }

    Err(if last_error.is_empty() {
        "recovery check failed with unknown reason".to_string()
    } else {
        last_error
    })
}

fn runtime_config_matches_expected_node(
    summary: &ServerProxyRuntimeConfigSummary,
    expected_node: &ProxyNode,
) -> bool {
    summary
        .outbounds
        .iter()
        .filter(|outbound| outbound.server.is_some() && outbound.server_port.is_some())
        .any(|outbound| outbound_matches_proxy_node(outbound, expected_node))
}

fn outbound_matches_proxy_node(
    outbound: &ServerProxyRuntimeOutboundSummary,
    expected_node: &ProxyNode,
) -> bool {
    let outbound_protocol = normalize_protocol(&outbound.r#type);
    let expected_protocol = normalize_protocol(&expected_node.protocol);
    if outbound_protocol != expected_protocol {
        return false;
    }
    let outbound_host = outbound.server.as_deref().unwrap_or_default().trim();
    if !outbound_host.eq_ignore_ascii_case(expected_node.server.trim()) {
        return false;
    }
    if outbound.server_port != Some(expected_node.port) {
        return false;
    }
    if let Some(method) = outbound.method.as_deref() {
        if !method.trim().is_empty() && !method.eq_ignore_ascii_case(expected_node.method.trim()) {
            return false;
        }
    }
    true
}

fn normalize_protocol(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized == "ss" {
        "shadowsocks".to_string()
    } else {
        normalized
    }
}

fn build_cancel_apply_script(apply_id: &str) -> String {
    let mut script = String::new();
    script.push_str("set -e\n");
    script.push_str(&format!("APPLY_ID={}\n", shell_quote(apply_id)));
    script.push_str("CANCEL_FILE=\"/tmp/castor-proxy-apply-${APPLY_ID}.cancel\"\n");
    script.push_str("touch \"$CANCEL_FILE\"\n");
    script.push_str("echo \"__CASTOR_PROXY_CANCEL_SENT=1\"\n");
    script
}

fn build_runtime_status_script(use_sudo: bool) -> String {
    let mut script = String::new();
    script.push_str("set +e\n");
    script.push_str(&format!(
        "CASTOR_USE_SUDO={}\n",
        if use_sudo { "1" } else { "0" }
    ));
    script.push_str("SUDO=\"\"\n");
    script.push_str("if [ \"$CASTOR_USE_SUDO\" = \"1\" ] && [ \"$(id -u)\" -ne 0 ]; then\n");
    script.push_str("  if command -v sudo >/dev/null 2>&1; then\n");
    script.push_str("    SUDO=\"sudo\"\n");
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script
        .push_str("run_as_root(){ if [ -n \"$SUDO\" ]; then \"$SUDO\" \"$@\"; else \"$@\"; fi }\n");
    script.push_str("INSTALLED=0\n");
    script.push_str("if command -v sing-box >/dev/null 2>&1; then INSTALLED=1; fi\n");
    script.push_str("CONFIG_EXISTS=0\n");
    script.push_str("if [ -f /etc/castor/proxy/config.json ]; then CONFIG_EXISTS=1; fi\n");
    script.push_str("ACTIVE=0\n");
    script.push_str("ENABLED=0\n");
    script.push_str("if command -v systemctl >/dev/null 2>&1; then\n");
    script.push_str("  run_as_root systemctl is-active castor-proxy.service >/dev/null 2>&1\n");
    script.push_str("  if [ \"$?\" -eq 0 ]; then ACTIVE=1; fi\n");
    script.push_str("  run_as_root systemctl is-enabled castor-proxy.service >/dev/null 2>&1\n");
    script.push_str("  if [ \"$?\" -eq 0 ]; then ENABLED=1; fi\n");
    script.push_str("fi\n");
    script.push_str("echo \"__CASTOR_PROXY_STATUS__INSTALLED=$INSTALLED\"\n");
    script.push_str("echo \"__CASTOR_PROXY_STATUS__CONFIG_EXISTS=$CONFIG_EXISTS\"\n");
    script.push_str("echo \"__CASTOR_PROXY_STATUS__ACTIVE=$ACTIVE\"\n");
    script.push_str("echo \"__CASTOR_PROXY_STATUS__ENABLED=$ENABLED\"\n");
    script
}

fn build_mihomo_runtime_status_script(use_sudo: bool) -> String {
    let mut script = String::new();
    script.push_str("set +e\n");
    script.push_str(&format!(
        "CASTOR_USE_SUDO={}\n",
        if use_sudo { "1" } else { "0" }
    ));
    script.push_str("SUDO=\"\"\n");
    script.push_str("if [ \"$CASTOR_USE_SUDO\" = \"1\" ] && [ \"$(id -u)\" -ne 0 ]; then\n");
    script.push_str("  if command -v sudo >/dev/null 2>&1; then\n");
    script.push_str("    SUDO=\"sudo\"\n");
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script
        .push_str("run_as_root(){ if [ -n \"$SUDO\" ]; then \"$SUDO\" \"$@\"; else \"$@\"; fi }\n");
    script.push_str("CONFIG_PATH=\"/etc/castor/mihomo/config.yaml\"\n");
    script.push_str("INSTALLED=0\n");
    script.push_str("if command -v mihomo >/dev/null 2>&1; then INSTALLED=1; fi\n");
    script.push_str("CONFIG_EXISTS=0\n");
    script.push_str("if [ -f \"$CONFIG_PATH\" ]; then CONFIG_EXISTS=1; fi\n");
    script.push_str("ACTIVE=0\n");
    script.push_str("ENABLED=0\n");
    script.push_str("APPLY_MODE=\"\"\n");
    script.push_str("MODE=\"\"\n");
    script.push_str("PROXY_NAME=\"\"\n");
    script.push_str("PROXY_TYPE=\"\"\n");
    script.push_str("PROXY_SERVER=\"\"\n");
    script.push_str("PROXY_PORT=\"\"\n");
    script.push_str("PROXY_CIPHER=\"\"\n");
    script.push_str("if [ \"$CONFIG_EXISTS\" = \"1\" ]; then\n");
    script.push_str(
        "  MODE=\"$(run_as_root sed -n 's/^[[:space:]]*mode:[[:space:]]*//p' \"$CONFIG_PATH\" | head -n 1 | tr -d '\\r')\"\n",
    );
    script.push_str(
        "  if run_as_root grep -Eq '^[[:space:]]*device:[[:space:]]*castor-tun([[:space:]]*|$)' \"$CONFIG_PATH\"; then APPLY_MODE=\"tun_global\"; else APPLY_MODE=\"application\"; fi\n",
    );
    script.push_str(
        "  PROXY_BLOCK=\"$(run_as_root sed -n '/^[[:space:]]*proxies:[[:space:]]*$/,/^[[:space:]]*proxy-groups:[[:space:]]*$/p' \"$CONFIG_PATH\" 2>/dev/null || true)\"\n",
    );
    script.push_str(
        "  PROXY_NAME=\"$(printf '%s\\n' \"$PROXY_BLOCK\" | sed -n 's/^[[:space:]]*-[[:space:]]*name:[[:space:]]*//p' | head -n 1 | tr -d '\\r' | sed 's/^\"//;s/\"$//')\"\n",
    );
    script.push_str(
        "  PROXY_TYPE=\"$(printf '%s\\n' \"$PROXY_BLOCK\" | sed -n 's/^[[:space:]]*type:[[:space:]]*//p' | head -n 1 | tr -d '\\r' | sed 's/^\"//;s/\"$//')\"\n",
    );
    script.push_str(
        "  PROXY_SERVER=\"$(printf '%s\\n' \"$PROXY_BLOCK\" | sed -n 's/^[[:space:]]*server:[[:space:]]*//p' | head -n 1 | tr -d '\\r' | sed 's/^\"//;s/\"$//')\"\n",
    );
    script.push_str(
        "  PROXY_PORT=\"$(printf '%s\\n' \"$PROXY_BLOCK\" | sed -n 's/^[[:space:]]*port:[[:space:]]*//p' | head -n 1 | tr -d '\\r' | sed 's/^\"//;s/\"$//')\"\n",
    );
    script.push_str(
        "  PROXY_CIPHER=\"$(printf '%s\\n' \"$PROXY_BLOCK\" | sed -n 's/^[[:space:]]*cipher:[[:space:]]*//p' | head -n 1 | tr -d '\\r' | sed 's/^\"//;s/\"$//')\"\n",
    );
    script.push_str("fi\n");
    script.push_str("if command -v systemctl >/dev/null 2>&1; then\n");
    script.push_str("  run_as_root systemctl is-active castor-mihomo.service >/dev/null 2>&1\n");
    script.push_str("  if [ \"$?\" -eq 0 ]; then ACTIVE=1; fi\n");
    script.push_str("  run_as_root systemctl is-enabled castor-mihomo.service >/dev/null 2>&1\n");
    script.push_str("  if [ \"$?\" -eq 0 ]; then ENABLED=1; fi\n");
    script.push_str("fi\n");
    script.push_str("echo \"__CASTOR_MIHOMO_STATUS__INSTALLED=$INSTALLED\"\n");
    script.push_str("echo \"__CASTOR_MIHOMO_STATUS__CONFIG_EXISTS=$CONFIG_EXISTS\"\n");
    script.push_str("echo \"__CASTOR_MIHOMO_STATUS__ACTIVE=$ACTIVE\"\n");
    script.push_str("echo \"__CASTOR_MIHOMO_STATUS__ENABLED=$ENABLED\"\n");
    script.push_str("if [ -n \"$APPLY_MODE\" ]; then echo \"__CASTOR_MIHOMO_STATUS__APPLY_MODE=$APPLY_MODE\"; fi\n");
    script.push_str("if [ -n \"$MODE\" ]; then echo \"__CASTOR_MIHOMO_STATUS__MODE=$MODE\"; fi\n");
    script.push_str("if [ -n \"$PROXY_NAME\" ]; then echo \"__CASTOR_MIHOMO_STATUS__PROXY_NAME=$PROXY_NAME\"; fi\n");
    script.push_str("if [ -n \"$PROXY_TYPE\" ]; then echo \"__CASTOR_MIHOMO_STATUS__PROXY_TYPE=$PROXY_TYPE\"; fi\n");
    script.push_str("if [ -n \"$PROXY_SERVER\" ]; then echo \"__CASTOR_MIHOMO_STATUS__PROXY_SERVER=$PROXY_SERVER\"; fi\n");
    script.push_str("if [ -n \"$PROXY_PORT\" ]; then echo \"__CASTOR_MIHOMO_STATUS__PROXY_PORT=$PROXY_PORT\"; fi\n");
    script.push_str("if [ -n \"$PROXY_CIPHER\" ]; then echo \"__CASTOR_MIHOMO_STATUS__PROXY_CIPHER=$PROXY_CIPHER\"; fi\n");
    script
}

fn build_runtime_config_script(use_sudo: bool) -> String {
    let mut script = String::new();
    script.push_str("set +e\n");
    script.push_str(&format!(
        "CASTOR_USE_SUDO={}\n",
        if use_sudo { "1" } else { "0" }
    ));
    script.push_str("SUDO=\"\"\n");
    script.push_str("if [ \"$CASTOR_USE_SUDO\" = \"1\" ] && [ \"$(id -u)\" -ne 0 ]; then\n");
    script.push_str("  if command -v sudo >/dev/null 2>&1; then\n");
    script.push_str("    SUDO=\"sudo\"\n");
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script
        .push_str("run_as_root(){ if [ -n \"$SUDO\" ]; then \"$SUDO\" \"$@\"; else \"$@\"; fi }\n");
    script.push_str("CONFIG_PATH=\"/etc/castor/proxy/config.json\"\n");
    script.push_str("INSTALLED=0\n");
    script.push_str("if command -v sing-box >/dev/null 2>&1; then INSTALLED=1; fi\n");
    script.push_str("CONFIG_EXISTS=0\n");
    script.push_str("if [ -f \"$CONFIG_PATH\" ]; then CONFIG_EXISTS=1; fi\n");
    script.push_str("ACTIVE=0\n");
    script.push_str("ENABLED=0\n");
    script.push_str("if command -v systemctl >/dev/null 2>&1; then\n");
    script.push_str("  run_as_root systemctl is-active castor-proxy.service >/dev/null 2>&1\n");
    script.push_str("  if [ \"$?\" -eq 0 ]; then ACTIVE=1; fi\n");
    script.push_str("  run_as_root systemctl is-enabled castor-proxy.service >/dev/null 2>&1\n");
    script.push_str("  if [ \"$?\" -eq 0 ]; then ENABLED=1; fi\n");
    script.push_str("fi\n");
    script.push_str("echo \"__CASTOR_PROXY_CONFIG__INSTALLED=$INSTALLED\"\n");
    script.push_str("echo \"__CASTOR_PROXY_CONFIG__CONFIG_EXISTS=$CONFIG_EXISTS\"\n");
    script.push_str("echo \"__CASTOR_PROXY_CONFIG__ACTIVE=$ACTIVE\"\n");
    script.push_str("echo \"__CASTOR_PROXY_CONFIG__ENABLED=$ENABLED\"\n");
    script.push_str("echo \"__CASTOR_PROXY_CONFIG__PATH=$CONFIG_PATH\"\n");
    script.push_str("if [ \"$CONFIG_EXISTS\" = \"1\" ]; then\n");
    script.push_str("  echo \"__CASTOR_PROXY_CONFIG__BEGIN\"\n");
    script.push_str("  run_as_root cat \"$CONFIG_PATH\"\n");
    script.push_str("  READ_STATUS=$?\n");
    script.push_str("  echo \"__CASTOR_PROXY_CONFIG__END\"\n");
    script.push_str("  echo \"__CASTOR_PROXY_CONFIG__READ_STATUS=$READ_STATUS\"\n");
    script.push_str("fi\n");
    script.push_str("exit 0\n");
    script
}

#[derive(Default)]
struct RuntimeStatusMarkers {
    installed: Option<bool>,
    active: Option<bool>,
    enabled: Option<bool>,
    config_exists: Option<bool>,
}

#[derive(Default)]
struct MihomoRuntimeStatusMarkers {
    installed: Option<bool>,
    active: Option<bool>,
    enabled: Option<bool>,
    config_exists: Option<bool>,
    apply_mode: Option<String>,
    mode: Option<String>,
    proxy_name: Option<String>,
    proxy_type: Option<String>,
    proxy_server: Option<String>,
    proxy_port: Option<u16>,
    proxy_cipher: Option<String>,
}

#[derive(Default)]
struct RuntimeConfigMarkers {
    installed: Option<bool>,
    active: Option<bool>,
    enabled: Option<bool>,
    config_exists: Option<bool>,
    config_path: Option<String>,
    read_error: Option<i32>,
    raw_config: Option<String>,
    stdout_without_config: String,
}

fn parse_runtime_status_markers(stdout: &str) -> RuntimeStatusMarkers {
    let mut markers = RuntimeStatusMarkers::default();
    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_STATUS__INSTALLED=") {
            markers.installed = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_STATUS__CONFIG_EXISTS=") {
            markers.config_exists = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_STATUS__ACTIVE=") {
            markers.active = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_STATUS__ENABLED=") {
            markers.enabled = parse_marker_bool(value);
            continue;
        }
    }
    markers
}

fn parse_mihomo_runtime_status_markers(stdout: &str) -> MihomoRuntimeStatusMarkers {
    let mut markers = MihomoRuntimeStatusMarkers::default();
    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__INSTALLED=") {
            markers.installed = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__CONFIG_EXISTS=") {
            markers.config_exists = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__ACTIVE=") {
            markers.active = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__ENABLED=") {
            markers.enabled = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__APPLY_MODE=") {
            let parsed = value.trim();
            if !parsed.is_empty() {
                markers.apply_mode = Some(parsed.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__MODE=") {
            let mode = value.trim();
            if !mode.is_empty() {
                markers.mode = Some(mode.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__PROXY_NAME=") {
            let parsed = value.trim();
            if !parsed.is_empty() {
                markers.proxy_name = Some(parsed.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__PROXY_TYPE=") {
            let parsed = value.trim();
            if !parsed.is_empty() {
                markers.proxy_type = Some(parsed.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__PROXY_SERVER=") {
            let parsed = value.trim();
            if !parsed.is_empty() {
                markers.proxy_server = Some(parsed.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__PROXY_PORT=") {
            let parsed = value.trim();
            if let Ok(port) = parsed.parse::<u16>() {
                markers.proxy_port = Some(port);
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_MIHOMO_STATUS__PROXY_CIPHER=") {
            let parsed = value.trim();
            if !parsed.is_empty() {
                markers.proxy_cipher = Some(parsed.to_string());
            }
            continue;
        }
    }
    markers
}

fn parse_runtime_config_markers(stdout: &str) -> RuntimeConfigMarkers {
    let mut markers = RuntimeConfigMarkers::default();
    let mut in_config = false;
    let mut config_lines: Vec<String> = Vec::new();
    let mut plain_lines: Vec<String> = Vec::new();

    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if line == "__CASTOR_PROXY_CONFIG__BEGIN" {
            in_config = true;
            continue;
        }
        if line == "__CASTOR_PROXY_CONFIG__END" {
            in_config = false;
            continue;
        }
        if in_config {
            config_lines.push(raw_line.to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_CONFIG__INSTALLED=") {
            markers.installed = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_CONFIG__CONFIG_EXISTS=") {
            markers.config_exists = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_CONFIG__ACTIVE=") {
            markers.active = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_CONFIG__ENABLED=") {
            markers.enabled = parse_marker_bool(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_CONFIG__PATH=") {
            markers.config_path = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_PROXY_CONFIG__READ_STATUS=") {
            if let Ok(status) = value.trim().parse::<i32>() {
                if status != 0 {
                    markers.read_error = Some(status);
                }
            }
            continue;
        }
        plain_lines.push(raw_line.to_string());
    }

    if !config_lines.is_empty() {
        markers.raw_config = Some(config_lines.join("\n"));
    }
    markers.stdout_without_config = plain_lines.join("\n");
    markers
}

fn build_runtime_config_summary(
    raw_config: &str,
) -> Result<ServerProxyRuntimeConfigSummary, String> {
    let root: Value =
        serde_json::from_str(raw_config).map_err(|err| format!("配置 JSON 解析失败: {err}"))?;
    let inbounds = root
        .get("inbounds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| ServerProxyRuntimeInboundSummary {
                    tag: item
                        .get("tag")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    r#type: item
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string(),
                    listen: item
                        .get("listen")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    listen_port: item
                        .get("listen_port")
                        .and_then(|value| value.as_u64())
                        .and_then(|value| u16::try_from(value).ok()),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let outbounds = root
        .get("outbounds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| ServerProxyRuntimeOutboundSummary {
                    tag: item
                        .get("tag")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    r#type: item
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string(),
                    server: item
                        .get("server")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    server_port: item
                        .get("server_port")
                        .and_then(|value| value.as_u64())
                        .and_then(|value| u16::try_from(value).ok()),
                    method: item
                        .get("method")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let route_final = root
        .get("route")
        .and_then(|value| value.get("final"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let route_rule_count = root
        .get("route")
        .and_then(|value| value.get("rules"))
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    let dns_server_count = root
        .get("dns")
        .and_then(|value| value.get("servers"))
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);

    Ok(ServerProxyRuntimeConfigSummary {
        inbound_count: inbounds.len(),
        outbound_count: outbounds.len(),
        route_final,
        route_rule_count,
        dns_server_count,
        inbounds,
        outbounds,
    })
}

fn parse_marker_bool(value: &str) -> Option<bool> {
    match value.trim() {
        "1" | "true" | "TRUE" | "yes" | "YES" => Some(true),
        "0" | "false" | "FALSE" | "no" | "NO" => Some(false),
        _ => None,
    }
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        "''".to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
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

    authenticate_session(&mut session, &profile.username, &auth)?;
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

fn push_proxy_apply_log(app: &AppHandle, apply_id: &str, level: &str, line: impl Into<String>) {
    let line = line.into();
    let normalized = line.trim();
    if normalized.is_empty() {
        return;
    }
    let _ = app.emit(
        PROXY_APPLY_LOG_EVENT,
        ProxyApplyLogPayload {
            apply_id: apply_id.to_string(),
            level: level.to_string(),
            line: normalized.to_string(),
            timestamp: now_unix(),
        },
    );
}

fn push_mihomo_apply_log(app: &AppHandle, apply_id: &str, level: &str, line: impl Into<String>) {
    let line = line.into();
    let normalized = line.trim();
    if normalized.is_empty() {
        return;
    }
    let _ = app.emit(
        MIHOMO_APPLY_LOG_EVENT,
        ProxyApplyLogPayload {
            apply_id: apply_id.to_string(),
            level: level.to_string(),
            line: normalized.to_string(),
            timestamp: now_unix(),
        },
    );
}

fn ensure_profile_exists(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    let exists = list_connection_profiles(app)?
        .into_iter()
        .any(|item| item.id == profile_id);
    if exists {
        Ok(())
    } else {
        Err(format!("connection profile {} not found", profile_id))
    }
}

fn find_profile(app: &AppHandle, profile_id: &str) -> Result<ConnectionProfile, String> {
    list_connection_profiles(app)?
        .into_iter()
        .find(|item| item.id == profile_id)
        .ok_or_else(|| format!("connection profile {} not found", profile_id))
}

fn find_server_proxy_config_by_id(app: &AppHandle, id: &str) -> Result<ServerProxyConfig, String> {
    load_server_proxy_configs(app)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("server proxy config {} not found", id))
}

fn update_server_proxy_config(app: &AppHandle, config: &ServerProxyConfig) -> Result<(), String> {
    let _lock = server_proxy_store_lock()
        .lock()
        .map_err(|_| "proxy store lock poisoned".to_string())?;
    let mut configs = load_server_proxy_configs(app)?;
    if let Some(existing) = configs.iter_mut().find(|item| item.id == config.id) {
        *existing = config.clone();
        save_server_proxy_configs(app, &configs)
    } else {
        Err(format!("server proxy config {} not found", config.id))
    }
}

fn load_server_proxy_configs(app: &AppHandle) -> Result<Vec<ServerProxyConfig>, String> {
    let path = server_proxy_configs_file_path(app)?;
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.trim().is_empty() {
                return Ok(vec![]);
            }
            serde_json::from_str(&content)
                .map_err(|err| format!("failed to parse server proxy configs: {err}"))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(format!("failed to read server proxy configs: {err}")),
    }
}

fn save_server_proxy_configs(app: &AppHandle, configs: &[ServerProxyConfig]) -> Result<(), String> {
    let path = server_proxy_configs_file_path(app)?;
    let body = serde_json::to_string_pretty(configs)
        .map_err(|err| format!("failed to encode server proxy configs: {err}"))?;
    fs::write(path, body).map_err(|err| format!("failed to write server proxy configs: {err}"))
}

fn server_proxy_configs_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("failed to resolve app config dir: {err}"))?;
    fs::create_dir_all(&config_dir)
        .map_err(|err| format!("failed to initialize app config dir: {err}"))?;
    Ok(config_dir.join("server_proxy_configs.json"))
}

struct RunningProxyApplyGuard {
    apply_id: String,
}

impl RunningProxyApplyGuard {
    fn new(apply_id: String, profile_id: String) -> Result<Self, String> {
        register_running_proxy_apply(&apply_id, &profile_id)?;
        Ok(Self { apply_id })
    }
}

impl Drop for RunningProxyApplyGuard {
    fn drop(&mut self) {
        let _ = remove_running_proxy_apply(&self.apply_id);
    }
}

fn running_proxy_apply_store() -> &'static Mutex<HashMap<String, String>> {
    static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_running_proxy_apply(apply_id: &str, profile_id: &str) -> Result<(), String> {
    let mut store = running_proxy_apply_store()
        .lock()
        .map_err(|_| "proxy apply store lock poisoned".to_string())?;
    store.insert(apply_id.to_string(), profile_id.to_string());
    Ok(())
}

fn remove_running_proxy_apply(apply_id: &str) -> Result<(), String> {
    let mut store = running_proxy_apply_store()
        .lock()
        .map_err(|_| "proxy apply store lock poisoned".to_string())?;
    store.remove(apply_id);
    Ok(())
}

fn resolve_running_proxy_apply_profile_id(apply_id: &str) -> Option<String> {
    let store = running_proxy_apply_store().lock().ok()?;
    store.get(apply_id).cloned()
}

fn default_connectivity_timeout_ms() -> u64 {
    900
}

fn clamp_connectivity_timeout_ms(value: Option<u64>) -> u64 {
    value
        .unwrap_or(default_connectivity_timeout_ms())
        .clamp(200, 3_000)
}

fn is_connectivity_summary_message(message: &str) -> bool {
    message.trim().starts_with("连通性测试完成：")
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn server_proxy_store_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}
