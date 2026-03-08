import { useEffect, useMemo, useRef, useState } from 'react';
import { listen, TauriEvent } from '@tauri-apps/api/event';
import type { ConnectionProfile, LocalFsEntry, SftpEntry, SftpTransferProgressPayload } from '../types';
import { TransferTasksPanelModal } from './TransferTasksPanelModal';

type SftpViewProps = {
  isActive: boolean;
  profiles: ConnectionProfile[];
  selectedSftpProfileId: string;
  selectedSftpProfile: ConnectionProfile | null;
  connectedSftpProfile: ConnectionProfile | null;
  sftpBusy: boolean;
  sftpMessage: string | null;
  sftpPath: string;
  sftpPathInput: string;
  sftpEntries: SftpEntry[];
  sftpSelectedPath: string | null;
  localPath: string;
  localPathInput: string;
  localParentPath: string | null;
  localEntries: LocalFsEntry[];
  localBusy: boolean;
  localMessage: string | null;
  localSelectedPath: string | null;
  localTransferProgresses: SftpTransferProgressPayload[];
  localCompletedTransferProgresses: SftpTransferProgressPayload[];
  sftpTransferProgresses: SftpTransferProgressPayload[];
  sftpCompletedTransferProgresses: SftpTransferProgressPayload[];
  formatBytes: (value?: number) => string;
  formatUnixTime: (value?: number) => string;
  onSelectSftpProfile: (profileId: string) => void;
  onConnectSftpHost: () => void;
  onRefreshConnectedSftpHost: () => void;
  onDisconnectSftpHost: () => void;
  onSftpPathInputChange: (value: string) => void;
  onOpenSftpPath: () => void;
  onSftpGoParent: () => void;
  onSftpEnterDir: (entry: SftpEntry) => void;
  onSftpDownload: (entry: SftpEntry) => void;
  onSftpSelectPath: (path: string) => void;
  onOpenSftpContextMenu: (x: number, y: number, entry: SftpEntry | null) => void;
  onLocalPathInputChange: (value: string) => void;
  onLocalOpenPath: () => void;
  onLocalGoParent: () => void;
  onRefreshLocalDir: () => void;
  onLocalEnterDir: (entry: LocalFsEntry) => void;
  onLocalSelectPath: (path: string) => void;
  onOpenLocalContextMenu: (x: number, y: number, entry: LocalFsEntry | null) => void;
  onOpenCreateEditor: () => void;
  onCancelUpload: (transferId: string) => void;
  onCancelDownload: (transferId: string) => void;
  onClearLocalCompletedTransfers: () => void;
  onClearSftpCompletedTransfers: () => void;
  onUploadLocalEntryToRemote: (entry: LocalFsEntry) => void;
  onDownloadRemoteEntryToLocal: (entry: SftpEntry) => void;
  onUploadSystemPathsToRemote: (paths: string[]) => void;
};

export function SftpView({
  isActive,
  profiles,
  selectedSftpProfileId,
  selectedSftpProfile,
  connectedSftpProfile,
  sftpBusy,
  sftpMessage,
  sftpPath,
  sftpPathInput,
  sftpEntries,
  sftpSelectedPath,
  localPath,
  localPathInput,
  localParentPath,
  localEntries,
  localBusy,
  localMessage,
  localSelectedPath,
  localTransferProgresses,
  localCompletedTransferProgresses,
  sftpTransferProgresses,
  sftpCompletedTransferProgresses,
  formatBytes,
  formatUnixTime,
  onSelectSftpProfile,
  onConnectSftpHost,
  onRefreshConnectedSftpHost,
  onDisconnectSftpHost,
  onSftpPathInputChange,
  onOpenSftpPath,
  onSftpGoParent,
  onSftpEnterDir,
  onSftpDownload,
  onSftpSelectPath,
  onOpenSftpContextMenu,
  onLocalPathInputChange,
  onLocalOpenPath,
  onLocalGoParent,
  onRefreshLocalDir,
  onLocalEnterDir,
  onLocalSelectPath,
  onOpenLocalContextMenu,
  onOpenCreateEditor,
  onCancelUpload,
  onCancelDownload,
  onClearLocalCompletedTransfers,
  onClearSftpCompletedTransfers,
  onUploadLocalEntryToRemote,
  onDownloadRemoteEntryToLocal,
  onUploadSystemPathsToRemote
}: SftpViewProps) {
  const [isLocalTasksPanelOpen, setLocalTasksPanelOpen] = useState(false);
  const [isSftpTasksPanelOpen, setSftpTasksPanelOpen] = useState(false);
  const [isLocalDropActive, setLocalDropActive] = useState(false);
  const [isRemoteDropActive, setRemoteDropActive] = useState(false);
  const [isSystemRemoteDropActive, setSystemRemoteDropActive] = useState(false);
  const systemRemoteDropActiveRef = useRef(false);
  const uploadSystemPathsToRemoteRef = useRef(onUploadSystemPathsToRemote);
  const [isDragInteractionActive, setDragInteractionActive] = useState(false);
  const [dragPayload, setDragPayload] = useState<{ source: 'local' | 'remote'; path: string; name: string } | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{
    source: 'local' | 'remote';
    path: string;
    name: string;
    startX: number;
    startY: number;
  } | null>(null);
  const localDropZoneRef = useRef<HTMLDivElement>(null);
  const remoteDropZoneRef = useRef<HTMLDivElement>(null);

  const isPointInElement = (element: HTMLDivElement | null, x: number, y: number) => {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  const setSystemRemoteDropState = (active: boolean) => {
    systemRemoteDropActiveRef.current = active;
    setSystemRemoteDropActive(active);
  };

  const isPointInRemoteDropZone = (x: number, y: number) => {
    const scale = window.devicePixelRatio || 1;
    return (
      isPointInElement(remoteDropZoneRef.current, x, y) ||
      isPointInElement(remoteDropZoneRef.current, x / scale, y / scale) ||
      isPointInElement(remoteDropZoneRef.current, x * scale, y * scale)
    );
  };

  const uploadSystemPaths = (paths: string[]) => {
    const validPaths = Array.from(
      new Set(
        paths
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );
    if (validPaths.length === 0) {
      return;
    }
    uploadSystemPathsToRemoteRef.current(validPaths);
  };

  const hasDraggedFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

  const extractDroppedPaths = (event: React.DragEvent): string[] => {
    const files = Array.from(event.dataTransfer.files ?? []);
    return files
      .map((file) => (file as File & { path?: string }).path ?? '')
      .filter((value) => value.length > 0);
  };

  const updateDropState = (source: 'local' | 'remote', x: number, y: number) => {
    if (source === 'local') {
      setLocalDropActive(false);
      setRemoteDropActive(isPointInElement(remoteDropZoneRef.current, x, y));
      return;
    }
    setRemoteDropActive(false);
    setLocalDropActive(isPointInElement(localDropZoneRef.current, x, y));
  };

  const clearDragState = () => {
    dragStartRef.current = null;
    setDragInteractionActive(false);
    setDragPayload(null);
    setDragPointer(null);
    setLocalDropActive(false);
    setRemoteDropActive(false);
  };

  const startDragCandidate = (
    event: React.MouseEvent,
    payload: { source: 'local' | 'remote'; path: string; name: string }
  ) => {
    if (event.button !== 0) {
      return;
    }
    dragStartRef.current = {
      ...payload,
      startX: event.clientX,
      startY: event.clientY
    };
    setDragInteractionActive(true);
  };

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragPayload) {
        const candidate = dragStartRef.current;
        if (!candidate) {
          return;
        }
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 6) {
          return;
        }
        const nextPayload = {
          source: candidate.source,
          path: candidate.path,
          name: candidate.name
        };
        setDragPayload(nextPayload);
        setDragPointer({ x: event.clientX, y: event.clientY });
        updateDropState(nextPayload.source, event.clientX, event.clientY);
        return;
      }

      setDragPointer({ x: event.clientX, y: event.clientY });
      updateDropState(dragPayload.source, event.clientX, event.clientY);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!dragPayload) {
        dragStartRef.current = null;
        setDragInteractionActive(false);
        return;
      }

      if (
        dragPayload.source === 'local' &&
        isPointInElement(remoteDropZoneRef.current, event.clientX, event.clientY)
      ) {
        const entry = localEntries.find((item) => item.path === dragPayload.path);
        if (entry) {
          onUploadLocalEntryToRemote(entry);
        }
      } else if (
        dragPayload.source === 'remote' &&
        isPointInElement(localDropZoneRef.current, event.clientX, event.clientY)
      ) {
        const entry = sftpEntries.find((item) => item.path === dragPayload.path);
        if (entry) {
          onDownloadRemoteEntryToLocal(entry);
        }
      }

      clearDragState();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragPayload, localEntries, onDownloadRemoteEntryToLocal, onUploadLocalEntryToRemote, sftpEntries]);

  useEffect(() => {
    uploadSystemPathsToRemoteRef.current = onUploadSystemPathsToRemote;
  }, [onUploadSystemPathsToRemote]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const bindDragDrop = async () => {
      const unlistenEnter = await listen<{ position?: { x: number; y: number } }>(TauriEvent.DRAG_ENTER, (event) => {
        if (!isActive || !connectedSftpProfile) {
          setSystemRemoteDropState(false);
          return;
        }
        const position = event.payload?.position;
        if (!position) {
          return;
        }
        setSystemRemoteDropState(isPointInRemoteDropZone(position.x, position.y));
      });
      const unlistenOver = await listen<{ position?: { x: number; y: number } }>(TauriEvent.DRAG_OVER, (event) => {
        if (!isActive || !connectedSftpProfile) {
          setSystemRemoteDropState(false);
          return;
        }
        const position = event.payload?.position;
        if (!position) {
          return;
        }
        setSystemRemoteDropState(isPointInRemoteDropZone(position.x, position.y));
      });
      const unlistenLeave = await listen(TauriEvent.DRAG_LEAVE, () => {
        setSystemRemoteDropState(false);
      });
      const unlistenDrop = await listen<{ position?: { x: number; y: number }; paths?: string[] }>(
        TauriEvent.DRAG_DROP,
        (event) => {
          if (!isActive || !connectedSftpProfile) {
            setSystemRemoteDropState(false);
            return;
          }
          const paths = Array.isArray(event.payload?.paths) ? event.payload.paths : [];
          const position = event.payload?.position;
          const isOverRemote = position
            ? isPointInRemoteDropZone(position.x, position.y)
            : systemRemoteDropActiveRef.current;
          setSystemRemoteDropState(false);
          if (isOverRemote) {
            uploadSystemPaths(paths);
          }
        }
      );

      if (disposed) {
        unlistenEnter();
        unlistenOver();
        unlistenLeave();
        unlistenDrop();
        return;
      }

      unlisteners.push(unlistenEnter, unlistenOver, unlistenLeave, unlistenDrop);
    };

    void bindDragDrop();

    return () => {
      disposed = true;
      setSystemRemoteDropState(false);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [connectedSftpProfile, isActive]);

  useEffect(() => {
    if (!isDragInteractionActive) {
      document.body.classList.remove('sftp-transfer-dragging');
      return;
    }
    document.body.classList.add('sftp-transfer-dragging');
    return () => {
      document.body.classList.remove('sftp-transfer-dragging');
    };
  }, [isDragInteractionActive]);

  const formatEta = (value?: number | null) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '计算中...';
    }
    if (value <= 0) {
      return '00:00';
    }
    const total = Math.floor(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const renderProgress = (payload: SftpTransferProgressPayload, kind: 'upload' | 'download') => {
    const title =
      payload.status === 'done'
        ? kind === 'upload'
          ? '上传完成'
          : '下载完成'
        : payload.status === 'error'
          ? kind === 'upload'
            ? '上传失败'
            : '下载失败'
          : payload.status === 'canceled'
            ? kind === 'upload'
              ? '上传已取消'
              : '下载已取消'
            : kind === 'upload'
              ? '上传中'
              : '下载中';
    return (
      <div className={payload.status === 'error' ? 'transfer-progress error' : 'transfer-progress'}>
        <p className="transfer-progress-path" title={payload.path}>
          {payload.path}
        </p>
        <div className="transfer-progress-meta">
          <span>
            {title} {payload.percent}%
          </span>
          <span>
            {formatBytes(payload.transferred_bytes)} / {formatBytes(payload.total_bytes)}
          </span>
        </div>
        <div className="transfer-progress-track">
          <div className="transfer-progress-bar" style={{ width: `${payload.percent}%` }} />
        </div>
        {kind === 'upload' && payload.status === 'running' && (
          <div className="transfer-progress-actions">
            <button
              type="button"
              className="transfer-progress-cancel"
              onClick={() => onCancelUpload(payload.transfer_id)}
            >
              取消上传
            </button>
          </div>
        )}
        {kind === 'download' && payload.status === 'running' && (
          <div className="transfer-progress-actions">
            <button
              type="button"
              className="transfer-progress-cancel"
              onClick={() => onCancelDownload(payload.transfer_id)}
            >
              取消下载
            </button>
          </div>
        )}
        {payload.status === 'running' && (
          <p className="transfer-progress-eta">
            预计剩余：{formatEta(payload.eta_seconds)}
            {payload.speed_bps ? ` · ${formatBytes(payload.speed_bps)}/s` : ''}
          </p>
        )}
      </div>
    );
  };

  const localRunningTasks = useMemo(
    () => localTransferProgresses.filter((task) => task.status === 'running'),
    [localTransferProgresses]
  );
  const sftpRunningTasks = useMemo(
    () => sftpTransferProgresses.filter((task) => task.status === 'running'),
    [sftpTransferProgresses]
  );
  const localPrimaryTask = localRunningTasks[0] ?? null;
  const sftpPrimaryTask = sftpRunningTasks[0] ?? null;
  const localPanelButtonVisible = localRunningTasks.length > 1 || localCompletedTransferProgresses.length > 0;
  const sftpPanelButtonVisible = sftpRunningTasks.length > 1 || sftpCompletedTransferProgresses.length > 0;

  return (
    <div className="sftp-dual-page">
      <section className="sftp-pane">
        <div className="sftp-pane-header">
          <h2>Local</h2>
          <div className="section-actions">
            <button type="button" onClick={onRefreshLocalDir} disabled={localBusy}>
              刷新
            </button>
          </div>
        </div>

        {localMessage && <p className="status-line">{localMessage}</p>}
        {localPrimaryTask && renderProgress(localPrimaryTask, 'upload')}
        {localPanelButtonVisible && (
          <div className="transfer-progress-panel-action">
            <button type="button" onClick={() => setLocalTasksPanelOpen(true)}>
              查看任务面板（进行中 {localRunningTasks.length} · 已完成 {localCompletedTransferProgresses.length}）
            </button>
          </div>
        )}

        <div className="sftp-remote-body">
          <div className="sftp-path-bar sftp-path-bar-remote">
            <button type="button" onClick={onLocalGoParent} disabled={!localParentPath || localBusy}>
              上级
            </button>
            <input
              value={localPathInput}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => onLocalPathInputChange(event.target.value)}
              placeholder="本地路径"
              disabled={localBusy}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onLocalOpenPath();
                }
              }}
            />
            <button type="button" onClick={onLocalOpenPath} disabled={localBusy}>
              打开
            </button>
          </div>

          <div
            ref={localDropZoneRef}
            className={isLocalDropActive ? 'sftp-table-wrap drag-over' : 'sftp-table-wrap'}
            onContextMenu={(event) => {
              if (!localPath) {
                return;
              }
              event.preventDefault();
              onOpenLocalContextMenu(event.clientX, event.clientY, null);
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
                      onOpenLocalContextMenu(event.clientX, event.clientY, null);
                    }}
                    onDoubleClick={onLocalGoParent}
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
                        onLocalSelectPath(entry.path);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onLocalSelectPath(entry.path);
                        onOpenLocalContextMenu(event.clientX, event.clientY, entry);
                      }}
                      onDoubleClick={() => {
                        if (entry.is_dir) {
                          onLocalEnterDir(entry);
                        }
                      }}
                    >
                      <td>
                        <div
                          className="entry-name-cell drag-source"
                          onMouseDown={(event) => {
                            startDragCandidate(event, {
                              source: 'local',
                              path: entry.path,
                              name: entry.name
                            });
                          }}
                        >
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
      </section>

      <section className="sftp-pane">
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
            <button type="button" onClick={onConnectSftpHost} disabled={!selectedSftpProfile || sftpBusy || profiles.length === 0}>
              连接
            </button>
            <button type="button" onClick={onRefreshConnectedSftpHost} disabled={sftpBusy || !connectedSftpProfile}>
              刷新
            </button>
            <button type="button" onClick={onDisconnectSftpHost} disabled={sftpBusy || !connectedSftpProfile}>
              关闭连接
            </button>
          </div>
        </div>

        {sftpMessage && <p className="status-line">{sftpMessage}</p>}
        {sftpPrimaryTask && renderProgress(sftpPrimaryTask, 'download')}
        {sftpPanelButtonVisible && (
          <div className="transfer-progress-panel-action">
            <button type="button" onClick={() => setSftpTasksPanelOpen(true)}>
              查看任务面板（进行中 {sftpRunningTasks.length} · 已完成 {sftpCompletedTransferProgresses.length}）
            </button>
          </div>
        )}

        {profiles.length === 0 ? (
          <div className="empty-state">
            请先添加服务器，然后再使用 SFTP 浏览文件。
            <div className="section-actions center">
              <button type="button" onClick={onOpenCreateEditor}>
                新增服务器
              </button>
            </div>
          </div>
        ) : !connectedSftpProfile ? (
          <div className="empty-state">
            先选择一个已保存的服务器并点击“连接”，然后即可浏览远程文件。
            <div className="section-actions center">
              <button type="button" onClick={onConnectSftpHost} disabled={!selectedSftpProfile || sftpBusy}>
                连接服务器
              </button>
            </div>
          </div>
        ) : (
          <div className="sftp-remote-body">
            <div className="sftp-path-bar sftp-path-bar-remote">
              <button type="button" onClick={onSftpGoParent} disabled={sftpBusy || sftpPath === '/'}>
                上级
              </button>
              <input
                value={sftpPathInput}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => onSftpPathInputChange(event.target.value)}
                placeholder="/"
                disabled={sftpBusy}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onOpenSftpPath();
                  }
                }}
              />
              <button type="button" onClick={onOpenSftpPath} disabled={sftpBusy}>
                打开
              </button>
            </div>

              <div
              ref={remoteDropZoneRef}
              className={isRemoteDropActive || isSystemRemoteDropActive ? 'sftp-table-wrap drag-over' : 'sftp-table-wrap'}
              onDragEnter={(event) => {
                if (!connectedSftpProfile || !hasDraggedFiles(event)) {
                  return;
                }
                event.preventDefault();
                setSystemRemoteDropState(true);
              }}
              onDragOver={(event) => {
                if (!connectedSftpProfile || !hasDraggedFiles(event)) {
                  return;
                }
                event.preventDefault();
                setSystemRemoteDropState(true);
              }}
              onDragLeave={(event) => {
                if (!connectedSftpProfile) {
                  return;
                }
                event.preventDefault();
                const relatedTarget = event.relatedTarget as Node | null;
                if (!relatedTarget || !remoteDropZoneRef.current?.contains(relatedTarget)) {
                  setSystemRemoteDropState(false);
                }
              }}
              onDrop={(event) => {
                if (!connectedSftpProfile) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setSystemRemoteDropState(false);
                const droppedPaths = extractDroppedPaths(event);
                if (droppedPaths.length > 0) {
                  uploadSystemPaths(droppedPaths);
                }
              }}
              onContextMenu={(event) => {
                if (!connectedSftpProfile) {
                  return;
                }
                event.preventDefault();
                onOpenSftpContextMenu(event.clientX, event.clientY, null);
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
                        onOpenSftpContextMenu(event.clientX, event.clientY, null);
                      }}
                      onDoubleClick={onSftpGoParent}
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
                          onSftpSelectPath(entry.path);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSftpSelectPath(entry.path);
                          onOpenSftpContextMenu(event.clientX, event.clientY, entry);
                        }}
                        onDoubleClick={() => {
                          if (entry.is_dir) {
                            onSftpEnterDir(entry);
                            return;
                          }
                          onSftpDownload(entry);
                        }}
                      >
                        <td>
                          <div
                            className="entry-name-cell drag-source"
                            onMouseDown={(event) => {
                              startDragCandidate(event, {
                                source: 'remote',
                                path: entry.path,
                                name: entry.name
                              });
                            }}
                          >
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

      {dragPayload && dragPointer && (
        <div
          className="sftp-manual-drag-ghost"
          style={{
            left: dragPointer.x + 14,
            top: dragPointer.y + 14
          }}
        >
          <span className="sftp-manual-drag-label">{dragPayload.source === 'local' ? '上传到 Remote' : '下载到 Local'}</span>
          <span className="sftp-manual-drag-name" title={dragPayload.name}>
            {dragPayload.name}
          </span>
        </div>
      )}

      <TransferTasksPanelModal
        isOpen={isLocalTasksPanelOpen}
        title="上传任务面板"
        kind="upload"
        runningTasks={localRunningTasks}
        completedTasks={localCompletedTransferProgresses}
        formatBytes={formatBytes}
        formatEta={formatEta}
        onCancelTask={onCancelUpload}
        onClearCompleted={onClearLocalCompletedTransfers}
        onClose={() => setLocalTasksPanelOpen(false)}
      />
      <TransferTasksPanelModal
        isOpen={isSftpTasksPanelOpen}
        title="下载任务面板"
        kind="download"
        runningTasks={sftpRunningTasks}
        completedTasks={sftpCompletedTransferProgresses}
        formatBytes={formatBytes}
        formatEta={formatEta}
        onCancelTask={onCancelDownload}
        onClearCompleted={onClearSftpCompletedTransfers}
        onClose={() => setSftpTasksPanelOpen(false)}
      />
    </div>
  );
}
