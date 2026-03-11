use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct LocalListRequest {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LocalRenameRequest {
    pub path: String,
    pub new_name: String,
}

#[derive(Debug, Deserialize)]
pub struct LocalDeleteRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct LocalCreateDirRequest {
    pub parent_path: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct LocalFsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LocalListResponse {
    pub path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<LocalFsEntry>,
}

pub fn list_local_dir(request: LocalListRequest) -> Result<LocalListResponse, String> {
    let resolved = resolve_local_path(request.path.as_deref())?;
    let metadata = fs::metadata(&resolved)
        .map_err(|err| format!("failed to read metadata {}: {err}", resolved.display()))?;

    if !metadata.is_dir() {
        return Err(format!("{} is not a directory", resolved.display()));
    }

    let mut entries = fs::read_dir(&resolved)
        .map_err(|err| format!("failed to read directory {}: {err}", resolved.display()))?
        .filter_map(|item| item.ok())
        .filter_map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.is_empty() {
                return None;
            }

            let path = entry.path();
            let meta = entry.metadata().ok()?;
            let is_dir = meta.is_dir();
            let size = if is_dir { None } else { Some(meta.len()) };
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs());

            Some(LocalFsEntry {
                name: file_name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                size,
                modified,
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| match (left.is_dir, right.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });

    Ok(LocalListResponse {
        path: resolved.to_string_lossy().to_string(),
        parent_path: parent_path(&resolved),
        entries,
    })
}

pub fn rename_local_entry(request: LocalRenameRequest) -> Result<(), String> {
    let source = resolve_local_path(Some(&request.path))?;
    let new_name = request.new_name.trim();
    if new_name.is_empty()
        || new_name == "."
        || new_name == ".."
        || new_name.contains('/')
        || new_name.contains('\\')
    {
        return Err("invalid new name".to_string());
    }

    let parent = source
        .parent()
        .ok_or_else(|| format!("failed to resolve parent for {}", source.display()))?;
    let target = parent.join(new_name);

    fs::rename(&source, &target).map_err(|err| {
        format!(
            "failed to rename {} to {}: {err}",
            source.display(),
            target.display()
        )
    })
}

pub fn delete_local_entry(request: LocalDeleteRequest) -> Result<(), String> {
    let target = resolve_local_path(Some(&request.path))?;
    let metadata = fs::metadata(&target)
        .map_err(|err| format!("failed to read metadata {}: {err}", target.display()))?;

    if metadata.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|err| format!("failed to delete directory {}: {err}", target.display()))?;
    } else {
        fs::remove_file(&target)
            .map_err(|err| format!("failed to delete file {}: {err}", target.display()))?;
    }

    Ok(())
}

pub fn create_local_dir(request: LocalCreateDirRequest) -> Result<(), String> {
    let parent = resolve_local_path(Some(&request.parent_path))?;
    let name = request.name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("invalid directory name".to_string());
    }

    let target = parent.join(name);
    fs::create_dir(&target)
        .map_err(|err| format!("failed to create directory {}: {err}", target.display()))
}

fn resolve_local_path(path: Option<&str>) -> Result<PathBuf, String> {
    let candidate = if let Some(raw) = path {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            default_local_root()?
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        default_local_root()?
    };

    let expanded = if candidate.is_absolute() {
        candidate
    } else {
        env::current_dir()
            .map_err(|err| format!("failed to resolve current dir: {err}"))?
            .join(candidate)
    };

    expanded
        .canonicalize()
        .map_err(|err| format!("failed to resolve path {}: {err}", expanded.display()))
}

fn default_local_root() -> Result<PathBuf, String> {
    if let Ok(home) = env::var("HOME") {
        return Ok(PathBuf::from(home));
    }

    if let Ok(home) = env::var("USERPROFILE") {
        return Ok(PathBuf::from(home));
    }

    env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))
}

fn parent_path(path: &Path) -> Option<String> {
    path.parent()
        .map(|parent| parent.to_string_lossy().to_string())
}
