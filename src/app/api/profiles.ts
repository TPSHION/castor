import type {
  ApplySystemdDeployServiceRequest,
  ConnectRequest,
  ControlSystemdDeployServiceRequest,
  ConnectionProfile,
  DeleteSystemdDeployServiceRequest,
  DeploySystemdServiceRequest,
  DeploySystemdServiceResult,
  GetSystemdDeployServiceLogsRequest,
  GetSystemdDeployServiceStatusRequest,
  SystemdDeployService,
  SystemdServiceActionResult,
  SystemdServiceLogsResult,
  SystemdServiceStatus,
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
