import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySystemdDeployService,
  controlSystemdDeployService,
  deleteSystemdDeployService,
  getRemoteSystemdServiceTemplate,
  getSystemdDeployServiceStatus,
  listRemoteSystemdServices,
  listSystemdDeployServices,
  upsertSystemdDeployService
} from '../api/profiles';
import { formatInvokeError } from '../helpers';
import { SYSTEMD_EXECSTART_EXAMPLES } from '../../components/systemd/constants';
import {
  defaultSystemdLogOutputPath,
  inferServiceType,
  normalizeComparableServiceName
} from '../../components/systemd/helpers';
import type { SystemdDeleteDialogState, SystemdFormState } from '../../components/systemd/types';
import { useSystemdLogs } from './systemd/useSystemdLogs';
import type {
  ConnectionProfile,
  RemoteSystemdServiceItem,
  SystemdDeployService,
  SystemdLogOutputMode,
  SystemdScope,
  SystemdServiceStatus,
  UpsertSystemdDeployServiceRequest
} from '../../types';

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

export function useSystemdDeploy(profiles: ConnectionProfile[]) {
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
  const [systemdMessage, setSystemdMessage] = useState<string | null>(null);
  const [systemdMessageIsError, setSystemdMessageIsError] = useState(false);
  const [systemdSubmitAction, setSystemdSubmitAction] = useState<'save' | 'save-and-deploy' | null>(null);
  const [systemdImportPanelOpen, setSystemdImportPanelOpen] = useState(false);
  const [systemdRemoteServicesBusy, setSystemdRemoteServicesBusy] = useState(false);
  const [systemdImportBusy, setSystemdImportBusy] = useState(false);
  const [systemdRemoteServices, setSystemdRemoteServices] = useState<RemoteSystemdServiceItem[]>([]);
  const [systemdSelectedRemoteServiceName, setSystemdSelectedRemoteServiceName] = useState('');
  const [systemdRemoteServiceKeyword, setSystemdRemoteServiceKeyword] = useState('');
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
      return item.service_name.toLowerCase().includes(keyword) || item.unit_file_state.toLowerCase().includes(keyword);
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
        (item) => item.id !== systemdForm.id && normalizeComparableServiceName(item.service_name) === normalizedServiceName
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

  const logs = useSystemdLogs({
    systemdMode,
    selectedSystemdDetailService,
    setSystemdMessage,
    setSystemdMessageIsError
  });

  const isDetailRunning = systemdDetailStatus?.summary === 'running';
  const canDetailStart = !systemdBusy && !systemdDetailStatusBusy && !systemdDetailAction && !isDetailRunning;
  const canDetailStop = !systemdBusy && !systemdDetailStatusBusy && !systemdDetailAction && isDetailRunning;
  const detailStatusActionDisabled = systemdBusy || systemdDetailStatusBusy || Boolean(systemdDetailAction);
  const detailBackDisabled = systemdDetailAction === 'delete';

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
    const exists = filteredSystemdRemoteServices.some((item) => item.service_name === systemdSelectedRemoteServiceName);
    if (!exists) {
      setSystemdSelectedRemoteServiceName(filteredSystemdRemoteServices[0].service_name);
    }
  }, [filteredSystemdRemoteServices, systemdImportPanelOpen, systemdSelectedRemoteServiceName]);

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
        const importedLogMode =
          template.log_output_mode ?? (template.log_output_path?.trim() ? 'file' : previous.logOutputMode);
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
          serviceUser: previous.scope === 'system' ? template.service_user ?? previous.serviceUser : previous.serviceUser,
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

  const onOpenSystemdDetail = (service: SystemdDeployService) => {
    setSystemdMessage(null);
    setSystemdMessageIsError(false);
    setSystemdDetailServiceId(service.id);
    setSystemdDetailStatus(null);
    logs.resetSystemdLogStateForDetail();
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
    logs.resetSystemdLogStateForList();
    setSystemdMode('list');
    void refreshSystemdList();
  };

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

  return {
    textInputProps,
    systemdMode,
    systemdBusy,
    systemdDeletingServiceId,
    systemdMessage,
    systemdMessageIsError,
    systemdServices,
    profileNameMap,
    selectedSystemdProfile,
    selectedSystemdDetailService,
    selectedServiceTypeExamples,
    existingSystemdServiceNameSet,
    filteredSystemdRemoteServices,
    selectedRemoteServiceAlreadyAdded,
    systemdServiceNameValidationMessage,
    canDetailStart,
    canDetailStop,
    detailStatusActionDisabled,
    detailBackDisabled,
    systemdValidation,
    systemdDetailStatusBusy,
    systemdDetailStatus,
    systemdDetailAction,
    systemdSubmitAction,
    systemdImportPanelOpen,
    systemdRemoteServicesBusy,
    systemdImportBusy,
    systemdRemoteServices,
    systemdSelectedRemoteServiceName,
    systemdRemoteServiceKeyword,
    systemdDeleteDialog,
    systemdForm,
    isDeleteConfirmBusy,
    refreshSystemdList,
    onStartCreateSystemd,
    onEditSystemd,
    onOpenSystemdDetail,
    onBackSystemdList,
    onOpenSystemdImportPanel,
    onImportRemoteSystemdService,
    loadRemoteSystemdServiceList,
    refreshSystemdDetailStatus,
    onDetailControlSystemd,
    requestDeleteSystemdFromList,
    requestDeleteSystemdFromDetail,
    onSubmitSystemdForm,
    onConfirmDeleteSystemd,
    setSystemdImportPanelOpen,
    setSystemdRemoteServiceKeyword,
    setSystemdSelectedRemoteServiceName,
    setSystemdDeleteDialog,
    setSystemdForm,
    ...logs
  };
}
