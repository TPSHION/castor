import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { LocalUploadConflictDialogState } from '../types';
import type { ConnectionProfile, LocalFsEntry, SftpEntry } from '../../types';

type UseSystemDropUploadQueueOptions = {
  connectedSftpProfile: ConnectionProfile | null;
  sftpEntries: SftpEntry[];
  sftpPath: string;
  localUploadConflictDialog: LocalUploadConflictDialogState;
  setLocalMessage: (message: string) => void;
  setLocalUploadConflictRenameValue: Dispatch<SetStateAction<string>>;
  setLocalUploadConflictError: Dispatch<SetStateAction<string | null>>;
  setLocalUploadConflictDialog: Dispatch<SetStateAction<LocalUploadConflictDialogState>>;
  onClearLocalContextMenu: () => void;
  suggestRemoteName: (baseName: string) => string;
  localNameFromPath: (path: string) => string;
  uploadSystemPathToTarget: (localPathValue: string) => Promise<void>;
};

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function useSystemDropUploadQueue({
  connectedSftpProfile,
  sftpEntries,
  sftpPath,
  localUploadConflictDialog,
  setLocalMessage,
  setLocalUploadConflictRenameValue,
  setLocalUploadConflictError,
  setLocalUploadConflictDialog,
  onClearLocalContextMenu,
  suggestRemoteName,
  localNameFromPath,
  uploadSystemPathToTarget
}: UseSystemDropUploadQueueOptions) {
  const recentSystemDropRef = useRef<{ signature: string; at: number } | null>(null);
  const pendingSystemUploadQueueRef = useRef<LocalFsEntry[]>([]);
  const processingSystemUploadQueueRef = useRef(false);

  const connectedSftpProfileRef = useLatestRef(connectedSftpProfile);
  const sftpEntriesRef = useLatestRef(sftpEntries);
  const sftpPathRef = useLatestRef(sftpPath);
  const conflictDialogRef = useLatestRef(localUploadConflictDialog);
  const suggestRemoteNameRef = useLatestRef(suggestRemoteName);
  const localNameFromPathRef = useLatestRef(localNameFromPath);
  const uploadSystemPathToTargetRef = useLatestRef(uploadSystemPathToTarget);

  const processPendingSystemUploads = useCallback(async () => {
    if (processingSystemUploadQueueRef.current || conflictDialogRef.current) {
      return;
    }
    processingSystemUploadQueueRef.current = true;

    try {
      while (pendingSystemUploadQueueRef.current.length > 0) {
        const entry = pendingSystemUploadQueueRef.current.shift();
        if (!entry) {
          continue;
        }

        const conflict = sftpEntriesRef.current.find((item) => item.name === entry.name) ?? null;
        if (conflict) {
          onClearLocalContextMenu();
          setLocalUploadConflictRenameValue(suggestRemoteNameRef.current(entry.name));
          setLocalUploadConflictError(null);
          setLocalUploadConflictDialog({
            localEntry: entry,
            remoteEntry: conflict,
            remoteDir: sftpPathRef.current,
            source: 'system'
          });
          setLocalMessage('目标目录存在同名项，请选择上传策略。');
          return;
        }

        await uploadSystemPathToTargetRef.current(entry.path);
      }
    } finally {
      processingSystemUploadQueueRef.current = false;
    }
  }, [
    conflictDialogRef,
    onClearLocalContextMenu,
    setLocalMessage,
    setLocalUploadConflictDialog,
    setLocalUploadConflictError,
    setLocalUploadConflictRenameValue,
    sftpEntriesRef,
    sftpPathRef,
    suggestRemoteNameRef,
    uploadSystemPathToTargetRef
  ]);

  const enqueueSystemPaths = useCallback(
    (paths: string[]) => {
      if (!connectedSftpProfileRef.current) {
        setLocalMessage('请先连接服务器。');
        return;
      }

      const uniquePaths = Array.from(
        new Set(
          paths
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        )
      );
      if (uniquePaths.length === 0) {
        return;
      }

      const signature = uniquePaths.join('\n');
      const now = Date.now();
      if (recentSystemDropRef.current && recentSystemDropRef.current.signature === signature && now - recentSystemDropRef.current.at < 1200) {
        return;
      }
      recentSystemDropRef.current = { signature, at: now };

      const entries: LocalFsEntry[] = uniquePaths
        .map((path) => {
          const name = localNameFromPathRef.current(path);
          return {
            name,
            path,
            is_dir: false
          };
        })
        .filter((entry) => entry.name.length > 0);
      if (entries.length === 0) {
        return;
      }

      pendingSystemUploadQueueRef.current.push(...entries);
      setLocalMessage(`已接收 ${entries.length} 个系统拖拽项，正在上传到目标目录...`);
      void processPendingSystemUploads();
    },
    [connectedSftpProfileRef, localNameFromPathRef, processPendingSystemUploads, setLocalMessage]
  );

  const continueSystemQueue = useCallback(() => {
    void processPendingSystemUploads();
  }, [processPendingSystemUploads]);

  const resetSystemQueue = useCallback(() => {
    recentSystemDropRef.current = null;
    pendingSystemUploadQueueRef.current = [];
    processingSystemUploadQueueRef.current = false;
  }, []);

  return {
    enqueueSystemPaths,
    continueSystemQueue,
    resetSystemQueue
  };
}
