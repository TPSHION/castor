use tauri::{AppHandle, State};

use crate::deploy::{
    apply_systemd_deploy_service as apply_systemd_deploy_service_impl,
    control_systemd_deploy_service as control_systemd_deploy_service_impl,
    delete_systemd_deploy_service as delete_systemd_deploy_service_impl,
    deploy_systemd_service as deploy_systemd_service_impl,
    get_remote_systemd_service_template as get_remote_systemd_service_template_impl,
    get_systemd_deploy_service_logs as get_systemd_deploy_service_logs_impl,
    get_systemd_deploy_service_status as get_systemd_deploy_service_status_impl,
    list_remote_systemd_services as list_remote_systemd_services_impl,
    list_systemd_deploy_services as list_systemd_deploy_services_impl,
    upsert_systemd_deploy_service as upsert_systemd_deploy_service_impl,
    ApplySystemdDeployServiceRequest, ControlSystemdDeployServiceRequest,
    DeleteSystemdDeployServiceRequest, DeploySystemdServiceRequest, DeploySystemdServiceResult,
    GetRemoteSystemdServiceTemplateRequest, GetSystemdDeployServiceLogsRequest,
    GetSystemdDeployServiceStatusRequest, ListRemoteSystemdServicesRequest,
    RemoteSystemdServiceItem, RemoteSystemdServiceTemplate, SystemdDeployService,
    SystemdServiceActionResult, SystemdServiceLogsResult, SystemdServiceStatus,
    UpsertSystemdDeployServiceRequest,
};
use crate::localfs::{
    create_local_dir as create_local_dir_impl, delete_local_entry as delete_local_entry_impl,
    list_local_dir as list_local_dir_impl, rename_local_entry as rename_local_entry_impl,
    LocalCreateDirRequest, LocalDeleteRequest, LocalListRequest, LocalListResponse,
    LocalRenameRequest,
};
use crate::nginx::{
    control_nginx_service as control_nginx_service_impl,
    delete_nginx_service as delete_nginx_service_impl,
    deploy_nginx_service as deploy_nginx_service_impl,
    discover_remote_nginx as discover_remote_nginx_impl,
    get_nginx_service_status as get_nginx_service_status_impl,
    import_nginx_service_by_params as import_nginx_service_by_params_impl,
    list_nginx_service_config_files as list_nginx_service_config_files_impl,
    list_nginx_services as list_nginx_services_impl,
    parse_nginx_service_config as parse_nginx_service_config_impl,
    read_nginx_service_config_file as read_nginx_service_config_file_impl,
    save_nginx_service_config_file as save_nginx_service_config_file_impl,
    test_nginx_service_config as test_nginx_service_config_impl,
    upsert_nginx_service as upsert_nginx_service_impl,
    validate_nginx_service_config_content as validate_nginx_service_config_content_impl,
    ControlNginxServiceRequest, DeleteNginxServiceRequest, DeployNginxServiceRequest,
    DeployNginxServiceResult, DiscoverRemoteNginxRequest, GetNginxServiceStatusRequest,
    ImportNginxServiceByParamsRequest, ListNginxServiceConfigFilesRequest, NginxConfigTestResult,
    NginxConfigValidationResult, NginxParsedConfigResult, NginxService, NginxServiceActionResult,
    NginxServiceConfigFileListResult, NginxServiceConfigFileResult,
    NginxServiceConfigFileSaveResult, NginxServiceStatus, ParseNginxServiceConfigRequest,
    ReadNginxServiceConfigFileRequest, RemoteNginxDiscoveryResult,
    SaveNginxServiceConfigFileRequest, TestNginxServiceConfigRequest, UpsertNginxServiceRequest,
    ValidateNginxServiceConfigContentRequest,
};
use crate::profiles::{
    delete_connection_profile as delete_profile_impl,
    list_connection_profiles as list_profiles_impl,
    upsert_connection_profile as upsert_profile_impl, ConnectionProfile,
    DeleteConnectionProfileRequest, UpsertConnectionProfileRequest,
};
use crate::proxy::{
    apply_mihomo_proxy_node as apply_mihomo_proxy_node_impl,
    apply_server_proxy_node as apply_server_proxy_node_impl,
    cancel_server_proxy_apply as cancel_server_proxy_apply_impl,
    delete_server_proxy_config as delete_server_proxy_config_impl,
    get_mihomo_runtime_status as get_mihomo_runtime_status_impl,
    get_server_proxy_runtime_config as get_server_proxy_runtime_config_impl,
    get_server_proxy_runtime_status as get_server_proxy_runtime_status_impl,
    list_server_proxy_configs as list_server_proxy_configs_impl,
    sync_server_proxy_subscription as sync_server_proxy_subscription_impl,
    test_server_proxy_connectivity as test_server_proxy_connectivity_impl,
    ApplyMihomoProxyNodeRequest, ApplyServerProxyNodeRequest, CancelServerProxyApplyRequest,
    DeleteServerProxyConfigRequest, GetMihomoRuntimeStatusRequest,
    GetServerProxyRuntimeConfigRequest, GetServerProxyRuntimeStatusRequest,
    ListServerProxyConfigsRequest, MihomoProxyApplyResult, MihomoRuntimeStatusResult,
    ServerProxyApplyResult, ServerProxyCancelResult, ServerProxyConfig,
    ServerProxyConnectivityResult, ServerProxyRuntimeConfigResult, ServerProxyRuntimeStatusResult,
    SyncServerProxySubscriptionRequest, TestServerProxyConnectivityRequest,
};
use crate::runtime::{
    cancel_server_runtime_probe as cancel_server_runtime_probe_impl,
    preflight_server_runtime_probe as preflight_server_runtime_probe_impl,
    probe_server_runtimes as probe_server_runtimes_impl, CancelServerRuntimeProbeRequest,
    PreflightServerRuntimeProbeRequest, ProbeServerRuntimesRequest, RuntimeProbeResult,
};
use crate::runtime_deploy::{
    apply_runtime_deploy as apply_runtime_deploy_impl,
    cancel_runtime_deploy as cancel_runtime_deploy_impl,
    list_runtime_deploy_versions as list_runtime_deploy_versions_impl,
    plan_runtime_deploy as plan_runtime_deploy_impl, CancelRuntimeDeployRequest,
    ListRuntimeDeployVersionsRequest, RuntimeDeployApplyRequest, RuntimeDeployApplyResult,
    RuntimeDeployPlanRequest, RuntimeDeployPlanResult, RuntimeDeployVersionsResult,
};
use crate::sftp::{
    cancel_transfer as cancel_sftp_transfer_impl, connect_session as sftp_connect_impl,
    create_dir as sftp_create_dir_impl, delete_entry as sftp_delete_entry_impl,
    disconnect_session as sftp_disconnect_impl, download_file as sftp_download_file_impl,
    list_dir as sftp_list_dir_impl, rename_entry as sftp_rename_entry_impl,
    set_permissions as sftp_set_permissions_impl, upload_path as sftp_upload_path_impl,
    CancelSftpTransferRequest, SftpConnectRequest, SftpCreateDirRequest, SftpDeleteRequest,
    SftpDownloadRequest, SftpDownloadResult, SftpEntry, SftpListRequest, SftpRenameRequest,
    SftpSetPermissionsRequest, SftpUploadRequest, SftpUploadResult,
};
use crate::ssh::{
    ConnectRequest, DisconnectRequest, LocalConnectRequest, ResizeRequest, SendInputRequest,
    SessionSummary, SshState,
};
use crate::ssl::{
    apply_ssl_certificate as apply_ssl_certificate_impl,
    delete_ssl_certificate as delete_ssl_certificate_impl,
    issue_ssl_certificate as issue_ssl_certificate_impl,
    list_ssl_certificates as list_ssl_certificates_impl,
    renew_ssl_certificate as renew_ssl_certificate_impl,
    sync_ssl_certificate_status as sync_ssl_certificate_status_impl,
    upsert_ssl_certificate as upsert_ssl_certificate_impl, ApplySslCertificateRequest,
    DeleteSslCertificateRequest, IssueSslCertificateRequest, ListSslCertificatesRequest,
    RenewSslCertificateRequest, SslCertificate, SslCertificateOperationResult,
    SyncSslCertificateStatusRequest, UpsertSslCertificateRequest,
};

#[tauri::command]
pub async fn connect_ssh(
    app: AppHandle,
    state: State<'_, SshState>,
    request: ConnectRequest,
) -> Result<SessionSummary, String> {
    state.connect(app, request).await
}

#[tauri::command]
pub async fn connect_local_terminal(
    app: AppHandle,
    state: State<'_, SshState>,
    request: LocalConnectRequest,
) -> Result<SessionSummary, String> {
    state.connect_local(app, request).await
}

#[tauri::command]
pub fn send_ssh_input(state: State<'_, SshState>, request: SendInputRequest) -> Result<(), String> {
    state.send_input(request)
}

#[tauri::command]
pub fn resize_ssh(state: State<'_, SshState>, request: ResizeRequest) -> Result<(), String> {
    state.resize(request)
}

#[tauri::command]
pub fn disconnect_ssh(
    state: State<'_, SshState>,
    request: DisconnectRequest,
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
    request: ConnectRequest,
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
    request: UpsertConnectionProfileRequest,
) -> Result<ConnectionProfile, String> {
    upsert_profile_impl(&app, request)
}

#[tauri::command]
pub fn delete_connection_profile(
    app: AppHandle,
    request: DeleteConnectionProfileRequest,
) -> Result<(), String> {
    delete_profile_impl(&app, request)
}

#[tauri::command]
pub fn list_ssl_certificates(
    app: AppHandle,
    request: ListSslCertificatesRequest,
) -> Result<Vec<SslCertificate>, String> {
    list_ssl_certificates_impl(&app, request)
}

#[tauri::command]
pub fn upsert_ssl_certificate(
    app: AppHandle,
    request: UpsertSslCertificateRequest,
) -> Result<SslCertificate, String> {
    upsert_ssl_certificate_impl(&app, request)
}

#[tauri::command]
pub fn delete_ssl_certificate(
    app: AppHandle,
    request: DeleteSslCertificateRequest,
) -> Result<(), String> {
    delete_ssl_certificate_impl(&app, request)
}

#[tauri::command]
pub async fn apply_ssl_certificate(
    app: AppHandle,
    request: ApplySslCertificateRequest,
) -> Result<SslCertificateOperationResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || apply_ssl_certificate_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join ssl apply task: {err}"))?
}

#[tauri::command]
pub async fn issue_ssl_certificate(
    app: AppHandle,
    request: IssueSslCertificateRequest,
) -> Result<SslCertificateOperationResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || issue_ssl_certificate_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join ssl issue task: {err}"))?
}

#[tauri::command]
pub async fn renew_ssl_certificate(
    app: AppHandle,
    request: RenewSslCertificateRequest,
) -> Result<SslCertificateOperationResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || renew_ssl_certificate_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join ssl renew task: {err}"))?
}

#[tauri::command]
pub async fn sync_ssl_certificate_status(
    app: AppHandle,
    request: SyncSslCertificateStatusRequest,
) -> Result<SslCertificate, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        sync_ssl_certificate_status_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join ssl sync task: {err}"))?
}

#[tauri::command]
pub fn list_server_proxy_configs(
    app: AppHandle,
    request: ListServerProxyConfigsRequest,
) -> Result<Vec<ServerProxyConfig>, String> {
    list_server_proxy_configs_impl(&app, request)
}

#[tauri::command]
pub async fn sync_server_proxy_subscription(
    app: AppHandle,
    request: SyncServerProxySubscriptionRequest,
) -> Result<ServerProxyConfig, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        sync_server_proxy_subscription_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join server proxy subscription sync task: {err}"))?
}

#[tauri::command]
pub fn delete_server_proxy_config(
    app: AppHandle,
    request: DeleteServerProxyConfigRequest,
) -> Result<(), String> {
    delete_server_proxy_config_impl(&app, request)
}

#[tauri::command]
pub async fn apply_server_proxy_node(
    app: AppHandle,
    request: ApplyServerProxyNodeRequest,
) -> Result<ServerProxyApplyResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || apply_server_proxy_node_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join apply server proxy node task: {err}"))?
}

#[tauri::command]
pub async fn apply_mihomo_proxy_node(
    app: AppHandle,
    request: ApplyMihomoProxyNodeRequest,
) -> Result<MihomoProxyApplyResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || apply_mihomo_proxy_node_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join apply mihomo proxy node task: {err}"))?
}

#[tauri::command]
pub async fn test_server_proxy_connectivity(
    app: AppHandle,
    request: TestServerProxyConnectivityRequest,
) -> Result<ServerProxyConnectivityResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        test_server_proxy_connectivity_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join test server proxy connectivity task: {err}"))?
}

#[tauri::command]
pub async fn get_server_proxy_runtime_status(
    app: AppHandle,
    request: GetServerProxyRuntimeStatusRequest,
) -> Result<ServerProxyRuntimeStatusResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        get_server_proxy_runtime_status_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join get server proxy runtime status task: {err}"))?
}

#[tauri::command]
pub async fn get_mihomo_runtime_status(
    app: AppHandle,
    request: GetMihomoRuntimeStatusRequest,
) -> Result<MihomoRuntimeStatusResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        get_mihomo_runtime_status_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join get mihomo runtime status task: {err}"))?
}

#[tauri::command]
pub async fn get_server_proxy_runtime_config(
    app: AppHandle,
    request: GetServerProxyRuntimeConfigRequest,
) -> Result<ServerProxyRuntimeConfigResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        get_server_proxy_runtime_config_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join get server proxy runtime config task: {err}"))?
}

#[tauri::command]
pub async fn cancel_server_proxy_apply(
    app: AppHandle,
    request: CancelServerProxyApplyRequest,
) -> Result<ServerProxyCancelResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        cancel_server_proxy_apply_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join cancel server proxy apply task: {err}"))?
}

#[tauri::command]
pub async fn probe_server_runtimes(
    app: AppHandle,
    request: ProbeServerRuntimesRequest,
) -> Result<Vec<RuntimeProbeResult>, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || probe_server_runtimes_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join runtime probe task: {err}"))?
}

#[tauri::command]
pub fn preflight_server_runtime_probe(
    app: AppHandle,
    request: PreflightServerRuntimeProbeRequest,
) -> Result<(), String> {
    preflight_server_runtime_probe_impl(&app, request)
}

#[tauri::command]
pub fn cancel_server_runtime_probe(request: CancelServerRuntimeProbeRequest) -> Result<(), String> {
    cancel_server_runtime_probe_impl(request)
}

#[tauri::command]
pub fn plan_runtime_deploy(
    app: AppHandle,
    request: RuntimeDeployPlanRequest,
) -> Result<RuntimeDeployPlanResult, String> {
    plan_runtime_deploy_impl(&app, request)
}

#[tauri::command]
pub async fn apply_runtime_deploy(
    app: AppHandle,
    request: RuntimeDeployApplyRequest,
) -> Result<RuntimeDeployApplyResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || apply_runtime_deploy_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join runtime deploy task: {err}"))?
}

#[tauri::command]
pub fn cancel_runtime_deploy(request: CancelRuntimeDeployRequest) -> Result<(), String> {
    cancel_runtime_deploy_impl(request)
}

#[tauri::command]
pub async fn list_runtime_deploy_versions(
    app: AppHandle,
    request: ListRuntimeDeployVersionsRequest,
) -> Result<RuntimeDeployVersionsResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        list_runtime_deploy_versions_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join runtime deploy versions task: {err}"))?
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
    request: SftpDownloadRequest,
) -> Result<SftpDownloadResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || sftp_download_file_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join download task: {err}"))?
}

#[tauri::command]
pub async fn sftp_upload_path(
    app: AppHandle,
    request: SftpUploadRequest,
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
pub fn pick_local_directory() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn pick_local_file() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .add_filter("Private Key", &["pem", "key", "ppk"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string()))
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

#[tauri::command]
pub async fn deploy_systemd_service(
    app: AppHandle,
    request: DeploySystemdServiceRequest,
) -> Result<DeploySystemdServiceResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || deploy_systemd_service_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join systemd deploy task: {err}"))?
}

#[tauri::command]
pub fn list_systemd_deploy_services(app: AppHandle) -> Result<Vec<SystemdDeployService>, String> {
    list_systemd_deploy_services_impl(&app)
}

#[tauri::command]
pub fn upsert_systemd_deploy_service(
    app: AppHandle,
    request: UpsertSystemdDeployServiceRequest,
) -> Result<SystemdDeployService, String> {
    upsert_systemd_deploy_service_impl(&app, request)
}

#[tauri::command]
pub async fn delete_systemd_deploy_service(
    app: AppHandle,
    request: DeleteSystemdDeployServiceRequest,
) -> Result<(), String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        delete_systemd_deploy_service_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join delete systemd deploy task: {err}"))?
}

#[tauri::command]
pub async fn apply_systemd_deploy_service(
    app: AppHandle,
    request: ApplySystemdDeployServiceRequest,
) -> Result<DeploySystemdServiceResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        apply_systemd_deploy_service_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join apply systemd deploy task: {err}"))?
}

#[tauri::command]
pub async fn get_systemd_deploy_service_status(
    app: AppHandle,
    request: GetSystemdDeployServiceStatusRequest,
) -> Result<SystemdServiceStatus, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        get_systemd_deploy_service_status_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join systemd status task: {err}"))?
}

#[tauri::command]
pub async fn get_systemd_deploy_service_logs(
    app: AppHandle,
    request: GetSystemdDeployServiceLogsRequest,
) -> Result<SystemdServiceLogsResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        get_systemd_deploy_service_logs_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join systemd logs task: {err}"))?
}

#[tauri::command]
pub async fn control_systemd_deploy_service(
    app: AppHandle,
    request: ControlSystemdDeployServiceRequest,
) -> Result<SystemdServiceActionResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        control_systemd_deploy_service_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join systemd control task: {err}"))?
}

#[tauri::command]
pub async fn list_remote_systemd_services(
    app: AppHandle,
    request: ListRemoteSystemdServicesRequest,
) -> Result<Vec<RemoteSystemdServiceItem>, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        list_remote_systemd_services_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join list remote systemd services task: {err}"))?
}

#[tauri::command]
pub async fn get_remote_systemd_service_template(
    app: AppHandle,
    request: GetRemoteSystemdServiceTemplateRequest,
) -> Result<RemoteSystemdServiceTemplate, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        get_remote_systemd_service_template_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join get remote systemd service template task: {err}"))?
}

#[tauri::command]
pub fn list_nginx_services(app: AppHandle) -> Result<Vec<NginxService>, String> {
    list_nginx_services_impl(&app)
}

#[tauri::command]
pub fn upsert_nginx_service(
    app: AppHandle,
    request: UpsertNginxServiceRequest,
) -> Result<NginxService, String> {
    upsert_nginx_service_impl(&app, request)
}

#[tauri::command]
pub fn delete_nginx_service(
    app: AppHandle,
    request: DeleteNginxServiceRequest,
) -> Result<(), String> {
    delete_nginx_service_impl(&app, request)
}

#[tauri::command]
pub async fn discover_remote_nginx(
    app: AppHandle,
    request: DiscoverRemoteNginxRequest,
) -> Result<RemoteNginxDiscoveryResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || discover_remote_nginx_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join discover remote nginx task: {err}"))?
}

#[tauri::command]
pub async fn import_nginx_service_by_params(
    app: AppHandle,
    request: ImportNginxServiceByParamsRequest,
) -> Result<NginxService, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        import_nginx_service_by_params_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join import nginx service task: {err}"))?
}

#[tauri::command]
pub async fn get_nginx_service_status(
    app: AppHandle,
    request: GetNginxServiceStatusRequest,
) -> Result<NginxServiceStatus, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        get_nginx_service_status_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join nginx status task: {err}"))?
}

#[tauri::command]
pub async fn control_nginx_service(
    app: AppHandle,
    request: ControlNginxServiceRequest,
) -> Result<NginxServiceActionResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || control_nginx_service_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join nginx control task: {err}"))?
}

#[tauri::command]
pub async fn deploy_nginx_service(
    app: AppHandle,
    request: DeployNginxServiceRequest,
) -> Result<DeployNginxServiceResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || deploy_nginx_service_impl(&app_handle, request))
        .await
        .map_err(|err| format!("failed to join nginx deploy task: {err}"))?
}

#[tauri::command]
pub async fn test_nginx_service_config(
    app: AppHandle,
    request: TestNginxServiceConfigRequest,
) -> Result<NginxConfigTestResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        test_nginx_service_config_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join nginx config test task: {err}"))?
}

#[tauri::command]
pub async fn parse_nginx_service_config(
    app: AppHandle,
    request: ParseNginxServiceConfigRequest,
) -> Result<NginxParsedConfigResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        parse_nginx_service_config_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join nginx config parse task: {err}"))?
}

#[tauri::command]
pub async fn list_nginx_service_config_files(
    app: AppHandle,
    request: ListNginxServiceConfigFilesRequest,
) -> Result<NginxServiceConfigFileListResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        list_nginx_service_config_files_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join list nginx config files task: {err}"))?
}

#[tauri::command]
pub async fn read_nginx_service_config_file(
    app: AppHandle,
    request: ReadNginxServiceConfigFileRequest,
) -> Result<NginxServiceConfigFileResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        read_nginx_service_config_file_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join read nginx config file task: {err}"))?
}

#[tauri::command]
pub async fn save_nginx_service_config_file(
    app: AppHandle,
    request: SaveNginxServiceConfigFileRequest,
) -> Result<NginxServiceConfigFileSaveResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        save_nginx_service_config_file_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join save nginx config file task: {err}"))?
}

#[tauri::command]
pub async fn validate_nginx_service_config_content(
    app: AppHandle,
    request: ValidateNginxServiceConfigContentRequest,
) -> Result<NginxConfigValidationResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        validate_nginx_service_config_content_impl(&app_handle, request)
    })
    .await
    .map_err(|err| format!("failed to join validate nginx config content task: {err}"))?
}
