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
};

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
