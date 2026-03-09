import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AuthConfig,
  ConnectionProfile,
  SftpCreateDirRequest,
  SftpDeleteRequest,
  SftpEntry,
  SftpListRequest,
  SftpRenameRequest,
  SftpSetPermissionsRequest
} from '../../types';
import {
  sftpConnect,
  sftpCreateDir,
  sftpDeleteEntry,
  sftpDisconnect,
  sftpListDir,
  sftpRenameEntry,
  sftpSetPermissions
} from '../api/sftp';
import type { SftpActionDialogState, SftpContextMenuState } from '../types';
import { buildAuthFromProfile, formatInvokeError, normalizeRemotePath, parentRemotePath, parsePermissionInput } from '../helpers';

export function useSftpPane(profiles: ConnectionProfile[]) {
  const [selectedSftpProfileId, setSelectedSftpProfileId] = useState<string>('');
  const [connectedSftpProfileId, setConnectedSftpProfileId] = useState<string>('');
  const [sftpPath, setSftpPath] = useState<string>('/root');
  const [sftpPathInput, setSftpPathInput] = useState<string>('/root');
  const [sftpEntries, setSftpEntries] = useState<SftpEntry[]>([]);
  const [sftpBusy, setSftpBusy] = useState(false);
  const [sftpMessage, setSftpMessage] = useState<string | null>(null);
  const [sftpSelectedPath, setSftpSelectedPath] = useState<string | null>(null);
  const [sftpContextMenu, setSftpContextMenu] = useState<SftpContextMenuState | null>(null);
  const [sftpActionDialog, setSftpActionDialog] = useState<SftpActionDialogState>(null);
  const [sftpActionError, setSftpActionError] = useState<string | null>(null);

  const selectedSftpProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedSftpProfileId) ?? null,
    [profiles, selectedSftpProfileId]
  );
  const connectedSftpProfile = useMemo(
    () => profiles.find((profile) => profile.id === connectedSftpProfileId) ?? null,
    [profiles, connectedSftpProfileId]
  );

  useEffect(() => {
    if (!sftpSelectedPath) {
      return;
    }
    if (sftpEntries.some((entry) => entry.path === sftpSelectedPath)) {
      return;
    }
    setSftpSelectedPath(null);
  }, [sftpEntries, sftpSelectedPath]);

  const closeSftpContextMenu = useCallback(() => setSftpContextMenu(null), []);

  const buildSftpConnectionRequest = useCallback(
    (profile: ConnectionProfile): { host: string; port?: number; username: string; auth: AuthConfig } | null => {
      const auth = buildAuthFromProfile(profile);
      if (!auth) {
        setSftpMessage(`服务器 ${profile.name} 缺少可用凭据，请先编辑并保存。`);
        return null;
      }
      return {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        auth
      };
    },
    []
  );

  const loadSftpDir = useCallback(
    async (
      profile: ConnectionProfile,
      targetPath: string,
      options?: {
        silent?: boolean;
        background?: boolean;
      }
    ) => {
      const silent = options?.silent ?? false;
      const background = options?.background ?? false;
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

      if (!background) {
        setSftpBusy(true);
      }
      if (!silent) {
        setSftpMessage(`正在读取 ${profile.name} 的远程目录：${normalizedPath}`);
      }

      const requestStartedAt = performance.now();
      try {
        const entries = await sftpListDir(request);
        const requestElapsedMs = performance.now() - requestStartedAt;
        const uiRenderStartedAt = performance.now();
        setSftpEntries(entries);
        setSftpPath(normalizedPath);
        setSftpPathInput(normalizedPath);
        setConnectedSftpProfileId(profile.id);
        setSftpSelectedPath(null);
        setSftpContextMenu(null);
        if (!silent) {
          setSftpMessage(`目录读取成功，共 ${entries.length} 项（SFTP ${Math.round(requestElapsedMs)}ms / UI 计算中...）`);
        }
        requestAnimationFrame(() => {
          const uiElapsedMs = performance.now() - uiRenderStartedAt;
          console.info('[sftp] list_dir metrics', {
            profileId: profile.id,
            path: normalizedPath,
            entryCount: entries.length,
            requestMs: Math.round(requestElapsedMs),
            uiMs: Math.round(uiElapsedMs)
          });
          if (!silent) {
            setSftpMessage(
              `目录读取成功，共 ${entries.length} 项（SFTP ${Math.round(requestElapsedMs)}ms / UI ${Math.round(uiElapsedMs)}ms）`
            );
          }
        });
      } catch (invokeError) {
        setSftpMessage(formatInvokeError(invokeError));
      } finally {
        if (!background) {
          setSftpBusy(false);
        }
      }
    },
    []
  );

  const onSelectSftpProfile = useCallback(
    (profileId: string, options?: { onSwitchedConnectedProfile?: () => void }) => {
      setSelectedSftpProfileId(profileId);
      if (connectedSftpProfileId && connectedSftpProfileId !== profileId) {
        options?.onSwitchedConnectedProfile?.();
        setConnectedSftpProfileId('');
        setSftpEntries([]);
        setSftpPath('/root');
        setSftpPathInput('/root');
        setSftpMessage('已切换服务器，请点击“连接”加载远程目录。');
      }
    },
    [connectedSftpProfileId]
  );

  const onConnectSftpHost = useCallback(async () => {
    if (!selectedSftpProfile) {
      setSftpMessage('请先选择服务器。');
      return;
    }
    const request = buildSftpConnectionRequest(selectedSftpProfile);
    if (!request) {
      return;
    }
    setSftpBusy(true);
    setSftpMessage(`正在连接 ${selectedSftpProfile.name}...`);
    try {
      await sftpConnect(request);
    } catch (invokeError) {
      setSftpBusy(false);
      setSftpMessage(formatInvokeError(invokeError));
      return;
    }
    setSftpBusy(false);
    await loadSftpDir(selectedSftpProfile, '/root');
  }, [buildSftpConnectionRequest, loadSftpDir, selectedSftpProfile]);

  const disconnectSftpHostSession = useCallback(
    async (profile: ConnectionProfile) => {
      const request = buildSftpConnectionRequest(profile);
      if (!request) {
        return;
      }
      try {
        await sftpDisconnect(request);
      } catch {
        // Ignore disconnect errors and let UI state cleanup continue.
      }
    },
    [buildSftpConnectionRequest]
  );

  const onOpenSftpPath = useCallback(async () => {
    if (!connectedSftpProfile) {
      setSftpMessage('请先连接服务器。');
      return;
    }
    await loadSftpDir(connectedSftpProfile, sftpPathInput);
  }, [connectedSftpProfile, loadSftpDir, sftpPathInput]);

  const onSftpGoParent = useCallback(async () => {
    if (!connectedSftpProfile) {
      setSftpMessage('请先连接服务器。');
      return;
    }
    await loadSftpDir(connectedSftpProfile, parentRemotePath(sftpPath));
  }, [connectedSftpProfile, loadSftpDir, sftpPath]);

  const onSftpEnterDir = useCallback(
    async (entry: SftpEntry) => {
      if (!connectedSftpProfile || !entry.is_dir) {
        return;
      }
      await loadSftpDir(connectedSftpProfile, entry.path);
    },
    [connectedSftpProfile, loadSftpDir]
  );

  const getConnectedSftpContext = useCallback((): { profile: ConnectionProfile; auth: AuthConfig } | null => {
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
  }, [connectedSftpProfile]);

  const closeSftpActionDialog = useCallback(() => {
    if (sftpBusy) {
      return;
    }
    setSftpActionDialog(null);
    setSftpActionError(null);
  }, [sftpBusy]);

  const updateSftpActionValue = useCallback((value: string) => {
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
  }, []);

  const openSftpContextMenuAt = useCallback((x: number, y: number, entry: SftpEntry | null) => {
    setSftpContextMenu({ x, y, entry });
  }, []);

  const onSftpRenameEntry = useCallback(
    async (entry: SftpEntry, newName: string) => {
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
        await sftpRenameEntry(request);
        setSftpActionDialog(null);
        setSftpSelectedPath(null);
        setSftpBusy(false);
        await loadSftpDir(context.profile, sftpPath);
        setSftpMessage(`已重命名为：${trimmedName}`);
      } catch (invokeError) {
        setSftpActionError(formatInvokeError(invokeError));
        setSftpBusy(false);
      }
    },
    [getConnectedSftpContext, loadSftpDir, sftpPath]
  );

  const onSftpDeleteEntry = useCallback(
    async (entry: SftpEntry) => {
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
        await sftpDeleteEntry(request);
        setSftpActionDialog(null);
        setSftpSelectedPath(null);
        setSftpBusy(false);
        await loadSftpDir(context.profile, sftpPath);
        setSftpMessage(`已删除：${entry.name}`);
      } catch (invokeError) {
        setSftpActionError(formatInvokeError(invokeError));
        setSftpBusy(false);
      }
    },
    [getConnectedSftpContext, loadSftpDir, sftpPath]
  );

  const onSftpCreateDir = useCallback(
    async (parentPath: string, name: string) => {
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
        await sftpCreateDir(request);
        setSftpActionDialog(null);
        setSftpBusy(false);
        await loadSftpDir(context.profile, sftpPath);
        setSftpMessage(`已创建文件夹：${trimmedName}`);
      } catch (invokeError) {
        setSftpActionError(formatInvokeError(invokeError));
        setSftpBusy(false);
      }
    },
    [getConnectedSftpContext, loadSftpDir, sftpPath]
  );

  const onSftpSetPermissions = useCallback(
    async (entry: SftpEntry, value: string) => {
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
        await sftpSetPermissions(request);
        setSftpActionDialog(null);
        setSftpBusy(false);
        await loadSftpDir(context.profile, sftpPath);
        setSftpMessage(`权限已更新为 ${value.trim()}`);
      } catch (invokeError) {
        setSftpActionError(formatInvokeError(invokeError));
        setSftpBusy(false);
      }
    },
    [getConnectedSftpContext, loadSftpDir, sftpPath]
  );

  const submitSftpActionDialog = useCallback(async () => {
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
  }, [onSftpCreateDir, onSftpDeleteEntry, onSftpRenameEntry, onSftpSetPermissions, sftpActionDialog]);

  return {
    selectedSftpProfileId,
    setSelectedSftpProfileId,
    connectedSftpProfileId,
    setConnectedSftpProfileId,
    selectedSftpProfile,
    connectedSftpProfile,
    sftpPath,
    setSftpPath,
    sftpPathInput,
    setSftpPathInput,
    sftpEntries,
    setSftpEntries,
    sftpBusy,
    sftpMessage,
    setSftpMessage,
    sftpSelectedPath,
    setSftpSelectedPath,
    sftpContextMenu,
    setSftpContextMenu,
    closeSftpContextMenu,
    sftpActionDialog,
    setSftpActionDialog,
    sftpActionError,
    setSftpActionError,
    loadSftpDir,
    onSelectSftpProfile,
    onConnectSftpHost,
    disconnectSftpHostSession,
    onOpenSftpPath,
    onSftpGoParent,
    onSftpEnterDir,
    closeSftpActionDialog,
    updateSftpActionValue,
    openSftpContextMenuAt,
    submitSftpActionDialog
  };
}
