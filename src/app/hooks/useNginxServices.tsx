import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  controlNginxService,
  deleteNginxService,
  discoverRemoteNginx,
  getNginxServiceStatus,
  importNginxServiceByParams,
  listNginxServices,
  testNginxServiceConfig,
  upsertNginxService
} from '../api/profiles';
import { formatInvokeError } from '../helpers';
import type { ConnectionProfile, NginxControlAction, NginxConfigTestResult, NginxService, NginxServiceStatus } from '../../types';
import type { NginxFormState, NginxMode } from '../../components/nginx/types';

function createNginxForm(profile?: ConnectionProfile | null): NginxFormState {
  return {
    profileId: profile?.id ?? '',
    name: 'nginx',
    nginxBin: '/usr/sbin/nginx',
    confPath: '/etc/nginx/nginx.conf',
    pidPath: '',
    useSudo: true
  };
}

function toNginxForm(service: NginxService): NginxFormState {
  return {
    id: service.id,
    profileId: service.profile_id,
    name: service.name,
    nginxBin: service.nginx_bin,
    confPath: service.conf_path ?? '',
    pidPath: service.pid_path ?? '',
    useSudo: service.use_sudo
  };
}

function shellQuote(value: string): string {
  if (!value) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildControlCommand(service: NginxService, action: NginxControlAction): string {
  const prefix = service.use_sudo ? 'sudo ' : '';
  const nginxBin = shellQuote(service.nginx_bin);
  const confArg = service.conf_path?.trim() ? ` -c ${shellQuote(service.conf_path.trim())}` : '';

  if (action === 'start') {
    return `${prefix}${nginxBin}${confArg}`;
  }
  if (action === 'stop') {
    return `${prefix}${nginxBin} -s quit${confArg}`;
  }
  if (action === 'reload') {
    return `${prefix}${nginxBin} -s reload${confArg}`;
  }
  return `${prefix}${nginxBin} -s quit${confArg} >/dev/null 2>&1 || true\nsleep 1\n${prefix}${nginxBin}${confArg}`;
}

function buildConfigTestCommand(service: NginxService): string {
  const prefix = service.use_sudo ? 'sudo ' : '';
  const nginxBin = shellQuote(service.nginx_bin);
  const confArg = service.conf_path?.trim() ? ` -c ${shellQuote(service.conf_path.trim())}` : '';
  return `${prefix}${nginxBin} -t${confArg}`;
}

export function useNginxServices(profiles: ConnectionProfile[]) {
  const textInputProps = {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'none' as const,
    spellCheck: false
  };

  const [nginxMode, setNginxMode] = useState<NginxMode>('list');
  const [nginxForm, setNginxForm] = useState<NginxFormState>(() => createNginxForm(profiles[0] ?? null));
  const [nginxServices, setNginxServices] = useState<NginxService[]>([]);
  const [nginxBusy, setNginxBusy] = useState(false);
  const [nginxDiscovering, setNginxDiscovering] = useState(false);
  const [nginxMessage, setNginxMessage] = useState<string | null>(null);
  const [nginxMessageIsError, setNginxMessageIsError] = useState(false);
  const [nginxDetailServiceId, setNginxDetailServiceId] = useState<string | null>(null);
  const [nginxDetailStatus, setNginxDetailStatus] = useState<NginxServiceStatus | null>(null);
  const [nginxDetailStatusBusy, setNginxDetailStatusBusy] = useState(false);
  const [nginxDetailAction, setNginxDetailAction] = useState<NginxControlAction | null>(null);
  const [nginxConfigTesting, setNginxConfigTesting] = useState(false);
  const [nginxLastConfigTestResult, setNginxLastConfigTestResult] = useState<NginxConfigTestResult | null>(null);
  const [nginxOperationLogs, setNginxOperationLogs] = useState<string[]>([]);
  const [nginxDeleteTarget, setNginxDeleteTarget] = useState<NginxService | null>(null);

  const appendNginxOperationLog = useCallback((title: string, output?: string) => {
    const now = new Date().toLocaleString();
    const normalizedOutput = output?.trim();
    const entry = normalizedOutput
      ? `[${now}] ${title}\n${normalizedOutput}`
      : `[${now}] ${title}\n(无输出)`;
    setNginxOperationLogs((previous) => [...previous, entry].slice(-200));
  }, []);

  const profileNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const profile of profiles) {
      map.set(profile.id, `${profile.name} (${profile.username}@${profile.host})`);
    }
    return map;
  }, [profiles]);

  const selectedNginxProfile = useMemo(
    () => profiles.find((profile) => profile.id === nginxForm.profileId) ?? null,
    [profiles, nginxForm.profileId]
  );

  const selectedNginxDetailService = useMemo(
    () => nginxServices.find((item) => item.id === nginxDetailServiceId) ?? null,
    [nginxDetailServiceId, nginxServices]
  );

  const duplicateNginxName = useMemo(() => {
    const normalized = nginxForm.name.trim().toLowerCase();
    if (!normalized || !nginxForm.profileId) {
      return null;
    }
    return (
      nginxServices.find(
        (item) =>
          item.id !== nginxForm.id &&
          item.profile_id === nginxForm.profileId &&
          item.name.trim().toLowerCase() === normalized
      ) ?? null
    );
  }, [nginxForm.id, nginxForm.name, nginxForm.profileId, nginxServices]);

  const nginxValidation = useMemo(() => {
    if (!nginxForm.profileId) {
      return '请选择目标服务器';
    }
    if (!nginxForm.name.trim()) {
      return '服务名称不能为空';
    }
    if (duplicateNginxName) {
      return `同服务器下名称重复：${duplicateNginxName.name}`;
    }
    if (!nginxForm.nginxBin.trim()) {
      return 'nginx 命令路径不能为空';
    }
    return null;
  }, [duplicateNginxName, nginxForm.name, nginxForm.nginxBin, nginxForm.profileId]);

  useEffect(() => {
    if (profiles.length === 0) {
      setNginxForm((previous) => ({ ...previous, profileId: '' }));
      return;
    }

    setNginxForm((previous) => {
      const hasProfile = profiles.some((profile) => profile.id === previous.profileId);
      if (hasProfile) {
        return previous;
      }
      return {
        ...previous,
        profileId: profiles[0].id
      };
    });
  }, [profiles]);

  const refreshNginxList = useCallback(async () => {
    setNginxBusy(true);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const list = await listNginxServices();
      setNginxServices(list);
    } catch (invokeError) {
      setNginxMessage(`读取 nginx 管理列表失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
    } finally {
      setNginxBusy(false);
    }
  }, []);

  useEffect(() => {
    if (nginxMode === 'list') {
      void refreshNginxList();
    }
  }, [nginxMode, refreshNginxList]);

  const onStartCreateNginx = () => {
    setNginxLastConfigTestResult(null);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    setNginxForm(createNginxForm(profiles[0] ?? null));
    setNginxMode('create');
  };

  const onEditNginx = (service: NginxService) => {
    setNginxLastConfigTestResult(null);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    setNginxForm(toNginxForm(service));
    setNginxMode('edit');
  };

  const refreshNginxDetailStatus = useCallback(async (serviceId: string) => {
    setNginxDetailStatusBusy(true);
    try {
      const status = await getNginxServiceStatus({ id: serviceId });
      setNginxDetailStatus(status);
    } catch (invokeError) {
      setNginxMessage(`读取 nginx 状态失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
      setNginxDetailStatus(null);
    } finally {
      setNginxDetailStatusBusy(false);
    }
  }, []);

  const onOpenNginxDetail = (service: NginxService) => {
    setNginxLastConfigTestResult(null);
    setNginxOperationLogs([]);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    setNginxDetailServiceId(service.id);
    setNginxMode('detail');
    void refreshNginxDetailStatus(service.id);
  };

  const onBackNginxList = () => {
    setNginxDetailServiceId(null);
    setNginxDetailStatus(null);
    setNginxDetailAction(null);
    setNginxConfigTesting(false);
    setNginxLastConfigTestResult(null);
    setNginxOperationLogs([]);
    setNginxMode('list');
  };

  const onDiscoverNginx = async () => {
    if (!nginxForm.profileId) {
      setNginxMessage('请先选择目标服务器');
      setNginxMessageIsError(true);
      return;
    }

    setNginxDiscovering(true);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const result = await discoverRemoteNginx({ profile_id: nginxForm.profileId });
      if (!result.installed || !result.nginx_bin) {
        setNginxMessage('未通过 `which nginx` 发现 nginx，请手动输入参数导入');
        setNginxMessageIsError(true);
        return;
      }

      setNginxForm((previous) => ({
        ...previous,
        name: previous.name.trim() || 'nginx',
        nginxBin: result.nginx_bin ?? previous.nginxBin,
        confPath: result.conf_path ?? previous.confPath,
        pidPath: result.pid_path ?? previous.pidPath
      }));

      const versionText = result.version ? `，版本：${result.version}` : '';
      setNginxMessage(`已自动发现 nginx 命令：${result.nginx_bin}${versionText}`);
      setNginxMessageIsError(false);
    } catch (invokeError) {
      setNginxMessage(`自动发现失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
    } finally {
      setNginxDiscovering(false);
    }
  };

  const onAutoAddDiscoveredNginx = async () => {
    if (!nginxForm.profileId) {
      setNginxMessage('请先选择目标服务器');
      setNginxMessageIsError(true);
      return;
    }

    setNginxBusy(true);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const result = await discoverRemoteNginx({ profile_id: nginxForm.profileId });
      if (!result.installed || !result.nginx_bin) {
        setNginxMessage('未通过 `which nginx` 发现 nginx，请改用手动参数导入');
        setNginxMessageIsError(true);
        return;
      }

      const serviceName = nginxForm.name.trim() || `nginx-${selectedNginxProfile?.name ?? 'service'}`;
      const saved = await importNginxServiceByParams({
        id: nginxForm.id,
        profile_id: nginxForm.profileId,
        name: serviceName,
        nginx_bin: result.nginx_bin,
        conf_path: result.conf_path || undefined,
        pid_path: result.pid_path || undefined,
        use_sudo: nginxForm.useSudo
      });

      setNginxMessage(`已自动添加 nginx 服务：${saved.name}`);
      setNginxMessageIsError(false);
      setNginxMode('list');
      await refreshNginxList();
    } catch (invokeError) {
      setNginxMessage(`自动添加失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
    } finally {
      setNginxBusy(false);
    }
  };

  const onSubmitNginxImport = async () => {
    if (nginxValidation) {
      setNginxMessage(nginxValidation);
      setNginxMessageIsError(true);
      return;
    }

    setNginxBusy(true);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const saved = await importNginxServiceByParams({
        id: nginxForm.id,
        profile_id: nginxForm.profileId,
        name: nginxForm.name.trim(),
        nginx_bin: nginxForm.nginxBin.trim(),
        conf_path: nginxForm.confPath.trim() || undefined,
        pid_path: nginxForm.pidPath.trim() || undefined,
        use_sudo: nginxForm.useSudo
      });
      setNginxMessage(`已导入 nginx 服务：${saved.name}`);
      setNginxMessageIsError(false);
      setNginxMode('list');
      await refreshNginxList();
    } catch (invokeError) {
      setNginxMessage(`参数导入失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
    } finally {
      setNginxBusy(false);
    }
  };

  const onSaveNginx = async () => {
    if (nginxValidation) {
      setNginxMessage(nginxValidation);
      setNginxMessageIsError(true);
      return;
    }

    setNginxBusy(true);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const saved = await upsertNginxService({
        id: nginxForm.id,
        profile_id: nginxForm.profileId,
        name: nginxForm.name.trim(),
        nginx_bin: nginxForm.nginxBin.trim(),
        conf_path: nginxForm.confPath.trim() || undefined,
        pid_path: nginxForm.pidPath.trim() || undefined,
        use_sudo: nginxForm.useSudo
      });
      setNginxMessage(`已保存 nginx 服务：${saved.name}`);
      setNginxMessageIsError(false);
      setNginxMode('list');
      await refreshNginxList();
    } catch (invokeError) {
      setNginxMessage(`保存失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
    } finally {
      setNginxBusy(false);
    }
  };

  const requestDeleteNginx = (service: NginxService) => {
    if (nginxBusy) {
      return;
    }
    setNginxDeleteTarget(service);
  };

  const onConfirmDeleteNginx = async () => {
    if (!nginxDeleteTarget) {
      return;
    }
    const service = nginxDeleteTarget;
    setNginxDeleteTarget(null);
    setNginxBusy(true);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      await deleteNginxService({ id: service.id });
      setNginxMessage(`已删除 nginx 服务：${service.name}`);
      setNginxMessageIsError(false);
      if (nginxMode === 'detail') {
        setNginxMode('list');
      }
      await refreshNginxList();
    } catch (invokeError) {
      setNginxMessage(`删除失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
    } finally {
      setNginxBusy(false);
    }
  };

  const onControlNginx = useCallback(
    async (action: NginxControlAction) => {
      if (!selectedNginxDetailService) {
        return;
      }

      setNginxDetailAction(action);
      setNginxMessage(null);
      setNginxMessageIsError(false);
      try {
        const command = buildControlCommand(selectedNginxDetailService, action);
        const result = await controlNginxService({ id: selectedNginxDetailService.id, action });
        setNginxDetailStatus(result.status);
        setNginxMessage(`nginx ${action} 执行成功`);
        setNginxMessageIsError(false);
        const operationOutput = [result.stdout.trim(), result.stderr.trim()].filter((item) => item.length > 0).join('\n');
        appendNginxOperationLog(
          `操作 ${action} 完成（exit=${result.exit_status}）`,
          `执行命令：\n${command}\n\n命令输出：\n${operationOutput || '(无输出)'}`
        );
      } catch (invokeError) {
        const command = buildControlCommand(selectedNginxDetailService, action);
        const errorText = formatInvokeError(invokeError);
        setNginxMessage(`操作失败：${errorText}`);
        setNginxMessageIsError(true);
        appendNginxOperationLog(`操作 ${action} 失败`, `执行命令：\n${command}\n\n错误信息：\n${errorText}`);
      } finally {
        setNginxDetailAction(null);
      }
    },
    [appendNginxOperationLog, selectedNginxDetailService]
  );

  const onTestNginxConfig = useCallback(async () => {
    if (!selectedNginxDetailService) {
      return;
    }

    setNginxConfigTesting(true);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const command = buildConfigTestCommand(selectedNginxDetailService);
      const result = await testNginxServiceConfig({ id: selectedNginxDetailService.id });
      setNginxLastConfigTestResult(result);
      const testOutput = [result.stdout.trim(), result.stderr.trim()].filter((item) => item.length > 0).join('\n');
      appendNginxOperationLog(
        `配置检测完成（${result.success ? '通过' : '失败'}，exit=${result.exit_status}）`,
        `执行命令：\n${command}\n\n命令输出：\n${testOutput || '(无输出)'}`
      );
      if (result.success) {
        setNginxMessage('nginx 配置检测通过');
        setNginxMessageIsError(false);
      } else {
        setNginxMessage(`nginx 配置检测失败（exit=${result.exit_status}）`);
        setNginxMessageIsError(true);
      }
    } catch (invokeError) {
      const command = buildConfigTestCommand(selectedNginxDetailService);
      const errorText = formatInvokeError(invokeError);
      setNginxMessage(`配置检测失败：${errorText}`);
      setNginxMessageIsError(true);
      appendNginxOperationLog('配置检测失败', `执行命令：\n${command}\n\n错误信息：\n${errorText}`);
      setNginxLastConfigTestResult(null);
    } finally {
      setNginxConfigTesting(false);
    }
  }, [appendNginxOperationLog, selectedNginxDetailService]);

  const clearNginxOperationLogs = useCallback(() => {
    setNginxOperationLogs([]);
  }, []);

  const detailActionDisabled = nginxBusy || nginxDetailStatusBusy || Boolean(nginxDetailAction) || nginxConfigTesting;
  const detailBackDisabled = Boolean(nginxDetailAction);
  const isDetailRunning = nginxDetailStatus?.running ?? false;
  const canDetailStart = !detailActionDisabled && !isDetailRunning;
  const canDetailStop = !detailActionDisabled && isDetailRunning;

  return {
    textInputProps,
    nginxMode,
    nginxForm,
    nginxServices,
    nginxBusy,
    nginxDiscovering,
    nginxMessage,
    nginxMessageIsError,
    nginxDetailStatus,
    nginxDetailStatusBusy,
    nginxDetailAction,
    nginxConfigTesting,
    nginxLastConfigTestResult,
    nginxOperationLogs,
    nginxDeleteTarget,
    detailActionDisabled,
    detailBackDisabled,
    canDetailStart,
    canDetailStop,
    nginxValidation,
    duplicateNginxName,
    profileNameMap,
    selectedNginxProfile,
    selectedNginxDetailService,
    refreshNginxList,
    onStartCreateNginx,
    onEditNginx,
    onOpenNginxDetail,
    onBackNginxList,
    onDiscoverNginx,
    onAutoAddDiscoveredNginx,
    onSubmitNginxImport,
    onSaveNginx,
    requestDeleteNginx,
    onConfirmDeleteNginx,
    setNginxDeleteTarget,
    refreshNginxDetailStatus,
    onControlNginx,
    onTestNginxConfig,
    clearNginxOperationLogs,
    setNginxForm
  };
}
