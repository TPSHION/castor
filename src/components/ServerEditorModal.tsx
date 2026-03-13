import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { pickLocalFile } from '../app/api/localfs';
import { formatInvokeError } from '../app/helpers';
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
  const [pickFileError, setPickFileError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPickFileError(null);
    }
  }, [isOpen]);

  async function onPickPrivateKeyFile() {
    try {
      setPickFileError(null);
      const filePath = await pickLocalFile();
      if (!filePath) {
        return;
      }
      setEditor((prev) => ({ ...prev, privateKeyPath: filePath }));
    } catch (error) {
      setPickFileError(formatInvokeError(error));
    }
  }

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
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => setEditor((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="如：生产服务器"
              />
            </label>

            <label>
              Host
              <input
                value={editor.host}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
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
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
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
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
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
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
          ) : (
            <>
              <label>
                私钥文件
                <input
                  value={editor.privateKeyPath}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(event) => setEditor((prev) => ({ ...prev, privateKeyPath: event.target.value }))}
                  placeholder="请选择本地私钥文件路径"
                />
              </label>
              <div className="editor-modal-inline-actions">
                <button type="button" onClick={() => void onPickPrivateKeyFile()} disabled={editorBusy}>
                  选择私钥文件
                </button>
                <button
                  type="button"
                  onClick={() => setEditor((prev) => ({ ...prev, privateKeyPath: '' }))}
                  disabled={editorBusy || !editor.privateKeyPath}
                >
                  清空路径
                </button>
              </div>
              <label>
                私钥口令 (可选)
                <input
                  type="password"
                  value={editor.passphrase}
                  onChange={(event) => setEditor((prev) => ({ ...prev, passphrase: event.target.value }))}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
              />
            </label>
              {pickFileError && <p className="status-line error">{pickFileError}</p>}
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
