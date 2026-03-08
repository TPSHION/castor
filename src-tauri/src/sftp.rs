use std::env;
use std::fs::{self, File};
use std::net::TcpStream;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ssh2::{FileStat, Session};

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
  pub local_dir: Option<String>
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

pub fn list_dir(request: SftpListRequest) -> Result<Vec<SftpEntry>, String> {
  let normalized_path = normalize_remote_path(request.path.as_deref().unwrap_or("/"));
  let (_session, sftp) = connect_sftp(
    request.host,
    request.port,
    request.username,
    request.auth
  )?;

  let entries = sftp
    .readdir(Path::new(&normalized_path))
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

      let path = join_remote_path(&normalized_path, &name);
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

pub fn download_file(request: SftpDownloadRequest) -> Result<SftpDownloadResult, String> {
  let remote_path = normalize_remote_path(&request.remote_path);
  let (_session, sftp) = connect_sftp(
    request.host,
    request.port,
    request.username,
    request.auth
  )?;

  let file_name = Path::new(&remote_path)
    .file_name()
    .map(|name| name.to_string_lossy().to_string())
    .filter(|name| !name.trim().is_empty())
    .ok_or_else(|| format!("invalid remote path: {remote_path}"))?;

  let target_dir = resolve_download_dir(request.local_dir.as_deref());
  fs::create_dir_all(&target_dir)
    .map_err(|err| format!("failed to prepare local directory {}: {err}", target_dir.display()))?;
  let local_path = unique_local_path(&target_dir, &file_name);

  let bytes = download_remote_path(&sftp, &remote_path, &local_path)?;

  Ok(SftpDownloadResult {
    local_path: local_path.to_string_lossy().to_string(),
    bytes
  })
}

pub fn rename_entry(request: SftpRenameRequest) -> Result<(), String> {
  let source = normalize_remote_path(&request.path);
  let new_name = request.new_name.trim();
  if !is_valid_remote_name(new_name) {
    return Err("invalid new name".to_string());
  }

  let (_session, sftp) = connect_sftp(
    request.host,
    request.port,
    request.username,
    request.auth
  )?;

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
  let (_session, sftp) = connect_sftp(
    request.host,
    request.port,
    request.username,
    request.auth
  )?;

  remove_remote_path_recursive(&sftp, &path)
}

pub fn create_dir(request: SftpCreateDirRequest) -> Result<(), String> {
  let parent = normalize_remote_path(&request.parent_path);
  let name = request.name.trim();
  if !is_valid_remote_name(name) {
    return Err("invalid directory name".to_string());
  }

  let target = join_remote_path(&parent, name);
  let (_session, sftp) = connect_sftp(
    request.host,
    request.port,
    request.username,
    request.auth
  )?;

  sftp
    .mkdir(Path::new(&target), 0o755)
    .map_err(|err| format!("failed to create directory {target}: {err}"))
}

pub fn set_permissions(request: SftpSetPermissionsRequest) -> Result<(), String> {
  if request.permissions > 0o7777 {
    return Err("permissions must be a valid octal mode".to_string());
  }

  let path = normalize_remote_path(&request.path);
  let (_session, sftp) = connect_sftp(
    request.host,
    request.port,
    request.username,
    request.auth
  )?;

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
  host: String,
  port: Option<u16>,
  username: String,
  auth: AuthConfig
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
      .userauth_password(&username, &password)
      .map_err(|err| format!("password authentication failed: {err}"))?,
    AuthConfig::PrivateKey {
      private_key,
      passphrase
    } => session
      .userauth_pubkey_memory(&username, None, &private_key, passphrase.as_deref())
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

fn download_remote_path(sftp: &ssh2::Sftp, remote_path: &str, local_path: &Path) -> Result<u64, String> {
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

    return std::io::copy(&mut remote_file, &mut local_file)
      .map_err(|err| format!("failed to download remote file {remote_path}: {err}"));
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
    total_bytes += download_remote_path(sftp, &next_remote_path, &next_local_path)?;
  }

  Ok(total_bytes)
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
