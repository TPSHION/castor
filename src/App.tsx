import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TerminalView } from './components/TerminalView';
import type {
  AuthConfig,
  ConnectRequest,
  ConnectionProfile,
  DeleteConnectionProfileRequest,
  LocalCreateDirRequest,
  LocalDeleteRequest,
  LocalFsEntry,
  LocalListRequest,
  LocalListResponse,
  LocalConnectRequest,
  LocalRenameRequest,
  OutputPayload,
  SessionSummary,
  SftpCreateDirRequest,
  SftpDeleteRequest,
  SftpDownloadRequest,
  SftpDownloadResult,
  SftpEntry,
  SftpListRequest,
  SftpRenameRequest,
  SftpSetPermissionsRequest,
  UpsertConnectionProfileRequest
} from './types';

type AuthType = 'password' | 'private_key';
type ContentView = 'servers' | 'workspace' | 'sftp';
type SessionTabStatus = 'connecting' | 'connected' | 'error' | 'closed';
type EditorMode = 'create' | 'edit';

type ProfileEditor = {
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

type SessionTab = {
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

type TestState = {
  phase: 'idle' | 'testing' | 'success' | 'error';
  message: string;
};

type SftpContextMenuState = {
  x: number;
  y: number;
  entry: SftpEntry | null;
};

type SftpActionDialogState =
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

type LocalContextMenuState = {
  x: number;
  y: number;
  entry: LocalFsEntry | null;
};

type LocalActionDialogState =
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

function normalizeRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return '/';
  }

  const absolute = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const segments = absolute
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');

  const next: string[] = [];
  for (const segment of segments) {
    if (segment === '..') {
      next.pop();
      continue;
    }
    next.push(segment);
  }

  return next.length === 0 ? '/' : `/${next.join('/')}`;
}

function parentRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path);
  if (normalized === '/') {
    return '/';
  }
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

function formatBytes(value?: number): string {
  if (value === undefined || Number.isNaN(value)) {
    return '-';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUnixTime(value?: number): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value * 1000);
  return date.toLocaleString();
}

function formatPermissionMode(value?: number): string {
  if (value === undefined) {
    return '---';
  }
  return (value & 0o7777).toString(8).padStart(3, '0');
}

function defaultPermissionInput(entry: SftpEntry): string {
  if (entry.permissions !== undefined) {
    return formatPermissionMode(entry.permissions);
  }
  return entry.is_dir ? '755' : '644';
}

function parsePermissionInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-7]{3,4}$/.test(trimmed)) {
    return null;
  }
  return Number.parseInt(trimmed, 8);
}

function createEmptyEditor(): ProfileEditor {
  return {
    name: '',
    host: '',
    port: 22,
    username: '',
    authKind: 'password',
    password: '',
    privateKey: '',
    passphrase: ''
  };
}

function formatInvokeError(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    const message = candidate.message;
    const nestedError = candidate.error;

    if (typeof message === 'string' && message.length > 0) {
      return message;
    }

    if (typeof nestedError === 'string' && nestedError.length > 0) {
      return nestedError;
    }

    try {
      return JSON.stringify(candidate);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function createClientTabId() {
  if (globalThis.crypto?.randomUUID) {
    return `tab-${globalThis.crypto.randomUUID()}`;
  }
  return `tab-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function validateEditor(editor: ProfileEditor): string | null {
  if (!editor.name.trim()) {
    return '名称不能为空';
  }
  if (!editor.host.trim()) {
    return 'Host 不能为空';
  }
  if (!editor.username.trim()) {
    return '用户名不能为空';
  }
  if (editor.port < 1 || editor.port > 65535) {
    return '端口范围应为 1-65535';
  }
  if (editor.authKind === 'password' && !editor.password) {
    return '密码认证必须填写密码';
  }
  if (editor.authKind === 'private_key' && !editor.privateKey.trim()) {
    return '私钥认证必须填写私钥';
  }
  return null;
}

function buildAuthFromProfile(profile: ConnectionProfile): AuthConfig | null {
  if (profile.auth_kind === 'password') {
    if (!profile.password) {
      return null;
    }
    return {
      kind: 'password',
      password: profile.password
    };
  }

  if (!profile.private_key?.trim()) {
    return null;
  }

  return {
    kind: 'private_key',
    private_key: profile.private_key,
    passphrase: profile.passphrase || undefined
  };
}

function buildAuthFromEditor(editor: ProfileEditor): AuthConfig {
  if (editor.authKind === 'password') {
    return {
      kind: 'password',
      password: editor.password
    };
  }

  return {
    kind: 'private_key',
    private_key: editor.privateKey,
    passphrase: editor.passphrase || undefined
  };
}

export function App() {
  const [contentView, setContentView] = useState<ContentView>('servers');
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [profilesBusy, setProfilesBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('create');
  const [editor, setEditor] = useState<ProfileEditor>(createEmptyEditor());
  const [editorBusy, setEditorBusy] = useState(false);
  const [testState, setTestState] = useState<TestState>({ phase: 'idle', message: '' });
  const [isQuickConnectOpen, setIsQuickConnectOpen] = useState(false);

  const [localPath, setLocalPath] = useState<string>('');
  const [localPathInput, setLocalPathInput] = useState<string>('');
  const [localParentPath, setLocalParentPath] = useState<string | null>(null);
  const [localEntries, setLocalEntries] = useState<LocalFsEntry[]>([]);
  const [localBusy, setLocalBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [localSelectedPath, setLocalSelectedPath] = useState<string | null>(null);
  const [localContextMenu, setLocalContextMenu] = useState<LocalContextMenuState | null>(null);
  const [localActionDialog, setLocalActionDialog] = useState<LocalActionDialogState>(null);
  const [localActionError, setLocalActionError] = useState<string | null>(null);
  const localContextMenuRef = useRef<HTMLDivElement | null>(null);

  const [selectedSftpProfileId, setSelectedSftpProfileId] = useState<string>('');
  const [connectedSftpProfileId, setConnectedSftpProfileId] = useState<string>('');
  const [sftpPath, setSftpPath] = useState<string>('/');
  const [sftpPathInput, setSftpPathInput] = useState<string>('/');
  const [sftpEntries, setSftpEntries] = useState<SftpEntry[]>([]);
  const [sftpBusy, setSftpBusy] = useState(false);
  const [sftpMessage, setSftpMessage] = useState<string | null>(null);
  const [sftpSelectedPath, setSftpSelectedPath] = useState<string | null>(null);
  const [sftpContextMenu, setSftpContextMenu] = useState<SftpContextMenuState | null>(null);
  const [sftpActionDialog, setSftpActionDialog] = useState<SftpActionDialogState>(null);
  const [sftpActionError, setSftpActionError] = useState<string | null>(null);
  const sftpContextMenuRef = useRef<HTMLDivElement | null>(null);

  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activeTab = useMemo(
    () => sessionTabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, sessionTabs]
  );
  const selectedSftpProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedSftpProfileId) ?? null,
    [profiles, selectedSftpProfileId]
  );
  const connectedSftpProfile = useMemo(
    () => profiles.find((profile) => profile.id === connectedSftpProfileId) ?? null,
    [profiles, connectedSftpProfileId]
  );

  const editorValidation = useMemo(() => validateEditor(editor), [editor]);

  useEffect(() => {
    void refreshProfiles();
  }, []);

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedSftpProfileId('');
      setConnectedSftpProfileId('');
      setSftpEntries([]);
      setSftpMessage(null);
      setSftpSelectedPath(null);
      setSftpContextMenu(null);
      setSftpActionDialog(null);
      setSftpActionError(null);
      return;
    }

    if (!profiles.some((profile) => profile.id === selectedSftpProfileId)) {
      setSelectedSftpProfileId(profiles[0].id);
    }

    if (connectedSftpProfileId && !profiles.some((profile) => profile.id === connectedSftpProfileId)) {
      setConnectedSftpProfileId('');
      setSftpEntries([]);
      setSftpSelectedPath(null);
      setSftpContextMenu(null);
      setSftpActionDialog(null);
      setSftpActionError(null);
      setSftpMessage('当前远程连接服务器已不存在，请重新选择。');
    }
  }, [profiles, selectedSftpProfileId, connectedSftpProfileId]);

  useEffect(() => {
    if (!localSelectedPath) {
      return;
    }
    if (localEntries.some((entry) => entry.path === localSelectedPath)) {
      return;
    }
    setLocalSelectedPath(null);
  }, [localEntries, localSelectedPath]);

  useEffect(() => {
    if (!sftpSelectedPath) {
      return;
    }
    if (sftpEntries.some((entry) => entry.path === sftpSelectedPath)) {
      return;
    }
    setSftpSelectedPath(null);
  }, [sftpEntries, sftpSelectedPath]);

  useEffect(() => {
    setLocalContextMenu(null);
    setSftpContextMenu(null);
  }, [contentView]);

  useEffect(() => {
    if (!localContextMenu) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (localContextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setLocalContextMenu(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLocalContextMenu(null);
      }
    };

    const onViewportChange = () => {
      setLocalContextMenu(null);
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [localContextMenu]);

  useEffect(() => {
    if (!sftpContextMenu) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (sftpContextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setSftpContextMenu(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSftpContextMenu(null);
      }
    };

    const onViewportChange = () => {
      setSftpContextMenu(null);
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [sftpContextMenu]);

  useEffect(() => {
    let mounted = true;

    const unsubscribePromise = listen<OutputPayload>('ssh-output', (event) => {
      if (!mounted || event.payload.stream !== 'status') {
        return;
      }

      setSessionTabs((previous) =>
        previous.map((tab) => {
          if (!tab.sessionId || tab.sessionId !== event.payload.session_id) {
            return tab;
          }

          if (
            event.payload.data.includes('disconnected') ||
            event.payload.data.includes('remote session closed')
          ) {
            return {
              ...tab,
              status: 'closed',
              statusMessage: '连接已关闭'
            };
          }

          if (event.payload.data.includes('connected to')) {
            return {
              ...tab,
              statusMessage: '连接成功'
            };
          }

          return tab;
        })
      );
    });

    return () => {
      mounted = false;
      void unsubscribePromise.then((unlisten) => unlisten());
    };
  }, []);

  async function refreshProfiles() {
    setProfilesBusy(true);
    setProfileMessage(null);

    try {
      const nextProfiles = await invoke<ConnectionProfile[]>('list_connection_profiles');
      setProfiles(nextProfiles);
    } catch (invokeError) {
      setProfileMessage(formatInvokeError(invokeError));
    } finally {
      setProfilesBusy(false);
    }
  }

  async function loadLocalDir(targetPath?: string) {
    const normalizedInput = targetPath?.trim();
    const request: LocalListRequest = normalizedInput ? { path: normalizedInput } : {};

    setLocalBusy(true);
    setLocalMessage('正在读取本地目录...');

    try {
      const result = await invoke<LocalListResponse>('list_local_dir', { request });
      setLocalEntries(result.entries);
      setLocalPath(result.path);
      setLocalPathInput(result.path);
      setLocalParentPath(result.parent_path ?? null);
      setLocalSelectedPath(null);
      setLocalContextMenu(null);
      setLocalMessage(`本地目录读取成功，共 ${result.entries.length} 项`);
    } catch (invokeError) {
      setLocalMessage(formatInvokeError(invokeError));
    } finally {
      setLocalBusy(false);
    }
  }

  async function onLocalOpenPath() {
    await loadLocalDir(localPathInput);
  }

  async function onLocalGoParent() {
    if (!localParentPath) {
      return;
    }
    await loadLocalDir(localParentPath);
  }

  async function onLocalEnterDir(entry: LocalFsEntry) {
    if (!entry.is_dir) {
      return;
    }
    await loadLocalDir(entry.path);
  }

  function closeLocalActionDialog() {
    if (localBusy) {
      return;
    }
    setLocalActionDialog(null);
    setLocalActionError(null);
  }

  function updateLocalActionValue(value: string) {
    setLocalActionError(null);
    setLocalActionDialog((current) => {
      if (!current || current.kind === 'delete') {
        return current;
      }
      return {
        ...current,
        value
      };
    });
  }

  function openLocalContextMenuAt(x: number, y: number, entry: LocalFsEntry | null) {
    setSftpContextMenu(null);
    setLocalActionDialog(null);
    setLocalActionError(null);
    setLocalContextMenu({ x, y, entry });
  }

  function openLocalRenameDialog(entry: LocalFsEntry) {
    setLocalContextMenu(null);
    setLocalActionError(null);
    setLocalActionDialog({ kind: 'rename', entry, value: entry.name });
  }

  function openLocalDeleteDialog(entry: LocalFsEntry) {
    setLocalContextMenu(null);
    setLocalActionError(null);
    setLocalActionDialog({ kind: 'delete', entry });
  }

  function openLocalCreateDirDialog(parentPath: string) {
    setLocalContextMenu(null);
    setLocalActionError(null);
    setLocalActionDialog({ kind: 'create_dir', parentPath, value: '' });
  }

  async function onLocalRenameEntry(entry: LocalFsEntry, newName: string) {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setLocalActionError('名称不能为空');
      return;
    }

    const request: LocalRenameRequest = {
      path: entry.path,
      new_name: trimmedName
    };

    setLocalBusy(true);
    setLocalActionError(null);
    setLocalMessage(`正在重命名：${entry.name}`);

    try {
      await invoke('local_rename_entry', { request });
      setLocalActionDialog(null);
      setLocalSelectedPath(null);
      setLocalBusy(false);
      await loadLocalDir(localPath);
      setLocalMessage(`已重命名为：${trimmedName}`);
    } catch (invokeError) {
      setLocalActionError(formatInvokeError(invokeError));
      setLocalBusy(false);
    }
  }

  async function onLocalDeleteEntry(entry: LocalFsEntry) {
    const request: LocalDeleteRequest = {
      path: entry.path
    };

    setLocalBusy(true);
    setLocalActionError(null);
    setLocalMessage(`正在删除：${entry.path}`);

    try {
      await invoke('local_delete_entry', { request });
      setLocalActionDialog(null);
      setLocalSelectedPath(null);
      setLocalBusy(false);
      await loadLocalDir(localPath);
      setLocalMessage(`已删除：${entry.name}`);
    } catch (invokeError) {
      setLocalActionError(formatInvokeError(invokeError));
      setLocalBusy(false);
    }
  }

  async function onLocalCreateDir(parentPath: string, name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setLocalActionError('文件夹名称不能为空');
      return;
    }

    const request: LocalCreateDirRequest = {
      parent_path: parentPath,
      name: trimmedName
    };

    setLocalBusy(true);
    setLocalActionError(null);
    setLocalMessage(`正在创建文件夹：${trimmedName}`);

    try {
      await invoke('local_create_dir', { request });
      setLocalActionDialog(null);
      setLocalBusy(false);
      await loadLocalDir(localPath);
      setLocalMessage(`已创建文件夹：${trimmedName}`);
    } catch (invokeError) {
      setLocalActionError(formatInvokeError(invokeError));
      setLocalBusy(false);
    }
  }

  async function submitLocalActionDialog() {
    if (!localActionDialog) {
      return;
    }

    if (localActionDialog.kind === 'rename') {
      await onLocalRenameEntry(localActionDialog.entry, localActionDialog.value);
      return;
    }

    if (localActionDialog.kind === 'create_dir') {
      await onLocalCreateDir(localActionDialog.parentPath, localActionDialog.value);
      return;
    }

    await onLocalDeleteEntry(localActionDialog.entry);
  }

  async function loadSftpDir(profile: ConnectionProfile, targetPath: string) {
    const auth = buildAuthFromProfile(profile);
    if (!auth) {
      setSftpMessage(`服务器 ${profile.name} 缺少可用凭据，请先编辑并保存。`);
      return;
    }

    const normalizedPath = normalizeRemotePath(targetPath);
    const request: SftpListRequest = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      auth,
      path: normalizedPath
    };

    setSftpBusy(true);
    setSftpMessage(`正在读取 ${profile.name} 的远程目录：${normalizedPath}`);

    try {
      const entries = await invoke<SftpEntry[]>('sftp_list_dir', { request });
      setSftpEntries(entries);
      setSftpPath(normalizedPath);
      setSftpPathInput(normalizedPath);
      setConnectedSftpProfileId(profile.id);
      setSftpSelectedPath(null);
      setSftpContextMenu(null);
      setSftpMessage(`目录读取成功，共 ${entries.length} 项`);
    } catch (invokeError) {
      setSftpMessage(formatInvokeError(invokeError));
    } finally {
      setSftpBusy(false);
    }
  }

  async function openSftpView() {
    setContentView('sftp');
    if (!localPath) {
      await loadLocalDir();
    }

    if (profiles.length === 0) {
      setSftpEntries([]);
      setSftpMessage('暂无服务器配置，请先新增服务器。');
      return;
    }

    if (!selectedSftpProfileId) {
      setSelectedSftpProfileId(profiles[0].id);
    }
  }

  function onSelectSftpProfile(profileId: string) {
    setSelectedSftpProfileId(profileId);
    if (connectedSftpProfileId && connectedSftpProfileId !== profileId) {
      setConnectedSftpProfileId('');
      setSftpEntries([]);
      setSftpPath('/');
      setSftpPathInput('/');
      setSftpMessage('已切换服务器，请点击“连接”加载远程目录。');
    }
  }

  async function onConnectSftpHost() {
    if (!selectedSftpProfile) {
      setSftpMessage('请先选择服务器。');
      return;
    }
    await loadSftpDir(selectedSftpProfile, '/');
  }

  async function onOpenSftpPath() {
    if (!connectedSftpProfile) {
      setSftpMessage('请先连接服务器。');
      return;
    }
    await loadSftpDir(connectedSftpProfile, sftpPathInput);
  }

  async function onSftpGoParent() {
    if (!connectedSftpProfile) {
      setSftpMessage('请先连接服务器。');
      return;
    }
    await loadSftpDir(connectedSftpProfile, parentRemotePath(sftpPath));
  }

  async function onSftpEnterDir(entry: SftpEntry) {
    if (!connectedSftpProfile || !entry.is_dir) {
      return;
    }
    await loadSftpDir(connectedSftpProfile, entry.path);
  }

  async function onSftpDownload(entry: SftpEntry) {
    if (!connectedSftpProfile || entry.is_dir) {
      return;
    }

    const auth = buildAuthFromProfile(connectedSftpProfile);
    if (!auth) {
      setSftpMessage(`服务器 ${connectedSftpProfile.name} 缺少可用凭据，请先编辑并保存。`);
      return;
    }

    const request: SftpDownloadRequest = {
      host: connectedSftpProfile.host,
      port: connectedSftpProfile.port,
      username: connectedSftpProfile.username,
      auth,
      remote_path: entry.path
    };

    setSftpBusy(true);
    setSftpMessage(`正在下载：${entry.path}`);

    try {
      const result = await invoke<SftpDownloadResult>('sftp_download_file', { request });
      setSftpMessage(`下载完成：${result.local_path}（${formatBytes(result.bytes)}）`);
    } catch (invokeError) {
      setSftpMessage(formatInvokeError(invokeError));
    } finally {
      setSftpBusy(false);
    }
  }

  function getConnectedSftpContext(): { profile: ConnectionProfile; auth: AuthConfig } | null {
    if (!connectedSftpProfile) {
      setSftpMessage('请先连接服务器。');
      return null;
    }

    const auth = buildAuthFromProfile(connectedSftpProfile);
    if (!auth) {
      setSftpMessage(`服务器 ${connectedSftpProfile.name} 缺少可用凭据，请先编辑并保存。`);
      return null;
    }

    return {
      profile: connectedSftpProfile,
      auth
    };
  }

  function closeSftpActionDialog() {
    if (sftpBusy) {
      return;
    }
    setSftpActionDialog(null);
    setSftpActionError(null);
  }

  function updateSftpActionValue(value: string) {
    setSftpActionError(null);
    setSftpActionDialog((current) => {
      if (!current || current.kind === 'delete') {
        return current;
      }
      return {
        ...current,
        value
      };
    });
  }

  function openSftpContextMenuAt(x: number, y: number, entry: SftpEntry | null) {
    setLocalContextMenu(null);
    setSftpActionDialog(null);
    setSftpActionError(null);
    setSftpContextMenu({ x, y, entry });
  }

  function openSftpRenameDialog(entry: SftpEntry) {
    setSftpContextMenu(null);
    setSftpActionError(null);
    setSftpActionDialog({ kind: 'rename', entry, value: entry.name });
  }

  function openSftpDeleteDialog(entry: SftpEntry) {
    setSftpContextMenu(null);
    setSftpActionError(null);
    setSftpActionDialog({ kind: 'delete', entry });
  }

  function openSftpCreateDirDialog(parentPath: string) {
    setSftpContextMenu(null);
    setSftpActionError(null);
    setSftpActionDialog({ kind: 'create_dir', parentPath, value: '' });
  }

  function openSftpPermissionsDialog(entry: SftpEntry) {
    setSftpContextMenu(null);
    setSftpActionError(null);
    setSftpActionDialog({
      kind: 'permissions',
      entry,
      value: defaultPermissionInput(entry)
    });
  }

  async function onSftpCopyToTarget(entry: SftpEntry) {
    const context = getConnectedSftpContext();
    if (!context) {
      return;
    }

    setSftpContextMenu(null);
    setSftpSelectedPath(entry.path);
    setSftpBusy(true);
    setSftpMessage(`正在复制到目标目录：${entry.path}`);

    const request: SftpDownloadRequest = {
      host: context.profile.host,
      port: context.profile.port,
      username: context.profile.username,
      auth: context.auth,
      remote_path: entry.path,
      local_dir: localPath || undefined
    };

    try {
      const result = await invoke<SftpDownloadResult>('sftp_download_file', { request });
      setSftpMessage(`已复制到目标目录：${result.local_path}（${formatBytes(result.bytes)}）`);
      if (localPath) {
        void loadLocalDir(localPath);
      }
    } catch (invokeError) {
      setSftpMessage(formatInvokeError(invokeError));
    } finally {
      setSftpBusy(false);
    }
  }

  async function onSftpRenameEntry(entry: SftpEntry, newName: string) {
    const context = getConnectedSftpContext();
    if (!context) {
      return;
    }

    const trimmedName = newName.trim();
    if (!trimmedName) {
      setSftpActionError('名称不能为空');
      return;
    }

    const request: SftpRenameRequest = {
      host: context.profile.host,
      port: context.profile.port,
      username: context.profile.username,
      auth: context.auth,
      path: entry.path,
      new_name: trimmedName
    };

    setSftpBusy(true);
    setSftpActionError(null);
    setSftpMessage(`正在重命名：${entry.name}`);

    try {
      await invoke('sftp_rename_entry', { request });
      setSftpActionDialog(null);
      setSftpSelectedPath(null);
      setSftpBusy(false);
      await loadSftpDir(context.profile, sftpPath);
      setSftpMessage(`已重命名为：${trimmedName}`);
    } catch (invokeError) {
      setSftpActionError(formatInvokeError(invokeError));
      setSftpBusy(false);
    }
  }

  async function onSftpDeleteEntry(entry: SftpEntry) {
    const context = getConnectedSftpContext();
    if (!context) {
      return;
    }

    const request: SftpDeleteRequest = {
      host: context.profile.host,
      port: context.profile.port,
      username: context.profile.username,
      auth: context.auth,
      path: entry.path
    };

    setSftpBusy(true);
    setSftpActionError(null);
    setSftpMessage(`正在删除：${entry.path}`);

    try {
      await invoke('sftp_delete_entry', { request });
      setSftpActionDialog(null);
      setSftpSelectedPath(null);
      setSftpBusy(false);
      await loadSftpDir(context.profile, sftpPath);
      setSftpMessage(`已删除：${entry.name}`);
    } catch (invokeError) {
      setSftpActionError(formatInvokeError(invokeError));
      setSftpBusy(false);
    }
  }

  async function onSftpCreateDir(parentPath: string, name: string) {
    const context = getConnectedSftpContext();
    if (!context) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setSftpActionError('文件夹名称不能为空');
      return;
    }

    const request: SftpCreateDirRequest = {
      host: context.profile.host,
      port: context.profile.port,
      username: context.profile.username,
      auth: context.auth,
      parent_path: parentPath,
      name: trimmedName
    };

    setSftpBusy(true);
    setSftpActionError(null);
    setSftpMessage(`正在创建文件夹：${trimmedName}`);

    try {
      await invoke('sftp_create_dir', { request });
      setSftpActionDialog(null);
      setSftpBusy(false);
      await loadSftpDir(context.profile, sftpPath);
      setSftpMessage(`已创建文件夹：${trimmedName}`);
    } catch (invokeError) {
      setSftpActionError(formatInvokeError(invokeError));
      setSftpBusy(false);
    }
  }

  async function onSftpSetPermissions(entry: SftpEntry, value: string) {
    const context = getConnectedSftpContext();
    if (!context) {
      return;
    }

    const permissions = parsePermissionInput(value);
    if (permissions === null) {
      setSftpActionError('请输入 3-4 位八进制权限，例如 755 或 0755');
      return;
    }

    const request: SftpSetPermissionsRequest = {
      host: context.profile.host,
      port: context.profile.port,
      username: context.profile.username,
      auth: context.auth,
      path: entry.path,
      permissions
    };

    setSftpBusy(true);
    setSftpActionError(null);
    setSftpMessage(`正在更新权限：${entry.path}`);

    try {
      await invoke('sftp_set_permissions', { request });
      setSftpActionDialog(null);
      setSftpBusy(false);
      await loadSftpDir(context.profile, sftpPath);
      setSftpMessage(`权限已更新为 ${value.trim()}`);
    } catch (invokeError) {
      setSftpActionError(formatInvokeError(invokeError));
      setSftpBusy(false);
    }
  }

  async function submitSftpActionDialog() {
    if (!sftpActionDialog) {
      return;
    }

    if (sftpActionDialog.kind === 'rename') {
      await onSftpRenameEntry(sftpActionDialog.entry, sftpActionDialog.value);
      return;
    }

    if (sftpActionDialog.kind === 'create_dir') {
      await onSftpCreateDir(sftpActionDialog.parentPath, sftpActionDialog.value);
      return;
    }

    if (sftpActionDialog.kind === 'permissions') {
      await onSftpSetPermissions(sftpActionDialog.entry, sftpActionDialog.value);
      return;
    }

    await onSftpDeleteEntry(sftpActionDialog.entry);
  }

  function onDisconnectSftpHost() {
    if (!connectedSftpProfile) {
      return;
    }
    const name = connectedSftpProfile.name;
    setConnectedSftpProfileId('');
    setSftpEntries([]);
    setSftpPath('/');
    setSftpPathInput('/');
    setSftpSelectedPath(null);
    setSftpContextMenu(null);
    setSftpActionDialog(null);
    setSftpActionError(null);
    setSftpMessage(`已关闭与 ${name} 的 SFTP 连接`);
  }

  function openCreateEditor() {
    setEditorMode('create');
    setEditor(createEmptyEditor());
    setTestState({ phase: 'idle', message: '' });
    setIsEditorOpen(true);
  }

  function openEditEditor(profile: ConnectionProfile) {
    setEditorMode('edit');
    setEditor({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authKind: profile.auth_kind,
      password: profile.password ?? '',
      privateKey: profile.private_key ?? '',
      passphrase: profile.passphrase ?? ''
    });
    setTestState({ phase: 'idle', message: '' });
    setIsEditorOpen(true);
  }

  function closeEditor() {
    if (editorBusy) {
      return;
    }
    setIsEditorOpen(false);
  }

  function openQuickConnect() {
    setIsQuickConnectOpen(true);
  }

  function closeQuickConnect() {
    setIsQuickConnectOpen(false);
  }

  async function onSaveEditor() {
    if (editorValidation) {
      setTestState({ phase: 'error', message: editorValidation });
      return;
    }

    setEditorBusy(true);

    const request: UpsertConnectionProfileRequest = {
      id: editor.id,
      name: editor.name.trim(),
      host: editor.host.trim(),
      port: editor.port,
      username: editor.username.trim(),
      auth_kind: editor.authKind,
      password: editor.authKind === 'password' ? editor.password : undefined,
      private_key: editor.authKind === 'private_key' ? editor.privateKey : undefined,
      passphrase: editor.authKind === 'private_key' && editor.passphrase ? editor.passphrase : undefined
    };

    try {
      const saved = await invoke<ConnectionProfile>('upsert_connection_profile', { request });
      setProfileMessage(`已保存：${saved.name}`);
      setIsEditorOpen(false);
      await refreshProfiles();
    } catch (invokeError) {
      setTestState({ phase: 'error', message: formatInvokeError(invokeError) });
    } finally {
      setEditorBusy(false);
    }
  }

  async function onTestConnection() {
    if (editorValidation) {
      setTestState({ phase: 'error', message: editorValidation });
      return;
    }

    const auth = buildAuthFromEditor(editor);

    const request: ConnectRequest = {
      host: editor.host.trim(),
      port: editor.port,
      username: editor.username.trim(),
      auth
    };

    setTestState({ phase: 'testing', message: '正在测试连接...' });

    try {
      await invoke<string>('test_ssh_connection', { request });
      setTestState({ phase: 'success', message: '连接测试成功' });
    } catch (invokeError) {
      setTestState({ phase: 'error', message: formatInvokeError(invokeError) });
    }
  }

  async function onDeleteProfile(profile: ConnectionProfile) {
    setProfilesBusy(true);
    setProfileMessage(null);

    const request: DeleteConnectionProfileRequest = { id: profile.id };

    try {
      await invoke('delete_connection_profile', { request });
      setProfileMessage(`已删除：${profile.name}`);
      await refreshProfiles();
    } catch (invokeError) {
      setProfileMessage(formatInvokeError(invokeError));
    } finally {
      setProfilesBusy(false);
    }
  }

  async function onConnectProfile(profile: ConnectionProfile) {
    const auth = buildAuthFromProfile(profile);
    if (!auth) {
      setProfileMessage(`服务器 ${profile.name} 缺少可用凭据，请先编辑并保存。`);
      return;
    }

    const tabId = createClientTabId();
    const newTab: SessionTab = {
      id: tabId,
      kind: 'ssh',
      profileId: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      status: 'connecting',
      statusMessage: '正在建立 SSH 连接...'
    };

    setSessionTabs((previous) => [...previous, newTab]);
    setActiveTabId(tabId);
    setContentView('workspace');

    const request: ConnectRequest = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      auth
    };

    try {
      const session = await invoke<SessionSummary>('connect_ssh', { request });
      setSessionTabs((previous) =>
        previous.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                sessionId: session.session_id,
                status: 'connected',
                statusMessage: '连接成功'
              }
            : tab
        )
      );
    } catch {
      setSessionTabs((previous) =>
        previous.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                status: 'error',
                statusMessage: '连接失败'
              }
            : tab
        )
      );
    }
  }

  async function onConnectLocalTerminal() {
    const tabId = createClientTabId();
    const newTab: SessionTab = {
      id: tabId,
      kind: 'local',
      name: '本地终端',
      host: 'localhost',
      port: 0,
      username: 'local',
      status: 'connecting',
      statusMessage: '正在启动本地终端...'
    };

    setSessionTabs((previous) => [...previous, newTab]);
    setActiveTabId(tabId);
    setContentView('workspace');

    const request: LocalConnectRequest = {};

    try {
      const session = await invoke<SessionSummary>('connect_local_terminal', { request });
      setSessionTabs((previous) =>
        previous.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                sessionId: session.session_id,
                status: 'connected',
                statusMessage: '本地终端已启动',
                host: session.host,
                username: session.username
              }
            : tab
        )
      );
    } catch (invokeError) {
      setSessionTabs((previous) =>
        previous.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                status: 'error',
                statusMessage: formatInvokeError(invokeError)
              }
            : tab
        )
      );
    }
  }

  async function onQuickConnectProfile(profile: ConnectionProfile) {
    closeQuickConnect();
    await onConnectProfile(profile);
  }

  async function onQuickConnectLocal() {
    closeQuickConnect();
    await onConnectLocalTerminal();
  }

  async function closeTab(tabId: string) {
    const target = sessionTabs.find((tab) => tab.id === tabId);
    if (!target) {
      return;
    }

    if (target.sessionId) {
      try {
        await invoke('disconnect_ssh', {
          request: {
            session_id: target.sessionId
          }
        });
      } catch {
        // Ignore close errors.
      }
    }

    const nextTabs = sessionTabs.filter((tab) => tab.id !== tabId);
    setSessionTabs(nextTabs);

    if (nextTabs.length === 0) {
      setActiveTabId(null);
      setContentView('servers');
      return;
    }

    if (activeTabId === tabId) {
      setActiveTabId(nextTabs[nextTabs.length - 1].id);
    }
  }

  async function onDisconnectActiveTab() {
    if (!activeTab) {
      return;
    }
    await closeTab(activeTab.id);
  }

  async function retryActiveTab() {
    if (!activeTab) {
      return;
    }

    if (activeTab.kind === 'local') {
      await closeTab(activeTab.id);
      await onConnectLocalTerminal();
      return;
    }

    const profile = profiles.find((item) => item.id === activeTab.profileId);
    if (!profile) {
      return;
    }

    await closeTab(activeTab.id);
    await onConnectProfile(profile);
  }

  function renderServers() {
    const connectedCount = sessionTabs.filter((item) => item.status === 'connected').length;

    return (
      <div className="servers-page">
        <aside className="servers-sidebar content-section">
          <h3 className="servers-sidebar-title">服务器</h3>
          <button type="button" className="servers-nav-btn active">
            全部服务器
            <span>{profiles.length}</span>
          </button>
          <button type="button" className="servers-nav-btn" onClick={openCreateEditor} disabled={profilesBusy}>
            新增服务器
          </button>
          <button
            type="button"
            className="servers-nav-btn"
            onClick={() => void refreshProfiles()}
            disabled={profilesBusy}
          >
            刷新列表
          </button>
          <p className="servers-sidebar-meta">活动会话：{connectedCount}</p>
        </aside>

        <section className="servers-content content-section">
          <div className="section-header">
            <h2>服务器列表</h2>
            <div className="section-actions">
              <button type="button" onClick={openCreateEditor} disabled={profilesBusy}>
                新增服务器
              </button>
            </div>
          </div>

          {profileMessage && <p className="status-line">{profileMessage}</p>}

          <div className="host-grid">
            <article className="host-card local-terminal-card">
              <header className="host-card-header">
                <div>
                  <h3>本地终端</h3>
                  <p className="local-terminal-meta">在当前设备打开本地 shell，会话支持多开</p>
                </div>
                <span className="chip">Local</span>
              </header>

              <div className="card-actions">
                <button type="button" onClick={() => void onConnectLocalTerminal()}>
                  打开终端
                </button>
              </div>
            </article>

            {profiles.length === 0 && <div className="empty-state host-empty">暂无服务器配置，点击“新增服务器”创建。</div>}

            {profiles.map((profile) => (
              <article key={profile.id} className="host-card">
                <header className="host-card-header">
                  <div>
                    <h3>{profile.name}</h3>
                    <p>{profile.username}@{profile.host}:{profile.port}</p>
                  </div>
                  <span className="chip">{profile.auth_kind === 'password' ? '密码' : '私钥'}</span>
                </header>

                <div className="card-actions">
                  <button type="button" onClick={() => void onConnectProfile(profile)}>
                    连接
                  </button>
                  <button type="button" onClick={() => openEditEditor(profile)} disabled={profilesBusy}>
                    编辑
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void onDeleteProfile(profile)}
                    disabled={profilesBusy}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderSftp() {
    return (
      <div className="sftp-dual-page">
        <section className="sftp-pane content-section">
          <div className="sftp-pane-header">
            <h2>Local</h2>
            <div className="section-actions">
              <button type="button" onClick={() => void onLocalGoParent()} disabled={!localParentPath || localBusy}>
                上级目录
              </button>
              <button type="button" onClick={() => void loadLocalDir(localPath)} disabled={localBusy}>
                刷新
              </button>
            </div>
          </div>

          <div className="sftp-path-bar">
            <input
              value={localPathInput}
              onChange={(event) => setLocalPathInput(event.target.value)}
              placeholder="本地路径"
              disabled={localBusy}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void onLocalOpenPath();
                }
              }}
            />
            <button type="button" onClick={() => void onLocalOpenPath()} disabled={localBusy}>
              打开
            </button>
          </div>

          {localMessage && <p className="status-line">{localMessage}</p>}

          <div
            className="sftp-table-wrap"
            onContextMenu={(event) => {
              if (!localPath) {
                return;
              }
              event.preventDefault();
              setLocalSelectedPath(null);
              openLocalContextMenuAt(event.clientX, event.clientY, null);
            }}
          >
            <table className="sftp-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>修改时间</th>
                  <th>大小</th>
                  <th>类型</th>
                </tr>
              </thead>
              <tbody>
                {localParentPath && (
                  <tr
                    className="sftp-entry-row dir parent"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setLocalSelectedPath(null);
                      openLocalContextMenuAt(event.clientX, event.clientY, null);
                    }}
                    onDoubleClick={() => {
                      void onLocalGoParent();
                    }}
                  >
                    <td>
                      <div className="entry-name-cell">
                        <span className="entry-icon dir" aria-hidden="true" />
                        <span>..</span>
                      </div>
                    </td>
                    <td>-</td>
                    <td>-</td>
                    <td>folder</td>
                  </tr>
                )}
                {localEntries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="sftp-empty-cell">
                      当前本地目录为空
                    </td>
                  </tr>
                ) : (
                  localEntries.map((entry) => (
                    <tr
                      key={entry.path}
                      className={
                        entry.is_dir
                          ? localSelectedPath === entry.path
                            ? 'sftp-entry-row dir selected'
                            : 'sftp-entry-row dir'
                          : localSelectedPath === entry.path
                            ? 'sftp-entry-row selected'
                            : 'sftp-entry-row'
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        setLocalSelectedPath(entry.path);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setLocalSelectedPath(entry.path);
                        openLocalContextMenuAt(event.clientX, event.clientY, entry);
                      }}
                      onDoubleClick={() => {
                        if (entry.is_dir) {
                          void onLocalEnterDir(entry);
                        }
                      }}
                    >
                      <td>
                        <div className="entry-name-cell">
                          <span className={entry.is_dir ? 'entry-icon dir' : 'entry-icon file'} aria-hidden="true" />
                          <span>{entry.name}</span>
                        </div>
                      </td>
                      <td>{formatUnixTime(entry.modified)}</td>
                      <td>{entry.is_dir ? '-' : formatBytes(entry.size)}</td>
                      <td>{entry.is_dir ? 'folder' : 'file'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sftp-pane content-section">
          <div className="sftp-pane-header">
            <h2>Remote (SFTP)</h2>
            <div className="section-actions">
              <select
                value={selectedSftpProfileId}
                onChange={(event) => onSelectSftpProfile(event.target.value)}
                disabled={profiles.length === 0 || sftpBusy}
              >
                <option value="">选择服务器</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onConnectSftpHost()}
                disabled={!selectedSftpProfile || sftpBusy || profiles.length === 0}
              >
                连接
              </button>
              <button
                type="button"
                onClick={() => {
                  if (connectedSftpProfile) {
                    void loadSftpDir(connectedSftpProfile, sftpPath);
                  }
                }}
                disabled={sftpBusy || !connectedSftpProfile}
              >
                刷新
              </button>
              <button type="button" onClick={onDisconnectSftpHost} disabled={sftpBusy || !connectedSftpProfile}>
                关闭连接
              </button>
            </div>
          </div>

          {sftpMessage && <p className="status-line">{sftpMessage}</p>}

          {profiles.length === 0 ? (
            <div className="empty-state">
              请先添加服务器，然后再使用 SFTP 浏览文件。
              <div className="section-actions center">
                <button type="button" onClick={openCreateEditor}>
                  新增服务器
                </button>
              </div>
            </div>
          ) : !connectedSftpProfile ? (
            <div className="empty-state">
              先选择一个已保存的服务器并点击“连接”，然后即可浏览远程文件。
              <div className="section-actions center">
                <button type="button" onClick={() => void onConnectSftpHost()} disabled={!selectedSftpProfile || sftpBusy}>
                  连接服务器
                </button>
              </div>
            </div>
          ) : (
            <div className="sftp-remote-body">
              <div className="sftp-path-bar sftp-path-bar-remote">
                <button type="button" onClick={() => void onSftpGoParent()} disabled={sftpBusy || sftpPath === '/'}>
                  上级
                </button>
                <input
                  value={sftpPathInput}
                  onChange={(event) => setSftpPathInput(event.target.value)}
                  placeholder="/"
                  disabled={sftpBusy}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void onOpenSftpPath();
                    }
                  }}
                />
                <button type="button" onClick={() => void onOpenSftpPath()} disabled={sftpBusy}>
                  打开
                </button>
              </div>

              <div
                className="sftp-table-wrap"
                onContextMenu={(event) => {
                  if (!connectedSftpProfile) {
                    return;
                  }
                  event.preventDefault();
                  setSftpSelectedPath(null);
                  openSftpContextMenuAt(event.clientX, event.clientY, null);
                }}
              >
                <table className="sftp-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>修改时间</th>
                      <th>大小</th>
                      <th>类型</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sftpPath !== '/' && (
                      <tr
                        className="sftp-entry-row dir parent"
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSftpSelectedPath(null);
                          openSftpContextMenuAt(event.clientX, event.clientY, null);
                        }}
                        onDoubleClick={() => {
                          void onSftpGoParent();
                        }}
                      >
                        <td>
                          <div className="entry-name-cell">
                            <span className="entry-icon dir" aria-hidden="true" />
                            <span>..</span>
                          </div>
                        </td>
                        <td>-</td>
                        <td>-</td>
                        <td>folder</td>
                      </tr>
                    )}
                    {sftpEntries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="sftp-empty-cell">
                          当前远程目录为空
                        </td>
                      </tr>
                    ) : (
                      sftpEntries.map((entry) => (
                        <tr
                          key={entry.path}
                          className={
                            entry.is_dir
                              ? sftpSelectedPath === entry.path
                                ? 'sftp-entry-row dir selected'
                                : 'sftp-entry-row dir'
                              : sftpSelectedPath === entry.path
                                ? 'sftp-entry-row selected'
                                : 'sftp-entry-row'
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            setSftpSelectedPath(entry.path);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSftpSelectedPath(entry.path);
                            openSftpContextMenuAt(event.clientX, event.clientY, entry);
                          }}
                          onDoubleClick={() => {
                            if (entry.is_dir) {
                              void onSftpEnterDir(entry);
                              return;
                            }
                            void onSftpDownload(entry);
                          }}
                        >
                          <td>
                            <div className="entry-name-cell">
                              <span className={entry.is_dir ? 'entry-icon dir' : 'entry-icon file'} aria-hidden="true" />
                              <span>{entry.name}</span>
                            </div>
                          </td>
                          <td>{formatUnixTime(entry.modified)}</td>
                          <td>{entry.is_dir ? '-' : formatBytes(entry.size)}</td>
                          <td>{entry.is_dir ? 'folder' : 'file'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderWorkspace() {
    if (!activeTab) {
      return <div className="workspace-empty">暂无会话，请从服务器页发起连接。</div>;
    }

    if (activeTab.status !== 'connected') {
      const title =
        activeTab.status === 'connecting'
          ? '正在连接...'
          : activeTab.status === 'error'
            ? '连接失败'
            : '连接已关闭';

      return (
        <div className="connect-page">
          <div className="connect-card">
            <div className="connect-target">
              <h3>{title}</h3>
              <p>{activeTab.name}</p>
            </div>

            <div className={`connect-line ${activeTab.status}`}>
              <div className="connect-node left" />
              <div className="connect-track" />
              <div className="connect-node right" />
            </div>

            <p className={activeTab.status === 'error' ? 'status-line error' : 'status-line'}>
              {activeTab.statusMessage}
            </p>

            <div className="section-actions center">
              <button type="button" onClick={() => void onDisconnectActiveTab()}>
                关闭
              </button>
              {activeTab.status === 'error' && (
                <button type="button" onClick={() => void retryActiveTab()}>
                  重试
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="workspace-terminal-view">
        <div className="terminal-stack">
          {sessionTabs
            .filter((tab) => tab.sessionId)
            .map((tab) => (
              <div key={tab.id} className={activeTabId === tab.id ? 'terminal-pane active' : 'terminal-pane hidden'}>
                <TerminalView
                  sessionId={tab.sessionId!}
                  active={contentView === 'workspace' && activeTabId === tab.id}
                />
              </div>
            ))}
        </div>
      </div>
    );
  }

  function renderBody() {
    return (
      <>
        <div className={contentView === 'servers' ? 'view-page' : 'view-page hidden'}>{renderServers()}</div>
        <div className={contentView === 'sftp' ? 'view-page' : 'view-page hidden'}>{renderSftp()}</div>
        <div className={contentView === 'workspace' ? 'view-page workspace-page' : 'view-page workspace-page hidden'}>
          {renderWorkspace()}
        </div>
      </>
    );
  }

  function renderEditorModal() {
    if (!isEditorOpen) {
      return null;
    }

    return (
      <div className="editor-modal-overlay" onClick={closeEditor}>
        <section
          className="editor-modal"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Server editor"
        >
          <header className="editor-modal-header">
            <h3>{editorMode === 'create' ? '新增服务器' : '编辑服务器'}</h3>
            <button type="button" className="header-action" onClick={closeEditor} disabled={editorBusy}>
              关闭
            </button>
          </header>

          <div className="editor-modal-body">
            <div className="editor-grid modal-grid">
              <label>
                名称
                <input
                  value={editor.name}
                  onChange={(event) => setEditor((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="如：生产服务器"
                />
              </label>

              <label>
                Host
                <input
                  value={editor.host}
                  onChange={(event) => setEditor((prev) => ({ ...prev, host: event.target.value }))}
                  placeholder="server.example.com"
                />
              </label>

              <label>
                Port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={editor.port}
                  onChange={(event) =>
                    setEditor((prev) => ({
                      ...prev,
                      port: Number(event.target.value)
                    }))
                  }
                />
              </label>

              <label>
                用户名
                <input
                  value={editor.username}
                  onChange={(event) => setEditor((prev) => ({ ...prev, username: event.target.value }))}
                  placeholder="root"
                />
              </label>

              <label>
                认证方式
                <select
                  value={editor.authKind}
                  onChange={(event) =>
                    setEditor((prev) => ({
                      ...prev,
                      authKind: event.target.value as AuthType
                    }))
                  }
                >
                  <option value="password">密码</option>
                  <option value="private_key">私钥</option>
                </select>
              </label>
            </div>

            {editor.authKind === 'password' ? (
              <label>
                密码
                <input
                  type="password"
                  value={editor.password}
                  onChange={(event) => setEditor((prev) => ({ ...prev, password: event.target.value }))}
                  autoComplete="off"
                />
              </label>
            ) : (
              <>
                <label>
                  私钥 (PEM)
                  <textarea
                    rows={6}
                    value={editor.privateKey}
                    onChange={(event) => setEditor((prev) => ({ ...prev, privateKey: event.target.value }))}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  />
                </label>
                <label>
                  私钥口令 (可选)
                  <input
                    type="password"
                    value={editor.passphrase}
                    onChange={(event) => setEditor((prev) => ({ ...prev, passphrase: event.target.value }))}
                    autoComplete="off"
                  />
                </label>
              </>
            )}

            {testState.phase !== 'idle' && (
              <p className={testState.phase === 'error' ? 'status-line error' : 'status-line'}>
                {testState.message}
              </p>
            )}

            {editorValidation && testState.phase === 'idle' && <p className="status-line error">{editorValidation}</p>}
          </div>

          <footer className="editor-modal-footer">
            <button type="button" onClick={closeEditor} disabled={editorBusy}>
              取消
            </button>
            <button type="button" onClick={() => void onTestConnection()} disabled={editorBusy || testState.phase === 'testing'}>
              {testState.phase === 'testing' ? '测试中...' : '测试连接'}
            </button>
            <button type="button" onClick={() => void onSaveEditor()} disabled={editorBusy || Boolean(editorValidation)}>
              {editorBusy ? '保存中...' : '保存'}
            </button>
          </footer>
        </section>
      </div>
    );
  }

  function renderQuickConnectModal() {
    if (!isQuickConnectOpen) {
      return null;
    }

    return (
      <div className="quick-connect-overlay" onClick={closeQuickConnect}>
        <section
          className="quick-connect-modal"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Quick connect"
        >
          <header className="quick-connect-header">
            <h3>创建新的 SSH 连接</h3>
            <button type="button" className="header-action" onClick={closeQuickConnect}>
              关闭
            </button>
          </header>

          <div className="quick-connect-body">
            <div className="quick-connect-shortcuts">
              <button type="button" className="quick-connect-local" onClick={() => void onQuickConnectLocal()}>
                打开本地终端
              </button>
            </div>

            {profiles.length === 0 ? (
              <div className="empty-state">
                还没有可用服务器，请先添加服务器配置。
                <div className="section-actions center">
                  <button
                    type="button"
                    onClick={() => {
                      closeQuickConnect();
                      openCreateEditor();
                      setContentView('servers');
                    }}
                  >
                    去添加服务器
                  </button>
                </div>
              </div>
            ) : (
              <div className="quick-connect-list">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className="quick-connect-item"
                    onClick={() => void onQuickConnectProfile(profile)}
                  >
                    <span className="quick-connect-name">{profile.name}</span>
                    <span className="quick-connect-meta">
                      {profile.username}@{profile.host}:{profile.port}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderLocalContextMenu() {
    if (!localContextMenu || contentView !== 'sftp') {
      return null;
    }

    const menuWidth = 240;
    const menuHeight = localContextMenu.entry ? 260 : 128;
    const left =
      typeof window === 'undefined'
        ? localContextMenu.x
        : Math.max(8, Math.min(localContextMenu.x, window.innerWidth - menuWidth - 8));
    const top =
      typeof window === 'undefined'
        ? localContextMenu.y
        : Math.max(8, Math.min(localContextMenu.y, window.innerHeight - menuHeight - 8));
    const entry = localContextMenu.entry;

    return (
      <div className="sftp-context-layer">
        <div
          ref={localContextMenuRef}
          className="sftp-context-menu"
          style={{ left, top }}
          role="menu"
          onContextMenu={(event) => event.preventDefault()}
        >
          {entry ? (
            <>
              {entry.is_dir && (
                <button
                  type="button"
                  className="sftp-context-action"
                  onClick={() => {
                    setLocalContextMenu(null);
                    void onLocalEnterDir(entry);
                  }}
                >
                  打开目录
                </button>
              )}
              <button type="button" className="sftp-context-action" onClick={() => openLocalRenameDialog(entry)}>
                重命名
              </button>
              <button
                type="button"
                className="sftp-context-action danger"
                onClick={() => openLocalDeleteDialog(entry)}
              >
                删除
              </button>
              <div className="sftp-context-separator" />
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => {
                  setLocalContextMenu(null);
                  if (localPath) {
                    void loadLocalDir(localPath);
                  }
                }}
              >
                刷新
              </button>
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => {
                  if (localPath) {
                    openLocalCreateDirDialog(localPath);
                  }
                }}
              >
                新建文件夹
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => {
                  setLocalContextMenu(null);
                  if (localPath) {
                    void loadLocalDir(localPath);
                  }
                }}
              >
                刷新
              </button>
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => {
                  if (localPath) {
                    openLocalCreateDirDialog(localPath);
                  }
                }}
              >
                新建文件夹
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderLocalActionDialog() {
    if (!localActionDialog) {
      return null;
    }

    const title =
      localActionDialog.kind === 'rename'
        ? '重命名'
        : localActionDialog.kind === 'create_dir'
          ? '新建文件夹'
          : '删除确认';
    const submitLabel =
      localActionDialog.kind === 'rename'
        ? '保存'
        : localActionDialog.kind === 'create_dir'
          ? '创建'
          : '删除';

    return (
      <div className="editor-modal-overlay" onClick={closeLocalActionDialog}>
        <section
          className="editor-modal sftp-action-modal"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <header className="editor-modal-header">
            <h3>{title}</h3>
            <button type="button" className="header-action" onClick={closeLocalActionDialog} disabled={localBusy}>
              关闭
            </button>
          </header>

          <div className="editor-modal-body sftp-action-modal-body">
            {localActionDialog.kind === 'delete' ? (
              <>
                <p className="sftp-action-copy">
                  确认删除{localActionDialog.entry.is_dir ? '目录' : '文件'} <strong>{localActionDialog.entry.name}</strong>？
                </p>
                <p className="sftp-action-hint">
                  {localActionDialog.entry.is_dir ? '目录会递归删除，操作不可撤销。' : '删除后不可撤销。'}
                </p>
              </>
            ) : (
              <label>
                {localActionDialog.kind === 'rename' ? '新名称' : '文件夹名称'}
                <input
                  value={localActionDialog.value}
                  autoFocus
                  disabled={localBusy}
                  onChange={(event) => updateLocalActionValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitLocalActionDialog();
                    }
                  }}
                />
              </label>
            )}

            {localActionError && <p className="status-line error">{localActionError}</p>}
          </div>

          <footer className="editor-modal-footer">
            <button type="button" onClick={closeLocalActionDialog} disabled={localBusy}>
              取消
            </button>
            <button
              type="button"
              className={localActionDialog.kind === 'delete' ? 'danger' : ''}
              onClick={() => {
                void submitLocalActionDialog();
              }}
              disabled={localBusy}
            >
              {submitLabel}
            </button>
          </footer>
        </section>
      </div>
    );
  }

  function renderSftpContextMenu() {
    if (!sftpContextMenu || contentView !== 'sftp') {
      return null;
    }

    const menuWidth = 240;
    const menuHeight = sftpContextMenu.entry ? 320 : 128;
    const left =
      typeof window === 'undefined'
        ? sftpContextMenu.x
        : Math.max(8, Math.min(sftpContextMenu.x, window.innerWidth - menuWidth - 8));
    const top =
      typeof window === 'undefined'
        ? sftpContextMenu.y
        : Math.max(8, Math.min(sftpContextMenu.y, window.innerHeight - menuHeight - 8));

    const entry = sftpContextMenu.entry;

    return (
      <div className="sftp-context-layer">
        <div
          ref={sftpContextMenuRef}
          className="sftp-context-menu"
          style={{ left, top }}
          role="menu"
          onContextMenu={(event) => event.preventDefault()}
        >
          {entry ? (
            <>
              {entry.is_dir && (
                <button
                  type="button"
                  className="sftp-context-action"
                  onClick={() => {
                    setSftpContextMenu(null);
                    void onSftpEnterDir(entry);
                  }}
                >
                  打开目录
                </button>
              )}
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => {
                  void onSftpCopyToTarget(entry);
                }}
              >
                复制到目标目录
              </button>
              <button type="button" className="sftp-context-action" onClick={() => openSftpRenameDialog(entry)}>
                重命名
              </button>
              <button
                type="button"
                className="sftp-context-action danger"
                onClick={() => openSftpDeleteDialog(entry)}
              >
                删除
              </button>
              <div className="sftp-context-separator" />
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => {
                  setSftpContextMenu(null);
                  if (connectedSftpProfile) {
                    void loadSftpDir(connectedSftpProfile, sftpPath);
                  }
                }}
              >
                刷新
              </button>
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => openSftpCreateDirDialog(sftpPath)}
              >
                新建文件夹
              </button>
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => openSftpPermissionsDialog(entry)}
              >
                编辑权限
                <span className="sftp-context-meta">{formatPermissionMode(entry.permissions)}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => {
                  setSftpContextMenu(null);
                  if (connectedSftpProfile) {
                    void loadSftpDir(connectedSftpProfile, sftpPath);
                  }
                }}
              >
                刷新
              </button>
              <button
                type="button"
                className="sftp-context-action"
                onClick={() => openSftpCreateDirDialog(sftpPath)}
              >
                新建文件夹
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderSftpActionDialog() {
    if (!sftpActionDialog) {
      return null;
    }

    const title =
      sftpActionDialog.kind === 'rename'
        ? '重命名'
        : sftpActionDialog.kind === 'create_dir'
          ? '新建文件夹'
          : sftpActionDialog.kind === 'permissions'
            ? '编辑权限'
            : '删除确认';
    const submitLabel =
      sftpActionDialog.kind === 'rename'
        ? '保存'
        : sftpActionDialog.kind === 'create_dir'
          ? '创建'
          : sftpActionDialog.kind === 'permissions'
            ? '更新'
            : '删除';

    return (
      <div className="editor-modal-overlay" onClick={closeSftpActionDialog}>
        <section
          className="editor-modal sftp-action-modal"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <header className="editor-modal-header">
            <h3>{title}</h3>
            <button type="button" className="header-action" onClick={closeSftpActionDialog} disabled={sftpBusy}>
              关闭
            </button>
          </header>

          <div className="editor-modal-body sftp-action-modal-body">
            {sftpActionDialog.kind === 'delete' ? (
              <>
                <p className="sftp-action-copy">
                  确认删除{sftpActionDialog.entry.is_dir ? '目录' : '文件'} <strong>{sftpActionDialog.entry.name}</strong>？
                </p>
                <p className="sftp-action-hint">
                  {sftpActionDialog.entry.is_dir ? '目录会递归删除，操作不可撤销。' : '删除后不可撤销。'}
                </p>
              </>
            ) : (
              <label>
                {sftpActionDialog.kind === 'rename'
                  ? '新名称'
                  : sftpActionDialog.kind === 'create_dir'
                    ? '文件夹名称'
                    : '权限（八进制）'}
                <input
                  value={sftpActionDialog.value}
                  autoFocus
                  disabled={sftpBusy}
                  placeholder={sftpActionDialog.kind === 'permissions' ? '755' : ''}
                  onChange={(event) => updateSftpActionValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitSftpActionDialog();
                    }
                  }}
                />
              </label>
            )}

            {sftpActionDialog.kind === 'permissions' && (
              <p className="sftp-action-hint">当前权限：{formatPermissionMode(sftpActionDialog.entry.permissions)}</p>
            )}

            {sftpActionError && <p className="status-line error">{sftpActionError}</p>}
          </div>

          <footer className="editor-modal-footer">
            <button type="button" onClick={closeSftpActionDialog} disabled={sftpBusy}>
              取消
            </button>
            <button
              type="button"
              className={sftpActionDialog.kind === 'delete' ? 'danger' : ''}
              onClick={() => {
                void submitSftpActionDialog();
              }}
              disabled={sftpBusy}
            >
              {submitLabel}
            </button>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <main className="window-shell">
      <header className="window-header">
        <div className="header-functions">
          <button
            type="button"
            className={contentView === 'servers' ? 'header-pill active' : 'header-pill'}
            onClick={() => setContentView('servers')}
          >
            服务器
          </button>
          <button
            type="button"
            className={contentView === 'sftp' ? 'header-pill active' : 'header-pill'}
            onClick={() => void openSftpView()}
          >
            SFTP
          </button>
        </div>

        <div className="header-tabs">
          {sessionTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTabId === tab.id ? 'session-tab active' : 'session-tab'}
              onClick={() => {
                setActiveTabId(tab.id);
                setContentView('workspace');
              }}
            >
              <span className={`dot ${tab.status}`} />
              <span className="tab-title">{tab.name}</span>
              <span
                className="tab-close"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    void closeTab(tab.id);
                  }
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>

        <div className="header-actions">
          {contentView === 'workspace' && activeTab && (
            <>
              {activeTab.status === 'error' && (
                <button type="button" className="header-action" onClick={() => void retryActiveTab()}>
                  重试
                </button>
              )}
              <button type="button" className="header-action" onClick={() => void onDisconnectActiveTab()}>
                断开
              </button>
            </>
          )}
          <button type="button" className="header-plus" onClick={openQuickConnect}>
            +
          </button>
        </div>
      </header>

      <section
        className={
          contentView === 'workspace'
            ? 'window-body workspace-body'
            : contentView === 'sftp'
              ? 'window-body sftp-body'
              : 'window-body'
        }
      >
        {renderBody()}
      </section>

      {renderEditorModal()}
      {renderQuickConnectModal()}
      {renderLocalActionDialog()}
      {renderLocalContextMenu()}
      {renderSftpActionDialog()}
      {renderSftpContextMenu()}
    </main>
  );
}
