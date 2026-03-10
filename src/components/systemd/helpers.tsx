import type { ReactNode } from 'react';
import type { SystemdDeployService, SystemdLogOutputMode } from '../../types';
import { SYSTEMD_EXECSTART_EXAMPLES } from './constants';
import type { SystemdServiceType } from './types';

export function inferServiceType(execStart: string): SystemdServiceType {
  const cmd = execStart.toLowerCase();
  if (cmd.includes('node')) {
    return 'node';
  }
  if (cmd.includes('python') || cmd.includes('gunicorn') || cmd.includes('uvicorn')) {
    return 'python';
  }
  if (cmd.includes('java')) {
    return 'java';
  }
  if (cmd.includes('dotnet')) {
    return 'dotnet';
  }
  if (cmd.includes('docker')) {
    return 'docker';
  }
  if (cmd.includes('/go/') || cmd.includes('go-service') || cmd.includes('/usr/local/go')) {
    return 'go';
  }
  return 'custom';
}

export function systemdLogOutputModeLabel(mode: SystemdLogOutputMode): string {
  if (mode === 'file') {
    return '输出到文件';
  }
  if (mode === 'none') {
    return '不输出日志';
  }
  return 'systemd journal';
}

export function firstExecStartExample(type: SystemdServiceType): string {
  return SYSTEMD_EXECSTART_EXAMPLES[type].examples[0] ?? '';
}

export function defaultSystemdLogOutputPath(serviceName: string): string {
  const normalized = serviceName
    .trim()
    .replace(/\.service$/i, '')
    .replace(/[^A-Za-z0-9._@-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safeName = normalized || 'my-app';
  return `/var/log/${safeName}.log`;
}

export function normalizeComparableServiceName(serviceName: string): string {
  return serviceName.trim().replace(/\.service$/i, '').toLowerCase();
}

export function systemdLogOutputPathLabel(service: SystemdDeployService): string {
  if (service.log_output_mode === 'none') {
    return '未启用';
  }
  return service.log_output_path?.trim() || defaultSystemdLogOutputPath(service.service_name);
}

export function buildHighlightedLogSegments(line: string, keyword: string, caseSensitive: boolean): ReactNode[] {
  const needle = keyword.trim();
  if (!needle) {
    return [line];
  }

  const source = caseSensitive ? line : line.toLowerCase();
  const token = caseSensitive ? needle : needle.toLowerCase();
  if (!token) {
    return [line];
  }

  const segments: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;

  while (cursor <= line.length) {
    const index = source.indexOf(token, cursor);
    if (index < 0) {
      if (cursor < line.length) {
        segments.push(line.slice(cursor));
      }
      break;
    }

    if (index > cursor) {
      segments.push(line.slice(cursor, index));
    }

    const hit = line.slice(index, index + needle.length);
    segments.push(
      <span key={`log-hit-${index}-${matchIndex}`} className="systemd-log-keyword">
        {hit}
      </span>
    );
    cursor = index + needle.length;
    matchIndex += 1;
  }

  if (segments.length === 0) {
    return [line];
  }
  return segments;
}
