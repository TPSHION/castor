import type { RefObject } from 'react';
import type { ContentView, LocalContextMenuState } from '../app/types';

type LocalContextMenuProps = {
  contentView: ContentView;
  contextMenu: LocalContextMenuState | null;
  menuRef: RefObject<HTMLDivElement>;
  hasLocalPath: boolean;
  onClose: () => void;
  onOpenDir: (path: string) => void;
  onOpenRename: (path: string) => void;
  onOpenDelete: (path: string) => void;
  onRefresh: () => void;
  onOpenCreateDir: () => void;
};

export function LocalContextMenu({
  contentView,
  contextMenu,
  menuRef,
  hasLocalPath,
  onClose,
  onOpenDir,
  onOpenRename,
  onOpenDelete,
  onRefresh,
  onOpenCreateDir
}: LocalContextMenuProps) {
  if (!contextMenu || contentView !== 'sftp') {
    return null;
  }

  const menuWidth = 240;
  const menuHeight = contextMenu.entry ? 260 : 128;
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
                if (hasLocalPath) {
                  onRefresh();
                }
              }}
            >
              刷新
            </button>
            <button
              type="button"
              className="sftp-context-action"
              onClick={() => {
                if (hasLocalPath) {
                  onOpenCreateDir();
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
                onClose();
                if (hasLocalPath) {
                  onRefresh();
                }
              }}
            >
              刷新
            </button>
            <button
              type="button"
              className="sftp-context-action"
              onClick={() => {
                if (hasLocalPath) {
                  onOpenCreateDir();
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
