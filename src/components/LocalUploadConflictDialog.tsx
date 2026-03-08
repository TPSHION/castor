import type { LocalUploadConflictDialogState } from '../app/types';
import type { SftpUploadConflictStrategy } from '../types';

type LocalUploadConflictDialogProps = {
  dialog: LocalUploadConflictDialogState;
  busy: boolean;
  manualName: string;
  manualError: string | null;
  onClose: () => void;
  onChangeManualName: (value: string) => void;
  onSubmitManualRename: () => void;
  onSelectStrategy: (strategy: SftpUploadConflictStrategy) => void;
};

export function LocalUploadConflictDialog({
  dialog,
  busy,
  manualName,
  manualError,
  onClose,
  onChangeManualName,
  onSubmitManualRename,
  onSelectStrategy
}: LocalUploadConflictDialogProps) {
  if (!dialog) {
    return null;
  }

  const sameKind = dialog.localEntry.is_dir === dialog.remoteEntry.is_dir;

  return (
    <div className="editor-modal-overlay" onClick={onClose}>
      <section
        className="editor-modal sftp-action-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Upload conflict"
      >
        <header className="editor-modal-header">
          <h3>目标目录存在同名项</h3>
          <button type="button" className="header-action" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>

        <div className="editor-modal-body sftp-action-modal-body">
          <p className="sftp-action-copy">
            远程目录 <strong>{dialog.remoteDir}</strong> 中已存在同名{dialog.remoteEntry.is_dir ? '目录' : '文件'}{' '}
            <strong>{dialog.remoteEntry.name}</strong>。
          </p>

          <p className="sftp-action-hint">
            建议：优先使用“自动重命名上传”，可避免覆盖现有内容并保留两份文件。
          </p>
          <label>
            手动重命名后上传
            <input
              value={manualName}
              disabled={busy}
              autoFocus
              onChange={(event) => onChangeManualName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSubmitManualRename();
                }
              }}
              placeholder="输入新的远程文件名"
            />
          </label>
          {!sameKind && (
            <p className="status-line error">当前同名项类型不同（文件/目录），覆盖上传可能失败。</p>
          )}
          {manualError && <p className="status-line error">{manualError}</p>}
        </div>

        <footer className="editor-modal-footer">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" onClick={() => onSelectStrategy('auto_rename')} disabled={busy}>
            自动重命名上传（推荐）
          </button>
          <button type="button" onClick={onSubmitManualRename} disabled={busy}>
            手动重命名上传
          </button>
          <button type="button" className="danger" onClick={() => onSelectStrategy('overwrite')} disabled={busy}>
            覆盖上传
          </button>
        </footer>
      </section>
    </div>
  );
}
