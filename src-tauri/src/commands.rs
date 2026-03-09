use tauri::{AppHandle, State};

use crate::localfs::{
  create_local_dir as create_local_dir_impl, delete_local_entry as delete_local_entry_impl,
  list_local_dir as list_local_dir_impl, rename_local_entry as rename_local_entry_impl,
  LocalCreateDirRequest, LocalDeleteRequest, LocalListRequest, LocalListResponse, LocalRenameRequest
};
use crate::profiles::{
  delete_connection_profile as delete_profile_impl, list_connection_profiles as list_profiles_impl,
  upsert_connection_profile as upsert_profile_impl, ConnectionProfile, DeleteConnectionProfileRequest,
  UpsertConnectionProfileRequest
};
use crate::sftp::{
  cancel_transfer as cancel_sftp_transfer_impl,
  connect_session as sftp_connect_impl,
  create_dir as sftp_create_dir_impl,
  delete_entry as sftp_delete_entry_impl,
  disconnect_session as sftp_disconnect_impl,
  download_file as sftp_download_file_impl, list_dir as sftp_list_dir_impl, SftpDownloadRequest,
  SftpDownloadResult, SftpEntry, SftpListRequest, SftpConnectRequest, SftpCreateDirRequest, SftpDeleteRequest,
  CancelSftpTransferRequest,
  SftpRenameRequest, SftpSetPermissionsRequest, SftpUploadRequest, SftpUploadResult,
  rename_entry as sftp_rename_entry_impl, set_permissions as sftp_set_permissions_impl,
  upload_path as sftp_upload_path_impl
};
use crate::ssh::{
  ConnectRequest, DisconnectRequest, LocalConnectRequest, ResizeRequest, SendInputRequest,
  SessionSummary, SshState
};

#[tauri::command]
pub async fn connect_ssh(
  app: AppHandle,
  state: State<'_, SshState>,
  request: ConnectRequest
) -> Result<SessionSummary, String> {
  state.connect(app, request).await
}

#[tauri::command]
pub async fn connect_local_terminal(
  app: AppHandle,
  state: State<'_, SshState>,
  request: LocalConnectRequest
) -> Result<SessionSummary, String> {
  state.connect_local(app, request).await
}

#[tauri::command]
pub fn send_ssh_input(
  state: State<'_, SshState>,
  request: SendInputRequest
) -> Result<(), String> {
  state.send_input(request)
}

#[tauri::command]
pub fn resize_ssh(state: State<'_, SshState>, request: ResizeRequest) -> Result<(), String> {
  state.resize(request)
}

#[tauri::command]
pub fn disconnect_ssh(
  state: State<'_, SshState>,
  request: DisconnectRequest
) -> Result<(), String> {
  state.disconnect(request)
}

#[tauri::command]
pub fn list_sessions(state: State<'_, SshState>) -> Vec<SessionSummary> {
  state.list_sessions()
}

#[tauri::command]
pub async fn test_ssh_connection(
  state: State<'_, SshState>,
  request: ConnectRequest
) -> Result<String, String> {
  state.test_connection(request).await
}

#[tauri::command]
pub fn list_connection_profiles(app: AppHandle) -> Result<Vec<ConnectionProfile>, String> {
  list_profiles_impl(&app)
}

#[tauri::command]
pub fn upsert_connection_profile(
  app: AppHandle,
  request: UpsertConnectionProfileRequest
) -> Result<ConnectionProfile, String> {
  upsert_profile_impl(&app, request)
}

#[tauri::command]
pub fn delete_connection_profile(
  app: AppHandle,
  request: DeleteConnectionProfileRequest
) -> Result<(), String> {
  delete_profile_impl(&app, request)
}

#[tauri::command]
pub async fn sftp_list_dir(request: SftpListRequest) -> Result<Vec<SftpEntry>, String> {
  tauri::async_runtime::spawn_blocking(move || sftp_list_dir_impl(request))
    .await
    .map_err(|err| format!("failed to join sftp list task: {err}"))?
}

#[tauri::command]
pub async fn sftp_connect(request: SftpConnectRequest) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || sftp_connect_impl(request))
    .await
    .map_err(|err| format!("failed to join sftp connect task: {err}"))?
}

#[tauri::command]
pub fn sftp_disconnect(request: SftpConnectRequest) -> Result<(), String> {
  sftp_disconnect_impl(request)
}

#[tauri::command]
pub async fn sftp_download_file(
  app: AppHandle,
  request: SftpDownloadRequest
) -> Result<SftpDownloadResult, String> {
  let app_handle = app.clone();
  tauri::async_runtime::spawn_blocking(move || sftp_download_file_impl(&app_handle, request))
    .await
    .map_err(|err| format!("failed to join download task: {err}"))?
}

#[tauri::command]
pub async fn sftp_upload_path(
  app: AppHandle,
  request: SftpUploadRequest
) -> Result<SftpUploadResult, String> {
  let app_handle = app.clone();
  tauri::async_runtime::spawn_blocking(move || sftp_upload_path_impl(&app_handle, request))
    .await
    .map_err(|err| format!("failed to join upload task: {err}"))?
}

#[tauri::command]
pub fn cancel_sftp_transfer(request: CancelSftpTransferRequest) -> Result<(), String> {
  cancel_sftp_transfer_impl(request)
}

#[tauri::command]
pub fn list_local_dir(request: LocalListRequest) -> Result<LocalListResponse, String> {
  list_local_dir_impl(request)
}

#[tauri::command]
pub fn local_rename_entry(request: LocalRenameRequest) -> Result<(), String> {
  rename_local_entry_impl(request)
}

#[tauri::command]
pub fn local_delete_entry(request: LocalDeleteRequest) -> Result<(), String> {
  delete_local_entry_impl(request)
}

#[tauri::command]
pub fn local_create_dir(request: LocalCreateDirRequest) -> Result<(), String> {
  create_local_dir_impl(request)
}

#[tauri::command]
pub fn sftp_rename_entry(request: SftpRenameRequest) -> Result<(), String> {
  sftp_rename_entry_impl(request)
}

#[tauri::command]
pub fn sftp_delete_entry(request: SftpDeleteRequest) -> Result<(), String> {
  sftp_delete_entry_impl(request)
}

#[tauri::command]
pub fn sftp_create_dir(request: SftpCreateDirRequest) -> Result<(), String> {
  sftp_create_dir_impl(request)
}

#[tauri::command]
pub fn sftp_set_permissions(request: SftpSetPermissionsRequest) -> Result<(), String> {
  sftp_set_permissions_impl(request)
}
