import type { SystemdLogOutputMode } from '../../types';
import type { SystemdServiceType } from './types';

export const SYSTEMD_SERVICE_TYPES: SystemdServiceType[] = [
  'node',
  'python',
  'java',
  'go',
  'dotnet',
  'docker',
  'custom'
];

export const SYSTEMD_LOG_FETCH_LINES = 120;
export const SYSTEMD_LOG_MAX_LINES = 1000;
export const SYSTEMD_LOG_FLUSH_INTERVAL_MS = 300;

export const SYSTEMD_LOG_OUTPUT_MODE_OPTIONS: Array<{ value: SystemdLogOutputMode; label: string }> = [
  { value: 'journal', label: 'systemd journal (默认)' },
  { value: 'file', label: '输出到文件' },
  { value: 'none', label: '不输出日志' }
];

export const SYSTEMD_EXECSTART_EXAMPLES: Record<SystemdServiceType, { label: string; examples: string[] }> = {
  node: {
    label: 'Node.js',
    examples: ['/usr/bin/node /opt/my-app/server.js', 'pnpm start']
  },
  python: {
    label: 'Python',
    examples: ['/usr/bin/python3 /opt/my-app/main.py', 'gunicorn app:app --bind 0.0.0.0:8000']
  },
  java: {
    label: 'Java',
    examples: ['/usr/bin/java -jar /opt/my-app/app.jar', '/usr/bin/java -Xms256m -Xmx512m -jar app.jar']
  },
  go: {
    label: 'Go',
    examples: ['/opt/my-app/my-service', '/usr/local/bin/my-service --config /etc/my-service.yaml']
  },
  dotnet: {
    label: '.NET',
    examples: ['/usr/bin/dotnet /opt/my-app/MyService.dll', 'dotnet MyService.dll --urls=http://0.0.0.0:5000']
  },
  docker: {
    label: 'Docker',
    examples: [
      '/usr/bin/docker run --rm --name my-app -p 3000:3000 my-app:latest',
      '/usr/bin/docker compose -f /opt/my-app/docker-compose.yml up'
    ]
  },
  custom: {
    label: '自定义',
    examples: ['/path/to/your-command --arg value']
  }
};
