import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  SYSTEMD_EXECSTART_EXAMPLES,
  SYSTEMD_LOG_FETCH_LINES,
  SYSTEMD_LOG_FLUSH_INTERVAL_MS,
  SYSTEMD_LOG_MAX_LINES,
  SYSTEMD_LOG_OUTPUT_MODE_OPTIONS,
  SYSTEMD_SERVICE_TYPES
} from './systemd/constants';
import {
  buildHighlightedLogSegments,
  defaultSystemdLogOutputPath,
  firstExecStartExample,
  inferServiceType,
  normalizeComparableServiceName
} from './systemd/helpers';
import {
  SystemdDeleteConfirmDialog,
  SystemdDetailPanel,
  SystemdFormHeader,
  SystemdListPanel,
  SystemdLogFullscreenModal
} from './systemd/SystemdPanelPartials';
import type { SystemdDeleteDialogState, SystemdFormState } from './systemd/types';

type SystemdDeployPanelProps = {
  profiles: ConnectionProfile[];
};

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

export function SystemdDeployPanel({ profiles }: SystemdDeployPanelProps) {
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
    if (systemdMode === 'list') {
      void refreshSystemdList();
    }
  }, [refreshSystemdList, systemdMode]);

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
    if (systemdMode !== 'detail' || !selectedSystemdDetailService || !systemdDetailLogsRealtime) {
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
  }, [loadSystemdDetailLogs, selectedSystemdDetailService, systemdDetailLogsRealtime, systemdMode]);

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
      from: 'list',
      localOnly: false
    });
  };

  const requestDeleteSystemdFromDetail = () => {
    if (!selectedSystemdDetailService || detailStatusActionDisabled) {
      return;
    }
    setSystemdDeleteDialog({
      id: selectedSystemdDetailService.id,
      name: selectedSystemdDetailService.name,
      from: 'detail',
      localOnly: false
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
    const { id, name, from, localOnly } = systemdDeleteDialog;
    setSystemdDeleteDialog(null);

    if (from === 'detail') {
      setSystemdDetailAction('delete');
    } else {
      setSystemdDeletingServiceId(id);
    }
    setSystemdBusy(true);
    try {
      await deleteSystemdDeployService({ id, remove_remote: !localOnly });
      setSystemdMessage(localOnly ? `已删除本地配置：${name}` : `已删除部署服务：${name}`);
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
    <>
      <section className={systemdMode === 'list' ? 'systemd-panel' : 'systemd-panel systemd-panel-form'}>
        {systemdMode === 'list' ? (
          <SystemdListPanel
            profilesCount={profiles.length}
            systemdBusy={systemdBusy}
            systemdMessage={systemdMessage}
            systemdMessageIsError={systemdMessageIsError}
            systemdServices={systemdServices}
            profileNameMap={profileNameMap}
            systemdDeletingServiceId={systemdDeletingServiceId}
            onRefreshSystemdList={refreshSystemdList}
            onStartCreateSystemd={onStartCreateSystemd}
            onOpenSystemdDetail={onOpenSystemdDetail}
            onEditSystemd={onEditSystemd}
            requestDeleteSystemdFromList={requestDeleteSystemdFromList}
          />
        ) : systemdMode === 'detail' ? (
          <SystemdDetailPanel
            selectedSystemdDetailService={selectedSystemdDetailService}
            detailBackDisabled={detailBackDisabled}
            detailStatusActionDisabled={detailStatusActionDisabled}
            canDetailStart={canDetailStart}
            canDetailStop={canDetailStop}
            systemdDetailAction={systemdDetailAction}
            systemdDetailStatusBusy={systemdDetailStatusBusy}
            systemdDetailStatus={systemdDetailStatus}
            systemdMessage={systemdMessage}
            systemdMessageIsError={systemdMessageIsError}
            profileNameMap={profileNameMap}
            canReadSystemdLogs={canReadSystemdLogs}
            systemdDetailLogsBusy={systemdDetailLogsBusy}
            systemdDetailLogsRealtime={systemdDetailLogsRealtime}
            filteredSystemdDetailLogs={filteredSystemdDetailLogs}
            highlightedSystemdLogNodes={highlightedSystemdLogNodes}
            hasAppliedSystemdLogFilter={hasAppliedSystemdLogFilter}
            isSystemdLogFilterDirty={isSystemdLogFilterDirty}
            systemdLogFilterKeywordDraft={systemdLogFilterKeywordDraft}
            systemdLogFilterCaseSensitiveDraft={systemdLogFilterCaseSensitiveDraft}
            textInputProps={textInputProps}
            systemdLogPanelRef={systemdLogPanelRef}
            onBackSystemdList={onBackSystemdList}
            onEditSystemd={onEditSystemd}
            onDetailControlSystemd={onDetailControlSystemd}
            refreshSystemdDetailStatus={refreshSystemdDetailStatus}
            requestDeleteSystemdFromDetail={requestDeleteSystemdFromDetail}
            loadSystemdDetailLogs={loadSystemdDetailLogs}
            onToggleSystemdRealtimeLogs={onToggleSystemdRealtimeLogs}
            clearLoadedSystemdLogs={clearLoadedSystemdLogs}
            setSystemdLogFullscreen={(open) => setSystemdLogFullscreen(open)}
            setSystemdLogFilterKeywordDraft={(value) => setSystemdLogFilterKeywordDraft(value)}
            setSystemdLogFilterCaseSensitiveDraft={(value) => setSystemdLogFilterCaseSensitiveDraft(value)}
            applySystemdLogFilter={applySystemdLogFilter}
            clearSystemdLogFilter={clearSystemdLogFilter}
          />
        ) : (
          <>
            <SystemdFormHeader
              mode={systemdMode}
              systemdBusy={systemdBusy}
              systemdValidation={systemdValidation}
              systemdSubmitAction={systemdSubmitAction}
              systemdRemoteServicesBusy={systemdRemoteServicesBusy}
              systemdImportBusy={systemdImportBusy}
              profiles={profiles}
              onBackSystemdList={onBackSystemdList}
              onOpenSystemdImportPanel={onOpenSystemdImportPanel}
              onSubmitSystemdForm={onSubmitSystemdForm}
            />

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

      <SystemdLogFullscreenModal
        open={systemdLogFullscreen}
        selectedSystemdDetailService={selectedSystemdDetailService}
        canReadSystemdLogs={canReadSystemdLogs}
        systemdDetailLogsBusy={systemdDetailLogsBusy}
        systemdDetailLogsRealtime={systemdDetailLogsRealtime}
        systemdLogFilterKeywordDraft={systemdLogFilterKeywordDraft}
        systemdLogFilterCaseSensitiveDraft={systemdLogFilterCaseSensitiveDraft}
        isSystemdLogFilterDirty={isSystemdLogFilterDirty}
        hasAppliedSystemdLogFilter={hasAppliedSystemdLogFilter}
        filteredSystemdDetailLogs={filteredSystemdDetailLogs}
        highlightedSystemdLogNodes={highlightedSystemdLogNodes}
        textInputProps={textInputProps}
        systemdLogFullscreenRef={systemdLogFullscreenRef}
        loadSystemdDetailLogs={loadSystemdDetailLogs}
        onToggleSystemdRealtimeLogs={onToggleSystemdRealtimeLogs}
        clearLoadedSystemdLogs={clearLoadedSystemdLogs}
        setSystemdLogFullscreen={(open) => setSystemdLogFullscreen(open)}
        setSystemdLogFilterKeywordDraft={(value) => setSystemdLogFilterKeywordDraft(value)}
        setSystemdLogFilterCaseSensitiveDraft={(value) => setSystemdLogFilterCaseSensitiveDraft(value)}
        applySystemdLogFilter={applySystemdLogFilter}
        clearSystemdLogFilter={clearSystemdLogFilter}
      />

      <SystemdDeleteConfirmDialog
        systemdDeleteDialog={systemdDeleteDialog}
        isDeleteConfirmBusy={isDeleteConfirmBusy}
        setSystemdDeleteDialog={setSystemdDeleteDialog}
        onConfirmDeleteSystemd={onConfirmDeleteSystemd}
      />
    </>
  );
}
