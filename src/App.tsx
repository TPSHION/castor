import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LocalActionDialog } from './components/LocalActionDialog';
import { LocalContextMenu } from './components/LocalContextMenu';
import { QuickConnectModal } from './components/QuickConnectModal';
import { ServerEditorModal } from './components/ServerEditorModal';
import { ServersView } from './components/ServersView';
import { SftpActionDialog } from './components/SftpActionDialog';
import { SftpContextMenu } from './components/SftpContextMenu';
import { SftpView } from './components/SftpView';
import { WorkspaceView } from './components/WorkspaceView';
import type {
  AuthConfig,
  ConnectRequest,
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
  SftpUploadRequest,
  SftpUploadResult,
  SftpTransferProgressPayload,
  SftpRenameRequest,
  SftpSetPermissionsRequest,
  UpsertConnectionProfileRequest
} from './types';
import type {
  ContentView,
  EditorMode,
  LocalActionDialogState,
  LocalContextMenuState,
  ProfileEditor,
  SessionTab,
  SftpActionDialogState,
  SftpContextMenuState,
  TestState,
  ConnectionProfile
} from './app/types';
import {
  buildAuthFromEditor,
  buildAuthFromProfile,
  createClientTabId,
  createEmptyEditor,
  defaultPermissionInput,
  formatBytes,
  formatInvokeError,
  formatPermissionMode,
  formatUnixTime,
  normalizeRemotePath,
  parentRemotePath,
  parsePermissionInput,
  validateEditor
} from './app/helpers';

export function App() {
  const MIN_TRANSFER_PROGRESS_VISIBLE_MS = 600;
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
  const [localTransferProgress, setLocalTransferProgress] = useState<SftpTransferProgressPayload | null>(null);
  const activeLocalUploadTransferIdRef = useRef<string | null>(null);
  const localTransferStartedAtRef = useRef<number | null>(null);
  const localTransferClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localContextMenuRef = useRef<HTMLDivElement>(null);

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
  const [sftpTransferProgress, setSftpTransferProgress] = useState<SftpTransferProgressPayload | null>(null);
  const activeSftpDownloadTransferIdRef = useRef<string | null>(null);
  const sftpTransferStartedAtRef = useRef<number | null>(null);
  const sftpTransferClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sftpContextMenuRef = useRef<HTMLDivElement>(null);

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

  function createTransferId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clearLocalTransferTimer() {
    if (localTransferClearTimerRef.current) {
      clearTimeout(localTransferClearTimerRef.current);
      localTransferClearTimerRef.current = null;
    }
  }

  function clearSftpTransferTimer() {
    if (sftpTransferClearTimerRef.current) {
      clearTimeout(sftpTransferClearTimerRef.current);
      sftpTransferClearTimerRef.current = null;
    }
  }

  function withTransferMetrics(
    payload: SftpTransferProgressPayload,
    startedAt: number | null
  ): SftpTransferProgressPayload {
    if (payload.status === 'done') {
      return { ...payload, eta_seconds: 0, speed_bps: null };
    }

    if (payload.status !== 'running' || startedAt === null || payload.transferred_bytes <= 0) {
      return { ...payload, eta_seconds: null, speed_bps: null };
    }

    const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
    const speedBps = payload.transferred_bytes / elapsedSeconds;
    if (!Number.isFinite(speedBps) || speedBps <= 0) {
      return { ...payload, eta_seconds: null, speed_bps: null };
    }

    if (payload.total_bytes > 0 && payload.total_bytes > payload.transferred_bytes) {
      const remainingBytes = payload.total_bytes - payload.transferred_bytes;
      return {
        ...payload,
        eta_seconds: Math.ceil(remainingBytes / speedBps),
        speed_bps: speedBps
      };
    }

    return { ...payload, eta_seconds: null, speed_bps: speedBps };
  }

  function applyLocalTransferProgress(payload: SftpTransferProgressPayload) {
    if (payload.status === 'running') {
      clearLocalTransferTimer();
      if (localTransferStartedAtRef.current === null) {
        localTransferStartedAtRef.current = Date.now();
      }
      setLocalTransferProgress(withTransferMetrics(payload, localTransferStartedAtRef.current));
      return;
    }

    setLocalTransferProgress(withTransferMetrics(payload, localTransferStartedAtRef.current));
    const startedAt = localTransferStartedAtRef.current ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const delay = Math.max(0, MIN_TRANSFER_PROGRESS_VISIBLE_MS - elapsed);
    clearLocalTransferTimer();
    localTransferClearTimerRef.current = setTimeout(() => {
      setLocalTransferProgress(null);
      localTransferStartedAtRef.current = null;
      localTransferClearTimerRef.current = null;
    }, delay);
  }

  function applySftpTransferProgress(payload: SftpTransferProgressPayload) {
    if (payload.status === 'running') {
      clearSftpTransferTimer();
      if (sftpTransferStartedAtRef.current === null) {
        sftpTransferStartedAtRef.current = Date.now();
      }
      setSftpTransferProgress(withTransferMetrics(payload, sftpTransferStartedAtRef.current));
      return;
    }

    setSftpTransferProgress(withTransferMetrics(payload, sftpTransferStartedAtRef.current));
    const startedAt = sftpTransferStartedAtRef.current ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const delay = Math.max(0, MIN_TRANSFER_PROGRESS_VISIBLE_MS - elapsed);
    clearSftpTransferTimer();
    sftpTransferClearTimerRef.current = setTimeout(() => {
      setSftpTransferProgress(null);
      sftpTransferStartedAtRef.current = null;
      sftpTransferClearTimerRef.current = null;
    }, delay);
  }

  useEffect(() => {
    void refreshProfiles();
  }, []);

  useEffect(() => {
    const updateSftpScrollbarWidth = () => {
      const probe = document.createElement('div');
      probe.style.width = '120px';
      probe.style.height = '120px';
      probe.style.overflow = 'scroll';
      probe.style.position = 'absolute';
      probe.style.top = '-9999px';
      probe.style.left = '-9999px';
      probe.style.visibility = 'hidden';
      document.body.appendChild(probe);
      const scrollbarWidth = probe.offsetWidth - probe.clientWidth;
      document.body.removeChild(probe);
      document.documentElement.style.setProperty('--sftp-body-scrollbar-width', `${Math.max(0, scrollbarWidth)}px`);
    };

    updateSftpScrollbarWidth();
    window.addEventListener('resize', updateSftpScrollbarWidth);
    return () => {
      window.removeEventListener('resize', updateSftpScrollbarWidth);
    };
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
      clearLocalTransferTimer();
      clearSftpTransferTimer();
      activeLocalUploadTransferIdRef.current = null;
      activeSftpDownloadTransferIdRef.current = null;
      localTransferStartedAtRef.current = null;
      sftpTransferStartedAtRef.current = null;
      setLocalTransferProgress(null);
      setSftpTransferProgress(null);
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
      clearSftpTransferTimer();
      activeSftpDownloadTransferIdRef.current = null;
      sftpTransferStartedAtRef.current = null;
      setSftpTransferProgress(null);
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

  useEffect(
    () => () => {
      clearLocalTransferTimer();
      clearSftpTransferTimer();
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    const unsubscribePromise = listen<SftpTransferProgressPayload>('sftp-transfer-progress', (event) => {
      if (!mounted) {
        return;
      }

      if (event.payload.direction === 'upload') {
        if (
          activeLocalUploadTransferIdRef.current &&
          event.payload.transfer_id !== activeLocalUploadTransferIdRef.current
        ) {
          return;
        }
        applyLocalTransferProgress(event.payload);
        if (event.payload.status !== 'running') {
          activeLocalUploadTransferIdRef.current = null;
        }
        return;
      }

      if (
        activeSftpDownloadTransferIdRef.current &&
        event.payload.transfer_id !== activeSftpDownloadTransferIdRef.current
      ) {
        return;
      }
      applySftpTransferProgress(event.payload);
      if (event.payload.status !== 'running') {
        activeSftpDownloadTransferIdRef.current = null;
      }
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

  async function onLocalCopyToTarget(entry: LocalFsEntry) {
    if (!connectedSftpProfile) {
      setLocalMessage('请先连接服务器。');
      return;
    }

    const auth = buildAuthFromProfile(connectedSftpProfile);
    if (!auth) {
      setLocalMessage(`服务器 ${connectedSftpProfile.name} 缺少可用凭据，请先编辑并保存。`);
      return;
    }

    setLocalContextMenu(null);
    setLocalSelectedPath(entry.path);
    setLocalBusy(true);
    const transferId = createTransferId();
    activeLocalUploadTransferIdRef.current = transferId;
    clearLocalTransferTimer();
    localTransferStartedAtRef.current = Date.now();
    setLocalTransferProgress({
      transfer_id: transferId,
      direction: 'upload',
      status: 'running',
      path: entry.path,
      target_path: sftpPath,
      transferred_bytes: 0,
      total_bytes: 0,
      percent: 0
    });
    setLocalMessage(`正在复制到目标目录：${entry.path}`);

    const request: SftpUploadRequest = {
      host: connectedSftpProfile.host,
      port: connectedSftpProfile.port,
      username: connectedSftpProfile.username,
      auth,
      local_path: entry.path,
      remote_dir: sftpPath,
      transfer_id: transferId
    };

    try {
      const result = await invoke<SftpUploadResult>('sftp_upload_path', { request });
      setLocalMessage(`已复制到目标目录：${result.remote_path}（${formatBytes(result.bytes)}）`);
      await loadSftpDir(connectedSftpProfile, sftpPath);
    } catch (invokeError) {
      const message = formatInvokeError(invokeError);
      setLocalMessage(message);
      if (!message.includes('已取消')) {
        applyLocalTransferProgress({
          transfer_id: transferId,
          direction: 'upload',
          status: 'error',
          path: entry.path,
          target_path: sftpPath,
          transferred_bytes: 0,
          total_bytes: 0,
          percent: 0
        });
        activeLocalUploadTransferIdRef.current = null;
      }
    } finally {
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
    const transferId = createTransferId();
    activeSftpDownloadTransferIdRef.current = transferId;
    request.transfer_id = transferId;
    clearSftpTransferTimer();
    sftpTransferStartedAtRef.current = Date.now();
    setSftpTransferProgress({
      transfer_id: transferId,
      direction: 'download',
      status: 'running',
      path: entry.path,
      target_path: localPath || '',
      transferred_bytes: 0,
      total_bytes: 0,
      percent: 0
    });
    setSftpMessage(`正在下载：${entry.path}`);

    try {
      const result = await invoke<SftpDownloadResult>('sftp_download_file', { request });
      setSftpMessage(`下载完成：${result.local_path}（${formatBytes(result.bytes)}）`);
    } catch (invokeError) {
      const message = formatInvokeError(invokeError);
      setSftpMessage(message);
      if (!message.includes('已取消')) {
        applySftpTransferProgress({
          transfer_id: transferId,
          direction: 'download',
          status: 'error',
          path: entry.path,
          target_path: localPath || '',
          transferred_bytes: 0,
          total_bytes: 0,
          percent: 0
        });
        activeSftpDownloadTransferIdRef.current = null;
      }
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

  async function onSftpCopyToTarget(entry: SftpEntry) {
    const context = getConnectedSftpContext();
    if (!context) {
      return;
    }

    setSftpContextMenu(null);
    setSftpSelectedPath(entry.path);
    setSftpBusy(true);
    const transferId = createTransferId();
    activeSftpDownloadTransferIdRef.current = transferId;
    clearSftpTransferTimer();
    sftpTransferStartedAtRef.current = Date.now();
    setSftpTransferProgress({
      transfer_id: transferId,
      direction: 'download',
      status: 'running',
      path: entry.path,
      target_path: localPath || '',
      transferred_bytes: 0,
      total_bytes: 0,
      percent: 0
    });
    setSftpMessage(`正在下载到目标目录：${entry.path}`);

    const request: SftpDownloadRequest = {
      host: context.profile.host,
      port: context.profile.port,
      username: context.profile.username,
      auth: context.auth,
      remote_path: entry.path,
      local_dir: localPath || undefined
    };
    request.transfer_id = transferId;

    try {
      const result = await invoke<SftpDownloadResult>('sftp_download_file', { request });
      setSftpMessage(`已下载到目标目录：${result.local_path}（${formatBytes(result.bytes)}）`);
      if (localPath) {
        void loadLocalDir(localPath);
      }
    } catch (invokeError) {
      const message = formatInvokeError(invokeError);
      setSftpMessage(message);
      if (!message.includes('已取消')) {
        applySftpTransferProgress({
          transfer_id: transferId,
          direction: 'download',
          status: 'error',
          path: entry.path,
          target_path: localPath || '',
          transferred_bytes: 0,
          total_bytes: 0,
          percent: 0
        });
        activeSftpDownloadTransferIdRef.current = null;
      }
    } finally {
      setSftpBusy(false);
    }
  }

  async function onCancelSftpDownload() {
    const transferId = activeSftpDownloadTransferIdRef.current;
    if (!transferId) {
      return;
    }

    setSftpMessage('正在取消下载...');
    try {
      await invoke('cancel_sftp_transfer', {
        request: {
          transfer_id: transferId
        }
      });
    } catch (invokeError) {
      const message = formatInvokeError(invokeError);
      if (!message.includes('不存在') && !message.includes('已结束')) {
        setSftpMessage(message);
      }
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
    clearSftpTransferTimer();
    sftpTransferStartedAtRef.current = null;
    setSftpTransferProgress(null);
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

  function renderBody() {
    const connectedCount = sessionTabs.filter((item) => item.status === 'connected').length;

    return (
      <>
        <div className={contentView === 'servers' ? 'view-page' : 'view-page hidden'}>
          <ServersView
            profiles={profiles}
            profilesBusy={profilesBusy}
            profileMessage={profileMessage}
            connectedCount={connectedCount}
            onOpenCreateEditor={openCreateEditor}
            onRefreshProfiles={() => void refreshProfiles()}
            onConnectLocalTerminal={() => void onConnectLocalTerminal()}
            onConnectProfile={(profile) => void onConnectProfile(profile)}
            onOpenEditEditor={openEditEditor}
            onDeleteProfile={(profile) => void onDeleteProfile(profile)}
          />
        </div>
        <div className={contentView === 'sftp' ? 'view-page' : 'view-page hidden'}>
          <SftpView
            profiles={profiles}
            selectedSftpProfileId={selectedSftpProfileId}
            selectedSftpProfile={selectedSftpProfile}
            connectedSftpProfile={connectedSftpProfile}
            sftpBusy={sftpBusy}
            sftpMessage={sftpMessage}
            sftpPath={sftpPath}
            sftpPathInput={sftpPathInput}
            sftpEntries={sftpEntries}
            sftpSelectedPath={sftpSelectedPath}
            localPath={localPath}
            localPathInput={localPathInput}
            localParentPath={localParentPath}
            localEntries={localEntries}
            localBusy={localBusy}
            localMessage={localMessage}
            localSelectedPath={localSelectedPath}
            localTransferProgress={localTransferProgress}
            sftpTransferProgress={sftpTransferProgress}
            formatBytes={formatBytes}
            formatUnixTime={formatUnixTime}
            onSelectSftpProfile={onSelectSftpProfile}
            onConnectSftpHost={() => void onConnectSftpHost()}
            onRefreshConnectedSftpHost={() => {
              if (connectedSftpProfile) {
                void loadSftpDir(connectedSftpProfile, sftpPath);
              }
            }}
            onDisconnectSftpHost={onDisconnectSftpHost}
            onSftpPathInputChange={setSftpPathInput}
            onOpenSftpPath={() => void onOpenSftpPath()}
            onSftpGoParent={() => void onSftpGoParent()}
            onSftpEnterDir={(entry) => void onSftpEnterDir(entry)}
            onSftpDownload={(entry) => void onSftpDownload(entry)}
            onSftpSelectPath={setSftpSelectedPath}
            onOpenSftpContextMenu={(x, y, entry) => openSftpContextMenuAt(x, y, entry)}
            onLocalPathInputChange={setLocalPathInput}
            onLocalOpenPath={() => void onLocalOpenPath()}
            onLocalGoParent={() => void onLocalGoParent()}
            onRefreshLocalDir={() => void loadLocalDir(localPath)}
            onLocalEnterDir={(entry) => void onLocalEnterDir(entry)}
            onLocalSelectPath={setLocalSelectedPath}
            onOpenLocalContextMenu={(x, y, entry) => openLocalContextMenuAt(x, y, entry)}
            onOpenCreateEditor={openCreateEditor}
            canCancelDownload={Boolean(
              sftpTransferProgress &&
                sftpTransferProgress.direction === 'download' &&
                sftpTransferProgress.status === 'running' &&
                activeSftpDownloadTransferIdRef.current
            )}
            onCancelDownload={() => void onCancelSftpDownload()}
          />
        </div>
        <div className={contentView === 'workspace' ? 'view-page workspace-page' : 'view-page workspace-page hidden'}>
          <WorkspaceView
            activeTab={activeTab}
            activeTabId={activeTabId}
            contentView={contentView}
            sessionTabs={sessionTabs}
            onDisconnectActiveTab={() => void onDisconnectActiveTab()}
            onRetryActiveTab={() => void retryActiveTab()}
          />
        </div>
      </>
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

      <ServerEditorModal
        isOpen={isEditorOpen}
        editorMode={editorMode}
        editor={editor}
        editorBusy={editorBusy}
        testState={testState}
        editorValidation={editorValidation}
        onClose={closeEditor}
        onTestConnection={() => void onTestConnection()}
        onSave={() => void onSaveEditor()}
        setEditor={setEditor}
      />
      <QuickConnectModal
        isOpen={isQuickConnectOpen}
        profiles={profiles}
        onClose={closeQuickConnect}
        onQuickConnectLocal={() => void onQuickConnectLocal()}
        onQuickConnectProfile={(profile) => void onQuickConnectProfile(profile)}
        onGoAddServer={() => {
          closeQuickConnect();
          openCreateEditor();
          setContentView('servers');
        }}
      />
      <LocalActionDialog
        dialog={localActionDialog}
        busy={localBusy}
        error={localActionError}
        onClose={closeLocalActionDialog}
        onChangeValue={updateLocalActionValue}
        onSubmit={() => void submitLocalActionDialog()}
      />
      <LocalContextMenu
        contentView={contentView}
        contextMenu={localContextMenu}
        menuRef={localContextMenuRef}
        hasLocalPath={Boolean(localPath)}
        canCopyToTarget={Boolean(connectedSftpProfile)}
        onClose={() => setLocalContextMenu(null)}
        onOpenDir={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            void onLocalEnterDir(entry);
          }
        }}
        onCopyToTarget={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            void onLocalCopyToTarget(entry);
          }
        }}
        onOpenRename={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            setLocalContextMenu(null);
            setLocalActionError(null);
            setLocalActionDialog({ kind: 'rename', entry, value: entry.name });
          }
        }}
        onOpenDelete={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            setLocalContextMenu(null);
            setLocalActionError(null);
            setLocalActionDialog({ kind: 'delete', entry });
          }
        }}
        onRefresh={() => void loadLocalDir(localPath)}
        onOpenCreateDir={() => {
          setLocalContextMenu(null);
          setLocalActionError(null);
          setLocalActionDialog({ kind: 'create_dir', parentPath: localPath, value: '' });
        }}
      />
      <SftpActionDialog
        dialog={sftpActionDialog}
        busy={sftpBusy}
        error={sftpActionError}
        formatPermissionMode={formatPermissionMode}
        onClose={closeSftpActionDialog}
        onChangeValue={updateSftpActionValue}
        onSubmit={() => void submitSftpActionDialog()}
      />
      <SftpContextMenu
        contentView={contentView}
        contextMenu={sftpContextMenu}
        menuRef={sftpContextMenuRef}
        hasConnectedProfile={Boolean(connectedSftpProfile)}
        currentPath={sftpPath}
        formatPermissionMode={formatPermissionMode}
        onClose={() => setSftpContextMenu(null)}
        onOpenDir={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            void onSftpEnterDir(entry);
          }
        }}
        onCopyToTarget={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            void onSftpCopyToTarget(entry);
          }
        }}
        onOpenRename={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            setSftpContextMenu(null);
            setSftpActionError(null);
            setSftpActionDialog({ kind: 'rename', entry, value: entry.name });
          }
        }}
        onOpenDelete={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            setSftpContextMenu(null);
            setSftpActionError(null);
            setSftpActionDialog({ kind: 'delete', entry });
          }
        }}
        onRefresh={() => {
          if (connectedSftpProfile) {
            void loadSftpDir(connectedSftpProfile, sftpPath);
          }
        }}
        onOpenCreateDir={(parentPath) => {
          setSftpContextMenu(null);
          setSftpActionError(null);
          setSftpActionDialog({ kind: 'create_dir', parentPath, value: '' });
        }}
        onOpenPermissions={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            setSftpContextMenu(null);
            setSftpActionError(null);
            setSftpActionDialog({
              kind: 'permissions',
              entry,
              value: defaultPermissionInput(entry.permissions, entry.is_dir)
            });
          }
        }}
      />
    </main>
  );
}
