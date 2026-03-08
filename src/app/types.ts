import type { ConnectionProfile, LocalFsEntry, SftpEntry } from '../types';

export type AuthType = 'password' | 'private_key';
export type ContentView = 'servers' | 'workspace' | 'sftp';
export type SessionTabStatus = 'connecting' | 'connected' | 'error' | 'closed';
export type EditorMode = 'create' | 'edit';

export type ProfileEditor = {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: AuthType;
  password: string;
  privateKey: string;
  passphrase: string;
};

export type SessionTab = {
  id: string;
  sessionId?: string;
  kind: 'ssh' | 'local';
  profileId?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  status: SessionTabStatus;
  statusMessage: string;
};

export type TestState = {
  phase: 'idle' | 'testing' | 'success' | 'error';
  message: string;
};

export type SftpContextMenuState = {
  x: number;
  y: number;
  entry: SftpEntry | null;
};

export type SftpActionDialogState =
  | {
      kind: 'rename';
      entry: SftpEntry;
      value: string;
    }
  | {
      kind: 'create_dir';
      parentPath: string;
      value: string;
    }
  | {
      kind: 'permissions';
      entry: SftpEntry;
      value: string;
    }
  | {
      kind: 'delete';
      entry: SftpEntry;
    }
  | null;

export type LocalContextMenuState = {
  x: number;
  y: number;
  entry: LocalFsEntry | null;
};

export type LocalActionDialogState =
  | {
      kind: 'rename';
      entry: LocalFsEntry;
      value: string;
    }
  | {
      kind: 'create_dir';
      parentPath: string;
      value: string;
    }
  | {
      kind: 'delete';
      entry: LocalFsEntry;
    }
  | null;

export type { ConnectionProfile };
