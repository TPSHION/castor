import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

type NginxConfigEditorProps = {
  value: string;
  busy: boolean;
  loading: boolean;
  onChange: (value: string) => void;
};

loader.config({ monaco });

const NGINX_LANGUAGE_ID = 'nginx';
const NGINX_THEME_ID = 'castor-nginx-dark';

let monacoInitialized = false;

function setupMonaco(monacoInstance: Monaco) {
  if (monacoInitialized) {
    return;
  }
  monacoInitialized = true;

  monacoInstance.languages.register({ id: NGINX_LANGUAGE_ID });
  monacoInstance.languages.setMonarchTokensProvider(NGINX_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/#.*/, 'comment'],
        [
          /\b(http|server|location|upstream|events|stream|mail|types|map|geo|set|if|return|include|listen|server_name|root|index|try_files|rewrite|error_page|proxy_pass|proxy_set_header|proxy_read_timeout|proxy_connect_timeout|proxy_send_timeout|access_log|error_log|log_format|pid|daemon|user|worker_processes|worker_connections|gzip|sendfile|tcp_nopush|tcp_nodelay|keepalive_timeout|charset|default_type|add_header|expires|ssl_certificate|ssl_certificate_key|ssl_protocols|ssl_ciphers|client_max_body_size)\b/,
          'keyword'
        ],
        [/\$[a-zA-Z_][\w]*/, 'variable'],
        [/[{}]/, 'delimiter.bracket'],
        [/;/, 'delimiter'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string_double'],
        [/'/, 'string', '@string_single'],
        [/\b\d+(?:\.\d+)?(?:k|K|m|M|g|G)?\b/, 'number'],
        [/\b(on|off)\b/, 'constant'],
        [/[a-zA-Z_][\w-]*/, 'identifier']
      ],
      string_double: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape.invalid'],
        [/"/, 'string', '@pop']
      ],
      string_single: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape.invalid'],
        [/'/, 'string', '@pop']
      ]
    }
  });

  monacoInstance.languages.setLanguageConfiguration(NGINX_LANGUAGE_ID, {
    comments: { lineComment: '#' },
    brackets: [
      ['{', '}'],
      ['(', ')'],
      ['[', ']']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ]
  });

  monacoInstance.editor.defineTheme(NGINX_THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7f94b9' },
      { token: 'keyword', foreground: '9ec4ff' },
      { token: 'variable', foreground: 'ffd479' },
      { token: 'string', foreground: 'c8f4b4' },
      { token: 'number', foreground: '8fe5ff' },
      { token: 'constant', foreground: 'ffb997' }
    ],
    colors: {
      'editor.background': '#121c31',
      'editor.foreground': '#d5e4ff',
      'editor.lineHighlightBackground': '#121c31',
      'editor.lineHighlightBorder': '#121c31',
      'editor.selectionBackground': '#5f93dd52',
      'editorCursor.foreground': '#d5e4ff',
      'editorLineNumber.foreground': '#6f87b3',
      'editorLineNumber.activeForeground': '#b6ccf3',
      'editorGutter.background': '#10192d'
    }
  });
}

export default function NginxConfigEditor({ value, busy, loading, onChange }: NginxConfigEditorProps) {
  const placeholder = loading ? '正在加载配置文件...' : '暂无配置内容';

  return (
    <div className="nginx-config-monaco-shell">
      <Editor
        value={value}
        defaultLanguage={NGINX_LANGUAGE_ID}
        theme={NGINX_THEME_ID}
        height="520px"
        beforeMount={setupMonaco}
        loading={<div className="nginx-config-editor-loading">{placeholder}</div>}
        onChange={(nextValue) => {
          onChange(nextValue ?? '');
        }}
        options={{
          readOnly: busy,
          domReadOnly: busy,
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 12,
          lineHeight: 20,
          lineNumbersMinChars: 4,
          wordWrap: 'off',
          smoothScrolling: true,
          tabSize: 2,
          insertSpaces: true,
          detectIndentation: false,
          renderLineHighlight: 'none',
          folding: false,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          wordBasedSuggestions: 'off',
          parameterHints: { enabled: false },
          scrollBeyondLastLine: false,
          contextmenu: true,
          cursorBlinking: 'smooth',
          bracketPairColorization: { enabled: false }
        }}
      />
      {value.length === 0 && <div className="nginx-config-monaco-placeholder">{placeholder}</div>}
    </div>
  );
}
