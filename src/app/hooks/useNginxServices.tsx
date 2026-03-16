import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  controlNginxService,
  deleteNginxService,
  deployNginxService,
  discoverRemoteNginx,
  getNginxServiceStatus,
  importNginxServiceByParams,
  listNginxServiceConfigFiles,
  listNginxServices,
  readNginxServiceConfigFile,
  saveNginxServiceConfigFile,
  testNginxServiceConfig,
  validateNginxServiceConfigContent,
  upsertNginxService
} from '../api/profiles';
import { formatInvokeError } from '../helpers';
import type {
  ConnectionProfile,
  NginxControlAction,
  NginxConfigTestResult,
  NginxServiceConfigFileEntry,
  NginxDeployLogPayload,
  NginxService,
  NginxServiceStatus
} from '../../types';
import type { NginxFormState, NginxMode } from '../../components/nginx/types';

type NginxToast = {
  id: number;
  kind: 'success' | 'error';
  message: string;
};

function createNginxForm(profile?: ConnectionProfile | null): NginxFormState {
  return {
    profileId: profile?.id ?? '',
    name: buildDefaultNginxServiceName(profile ?? null),
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

function buildDefaultNginxServiceName(profile: ConnectionProfile | null): string {
  if (!profile) {
    return 'nginx';
  }
  return `nginx@${profile.host}`;
}

function buildUniqueNginxServiceName(
  services: NginxService[],
  profileId: string,
  baseName: string,
  currentId?: string
): string {
  const fallbackBase = baseName.trim() || 'nginx';
  const normalizedCurrentId = currentId?.trim() || undefined;
  const existing = new Set(
    services
      .filter((item) => item.profile_id === profileId && item.id !== normalizedCurrentId)
      .map((item) => item.name.trim().toLowerCase())
  );

  let candidate = fallbackBase;
  let index = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${fallbackBase}-${index}`;
    index += 1;
  }
  return candidate;
}

function createNginxDeployId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `nginx-deploy-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function useNginxServices(profiles: ConnectionProfile[]) {
  const activeNginxDeployIdRef = useRef<string | null>(null);
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
  const [nginxConfigServiceId, setNginxConfigServiceId] = useState<string | null>(null);
  const [nginxConfigReturnMode, setNginxConfigReturnMode] = useState<'list' | 'detail'>('list');
  const [nginxDetailStatus, setNginxDetailStatus] = useState<NginxServiceStatus | null>(null);
  const [nginxDetailStatusBusy, setNginxDetailStatusBusy] = useState(false);
  const [nginxDetailAction, setNginxDetailAction] = useState<NginxControlAction | null>(null);
  const [nginxConfigTesting, setNginxConfigTesting] = useState(false);
  const [nginxConfigLoading, setNginxConfigLoading] = useState(false);
  const [nginxConfigSaving, setNginxConfigSaving] = useState(false);
  const [nginxConfigApplying, setNginxConfigApplying] = useState(false);
  const [nginxConfigFilesLoading, setNginxConfigFilesLoading] = useState(false);
  const [nginxConfigFiles, setNginxConfigFiles] = useState<NginxServiceConfigFileEntry[]>([]);
  const [nginxConfigSourcePath, setNginxConfigSourcePath] = useState('');
  const [nginxConfigContent, setNginxConfigContent] = useState('');
  const [nginxConfigOriginalContent, setNginxConfigOriginalContent] = useState('');
  const [nginxConfigLoadedAt, setNginxConfigLoadedAt] = useState<number | null>(null);
  const [nginxConfigValidationErrorDetail, setNginxConfigValidationErrorDetail] = useState<string | null>(null);
  const [nginxLastConfigTestResult, setNginxLastConfigTestResult] = useState<NginxConfigTestResult | null>(null);
  const [nginxOperationLogs, setNginxOperationLogs] = useState<string[]>([]);
  const [nginxDeployLogs, setNginxDeployLogs] = useState<string[]>([]);
  const [nginxDeployActiveId, setNginxDeployActiveId] = useState<string | null>(null);
  const [nginxDeployRunning, setNginxDeployRunning] = useState(false);
  const [nginxDeleteTarget, setNginxDeleteTarget] = useState<NginxService | null>(null);
  const [nginxToast, setNginxToast] = useState<NginxToast | null>(null);

  const showNginxToast = useCallback((kind: NginxToast['kind'], message: string) => {
    setNginxToast({
      id: Date.now() + Math.floor(Math.random() * 1000),
      kind,
      message
    });
  }, []);

  const dismissNginxToast = useCallback(() => {
    setNginxToast(null);
  }, []);

  const appendNginxOperationLog = useCallback((title: string, output?: string) => {
    const now = new Date().toLocaleString();
    const normalizedOutput = output?.trim();
    const entry = normalizedOutput
      ? `[${now}] ${title}\n${normalizedOutput}`
      : `[${now}] ${title}\n(无输出)`;
    setNginxOperationLogs((previous) => [...previous, entry].slice(-200));
  }, []);

  useEffect(() => {
    if (!nginxToast) {
      return;
    }
    const timer = window.setTimeout(() => {
      setNginxToast((current) => (current && current.id === nginxToast.id ? null : current));
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [nginxToast]);

  useEffect(() => {
    let mounted = true;
    const unsubscribePromise = listen<NginxDeployLogPayload>('nginx-deploy-log', (event) => {
      if (!mounted) {
        return;
      }
      const currentDeployId = activeNginxDeployIdRef.current;
      if (!currentDeployId || event.payload.deploy_id !== currentDeployId) {
        return;
      }
      setNginxDeployLogs((previous) => [...previous, event.payload.line].slice(-500));
    });

    return () => {
      mounted = false;
      void unsubscribePromise.then((unlisten) => unlisten());
    };
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

  const selectedNginxConfigService = useMemo(
    () => nginxServices.find((item) => item.id === nginxConfigServiceId) ?? null,
    [nginxConfigServiceId, nginxServices]
  );

  const resolveNginxServiceName = useCallback(
    (profileId: string, currentId?: string, preferredName?: string) => {
      const existing = currentId
        ? nginxServices.find((item) => item.id === currentId)
        : null;
      if (existing && existing.profile_id === profileId) {
        return existing.name;
      }
      const profile = profiles.find((item) => item.id === profileId) ?? null;
      const baseName = preferredName?.trim() || buildDefaultNginxServiceName(profile);
      return buildUniqueNginxServiceName(nginxServices, profileId, baseName, currentId);
    },
    [nginxServices, profiles]
  );

  const nginxConfigDirty = nginxConfigContent !== nginxConfigOriginalContent;

  const resetNginxConfigEditor = useCallback(() => {
    setNginxConfigLoading(false);
    setNginxConfigSaving(false);
    setNginxConfigApplying(false);
    setNginxConfigFilesLoading(false);
    setNginxConfigFiles([]);
    setNginxConfigSourcePath('');
    setNginxConfigContent('');
    setNginxConfigOriginalContent('');
    setNginxConfigLoadedAt(null);
    setNginxConfigValidationErrorDetail(null);
  }, []);

  const nginxValidation = useMemo(() => {
    if (!nginxForm.profileId) {
      return '请选择目标服务器';
    }
    if (!nginxForm.nginxBin.trim()) {
      return 'nginx 命令路径不能为空';
    }
    return null;
  }, [nginxForm.nginxBin, nginxForm.profileId]);

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
    resetNginxConfigEditor();
    setNginxMessage(null);
    setNginxMessageIsError(false);
    setNginxForm(createNginxForm(profiles[0] ?? null));
    setNginxMode('create');
  };

  const onStartDeployNginx = () => {
    setNginxLastConfigTestResult(null);
    resetNginxConfigEditor();
    setNginxOperationLogs([]);
    setNginxDeployLogs([]);
    setNginxDeployActiveId(null);
    activeNginxDeployIdRef.current = null;
    setNginxDeployRunning(false);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    setNginxForm(createNginxForm(profiles[0] ?? null));
    setNginxMode('deploy');
  };

  const onEditNginx = (service: NginxService) => {
    setNginxLastConfigTestResult(null);
    resetNginxConfigEditor();
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
    resetNginxConfigEditor();
    setNginxOperationLogs([]);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    setNginxDetailServiceId(service.id);
    setNginxMode('detail');
    void refreshNginxDetailStatus(service.id);
  };

  const loadNginxConfigFiles = useCallback(async (serviceId: string, preferredPath?: string) => {
    setNginxConfigFilesLoading(true);
    try {
      const result = await listNginxServiceConfigFiles({ id: serviceId });
      setNginxConfigFiles(result.files);
      const normalizedPreferred = preferredPath?.trim();
      if (normalizedPreferred) {
        const matched = result.files.find((item) => item.source_path === normalizedPreferred);
        if (matched) {
          return matched.source_path;
        }
      }
      if (result.main_source_path.trim()) {
        return result.main_source_path.trim();
      }
      return result.files[0]?.source_path ?? null;
    } catch (invokeError) {
      setNginxConfigFiles([]);
      setNginxMessage(`读取 nginx 配置文件列表失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
      return preferredPath?.trim() || null;
    } finally {
      setNginxConfigFilesLoading(false);
    }
  }, []);

  const loadNginxConfigFile = useCallback(async (serviceId: string, sourcePath?: string) => {
    setNginxConfigLoading(true);
    setNginxConfigValidationErrorDetail(null);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const normalizedPath = sourcePath?.trim();
      const result = await readNginxServiceConfigFile({
        id: serviceId,
        source_path: normalizedPath || undefined
      });
      setNginxConfigSourcePath(result.source_path);
      setNginxConfigContent(result.content);
      setNginxConfigOriginalContent(result.content);
      setNginxConfigLoadedAt(result.loaded_at);
      setNginxConfigFiles((previous) => {
        if (previous.some((item) => item.source_path === result.source_path)) {
          return previous;
        }
        return [...previous, { source_path: result.source_path, is_primary: false }];
      });
      setNginxMessage(`已加载配置文件：${result.source_path}`);
      setNginxMessageIsError(false);
    } catch (invokeError) {
      setNginxMessage(`读取 nginx 配置文件失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
    } finally {
      setNginxConfigLoading(false);
    }
  }, []);

  const openNginxConfigWorkspace = useCallback(
    async (serviceId: string, preferredPath?: string) => {
      const targetPath = await loadNginxConfigFiles(serviceId, preferredPath);
      await loadNginxConfigFile(serviceId, targetPath ?? preferredPath);
    },
    [loadNginxConfigFile, loadNginxConfigFiles]
  );

  const onOpenNginxConfig = useCallback(
    (service: NginxService, returnMode: 'list' | 'detail' = 'list') => {
      setNginxConfigServiceId(service.id);
      setNginxConfigReturnMode(returnMode);
      resetNginxConfigEditor();
      setNginxMessage(null);
      setNginxMessageIsError(false);
      setNginxMode('config');
      void openNginxConfigWorkspace(service.id);
    },
    [openNginxConfigWorkspace, resetNginxConfigEditor]
  );

  const onBackNginxConfig = useCallback(() => {
    resetNginxConfigEditor();
    setNginxMessage(null);
    setNginxMessageIsError(false);
    setNginxMode(nginxConfigReturnMode);
  }, [nginxConfigReturnMode, resetNginxConfigEditor]);

  const onBackNginxList = () => {
    setNginxDetailServiceId(null);
    setNginxConfigServiceId(null);
    setNginxDetailStatus(null);
    setNginxDetailAction(null);
    setNginxConfigTesting(false);
    resetNginxConfigEditor();
    setNginxLastConfigTestResult(null);
    setNginxOperationLogs([]);
    setNginxDeployRunning(false);
    setNginxDeployActiveId(null);
    activeNginxDeployIdRef.current = null;
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

      const serviceName = resolveNginxServiceName(
        nginxForm.profileId,
        nginxForm.id,
        buildDefaultNginxServiceName(selectedNginxProfile)
      );
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
        name: resolveNginxServiceName(
          nginxForm.profileId,
          nginxForm.id,
          buildDefaultNginxServiceName(selectedNginxProfile)
        ),
        nginx_bin: nginxForm.nginxBin.trim(),
        conf_path: nginxForm.confPath.trim() || undefined,
        pid_path: nginxForm.pidPath.trim() || undefined,
        use_sudo: nginxForm.useSudo
      });
      setNginxMessage(`已导入 nginx 服务：${saved.name}`);
      setNginxMessageIsError(false);
      showNginxToast('success', `已导入 nginx 服务：${saved.name}`);
      setNginxMode('list');
      await refreshNginxList();
    } catch (invokeError) {
      const errorText = formatInvokeError(invokeError);
      setNginxMessage(`参数导入失败：${errorText}`);
      setNginxMessageIsError(true);
      showNginxToast('error', `参数导入失败：${errorText}`);
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
        name: resolveNginxServiceName(
          nginxForm.profileId,
          nginxForm.id,
          buildDefaultNginxServiceName(selectedNginxProfile)
        ),
        nginx_bin: nginxForm.nginxBin.trim(),
        conf_path: nginxForm.confPath.trim() || undefined,
        pid_path: nginxForm.pidPath.trim() || undefined,
        use_sudo: nginxForm.useSudo
      });
      setNginxMessage(`已保存 nginx 服务：${saved.name}`);
      setNginxMessageIsError(false);
      showNginxToast('success', `已保存 nginx 服务：${saved.name}`);
      setNginxMode('list');
      await refreshNginxList();
    } catch (invokeError) {
      const errorText = formatInvokeError(invokeError);
      setNginxMessage(`保存失败：${errorText}`);
      setNginxMessageIsError(true);
      showNginxToast('error', `保存失败：${errorText}`);
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
      if (nginxMode === 'detail' || nginxMode === 'config') {
        setNginxMode('list');
      }
      if (nginxDetailServiceId === service.id) {
        setNginxDetailServiceId(null);
      }
      if (nginxConfigServiceId === service.id) {
        setNginxConfigServiceId(null);
        resetNginxConfigEditor();
      }
      await refreshNginxList();
    } catch (invokeError) {
      setNginxMessage(`删除失败：${formatInvokeError(invokeError)}`);
      setNginxMessageIsError(true);
    } finally {
      setNginxBusy(false);
    }
  };

  const onSubmitDeployNginx = useCallback(async () => {
    if (!nginxForm.profileId) {
      setNginxMessage('请先选择目标服务器');
      setNginxMessageIsError(true);
      return;
    }

    setNginxBusy(true);
    setNginxDeployRunning(true);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    const deployId = createNginxDeployId();
    activeNginxDeployIdRef.current = deployId;
    setNginxDeployActiveId(deployId);
    setNginxDeployLogs([]);
    try {
      const profile = profiles.find((item) => item.id === nginxForm.profileId) ?? null;
      const existingServiceOnProfile =
        nginxServices.find((item) => item.profile_id === nginxForm.profileId) ?? null;

      const service = await upsertNginxService({
        id: existingServiceOnProfile?.id,
        profile_id: nginxForm.profileId,
        name: resolveNginxServiceName(
          nginxForm.profileId,
          existingServiceOnProfile?.id,
          buildDefaultNginxServiceName(profile)
        ),
        nginx_bin: nginxForm.nginxBin.trim() || existingServiceOnProfile?.nginx_bin || '/usr/sbin/nginx',
        conf_path: nginxForm.confPath.trim() || existingServiceOnProfile?.conf_path || '/etc/nginx/nginx.conf',
        pid_path: nginxForm.pidPath.trim() || existingServiceOnProfile?.pid_path || undefined,
        use_sudo: nginxForm.useSudo
      });

      const result = await deployNginxService({ id: service.id, deploy_id: deployId });
      const versionText = result.version ? `，版本：${result.version}` : '';
      const deploySummary = result.installed_before ? 'nginx 已存在，已执行服务启动检查' : 'nginx 部署安装完成';
      setNginxMessage(`${deploySummary}${versionText}`);
      setNginxMessageIsError(false);
      showNginxToast('success', `${deploySummary}${versionText}`);
      setNginxDeployLogs((previous) =>
        previous.length > 0 ? previous : [`${deploySummary}${versionText || ''}`]
      );
      const operationOutput = [result.stdout.trim(), result.stderr.trim()]
        .filter((item) => item.length > 0)
        .join('\n');
      appendNginxOperationLog(
        `部署 nginx 完成（exit=${result.exit_status}）`,
        `检测到命令：${result.nginx_bin}\n\n命令输出：\n${operationOutput || '(无输出)'}`
      );

      await refreshNginxList();
    } catch (invokeError) {
      const errorText = formatInvokeError(invokeError);
      setNginxMessage(`部署 nginx 失败：${errorText}`);
      setNginxMessageIsError(true);
      showNginxToast('error', `部署 nginx 失败：${errorText}`);
      setNginxDeployLogs((previous) =>
        previous.length > 0 ? previous : [`部署 nginx 失败：${errorText}`]
      );
      appendNginxOperationLog('部署 nginx 失败', `错误信息：\n${errorText}`);
    } finally {
      setNginxDeployRunning(false);
      setNginxBusy(false);
    }
  }, [
    appendNginxOperationLog,
    nginxForm.confPath,
    nginxForm.nginxBin,
    nginxForm.pidPath,
    nginxForm.profileId,
    nginxForm.useSudo,
    nginxServices,
    profiles,
    refreshNginxList,
    resolveNginxServiceName,
    showNginxToast
  ]);

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

  const onReloadNginxConfigFile = useCallback(async () => {
    if (!selectedNginxConfigService) {
      return;
    }
    await openNginxConfigWorkspace(selectedNginxConfigService.id, nginxConfigSourcePath || undefined);
  }, [nginxConfigSourcePath, openNginxConfigWorkspace, selectedNginxConfigService]);

  const onSelectNginxConfigFile = useCallback(
    async (sourcePath: string) => {
      if (!selectedNginxConfigService) {
        return;
      }
      const normalizedSourcePath = sourcePath.trim();
      if (!normalizedSourcePath || normalizedSourcePath === nginxConfigSourcePath) {
        return;
      }
      if (nginxConfigLoading || nginxConfigSaving || nginxConfigApplying || nginxConfigFilesLoading) {
        return;
      }
      if (nginxConfigDirty) {
        setNginxMessage('当前文件存在未保存修改，请先保存或还原后再切换。');
        setNginxMessageIsError(true);
        return;
      }
      await loadNginxConfigFile(selectedNginxConfigService.id, normalizedSourcePath);
    },
    [
      loadNginxConfigFile,
      nginxConfigApplying,
      nginxConfigDirty,
      nginxConfigFilesLoading,
      nginxConfigLoading,
      nginxConfigSaving,
      nginxConfigSourcePath,
      selectedNginxConfigService
    ]
  );

  const onSaveNginxConfigFile = useCallback(async () => {
    if (!selectedNginxConfigService) {
      return;
    }

    setNginxConfigSaving(true);
    setNginxConfigValidationErrorDetail(null);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const normalizedSourcePath = nginxConfigSourcePath.trim() || undefined;
      const validation = await validateNginxServiceConfigContent({
        id: selectedNginxConfigService.id,
        content: nginxConfigContent,
        source_path: normalizedSourcePath
      });
      setNginxLastConfigTestResult(validation);
      if (!validation.success) {
        const detail = [validation.stderr.trim(), validation.stdout.trim()]
          .filter((item) => item.length > 0)
          .join('\n');
        setNginxConfigValidationErrorDetail(detail || '校验失败，但未返回具体输出。');
        setNginxMessage(`保存前配置校验失败（exit=${validation.exit_status}），已阻止保存`);
        setNginxMessageIsError(true);
        showNginxToast('error', `配置校验失败（exit=${validation.exit_status}），保存未执行`);
        return;
      }

      const result = await saveNginxServiceConfigFile({
        id: selectedNginxConfigService.id,
        content: nginxConfigContent,
        source_path: normalizedSourcePath
      });
      setNginxConfigSourcePath(result.source_path);
      setNginxConfigOriginalContent(nginxConfigContent);
      setNginxConfigLoadedAt(result.saved_at);
      setNginxConfigFiles((previous) => {
        if (previous.some((item) => item.source_path === result.source_path)) {
          return previous;
        }
        return [...previous, { source_path: result.source_path, is_primary: false }];
      });
      setNginxConfigValidationErrorDetail(null);
      setNginxMessage(`配置已保存：${result.source_path}（${result.bytes} bytes）`);
      setNginxMessageIsError(false);
      showNginxToast('success', 'nginx 配置保存成功');
    } catch (invokeError) {
      const errorText = formatInvokeError(invokeError);
      setNginxConfigValidationErrorDetail(errorText);
      setNginxMessage(`保存 nginx 配置失败：${errorText}`);
      setNginxMessageIsError(true);
      showNginxToast('error', `保存 nginx 配置失败：${errorText}`);
    } finally {
      setNginxConfigSaving(false);
    }
  }, [nginxConfigContent, nginxConfigSourcePath, selectedNginxConfigService, showNginxToast]);

  const onApplyNginxConfig = useCallback(async () => {
    if (!selectedNginxConfigService) {
      return;
    }
    if (nginxConfigDirty) {
      setNginxMessage('检测到未保存的配置修改，请先保存配置后再应用。');
      setNginxMessageIsError(true);
      return;
    }

    setNginxConfigApplying(true);
    setNginxConfigValidationErrorDetail(null);
    setNginxMessage(null);
    setNginxMessageIsError(false);
    try {
      const command = buildControlCommand(selectedNginxConfigService, 'reload');
      const result = await controlNginxService({ id: selectedNginxConfigService.id, action: 'reload' });
      setNginxDetailStatus(result.status);
      setNginxMessage('nginx 配置已应用（reload 成功）');
      setNginxMessageIsError(false);
      showNginxToast('success', 'nginx 配置已应用');
      const operationOutput = [result.stdout.trim(), result.stderr.trim()].filter((item) => item.length > 0).join('\n');
      appendNginxOperationLog(
        `配置应用完成（reload，exit=${result.exit_status}）`,
        `执行命令：\n${command}\n\n命令输出：\n${operationOutput || '(无输出)'}`
      );
    } catch (invokeError) {
      const command = buildControlCommand(selectedNginxConfigService, 'reload');
      const errorText = formatInvokeError(invokeError);
      setNginxMessage(`应用配置失败：${errorText}`);
      setNginxMessageIsError(true);
      showNginxToast('error', `应用配置失败：${errorText}`);
      appendNginxOperationLog(
        '配置应用失败（reload）',
        `执行命令：\n${command}\n\n错误信息：\n${errorText}`
      );
    } finally {
      setNginxConfigApplying(false);
    }
  }, [
    appendNginxOperationLog,
    nginxConfigDirty,
    selectedNginxConfigService,
    showNginxToast
  ]);

  const onResetNginxConfigContent = useCallback(() => {
    setNginxConfigContent(nginxConfigOriginalContent);
  }, [nginxConfigOriginalContent]);

  const clearNginxOperationLogs = useCallback(() => {
    setNginxOperationLogs([]);
  }, []);

  const clearNginxDeployLogs = useCallback(() => {
    setNginxDeployLogs([]);
  }, []);

  const detailActionDisabled =
    nginxBusy || nginxDetailStatusBusy || Boolean(nginxDetailAction) || nginxConfigTesting;
  const detailBackDisabled = Boolean(nginxDetailAction);
  const isDetailRunning = nginxDetailStatus?.running ?? false;
  const canDetailStart = !detailActionDisabled && !isDetailRunning;
  const canDetailStop = !detailActionDisabled && isDetailRunning;
  const nginxConfigEditorBusy =
    nginxConfigLoading || nginxConfigSaving || nginxConfigApplying || nginxConfigFilesLoading;

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
    nginxConfigLoading,
    nginxConfigSaving,
    nginxConfigApplying,
    nginxConfigFilesLoading,
    nginxConfigFiles,
    nginxConfigEditorBusy,
    nginxConfigSourcePath,
    nginxConfigContent,
    nginxConfigLoadedAt,
    nginxConfigDirty,
    nginxConfigValidationErrorDetail,
    nginxLastConfigTestResult,
    nginxOperationLogs,
    nginxDeployLogs,
    nginxDeployActiveId,
    nginxDeployRunning,
    nginxDeleteTarget,
    nginxToast,
    detailActionDisabled,
    detailBackDisabled,
    canDetailStart,
    canDetailStop,
    nginxValidation,
    profileNameMap,
    selectedNginxProfile,
    selectedNginxDetailService,
    selectedNginxConfigService,
    refreshNginxList,
    onStartCreateNginx,
    onStartDeployNginx,
    onEditNginx,
    onOpenNginxDetail,
    onOpenNginxConfig,
    onBackNginxConfig,
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
    onSubmitDeployNginx,
    onTestNginxConfig,
    onReloadNginxConfigFile,
    onSelectNginxConfigFile,
    onSaveNginxConfigFile,
    onApplyNginxConfig,
    onResetNginxConfigContent,
    clearNginxOperationLogs,
    clearNginxDeployLogs,
    dismissNginxToast,
    setNginxForm,
    setNginxConfigContent
  };
}
