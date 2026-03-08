import type { LocalActionDialogState } from '../app/types';

type LocalActionDialogProps = {
  dialog: LocalActionDialogState;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onChangeValue: (value: string) => void;
  onSubmit: () => void;
};

export function LocalActionDialog({
  dialog,
  busy,
  error,
  onClose,
  onChangeValue,
  onSubmit
}: LocalActionDialogProps) {
  if (!dialog) {
    return null;
  }

  const title = dialog.kind === 'rename' ? '重命名' : dialog.kind === 'create_dir' ? '新建文件夹' : '删除确认';
  const submitLabel = dialog.kind === 'rename' ? '保存' : dialog.kind === 'create_dir' ? '创建' : '删除';

  return (
    <div className="editor-modal-overlay" onClick={onClose}>
      <section
        className="editor-modal sftp-action-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="editor-modal-header">
          <h3>{title}</h3>
          <button type="button" className="header-action" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>

        <div className="editor-modal-body sftp-action-modal-body">
          {dialog.kind === 'delete' ? (
            <>
              <p className="sftp-action-copy">
                确认删除{dialog.entry.is_dir ? '目录' : '文件'} <strong>{dialog.entry.name}</strong>？
              </p>
              <p className="sftp-action-hint">
                {dialog.entry.is_dir ? '目录会递归删除，操作不可撤销。' : '删除后不可撤销。'}
              </p>
            </>
          ) : (
            <label>
              {dialog.kind === 'rename' ? '新名称' : '文件夹名称'}
              <input
                value={dialog.value}
                autoFocus
                disabled={busy}
                onChange={(event) => onChangeValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
              />
            </label>
          )}

          {error && <p className="status-line error">{error}</p>}
        </div>

        <footer className="editor-modal-footer">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className={dialog.kind === 'delete' ? 'danger' : ''} onClick={onSubmit} disabled={busy}>
            {submitLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
