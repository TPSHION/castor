use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Deserialize)]
pub struct UpsertConnectionProfileRequest {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteConnectionProfileRequest {
    pub id: String,
}

pub fn list_connection_profiles(app: &AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let mut profiles = load_profiles(app)?;
    profiles.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(profiles)
}

pub fn upsert_connection_profile(
    app: &AppHandle,
    request: UpsertConnectionProfileRequest,
) -> Result<ConnectionProfile, String> {
    validate_request(&request)?;

    let mut profiles = load_profiles(app)?;
    let now = now_unix();

    let (password, private_key, passphrase) = sanitized_secrets(&request);

    let result = if let Some(id) = request.id {
        if let Some(existing) = profiles.iter_mut().find(|profile| profile.id == id) {
            existing.name = request.name.trim().to_string();
            existing.host = request.host.trim().to_string();
            existing.port = request.port;
            existing.username = request.username.trim().to_string();
            existing.auth_kind = request.auth_kind;
            existing.password = password;
            existing.private_key = private_key;
            existing.passphrase = passphrase;
            existing.updated_at = now;
            existing.clone()
        } else {
            return Err(format!("connection profile {} not found", id));
        }
    } else {
        let profile = ConnectionProfile {
            id: Uuid::new_v4().to_string(),
            name: request.name.trim().to_string(),
            host: request.host.trim().to_string(),
            port: request.port,
            username: request.username.trim().to_string(),
            auth_kind: request.auth_kind,
            password,
            private_key,
            passphrase,
            created_at: now,
            updated_at: now,
        };
        profiles.push(profile.clone());
        profile
    };

    save_profiles(app, &profiles)?;
    Ok(result)
}

pub fn delete_connection_profile(
    app: &AppHandle,
    request: DeleteConnectionProfileRequest,
) -> Result<(), String> {
    let mut profiles = load_profiles(app)?;
    let before = profiles.len();
    profiles.retain(|profile| profile.id != request.id);

    if profiles.len() == before {
        return Err(format!("connection profile {} not found", request.id));
    }

    save_profiles(app, &profiles)
}

fn validate_request(request: &UpsertConnectionProfileRequest) -> Result<(), String> {
    if request.name.trim().is_empty() {
        return Err("profile name is required".to_string());
    }
    if request.host.trim().is_empty() {
        return Err("host is required".to_string());
    }
    if request.username.trim().is_empty() {
        return Err("username is required".to_string());
    }
    if request.port == 0 {
        return Err("port must be between 1 and 65535".to_string());
    }
    if request.auth_kind != "password" && request.auth_kind != "private_key" {
        return Err("auth_kind must be password or private_key".to_string());
    }

    match request.auth_kind.as_str() {
        "password" => {
            if request.password.clone().unwrap_or_default().is_empty() {
                return Err("password is required for password auth".to_string());
            }
        }
        "private_key" => {
            if request
                .private_key
                .clone()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err("private_key is required for private key auth".to_string());
            }
        }
        _ => {}
    }

    Ok(())
}

fn sanitized_secrets(
    request: &UpsertConnectionProfileRequest,
) -> (Option<String>, Option<String>, Option<String>) {
    if request.auth_kind == "password" {
        return (request.password.clone(), None, None);
    }

    let passphrase = request.passphrase.clone().filter(|value| !value.is_empty());
    (None, request.private_key.clone(), passphrase)
}

fn load_profiles(app: &AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let path = profiles_file_path(app)?;
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.trim().is_empty() {
                return Ok(vec![]);
            }
            serde_json::from_str(&content)
                .map_err(|err| format!("failed to parse connection profiles: {err}"))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(vec![]),
        Err(err) => Err(format!("failed to read connection profiles: {err}")),
    }
}

fn save_profiles(app: &AppHandle, profiles: &[ConnectionProfile]) -> Result<(), String> {
    let path = profiles_file_path(app)?;
    let body = serde_json::to_string_pretty(profiles)
        .map_err(|err| format!("failed to encode connection profiles: {err}"))?;
    fs::write(path, body).map_err(|err| format!("failed to write connection profiles: {err}"))
}

fn profiles_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("failed to resolve app config dir: {err}"))?;

    fs::create_dir_all(&config_dir)
        .map_err(|err| format!("failed to initialize app config dir: {err}"))?;

    Ok(config_dir.join("connection_profiles.json"))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
