mod commands;
mod deploy;
mod localfs;
mod profiles;
mod runtime;
mod runtime_deploy;
mod sftp;
mod ssh;

use commands::{
    apply_runtime_deploy, apply_systemd_deploy_service, cancel_runtime_deploy,
    cancel_server_runtime_probe, cancel_sftp_transfer, connect_local_terminal, connect_ssh,
    control_systemd_deploy_service, delete_connection_profile, delete_systemd_deploy_service,
    deploy_systemd_service, disconnect_ssh, get_remote_systemd_service_template,
    get_systemd_deploy_service_logs, get_systemd_deploy_service_status, list_connection_profiles,
    list_local_dir, list_remote_systemd_services, list_runtime_deploy_versions, list_sessions,
    list_systemd_deploy_services, local_create_dir, local_delete_entry, local_rename_entry,
    plan_runtime_deploy, preflight_server_runtime_probe, probe_server_runtimes, resize_ssh,
    send_ssh_input, sftp_connect, sftp_create_dir, sftp_delete_entry, sftp_disconnect,
    sftp_download_file, sftp_list_dir, sftp_rename_entry, sftp_set_permissions,
    sftp_upload_path, test_ssh_connection, upsert_connection_profile, upsert_systemd_deploy_service,
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
            preflight_server_runtime_probe,
            probe_server_runtimes,
            cancel_server_runtime_probe,
            plan_runtime_deploy,
            apply_runtime_deploy,
            cancel_runtime_deploy,
            list_runtime_deploy_versions,
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
            sftp_set_permissions,
            deploy_systemd_service,
            list_systemd_deploy_services,
            upsert_systemd_deploy_service,
            delete_systemd_deploy_service,
            apply_systemd_deploy_service,
            get_systemd_deploy_service_status,
            get_systemd_deploy_service_logs,
            control_systemd_deploy_service,
            list_remote_systemd_services,
            get_remote_systemd_service_template
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Castor");
}
