import { useCallback, useEffect, useState } from 'react';
import type {
  LocalCreateDirRequest,
  LocalDeleteRequest,
  LocalFsEntry,
  LocalListRequest,
  LocalRenameRequest
} from '../../types';
import { listLocalDir, localCreateDir, localDeleteEntry, localRenameEntry } from '../api/localfs';
import type { LocalActionDialogState, LocalContextMenuState } from '../types';
import { formatInvokeError } from '../helpers';

export function useLocalFilePane() {
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

  useEffect(() => {
    if (!localSelectedPath) {
      return;
    }
    if (localEntries.some((entry) => entry.path === localSelectedPath)) {
      return;
    }
    setLocalSelectedPath(null);
  }, [localEntries, localSelectedPath]);

  const closeLocalContextMenu = useCallback(() => setLocalContextMenu(null), []);

  const loadLocalDir = useCallback(
    async (
      targetPath?: string,
      options?: {
        silent?: boolean;
        background?: boolean;
      }
    ) => {
      const silent = options?.silent ?? false;
      const background = options?.background ?? false;
      const normalizedInput = targetPath?.trim();
      const request: LocalListRequest = normalizedInput ? { path: normalizedInput } : {};

      if (!background) {
        setLocalBusy(true);
      }
      if (!silent) {
        setLocalMessage('正在读取本地目录...');
      }

      try {
        const result = await listLocalDir(request);
        setLocalEntries(result.entries);
        setLocalPath(result.path);
        setLocalPathInput(result.path);
        setLocalParentPath(result.parent_path ?? null);
        setLocalSelectedPath(null);
        setLocalContextMenu(null);
        if (!silent) {
          setLocalMessage(`本地目录读取成功，共 ${result.entries.length} 项`);
        }
      } catch (invokeError) {
        setLocalMessage(formatInvokeError(invokeError));
      } finally {
        if (!background) {
          setLocalBusy(false);
        }
      }
    },
    []
  );

  const onLocalOpenPath = useCallback(async () => {
    await loadLocalDir(localPathInput);
  }, [loadLocalDir, localPathInput]);

  const onLocalGoParent = useCallback(async () => {
    if (!localParentPath) {
      return;
    }
    await loadLocalDir(localParentPath);
  }, [loadLocalDir, localParentPath]);

  const onLocalEnterDir = useCallback(
    async (entry: LocalFsEntry) => {
      if (!entry.is_dir) {
        return;
      }
      await loadLocalDir(entry.path);
    },
    [loadLocalDir]
  );

  const closeLocalActionDialog = useCallback(() => {
    if (localBusy) {
      return;
    }
    setLocalActionDialog(null);
    setLocalActionError(null);
  }, [localBusy]);

  const updateLocalActionValue = useCallback((value: string) => {
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
  }, []);

  const openLocalContextMenuAt = useCallback((x: number, y: number, entry: LocalFsEntry | null) => {
    setLocalContextMenu({ x, y, entry });
  }, []);

  const onLocalRenameEntry = useCallback(
    async (entry: LocalFsEntry, newName: string) => {
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
        await localRenameEntry(request);
        setLocalActionDialog(null);
        setLocalSelectedPath(null);
        setLocalBusy(false);
        await loadLocalDir(localPath);
        setLocalMessage(`已重命名为：${trimmedName}`);
      } catch (invokeError) {
        setLocalActionError(formatInvokeError(invokeError));
        setLocalBusy(false);
      }
    },
    [loadLocalDir, localPath]
  );

  const onLocalDeleteEntry = useCallback(
    async (entry: LocalFsEntry) => {
      const request: LocalDeleteRequest = {
        path: entry.path
      };

      setLocalBusy(true);
      setLocalActionError(null);
      setLocalMessage(`正在删除：${entry.path}`);

      try {
        await localDeleteEntry(request);
        setLocalActionDialog(null);
        setLocalSelectedPath(null);
        setLocalBusy(false);
        await loadLocalDir(localPath);
        setLocalMessage(`已删除：${entry.name}`);
      } catch (invokeError) {
        setLocalActionError(formatInvokeError(invokeError));
        setLocalBusy(false);
      }
    },
    [loadLocalDir, localPath]
  );

  const onLocalCreateDir = useCallback(
    async (parentPath: string, name: string) => {
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
        await localCreateDir(request);
        setLocalActionDialog(null);
        setLocalBusy(false);
        await loadLocalDir(localPath);
        setLocalMessage(`已创建文件夹：${trimmedName}`);
      } catch (invokeError) {
        setLocalActionError(formatInvokeError(invokeError));
        setLocalBusy(false);
      }
    },
    [loadLocalDir, localPath]
  );

  const submitLocalActionDialog = useCallback(async () => {
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
  }, [localActionDialog, onLocalCreateDir, onLocalDeleteEntry, onLocalRenameEntry]);

  return {
    localPath,
    localPathInput,
    setLocalPathInput,
    localParentPath,
    localEntries,
    localBusy,
    localMessage,
    setLocalMessage,
    localSelectedPath,
    setLocalSelectedPath,
    localContextMenu,
    setLocalContextMenu,
    closeLocalContextMenu,
    localActionDialog,
    setLocalActionDialog,
    localActionError,
    setLocalActionError,
    loadLocalDir,
    onLocalOpenPath,
    onLocalGoParent,
    onLocalEnterDir,
    closeLocalActionDialog,
    updateLocalActionValue,
    openLocalContextMenuAt,
    submitLocalActionDialog
  };
}
