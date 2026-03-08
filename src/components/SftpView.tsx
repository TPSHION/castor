import type { ConnectionProfile, LocalFsEntry, SftpEntry } from '../types';

type SftpViewProps = {
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
};

export function SftpView({
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
  onOpenCreateEditor
}: SftpViewProps) {
  return (
    <div className="sftp-dual-page">
      <section className="sftp-pane content-section">
        <div className="sftp-pane-header">
          <h2>Local</h2>
          <div className="section-actions">
            <button type="button" onClick={onLocalGoParent} disabled={!localParentPath || localBusy}>
              上级目录
            </button>
            <button type="button" onClick={onRefreshLocalDir} disabled={localBusy}>
              刷新
            </button>
          </div>
        </div>

        <div className="sftp-path-bar">
          <input
            value={localPathInput}
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

        {localMessage && <p className="status-line">{localMessage}</p>}

        <div
          className="sftp-table-wrap"
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
              className="sftp-table-wrap"
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
