use std::cmp::Ordering;
use std::collections::HashSet;
use std::io::Read;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ssh2::Session;
use tauri::{AppHandle, Emitter};

use crate::profiles::{list_connection_profiles, ConnectionProfile};
use crate::ssh::{authenticate_session, AuthConfig};

const RUNTIME_DEPLOY_LOG_EVENT: &str = "runtime-deploy-log";

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeDeployLanguage {
    Node,
    Java,
    Go,
    Python,
}

#[derive(Debug, Deserialize)]
pub struct RuntimeDeployPlanRequest {
    pub profile_id: String,
    pub language: RuntimeDeployLanguage,
    pub version: String,
    pub set_as_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct RuntimeDeployApplyRequest {
    pub profile_id: String,
    pub language: RuntimeDeployLanguage,
    pub version: String,
    pub set_as_default: Option<bool>,
    pub deploy_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CancelRuntimeDeployRequest {
    pub deploy_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ListRuntimeDeployVersionsRequest {
    pub profile_id: String,
    pub language: RuntimeDeployLanguage,
    pub keyword: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct RuntimeDeployStep {
    pub title: String,
    pub command: String,
}

#[derive(Debug, Serialize)]
pub struct RuntimeDeployPlanResult {
    pub language: RuntimeDeployLanguage,
    pub version: String,
    pub manager: String,
    pub steps: Vec<RuntimeDeployStep>,
}

#[derive(Debug, Serialize)]
pub struct RuntimeDeployApplyResult {
    pub language: RuntimeDeployLanguage,
    pub version: String,
    pub manager: String,
    pub success: bool,
    pub completed_at: u64,
    pub logs: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeDeployLogPayload {
    pub deploy_id: String,
    pub level: String,
    pub line: String,
    pub timestamp: u64,
}

#[derive(Debug, Serialize)]
pub struct RuntimeDeployVersionsResult {
    pub language: RuntimeDeployLanguage,
    pub manager: String,
    pub versions: Vec<RuntimeDeployVersionItem>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeVersionChannel {
    Stable,
    Prerelease,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeDeployVersionItem {
    pub version: String,
    pub channel: RuntimeVersionChannel,
}

pub fn plan_runtime_deploy(
    app: &AppHandle,
    request: RuntimeDeployPlanRequest,
) -> Result<RuntimeDeployPlanResult, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }
    let version = normalize_version(&request.version)?;
    let _profile = find_profile_by_id(app, profile_id)?;

    let set_as_default = request.set_as_default.unwrap_or(true);
    Ok(build_runtime_deploy_plan(
        request.language,
        &version,
        set_as_default,
    ))
}

pub fn apply_runtime_deploy(
    app: &AppHandle,
    request: RuntimeDeployApplyRequest,
) -> Result<RuntimeDeployApplyResult, String> {
    let profile_id = request.profile_id.trim();
    let deploy_id = request.deploy_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }
    if deploy_id.is_empty() {
        return Err("deploy_id is required".to_string());
    }
    let version = normalize_version(&request.version)?;
    let set_as_default = request.set_as_default.unwrap_or(true);
    let plan = build_runtime_deploy_plan(request.language, &version, set_as_default);
    let profile = find_profile_by_id(app, profile_id)?;
    let _cancel_guard = RuntimeDeployCancelGuard::new(deploy_id);

    if is_runtime_deploy_canceled(deploy_id)? {
        let mut logs = Vec::new();
        push_runtime_deploy_log(app, deploy_id, &mut logs, "warn", "runtime deploy canceled");
        return Ok(RuntimeDeployApplyResult {
            language: request.language,
            version,
            manager: plan.manager,
            success: false,
            completed_at: now_unix(),
            logs,
        });
    }

    let mut session = connect_ssh_profile(&profile)?;
    let mut logs = Vec::new();
    push_runtime_deploy_log(
        app,
        deploy_id,
        &mut logs,
        "info",
        format!(
            "deploy target: {}@{}:{}",
            profile.username, profile.host, profile.port
        ),
    );
    push_runtime_deploy_log(
        app,
        deploy_id,
        &mut logs,
        "info",
        format!(
            "language: {:?}, version: {}",
            request.language, plan.version
        ),
    );

    for (index, step) in plan.steps.iter().enumerate() {
        if is_runtime_deploy_canceled(deploy_id)? {
            push_runtime_deploy_log(app, deploy_id, &mut logs, "warn", "runtime deploy canceled");
            return Ok(RuntimeDeployApplyResult {
                language: request.language,
                version: version.clone(),
                manager: plan.manager,
                success: false,
                completed_at: now_unix(),
                logs,
            });
        }

        push_runtime_deploy_log(
            app,
            deploy_id,
            &mut logs,
            "info",
            format!("[{}/{}] {}", index + 1, plan.steps.len(), step.title),
        );
        push_runtime_deploy_log(
            app,
            deploy_id,
            &mut logs,
            "command",
            format!("$ {}", step.command),
        );
        let (stdout, stderr, exit_status) = run_remote_shell_command(&mut session, &step.command)?;
        push_runtime_stream_logs(app, deploy_id, &mut logs, "stdout", &stdout);
        push_runtime_stream_logs(app, deploy_id, &mut logs, "stderr", &stderr);
        push_runtime_deploy_log(
            app,
            deploy_id,
            &mut logs,
            "status",
            format!("exit status: {}", exit_status),
        );

        if exit_status != 0 {
            push_runtime_deploy_log(
                app,
                deploy_id,
                &mut logs,
                "error",
                format!("step failed with exit status {}", exit_status),
            );
            return Ok(RuntimeDeployApplyResult {
                language: request.language,
                version,
                manager: plan.manager,
                success: false,
                completed_at: now_unix(),
                logs,
            });
        }
    }

    push_runtime_deploy_log(
        app,
        deploy_id,
        &mut logs,
        "done",
        "runtime deploy completed",
    );
    Ok(RuntimeDeployApplyResult {
        language: request.language,
        version,
        manager: plan.manager,
        success: true,
        completed_at: now_unix(),
        logs,
    })
}

fn push_runtime_deploy_log(
    app: &AppHandle,
    deploy_id: &str,
    logs: &mut Vec<String>,
    level: &str,
    line: impl Into<String>,
) {
    let line = line.into();
    logs.push(line.clone());
    let _ = app.emit(
        RUNTIME_DEPLOY_LOG_EVENT,
        RuntimeDeployLogPayload {
            deploy_id: deploy_id.to_string(),
            level: level.to_string(),
            line,
            timestamp: now_unix(),
        },
    );
}

fn push_runtime_stream_logs(
    app: &AppHandle,
    deploy_id: &str,
    logs: &mut Vec<String>,
    stream: &str,
    content: &str,
) {
    let normalized_lines = normalize_terminal_stream(content);
    let mut previous = String::new();
    for line in normalized_lines {
        if line == previous {
            continue;
        }
        previous = line.clone();
        push_runtime_deploy_log(
            app,
            deploy_id,
            logs,
            stream,
            format!("[{}] {}", stream, line),
        );
    }
}

fn normalize_terminal_stream(content: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut chars = content.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '\u{1b}' => skip_ansi_escape(&mut chars),
            '\r' => {
                current.clear();
            }
            '\n' => {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    lines.push(trimmed);
                }
                current.clear();
            }
            '\u{8}' => {
                current.pop();
            }
            _ => {
                if ch.is_control() && ch != '\t' {
                    continue;
                }
                current.push(ch);
            }
        }
    }

    let tail = current.trim().to_string();
    if !tail.is_empty() {
        lines.push(tail);
    }

    lines
}

fn skip_ansi_escape(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) {
    match chars.peek().copied() {
        Some('[') => {
            let _ = chars.next();
            while let Some(ch) = chars.next() {
                if ('@'..='~').contains(&ch) {
                    break;
                }
            }
        }
        Some(']') => {
            let _ = chars.next();
            while let Some(ch) = chars.next() {
                if ch == '\u{7}' {
                    break;
                }
                if ch == '\u{1b}' && chars.peek().copied() == Some('\\') {
                    let _ = chars.next();
                    break;
                }
            }
        }
        Some(_) => {
            let _ = chars.next();
        }
        None => {}
    }
}

pub fn cancel_runtime_deploy(request: CancelRuntimeDeployRequest) -> Result<(), String> {
    let deploy_id = request.deploy_id.trim();
    if deploy_id.is_empty() {
        return Err("deploy_id is required".to_string());
    }
    mark_runtime_deploy_canceled(deploy_id)
}

pub fn list_runtime_deploy_versions(
    app: &AppHandle,
    request: ListRuntimeDeployVersionsRequest,
) -> Result<RuntimeDeployVersionsResult, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }

    let profile = find_profile_by_id(app, profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;
    let manager = runtime_manager_name(request.language).to_string();
    let raw_versions = list_runtime_versions_by_language(&mut session, request.language)?;

    let keyword = request.keyword.unwrap_or_default();
    let versions = filter_runtime_versions(raw_versions, &keyword, request.limit);
    if versions.is_empty() {
        return Err("no available versions found".to_string());
    }

    Ok(RuntimeDeployVersionsResult {
        language: request.language,
        manager,
        versions,
    })
}

fn build_runtime_deploy_plan(
    language: RuntimeDeployLanguage,
    version: &str,
    set_as_default: bool,
) -> RuntimeDeployPlanResult {
    let manager = runtime_manager_name(language).to_string();
    let mut steps = base_install_steps(language, version);
    if set_as_default {
        steps.push(default_switch_step(language, version));
    }
    steps.push(verify_step(language));

    RuntimeDeployPlanResult {
        language,
        version: version.to_string(),
        manager,
        steps,
    }
}

fn runtime_manager_name(language: RuntimeDeployLanguage) -> &'static str {
    match language {
        RuntimeDeployLanguage::Node => "nvm",
        RuntimeDeployLanguage::Python => "pyenv",
        RuntimeDeployLanguage::Java => "sdkman",
        RuntimeDeployLanguage::Go => "goenv",
    }
}

fn list_runtime_versions_by_language(
    session: &mut Session,
    language: RuntimeDeployLanguage,
) -> Result<Vec<String>, String> {
    match language {
        RuntimeDeployLanguage::Node => list_node_versions(session),
        RuntimeDeployLanguage::Python => list_python_versions(session),
        RuntimeDeployLanguage::Java => list_java_versions(session),
        RuntimeDeployLanguage::Go => list_go_versions(session),
    }
}

fn list_node_versions(session: &mut Session) -> Result<Vec<String>, String> {
    let command = r#"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  nvm ls-remote --no-colors 2>/dev/null || nvm ls-remote 2>/dev/null
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL https://nodejs.org/dist/index.tab | awk 'NR > 1 {print $1}'
else
  echo "nvm not found and curl is unavailable" >&2
  exit 1
fi
"#;
    let (stdout, stderr, exit_status) = run_remote_shell_command(session, command)?;
    if exit_status != 0 {
        return Err(format!(
            "failed to list node versions: {}",
            first_non_empty_line(&stderr).unwrap_or("unknown error")
        ));
    }
    let mut versions = Vec::new();
    for token in stdout.split_whitespace() {
        let normalized = token.trim().trim_start_matches('v');
        if is_numeric_dot_version(normalized) {
            versions.push(normalized.to_string());
        }
    }
    versions.reverse();
    Ok(versions)
}

fn list_python_versions(session: &mut Session) -> Result<Vec<String>, String> {
    let command = r#"
if [ -d "$HOME/.pyenv" ]; then
  export PYENV_ROOT="$HOME/.pyenv"
  export PATH="$PYENV_ROOT/bin:$PATH"
  eval "$(pyenv init -)" >/dev/null 2>&1 || true
  pyenv install --list
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL https://www.python.org/ftp/python/ | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+/' | tr -d '/'
else
  echo "pyenv not found and curl is unavailable" >&2
  exit 1
fi
"#;
    let (stdout, stderr, exit_status) = run_remote_shell_command(session, command)?;
    if exit_status != 0 {
        return Err(format!(
            "failed to list python versions: {}",
            first_non_empty_line(&stderr).unwrap_or("unknown error")
        ));
    }
    let mut versions = Vec::new();
    for line in stdout.lines() {
        let token = line.trim();
        if is_numeric_dot_version(token) {
            versions.push(token.to_string());
        }
    }
    versions.reverse();
    Ok(versions)
}

fn list_java_versions(session: &mut Session) -> Result<Vec<String>, String> {
    let command = r#"
if [ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]; then
  source "$HOME/.sdkman/bin/sdkman-init.sh"
  sdk list java
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL "https://api.sdkman.io/2/candidates/java/linuxx64/versions/list?installed="
else
  echo "sdkman not found and curl is unavailable" >&2
  exit 1
fi
"#;
    let (stdout, stderr, exit_status) = run_remote_shell_command(session, command)?;
    if exit_status != 0 {
        return Err(format!(
            "failed to list java versions: {}",
            first_non_empty_line(&stderr).unwrap_or("unknown error")
        ));
    }
    let mut versions = Vec::new();
    for token in stdout.split_whitespace() {
        let trimmed = token.trim();
        if is_sdkman_java_version(trimmed) {
            versions.push(trimmed.to_string());
        }
    }
    Ok(versions)
}

fn list_go_versions(session: &mut Session) -> Result<Vec<String>, String> {
    let command = r#"
if [ -d "$HOME/.goenv" ]; then
  export GOENV_ROOT="$HOME/.goenv"
  export PATH="$GOENV_ROOT/bin:$PATH"
  eval "$(goenv init -)" >/dev/null 2>&1 || true
  goenv install -l
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL "https://go.dev/dl/?mode=json" | grep -Eo '"version":"go[0-9]+\.[0-9]+(\.[0-9]+)?"' | sed -E 's/.*go([^"]+)".*/\1/'
else
  echo "goenv not found and curl is unavailable" >&2
  exit 1
fi
"#;
    let (stdout, stderr, exit_status) = run_remote_shell_command(session, command)?;
    if exit_status != 0 {
        return Err(format!(
            "failed to list go versions: {}",
            first_non_empty_line(&stderr).unwrap_or("unknown error")
        ));
    }
    let mut versions = Vec::new();
    for line in stdout.lines() {
        let token = line.trim().trim_start_matches("go");
        if is_numeric_dot_version(token) {
            versions.push(token.to_string());
        }
    }
    versions.reverse();
    Ok(versions)
}

fn filter_runtime_versions(
    versions: Vec<String>,
    keyword: &str,
    limit: Option<usize>,
) -> Vec<RuntimeDeployVersionItem> {
    let mut versions = versions
        .into_iter()
        .map(|version| RuntimeDeployVersionItem {
            channel: detect_runtime_version_channel(&version),
            version,
        })
        .collect::<Vec<_>>();

    let mut dedup = HashSet::new();
    versions.retain(|item| dedup.insert(item.version.clone()));

    let normalized_keyword = keyword.trim().to_lowercase();
    if !normalized_keyword.is_empty() {
        versions.retain(|item| item.version.to_lowercase().contains(&normalized_keyword));
    }

    versions.sort_by(compare_runtime_version_desc);

    let capped = limit.unwrap_or(20).clamp(1, 20);
    if versions.len() > capped {
        versions.truncate(capped);
    }
    versions
}

fn compare_runtime_version_desc(
    left: &RuntimeDeployVersionItem,
    right: &RuntimeDeployVersionItem,
) -> Ordering {
    let left_key = parse_version_sort_key(&left.version);
    let right_key = parse_version_sort_key(&right.version);
    let channel_cmp =
        runtime_channel_priority(right.channel).cmp(&runtime_channel_priority(left.channel));
    compare_version_segments_desc(&left_key.numbers, &right_key.numbers)
        .then(channel_cmp)
        .then_with(|| right_key.suffix.cmp(&left_key.suffix))
        .then_with(|| right.version.cmp(&left.version))
}

fn compare_version_segments_desc(left: &[u32], right: &[u32]) -> Ordering {
    let max_len = left.len().max(right.len());
    for index in 0..max_len {
        let lv = *left.get(index).unwrap_or(&0);
        let rv = *right.get(index).unwrap_or(&0);
        let cmp = rv.cmp(&lv);
        if cmp != Ordering::Equal {
            return cmp;
        }
    }
    Ordering::Equal
}

struct VersionSortKey {
    numbers: Vec<u32>,
    suffix: String,
}

fn parse_version_sort_key(source: &str) -> VersionSortKey {
    let trimmed = source
        .trim()
        .trim_start_matches('v')
        .trim_start_matches("go");
    let (numbers_part, suffix_part) = match trimmed.split_once('-') {
        Some((numbers, suffix)) => (numbers, suffix),
        None => (trimmed, ""),
    };

    let numbers = numbers_part
        .split('.')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u32>().ok())
        .collect::<Vec<_>>();

    VersionSortKey {
        numbers,
        suffix: suffix_part.trim().to_lowercase(),
    }
}

fn runtime_channel_priority(channel: RuntimeVersionChannel) -> u8 {
    match channel {
        RuntimeVersionChannel::Stable => 3,
        RuntimeVersionChannel::Prerelease => 2,
        RuntimeVersionChannel::Unknown => 1,
    }
}

fn detect_runtime_version_channel(version: &str) -> RuntimeVersionChannel {
    let normalized = version.to_lowercase();
    let unstable_keywords = [
        "alpha", "beta", "rc", "snapshot", "nightly", "preview", "ea", "dev",
    ];
    if unstable_keywords
        .iter()
        .any(|keyword| normalized.contains(keyword))
    {
        return RuntimeVersionChannel::Prerelease;
    }

    let mut has_digit = false;
    for ch in normalized.chars() {
        if ch.is_ascii_digit() {
            has_digit = true;
            continue;
        }
        if ch == '.' || ch == '-' || ch == '_' {
            continue;
        }
        if ('a'..='z').contains(&ch) {
            continue;
        }
        return RuntimeVersionChannel::Unknown;
    }

    if has_digit {
        RuntimeVersionChannel::Stable
    } else {
        RuntimeVersionChannel::Unknown
    }
}

fn is_numeric_dot_version(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let mut dot_count = 0usize;
    for ch in value.chars() {
        if ch == '.' {
            dot_count += 1;
            continue;
        }
        if !ch.is_ascii_digit() {
            return false;
        }
    }
    dot_count >= 1
}

fn is_sdkman_java_version(value: &str) -> bool {
    if !value.contains('-') {
        return false;
    }
    let mut parts = value.splitn(2, '-');
    let number = parts.next().unwrap_or_default();
    let vendor = parts.next().unwrap_or_default();
    !vendor.is_empty() && is_numeric_dot_version(number)
}

fn base_install_steps(language: RuntimeDeployLanguage, version: &str) -> Vec<RuntimeDeployStep> {
    let quoted_version = shell_quote(version);
    match language {
        RuntimeDeployLanguage::Node => vec![
            RuntimeDeployStep {
                title: "安装 nvm（若缺失）".to_string(),
                command: r#"export NVM_DIR="$HOME/.nvm"; if [ ! -s "$NVM_DIR/nvm.sh" ]; then curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash; fi"#.to_string(),
            },
            RuntimeDeployStep {
                title: format!("安装 Node {}", version),
                command: format!(
                    r#"export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install {quoted_version}"#
                ),
            },
        ],
        RuntimeDeployLanguage::Python => vec![
            RuntimeDeployStep {
                title: "安装 pyenv（若缺失）".to_string(),
                command: r#"if [ ! -d "$HOME/.pyenv" ]; then curl -fsSL https://pyenv.run | bash; fi"#.to_string(),
            },
            RuntimeDeployStep {
                title: format!("安装 Python {}", version),
                command: format!(
                    r#"export PYENV_ROOT="$HOME/.pyenv"; export PATH="$PYENV_ROOT/bin:$PATH"; eval "$(pyenv init -)"; pyenv install -s {quoted_version}"#
                ),
            },
        ],
        RuntimeDeployLanguage::Java => vec![
            RuntimeDeployStep {
                title: "安装 sdkman（若缺失）".to_string(),
                command: r#"if [ ! -s "$HOME/.sdkman/bin/sdkman-init.sh" ]; then curl -fsSL https://get.sdkman.io | bash; fi"#.to_string(),
            },
            RuntimeDeployStep {
                title: format!("安装 Java {}", version),
                command: format!(
                    r#"source "$HOME/.sdkman/bin/sdkman-init.sh"; sdk install java {quoted_version} || sdk use java {quoted_version}"#
                ),
            },
        ],
        RuntimeDeployLanguage::Go => vec![
            RuntimeDeployStep {
                title: "安装 goenv（若缺失）".to_string(),
                command: r#"if [ ! -d "$HOME/.goenv" ]; then git clone https://github.com/go-nv/goenv.git "$HOME/.goenv"; fi"#.to_string(),
            },
            RuntimeDeployStep {
                title: format!("安装 Go {}", version),
                command: format!(
                    r#"export GOENV_ROOT="$HOME/.goenv"; export PATH="$GOENV_ROOT/bin:$PATH"; eval "$(goenv init -)"; goenv install -s {quoted_version}"#
                ),
            },
        ],
    }
}

fn default_switch_step(language: RuntimeDeployLanguage, version: &str) -> RuntimeDeployStep {
    let quoted_version = shell_quote(version);
    match language {
        RuntimeDeployLanguage::Node => RuntimeDeployStep {
            title: "设置 Node 默认版本".to_string(),
            command: format!(
                r#"export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm alias default {quoted_version}; nvm use {quoted_version}"#
            ),
        },
        RuntimeDeployLanguage::Python => RuntimeDeployStep {
            title: "设置 Python 全局版本".to_string(),
            command: format!(
                r#"export PYENV_ROOT="$HOME/.pyenv"; export PATH="$PYENV_ROOT/bin:$PATH"; eval "$(pyenv init -)"; pyenv global {quoted_version}"#
            ),
        },
        RuntimeDeployLanguage::Java => RuntimeDeployStep {
            title: "设置 Java 默认版本".to_string(),
            command: format!(
                r#"source "$HOME/.sdkman/bin/sdkman-init.sh"; sdk default java {quoted_version}"#
            ),
        },
        RuntimeDeployLanguage::Go => RuntimeDeployStep {
            title: "设置 Go 全局版本".to_string(),
            command: format!(
                r#"export GOENV_ROOT="$HOME/.goenv"; export PATH="$GOENV_ROOT/bin:$PATH"; eval "$(goenv init -)"; goenv global {quoted_version}"#
            ),
        },
    }
}

fn verify_step(language: RuntimeDeployLanguage) -> RuntimeDeployStep {
    match language {
        RuntimeDeployLanguage::Node => RuntimeDeployStep {
            title: "验证 Node".to_string(),
            command: r#"export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node -v; command -v node"#.to_string(),
        },
        RuntimeDeployLanguage::Python => RuntimeDeployStep {
            title: "验证 Python".to_string(),
            command: r#"export PYENV_ROOT="$HOME/.pyenv"; export PATH="$PYENV_ROOT/bin:$PATH"; eval "$(pyenv init -)"; python --version || python3 --version; command -v python || command -v python3"#.to_string(),
        },
        RuntimeDeployLanguage::Java => RuntimeDeployStep {
            title: "验证 Java".to_string(),
            command: r#"source "$HOME/.sdkman/bin/sdkman-init.sh"; java -version"#.to_string(),
        },
        RuntimeDeployLanguage::Go => RuntimeDeployStep {
            title: "验证 Go".to_string(),
            command: r#"export GOENV_ROOT="$HOME/.goenv"; export PATH="$GOENV_ROOT/bin:$PATH"; eval "$(goenv init -)"; go version; command -v go"#.to_string(),
        },
    }
}

fn normalize_version(version: &str) -> Result<String, String> {
    let normalized = version.trim();
    if normalized.is_empty() {
        return Err("version is required".to_string());
    }
    if normalized.contains('\n') || normalized.contains('\r') {
        return Err("version contains invalid newline characters".to_string());
    }
    Ok(normalized.to_string())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn first_non_empty_line(source: &str) -> Option<&str> {
    source.lines().map(str::trim).find(|line| !line.is_empty())
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
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(20)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(20)));

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

fn resolve_first_socket_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    let mut addrs = (host, port)
        .to_socket_addrs()
        .map_err(|err| format!("failed to resolve {host}:{port}: {err}"))?;
    addrs
        .next()
        .ok_or_else(|| format!("no socket address resolved for {host}:{port}"))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn run_remote_shell_command(
    session: &mut Session,
    command: &str,
) -> Result<(String, String, i32), String> {
    let script = format!(
        "set -e\nexport TERM=dumb\nexport NO_COLOR=1\nexport CI=1\n{}",
        command
    );
    let wrapped = format!("bash -lc {}", shell_quote(&script));
    run_remote_command(session, &wrapped)
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

fn runtime_deploy_canceled_set() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mark_runtime_deploy_canceled(deploy_id: &str) -> Result<(), String> {
    let mut set = runtime_deploy_canceled_set()
        .lock()
        .map_err(|_| "runtime deploy cancel set lock poisoned".to_string())?;
    set.insert(deploy_id.to_string());
    Ok(())
}

fn unmark_runtime_deploy_canceled(deploy_id: &str) -> Result<(), String> {
    let mut set = runtime_deploy_canceled_set()
        .lock()
        .map_err(|_| "runtime deploy cancel set lock poisoned".to_string())?;
    set.remove(deploy_id);
    Ok(())
}

fn is_runtime_deploy_canceled(deploy_id: &str) -> Result<bool, String> {
    let set = runtime_deploy_canceled_set()
        .lock()
        .map_err(|_| "runtime deploy cancel set lock poisoned".to_string())?;
    Ok(set.contains(deploy_id))
}

struct RuntimeDeployCancelGuard {
    deploy_id: String,
}

impl RuntimeDeployCancelGuard {
    fn new(deploy_id: &str) -> Self {
        let _ = unmark_runtime_deploy_canceled(deploy_id);
        Self {
            deploy_id: deploy_id.to_string(),
        }
    }
}

impl Drop for RuntimeDeployCancelGuard {
    fn drop(&mut self) {
        let _ = unmark_runtime_deploy_canceled(&self.deploy_id);
    }
}
