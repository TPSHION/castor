mod commands;
mod deploy;
mod localfs;
mod nginx;
mod profiles;
mod proxy;
mod runtime;
mod runtime_deploy;
mod sftp;
mod ssh;
mod ssl;

use commands::{
    apply_runtime_deploy, apply_server_proxy_node, apply_ssl_certificate,
    apply_systemd_deploy_service, cancel_runtime_deploy, cancel_server_runtime_probe,
    cancel_sftp_transfer, connect_local_terminal, connect_ssh, control_nginx_service,
    control_systemd_deploy_service, delete_connection_profile, delete_nginx_service,
    delete_server_proxy_config, delete_ssl_certificate, delete_systemd_deploy_service,
    deploy_nginx_service, deploy_systemd_service, disconnect_ssh, discover_remote_nginx,
    get_nginx_service_status, get_remote_systemd_service_template, get_server_proxy_runtime_status,
    get_systemd_deploy_service_logs, get_systemd_deploy_service_status,
    import_nginx_service_by_params, issue_ssl_certificate, list_connection_profiles,
    list_local_dir, list_nginx_services, list_remote_systemd_services,
    list_runtime_deploy_versions, list_server_proxy_configs, list_sessions, list_ssl_certificates,
    list_systemd_deploy_services, local_create_dir, local_delete_entry, local_rename_entry,
    parse_nginx_service_config, pick_local_directory, plan_runtime_deploy,
    preflight_server_runtime_probe, probe_server_runtimes, read_nginx_service_config_file,
    renew_ssl_certificate, resize_ssh, save_nginx_service_config_file, send_ssh_input,
    sftp_connect, sftp_create_dir, sftp_delete_entry, sftp_disconnect, sftp_download_file,
    sftp_list_dir, sftp_rename_entry, sftp_set_permissions, sftp_upload_path,
    sync_server_proxy_subscription, sync_ssl_certificate_status, test_nginx_service_config,
    test_server_proxy_connectivity, test_ssh_connection, upsert_connection_profile,
    upsert_nginx_service, upsert_ssl_certificate, upsert_systemd_deploy_service,
    validate_nginx_service_config_content,
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
            list_ssl_certificates,
            upsert_ssl_certificate,
            delete_ssl_certificate,
            issue_ssl_certificate,
            apply_ssl_certificate,
            renew_ssl_certificate,
            sync_ssl_certificate_status,
            list_server_proxy_configs,
            sync_server_proxy_subscription,
            delete_server_proxy_config,
            apply_server_proxy_node,
            test_server_proxy_connectivity,
            get_server_proxy_runtime_status,
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
            pick_local_directory,
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
            get_remote_systemd_service_template,
            list_nginx_services,
            upsert_nginx_service,
            delete_nginx_service,
            discover_remote_nginx,
            import_nginx_service_by_params,
            get_nginx_service_status,
            control_nginx_service,
            deploy_nginx_service,
            test_nginx_service_config,
            parse_nginx_service_config,
            read_nginx_service_config_file,
            save_nginx_service_config_file,
            validate_nginx_service_config_content
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Castor");
}
