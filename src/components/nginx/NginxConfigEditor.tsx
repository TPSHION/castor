import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';

type NginxConfigEditorProps = {
  value: string;
  busy: boolean;
  loading: boolean;
  onChange: (value: string) => void;
};

export default function NginxConfigEditor({ value, busy, loading, onChange }: NginxConfigEditorProps) {
  const editorTheme = useMemo(
    () =>
      EditorView.theme(
        {
          '&': {
            backgroundColor: '#121c31',
            color: '#d5e4ff'
          },
          '.cm-content': {
            caretColor: '#d5e4ff',
            tabSize: '2'
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: '#d5e4ff'
          },
          '&.cm-focused': {
            outline: 'none'
          },
          '.cm-scroller': {
            fontFamily: `'IBM Plex Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace`
          },
          '.cm-gutters': {
            backgroundColor: '#10192d',
            borderRight: '1px solid #2f4366',
            color: '#6f87b3'
          }
        },
        { dark: true }
      ),
    []
  );

  const extensions = useMemo(
    () => [
      editorTheme,
      EditorView.contentAttributes.of({
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'none',
        spellcheck: 'false',
        'data-gramm': 'false'
      })
    ],
    [editorTheme]
  );

  return (
    <div className="nginx-config-codemirror-shell">
      <CodeMirror
        value={value}
        height="520px"
        editable={!busy}
        onChange={onChange}
        placeholder={loading ? '正在加载配置文件...' : '暂无配置内容'}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          autocompletion: false,
          closeBrackets: false,
          searchKeymap: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          indentOnInput: false
        }}
      />
    </div>
  );
}
