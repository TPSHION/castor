use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ssh2::Session;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::profiles::{list_connection_profiles, ConnectionProfile};
use crate::ssh::AuthConfig;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SslChallengeType {
    Http,
    Dns,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SslCertificateStatus {
    Pending,
    Active,
    Expiring,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SslDnsEnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SslCertificate {
    pub id: String,
    pub profile_id: String,
    pub domain: String,
    pub email: Option<String>,
    pub challenge_type: SslChallengeType,
    pub webroot_path: Option<String>,
    pub dns_provider: Option<String>,
    pub dns_env: Vec<SslDnsEnvVar>,
    pub key_file: String,
    pub fullchain_file: String,
    pub reload_command: Option<String>,
    pub auto_renew_enabled: bool,
    pub renew_before_days: u16,
    pub renew_at: String,
    pub status: SslCertificateStatus,
    pub issuer: Option<String>,
    pub not_before: Option<String>,
    pub not_after: Option<String>,
    pub last_error: Option<String>,
    pub last_operation_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct ListSslCertificatesRequest {
    pub profile_id: String,
}

#[derive(Debug, Deserialize)]
pub struct UpsertSslCertificateRequest {
    pub id: Option<String>,
    pub profile_id: String,
    pub domain: String,
    pub email: Option<String>,
    pub challenge_type: SslChallengeType,
    pub webroot_path: Option<String>,
    pub dns_provider: Option<String>,
    pub dns_env: Option<Vec<SslDnsEnvVar>>,
    pub key_file: String,
    pub fullchain_file: String,
    pub reload_command: Option<String>,
    pub auto_renew_enabled: Option<bool>,
    pub renew_before_days: Option<u16>,
    pub renew_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteSslCertificateRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct ApplySslCertificateRequest {
    pub id: String,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct RenewSslCertificateRequest {
    pub id: String,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SyncSslCertificateStatusRequest {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub struct SslCertificateOperationResult {
    pub certificate: SslCertificate,
    pub operation: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_status: i32,
    pub message: String,
}

pub fn list_ssl_certificates(
    app: &AppHandle,
    request: ListSslCertificatesRequest,
) -> Result<Vec<SslCertificate>, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }

    ensure_profile_exists(app, profile_id)?;

    let mut certificates: Vec<SslCertificate> = load_ssl_certificates(app)?
        .into_iter()
        .filter(|item| item.profile_id == profile_id)
        .collect();
    certificates.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(certificates)
}

pub fn upsert_ssl_certificate(
    app: &AppHandle,
    request: UpsertSslCertificateRequest,
) -> Result<SslCertificate, String> {
    validate_upsert_request(app, &request)?;

    let _lock = ssl_certificates_store_lock()
        .lock()
        .map_err(|_| "ssl certificates store lock poisoned".to_string())?;
    let mut certificates = load_ssl_certificates(app)?;

    let now = now_unix();
    let profile_id = request.profile_id.trim().to_string();
    let domain = request.domain.trim().to_lowercase();
    let email = sanitize_optional(request.email);
    let webroot_path = sanitize_optional(request.webroot_path);
    let dns_provider = sanitize_optional(request.dns_provider);
    let key_file = request.key_file.trim().to_string();
    let fullchain_file = request.fullchain_file.trim().to_string();
    let reload_command = sanitize_optional(request.reload_command);
    let auto_renew_enabled = request.auto_renew_enabled.unwrap_or(true);
    let renew_before_days = request.renew_before_days.unwrap_or(30).clamp(1, 90);
    let renew_at = normalize_renew_at(request.renew_at.as_deref().unwrap_or("03:00"))?;
    let dns_env = sanitize_dns_env(request.dns_env.unwrap_or_default())?;

    ensure_unique_domain(&certificates, &profile_id, &domain, request.id.as_deref())?;

    let certificate = if let Some(id) = request.id {
        if let Some(existing) = certificates.iter_mut().find(|item| item.id == id) {
            existing.profile_id = profile_id;
            existing.domain = domain;
            existing.email = email;
            existing.challenge_type = request.challenge_type;
            existing.webroot_path = webroot_path;
            existing.dns_provider = dns_provider;
            existing.dns_env = dns_env;
            existing.key_file = key_file;
            existing.fullchain_file = fullchain_file;
            existing.reload_command = reload_command;
            existing.auto_renew_enabled = auto_renew_enabled;
            existing.renew_before_days = renew_before_days;
            existing.renew_at = renew_at;
            existing.updated_at = now;
            existing.clone()
        } else {
            return Err(format!("ssl certificate {} not found", id));
        }
    } else {
        let certificate = SslCertificate {
            id: Uuid::new_v4().to_string(),
            profile_id,
            domain,
            email,
            challenge_type: request.challenge_type,
            webroot_path,
            dns_provider,
            dns_env,
            key_file,
            fullchain_file,
            reload_command,
            auto_renew_enabled,
            renew_before_days,
            renew_at,
            status: SslCertificateStatus::Pending,
            issuer: None,
            not_before: None,
            not_after: None,
            last_error: None,
            last_operation_at: None,
            created_at: now,
            updated_at: now,
        };
        certificates.push(certificate.clone());
        certificate
    };

    save_ssl_certificates(app, &certificates)?;
    Ok(certificate)
}

pub fn delete_ssl_certificate(
    app: &AppHandle,
    request: DeleteSslCertificateRequest,
) -> Result<(), String> {
    let id = request.id.trim();
    if id.is_empty() {
        return Err("id is required".to_string());
    }

    let _lock = ssl_certificates_store_lock()
        .lock()
        .map_err(|_| "ssl certificates store lock poisoned".to_string())?;
    let mut certificates = load_ssl_certificates(app)?;
    let before = certificates.len();
    certificates.retain(|item| item.id != id);

    if certificates.len() == before {
        return Err(format!("ssl certificate {} not found", id));
    }

    save_ssl_certificates(app, &certificates)
}

pub fn apply_ssl_certificate(
    app: &AppHandle,
    request: ApplySslCertificateRequest,
) -> Result<SslCertificateOperationResult, String> {
    execute_ssl_certificate_operation(
        app,
        request.id.as_str(),
        "issue",
        request.force.unwrap_or(false),
    )
}

pub fn renew_ssl_certificate(
    app: &AppHandle,
    request: RenewSslCertificateRequest,
) -> Result<SslCertificateOperationResult, String> {
    execute_ssl_certificate_operation(
        app,
        request.id.as_str(),
        "renew",
        request.force.unwrap_or(false),
    )
}

pub fn sync_ssl_certificate_status(
    app: &AppHandle,
    request: SyncSslCertificateStatusRequest,
) -> Result<SslCertificate, String> {
    let cert_id = request.id.trim();
    if cert_id.is_empty() {
        return Err("id is required".to_string());
    }

    let certificate = find_ssl_certificate_by_id(app, cert_id)?;
    let profile = find_profile(app, &certificate.profile_id)?;
    let mut session = connect_ssh_profile(&profile)?;

    let script = build_certificate_metadata_script(&certificate);
    let (stdout, stderr, exit_status) = run_remote_script(&mut session, &script)?;
    if exit_status != 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "failed to sync certificate metadata (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail
            }
        ));
    }

    let metadata = parse_certificate_metadata(&stdout, certificate.renew_before_days);
    let mut updated = certificate.clone();
    updated.issuer = metadata.issuer;
    updated.not_before = metadata.not_before;
    updated.not_after = metadata.not_after;
    updated.last_error = None;
    updated.status = if metadata.expiring {
        SslCertificateStatus::Expiring
    } else {
        SslCertificateStatus::Active
    };
    updated.last_operation_at = Some(now_unix());
    updated.updated_at = now_unix();

    update_ssl_certificate(app, &updated)?;
    Ok(updated)
}

fn execute_ssl_certificate_operation(
    app: &AppHandle,
    cert_id: &str,
    operation: &str,
    force: bool,
) -> Result<SslCertificateOperationResult, String> {
    let cert_id = cert_id.trim();
    if cert_id.is_empty() {
        return Err("id is required".to_string());
    }

    let mut certificate = find_ssl_certificate_by_id(app, cert_id)?;
    let profile = find_profile(app, &certificate.profile_id)?;

    certificate.status = SslCertificateStatus::Pending;
    certificate.last_error = None;
    certificate.updated_at = now_unix();
    update_ssl_certificate(app, &certificate)?;

    let mut session = connect_ssh_profile(&profile)?;
    let script = build_operation_script(&certificate, operation, force)?;
    let (stdout, stderr, exit_status) = run_remote_script(&mut session, &script)?;

    if exit_status != 0 {
        let detail = pick_error_detail(&stdout, &stderr);
        certificate.status = SslCertificateStatus::Failed;
        certificate.last_error = Some(format!(
            "{operation} failed (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail.as_str()
            }
        ));
        certificate.last_operation_at = Some(now_unix());
        certificate.updated_at = now_unix();
        update_ssl_certificate(app, &certificate)?;

        return Ok(SslCertificateOperationResult {
            certificate,
            operation: operation.to_string(),
            success: false,
            stdout,
            stderr,
            exit_status,
            message: format!(
                "证书{op_name}失败，请检查输出日志。",
                op_name = operation_label(operation)
            ),
        });
    }

    let auto_renew_error = if certificate.auto_renew_enabled {
        configure_auto_renew_cron(&mut session, &certificate).err()
    } else {
        remove_auto_renew_cron(&mut session, &certificate.id).err()
    };

    if let Some(schedule_error) = auto_renew_error {
        certificate.status = SslCertificateStatus::Failed;
        certificate.last_error = Some(schedule_error.clone());
        certificate.last_operation_at = Some(now_unix());
        certificate.updated_at = now_unix();
        update_ssl_certificate(app, &certificate)?;

        return Ok(SslCertificateOperationResult {
            certificate,
            operation: operation.to_string(),
            success: false,
            stdout,
            stderr,
            exit_status,
            message: format!(
                "证书{op_name}成功，但自动续期配置失败：{schedule_error}",
                op_name = operation_label(operation)
            ),
        });
    }

    let metadata = parse_certificate_metadata(&stdout, certificate.renew_before_days);
    certificate.issuer = metadata.issuer;
    certificate.not_before = metadata.not_before;
    certificate.not_after = metadata.not_after;
    certificate.status = if metadata.expiring {
        SslCertificateStatus::Expiring
    } else {
        SslCertificateStatus::Active
    };
    certificate.last_error = None;
    certificate.last_operation_at = Some(now_unix());
    certificate.updated_at = now_unix();
    update_ssl_certificate(app, &certificate)?;

    Ok(SslCertificateOperationResult {
        certificate,
        operation: operation.to_string(),
        success: true,
        stdout,
        stderr,
        exit_status,
        message: format!("证书{op_name}完成。", op_name = operation_label(operation)),
    })
}

fn operation_label(operation: &str) -> &'static str {
    if operation == "renew" {
        "续期"
    } else {
        "申请"
    }
}

fn build_operation_script(
    certificate: &SslCertificate,
    operation: &str,
    force: bool,
) -> Result<String, String> {
    let mut script = String::new();
    script.push_str("set -e\n");
    script.push_str("export HOME=\"${HOME:-/root}\"\n");
    script.push_str("ACME_HOME=\"$HOME/.acme.sh\"\n");
    script.push_str("ACME_SH=\"$ACME_HOME/acme.sh\"\n");
    script.push_str("\n");

    script.push_str("if [ ! -x \"$ACME_SH\" ]; then\n");
    script.push_str("  if command -v curl >/dev/null 2>&1; then\n");
    script.push_str("    curl -fsSL https://get.acme.sh | sh\n");
    script.push_str("  elif command -v wget >/dev/null 2>&1; then\n");
    script.push_str("    wget -qO- https://get.acme.sh | sh\n");
    script.push_str("  else\n");
    script.push_str("    echo \"curl/wget is required to install acme.sh\" >&2\n");
    script.push_str("    exit 71\n");
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script.push_str("\n");

    script.push_str("if [ ! -x \"$ACME_SH\" ]; then\n");
    script.push_str("  echo \"acme.sh is not available\" >&2\n");
    script.push_str("  exit 72\n");
    script.push_str("fi\n");
    script.push_str("\n");

    script.push_str("\"$ACME_SH\" --set-default-ca --server letsencrypt >/dev/null 2>&1 || true\n");

    if let Some(email) = &certificate.email {
        script.push_str(&format!(
            "\"$ACME_SH\" --register-account -m {} --server letsencrypt >/dev/null 2>&1 || true\n",
            shell_quote(email)
        ));
    }

    script.push_str(&format!(
        "CASTOR_DOMAIN={}\n",
        shell_quote(&certificate.domain)
    ));
    script.push_str(&format!(
        "CASTOR_RENEW_BEFORE_DAYS={}\n",
        certificate.renew_before_days
    ));
    script.push_str(&format!(
        "CASTOR_KEY_FILE={}\n",
        shell_quote(&certificate.key_file)
    ));
    script.push_str(&format!(
        "CASTOR_FULLCHAIN_FILE={}\n",
        shell_quote(&certificate.fullchain_file)
    ));
    script.push_str(&format!(
        "CASTOR_CHALLENGE={}\n",
        shell_quote(match certificate.challenge_type {
            SslChallengeType::Http => "http",
            SslChallengeType::Dns => "dns",
        })
    ));
    script.push_str(&format!("CASTOR_FORCE={}\n", if force { "1" } else { "0" }));

    if let Some(webroot) = &certificate.webroot_path {
        script.push_str(&format!("CASTOR_WEBROOT={}\n", shell_quote(webroot)));
    }
    if let Some(provider) = &certificate.dns_provider {
        script.push_str(&format!("CASTOR_DNS_PROVIDER={}\n", shell_quote(provider)));
    }

    for env in &certificate.dns_env {
        script.push_str(&format!("export {}={}\n", env.key, shell_quote(&env.value)));
    }

    script.push_str("FORCE_FLAG=\"\"\n");
    script.push_str("if [ \"$CASTOR_FORCE\" = \"1\" ]; then FORCE_FLAG=\"--force\"; fi\n");
    script.push_str("\n");

    if operation == "renew" {
        script.push_str("\"$ACME_SH\" --renew -d \"$CASTOR_DOMAIN\" --server letsencrypt --days \"$CASTOR_RENEW_BEFORE_DAYS\" $FORCE_FLAG\n");
    } else {
        match certificate.challenge_type {
            SslChallengeType::Http => {
                if certificate
                    .webroot_path
                    .as_deref()
                    .map(str::trim)
                    .is_none_or(str::is_empty)
                {
                    return Err("webroot_path is required for HTTP challenge".to_string());
                }
                script.push_str("\"$ACME_SH\" --issue -d \"$CASTOR_DOMAIN\" --webroot \"$CASTOR_WEBROOT\" --server letsencrypt $FORCE_FLAG\n");
            }
            SslChallengeType::Dns => {
                if certificate
                    .dns_provider
                    .as_deref()
                    .map(str::trim)
                    .is_none_or(str::is_empty)
                {
                    return Err("dns_provider is required for DNS challenge".to_string());
                }
                script.push_str("\"$ACME_SH\" --issue -d \"$CASTOR_DOMAIN\" --dns \"$CASTOR_DNS_PROVIDER\" --server letsencrypt $FORCE_FLAG\n");
            }
        }
    }

    script.push_str("mkdir -p \"$(dirname -- \"$CASTOR_KEY_FILE\")\" \"$(dirname -- \"$CASTOR_FULLCHAIN_FILE\")\"\n");

    if let Some(reload_cmd) = &certificate.reload_command {
        script.push_str(&format!(
            "\"$ACME_SH\" --install-cert -d \"$CASTOR_DOMAIN\" --key-file \"$CASTOR_KEY_FILE\" --fullchain-file \"$CASTOR_FULLCHAIN_FILE\" --reloadcmd {}\n",
            shell_quote(reload_cmd)
        ));
    } else {
        script.push_str("\"$ACME_SH\" --install-cert -d \"$CASTOR_DOMAIN\" --key-file \"$CASTOR_KEY_FILE\" --fullchain-file \"$CASTOR_FULLCHAIN_FILE\"\n");
    }

    script.push_str("echo \"__CASTOR_METADATA_BEGIN__\"\n");
    script.push_str("if command -v openssl >/dev/null 2>&1; then\n");
    script.push_str("  openssl x509 -in \"$CASTOR_FULLCHAIN_FILE\" -noout -issuer -startdate -enddate 2>/dev/null || true\n");
    script.push_str("  if openssl x509 -in \"$CASTOR_FULLCHAIN_FILE\" -checkend \"$((CASTOR_RENEW_BEFORE_DAYS * 86400))\" -noout >/dev/null 2>&1; then\n");
    script.push_str("    echo \"__CASTOR_EXPIRING=0\"\n");
    script.push_str("  else\n");
    script.push_str("    echo \"__CASTOR_EXPIRING=1\"\n");
    script.push_str("  fi\n");
    script.push_str("fi\n");
    script.push_str("echo \"__CASTOR_METADATA_END__\"\n");

    Ok(script)
}

fn build_certificate_metadata_script(certificate: &SslCertificate) -> String {
    format!(
        r#"set -e
CASTOR_FULLCHAIN_FILE={fullchain}
CASTOR_RENEW_BEFORE_DAYS={renew_before_days}
if [ ! -f "$CASTOR_FULLCHAIN_FILE" ]; then
  echo "certificate file not found: $CASTOR_FULLCHAIN_FILE" >&2
  exit 83
fi

echo "__CASTOR_METADATA_BEGIN__"
if command -v openssl >/dev/null 2>&1; then
  openssl x509 -in "$CASTOR_FULLCHAIN_FILE" -noout -issuer -startdate -enddate 2>/dev/null || true
  if openssl x509 -in "$CASTOR_FULLCHAIN_FILE" -checkend "$((CASTOR_RENEW_BEFORE_DAYS * 86400))" -noout >/dev/null 2>&1; then
    echo "__CASTOR_EXPIRING=0"
  else
    echo "__CASTOR_EXPIRING=1"
  fi
fi
echo "__CASTOR_METADATA_END__"
"#,
        fullchain = shell_quote(&certificate.fullchain_file),
        renew_before_days = certificate.renew_before_days,
    )
}

fn configure_auto_renew_cron(
    session: &mut Session,
    certificate: &SslCertificate,
) -> Result<(), String> {
    let cron_tag = format!("CASTOR_SSL_{}", certificate.id.replace('-', ""));
    let (hour, minute) = parse_hour_minute(&certificate.renew_at)?;
    let cron_command = build_auto_renew_command(certificate)?;
    let cron_line = format!(
        "{} {} * * * /bin/bash -lc {} # {}",
        minute,
        hour,
        shell_quote(&cron_command),
        cron_tag
    );

    let script = format!(
        r#"set -e
if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab command is required for auto renew" >&2
  exit 91
fi

tmp_file="$(mktemp)"
(crontab -l 2>/dev/null || true) | grep -v {cron_tag_q} > "$tmp_file"
echo {cron_line_q} >> "$tmp_file"
crontab "$tmp_file"
rm -f "$tmp_file"
"#,
        cron_tag_q = shell_quote(&cron_tag),
        cron_line_q = shell_quote(&cron_line),
    );

    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = pick_error_detail(&stdout, &stderr);
        return Err(format!(
            "failed to configure auto renew cron (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail.as_str()
            }
        ));
    }

    Ok(())
}

fn remove_auto_renew_cron(session: &mut Session, certificate_id: &str) -> Result<(), String> {
    let cron_tag = format!("CASTOR_SSL_{}", certificate_id.replace('-', ""));
    let script = format!(
        r#"set -e
if ! command -v crontab >/dev/null 2>&1; then
  exit 0
fi

tmp_file="$(mktemp)"
(crontab -l 2>/dev/null || true) | grep -v {cron_tag_q} > "$tmp_file"
crontab "$tmp_file"
rm -f "$tmp_file"
"#,
        cron_tag_q = shell_quote(&cron_tag),
    );

    let (stdout, stderr, exit_status) = run_remote_script(session, &script)?;
    if exit_status != 0 {
        let detail = pick_error_detail(&stdout, &stderr);
        return Err(format!(
            "failed to remove auto renew cron (exit code {exit_status}): {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                detail.as_str()
            }
        ));
    }

    Ok(())
}

fn build_auto_renew_command(certificate: &SslCertificate) -> Result<String, String> {
    let mut env_prefix = String::new();
    for item in &certificate.dns_env {
        if !is_valid_env_key(item.key.as_str()) {
            return Err(format!("invalid dns env key: {}", item.key));
        }
        env_prefix.push_str(item.key.as_str());
        env_prefix.push('=');
        env_prefix.push_str(shell_quote(item.value.as_str()).as_str());
        env_prefix.push(' ');
    }

    let mut command = format!(
        "{}\"$HOME/.acme.sh/acme.sh\" --renew -d {} --server letsencrypt --days {}",
        env_prefix,
        shell_quote(certificate.domain.as_str()),
        certificate.renew_before_days
    );

    if let Some(reload_command) = certificate.reload_command.as_deref() {
        command.push_str(" && ");
        command.push_str(
            format!(
                "\"$HOME/.acme.sh/acme.sh\" --install-cert -d {} --key-file {} --fullchain-file {} --reloadcmd {}",
                shell_quote(certificate.domain.as_str()),
                shell_quote(certificate.key_file.as_str()),
                shell_quote(certificate.fullchain_file.as_str()),
                shell_quote(reload_command),
            )
            .as_str(),
        );
    } else {
        command.push_str(" && ");
        command.push_str(
            format!(
                "\"$HOME/.acme.sh/acme.sh\" --install-cert -d {} --key-file {} --fullchain-file {}",
                shell_quote(certificate.domain.as_str()),
                shell_quote(certificate.key_file.as_str()),
                shell_quote(certificate.fullchain_file.as_str()),
            )
            .as_str(),
        );
    }

    Ok(command)
}

#[derive(Default)]
struct ParsedCertificateMetadata {
    issuer: Option<String>,
    not_before: Option<String>,
    not_after: Option<String>,
    expiring: bool,
}

fn parse_certificate_metadata(stdout: &str, _renew_before_days: u16) -> ParsedCertificateMetadata {
    let mut metadata = ParsedCertificateMetadata::default();
    let mut in_metadata_section = false;

    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if line == "__CASTOR_METADATA_BEGIN__" {
            in_metadata_section = true;
            continue;
        }
        if line == "__CASTOR_METADATA_END__" {
            in_metadata_section = false;
            continue;
        }
        if !in_metadata_section {
            continue;
        }

        if let Some(value) = line.strip_prefix("issuer=") {
            metadata.issuer = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("notBefore=") {
            metadata.not_before = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("notAfter=") {
            metadata.not_after = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("__CASTOR_EXPIRING=") {
            metadata.expiring = value.trim() == "1";
            continue;
        }
    }

    if metadata.not_after.is_none() {
        metadata.expiring = false;
    }

    metadata
}

fn pick_error_detail(stdout: &str, stderr: &str) -> String {
    if !stderr.trim().is_empty() {
        return stderr.trim().to_string();
    }
    if !stdout.trim().is_empty() {
        return stdout.trim().to_string();
    }
    String::new()
}

fn validate_upsert_request(
    app: &AppHandle,
    request: &UpsertSslCertificateRequest,
) -> Result<(), String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("profile_id is required".to_string());
    }
    ensure_profile_exists(app, profile_id)?;

    let domain = request.domain.trim().to_lowercase();
    if domain.is_empty() {
        return Err("domain is required".to_string());
    }
    if !is_valid_domain(domain.as_str()) {
        return Err("domain format is invalid".to_string());
    }

    if request.key_file.trim().is_empty() {
        return Err("key_file is required".to_string());
    }
    if request.fullchain_file.trim().is_empty() {
        return Err("fullchain_file is required".to_string());
    }

    let renew_before_days = request.renew_before_days.unwrap_or(30);
    if !(1..=90).contains(&renew_before_days) {
        return Err("renew_before_days must be between 1 and 90".to_string());
    }

    let renew_at = request.renew_at.as_deref().unwrap_or("03:00");
    normalize_renew_at(renew_at)?;

    if let Some(email) = request.email.as_deref() {
        let normalized = email.trim();
        if !normalized.is_empty() && !normalized.contains('@') {
            return Err("email format is invalid".to_string());
        }
    }

    match request.challenge_type {
        SslChallengeType::Http => {
            if request
                .webroot_path
                .as_deref()
                .map(str::trim)
                .is_none_or(str::is_empty)
            {
                return Err("webroot_path is required for http challenge".to_string());
            }
        }
        SslChallengeType::Dns => {
            if request
                .dns_provider
                .as_deref()
                .map(str::trim)
                .is_none_or(str::is_empty)
            {
                return Err("dns_provider is required for dns challenge".to_string());
            }
        }
    }

    let env = request.dns_env.clone().unwrap_or_default();
    let _ = sanitize_dns_env(env)?;

    Ok(())
}

fn sanitize_dns_env(env: Vec<SslDnsEnvVar>) -> Result<Vec<SslDnsEnvVar>, String> {
    let mut normalized = Vec::new();

    for item in env {
        let key = item.key.trim();
        if key.is_empty() {
            continue;
        }
        if !is_valid_env_key(key) {
            return Err(format!("invalid dns env key: {key}"));
        }
        normalized.push(SslDnsEnvVar {
            key: key.to_string(),
            value: item.value,
        });
    }

    Ok(normalized)
}

fn is_valid_env_key(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };

    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }

    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn is_valid_domain(value: &str) -> bool {
    let domain = value.trim();
    if domain.is_empty() || domain.contains(char::is_whitespace) {
        return false;
    }

    let without_wildcard = domain.strip_prefix("*.").unwrap_or(domain);
    if without_wildcard.is_empty() || without_wildcard.len() > 253 {
        return false;
    }

    let segments: Vec<&str> = without_wildcard.split('.').collect();
    if segments.len() < 2 {
        return false;
    }

    segments.iter().all(|segment| {
        let segment = segment.trim();
        !segment.is_empty()
            && !segment.starts_with('-')
            && !segment.ends_with('-')
            && segment
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

fn normalize_renew_at(value: &str) -> Result<String, String> {
    let (hour, minute) = parse_hour_minute(value)?;
    Ok(format!("{:02}:{:02}", hour, minute))
}

fn parse_hour_minute(value: &str) -> Result<(u8, u8), String> {
    let trimmed = value.trim();
    let mut parts = trimmed.split(':');
    let hour = parts
        .next()
        .ok_or_else(|| "renew_at format is invalid, expected HH:MM".to_string())?
        .parse::<u8>()
        .map_err(|_| "renew_at hour is invalid".to_string())?;
    let minute = parts
        .next()
        .ok_or_else(|| "renew_at format is invalid, expected HH:MM".to_string())?
        .parse::<u8>()
        .map_err(|_| "renew_at minute is invalid".to_string())?;

    if parts.next().is_some() {
        return Err("renew_at format is invalid, expected HH:MM".to_string());
    }
    if hour > 23 {
        return Err("renew_at hour must be between 00 and 23".to_string());
    }
    if minute > 59 {
        return Err("renew_at minute must be between 00 and 59".to_string());
    }

    Ok((hour, minute))
}

fn ensure_unique_domain(
    certificates: &[SslCertificate],
    profile_id: &str,
    domain: &str,
    current_id: Option<&str>,
) -> Result<(), String> {
    let duplicated = certificates.iter().any(|item| {
        if current_id.is_some_and(|id| item.id == id) {
            return false;
        }
        item.profile_id == profile_id && item.domain.eq_ignore_ascii_case(domain)
    });

    if duplicated {
        return Err(format!(
            "domain already exists on selected profile: {domain}"
        ));
    }

    Ok(())
}

fn update_ssl_certificate(app: &AppHandle, certificate: &SslCertificate) -> Result<(), String> {
    let _lock = ssl_certificates_store_lock()
        .lock()
        .map_err(|_| "ssl certificates store lock poisoned".to_string())?;
    let mut certificates = load_ssl_certificates(app)?;

    let target = certificates
        .iter_mut()
        .find(|item| item.id == certificate.id)
        .ok_or_else(|| format!("ssl certificate {} not found", certificate.id))?;
    *target = certificate.clone();
    save_ssl_certificates(app, &certificates)
}

fn find_ssl_certificate_by_id(app: &AppHandle, id: &str) -> Result<SslCertificate, String> {
    load_ssl_certificates(app)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("ssl certificate {} not found", id))
}

fn load_ssl_certificates(app: &AppHandle) -> Result<Vec<SslCertificate>, String> {
    let path = ssl_certificates_file_path(app)?;
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.trim().is_empty() {
                return Ok(vec![]);
            }
            serde_json::from_str(&content)
                .map_err(|err| format!("failed to parse ssl certificates: {err}"))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(format!("failed to read ssl certificates: {err}")),
    }
}

fn save_ssl_certificates(app: &AppHandle, certificates: &[SslCertificate]) -> Result<(), String> {
    let path = ssl_certificates_file_path(app)?;
    let body = serde_json::to_string_pretty(certificates)
        .map_err(|err| format!("failed to encode ssl certificates: {err}"))?;
    fs::write(path, body).map_err(|err| format!("failed to write ssl certificates: {err}"))
}

fn ssl_certificates_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("failed to resolve app config dir: {err}"))?;
    fs::create_dir_all(&config_dir)
        .map_err(|err| format!("failed to initialize app config dir: {err}"))?;
    Ok(config_dir.join("ssl_certificates.json"))
}

fn ssl_certificates_store_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn ensure_profile_exists(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    let exists = list_connection_profiles(app)?
        .iter()
        .any(|profile| profile.id == profile_id);

    if exists {
        Ok(())
    } else {
        Err(format!("profile {} not found", profile_id))
    }
}

fn find_profile(app: &AppHandle, profile_id: &str) -> Result<ConnectionProfile, String> {
    list_connection_profiles(app)?
        .into_iter()
        .find(|item| item.id == profile_id)
        .ok_or_else(|| format!("profile {} not found", profile_id))
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

fn sanitize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
