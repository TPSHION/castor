import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  AuthConfig,
  ConnectionProfile,
  LocalFsEntry,
  SftpDownloadRequest,
  SftpDownloadResult,
  SftpEntry,
  SftpTransferProgressPayload,
  SftpUploadConflictStrategy,
  SftpUploadRequest,
  SftpUploadResult
} from '../../types';
import type { LocalUploadConflictDialogState } from '../types';
import { buildAuthFromProfile, formatBytes, formatInvokeError } from '../helpers';
import { useSystemDropUploadQueue } from './useSystemDropUploadQueue';

type TransferProgressManager = {
  markStarted: (transferId: string) => void;
  applyProgress: (payload: SftpTransferProgressPayload) => void;
  reset: () => void;
};

type UseTransferOrchestratorOptions = {
  connectedSftpProfile: ConnectionProfile | null;
  sftpEntries: SftpEntry[];
  sftpPath: string;
  loadSftpDir: (
    profile: ConnectionProfile,
    targetPath: string,
    options?: { silent?: boolean; background?: boolean }
  ) => Promise<void>;
  localPath: string;
  loadLocalDir: (
    targetPath?: string,
    options?: { silent?: boolean; background?: boolean }
  ) => Promise<void>;
  localBusy: boolean;
  closeLocalContextMenu: () => void;
  closeSftpContextMenu: () => void;
  setLocalMessage: Dispatch<SetStateAction<string | null>>;
  setLocalSelectedPath: Dispatch<SetStateAction<string | null>>;
  setSftpMessage: Dispatch<SetStateAction<string | null>>;
  setSftpSelectedPath: Dispatch<SetStateAction<string | null>>;
  localTransferManager: TransferProgressManager;
  sftpTransferManager: TransferProgressManager;
};

function createTransferId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localNameFromPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }
  const normalized = trimmed.replace(/[\\/]+$/, '');
  if (!normalized) {
    return trimmed;
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function useTransferOrchestrator({
  connectedSftpProfile,
  sftpEntries,
  sftpPath,
  loadSftpDir,
  localPath,
  loadLocalDir,
  localBusy,
  closeLocalContextMenu,
  closeSftpContextMenu,
  setLocalMessage,
  setLocalSelectedPath,
  setSftpMessage,
  setSftpSelectedPath,
  localTransferManager,
  sftpTransferManager
}: UseTransferOrchestratorOptions) {
  const [localUploadConflictDialog, setLocalUploadConflictDialog] = useState<LocalUploadConflictDialogState>(null);
  const [localUploadConflictRenameValue, setLocalUploadConflictRenameValue] = useState('');
  const [localUploadConflictError, setLocalUploadConflictError] = useState<string | null>(null);

  const clearLocalUploadConflictState = useCallback(() => {
    setLocalUploadConflictDialog(null);
    setLocalUploadConflictRenameValue('');
    setLocalUploadConflictError(null);
  }, []);

  const suggestRemoteName = useCallback(
    (baseName: string) => {
      const nameExists = (value: string) => sftpEntries.some((entry) => entry.name === value);
      if (!nameExists(baseName)) {
        return baseName;
      }

      const dotIndex = baseName.lastIndexOf('.');
      const hasExtension = dotIndex > 0;
      const stem = hasExtension ? baseName.slice(0, dotIndex) : baseName;
      const ext = hasExtension ? baseName.slice(dotIndex) : '';

      let index = 1;
      while (true) {
        const nextName = `${stem}-${index}${ext}`;
        if (!nameExists(nextName)) {
          return nextName;
        }
        index += 1;
      }
    },
    [sftpEntries]
  );

  const uploadSystemPathToTarget = useCallback(
    async (localPathValue: string) => {
      if (!connectedSftpProfile) {
        setLocalMessage('请先连接服务器。');
        return;
      }

      const auth = buildAuthFromProfile(connectedSftpProfile);
      if (!auth) {
        setLocalMessage(`服务器 ${connectedSftpProfile.name} 缺少可用凭据，请先编辑并保存。`);
        return;
      }

      const sourcePath = localPathValue.trim();
      if (!sourcePath) {
        return;
      }

      const transferId = createTransferId();
      localTransferManager.markStarted(transferId);
      localTransferManager.applyProgress({
        transfer_id: transferId,
        direction: 'upload',
        status: 'running',
        path: sourcePath,
        target_path: sftpPath,
        transferred_bytes: 0,
        total_bytes: 0,
        percent: 0
      });
      setLocalMessage(`正在上传到目标目录：${sourcePath}`);

      const remoteName = localNameFromPath(sourcePath);
      const request: SftpUploadRequest = {
        host: connectedSftpProfile.host,
        port: connectedSftpProfile.port,
        username: connectedSftpProfile.username,
        auth,
        local_path: sourcePath,
        remote_dir: sftpPath,
        remote_name: remoteName || undefined,
        conflict_strategy: 'auto_rename',
        transfer_id: transferId
      };

      try {
        const result = await invoke<SftpUploadResult>('sftp_upload_path', { request });
        setLocalMessage(`已上传到目标目录：${result.remote_path}（${formatBytes(result.bytes)}）`);
        await loadSftpDir(connectedSftpProfile, sftpPath, {
          silent: true,
          background: true
        });
      } catch (invokeError) {
        const message = formatInvokeError(invokeError);
        setLocalMessage(message);
        if (!message.includes('已取消')) {
          localTransferManager.applyProgress({
            transfer_id: transferId,
            direction: 'upload',
            status: 'error',
            path: sourcePath,
            target_path: sftpPath,
            transferred_bytes: 0,
            total_bytes: 0,
            percent: 0
          });
        }
      }
    },
    [connectedSftpProfile, loadSftpDir, localTransferManager, setLocalMessage, sftpPath]
  );

  const systemDropUploadQueue = useSystemDropUploadQueue({
    connectedSftpProfile,
    sftpEntries,
    sftpPath,
    localUploadConflictDialog,
    setLocalMessage,
    setLocalUploadConflictRenameValue,
    setLocalUploadConflictError,
    setLocalUploadConflictDialog,
    onClearLocalContextMenu: closeLocalContextMenu,
    suggestRemoteName,
    localNameFromPath,
    uploadSystemPathToTarget
  });

  const uploadLocalToTarget = useCallback(
    async (
      entry: LocalFsEntry,
      strategy: SftpUploadConflictStrategy = 'auto_rename',
      remoteName?: string
    ) => {
      if (!connectedSftpProfile) {
        setLocalMessage('请先连接服务器。');
        return;
      }

      const auth = buildAuthFromProfile(connectedSftpProfile);
      if (!auth) {
        setLocalMessage(`服务器 ${connectedSftpProfile.name} 缺少可用凭据，请先编辑并保存。`);
        return;
      }

      closeLocalContextMenu();
      setLocalUploadConflictDialog(null);
      setLocalSelectedPath(entry.path);
      const transferId = createTransferId();
      localTransferManager.markStarted(transferId);
      localTransferManager.applyProgress({
        transfer_id: transferId,
        direction: 'upload',
        status: 'running',
        path: entry.path,
        target_path: sftpPath,
        transferred_bytes: 0,
        total_bytes: 0,
        percent: 0
      });
      setLocalMessage(`正在上传到目标目录：${entry.path}`);

      const request: SftpUploadRequest = {
        host: connectedSftpProfile.host,
        port: connectedSftpProfile.port,
        username: connectedSftpProfile.username,
        auth,
        local_path: entry.path,
        remote_dir: sftpPath,
        remote_name: remoteName?.trim() || undefined,
        conflict_strategy: strategy,
        transfer_id: transferId
      };

      try {
        const result = await invoke<SftpUploadResult>('sftp_upload_path', { request });
        setLocalMessage(`已上传到目标目录：${result.remote_path}（${formatBytes(result.bytes)}）`);
        await loadSftpDir(connectedSftpProfile, sftpPath, {
          silent: true,
          background: true
        });
      } catch (invokeError) {
        const message = formatInvokeError(invokeError);
        setLocalMessage(message);
        if (!message.includes('已取消')) {
          localTransferManager.applyProgress({
            transfer_id: transferId,
            direction: 'upload',
            status: 'error',
            path: entry.path,
            target_path: sftpPath,
            transferred_bytes: 0,
            total_bytes: 0,
            percent: 0
          });
        }
      }
    },
    [
      closeLocalContextMenu,
      connectedSftpProfile,
      loadSftpDir,
      localTransferManager,
      setLocalMessage,
      setLocalSelectedPath,
      sftpPath
    ]
  );

  const onUploadSystemPathsToRemote = useCallback(
    (paths: string[]) => {
      systemDropUploadQueue.enqueueSystemPaths(paths);
    },
    [systemDropUploadQueue]
  );

  const closeLocalUploadConflictDialog = useCallback(() => {
    if (localBusy) {
      return;
    }
    const fromSystemQueue = localUploadConflictDialog?.source === 'system';
    clearLocalUploadConflictState();
    if (fromSystemQueue) {
      systemDropUploadQueue.continueSystemQueue();
    }
  }, [clearLocalUploadConflictState, localBusy, localUploadConflictDialog, systemDropUploadQueue]);

  const onLocalCopyToTarget = useCallback(
    async (entry: LocalFsEntry) => {
      if (!connectedSftpProfile) {
        setLocalMessage('请先连接服务器。');
        return;
      }

      const conflict = sftpEntries.find((item) => item.name === entry.name) ?? null;
      if (conflict) {
        closeLocalContextMenu();
        setLocalUploadConflictRenameValue(suggestRemoteName(entry.name));
        setLocalUploadConflictError(null);
        setLocalUploadConflictDialog({
          localEntry: entry,
          remoteEntry: conflict,
          remoteDir: sftpPath,
          source: 'local'
        });
        setLocalMessage('目标目录存在同名项，请选择上传策略。');
        return;
      }

      await uploadLocalToTarget(entry, 'auto_rename');
    },
    [closeLocalContextMenu, connectedSftpProfile, setLocalMessage, sftpEntries, sftpPath, suggestRemoteName, uploadLocalToTarget]
  );

  const onSubmitLocalUploadConflict = useCallback(
    async (strategy: SftpUploadConflictStrategy) => {
      if (!localUploadConflictDialog) {
        return;
      }
      const dialog = localUploadConflictDialog;
      setLocalUploadConflictError(null);
      await uploadLocalToTarget(dialog.localEntry, strategy);
      if (dialog.source === 'system') {
        systemDropUploadQueue.continueSystemQueue();
      }
    },
    [localUploadConflictDialog, systemDropUploadQueue, uploadLocalToTarget]
  );

  const onSubmitLocalUploadManualRename = useCallback(async () => {
    if (!localUploadConflictDialog) {
      return;
    }
    const dialog = localUploadConflictDialog;

    const nextName = localUploadConflictRenameValue.trim();
    if (!nextName) {
      setLocalUploadConflictError('请输入新的文件名');
      return;
    }
    if (nextName === '.' || nextName === '..' || nextName.includes('/')) {
      setLocalUploadConflictError('名称不能为 "."、".."，且不能包含 "/"');
      return;
    }
    if (sftpEntries.some((entry) => entry.name === nextName)) {
      setLocalUploadConflictError('该名称已存在，请更换，或使用“覆盖上传”');
      return;
    }

    setLocalUploadConflictError(null);
    await uploadLocalToTarget(dialog.localEntry, 'auto_rename', nextName);
    if (dialog.source === 'system') {
      systemDropUploadQueue.continueSystemQueue();
    }
  }, [localUploadConflictDialog, localUploadConflictRenameValue, sftpEntries, systemDropUploadQueue, uploadLocalToTarget]);

  const onSftpDownload = useCallback(
    async (entry: SftpEntry) => {
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

      const transferId = createTransferId();
      request.transfer_id = transferId;
      sftpTransferManager.markStarted(transferId);
      sftpTransferManager.applyProgress({
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
          sftpTransferManager.applyProgress({
            transfer_id: transferId,
            direction: 'download',
            status: 'error',
            path: entry.path,
            target_path: localPath || '',
            transferred_bytes: 0,
            total_bytes: 0,
            percent: 0
          });
        }
      }
    },
    [connectedSftpProfile, localPath, setSftpMessage, sftpTransferManager]
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
  }, [connectedSftpProfile, setSftpMessage]);

  const onSftpCopyToTarget = useCallback(
    async (entry: SftpEntry) => {
      const context = getConnectedSftpContext();
      if (!context) {
        return;
      }

      closeSftpContextMenu();
      setSftpSelectedPath(entry.path);
      const transferId = createTransferId();
      sftpTransferManager.markStarted(transferId);
      sftpTransferManager.applyProgress({
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
          void loadLocalDir(localPath, {
            silent: true,
            background: true
          });
        }
      } catch (invokeError) {
        const message = formatInvokeError(invokeError);
        setSftpMessage(message);
        if (!message.includes('已取消')) {
          sftpTransferManager.applyProgress({
            transfer_id: transferId,
            direction: 'download',
            status: 'error',
            path: entry.path,
            target_path: localPath || '',
            transferred_bytes: 0,
            total_bytes: 0,
            percent: 0
          });
        }
      }
    },
    [closeSftpContextMenu, getConnectedSftpContext, loadLocalDir, localPath, setSftpMessage, setSftpSelectedPath, sftpTransferManager]
  );

  const onCancelSftpDownload = useCallback(
    async (transferId: string) => {
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
    },
    [setSftpMessage]
  );

  const onCancelLocalUpload = useCallback(
    async (transferId: string) => {
      setLocalMessage('正在取消上传...');
      try {
        await invoke('cancel_sftp_transfer', {
          request: {
            transfer_id: transferId
          }
        });
      } catch (invokeError) {
        const message = formatInvokeError(invokeError);
        if (!message.includes('不存在') && !message.includes('已结束')) {
          setLocalMessage(message);
        }
      }
    },
    [setLocalMessage]
  );

  const resetSystemDropQueue = useCallback(() => {
    systemDropUploadQueue.resetSystemQueue();
  }, [systemDropUploadQueue]);

  const resetTransferOrchestratorState = useCallback(() => {
    clearLocalUploadConflictState();
    systemDropUploadQueue.resetSystemQueue();
    localTransferManager.reset();
    sftpTransferManager.reset();
  }, [clearLocalUploadConflictState, localTransferManager.reset, sftpTransferManager.reset, systemDropUploadQueue]);

  useEffect(() => {
    let mounted = true;

    const unsubscribePromise = listen<SftpTransferProgressPayload>('sftp-transfer-progress', (event) => {
      if (!mounted) {
        return;
      }

      if (event.payload.direction === 'upload') {
        localTransferManager.applyProgress(event.payload);
        return;
      }

      sftpTransferManager.applyProgress(event.payload);
    });

    return () => {
      mounted = false;
      void unsubscribePromise.then((unlisten) => unlisten());
    };
  }, [localTransferManager.applyProgress, sftpTransferManager.applyProgress]);

  return {
    localUploadConflictDialog,
    localUploadConflictRenameValue,
    setLocalUploadConflictRenameValue,
    localUploadConflictError,
    setLocalUploadConflictError,
    clearLocalUploadConflictState,
    closeLocalUploadConflictDialog,
    onUploadSystemPathsToRemote,
    onLocalCopyToTarget,
    onSubmitLocalUploadConflict,
    onSubmitLocalUploadManualRename,
    onSftpDownload,
    onSftpCopyToTarget,
    onCancelSftpDownload,
    onCancelLocalUpload,
    resetSystemDropQueue,
    resetTransferOrchestratorState
  };
}
