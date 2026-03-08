import type { Dispatch, SetStateAction } from 'react';
import type { ProfileEditor, EditorMode, TestState, AuthType } from '../app/types';

type ServerEditorModalProps = {
  isOpen: boolean;
  editorMode: EditorMode;
  editor: ProfileEditor;
  editorBusy: boolean;
  testState: TestState;
  editorValidation: string | null;
  onClose: () => void;
  onTestConnection: () => void;
  onSave: () => void;
  setEditor: Dispatch<SetStateAction<ProfileEditor>>;
};

export function ServerEditorModal({
  isOpen,
  editorMode,
  editor,
  editorBusy,
  testState,
  editorValidation,
  onClose,
  onTestConnection,
  onSave,
  setEditor
}: ServerEditorModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="editor-modal-overlay" onClick={onClose}>
      <section
        className="editor-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Server editor"
      >
        <header className="editor-modal-header">
          <h3>{editorMode === 'create' ? '新增服务器' : '编辑服务器'}</h3>
          <button type="button" className="header-action" onClick={onClose} disabled={editorBusy}>
            关闭
          </button>
        </header>

        <div className="editor-modal-body">
          <div className="editor-grid modal-grid">
            <label>
              名称
              <input
                value={editor.name}
                onChange={(event) => setEditor((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="如：生产服务器"
              />
            </label>

            <label>
              Host
              <input
                value={editor.host}
                onChange={(event) => setEditor((prev) => ({ ...prev, host: event.target.value }))}
                placeholder="server.example.com"
              />
            </label>

            <label>
              Port
              <input
                type="number"
                min={1}
                max={65535}
                value={editor.port}
                onChange={(event) =>
                  setEditor((prev) => ({
                    ...prev,
                    port: Number(event.target.value)
                  }))
                }
              />
            </label>

            <label>
              用户名
              <input
                value={editor.username}
                onChange={(event) => setEditor((prev) => ({ ...prev, username: event.target.value }))}
                placeholder="root"
              />
            </label>

            <label>
              认证方式
              <select
                value={editor.authKind}
                onChange={(event) =>
                  setEditor((prev) => ({
                    ...prev,
                    authKind: event.target.value as AuthType
                  }))
                }
              >
                <option value="password">密码</option>
                <option value="private_key">私钥</option>
              </select>
            </label>
          </div>

          {editor.authKind === 'password' ? (
            <label>
              密码
              <input
                type="password"
                value={editor.password}
                onChange={(event) => setEditor((prev) => ({ ...prev, password: event.target.value }))}
                autoComplete="off"
              />
            </label>
          ) : (
            <>
              <label>
                私钥 (PEM)
                <textarea
                  rows={6}
                  value={editor.privateKey}
                  onChange={(event) => setEditor((prev) => ({ ...prev, privateKey: event.target.value }))}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                />
              </label>
              <label>
                私钥口令 (可选)
                <input
                  type="password"
                  value={editor.passphrase}
                  onChange={(event) => setEditor((prev) => ({ ...prev, passphrase: event.target.value }))}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          {testState.phase !== 'idle' && (
            <p className={testState.phase === 'error' ? 'status-line error' : 'status-line'}>{testState.message}</p>
          )}

          {editorValidation && testState.phase === 'idle' && <p className="status-line error">{editorValidation}</p>}
        </div>

        <footer className="editor-modal-footer">
          <button type="button" onClick={onClose} disabled={editorBusy}>
            取消
          </button>
          <button type="button" onClick={onTestConnection} disabled={editorBusy || testState.phase === 'testing'}>
            {testState.phase === 'testing' ? '测试中...' : '测试连接'}
          </button>
          <button type="button" onClick={onSave} disabled={editorBusy || Boolean(editorValidation)}>
            {editorBusy ? '保存中...' : '保存'}
          </button>
        </footer>
      </section>
    </div>
  );
}
