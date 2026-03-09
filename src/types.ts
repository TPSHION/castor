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
