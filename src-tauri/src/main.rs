mod commands;
mod localfs;
mod profiles;
mod sftp;
mod ssh;

use commands::{
  cancel_sftp_transfer, connect_local_terminal, connect_ssh, delete_connection_profile, disconnect_ssh,
  list_connection_profiles, list_local_dir, list_sessions, local_create_dir, local_delete_entry,
  local_rename_entry, resize_ssh, send_ssh_input, sftp_connect, sftp_create_dir, sftp_delete_entry,
  sftp_disconnect,
  sftp_download_file, sftp_list_dir, sftp_rename_entry, sftp_set_permissions, sftp_upload_path,
  test_ssh_connection,
  upsert_connection_profile
};
use ssh::SshState;

fn main() {
  tauri::Builder::default()
    .manage(SshState::default())
    .invoke_handler(tauri::generate_handler![
      connect_ssh,
      connect_local_terminal,
      send_ssh_input,
      resize_ssh,
      disconnect_ssh,
      test_ssh_connection,
      list_sessions,
      list_connection_profiles,
      upsert_connection_profile,
      delete_connection_profile,
      sftp_connect,
      sftp_disconnect,
      sftp_list_dir,
      sftp_download_file,
      sftp_upload_path,
      cancel_sftp_transfer,
      list_local_dir,
      local_rename_entry,
      local_delete_entry,
      local_create_dir,
      sftp_rename_entry,
      sftp_delete_entry,
      sftp_create_dir,
      sftp_set_permissions
    ])
    .run(tauri::generate_context!())
    .expect("failed to run Castor");
}
