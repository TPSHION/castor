use std::collections::{hash_map::DefaultHasher, HashMap};
use std::env;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use ssh2::{FileStat, Session};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::ssh::AuthConfig;

const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;

#[derive(Debug, Deserialize)]
pub struct SftpListRequest {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub auth: AuthConfig,
  pub path: Option<String>
}

#[derive(Debug, Deserialize)]
pub struct SftpDownloadRequest {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub auth: AuthConfig,
  pub remote_path: String,
  pub local_dir: Option<String>,
  pub transfer_id: Option<String>
}

#[derive(Debug, Deserialize)]
pub struct SftpUploadRequest {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub auth: AuthConfig,
  pub local_path: String,
  pub remote_dir: String,
  pub remote_name: Option<String>,
  pub conflict_strategy: Option<SftpUploadConflictStrategy>,
  pub transfer_id: Option<String>
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SftpUploadConflictStrategy {
  AutoRename,
  Overwrite
}

#[derive(Debug, Deserialize)]
pub struct CancelSftpTransferRequest {
  pub transfer_id: String
}

#[derive(Debug, Deserialize)]
pub struct SftpRenameRequest {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub auth: AuthConfig,
  pub path: String,
  pub new_name: String
}

#[derive(Debug, Deserialize)]
pub struct SftpDeleteRequest {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub auth: AuthConfig,
  pub path: String
}

#[derive(Debug, Deserialize)]
pub struct SftpCreateDirRequest {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub auth: AuthConfig,
  pub parent_path: String,
  pub name: String
}

#[derive(Debug, Deserialize)]
pub struct SftpSetPermissionsRequest {
  pub host: String,
  pub port: Option<u16>,
  pub username: String,
  pub auth: AuthConfig,
  pub path: String,
  pub permissions: u32
}

#[derive(Clone, Debug, Serialize)]
pub struct SftpEntry {
  pub name: String,
  pub path: String,
  pub is_dir: bool,
  pub size: Option<u64>,
  pub modified: Option<u64>,
  pub permissions: Option<u32>
}

#[derive(Clone, Debug, Serialize)]
pub struct SftpDownloadResult {
  pub local_path: String,
  pub bytes: u64
}

#[derive(Clone, Debug, Serialize)]
pub struct SftpUploadResult {
  pub remote_path: String,
  pub bytes: u64
}

#[derive(Clone, Debug, Serialize)]
pub struct SftpTransferProgressPayload {
  pub transfer_id: String,
  pub direction: String,
  pub status: String,
  pub path: String,
  pub target_path: String,
  pub transferred_bytes: u64,
  pub total_bytes: u64,
  pub percent: u8
}

struct TransferProgressEmitter<'a> {
  app: &'a AppHandle,
  transfer_id: String,
  direction: &'static str,
  path: String,
  target_path: String,
  transferred_bytes: u64,
  total_bytes: u64,
  last_percent: u8
}

impl<'a> TransferProgressEmitter<'a> {
  fn new(
    app: &'a AppHandle,
    transfer_id: String,
    direction: &'static str,
    path: String,
    target_path: String,
    total_bytes: u64
  ) -> Self {
    Self {
      app,
      transfer_id,
      direction,
      path,
      target_path,
      transferred_bytes: 0,
      total_bytes,
      last_percent: 0
    }
  }

  fn start(&mut self) {
    self.emit("running");
  }

  fn advance(&mut self, delta: u64) {
    self.transferred_bytes = self.transferred_bytes.saturating_add(delta);
    let percent = self.percent();
    if percent != self.last_percent {
      self.last_percent = percent;
      self.emit("running");
    }
  }

  fn finish(&mut self) {
    if self.total_bytes > 0 {
      self.transferred_bytes = self.total_bytes.max(self.transferred_bytes);
    }
    self.last_percent = 100;
    self.emit("done");
  }

  fn fail(&self) {
    self.emit("error");
  }

  fn emit(&self, status: &str) {
    let percent = if status == "done" { 100 } else { self.percent() };
    let _ = self.app.emit(
      "sftp-transfer-progress",
      SftpTransferProgressPayload {
        transfer_id: self.transfer_id.clone(),
        direction: self.direction.to_string(),
        status: status.to_string(),
        path: self.path.clone(),
        target_path: self.target_path.clone(),
        transferred_bytes: self.transferred_bytes,
        total_bytes: self.total_bytes,
        percent
      }
    );
  }

  fn percent(&self) -> u8 {
    if self.total_bytes == 0 {
      return if self.transferred_bytes > 0 { 100 } else { 0 };
    }

    ((self.transferred_bytes.saturating_mul(100) / self.total_bytes).min(100)) as u8
  }

  fn cancel(&self) {
    self.emit("canceled");
  }
}

fn transfer_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
  static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
  REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_transfer(transfer_id: &str) -> Arc<AtomicBool> {
  let token = Arc::new(AtomicBool::new(false));
  if let Ok(mut registry) = transfer_registry().lock() {
    registry.insert(transfer_id.to_string(), token.clone());
  }
  token
}

fn remove_transfer(transfer_id: &str) {
  if let Ok(mut registry) = transfer_registry().lock() {
    registry.remove(transfer_id);
  }
}

struct TransferRegistrationGuard {
  transfer_id: String
}

impl TransferRegistrationGuard {
  fn new(transfer_id: String) -> Self {
    Self { transfer_id }
  }
}

impl Drop for TransferRegistrationGuard {
  fn drop(&mut self) {
    remove_transfer(&self.transfer_id);
  }
}

struct SftpConnection {
  _session: Session,
  sftp: ssh2::Sftp
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct SftpConnectionKey {
  host: String,
  port: u16,
  username: String,
  auth_fingerprint: u64
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
      passphrase
    } => {
      2u8.hash(&mut hasher);
      private_key.hash(&mut hasher);
      passphrase.hash(&mut hasher);
    }
  }
  hasher.finish()
}

fn build_sftp_connection_key(
  host: &str,
  port: Option<u16>,
  username: &str,
  auth: &AuthConfig
) -> SftpConnectionKey {
  SftpConnectionKey {
    host: host.to_string(),
    port: port.unwrap_or(22),
    username: username.to_string(),
    auth_fingerprint: auth_fingerprint(auth)
  }
}

fn sftp_connection_pool() -> &'static Mutex<HashMap<SftpConnectionKey, Arc<Mutex<SftpConnection>>>> {
  static POOL: OnceLock<Mutex<HashMap<SftpConnectionKey, Arc<Mutex<SftpConnection>>>>> = OnceLock::new();
  POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn connect_sftp_connection(key: &SftpConnectionKey, auth: &AuthConfig) -> Result<SftpConnection, String> {
  let (session, sftp) = connect_sftp(&key.host, Some(key.port), &key.username, auth)?;
  Ok(SftpConnection {
    _session: session,
    sftp
  })
}

fn get_or_create_sftp_connection(
  key: &SftpConnectionKey,
  auth: &AuthConfig
) -> Result<Arc<Mutex<SftpConnection>>, String> {
  if let Some(existing) = sftp_connection_pool()
    .lock()
    .map_err(|_| "sftp connection pool lock poisoned".to_string())?
    .get(key)
    .cloned()
  {
    return Ok(existing);
  }

  let fresh = Arc::new(Mutex::new(connect_sftp_connection(key, auth)?));
  let mut pool = sftp_connection_pool()
    .lock()
    .map_err(|_| "sftp connection pool lock poisoned".to_string())?;
  let entry = pool
    .entry(key.clone())
    .or_insert_with(|| fresh.clone())
    .clone();
  Ok(entry)
}

fn replace_sftp_connection(
  key: &SftpConnectionKey,
  auth: &AuthConfig
) -> Result<Arc<Mutex<SftpConnection>>, String> {
  let fresh = Arc::new(Mutex::new(connect_sftp_connection(key, auth)?));
  let mut pool = sftp_connection_pool()
    .lock()
    .map_err(|_| "sftp connection pool lock poisoned".to_string())?;
  pool.insert(key.clone(), fresh.clone());
  Ok(fresh)
}

fn list_dir_with_connection(
  connection: &Arc<Mutex<SftpConnection>>,
  normalized_path: &str
) -> Result<Vec<SftpEntry>, String> {
  let connection = connection
    .lock()
    .map_err(|_| "sftp connection lock poisoned".to_string())?;
  list_dir_from_sftp(&connection.sftp, normalized_path)
}

fn list_dir_from_sftp(sftp: &ssh2::Sftp, normalized_path: &str) -> Result<Vec<SftpEntry>, String> {
  let entries = sftp
    .readdir(Path::new(normalized_path))
    .map_err(|err| format!("failed to list directory {normalized_path}: {err}"))?;

  let mut result = entries
    .into_iter()
    .filter_map(|(entry_path, stat)| {
      let name = entry_path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_default();

      if name.is_empty() || name == "." || name == ".." {
        return None;
      }

      let path = join_remote_path(normalized_path, &name);
      let is_dir = stat
        .perm
        .map(|mode| (mode & S_IFMT) == S_IFDIR)
        .unwrap_or(false);

      Some(SftpEntry {
        name,
        path,
        is_dir,
        size: stat.size,
        modified: stat.mtime,
        permissions: stat.perm
      })
    })
    .collect::<Vec<_>>();

  result.sort_by(|left, right| match (left.is_dir, right.is_dir) {
    (true, false) => std::cmp::Ordering::Less,
    (false, true) => std::cmp::Ordering::Greater,
    _ => left.name.to_lowercase().cmp(&right.name.to_lowercase())
  });

  Ok(result)
}

pub fn cancel_transfer(request: CancelSftpTransferRequest) -> Result<(), String> {
  let transfer_id = request.transfer_id.trim();
  if transfer_id.is_empty() {
    return Err("transfer id is required".to_string());
  }

  let maybe_token = transfer_registry()
    .lock()
    .ok()
    .and_then(|registry| registry.get(transfer_id).cloned());

  if let Some(token) = maybe_token {
    token.store(true, Ordering::Relaxed);
    Ok(())
  } else {
    Err("目标下载任务不存在或已结束".to_string())
  }
}

pub fn list_dir(request: SftpListRequest) -> Result<Vec<SftpEntry>, String> {
  let normalized_path = normalize_remote_path(request.path.as_deref().unwrap_or("/"));
  let connection_key =
    build_sftp_connection_key(&request.host, request.port, &request.username, &request.auth);
  let connection = get_or_create_sftp_connection(&connection_key, &request.auth)?;

  match list_dir_with_connection(&connection, &normalized_path) {
    Ok(entries) => Ok(entries),
    Err(_) => {
      // Retry once with a fresh connection to recover from stale pooled sessions.
      let refreshed_connection = replace_sftp_connection(&connection_key, &request.auth)?;
      list_dir_with_connection(&refreshed_connection, &normalized_path)
    }
  }
}

pub fn download_file(app: &AppHandle, request: SftpDownloadRequest) -> Result<SftpDownloadResult, String> {
  let remote_path = normalize_remote_path(&request.remote_path);
  let transfer_id = request
    .transfer_id
    .as_deref()
    .filter(|value| !value.trim().is_empty())
    .map(|value| value.to_string())
    .unwrap_or_else(|| Uuid::new_v4().to_string());
  let cancel_token = register_transfer(&transfer_id);
  let _registration_guard = TransferRegistrationGuard::new(transfer_id.clone());

  let (_session, sftp) = connect_sftp(&request.host, request.port, &request.username, &request.auth)?;

  let file_name = Path::new(&remote_path)
    .file_name()
    .map(|name| name.to_string_lossy().to_string())
    .filter(|name| !name.trim().is_empty())
    .ok_or_else(|| format!("invalid remote path: {remote_path}"))?;

  let target_dir = resolve_download_dir(request.local_dir.as_deref());
  fs::create_dir_all(&target_dir)
    .map_err(|err| format!("failed to prepare local directory {}: {err}", target_dir.display()))?;
  let local_path = unique_local_path(&target_dir, &file_name);
  let local_path_string = local_path.to_string_lossy().to_string();

  let total_bytes = measure_remote_size(&sftp, &remote_path)?;
  let mut progress = TransferProgressEmitter::new(
    app,
    transfer_id.clone(),
    "download",
    remote_path.clone(),
    local_path_string.clone(),
    total_bytes
  );
  progress.start();

  let transfer_result = download_remote_path(
    &sftp,
    &remote_path,
    &local_path,
    Some(cancel_token.as_ref()),
    &mut |delta| {
    progress.advance(delta);
    }
  );

  let bytes = match transfer_result {
    Ok(bytes) => {
      progress.finish();
      bytes
    }
    Err(err) => {
      if err == "transfer canceled" {
        progress.cancel();
        return Err("下载已取消".to_string());
      }
      progress.fail();
      return Err(err);
    }
  };

  Ok(SftpDownloadResult {
    local_path: local_path_string,
    bytes
  })
}

pub fn upload_path(app: &AppHandle, request: SftpUploadRequest) -> Result<SftpUploadResult, String> {
  let transfer_id = request
    .transfer_id
    .as_deref()
    .filter(|value| !value.trim().is_empty())
    .map(|value| value.to_string())
    .unwrap_or_else(|| Uuid::new_v4().to_string());
  let cancel_token = register_transfer(&transfer_id);
  let _registration_guard = TransferRegistrationGuard::new(transfer_id.clone());
  let local_path = PathBuf::from(request.local_path.trim());
  if !local_path.exists() {
    return Err(format!("local path does not exist: {}", local_path.display()));
  }

  let remote_dir = normalize_remote_path(&request.remote_dir);
  let (_session, sftp) = connect_sftp(&request.host, request.port, &request.username, &request.auth)?;

  create_remote_dir_all(&sftp, &remote_dir)?;

  let default_name = local_path
    .file_name()
    .map(|item| item.to_string_lossy().to_string())
    .filter(|item| !item.trim().is_empty())
    .ok_or_else(|| format!("invalid local path: {}", local_path.display()))?;

  let name = request
    .remote_name
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(ToOwned::to_owned)
    .unwrap_or(default_name);

  if !is_valid_remote_name(&name) {
    return Err("invalid remote name".to_string());
  }

  let desired_remote_path = join_remote_path(&remote_dir, &name);
  let conflict_strategy = request
    .conflict_strategy
    .unwrap_or(SftpUploadConflictStrategy::AutoRename);
  let remote_path = match conflict_strategy {
    SftpUploadConflictStrategy::AutoRename => unique_remote_path(&sftp, &remote_dir, &name),
    SftpUploadConflictStrategy::Overwrite => {
      validate_overwrite_target(&sftp, &local_path, &desired_remote_path)?;
      desired_remote_path
    }
  };
  let total_bytes = measure_local_size(&local_path)?;
  let mut progress = TransferProgressEmitter::new(
    app,
    transfer_id.clone(),
    "upload",
    local_path.to_string_lossy().to_string(),
    remote_path.clone(),
    total_bytes
  );
  progress.start();

  let transfer_result = upload_local_path(
    &sftp,
    &local_path,
    &remote_path,
    Some(cancel_token.as_ref()),
    &mut |delta| {
    progress.advance(delta);
    }
  );

  let bytes = match transfer_result {
    Ok(bytes) => {
      progress.finish();
      bytes
    }
    Err(err) => {
      if err == "transfer canceled" {
        progress.cancel();
        return Err("上传已取消".to_string());
      }
      progress.fail();
      return Err(err);
    }
  };

  Ok(SftpUploadResult { remote_path, bytes })
}

pub fn rename_entry(request: SftpRenameRequest) -> Result<(), String> {
  let source = normalize_remote_path(&request.path);
  let new_name = request.new_name.trim();
  if !is_valid_remote_name(new_name) {
    return Err("invalid new name".to_string());
  }

  let (_session, sftp) = connect_sftp(&request.host, request.port, &request.username, &request.auth)?;

  let source_path = Path::new(&source);
  let parent = source_path
    .parent()
    .and_then(|item| item.to_str())
    .unwrap_or("/");
  let target = join_remote_path(parent, new_name);

  sftp
    .rename(Path::new(&source), Path::new(&target), None)
    .map_err(|err| format!("failed to rename {source} to {target}: {err}"))
}

pub fn delete_entry(request: SftpDeleteRequest) -> Result<(), String> {
  let path = normalize_remote_path(&request.path);
  if path == "/" {
    return Err("refuse to delete root directory".to_string());
  }
  let (_session, sftp) = connect_sftp(&request.host, request.port, &request.username, &request.auth)?;

  remove_remote_path_recursive(&sftp, &path)
}

pub fn create_dir(request: SftpCreateDirRequest) -> Result<(), String> {
  let parent = normalize_remote_path(&request.parent_path);
  let name = request.name.trim();
  if !is_valid_remote_name(name) {
    return Err("invalid directory name".to_string());
  }

  let target = join_remote_path(&parent, name);
  let (_session, sftp) = connect_sftp(&request.host, request.port, &request.username, &request.auth)?;

  sftp
    .mkdir(Path::new(&target), 0o755)
    .map_err(|err| format!("failed to create directory {target}: {err}"))
}

pub fn set_permissions(request: SftpSetPermissionsRequest) -> Result<(), String> {
  if request.permissions > 0o7777 {
    return Err("permissions must be a valid octal mode".to_string());
  }

  let path = normalize_remote_path(&request.path);
  let (_session, sftp) = connect_sftp(&request.host, request.port, &request.username, &request.auth)?;

  let current = sftp
    .stat(Path::new(&path))
    .map_err(|err| format!("failed to inspect {path}: {err}"))?;
  let next_mode = current
    .perm
    .map(|mode| (mode & !0o7777) | request.permissions)
    .unwrap_or(request.permissions);

  let stat = FileStat {
    size: None,
    uid: None,
    gid: None,
    perm: Some(next_mode),
    atime: None,
    mtime: None
  };

  sftp
    .setstat(Path::new(&path), stat)
    .map_err(|err| format!("failed to update permissions for {path}: {err}"))
}

fn connect_sftp(
  host: &str,
  port: Option<u16>,
  username: &str,
  auth: &AuthConfig
) -> Result<(Session, ssh2::Sftp), String> {
  let port = port.unwrap_or(22);
  let addr = format!("{host}:{port}");
  let tcp = TcpStream::connect(&addr).map_err(|err| format!("failed to connect {addr}: {err}"))?;

  let mut session = Session::new().map_err(|err| format!("failed to create SSH session: {err}"))?;
  session.set_tcp_stream(tcp);
  session
    .handshake()
    .map_err(|err| format!("ssh handshake failed: {err}"))?;

  match auth {
    AuthConfig::Password { password } => session
      .userauth_password(username, password)
      .map_err(|err| format!("password authentication failed: {err}"))?,
    AuthConfig::PrivateKey {
      private_key,
      passphrase
    } => session
      .userauth_pubkey_memory(username, None, private_key, passphrase.as_deref())
      .map_err(|err| format!("private key authentication failed: {err}"))?
  }

  if !session.authenticated() {
    return Err("ssh authentication was rejected".to_string());
  }

  let sftp = session
    .sftp()
    .map_err(|err| format!("failed to start sftp subsystem: {err}"))?;
  Ok((session, sftp))
}

fn normalize_remote_path(path: &str) -> String {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return "/".to_string();
  }

  let absolute = if trimmed.starts_with('/') {
    trimmed.to_string()
  } else {
    format!("/{trimmed}")
  };

  let mut segments = Vec::new();
  for segment in absolute.split('/') {
    if segment.is_empty() || segment == "." {
      continue;
    }
    if segment == ".." {
      let _ = segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if segments.is_empty() {
    "/".to_string()
  } else {
    format!("/{}", segments.join("/"))
  }
}

fn join_remote_path(base: &str, name: &str) -> String {
  if base == "/" {
    return format!("/{name}");
  }
  format!("{}/{}", base.trim_end_matches('/'), name)
}

fn is_valid_remote_name(name: &str) -> bool {
  !(name.is_empty() || name == "." || name == ".." || name.contains('/'))
}

fn remove_remote_path_recursive(sftp: &ssh2::Sftp, path: &str) -> Result<(), String> {
  let stat = sftp
    .stat(Path::new(path))
    .map_err(|err| format!("failed to inspect {path}: {err}"))?;
  let is_dir = stat
    .perm
    .map(|mode| (mode & S_IFMT) == S_IFDIR)
    .unwrap_or(false);

  if !is_dir {
    return sftp
      .unlink(Path::new(path))
      .map_err(|err| format!("failed to delete file {path}: {err}"));
  }

  let children = sftp
    .readdir(Path::new(path))
    .map_err(|err| format!("failed to read directory {path}: {err}"))?;
  for (child_path, _) in children {
    let name = child_path
      .file_name()
      .map(|item| item.to_string_lossy().to_string())
      .unwrap_or_default();
    if name.is_empty() || name == "." || name == ".." {
      continue;
    }
    let child = join_remote_path(path, &name);
    remove_remote_path_recursive(sftp, &child)?;
  }

  sftp
    .rmdir(Path::new(path))
    .map_err(|err| format!("failed to delete directory {path}: {err}"))
}

fn download_remote_path<F>(
  sftp: &ssh2::Sftp,
  remote_path: &str,
  local_path: &Path,
  cancel_token: Option<&AtomicBool>,
  on_progress: &mut F
) -> Result<u64, String>
where
  F: FnMut(u64)
{
  if is_transfer_canceled(cancel_token) {
    return Err("transfer canceled".to_string());
  }

  let stat = sftp
    .stat(Path::new(remote_path))
    .map_err(|err| format!("failed to inspect {remote_path}: {err}"))?;
  let is_dir = stat
    .perm
    .map(|mode| (mode & S_IFMT) == S_IFDIR)
    .unwrap_or(false);

  if !is_dir {
    if let Some(parent) = local_path.parent() {
      fs::create_dir_all(parent).map_err(|err| {
        format!(
          "failed to prepare local directory {}: {err}",
          parent.display()
        )
      })?;
    }

    let mut remote_file = sftp
      .open(Path::new(remote_path))
      .map_err(|err| format!("failed to open remote file {remote_path}: {err}"))?;
    let mut local_file = File::create(local_path)
      .map_err(|err| format!("failed to create local file {}: {err}", local_path.display()))?;

    return copy_stream(&mut remote_file, &mut local_file, cancel_token, on_progress).map_err(|err| {
      if err == "transfer canceled" {
        err
      } else {
        format!("failed to download remote file {remote_path}: {err}")
      }
    });
  }

  fs::create_dir_all(local_path)
    .map_err(|err| format!("failed to create local directory {}: {err}", local_path.display()))?;

  let children = sftp
    .readdir(Path::new(remote_path))
    .map_err(|err| format!("failed to read directory {remote_path}: {err}"))?;

  let mut total_bytes = 0;
  for (child_path, _) in children {
    let name = child_path
      .file_name()
      .map(|item| item.to_string_lossy().to_string())
      .unwrap_or_default();
    if name.is_empty() || name == "." || name == ".." {
      continue;
    }

    let next_remote_path = join_remote_path(remote_path, &name);
    let next_local_path = local_path.join(&name);
    total_bytes += download_remote_path(
      sftp,
      &next_remote_path,
      &next_local_path,
      cancel_token,
      on_progress
    )?;
  }

  Ok(total_bytes)
}

fn upload_local_path<F>(
  sftp: &ssh2::Sftp,
  local_path: &Path,
  remote_path: &str,
  cancel_token: Option<&AtomicBool>,
  on_progress: &mut F
) -> Result<u64, String>
where
  F: FnMut(u64)
{
  if is_transfer_canceled(cancel_token) {
    return Err("transfer canceled".to_string());
  }

  let metadata = fs::metadata(local_path)
    .map_err(|err| format!("failed to inspect local path {}: {err}", local_path.display()))?;

  if metadata.is_file() {
    if let Some(parent) = Path::new(remote_path).parent().and_then(|item| item.to_str()) {
      let normalized_parent = normalize_remote_path(parent);
      create_remote_dir_all(sftp, &normalized_parent)?;
    }

    let mut local_file = File::open(local_path)
      .map_err(|err| format!("failed to open local file {}: {err}", local_path.display()))?;
    let mut remote_file = sftp
      .create(Path::new(remote_path))
      .map_err(|err| format!("failed to create remote file {remote_path}: {err}"))?;

    return copy_stream(&mut local_file, &mut remote_file, cancel_token, on_progress).map_err(|err| {
      if err == "transfer canceled" {
        err
      } else {
        format!("failed to upload local file {}: {err}", local_path.display())
      }
    });
  }

  if metadata.is_dir() {
    create_remote_dir_all(sftp, remote_path)?;
    let mut total_bytes = 0u64;

    let children = fs::read_dir(local_path)
      .map_err(|err| format!("failed to read local directory {}: {err}", local_path.display()))?;

    for child in children {
      let child = child.map_err(|err| {
        format!("failed to iterate local directory {}: {err}", local_path.display())
      })?;
      let child_path = child.path();
      let name = child
        .file_name()
        .to_string_lossy()
        .to_string();
      if name.is_empty() {
        continue;
      }
      let child_remote_path = join_remote_path(remote_path, &name);
      total_bytes += upload_local_path(
        sftp,
        &child_path,
        &child_remote_path,
        cancel_token,
        on_progress
      )?;
    }

    return Ok(total_bytes);
  }

  Err(format!(
    "unsupported local path type: {}",
    local_path.display()
  ))
}

fn create_remote_dir_all(sftp: &ssh2::Sftp, path: &str) -> Result<(), String> {
  let normalized = normalize_remote_path(path);
  if normalized == "/" {
    return Ok(());
  }

  let mut current = String::from("/");
  for segment in normalized.trim_start_matches('/').split('/') {
    if segment.is_empty() {
      continue;
    }
    current = join_remote_path(&current, segment);

    match sftp.stat(Path::new(&current)) {
      Ok(stat) => {
        let is_dir = stat
          .perm
          .map(|mode| (mode & S_IFMT) == S_IFDIR)
          .unwrap_or(false);
        if !is_dir {
          return Err(format!("remote path exists but is not a directory: {current}"));
        }
      }
      Err(_) => {
        sftp
          .mkdir(Path::new(&current), 0o755)
          .map_err(|err| format!("failed to create remote directory {current}: {err}"))?;
      }
    }
  }

  Ok(())
}

fn validate_overwrite_target(sftp: &ssh2::Sftp, local_path: &Path, remote_path: &str) -> Result<(), String> {
  let local_metadata = fs::metadata(local_path)
    .map_err(|err| format!("failed to inspect local path {}: {err}", local_path.display()))?;
  let local_is_dir = local_metadata.is_dir();

  match sftp.stat(Path::new(remote_path)) {
    Ok(remote_stat) => {
      let remote_is_dir = remote_stat
        .perm
        .map(|mode| (mode & S_IFMT) == S_IFDIR)
        .unwrap_or(false);

      if local_is_dir != remote_is_dir {
        return Err("远程已存在同名且类型不同，建议使用“自动重命名上传”。".to_string());
      }
      Ok(())
    }
    Err(_) => Ok(())
  }
}

fn measure_remote_size(sftp: &ssh2::Sftp, remote_path: &str) -> Result<u64, String> {
  let stat = sftp
    .stat(Path::new(remote_path))
    .map_err(|err| format!("failed to inspect {remote_path}: {err}"))?;
  let is_dir = stat
    .perm
    .map(|mode| (mode & S_IFMT) == S_IFDIR)
    .unwrap_or(false);

  if !is_dir {
    return Ok(stat.size.unwrap_or(0));
  }

  let children = sftp
    .readdir(Path::new(remote_path))
    .map_err(|err| format!("failed to read directory {remote_path}: {err}"))?;

  let mut total = 0u64;
  for (child_path, _) in children {
    let name = child_path
      .file_name()
      .map(|item| item.to_string_lossy().to_string())
      .unwrap_or_default();
    if name.is_empty() || name == "." || name == ".." {
      continue;
    }
    let next_remote_path = join_remote_path(remote_path, &name);
    total = total.saturating_add(measure_remote_size(sftp, &next_remote_path)?);
  }

  Ok(total)
}

fn measure_local_size(local_path: &Path) -> Result<u64, String> {
  let metadata = fs::metadata(local_path)
    .map_err(|err| format!("failed to inspect local path {}: {err}", local_path.display()))?;

  if metadata.is_file() {
    return Ok(metadata.len());
  }

  if metadata.is_dir() {
    let mut total = 0u64;
    let children = fs::read_dir(local_path)
      .map_err(|err| format!("failed to read local directory {}: {err}", local_path.display()))?;

    for child in children {
      let child = child.map_err(|err| {
        format!("failed to iterate local directory {}: {err}", local_path.display())
      })?;
      total = total.saturating_add(measure_local_size(&child.path())?);
    }

    return Ok(total);
  }

  Ok(0)
}

fn copy_stream<R, W, F>(
  reader: &mut R,
  writer: &mut W,
  cancel_token: Option<&AtomicBool>,
  on_progress: &mut F
) -> Result<u64, String>
where
  R: Read,
  W: Write,
  F: FnMut(u64)
{
  let mut buffer = [0u8; 64 * 1024];
  let mut total = 0u64;

  loop {
    if is_transfer_canceled(cancel_token) {
      return Err("transfer canceled".to_string());
    }

    let read_bytes = reader
      .read(&mut buffer)
      .map_err(|err| format!("read stream failed: {err}"))?;
    if read_bytes == 0 {
      break;
    }
    writer
      .write_all(&buffer[..read_bytes])
      .map_err(|err| format!("write stream failed: {err}"))?;
    let chunk = read_bytes as u64;
    total = total.saturating_add(chunk);
    on_progress(chunk);
  }

  Ok(total)
}

fn is_transfer_canceled(cancel_token: Option<&AtomicBool>) -> bool {
  cancel_token
    .map(|token| token.load(Ordering::Relaxed))
    .unwrap_or(false)
}

fn resolve_download_dir(path: Option<&str>) -> PathBuf {
  if let Some(value) = path {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
      return PathBuf::from(trimmed);
    }
  }

  let mut default = if cfg!(target_os = "windows") {
    env::var("USERPROFILE")
      .map(PathBuf::from)
      .unwrap_or_else(|_| env::temp_dir())
  } else {
    env::var("HOME")
      .map(PathBuf::from)
      .unwrap_or_else(|_| env::temp_dir())
  };
  default.push("Downloads");
  default.push("castor-sftp");
  default
}

fn unique_local_path(dir: &Path, filename: &str) -> PathBuf {
  let mut target = dir.join(filename);
  if !target.exists() {
    return target;
  }

  let source_path = Path::new(filename);
  let stem = source_path
    .file_stem()
    .map(|item| item.to_string_lossy().to_string())
    .filter(|item| !item.is_empty())
    .unwrap_or_else(|| "download".to_string());
  let ext = source_path.extension().map(|item| item.to_string_lossy().to_string());

  let mut index: u32 = 1;
  loop {
    let candidate_name = if let Some(ext) = &ext {
      format!("{stem}-{index}.{ext}")
    } else {
      format!("{stem}-{index}")
    };

    target = dir.join(candidate_name);
    if !target.exists() {
      return target;
    }

    index = index.saturating_add(1);
  }
}

fn unique_remote_path(sftp: &ssh2::Sftp, dir: &str, filename: &str) -> String {
  let mut target = join_remote_path(dir, filename);
  if sftp.stat(Path::new(&target)).is_err() {
    return target;
  }

  let source_path = Path::new(filename);
  let stem = source_path
    .file_stem()
    .map(|item| item.to_string_lossy().to_string())
    .filter(|item| !item.is_empty())
    .unwrap_or_else(|| "upload".to_string());
  let ext = source_path.extension().map(|item| item.to_string_lossy().to_string());

  let mut index: u32 = 1;
  loop {
    let candidate_name = if let Some(ext) = &ext {
      format!("{stem}-{index}.{ext}")
    } else {
      format!("{stem}-{index}")
    };
    target = join_remote_path(dir, &candidate_name);
    if sftp.stat(Path::new(&target)).is_err() {
      return target;
    }
    index = index.saturating_add(1);
  }
}
