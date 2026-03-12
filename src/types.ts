export type AuthConfig =
  | {
      kind: 'password';
      password: string;
    }
  | {
      kind: 'private_key';
      private_key: string;
      passphrase?: string;
    };

export type ConnectRequest = {
  session_id?: string;
  host: string;
  port: number;
  username: string;
  auth: AuthConfig;
  cols?: number;
  rows?: number;
};

export type LocalConnectRequest = {
  session_id?: string;
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
};

export type SftpListRequest = {
  host: string;
  port?: number;
  username: string;
  auth: AuthConfig;
  path?: string;
};

export type SftpDownloadRequest = {
  host: string;
  port?: number;
  username: string;
  auth: AuthConfig;
  remote_path: string;
  local_dir?: string;
  transfer_id?: string;
};

export type SftpUploadRequest = {
  host: string;
  port?: number;
  username: string;
  auth: AuthConfig;
  local_path: string;
  remote_dir: string;
  remote_name?: string;
  conflict_strategy?: SftpUploadConflictStrategy;
  transfer_id?: string;
};

export type SftpUploadConflictStrategy = 'auto_rename' | 'overwrite';

export type SftpRenameRequest = {
  host: string;
  port?: number;
  username: string;
  auth: AuthConfig;
  path: string;
  new_name: string;
};

export type SftpDeleteRequest = {
  host: string;
  port?: number;
  username: string;
  auth: AuthConfig;
  path: string;
};

export type SftpCreateDirRequest = {
  host: string;
  port?: number;
  username: string;
  auth: AuthConfig;
  parent_path: string;
  name: string;
};

export type SftpSetPermissionsRequest = {
  host: string;
  port?: number;
  username: string;
  auth: AuthConfig;
  path: string;
  permissions: number;
};

export type SftpEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  modified?: number;
  permissions?: number;
};

export type SftpDownloadResult = {
  local_path: string;
  bytes: number;
};

export type SftpUploadResult = {
  remote_path: string;
  bytes: number;
};

export type SftpTransferProgressPayload = {
  transfer_id: string;
  direction: 'download' | 'upload';
  status: 'running' | 'done' | 'error' | 'canceled';
  path: string;
  target_path: string;
  transferred_bytes: number;
  total_bytes: number;
  percent: number;
  eta_seconds?: number | null;
  speed_bps?: number | null;
};

export type LocalListRequest = {
  path?: string;
};

export type LocalRenameRequest = {
  path: string;
  new_name: string;
};

export type LocalDeleteRequest = {
  path: string;
};

export type LocalCreateDirRequest = {
  parent_path: string;
  name: string;
};

export type LocalFsEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  modified?: number;
};

export type LocalListResponse = {
  path: string;
  parent_path?: string;
  entries: LocalFsEntry[];
};

export type SendInputRequest = {
  session_id: string;
  data: string;
};

export type ResizeRequest = {
  session_id: string;
  cols: number;
  rows: number;
};

export type DisconnectRequest = {
  session_id: string;
};

export type SessionSummary = {
  session_id: string;
  host: string;
  username: string;
};

export type OutputPayload = {
  session_id: string;
  stream: 'stdout' | 'stderr' | 'status';
  data: string;
};

export type AuthKind = 'password' | 'private_key';

export type ConnectionProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_kind: AuthKind;
  password?: string;
  private_key?: string;
  passphrase?: string;
  created_at: number;
  updated_at: number;
};

export type UpsertConnectionProfileRequest = {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_kind: AuthKind;
  password?: string;
  private_key?: string;
  passphrase?: string;
};

export type DeleteConnectionProfileRequest = {
  id: string;
};

export type RuntimeLanguage = 'node' | 'java' | 'go' | 'python';

export type ProbeServerRuntimesRequest = {
  profile_id: string;
  probe_id: string;
};

export type PreflightServerRuntimeProbeRequest = {
  profile_id: string;
};

export type CancelServerRuntimeProbeRequest = {
  probe_id: string;
};

export type RuntimeProbeMatch = {
  binary_path: string;
  version?: string;
  message?: string;
  active: boolean;
};

export type RuntimeProbeResult = {
  language: RuntimeLanguage;
  found: boolean;
  binary_path?: string;
  version?: string;
  message?: string;
  checked_at: number;
  matches: RuntimeProbeMatch[];
};

export type RuntimeDeployLanguage = RuntimeLanguage;

export type RuntimeDeployPlanRequest = {
  profile_id: string;
  language: RuntimeDeployLanguage;
  version: string;
  set_as_default?: boolean;
};

export type RuntimeDeployApplyRequest = {
  profile_id: string;
  language: RuntimeDeployLanguage;
  version: string;
  set_as_default?: boolean;
  deploy_id: string;
};

export type CancelRuntimeDeployRequest = {
  deploy_id: string;
};

export type RuntimeDeployStep = {
  title: string;
  command: string;
};

export type RuntimeDeployPlanResult = {
  language: RuntimeDeployLanguage;
  version: string;
  manager: string;
  steps: RuntimeDeployStep[];
};

export type RuntimeDeployApplyResult = {
  language: RuntimeDeployLanguage;
  version: string;
  manager: string;
  success: boolean;
  completed_at: number;
  logs: string[];
};

export type RuntimeDeployLogPayload = {
  deploy_id: string;
  level: 'info' | 'warn' | 'error' | 'stdout' | 'stderr' | 'done' | string;
  line: string;
  timestamp: number;
};

export type ListRuntimeDeployVersionsRequest = {
  profile_id: string;
  language: RuntimeDeployLanguage;
  keyword?: string;
  limit?: number;
};

export type RuntimeDeployVersionsResult = {
  language: RuntimeDeployLanguage;
  manager: string;
  versions: RuntimeDeployVersionItem[];
};

export type RuntimeVersionChannel = 'stable' | 'prerelease' | 'unknown';

export type RuntimeDeployVersionItem = {
  version: string;
  channel: RuntimeVersionChannel;
};

export type SystemdScope = 'system' | 'user';
export type SystemdLogOutputMode = 'journal' | 'file' | 'none';

export type DeploySystemdServiceRequest = {
  profile_id: string;
  service_name: string;
  description?: string;
  working_dir: string;
  exec_start: string;
  exec_stop?: string;
  service_user?: string;
  environment?: string[];
  enable_on_boot?: boolean;
  scope?: SystemdScope;
  use_sudo?: boolean;
  log_output_mode?: SystemdLogOutputMode;
  log_output_path?: string;
};

export type DeploySystemdServiceResult = {
  host: string;
  service_name: string;
  scope: SystemdScope;
  unit_path: string;
  stdout: string;
  stderr: string;
  exit_status: number;
};

export type SystemdDeployService = {
  id: string;
  profile_id: string;
  name: string;
  service_name: string;
  description?: string;
  working_dir: string;
  exec_start: string;
  exec_stop?: string;
  service_user?: string;
  environment?: string[];
  enable_on_boot: boolean;
  scope: SystemdScope;
  use_sudo: boolean;
  log_output_mode: SystemdLogOutputMode;
  log_output_path?: string;
  created_at: number;
  updated_at: number;
};

export type UpsertSystemdDeployServiceRequest = {
  id?: string;
  profile_id: string;
  name: string;
  service_name: string;
  description?: string;
  working_dir: string;
  exec_start: string;
  exec_stop?: string;
  service_user?: string;
  environment?: string[];
  enable_on_boot?: boolean;
  scope?: SystemdScope;
  use_sudo?: boolean;
  log_output_mode?: SystemdLogOutputMode;
  log_output_path?: string;
};

export type DeleteSystemdDeployServiceRequest = {
  id: string;
  remove_remote?: boolean;
};

export type ApplySystemdDeployServiceRequest = {
  id: string;
};

export type GetSystemdDeployServiceStatusRequest = {
  id: string;
};

export type GetSystemdDeployServiceLogsRequest = {
  id: string;
  lines?: number;
  cursor?: string;
};

export type SystemdControlAction = 'start' | 'stop' | 'restart';

export type ControlSystemdDeployServiceRequest = {
  id: string;
  action: SystemdControlAction;
};

export type SystemdServiceStatus = {
  active_state: string;
  sub_state: string;
  unit_file_state: string;
  summary: 'running' | 'stopped' | 'failed' | 'unknown' | string;
  checked_at: number;
};

export type SystemdServiceActionResult = {
  id: string;
  action: SystemdControlAction;
  stdout: string;
  stderr: string;
  exit_status: number;
  status: SystemdServiceStatus;
};

export type SystemdServiceLogsResult = {
  lines: string[];
  cursor?: string;
};

export type ListRemoteSystemdServicesRequest = {
  profile_id: string;
  scope?: SystemdScope;
  use_sudo?: boolean;
};

export type RemoteSystemdServiceItem = {
  service_name: string;
  unit_file_state: string;
};

export type GetRemoteSystemdServiceTemplateRequest = {
  profile_id: string;
  service_name: string;
  scope?: SystemdScope;
  use_sudo?: boolean;
};

export type RemoteSystemdServiceTemplate = {
  service_name: string;
  description?: string;
  working_dir?: string;
  exec_start?: string;
  exec_stop?: string;
  service_user?: string;
  environment?: string[];
  log_output_mode?: SystemdLogOutputMode;
  log_output_path?: string;
};

export type NginxService = {
  id: string;
  profile_id: string;
  name: string;
  nginx_bin: string;
  conf_path?: string;
  pid_path?: string;
  use_sudo: boolean;
  created_at: number;
  updated_at: number;
};

export type UpsertNginxServiceRequest = {
  id?: string;
  profile_id: string;
  name: string;
  nginx_bin?: string;
  conf_path?: string;
  pid_path?: string;
  use_sudo?: boolean;
};

export type DeleteNginxServiceRequest = {
  id: string;
};

export type DiscoverRemoteNginxRequest = {
  profile_id: string;
};

export type RemoteNginxDiscoveryResult = {
  installed: boolean;
  nginx_bin?: string;
  conf_path?: string;
  pid_path?: string;
  version?: string;
};

export type ImportNginxServiceByParamsRequest = {
  id?: string;
  profile_id: string;
  name: string;
  nginx_bin: string;
  conf_path?: string;
  pid_path?: string;
  use_sudo?: boolean;
};

export type GetNginxServiceStatusRequest = {
  id: string;
};

export type NginxControlAction = 'start' | 'stop' | 'reload' | 'restart';

export type ControlNginxServiceRequest = {
  id: string;
  action: NginxControlAction;
};

export type DeployNginxServiceRequest = {
  id: string;
  deploy_id?: string;
};

export type NginxServiceStatus = {
  summary: string;
  running: boolean;
  master_pid?: number;
  checked_at: number;
};

export type NginxServiceActionResult = {
  id: string;
  action: NginxControlAction;
  stdout: string;
  stderr: string;
  exit_status: number;
  status: NginxServiceStatus;
};

export type DeployNginxServiceResult = {
  id: string;
  deploy_id: string;
  installed_before: boolean;
  nginx_bin: string;
  conf_path?: string;
  pid_path?: string;
  version?: string;
  stdout: string;
  stderr: string;
  exit_status: number;
  deployed_at: number;
};

export type NginxDeployLogPayload = {
  deploy_id: string;
  service_id: string;
  line: string;
  timestamp: number;
};

export type TestNginxServiceConfigRequest = {
  id: string;
};

export type NginxConfigTestResult = {
  id: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_status: number;
  checked_at: number;
};

export type ParseNginxServiceConfigRequest = {
  id: string;
};

export type ReadNginxServiceConfigFileRequest = {
  id: string;
};

export type NginxServiceConfigFileResult = {
  id: string;
  source_path: string;
  content: string;
  loaded_at: number;
};

export type SaveNginxServiceConfigFileRequest = {
  id: string;
  content: string;
};

export type NginxServiceConfigFileSaveResult = {
  id: string;
  source_path: string;
  bytes: number;
  saved_at: number;
};

export type ValidateNginxServiceConfigContentRequest = {
  id: string;
  content: string;
};

export type NginxConfigValidationResult = {
  id: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_status: number;
  checked_at: number;
};

export type NginxParsedConfigNodeType = 'directive' | 'block';

export type NginxParsedConfigNode = {
  id: string;
  node_type: NginxParsedConfigNodeType;
  name: string;
  args: string[];
  line_start: number;
  line_end: number;
  children: NginxParsedConfigNode[];
};

export type NginxParsedConfigSummary = {
  server_count: number;
  upstream_count: number;
  location_count: number;
  include_count: number;
  listen: string[];
  server_names: string[];
};

export type NginxParsedConfigResult = {
  id: string;
  source_path: string;
  parsed_at: number;
  summary: NginxParsedConfigSummary;
  root: NginxParsedConfigNode;
};

export type SslChallengeType = 'http' | 'dns';
export type SslCertificateStatus = 'pending' | 'active' | 'expiring' | 'failed';

export type SslDnsEnvVar = {
  key: string;
  value: string;
};

export type SslCertificate = {
  id: string;
  profile_id: string;
  domain: string;
  email?: string;
  challenge_type: SslChallengeType;
  webroot_path?: string;
  dns_provider?: string;
  dns_env: SslDnsEnvVar[];
  key_file: string;
  fullchain_file: string;
  reload_command?: string;
  auto_renew_enabled: boolean;
  renew_before_days: number;
  renew_at: string;
  status: SslCertificateStatus;
  issuer?: string;
  not_before?: string;
  not_after?: string;
  last_error?: string;
  last_operation_at?: number;
  created_at: number;
  updated_at: number;
};

export type ListSslCertificatesRequest = {
  profile_id: string;
};

export type UpsertSslCertificateRequest = {
  id?: string;
  profile_id: string;
  domain: string;
  email?: string;
  challenge_type: SslChallengeType;
  webroot_path?: string;
  dns_provider?: string;
  dns_env?: SslDnsEnvVar[];
  key_file: string;
  fullchain_file: string;
  reload_command?: string;
  auto_renew_enabled?: boolean;
  renew_before_days?: number;
  renew_at?: string;
};

export type DeleteSslCertificateRequest = {
  id: string;
};

export type ApplySslCertificateRequest = {
  id: string;
  force?: boolean;
};

export type IssueSslCertificateRequest = {
  id: string;
  force?: boolean;
};

export type RenewSslCertificateRequest = {
  id: string;
  force?: boolean;
};

export type SyncSslCertificateStatusRequest = {
  id: string;
};

export type SslCertificateOperationResult = {
  certificate: SslCertificate;
  operation: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_status: number;
  message: string;
};

export type ProxyNode = {
  id: string;
  name: string;
  protocol: string;
  server: string;
  port: number;
  method: string;
  password: string;
  plugin?: string;
  supported: boolean;
  unsupported_reason?: string;
  raw_uri: string;
  latency_ms?: number;
  reachability_status?: 'ok' | 'failed' | string;
  reachability_error?: string;
  tested_at?: number;
};

export type ServerProxyConfig = {
  id: string;
  profile_id: string;
  subscription_url: string;
  nodes: ProxyNode[];
  active_node_id?: string;
  local_http_proxy?: string;
  local_socks_proxy?: string;
  status: string;
  last_error?: string;
  created_at: number;
  updated_at: number;
};

export type ListServerProxyConfigsRequest = {
  profile_id?: string;
};

export type SyncServerProxySubscriptionRequest = {
  profile_id?: string;
  subscription_url: string;
};

export type DeleteServerProxyConfigRequest = {
  id: string;
};

export type ApplyServerProxyNodeRequest = {
  id: string;
  node_id: string;
  apply_id?: string;
  profile_id?: string;
  use_sudo?: boolean;
  local_mixed_port?: number;
};

export type ServerProxyApplyResult = {
  config: ServerProxyConfig;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_status: number;
  message: string;
};

export type TestServerProxyConnectivityRequest = {
  id: string;
  timeout_ms?: number;
};

export type ServerProxyConnectivityResult = {
  config: ServerProxyConfig;
  tested: number;
  reachable: number;
  failed: number;
  timeout_ms: number;
  message: string;
};

export type GetServerProxyRuntimeStatusRequest = {
  profile_id: string;
  use_sudo?: boolean;
};

export type ServerProxyRuntimeStatusResult = {
  profile_id: string;
  service_name: string;
  installed: boolean;
  active: boolean;
  enabled: boolean;
  config_exists: boolean;
  checked_at: number;
  message: string;
  stdout: string;
  stderr: string;
};

export type ProxyApplyLogPayload = {
  apply_id: string;
  level: 'info' | 'warn' | 'error' | 'stdout' | 'done' | string;
  line: string;
  timestamp: number;
};
