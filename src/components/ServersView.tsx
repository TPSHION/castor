import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  applySystemdDeployService,
  controlSystemdDeployService,
  deleteSystemdDeployService,
  getRemoteSystemdServiceTemplate,
  getSystemdDeployServiceLogs,
  getSystemdDeployServiceStatus,
  listRemoteSystemdServices,
  listSystemdDeployServices,
  upsertSystemdDeployService
} from '../app/api/profiles';
import { formatInvokeError } from '../app/helpers';
import type {
  ConnectionProfile,
  RemoteSystemdServiceItem,
  SystemdDeployService,
  SystemdLogOutputMode,
  SystemdScope,
  SystemdServiceStatus,
  UpsertSystemdDeployServiceRequest
} from '../types';

type ServersViewProps = {
  profiles: ConnectionProfile[];
  profilesBusy: boolean;
  profileMessage: string | null;
  connectedCount: number;
  onOpenCreateEditor: () => void;
  onRefreshProfiles: () => void;
  onConnectLocalTerminal: () => void;
  onConnectProfile: (profile: ConnectionProfile) => void;
  onOpenEditEditor: (profile: ConnectionProfile) => void;
  onDeleteProfile: (profile: ConnectionProfile) => void;
};

type SystemdFormState = {
  id?: string;
  profileId: string;
  name: string;
  serviceName: string;
  serviceType: SystemdServiceType;
  scope: SystemdScope;
  description: string;
  workingDir: string;
  execStart: string;
  execStop: string;
  serviceUser: string;
  environmentText: string;
  enableOnBoot: boolean;
  useSudo: boolean;
  logOutputMode: SystemdLogOutputMode;
  logOutputPath: string;
};

type SystemdDeleteDialogState = {
  id: string;
  name: string;
  from: 'list' | 'detail';
};

type SystemdServiceType = 'node' | 'python' | 'java' | 'go' | 'dotnet' | 'docker' | 'custom';

const SYSTEMD_SERVICE_TYPES: SystemdServiceType[] = ['node', 'python', 'java', 'go', 'dotnet', 'docker', 'custom'];
const SYSTEMD_LOG_FETCH_LINES = 120;
const SYSTEMD_LOG_MAX_LINES = 1000;
const SYSTEMD_LOG_FLUSH_INTERVAL_MS = 300;
const SYSTEMD_LOG_OUTPUT_MODE_OPTIONS: Array<{ value: SystemdLogOutputMode; label: string }> = [
  { value: 'journal', label: 'systemd journal (默认)' },
  { value: 'file', label: '输出到文件' },
  { value: 'none', label: '不输出日志' }
];

const SYSTEMD_EXECSTART_EXAMPLES: Record<SystemdServiceType, { label: string; examples: string[] }> = {
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

function inferServiceType(execStart: string): SystemdServiceType {
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

function systemdLogOutputModeLabel(mode: SystemdLogOutputMode): string {
  if (mode === 'file') {
    return '输出到文件';
  }
  if (mode === 'none') {
    return '不输出日志';
  }
  return 'systemd journal';
}

function firstExecStartExample(type: SystemdServiceType): string {
  return SYSTEMD_EXECSTART_EXAMPLES[type].examples[0] ?? '';
}

function defaultSystemdLogOutputPath(serviceName: string): string {
  const normalized = serviceName
    .trim()
    .replace(/\.service$/i, '')
    .replace(/[^A-Za-z0-9._@-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safeName = normalized || 'my-app';
  return `/var/log/${safeName}.log`;
}

function normalizeComparableServiceName(serviceName: string): string {
  return serviceName.trim().replace(/\.service$/i, '').toLowerCase();
}

function systemdLogOutputPathLabel(service: SystemdDeployService): string {
  if (service.log_output_mode === 'none') {
    return '未启用';
  }
  return service.log_output_path?.trim() || defaultSystemdLogOutputPath(service.service_name);
}

function buildHighlightedLogSegments(line: string, keyword: string, caseSensitive: boolean): ReactNode[] {
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

function createSystemdForm(profile?: ConnectionProfile | null): SystemdFormState {
  const serviceName = 'my-app';
  return {
    profileId: profile?.id ?? '',
    name: '',
    serviceName,
    serviceType: 'node',
    scope: 'system',
    description: 'Managed by Castor',
    workingDir: '/opt/my-app',
    execStart: '/usr/bin/node /opt/my-app/server.js',
    execStop: '',
    serviceUser: profile?.username ?? '',
    environmentText: '',
    enableOnBoot: true,
    useSudo: true,
    logOutputMode: 'journal',
    logOutputPath: defaultSystemdLogOutputPath(serviceName)
  };
}

function toSystemdForm(service: SystemdDeployService, profiles: ConnectionProfile[]): SystemdFormState {
  const profile = profiles.find((item) => item.id === service.profile_id);
  return {
    id: service.id,
    profileId: service.profile_id,
    name: service.name,
    serviceName: service.service_name,
    serviceType: inferServiceType(service.exec_start),
    scope: service.scope,
    description: service.description ?? '',
    workingDir: service.working_dir,
    execStart: service.exec_start,
    execStop: service.exec_stop ?? '',
    serviceUser: service.service_user ?? profile?.username ?? '',
    environmentText: (service.environment ?? []).join('\n'),
    enableOnBoot: service.enable_on_boot,
    useSudo: service.use_sudo,
    logOutputMode: service.log_output_mode ?? 'journal',
    logOutputPath: service.log_output_path ?? defaultSystemdLogOutputPath(service.service_name)
  };
}

export function ServersView({
  profiles,
  profilesBusy,
  profileMessage,
  connectedCount,
  onOpenCreateEditor,
  onRefreshProfiles,
  onConnectLocalTerminal,
  onConnectProfile,
  onOpenEditEditor,
  onDeleteProfile
}: ServersViewProps) {
  const [activeMenu, setActiveMenu] = useState<'servers' | 'settings' | 'systemd'>('servers');
  const textInputProps = {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'none' as const,
    spellCheck: false
  };

  const [systemdMode, setSystemdMode] = useState<'list' | 'detail' | 'create' | 'edit'>('list');
  const [systemdDetailServiceId, setSystemdDetailServiceId] = useState<string | null>(null);
  const [systemdForm, setSystemdForm] = useState<SystemdFormState>(() => createSystemdForm(null));
  const [systemdServices, setSystemdServices] = useState<SystemdDeployService[]>([]);
  const [systemdBusy, setSystemdBusy] = useState(false);
  const [systemdDeletingServiceId, setSystemdDeletingServiceId] = useState<string | null>(null);
  const [systemdDeleteDialog, setSystemdDeleteDialog] = useState<SystemdDeleteDialogState | null>(null);
  const [systemdDetailStatusBusy, setSystemdDetailStatusBusy] = useState(false);
  const [systemdDetailStatus, setSystemdDetailStatus] = useState<SystemdServiceStatus | null>(null);
  const [systemdDetailAction, setSystemdDetailAction] = useState<'start' | 'stop' | 'restart' | 'delete' | null>(null);
  const [systemdDetailLogsBusy, setSystemdDetailLogsBusy] = useState(false);
  const [systemdDetailLogsRealtime, setSystemdDetailLogsRealtime] = useState(false);
  const [systemdDetailLogs, setSystemdDetailLogs] = useState<string[]>([]);
  const [systemdDetailLogsCursor, setSystemdDetailLogsCursor] = useState<string | null>(null);
  const [systemdLogFilterKeywordDraft, setSystemdLogFilterKeywordDraft] = useState('');
  const [systemdLogFilterCaseSensitiveDraft, setSystemdLogFilterCaseSensitiveDraft] = useState(false);
  const [systemdLogFilterKeywordApplied, setSystemdLogFilterKeywordApplied] = useState('');
  const [systemdLogFilterCaseSensitiveApplied, setSystemdLogFilterCaseSensitiveApplied] = useState(false);
  const [systemdLogFullscreen, setSystemdLogFullscreen] = useState(false);
  const [systemdMessage, setSystemdMessage] = useState<string | null>(null);
  const [systemdMessageIsError, setSystemdMessageIsError] = useState(false);
  const [systemdSubmitAction, setSystemdSubmitAction] = useState<'save' | 'save-and-deploy' | null>(null);
  const [systemdImportPanelOpen, setSystemdImportPanelOpen] = useState(false);
  const [systemdRemoteServicesBusy, setSystemdRemoteServicesBusy] = useState(false);
  const [systemdImportBusy, setSystemdImportBusy] = useState(false);
  const [systemdRemoteServices, setSystemdRemoteServices] = useState<RemoteSystemdServiceItem[]>([]);
  const [systemdSelectedRemoteServiceName, setSystemdSelectedRemoteServiceName] = useState('');
  const [systemdRemoteServiceKeyword, setSystemdRemoteServiceKeyword] = useState('');
  const systemdDetailLogsCursorRef = useRef<string | null>(null);
  const systemdDetailLogsRealtimeRef = useRef(false);
  const pendingSystemdLogLinesRef = useRef<string[]>([]);
  const systemdLogFlushTimerRef = useRef<number | null>(null);
  const systemdLogPanelRef = useRef<HTMLPreElement | null>(null);
  const systemdLogFullscreenRef = useRef<HTMLPreElement | null>(null);
  const systemdSubmitActionRef = useRef<'save' | 'save-and-deploy' | null>(null);

  const profileNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const profile of profiles) {
      map.set(profile.id, `${profile.name} (${profile.username}@${profile.host})`);
    }
    return map;
  }, [profiles]);

  const selectedSystemdProfile = useMemo(
    () => profiles.find((profile) => profile.id === systemdForm.profileId) ?? null,
    [profiles, systemdForm.profileId]
  );
  const selectedSystemdDetailService = useMemo(
    () => systemdServices.find((item) => item.id === systemdDetailServiceId) ?? null,
    [systemdDetailServiceId, systemdServices]
  );
  const selectedServiceTypeExamples = useMemo(
    () => SYSTEMD_EXECSTART_EXAMPLES[systemdForm.serviceType],
    [systemdForm.serviceType]
  );
  const existingSystemdServiceNameSet = useMemo(() => {
    const names = new Set<string>();
    for (const item of systemdServices) {
      names.add(normalizeComparableServiceName(item.service_name));
    }
    return names;
  }, [systemdServices]);
  const filteredSystemdRemoteServices = useMemo(() => {
    const keyword = systemdRemoteServiceKeyword.trim().toLowerCase();
    if (!keyword) {
      return systemdRemoteServices;
    }
    return systemdRemoteServices.filter((item) => {
      return (
        item.service_name.toLowerCase().includes(keyword) ||
        item.unit_file_state.toLowerCase().includes(keyword)
      );
    });
  }, [systemdRemoteServiceKeyword, systemdRemoteServices]);
  const selectedRemoteServiceAlreadyAdded = useMemo(() => {
    if (!systemdSelectedRemoteServiceName) {
      return false;
    }
    return existingSystemdServiceNameSet.has(normalizeComparableServiceName(systemdSelectedRemoteServiceName));
  }, [existingSystemdServiceNameSet, systemdSelectedRemoteServiceName]);
  const systemdDuplicateService = useMemo(() => {
    const normalizedServiceName = normalizeComparableServiceName(systemdForm.serviceName);
    if (!normalizedServiceName) {
      return null;
    }
    return (
      systemdServices.find(
        (item) =>
          item.id !== systemdForm.id &&
          normalizeComparableServiceName(item.service_name) === normalizedServiceName
      ) ?? null
    );
  }, [systemdForm.id, systemdForm.serviceName, systemdServices]);
  const systemdServiceNameValidationMessage = useMemo(() => {
    if (!systemdForm.serviceName.trim()) {
      return null;
    }
    if (!systemdDuplicateService) {
      return null;
    }
    return `服务名已存在：${systemdDuplicateService.service_name}，请更换后再保存`;
  }, [systemdDuplicateService, systemdForm.serviceName]);
  const isSystemdLogFilterDirty = useMemo(() => {
    return (
      systemdLogFilterKeywordDraft.trim() !== systemdLogFilterKeywordApplied.trim() ||
      systemdLogFilterCaseSensitiveDraft !== systemdLogFilterCaseSensitiveApplied
    );
  }, [
    systemdLogFilterCaseSensitiveApplied,
    systemdLogFilterCaseSensitiveDraft,
    systemdLogFilterKeywordApplied,
    systemdLogFilterKeywordDraft
  ]);
  const hasAppliedSystemdLogFilter = useMemo(
    () => Boolean(systemdLogFilterKeywordApplied.trim()),
    [systemdLogFilterKeywordApplied]
  );
  const filteredSystemdDetailLogs = useMemo(() => {
    const keyword = systemdLogFilterKeywordApplied.trim();
    if (!keyword) {
      return systemdDetailLogs;
    }
    if (systemdLogFilterCaseSensitiveApplied) {
      return systemdDetailLogs.filter((line) => line.includes(keyword));
    }
    const needle = keyword.toLowerCase();
    return systemdDetailLogs.filter((line) => line.toLowerCase().includes(needle));
  }, [systemdDetailLogs, systemdLogFilterCaseSensitiveApplied, systemdLogFilterKeywordApplied]);
  const highlightedSystemdLogNodes = useMemo(() => {
    const keyword = systemdLogFilterKeywordApplied.trim();
    return filteredSystemdDetailLogs.map((line, index) => (
      <Fragment key={`systemd-log-line-${index}`}>
        {buildHighlightedLogSegments(line, keyword, systemdLogFilterCaseSensitiveApplied)}
        {index < filteredSystemdDetailLogs.length - 1 ? '\n' : null}
      </Fragment>
    ));
  }, [filteredSystemdDetailLogs, systemdLogFilterCaseSensitiveApplied, systemdLogFilterKeywordApplied]);
  const isDetailRunning = systemdDetailStatus?.summary === 'running';
  const canDetailStart = !systemdBusy && !systemdDetailStatusBusy && !systemdDetailAction && !isDetailRunning;
  const canDetailStop = !systemdBusy && !systemdDetailStatusBusy && !systemdDetailAction && isDetailRunning;
  const detailStatusActionDisabled = systemdBusy || systemdDetailStatusBusy || Boolean(systemdDetailAction);
  const detailBackDisabled = systemdDetailAction === 'delete';
  const canReadSystemdLogs = Boolean(
    selectedSystemdDetailService && selectedSystemdDetailService.log_output_mode !== 'none'
  );

  const systemdValidation = useMemo(() => {
    if (!systemdForm.profileId) {
      return '请选择目标服务器';
    }
    if (!systemdForm.name.trim()) {
      return '部署名称不能为空';
    }
    if (!systemdForm.serviceName.trim()) {
      return '服务名不能为空';
    }
    if (systemdServiceNameValidationMessage) {
      return systemdServiceNameValidationMessage;
    }
    if (!systemdForm.workingDir.trim()) {
      return '工作目录不能为空';
    }
    if (!systemdForm.execStart.trim()) {
      return '启动命令不能为空';
    }
    if (systemdForm.logOutputMode === 'file' && !systemdForm.logOutputPath.trim()) {
      return '日志输出为文件时，日志路径不能为空';
    }
    return null;
  }, [systemdForm, systemdServiceNameValidationMessage]);

  useEffect(() => {
    if (profiles.length === 0) {
      setSystemdForm((previous) => ({ ...previous, profileId: '', serviceUser: '' }));
      return;
    }

    setSystemdForm((previous) => {
      const hasProfile = profiles.some((profile) => profile.id === previous.profileId);
      if (hasProfile) {
        return previous;
      }
      return {
        ...previous,
        profileId: profiles[0].id,
        serviceUser: profiles[0].username
      };
    });
  }, [profiles]);

  useEffect(() => {
    if (!systemdImportPanelOpen) {
      return;
    }
    if (filteredSystemdRemoteServices.length === 0) {
      if (systemdSelectedRemoteServiceName) {
        setSystemdSelectedRemoteServiceName('');
      }
      return;
    }
    const exists = filteredSystemdRemoteServices.some(
      (item) => item.service_name === systemdSelectedRemoteServiceName
    );
    if (!exists) {
      setSystemdSelectedRemoteServiceName(filteredSystemdRemoteServices[0].service_name);
    }
  }, [filteredSystemdRemoteServices, systemdImportPanelOpen, systemdSelectedRemoteServiceName]);

  useEffect(() => {
    systemdDetailLogsCursorRef.current = systemdDetailLogsCursor;
  }, [systemdDetailLogsCursor]);

  useEffect(() => {
    systemdDetailLogsRealtimeRef.current = systemdDetailLogsRealtime;
  }, [systemdDetailLogsRealtime]);

  useEffect(() => {
    if (!systemdDetailLogsRealtime) {
      return;
    }
    const timer = window.requestAnimationFrame(() => {
      if (systemdLogPanelRef.current) {
        systemdLogPanelRef.current.scrollTop = systemdLogPanelRef.current.scrollHeight;
      }
      if (systemdLogFullscreenRef.current) {
        systemdLogFullscreenRef.current.scrollTop = systemdLogFullscreenRef.current.scrollHeight;
      }
    });
    return () => {
      window.cancelAnimationFrame(timer);
    };
  }, [systemdDetailLogs, systemdDetailLogsRealtime, systemdLogFullscreen]);

  useEffect(() => {
    if (!systemdLogFullscreen) {
      return;
    }
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSystemdLogFullscreen(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('keydown', onEsc);
    };
  }, [systemdLogFullscreen]);

  useEffect(() => {
    return () => {
      if (systemdLogFlushTimerRef.current !== null) {
        window.clearTimeout(systemdLogFlushTimerRef.current);
      }
    };
  }, []);

  const refreshSystemdList = useCallback(async () => {
    setSystemdBusy(true);
    setSystemdMessage(null);
    setSystemdMessageIsError(false);
    try {
      const list = await listSystemdDeployServices();
      setSystemdServices(list);
    } catch (invokeError) {
      setSystemdMessage(`读取部署服务失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      setSystemdBusy(false);
    }
  }, []);

  useEffect(() => {
    if (activeMenu === 'systemd' && systemdMode === 'list') {
      void refreshSystemdList();
    }
  }, [activeMenu, refreshSystemdList, systemdMode]);

  const onStartCreateSystemd = () => {
    setSystemdMessage(null);
    setSystemdMessageIsError(false);
    setSystemdImportPanelOpen(false);
    setSystemdRemoteServices([]);
    setSystemdSelectedRemoteServiceName('');
    setSystemdRemoteServiceKeyword('');
    setSystemdForm(createSystemdForm(profiles[0] ?? null));
    setSystemdMode('create');
  };

  const onEditSystemd = (service: SystemdDeployService) => {
    setSystemdMessage(null);
    setSystemdMessageIsError(false);
    setSystemdImportPanelOpen(false);
    setSystemdRemoteServices([]);
    setSystemdSelectedRemoteServiceName('');
    setSystemdRemoteServiceKeyword('');
    setSystemdForm(toSystemdForm(service, profiles));
    setSystemdMode('edit');
  };

  const loadRemoteSystemdServiceList = useCallback(async () => {
    if (!systemdForm.profileId) {
      setSystemdMessage('请先选择目标服务器');
      setSystemdMessageIsError(true);
      return;
    }

    setSystemdRemoteServicesBusy(true);
    try {
      const items = await listRemoteSystemdServices({
        profile_id: systemdForm.profileId,
        scope: systemdForm.scope,
        use_sudo: systemdForm.scope === 'system' ? systemdForm.useSudo : false
      });
      setSystemdRemoteServices(items);
      setSystemdSelectedRemoteServiceName((previous) => {
        if (previous && items.some((item) => item.service_name === previous)) {
          return previous;
        }
        return items[0]?.service_name ?? '';
      });
    } catch (invokeError) {
      setSystemdMessage(`读取现有 systemd 服务失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      setSystemdRemoteServicesBusy(false);
    }
  }, [systemdForm.profileId, systemdForm.scope, systemdForm.useSudo]);

  const onOpenSystemdImportPanel = () => {
    if (!systemdForm.profileId) {
      setSystemdMessage('请先选择目标服务器');
      setSystemdMessageIsError(true);
      return;
    }
    setSystemdImportPanelOpen(true);
    setSystemdRemoteServiceKeyword('');
    void loadRemoteSystemdServiceList();
  };

  const onImportRemoteSystemdService = async () => {
    if (!systemdForm.profileId || !systemdSelectedRemoteServiceName) {
      return;
    }

    setSystemdImportBusy(true);
    try {
      const template = await getRemoteSystemdServiceTemplate({
        profile_id: systemdForm.profileId,
        service_name: systemdSelectedRemoteServiceName,
        scope: systemdForm.scope,
        use_sudo: systemdForm.scope === 'system' ? systemdForm.useSudo : false
      });

      setSystemdForm((previous) => {
        const nextServiceName = template.service_name || previous.serviceName;
        const prevDefaultPath = defaultSystemdLogOutputPath(previous.serviceName);
        const shouldSyncPath = !previous.logOutputPath.trim() || previous.logOutputPath === prevDefaultPath;
        const nextExecStart = template.exec_start?.trim() || previous.execStart;
        const importedLogMode = template.log_output_mode ?? (template.log_output_path?.trim() ? 'file' : previous.logOutputMode);
        const importedLogPath = template.log_output_path?.trim();
        let nextLogOutputPath = previous.logOutputPath;
        if (importedLogMode === 'file') {
          if (importedLogPath) {
            nextLogOutputPath = importedLogPath;
          } else if (shouldSyncPath || !previous.logOutputPath.trim()) {
            nextLogOutputPath = defaultSystemdLogOutputPath(nextServiceName);
          }
        }
        return {
          ...previous,
          name: previous.name.trim() ? previous.name : nextServiceName,
          serviceName: nextServiceName,
          description: template.description ?? previous.description,
          workingDir: template.working_dir ?? previous.workingDir,
          execStart: nextExecStart,
          execStop: template.exec_stop ?? '',
          serviceUser: previous.scope === 'system' ? (template.service_user ?? previous.serviceUser) : previous.serviceUser,
          environmentText: template.environment?.join('\n') ?? '',
          serviceType: inferServiceType(nextExecStart),
          logOutputMode: importedLogMode,
          logOutputPath: nextLogOutputPath
        };
      });
      setSystemdImportPanelOpen(false);
      setSystemdMessage(`已导入服务：${template.service_name}.service，请确认后保存`);
      setSystemdMessageIsError(false);
    } catch (invokeError) {
      setSystemdMessage(`导入 systemd 服务失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      setSystemdImportBusy(false);
    }
  };

  const refreshSystemdDetailStatus = useCallback(async (serviceId: string) => {
    setSystemdDetailStatusBusy(true);
    try {
      const status = await getSystemdDeployServiceStatus({ id: serviceId });
      setSystemdDetailStatus(status);
    } catch (invokeError) {
      setSystemdMessage(`读取服务状态失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
      setSystemdDetailStatus(null);
    } finally {
      setSystemdDetailStatusBusy(false);
    }
  }, []);

  const appendSystemdLogs = useCallback((lines: string[]) => {
    setSystemdDetailLogs((previous) => {
      const merged = [...previous, ...lines];
      if (merged.length <= SYSTEMD_LOG_MAX_LINES) {
        return merged;
      }
      return merged.slice(merged.length - SYSTEMD_LOG_MAX_LINES);
    });
  }, []);

  const flushPendingSystemdLogs = useCallback(() => {
    const queued = pendingSystemdLogLinesRef.current;
    if (queued.length === 0) {
      return;
    }
    pendingSystemdLogLinesRef.current = [];
    appendSystemdLogs(queued);
  }, [appendSystemdLogs]);

  const scheduleSystemdLogFlush = useCallback(() => {
    if (systemdLogFlushTimerRef.current !== null) {
      return;
    }
    systemdLogFlushTimerRef.current = window.setTimeout(() => {
      systemdLogFlushTimerRef.current = null;
      flushPendingSystemdLogs();
    }, SYSTEMD_LOG_FLUSH_INTERVAL_MS);
  }, [flushPendingSystemdLogs]);

  const flushSystemdLogBufferNow = useCallback(() => {
    if (systemdLogFlushTimerRef.current !== null) {
      window.clearTimeout(systemdLogFlushTimerRef.current);
      systemdLogFlushTimerRef.current = null;
    }
    flushPendingSystemdLogs();
  }, [flushPendingSystemdLogs]);

  const resetSystemdLogBuffer = useCallback(() => {
    pendingSystemdLogLinesRef.current = [];
    if (systemdLogFlushTimerRef.current !== null) {
      window.clearTimeout(systemdLogFlushTimerRef.current);
      systemdLogFlushTimerRef.current = null;
    }
  }, []);

  const loadSystemdDetailLogs = useCallback(async (serviceId: string, incremental: boolean, silent = false) => {
    if (!silent) {
      setSystemdDetailLogsBusy(true);
    }
    try {
      const result = await getSystemdDeployServiceLogs({
        id: serviceId,
        lines: SYSTEMD_LOG_FETCH_LINES,
        cursor: incremental ? systemdDetailLogsCursorRef.current ?? undefined : undefined
      });
      setSystemdDetailLogsCursor(result.cursor ?? null);
      if (incremental) {
        if (result.lines.length > 0) {
          if (silent && systemdDetailLogsRealtimeRef.current) {
            pendingSystemdLogLinesRef.current.push(...result.lines);
            scheduleSystemdLogFlush();
          } else {
            appendSystemdLogs(result.lines);
          }
        }
      } else {
        resetSystemdLogBuffer();
        const next = result.lines.length <= SYSTEMD_LOG_MAX_LINES
          ? result.lines
          : result.lines.slice(result.lines.length - SYSTEMD_LOG_MAX_LINES);
        setSystemdDetailLogs(next);
      }
    } catch (invokeError) {
      setSystemdMessage(`读取服务日志失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      if (!silent) {
        setSystemdDetailLogsBusy(false);
      }
    }
  }, [appendSystemdLogs, resetSystemdLogBuffer, scheduleSystemdLogFlush]);

  useEffect(() => {
    if (
      activeMenu !== 'systemd' ||
      systemdMode !== 'detail' ||
      !selectedSystemdDetailService ||
      !systemdDetailLogsRealtime
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void loadSystemdDetailLogs(selectedSystemdDetailService.id, true, true);
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeMenu, loadSystemdDetailLogs, selectedSystemdDetailService, systemdDetailLogsRealtime, systemdMode]);

  const onOpenSystemdDetail = (service: SystemdDeployService) => {
    setSystemdMessage(null);
    setSystemdMessageIsError(false);
    setSystemdDetailServiceId(service.id);
    setSystemdDetailStatus(null);
    resetSystemdLogBuffer();
    setSystemdDetailLogs([]);
    setSystemdDetailLogsCursor(null);
    setSystemdDetailLogsRealtime(false);
    setSystemdLogFilterKeywordDraft('');
    setSystemdLogFilterCaseSensitiveDraft(false);
    setSystemdLogFilterKeywordApplied('');
    setSystemdLogFilterCaseSensitiveApplied(false);
    setSystemdLogFullscreen(false);
    setSystemdMode('detail');
    void refreshSystemdDetailStatus(service.id);
  };

  const onBackSystemdList = () => {
    setSystemdDetailServiceId(null);
    setSystemdDetailStatus(null);
    setSystemdDetailAction(null);
    setSystemdImportPanelOpen(false);
    setSystemdRemoteServices([]);
    setSystemdSelectedRemoteServiceName('');
    setSystemdRemoteServiceKeyword('');
    resetSystemdLogBuffer();
    setSystemdDetailLogsBusy(false);
    setSystemdDetailLogsRealtime(false);
    setSystemdDetailLogs([]);
    setSystemdDetailLogsCursor(null);
    setSystemdLogFilterKeywordDraft('');
    setSystemdLogFilterCaseSensitiveDraft(false);
    setSystemdLogFilterKeywordApplied('');
    setSystemdLogFilterCaseSensitiveApplied(false);
    setSystemdLogFullscreen(false);
    setSystemdMode('list');
    void refreshSystemdList();
  };

  const onToggleSystemdRealtimeLogs = () => {
    if (!selectedSystemdDetailService || !canReadSystemdLogs) {
      return;
    }
    if (systemdDetailLogsRealtime) {
      flushSystemdLogBufferNow();
      setSystemdDetailLogsRealtime(false);
      return;
    }
    setSystemdDetailLogsRealtime(true);
    const shouldLoadSnapshot = systemdDetailLogs.length === 0 && !systemdDetailLogsCursorRef.current;
    void loadSystemdDetailLogs(selectedSystemdDetailService.id, !shouldLoadSnapshot, true);
  };

  const applySystemdLogFilter = useCallback(() => {
    setSystemdLogFilterKeywordApplied(systemdLogFilterKeywordDraft);
    setSystemdLogFilterCaseSensitiveApplied(systemdLogFilterCaseSensitiveDraft);
  }, [systemdLogFilterCaseSensitiveDraft, systemdLogFilterKeywordDraft]);

  const clearSystemdLogFilter = useCallback(() => {
    setSystemdLogFilterKeywordDraft('');
    setSystemdLogFilterCaseSensitiveDraft(false);
    setSystemdLogFilterKeywordApplied('');
    setSystemdLogFilterCaseSensitiveApplied(false);
  }, []);

  const clearLoadedSystemdLogs = useCallback(() => {
    resetSystemdLogBuffer();
    setSystemdDetailLogs([]);
  }, [resetSystemdLogBuffer]);

  const onDetailControlSystemd = async (action: 'start' | 'stop' | 'restart') => {
    if (!selectedSystemdDetailService) {
      return;
    }
    if (systemdDetailAction === 'delete') {
      return;
    }

    setSystemdDetailAction(action);
    setSystemdMessage(null);
    setSystemdMessageIsError(false);
    try {
      const result = await controlSystemdDeployService({ id: selectedSystemdDetailService.id, action });
      setSystemdDetailStatus(result.status);
      setSystemdMessage(`${selectedSystemdDetailService.service_name}.service ${action} 完成`);
      setSystemdMessageIsError(false);
    } catch (invokeError) {
      setSystemdMessage(`操作失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      setSystemdDetailAction(null);
    }
  };

  const requestDeleteSystemdFromList = (service: SystemdDeployService) => {
    if (systemdBusy) {
      return;
    }
    setSystemdDeleteDialog({
      id: service.id,
      name: service.name,
      from: 'list'
    });
  };

  const requestDeleteSystemdFromDetail = () => {
    if (!selectedSystemdDetailService || detailStatusActionDisabled) {
      return;
    }
    setSystemdDeleteDialog({
      id: selectedSystemdDetailService.id,
      name: selectedSystemdDetailService.name,
      from: 'detail'
    });
  };

  const onSubmitSystemdForm = async (mode: 'save' | 'save-and-deploy') => {
    if (systemdSubmitActionRef.current) {
      return;
    }
    if (systemdValidation) {
      setSystemdMessage(systemdValidation);
      setSystemdMessageIsError(true);
      return;
    }

    const environment: string[] = [];
    const lines = systemdForm.environmentText.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      if (!line.includes('=')) {
        setSystemdMessage(`环境变量第 ${index + 1} 行格式错误，应为 KEY=VALUE`);
        setSystemdMessageIsError(true);
        return;
      }
      environment.push(line);
    }

    const request: UpsertSystemdDeployServiceRequest = {
      id: systemdForm.id,
      profile_id: systemdForm.profileId,
      name: systemdForm.name.trim(),
      service_name: systemdForm.serviceName.trim(),
      description: systemdForm.description.trim() || undefined,
      working_dir: systemdForm.workingDir.trim(),
      exec_start: systemdForm.execStart.trim(),
      exec_stop: systemdForm.execStop.trim() || undefined,
      service_user: systemdForm.scope === 'system' ? systemdForm.serviceUser.trim() || undefined : undefined,
      environment: environment.length > 0 ? environment : undefined,
      enable_on_boot: systemdForm.enableOnBoot,
      scope: systemdForm.scope,
      use_sudo: systemdForm.scope === 'system' ? systemdForm.useSudo : false,
      log_output_mode: systemdForm.logOutputMode,
      log_output_path: systemdForm.logOutputMode === 'file' ? systemdForm.logOutputPath.trim() || undefined : undefined
    };

    systemdSubmitActionRef.current = mode;
    setSystemdSubmitAction(mode);
    setSystemdBusy(true);
    setSystemdMessage(mode === 'save' ? '正在保存...' : '正在保存并部署...');
    setSystemdMessageIsError(false);
    try {
      const saved = await upsertSystemdDeployService(request);
      if (!request.id) {
        setSystemdForm((previous) => ({ ...previous, id: saved.id }));
        setSystemdMode('edit');
      }
      if (mode === 'save-and-deploy') {
        await applySystemdDeployService({ id: saved.id });
        setSystemdMessage(`部署成功：${saved.service_name}.service`);
      } else {
        setSystemdMessage(`已保存部署服务：${saved.service_name}.service`);
      }
      setSystemdMessageIsError(false);
      setSystemdMode('list');
      await refreshSystemdList();
    } catch (invokeError) {
      setSystemdMessage(`操作失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      setSystemdBusy(false);
      systemdSubmitActionRef.current = null;
      setSystemdSubmitAction(null);
    }
  };

  const onConfirmDeleteSystemd = async () => {
    if (!systemdDeleteDialog) {
      return;
    }
    const { id, name, from } = systemdDeleteDialog;
    setSystemdDeleteDialog(null);

    if (from === 'detail') {
      setSystemdDetailAction('delete');
    } else {
      setSystemdDeletingServiceId(id);
    }
    setSystemdBusy(true);
    try {
      await deleteSystemdDeployService({ id });
      setSystemdMessage(`已删除部署服务：${name}`);
      setSystemdMessageIsError(false);
      if (from === 'detail') {
        onBackSystemdList();
      } else {
        await refreshSystemdList();
      }
    } catch (invokeError) {
      setSystemdMessage(`删除失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      if (from === 'detail') {
        setSystemdDetailAction(null);
      } else {
        setSystemdDeletingServiceId(null);
      }
      setSystemdBusy(false);
    }
  };

  const isDeleteConfirmBusy = systemdBusy && (systemdDetailAction === 'delete' || Boolean(systemdDeletingServiceId));

  return (
    <div className="servers-page">
      <aside className="servers-sidebar">
        <button
          type="button"
          className={activeMenu === 'servers' ? 'servers-nav-btn active' : 'servers-nav-btn'}
          onClick={() => setActiveMenu('servers')}
        >
          服务器
          <span>{profiles.length}</span>
        </button>
        <button
          type="button"
          className={activeMenu === 'settings' ? 'servers-nav-btn active' : 'servers-nav-btn'}
          onClick={() => setActiveMenu('settings')}
        >
          设置
        </button>
        <button
          type="button"
          className={activeMenu === 'systemd' ? 'servers-nav-btn active' : 'servers-nav-btn'}
          onClick={() => {
            setActiveMenu('systemd');
            setSystemdMode('list');
          }}
        >
          systemd部署
        </button>
      </aside>

      <section className="servers-content">
        {activeMenu === 'servers' ? (
          <>
            <div className="section-header">
              <h2>服务器列表</h2>
              <div className="section-actions">
                <button type="button" onClick={onRefreshProfiles} disabled={profilesBusy}>
                  刷新列表
                </button>
                <button type="button" onClick={onOpenCreateEditor} disabled={profilesBusy}>
                  新增服务器
                </button>
              </div>
            </div>

            <p className="status-line">活动会话：{connectedCount}</p>
            {profileMessage && <p className="status-line">{profileMessage}</p>}

            <div className="host-grid">
              <article className="host-card local-terminal-card">
                <header className="host-card-header">
                  <div>
                    <h3>本地终端</h3>
                    <p className="local-terminal-meta">在当前设备打开本地 shell，会话支持多开</p>
                  </div>
                  <span className="chip">Local</span>
                </header>

                <div className="card-actions">
                  <button type="button" onClick={onConnectLocalTerminal}>
                    打开终端
                  </button>
                </div>
              </article>

              {profiles.length === 0 && <div className="empty-state host-empty">暂无服务器配置，点击“新增服务器”创建。</div>}

              {profiles.map((profile) => (
                <article key={profile.id} className="host-card">
                  <header className="host-card-header">
                    <div>
                      <h3>{profile.name}</h3>
                      <p>
                        {profile.username}@{profile.host}:{profile.port}
                      </p>
                    </div>
                    <span className="chip">{profile.auth_kind === 'password' ? '密码' : '私钥'}</span>
                  </header>

                  <div className="card-actions">
                    <button type="button" onClick={() => onConnectProfile(profile)}>
                      连接
                    </button>
                    <button type="button" onClick={() => onOpenEditEditor(profile)} disabled={profilesBusy}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onDeleteProfile(profile)}
                      disabled={profilesBusy}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : activeMenu === 'systemd' ? (
          <section className={systemdMode === 'list' ? 'systemd-panel' : 'systemd-panel systemd-panel-form'}>
            {systemdMode === 'list' ? (
              <>
                <div className="section-header">
                  <h2>systemd 部署服务</h2>
                  <div className="section-actions">
                    <button type="button" onClick={() => void refreshSystemdList()} disabled={systemdBusy}>
                      刷新
                    </button>
                    <button type="button" onClick={onStartCreateSystemd} disabled={profiles.length === 0 || systemdBusy}>
                      新增部署服务
                    </button>
                  </div>
                </div>

                {systemdMessage && (
                  <p className={systemdMessageIsError ? 'status-line error' : 'status-line'}>{systemdMessage}</p>
                )}

                {systemdServices.length === 0 ? (
                  <div className="empty-state">暂无部署服务，点击“新增部署服务”创建。</div>
                ) : (
                  <div className="systemd-service-grid">
                    {systemdServices.map((service) => {
                      return (
                        <article
                          key={service.id}
                          className={systemdBusy ? 'host-card systemd-service-card' : 'host-card systemd-service-card clickable'}
                          role="button"
                          tabIndex={systemdBusy ? -1 : 0}
                          onClick={() => {
                            if (!systemdBusy) {
                              onOpenSystemdDetail(service);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (systemdBusy) {
                              return;
                            }
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onOpenSystemdDetail(service);
                            }
                          }}
                        >
                          <header className="host-card-header">
                            <div>
                              <h3>{service.name}</h3>
                              <p>
                                {service.service_name}.service · {profileNameMap.get(service.profile_id) ?? '未知服务器'}
                              </p>
                            </div>
                          </header>

                          <p className="systemd-service-meta">
                            Scope: {service.scope} · 自启: {service.enable_on_boot ? '是' : '否'}
                          </p>

                          <div className="card-actions">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenSystemdDetail(service);
                              }}
                              disabled={systemdBusy}
                            >
                              详情
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onEditSystemd(service);
                              }}
                              disabled={systemdBusy}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={(event) => {
                                event.stopPropagation();
                                requestDeleteSystemdFromList(service);
                              }}
                              disabled={systemdBusy}
                            >
                              {systemdDeletingServiceId === service.id ? '删除中...' : '删除'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            ) : systemdMode === 'detail' ? (
              <>
                <div className="systemd-form-header">
                  <button
                    type="button"
                    className="systemd-back-icon-btn"
                    onClick={onBackSystemdList}
                    disabled={detailBackDisabled}
                    aria-label="返回列表"
                    title="返回列表"
                  >
                    <svg className="systemd-back-icon" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M10.5 3.5L6 8l4.5 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="systemd-back-label">返回</span>
                  </button>
                  <h2>部署服务详情</h2>
                  <div className="section-actions">
                    {selectedSystemdDetailService && (
                      <>
                        <button
                          type="button"
                          onClick={() => onEditSystemd(selectedSystemdDetailService)}
                          disabled={detailStatusActionDisabled}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDetailControlSystemd('start')}
                          disabled={!canDetailStart}
                        >
                          {systemdDetailAction === 'start' ? '启动中...' : '启动'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDetailControlSystemd('stop')}
                          disabled={!canDetailStop}
                        >
                          {systemdDetailAction === 'stop' ? '停止中...' : '停止'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDetailControlSystemd('restart')}
                          disabled={detailStatusActionDisabled}
                        >
                          {systemdDetailAction === 'restart' ? '重启中...' : '重启'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void refreshSystemdDetailStatus(selectedSystemdDetailService.id)}
                          disabled={detailStatusActionDisabled}
                        >
                          {systemdDetailStatusBusy ? '刷新中...' : '刷新状态'}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={requestDeleteSystemdFromDetail}
                          disabled={detailStatusActionDisabled}
                        >
                          {systemdDetailAction === 'delete' ? '删除中...' : '删除'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="systemd-form-scroll">
                  {systemdMessage && (
                    <p className={systemdMessageIsError ? 'status-line error' : 'status-line'}>{systemdMessage}</p>
                  )}

                  {!selectedSystemdDetailService ? (
                    <div className="empty-state">服务不存在或已删除，请返回列表刷新。</div>
                  ) : (
                    <div className="systemd-detail-grid">
                      <article className="host-card">
                        <header className="host-card-header">
                          <div>
                            <h3>{selectedSystemdDetailService.name}</h3>
                            <p>{selectedSystemdDetailService.service_name}.service</p>
                          </div>
                        </header>
                        <p className="systemd-service-meta">
                          服务器：{profileNameMap.get(selectedSystemdDetailService.profile_id) ?? '未知服务器'}
                        </p>
                        <p className="systemd-service-meta">Scope：{selectedSystemdDetailService.scope}</p>
                        <p className="systemd-service-meta">
                          开机自启：{selectedSystemdDetailService.enable_on_boot ? '是' : '否'}
                        </p>
                        <p className="systemd-service-meta">
                          日志输出：{systemdLogOutputModeLabel(selectedSystemdDetailService.log_output_mode)}
                        </p>
                        <p className="systemd-service-meta">
                          日志地址：{systemdLogOutputPathLabel(selectedSystemdDetailService)}
                        </p>
                        <p className="systemd-service-meta">工作目录：{selectedSystemdDetailService.working_dir}</p>
                      </article>

                      <article className="host-card">
                        <header className="host-card-header">
                          <div>
                            <h3>运行状态</h3>
                            <p>进入详情页时自动查询</p>
                          </div>
                        </header>
                        {systemdDetailStatus ? (
                          <>
                            <p className="systemd-service-meta">Summary：{systemdDetailStatus.summary}</p>
                            <p className="systemd-service-meta">ActiveState：{systemdDetailStatus.active_state}</p>
                            <p className="systemd-service-meta">SubState：{systemdDetailStatus.sub_state}</p>
                            <p className="systemd-service-meta">UnitFileState：{systemdDetailStatus.unit_file_state}</p>
                            <p className="systemd-service-meta">
                              CheckedAt：{new Date(systemdDetailStatus.checked_at * 1000).toLocaleString()}
                            </p>
                          </>
                        ) : (
                          <p className="systemd-service-meta">{systemdDetailStatusBusy ? '正在查询状态...' : '暂无状态信息'}</p>
                        )}
                      </article>

                      <article className="host-card systemd-detail-code-card">
                        <header className="host-card-header">
                          <div>
                            <h3>启动命令</h3>
                          </div>
                        </header>
                        <code className="systemd-example-code">{selectedSystemdDetailService.exec_start}</code>
                        {selectedSystemdDetailService.exec_stop && (
                          <>
                            <p className="systemd-service-meta">停止命令</p>
                            <code className="systemd-example-code">{selectedSystemdDetailService.exec_stop}</code>
                          </>
                        )}
                      </article>

                      <article className="host-card systemd-detail-code-card">
                        <header className="host-card-header">
                          <div>
                            <h3>服务输出日志</h3>
                            <p>支持增量读取与实时日志</p>
                          </div>
                          <div className="card-actions systemd-log-actions">
                            <button
                              type="button"
                              onClick={() => void loadSystemdDetailLogs(selectedSystemdDetailService.id, false)}
                              disabled={systemdDetailLogsBusy || !canReadSystemdLogs}
                            >
                              {systemdDetailLogsBusy ? '读取中...' : '查看日志'}
                            </button>
                            <button type="button" onClick={onToggleSystemdRealtimeLogs} disabled={!canReadSystemdLogs}>
                              {systemdDetailLogsRealtime ? '停止实时日志' : '开启实时日志'}
                            </button>
                            <button type="button" onClick={clearLoadedSystemdLogs} disabled={!canReadSystemdLogs}>
                              清空当前日志
                            </button>
                            <button type="button" onClick={() => setSystemdLogFullscreen(true)} disabled={!canReadSystemdLogs}>
                              全屏查看
                            </button>
                          </div>
                        </header>
                        <div className="systemd-log-filter">
                          <input
                            className="systemd-log-filter-input"
                            value={systemdLogFilterKeywordDraft}
                            onChange={(event) => setSystemdLogFilterKeywordDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                applySystemdLogFilter();
                              }
                            }}
                            placeholder="关键字过滤当前已加载日志"
                            {...textInputProps}
                          />
                          <button
                            type="button"
                            onClick={applySystemdLogFilter}
                            disabled={!isSystemdLogFilterDirty}
                          >
                            过滤
                          </button>
                          <button
                            type="button"
                            onClick={clearSystemdLogFilter}
                            disabled={!systemdLogFilterKeywordDraft && !hasAppliedSystemdLogFilter}
                          >
                            清空
                          </button>
                          <label className="systemd-log-filter-toggle">
                            <input
                              type="checkbox"
                              checked={systemdLogFilterCaseSensitiveDraft}
                              onChange={(event) => setSystemdLogFilterCaseSensitiveDraft(event.target.checked)}
                            />
                            区分大小写
                          </label>
                        </div>
                        {filteredSystemdDetailLogs.length > 0 ? (
                          <pre ref={systemdLogPanelRef} className="systemd-log">{highlightedSystemdLogNodes}</pre>
                        ) : !canReadSystemdLogs ? (
                          <p className="systemd-service-meta">当前服务已配置为不输出日志。</p>
                        ) : hasAppliedSystemdLogFilter ? (
                          <p className="systemd-service-meta">未匹配到过滤结果，可清空关键字后重试。</p>
                        ) : (
                          <p className="systemd-service-meta">
                            {systemdDetailLogsBusy ? '正在读取日志...' : '暂无日志输出，可点击“查看日志”加载。'}
                          </p>
                        )}
                      </article>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="systemd-form-header">
                  <button
                    type="button"
                    className="systemd-back-icon-btn"
                    onClick={onBackSystemdList}
                    disabled={systemdBusy}
                    aria-label="返回列表"
                    title="返回列表"
                  >
                    <svg className="systemd-back-icon" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M10.5 3.5L6 8l4.5 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="systemd-back-label">返回</span>
                  </button>
                  <h2>{systemdMode === 'create' ? '新增部署服务' : '编辑部署服务'}</h2>
                  <div className="section-actions">
                    {systemdMode === 'create' && (
                      <button
                        type="button"
                        onClick={onOpenSystemdImportPanel}
                        disabled={systemdBusy || systemdRemoteServicesBusy || systemdImportBusy || profiles.length === 0}
                      >
                        从已有服务导入
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void onSubmitSystemdForm('save')}
                      disabled={systemdBusy || Boolean(systemdValidation)}
                    >
                      {systemdSubmitAction === 'save' ? '保存中...' : '仅保存'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSubmitSystemdForm('save-and-deploy')}
                      disabled={systemdBusy || Boolean(systemdValidation)}
                    >
                      {systemdSubmitAction === 'save-and-deploy' ? '部署中...' : '保存并部署'}
                    </button>
                  </div>
                </div>

                <div className="systemd-form-scroll">
                  <p className="status-line">可选择“仅保存”或“保存并部署”（生成/更新 unit + daemon-reload + enable(可选) + restart）。</p>
                  {systemdMessage && (
                    <p className={systemdMessageIsError ? 'status-line error' : 'status-line'}>{systemdMessage}</p>
                  )}
                  {systemdImportPanelOpen && (
                    <article className="host-card systemd-import-panel">
                      <header className="host-card-header">
                        <div>
                          <h3>从现有 systemd 服务导入</h3>
                          <p>将读取目标服务器当前 scope 下已存在的服务配置并填充表单</p>
                        </div>
                        <div className="card-actions">
                          <button
                            type="button"
                            onClick={() => void loadRemoteSystemdServiceList()}
                            disabled={systemdRemoteServicesBusy || systemdImportBusy}
                          >
                            {systemdRemoteServicesBusy ? '加载中...' : '刷新列表'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSystemdImportPanelOpen(false)}
                            disabled={systemdImportBusy}
                          >
                            关闭
                          </button>
                        </div>
                      </header>

                      {systemdRemoteServices.length === 0 ? (
                        <p className="systemd-service-meta">未发现可导入的自建服务（仅展示常见用户自建目录下的服务）。</p>
                      ) : (
                        <>
                          <label className="field-label">
                            搜索服务
                            <input
                              value={systemdRemoteServiceKeyword}
                              onChange={(event) => setSystemdRemoteServiceKeyword(event.target.value)}
                              placeholder="输入服务名或状态关键字"
                              disabled={systemdRemoteServicesBusy || systemdImportBusy}
                              {...textInputProps}
                            />
                          </label>
                          {filteredSystemdRemoteServices.length === 0 ? (
                            <p className="systemd-service-meta">未匹配到服务，请调整搜索关键字。</p>
                          ) : (
                            <label className="field-label">
                              选择已有服务
                              <select
                                value={systemdSelectedRemoteServiceName}
                                onChange={(event) => setSystemdSelectedRemoteServiceName(event.target.value)}
                                disabled={systemdRemoteServicesBusy || systemdImportBusy}
                              >
                                {filteredSystemdRemoteServices.map((item) => {
                                  const alreadyAdded = existingSystemdServiceNameSet.has(
                                    normalizeComparableServiceName(item.service_name)
                                  );
                                  return (
                                    <option key={item.service_name} value={item.service_name}>
                                      {item.service_name}.service ({item.unit_file_state})
                                      {alreadyAdded ? ' · 已添加' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                              {selectedRemoteServiceAlreadyAdded && (
                                <span className="systemd-import-hint">该服务已在本地部署列表中（已添加）。</span>
                              )}
                            </label>
                          )}
                        </>
                      )}

                      <div className="card-actions">
                        <button
                          type="button"
                          onClick={() => void onImportRemoteSystemdService()}
                          disabled={!systemdSelectedRemoteServiceName || systemdRemoteServicesBusy || systemdImportBusy}
                        >
                          {systemdImportBusy ? '导入中...' : '导入配置到表单'}
                        </button>
                      </div>
                    </article>
                  )}

                  <div className="systemd-form-grid">
                    <label className="field-label">
                      部署名称
                    <input
                      value={systemdForm.name}
                      onChange={(event) => setSystemdForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="如：生产环境 Web API"
                      disabled={systemdBusy}
                      {...textInputProps}
                    />
                  </label>

                    <label className="field-label">
                      目标服务器
                      <select
                        value={systemdForm.profileId}
                        onChange={(event) => {
                          const nextProfile = profiles.find((item) => item.id === event.target.value);
                          setSystemdForm((prev) => ({
                            ...prev,
                            profileId: event.target.value,
                            serviceUser: nextProfile?.username ?? prev.serviceUser
                          }));
                        }}
                        disabled={profiles.length === 0 || systemdBusy}
                      >
                        {profiles.length === 0 && <option value="">暂无服务器</option>}
                        {profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name} ({profile.username}@{profile.host})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-label">
                      服务名
                    <input
                      value={systemdForm.serviceName}
                      onChange={(event) => {
                        const nextServiceName = event.target.value;
                        setSystemdForm((prev) => {
                          const prevDefaultPath = defaultSystemdLogOutputPath(prev.serviceName);
                          const shouldSyncPath = !prev.logOutputPath.trim() || prev.logOutputPath === prevDefaultPath;
                          return {
                            ...prev,
                            serviceName: nextServiceName,
                            logOutputPath: shouldSyncPath
                              ? defaultSystemdLogOutputPath(nextServiceName)
                              : prev.logOutputPath
                          };
                        });
                      }}
                      placeholder="my-app"
                      disabled={systemdBusy}
                      aria-invalid={Boolean(systemdServiceNameValidationMessage)}
                      {...textInputProps}
                    />
                    {systemdServiceNameValidationMessage && (
                      <span className="field-error-text">{systemdServiceNameValidationMessage}</span>
                    )}
                  </label>

                    <label className="field-label">
                      部署范围
                      <select
                        value={systemdForm.scope}
                        onChange={(event) => setSystemdForm((prev) => ({ ...prev, scope: event.target.value as SystemdScope }))}
                        disabled={systemdBusy}
                      >
                        <option value="system">system</option>
                        <option value="user">user</option>
                      </select>
                    </label>

                    <label className="field-label">
                      日志输出
                      <select
                        value={systemdForm.logOutputMode}
                        onChange={(event) => {
                          const mode = event.target.value as SystemdLogOutputMode;
                          setSystemdForm((prev) => ({
                            ...prev,
                            logOutputMode: mode,
                            logOutputPath:
                              mode === 'file'
                                ? prev.logOutputPath.trim() || defaultSystemdLogOutputPath(prev.serviceName)
                                : prev.logOutputPath
                          }));
                        }}
                        disabled={systemdBusy}
                      >
                        {SYSTEMD_LOG_OUTPUT_MODE_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-label">
                      日志文件路径
                    <input
                      value={systemdForm.logOutputPath}
                      onChange={(event) => setSystemdForm((prev) => ({ ...prev, logOutputPath: event.target.value }))}
                      placeholder={defaultSystemdLogOutputPath(systemdForm.serviceName)}
                      disabled={systemdBusy || systemdForm.logOutputMode !== 'file'}
                      {...textInputProps}
                    />
                  </label>

                    <label className="field-label systemd-form-span">
                      描述
                    <input
                      value={systemdForm.description}
                      onChange={(event) => setSystemdForm((prev) => ({ ...prev, description: event.target.value }))}
                      placeholder="Managed by Castor"
                      disabled={systemdBusy}
                      {...textInputProps}
                    />
                  </label>

                    <label className="field-label systemd-form-span">
                      工作目录
                    <input
                      value={systemdForm.workingDir}
                      onChange={(event) => setSystemdForm((prev) => ({ ...prev, workingDir: event.target.value }))}
                      placeholder="/opt/my-app"
                      disabled={systemdBusy}
                      {...textInputProps}
                    />
                  </label>

                    <label className="field-label systemd-form-span">
                      ExecStart
                      <div className="systemd-service-type-list" role="group" aria-label="服务类型">
                        {SYSTEMD_SERVICE_TYPES.map((type) => (
                          <button
                            key={type}
                            type="button"
                            className={systemdForm.serviceType === type ? 'systemd-service-type-btn active' : 'systemd-service-type-btn'}
                            onClick={() => setSystemdForm((prev) => ({ ...prev, serviceType: type }))}
                            disabled={systemdBusy}
                          >
                            {SYSTEMD_EXECSTART_EXAMPLES[type].label}
                          </button>
                        ))}
                      </div>
                      <input
                        className="systemd-execstart-input"
                        value={systemdForm.execStart}
                        onChange={(event) => setSystemdForm((prev) => ({ ...prev, execStart: event.target.value }))}
                        placeholder={firstExecStartExample(systemdForm.serviceType) || '/usr/bin/node /opt/my-app/server.js'}
                        disabled={systemdBusy}
                        {...textInputProps}
                      />
                      <div className="systemd-example-box">
                        <p className="systemd-example-title">示例命令（{selectedServiceTypeExamples.label}）</p>
                        {selectedServiceTypeExamples.examples.map((example) => (
                          <code key={example} className="systemd-example-code">
                            {example}
                          </code>
                        ))}
                      </div>
                    </label>

                    <label className="field-label systemd-form-span">
                      ExecStop (可选)
                      <input
                        value={systemdForm.execStop}
                        onChange={(event) => setSystemdForm((prev) => ({ ...prev, execStop: event.target.value }))}
                        placeholder="/bin/kill -s SIGTERM $MAINPID"
                        disabled={systemdBusy}
                        {...textInputProps}
                      />
                    </label>

                    <label className="field-label">
                      运行用户
                      <input
                        value={systemdForm.serviceUser}
                        onChange={(event) => setSystemdForm((prev) => ({ ...prev, serviceUser: event.target.value }))}
                        placeholder={selectedSystemdProfile?.username ?? 'root'}
                        disabled={systemdBusy || systemdForm.scope === 'user'}
                        {...textInputProps}
                      />
                    </label>
                  </div>

                  <label className="field-label systemd-form-span">
                    环境变量 (每行 `KEY=VALUE`)
                    <textarea
                      rows={5}
                      value={systemdForm.environmentText}
                      onChange={(event) => setSystemdForm((prev) => ({ ...prev, environmentText: event.target.value }))}
                      placeholder={'NODE_ENV=production\nPORT=3000'}
                      disabled={systemdBusy}
                      {...textInputProps}
                    />
                  </label>

                  <div className="systemd-options">
                    <label className="systemd-option">
                      <input
                        type="checkbox"
                        checked={systemdForm.enableOnBoot}
                        onChange={(event) => setSystemdForm((prev) => ({ ...prev, enableOnBoot: event.target.checked }))}
                        disabled={systemdBusy}
                      />
                      开机自启
                    </label>
                    <label className="systemd-option">
                      <input
                        type="checkbox"
                        checked={systemdForm.useSudo}
                        onChange={(event) => setSystemdForm((prev) => ({ ...prev, useSudo: event.target.checked }))}
                        disabled={systemdBusy || systemdForm.scope === 'user'}
                      />
                      使用 sudo
                    </label>
                  </div>
                </div>
              </>
            )}
          </section>
        ) : (
          <div className="empty-state">设置内容将在这里展示。</div>
        )}
      </section>

      {systemdLogFullscreen && selectedSystemdDetailService && (
        <div className="systemd-log-fullscreen-overlay" role="dialog" aria-modal="true" aria-label="全屏查看日志">
          <div className="systemd-log-fullscreen-modal">
            <div className="systemd-log-fullscreen-header">
              <div>
                <h3>{selectedSystemdDetailService.service_name}.service</h3>
                <p>按 Esc 可退出全屏</p>
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  onClick={() => void loadSystemdDetailLogs(selectedSystemdDetailService.id, false)}
                  disabled={systemdDetailLogsBusy || !canReadSystemdLogs}
                >
                  {systemdDetailLogsBusy ? '读取中...' : '查看日志'}
                </button>
                <button type="button" onClick={onToggleSystemdRealtimeLogs} disabled={!canReadSystemdLogs}>
                  {systemdDetailLogsRealtime ? '停止实时日志' : '开启实时日志'}
                </button>
                <button type="button" onClick={clearLoadedSystemdLogs} disabled={!canReadSystemdLogs}>
                  清空当前日志
                </button>
                <button type="button" onClick={() => setSystemdLogFullscreen(false)}>
                  关闭全屏
                </button>
              </div>
            </div>

            <div className="systemd-log-filter systemd-log-filter-fullscreen">
              <input
                className="systemd-log-filter-input"
                value={systemdLogFilterKeywordDraft}
                onChange={(event) => setSystemdLogFilterKeywordDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    applySystemdLogFilter();
                  }
                }}
                placeholder="关键字过滤当前已加载日志"
                {...textInputProps}
              />
              <button
                type="button"
                onClick={applySystemdLogFilter}
                disabled={!isSystemdLogFilterDirty}
              >
                过滤
              </button>
              <button
                type="button"
                onClick={clearSystemdLogFilter}
                disabled={!systemdLogFilterKeywordDraft && !hasAppliedSystemdLogFilter}
              >
                清空
              </button>
              <label className="systemd-log-filter-toggle">
                <input
                  type="checkbox"
                  checked={systemdLogFilterCaseSensitiveDraft}
                  onChange={(event) => setSystemdLogFilterCaseSensitiveDraft(event.target.checked)}
                />
                区分大小写
              </label>
            </div>

            {filteredSystemdDetailLogs.length > 0 ? (
              <pre ref={systemdLogFullscreenRef} className="systemd-log systemd-log-fullscreen">
                {highlightedSystemdLogNodes}
              </pre>
            ) : !canReadSystemdLogs ? (
              <p className="systemd-service-meta systemd-log-fullscreen-empty">当前服务已配置为不输出日志。</p>
            ) : hasAppliedSystemdLogFilter ? (
              <p className="systemd-service-meta systemd-log-fullscreen-empty">未匹配到过滤结果，可清空关键字后重试。</p>
            ) : (
              <p className="systemd-service-meta systemd-log-fullscreen-empty">
                {systemdDetailLogsBusy ? '正在读取日志...' : '暂无日志输出，可点击“查看日志”加载。'}
              </p>
            )}
          </div>
        </div>
      )}

      {systemdDeleteDialog && (
        <div className="systemd-confirm-overlay" role="dialog" aria-modal="true" aria-label="确认删除部署服务">
          <div className="systemd-confirm-modal">
            <h3>确认删除</h3>
            <p>将删除部署服务“{systemdDeleteDialog.name}”，并尝试卸载远端 systemd unit。该操作不可撤销。</p>
            <div className="card-actions systemd-confirm-actions">
              <button
                type="button"
                onClick={() => setSystemdDeleteDialog(null)}
                disabled={isDeleteConfirmBusy}
              >
                取消
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void onConfirmDeleteSystemd()}
                disabled={isDeleteConfirmBusy}
              >
                {isDeleteConfirmBusy ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
