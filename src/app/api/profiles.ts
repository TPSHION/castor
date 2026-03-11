import type {
  ControlNginxServiceRequest,
  ApplySystemdDeployServiceRequest,
  ConnectRequest,
  ControlSystemdDeployServiceRequest,
  ConnectionProfile,
  DeleteNginxServiceRequest,
  GetRemoteSystemdServiceTemplateRequest,
  DeleteSystemdDeployServiceRequest,
  DeploySystemdServiceRequest,
  DeploySystemdServiceResult,
  DiscoverRemoteNginxRequest,
  GetNginxServiceStatusRequest,
  GetSystemdDeployServiceLogsRequest,
  GetSystemdDeployServiceStatusRequest,
  ImportNginxServiceByParamsRequest,
  ListRemoteSystemdServicesRequest,
  NginxConfigTestResult,
  NginxService,
  NginxServiceActionResult,
  NginxServiceStatus,
  RemoteSystemdServiceItem,
  RemoteNginxDiscoveryResult,
  RemoteSystemdServiceTemplate,
  SystemdDeployService,
  SystemdServiceActionResult,
  SystemdServiceLogsResult,
  SystemdServiceStatus,
  TestNginxServiceConfigRequest,
  UpsertNginxServiceRequest,
  UpsertSystemdDeployServiceRequest,
  DeleteConnectionProfileRequest,
  UpsertConnectionProfileRequest
} from '../../types';
import { invokeTauri, invokeTauriWithRequest } from './tauri';

export function listConnectionProfiles() {
  return invokeTauri<ConnectionProfile[]>('list_connection_profiles');
}

export function upsertConnectionProfile(request: UpsertConnectionProfileRequest) {
  return invokeTauriWithRequest<ConnectionProfile, UpsertConnectionProfileRequest>(
    'upsert_connection_profile',
    request
  );
}

export function testSshConnection(request: ConnectRequest) {
  return invokeTauriWithRequest<string, ConnectRequest>('test_ssh_connection', request);
}

export function deleteConnectionProfile(request: DeleteConnectionProfileRequest) {
  return invokeTauriWithRequest<void, DeleteConnectionProfileRequest>('delete_connection_profile', request);
}

export function deploySystemdService(request: DeploySystemdServiceRequest) {
  return invokeTauriWithRequest<DeploySystemdServiceResult, DeploySystemdServiceRequest>(
    'deploy_systemd_service',
    request
  );
}

export function listSystemdDeployServices() {
  return invokeTauri<SystemdDeployService[]>('list_systemd_deploy_services');
}

export function upsertSystemdDeployService(request: UpsertSystemdDeployServiceRequest) {
  return invokeTauriWithRequest<SystemdDeployService, UpsertSystemdDeployServiceRequest>(
    'upsert_systemd_deploy_service',
    request
  );
}

export function deleteSystemdDeployService(request: DeleteSystemdDeployServiceRequest) {
  return invokeTauriWithRequest<void, DeleteSystemdDeployServiceRequest>('delete_systemd_deploy_service', request);
}

export function applySystemdDeployService(request: ApplySystemdDeployServiceRequest) {
  return invokeTauriWithRequest<DeploySystemdServiceResult, ApplySystemdDeployServiceRequest>(
    'apply_systemd_deploy_service',
    request
  );
}

export function getSystemdDeployServiceStatus(request: GetSystemdDeployServiceStatusRequest) {
  return invokeTauriWithRequest<SystemdServiceStatus, GetSystemdDeployServiceStatusRequest>(
    'get_systemd_deploy_service_status',
    request
  );
}

export function getSystemdDeployServiceLogs(request: GetSystemdDeployServiceLogsRequest) {
  return invokeTauriWithRequest<SystemdServiceLogsResult, GetSystemdDeployServiceLogsRequest>(
    'get_systemd_deploy_service_logs',
    request
  );
}

export function controlSystemdDeployService(request: ControlSystemdDeployServiceRequest) {
  return invokeTauriWithRequest<SystemdServiceActionResult, ControlSystemdDeployServiceRequest>(
    'control_systemd_deploy_service',
    request
  );
}

export function listRemoteSystemdServices(request: ListRemoteSystemdServicesRequest) {
  return invokeTauriWithRequest<RemoteSystemdServiceItem[], ListRemoteSystemdServicesRequest>(
    'list_remote_systemd_services',
    request
  );
}

export function getRemoteSystemdServiceTemplate(request: GetRemoteSystemdServiceTemplateRequest) {
  return invokeTauriWithRequest<RemoteSystemdServiceTemplate, GetRemoteSystemdServiceTemplateRequest>(
    'get_remote_systemd_service_template',
    request
  );
}

export function listNginxServices() {
  return invokeTauri<NginxService[]>('list_nginx_services');
}

export function upsertNginxService(request: UpsertNginxServiceRequest) {
  return invokeTauriWithRequest<NginxService, UpsertNginxServiceRequest>('upsert_nginx_service', request);
}

export function deleteNginxService(request: DeleteNginxServiceRequest) {
  return invokeTauriWithRequest<void, DeleteNginxServiceRequest>('delete_nginx_service', request);
}

export function discoverRemoteNginx(request: DiscoverRemoteNginxRequest) {
  return invokeTauriWithRequest<RemoteNginxDiscoveryResult, DiscoverRemoteNginxRequest>('discover_remote_nginx', request);
}

export function importNginxServiceByParams(request: ImportNginxServiceByParamsRequest) {
  return invokeTauriWithRequest<NginxService, ImportNginxServiceByParamsRequest>('import_nginx_service_by_params', request);
}

export function getNginxServiceStatus(request: GetNginxServiceStatusRequest) {
  return invokeTauriWithRequest<NginxServiceStatus, GetNginxServiceStatusRequest>('get_nginx_service_status', request);
}

export function controlNginxService(request: ControlNginxServiceRequest) {
  return invokeTauriWithRequest<NginxServiceActionResult, ControlNginxServiceRequest>('control_nginx_service', request);
}

export function testNginxServiceConfig(request: TestNginxServiceConfigRequest) {
  return invokeTauriWithRequest<NginxConfigTestResult, TestNginxServiceConfigRequest>('test_nginx_service_config', request);
}
