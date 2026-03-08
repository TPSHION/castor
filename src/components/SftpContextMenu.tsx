import type { RefObject } from 'react';
import type { ContentView, SftpContextMenuState } from '../app/types';

type SftpContextMenuProps = {
  contentView: ContentView;
  contextMenu: SftpContextMenuState | null;
  menuRef: RefObject<HTMLDivElement>;
  hasConnectedProfile: boolean;
  currentPath: string;
  formatPermissionMode: (value?: number) => string;
  onClose: () => void;
  onOpenDir: (path: string) => void;
  onCopyToTarget: (path: string) => void;
  onOpenRename: (path: string) => void;
  onOpenDelete: (path: string) => void;
  onRefresh: () => void;
  onOpenCreateDir: (parentPath: string) => void;
  onOpenPermissions: (path: string) => void;
};

export function SftpContextMenu({
  contentView,
  contextMenu,
  menuRef,
  hasConnectedProfile,
  currentPath,
  formatPermissionMode,
  onClose,
  onOpenDir,
  onCopyToTarget,
  onOpenRename,
  onOpenDelete,
  onRefresh,
  onOpenCreateDir,
  onOpenPermissions
}: SftpContextMenuProps) {
  if (!contextMenu || contentView !== 'sftp') {
    return null;
  }

  const menuWidth = 240;
  const menuHeight = contextMenu.entry ? 320 : 128;
  const left =
    typeof window === 'undefined'
      ? contextMenu.x
      : Math.max(8, Math.min(contextMenu.x, window.innerWidth - menuWidth - 8));
  const top =
    typeof window === 'undefined'
      ? contextMenu.y
      : Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuHeight - 8));
  const entry = contextMenu.entry;

  return (
    <div className="sftp-context-layer">
      <div
        ref={menuRef}
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
                  onClose();
                  onOpenDir(entry.path);
                }}
              >
                打开目录
              </button>
            )}
            <button type="button" className="sftp-context-action" onClick={() => onCopyToTarget(entry.path)}>
              复制到目标目录
            </button>
            <button type="button" className="sftp-context-action" onClick={() => onOpenRename(entry.path)}>
              重命名
            </button>
            <button type="button" className="sftp-context-action danger" onClick={() => onOpenDelete(entry.path)}>
              删除
            </button>
            <div className="sftp-context-separator" />
            <button
              type="button"
              className="sftp-context-action"
              onClick={() => {
                onClose();
                if (hasConnectedProfile) {
                  onRefresh();
                }
              }}
            >
              刷新
            </button>
            <button type="button" className="sftp-context-action" onClick={() => onOpenCreateDir(currentPath)}>
              新建文件夹
            </button>
            <button type="button" className="sftp-context-action" onClick={() => onOpenPermissions(entry.path)}>
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
                onClose();
                if (hasConnectedProfile) {
                  onRefresh();
                }
              }}
            >
              刷新
            </button>
            <button type="button" className="sftp-context-action" onClick={() => onOpenCreateDir(currentPath)}>
              新建文件夹
            </button>
          </>
        )}
      </div>
    </div>
  );
}
