import type { AuthConfig, ConnectionProfile } from '../types';
import type { ProfileEditor } from './types';

export function normalizeRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return '/';
  }

  const absolute = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const segments = absolute
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');

  const next: string[] = [];
  for (const segment of segments) {
    if (segment === '..') {
      next.pop();
      continue;
    }
    next.push(segment);
  }

  return next.length === 0 ? '/' : `/${next.join('/')}`;
}

export function parentRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path);
  if (normalized === '/') {
    return '/';
  }
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

export function formatBytes(value?: number): string {
  if (value === undefined || Number.isNaN(value)) {
    return '-';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatUnixTime(value?: number): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value * 1000);
  return date.toLocaleString();
}

export function formatPermissionMode(value?: number): string {
  if (value === undefined) {
    return '---';
  }
  return (value & 0o7777).toString(8).padStart(3, '0');
}

export function defaultPermissionInput(permissions: number | undefined, isDir: boolean): string {
  if (permissions !== undefined) {
    return formatPermissionMode(permissions);
  }
  return isDir ? '755' : '644';
}

export function parsePermissionInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-7]{3,4}$/.test(trimmed)) {
    return null;
  }
  return Number.parseInt(trimmed, 8);
}

export function createEmptyEditor(): ProfileEditor {
  return {
    name: '',
    host: '',
    port: 22,
    username: '',
    authKind: 'password',
    password: '',
    privateKeyPath: '',
    passphrase: ''
  };
}

export function formatInvokeError(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    const message = candidate.message;
    const nestedError = candidate.error;

    if (typeof message === 'string' && message.length > 0) {
      return message;
    }

    if (typeof nestedError === 'string' && nestedError.length > 0) {
      return nestedError;
    }

    try {
      return JSON.stringify(candidate);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

export function createClientTabId() {
  if (globalThis.crypto?.randomUUID) {
    return `tab-${globalThis.crypto.randomUUID()}`;
  }
  return `tab-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function validateEditor(editor: ProfileEditor): string | null {
  if (!editor.name.trim()) {
    return '名称不能为空';
  }
  if (!editor.host.trim()) {
    return 'Host 不能为空';
  }
  if (!editor.username.trim()) {
    return '用户名不能为空';
  }
  if (editor.port < 1 || editor.port > 65535) {
    return '端口范围应为 1-65535';
  }
  if (editor.authKind === 'password' && !editor.password) {
    return '密码认证必须填写密码';
  }
  if (editor.authKind === 'private_key' && !editor.privateKeyPath.trim()) {
    return '私钥认证必须选择私钥文件';
  }
  return null;
}

export function buildAuthFromProfile(profile: ConnectionProfile): AuthConfig | null {
  if (profile.auth_kind === 'password') {
    if (!profile.password) {
      return null;
    }
    return {
      kind: 'password',
      password: profile.password
    };
  }

  if (!profile.private_key?.trim()) {
    return null;
  }

  return {
    kind: 'private_key',
    private_key: profile.private_key,
    passphrase: profile.passphrase || undefined
  };
}

export function buildAuthFromEditor(editor: ProfileEditor): AuthConfig {
  if (editor.authKind === 'password') {
    return {
      kind: 'password',
      password: editor.password
    };
  }

  return {
    kind: 'private_key',
    private_key: editor.privateKeyPath,
    passphrase: editor.passphrase || undefined
  };
}
