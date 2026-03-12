use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE};
use base64::Engine;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ssh2::Session;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::profiles::{list_connection_profiles, ConnectionProfile};
use crate::ssh::AuthConfig;

const DEFAULT_PROXY_MIXED_PORT: u16 = 7890;

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
    pub profile_id: Option<String>,
    pub use_sudo: Option<bool>,
    pub local_mixed_port: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub struct GetServerProxyRuntimeStatusRequest {
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
    let node = config
        .nodes
        .iter()
        .find(|item| item.id == node_id)
        .cloned()
        .ok_or_else(|| format!("proxy node {} not found", node_id))?;

    if !node.supported {
        config.status = "failed".to_string();
        config.last_error = node.unsupported_reason.clone();
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
    let local_mixed_port = request
        .local_mixed_port
        .unwrap_or(DEFAULT_PROXY_MIXED_PORT)
        .clamp(1024, 65535);
    let script = build_apply_proxy_script(&node, use_sudo, local_mixed_port)?;
    let (stdout, stderr, exit_status) = run_remote_script(&mut session, &script)?;

    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        config.status = "failed".to_string();
        config.last_error = Some(format!(
            "apply proxy failed (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
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
    config.local_http_proxy = Some(format!("http://127.0.0.1:{local_mixed_port}"));
    config.local_socks_proxy = Some(format!("socks5://127.0.0.1:{local_mixed_port}"));
    config.status = "active".to_string();
    config.last_error = None;
    config.updated_at = now_unix();
    update_server_proxy_config(app, &config)?;

    Ok(ServerProxyApplyResult {
        config,
        success: true,
        stdout,
        stderr,
        exit_status,
        message: format!(
            "代理节点已应用，远程本地代理地址：http://127.0.0.1:{local_mixed_port} / socks5://127.0.0.1:{local_mixed_port}"
        ),
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

fn build_apply_proxy_script(
    node: &ProxyNode,
    use_sudo: bool,
    local_mixed_port: u16,
) -> Result<String, String> {
    let config_json = serde_json::to_string_pretty(&json!({
        "log": {
            "level": "warn",
            "timestamp": true
        },
        "inbounds": [
            {
                "type": "mixed",
                "tag": "mixed-in",
                "listen": "127.0.0.1",
                "listen_port": local_mixed_port
            }
        ],
        "outbounds": [
            {
                "type": "shadowsocks",
                "tag": "proxy",
                "server": node.server,
                "server_port": node.port,
                "method": node.method,
                "password": node.password
            },
            {
                "type": "direct",
                "tag": "direct"
            }
        ],
        "route": {
            "auto_detect_interface": true,
            "final": "proxy"
        }
    }))
    .map_err(|err| format!("failed to build sing-box config json: {err}"))?;

    let unit_content = r#"[Unit]
Description=Castor Proxy (sing-box)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sing-box run -c /etc/castor/proxy/config.json
Restart=always
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
"#;

    let mut script = String::new();
    script.push_str("set -e\n");
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
    script.push_str("  if command -v curl >/dev/null 2>&1; then\n");
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
    script.push_str(unit_content);
    script.push_str("CASTOR_PROXY_UNIT_EOF\n");
    script.push_str(
        "run_as_root install -m 0644 \"$TMP_UNIT\" /etc/systemd/system/castor-proxy.service\n",
    );
    script.push_str("rm -f \"$TMP_UNIT\"\n");
    script.push_str("run_as_root systemctl daemon-reload\n");
    script.push_str("run_as_root systemctl enable castor-proxy.service >/dev/null 2>&1 || true\n");
    script.push_str("run_as_root systemctl restart castor-proxy.service\n");
    script.push_str("run_as_root systemctl is-active castor-proxy.service\n");
    script.push_str(&format!(
        "echo \"__CASTOR_PROXY_HTTP=http://127.0.0.1:{}\"\n",
        local_mixed_port
    ));
    script.push_str(&format!(
        "echo \"__CASTOR_PROXY_SOCKS=socks5://127.0.0.1:{}\"\n",
        local_mixed_port
    ));
    Ok(script)
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

#[derive(Default)]
struct RuntimeStatusMarkers {
    installed: Option<bool>,
    active: Option<bool>,
    enabled: Option<bool>,
    config_exists: Option<bool>,
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

fn parse_marker_bool(value: &str) -> Option<bool> {
    match value.trim() {
        "1" | "true" | "TRUE" | "yes" | "YES" => Some(true),
        "0" | "false" | "FALSE" | "no" | "NO" => Some(false),
        _ => None,
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
