import { useMemo, useState } from 'react';
import type { LocalFsEntry, SftpEntry } from '../types';
import { TransferTasksPanelModal } from './TransferTasksPanelModal';
import { TransferProgressCard } from './sftp/TransferProgressCard';
import { formatTransferEta } from './sftp/transferHelpers';
import type { SftpViewProps } from './sftp/types';
import { useSftpDragTransfer } from './sftp/useSftpDragTransfer';

function getEntryRowClassName(isDir: boolean, selected: boolean) {
  if (isDir) {
    return selected ? 'sftp-entry-row dir selected' : 'sftp-entry-row dir';
  }
  return selected ? 'sftp-entry-row selected' : 'sftp-entry-row';
}

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
  const {
    localDropZoneRef,
    remoteDropZoneRef,
    isLocalDropActive,
    isRemoteDropActive,
    isSystemRemoteDropActive,
    dragPayload,
    dragPointer,
    startDragCandidate,
    remoteDropHandlers
  } = useSftpDragTransfer({
    isActive,
    connectedSftpProfile,
    localEntries,
    sftpEntries,
    onUploadSystemPathsToRemote,
    onUploadLocalEntryToRemote,
    onDownloadRemoteEntryToLocal
  });

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
  const localEntryRows = useMemo(() => {
    if (localEntries.length === 0) {
      return (
        <tr>
          <td colSpan={4} className="sftp-empty-cell">
            当前本地目录为空
          </td>
        </tr>
      );
    }

    return localEntries.map((entry) => (
      <tr
        key={entry.path}
        className={getEntryRowClassName(entry.is_dir, localSelectedPath === entry.path)}
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
    ));
  }, [
    formatBytes,
    formatUnixTime,
    localEntries,
    localSelectedPath,
    onLocalEnterDir,
    onLocalSelectPath,
    onOpenLocalContextMenu,
    startDragCandidate
  ]);

  const remoteEntryRows = useMemo(() => {
    if (sftpEntries.length === 0) {
      return (
        <tr>
          <td colSpan={4} className="sftp-empty-cell">
            当前远程目录为空
          </td>
        </tr>
      );
    }

    return sftpEntries.map((entry) => (
      <tr
        key={entry.path}
        className={getEntryRowClassName(entry.is_dir, sftpSelectedPath === entry.path)}
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
    ));
  }, [
    formatBytes,
    formatUnixTime,
    onOpenSftpContextMenu,
    onSftpDownload,
    onSftpEnterDir,
    onSftpSelectPath,
    sftpEntries,
    sftpSelectedPath,
    startDragCandidate
  ]);

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
        {localPrimaryTask && (
          <TransferProgressCard
            payload={localPrimaryTask}
            kind="upload"
            formatBytes={formatBytes}
            onCancelUpload={onCancelUpload}
            onCancelDownload={onCancelDownload}
          />
        )}
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
                {localEntryRows}
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
              className="sftp-profile-select"
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
            {connectedSftpProfile ? (
              <>
                <button type="button" onClick={onRefreshConnectedSftpHost} disabled={sftpBusy}>
                  刷新
                </button>
                <button type="button" onClick={onDisconnectSftpHost} disabled={sftpBusy}>
                  关闭连接
                </button>
              </>
            ) : (
              <button type="button" onClick={onConnectSftpHost} disabled={!selectedSftpProfile || sftpBusy || profiles.length === 0}>
                连接
              </button>
            )}
          </div>
        </div>

        {sftpMessage && <p className="status-line">{sftpMessage}</p>}
        {sftpPrimaryTask && (
          <TransferProgressCard
            payload={sftpPrimaryTask}
            kind="download"
            formatBytes={formatBytes}
            onCancelUpload={onCancelUpload}
            onCancelDownload={onCancelDownload}
          />
        )}
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
              {...remoteDropHandlers}
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
                  {remoteEntryRows}
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
        formatEta={formatTransferEta}
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
        formatEta={formatTransferEta}
        onCancelTask={onCancelDownload}
        onClearCompleted={onClearSftpCompletedTransfers}
        onClose={() => setSftpTasksPanelOpen(false)}
      />
    </div>
  );
}
