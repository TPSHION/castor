import type { SftpActionDialogState } from '../app/types';

type SftpActionDialogProps = {
  dialog: SftpActionDialogState;
  busy: boolean;
  error: string | null;
  formatPermissionMode: (value?: number) => string;
  onClose: () => void;
  onChangeValue: (value: string) => void;
  onSubmit: () => void;
};

export function SftpActionDialog({
  dialog,
  busy,
  error,
  formatPermissionMode,
  onClose,
  onChangeValue,
  onSubmit
}: SftpActionDialogProps) {
  if (!dialog) {
    return null;
  }

  const defaultMode = dialog.kind === 'permissions' ? ((dialog.entry.permissions ?? (dialog.entry.is_dir ? 0o755 : 0o644)) & 0o7777) : 0;

  const parsePermissionValue = (value: string): number => {
    const trimmed = value.trim();
    if (!/^[0-7]{3,4}$/.test(trimmed)) {
      return defaultMode;
    }
    return Number.parseInt(trimmed, 8) & 0o7777;
  };

  const formatPermissionValue = (mode: number): string => {
    const normalized = mode & 0o7777;
    const special = (normalized >> 9) & 0o7;
    const base = (normalized & 0o777).toString(8).padStart(3, '0');
    if (special > 0) {
      return `${special.toString(8)}${base}`;
    }
    return base;
  };

  const permissionMode = dialog.kind === 'permissions' ? parsePermissionValue(dialog.value) : 0;

  const setPermissionBit = (bit: number, enabled: boolean) => {
    if (dialog.kind !== 'permissions') {
      return;
    }
    const currentMode = parsePermissionValue(dialog.value);
    const nextMode = enabled ? currentMode | bit : currentMode & ~bit;
    onChangeValue(formatPermissionValue(nextMode));
  };

  const title =
    dialog.kind === 'rename'
      ? '重命名'
      : dialog.kind === 'create_dir'
        ? '新建文件夹'
        : dialog.kind === 'permissions'
          ? '编辑权限'
          : '删除确认';
  const submitLabel =
    dialog.kind === 'rename' ? '保存' : dialog.kind === 'create_dir' ? '创建' : dialog.kind === 'permissions' ? '更新' : '删除';

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
              <p className="sftp-action-hint">{dialog.entry.is_dir ? '目录会递归删除，操作不可撤销。' : '删除后不可撤销。'}</p>
            </>
          ) : dialog.kind === 'permissions' ? (
            <div className="sftp-permissions-editor">
              <div className="sftp-permissions-header">
                <span>权限开关</span>
                <code>{formatPermissionValue(permissionMode)}</code>
              </div>
              <p className="sftp-action-hint">通过开关选择权限，系统会自动生成对应数字。</p>

              <div className="sftp-permissions-grid">
                <div className="sftp-permissions-grid-head">角色</div>
                <div className="sftp-permissions-grid-head">读取 (r)</div>
                <div className="sftp-permissions-grid-head">写入 (w)</div>
                <div className="sftp-permissions-grid-head">执行 (x)</div>

                <div className="sftp-permissions-role">所有者</div>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o400)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o400, event.target.checked)}
                  />
                </label>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o200)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o200, event.target.checked)}
                  />
                </label>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o100)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o100, event.target.checked)}
                  />
                </label>

                <div className="sftp-permissions-role">用户组</div>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o040)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o040, event.target.checked)}
                  />
                </label>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o020)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o020, event.target.checked)}
                  />
                </label>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o010)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o010, event.target.checked)}
                  />
                </label>

                <div className="sftp-permissions-role">其他人</div>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o004)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o004, event.target.checked)}
                  />
                </label>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o002)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o002, event.target.checked)}
                  />
                </label>
                <label className="sftp-permissions-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o001)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o001, event.target.checked)}
                  />
                </label>
              </div>

              <div className="sftp-permissions-special">
                <span>特殊权限</span>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o4000)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o4000, event.target.checked)}
                  />
                  <span>SetUID</span>
                  <span
                    className="sftp-permissions-help"
                    title="执行该文件时，临时使用文件所有者身份运行。"
                    aria-label="SetUID 说明"
                  >
                    ?
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o2000)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o2000, event.target.checked)}
                  />
                  <span>SetGID</span>
                  <span
                    className="sftp-permissions-help"
                    title="执行该文件时临时使用文件所属组身份；用于目录时新建文件继承该组。"
                    aria-label="SetGID 说明"
                  >
                    ?
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(permissionMode & 0o1000)}
                    disabled={busy}
                    onChange={(event) => setPermissionBit(0o1000, event.target.checked)}
                  />
                  <span>Sticky</span>
                  <span
                    className="sftp-permissions-help"
                    title="用于目录时，只有文件拥有者、目录拥有者或 root 可删除/重命名文件。"
                    aria-label="Sticky 说明"
                  >
                    ?
                  </span>
                </label>
              </div>
            </div>
          ) : (
            <label>
              {dialog.kind === 'rename' ? '新名称' : '文件夹名称'}
              <input
                value={dialog.value}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
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

          {dialog.kind === 'permissions' && <p className="sftp-action-hint">当前权限：{formatPermissionMode(dialog.entry.permissions)}</p>}

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
