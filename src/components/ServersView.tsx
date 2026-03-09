import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySystemdDeployService,
  controlSystemdDeployService,
  deleteSystemdDeployService,
  getSystemdDeployServiceLogs,
  getSystemdDeployServiceStatus,
  listSystemdDeployServices,
  upsertSystemdDeployService
} from '../app/api/profiles';
import { formatInvokeError } from '../app/helpers';
import type {
  ConnectionProfile,
  SystemdDeployService,
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
};

type SystemdServiceType = 'node' | 'python' | 'java' | 'go' | 'dotnet' | 'docker' | 'custom';

const SYSTEMD_SERVICE_TYPES: SystemdServiceType[] = ['node', 'python', 'java', 'go', 'dotnet', 'docker', 'custom'];
const SYSTEMD_LOG_FETCH_LINES = 200;
const SYSTEMD_LOG_MAX_LINES = 1000;

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

function createSystemdForm(profile?: ConnectionProfile | null): SystemdFormState {
  return {
    profileId: profile?.id ?? '',
    name: '',
    serviceName: 'my-app',
    serviceType: 'node',
    scope: 'system',
    description: 'Managed by Castor',
    workingDir: '/opt/my-app',
    execStart: '/usr/bin/node /opt/my-app/server.js',
    execStop: '',
    serviceUser: profile?.username ?? '',
    environmentText: '',
    enableOnBoot: true,
    useSudo: true
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
    useSudo: service.use_sudo
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
  const [systemdDetailStatusBusy, setSystemdDetailStatusBusy] = useState(false);
  const [systemdDetailStatus, setSystemdDetailStatus] = useState<SystemdServiceStatus | null>(null);
  const [systemdDetailAction, setSystemdDetailAction] = useState<'start' | 'stop' | 'restart' | 'delete' | null>(null);
  const [systemdDetailLogsBusy, setSystemdDetailLogsBusy] = useState(false);
  const [systemdDetailLogsRealtime, setSystemdDetailLogsRealtime] = useState(false);
  const [systemdDetailLogs, setSystemdDetailLogs] = useState<string[]>([]);
  const [systemdDetailLogsCursor, setSystemdDetailLogsCursor] = useState<string | null>(null);
  const [systemdMessage, setSystemdMessage] = useState<string | null>(null);
  const [systemdMessageIsError, setSystemdMessageIsError] = useState(false);
  const systemdDetailLogsCursorRef = useRef<string | null>(null);

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
  const isDetailRunning = systemdDetailStatus?.summary === 'running';
  const canDetailStart = !systemdBusy && !systemdDetailStatusBusy && !systemdDetailAction && !isDetailRunning;
  const canDetailStop = !systemdBusy && !systemdDetailStatusBusy && !systemdDetailAction && isDetailRunning;
  const detailStatusActionDisabled = systemdBusy || systemdDetailStatusBusy || Boolean(systemdDetailAction);

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
    if (!systemdForm.workingDir.trim()) {
      return '工作目录不能为空';
    }
    if (!systemdForm.execStart.trim()) {
      return '启动命令不能为空';
    }
    return null;
  }, [systemdForm]);

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
    systemdDetailLogsCursorRef.current = systemdDetailLogsCursor;
  }, [systemdDetailLogsCursor]);

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
    setSystemdForm(createSystemdForm(profiles[0] ?? null));
    setSystemdMode('create');
  };

  const onEditSystemd = (service: SystemdDeployService) => {
    setSystemdMessage(null);
    setSystemdMessageIsError(false);
    setSystemdForm(toSystemdForm(service, profiles));
    setSystemdMode('edit');
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
          setSystemdDetailLogs((previous) => {
            const merged = [...previous, ...result.lines];
            if (merged.length <= SYSTEMD_LOG_MAX_LINES) {
              return merged;
            }
            return merged.slice(merged.length - SYSTEMD_LOG_MAX_LINES);
          });
        }
      } else {
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
  }, []);

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
    setSystemdDetailLogs([]);
    setSystemdDetailLogsCursor(null);
    setSystemdDetailLogsRealtime(false);
    setSystemdMode('detail');
    void refreshSystemdDetailStatus(service.id);
    void loadSystemdDetailLogs(service.id, false);
  };

  const onBackSystemdList = () => {
    setSystemdDetailServiceId(null);
    setSystemdDetailStatus(null);
    setSystemdDetailAction(null);
    setSystemdDetailLogsBusy(false);
    setSystemdDetailLogsRealtime(false);
    setSystemdDetailLogs([]);
    setSystemdDetailLogsCursor(null);
    setSystemdMode('list');
    void refreshSystemdList();
  };

  const onToggleSystemdRealtimeLogs = () => {
    if (!selectedSystemdDetailService) {
      return;
    }
    if (systemdDetailLogsRealtime) {
      setSystemdDetailLogsRealtime(false);
      return;
    }
    setSystemdDetailLogsRealtime(true);
    void loadSystemdDetailLogs(selectedSystemdDetailService.id, true, true);
  };

  const onDetailControlSystemd = async (action: 'start' | 'stop' | 'restart') => {
    if (!selectedSystemdDetailService) {
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

  const onDeleteSystemdInDetail = async () => {
    if (!selectedSystemdDetailService) {
      return;
    }
    const confirmed = window.confirm(`确认删除部署服务“${selectedSystemdDetailService.name}”吗？`);
    if (!confirmed) {
      return;
    }

    setSystemdDetailAction('delete');
    try {
      await deleteSystemdDeployService({ id: selectedSystemdDetailService.id });
      setSystemdMessage(`已删除部署服务：${selectedSystemdDetailService.name}`);
      setSystemdMessageIsError(false);
      onBackSystemdList();
    } catch (invokeError) {
      setSystemdMessage(`删除失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      setSystemdDetailAction(null);
    }
  };

  const onSubmitSystemdForm = async () => {
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
      use_sudo: systemdForm.scope === 'system' ? systemdForm.useSudo : false
    };

    setSystemdBusy(true);
    setSystemdMessage('正在保存并部署...');
    setSystemdMessageIsError(false);
    try {
      const saved = await upsertSystemdDeployService(request);
      await applySystemdDeployService({ id: saved.id });
      setSystemdMessage(`部署成功：${saved.service_name}.service`);
      setSystemdMessageIsError(false);
      setSystemdMode('list');
      await refreshSystemdList();
    } catch (invokeError) {
      setSystemdMessage(`操作失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      setSystemdBusy(false);
    }
  };

  const onDeleteSystemd = async (service: SystemdDeployService) => {
    const confirmed = window.confirm(`确认删除部署服务“${service.name}”吗？`);
    if (!confirmed) {
      return;
    }

    setSystemdBusy(true);
    try {
      await deleteSystemdDeployService({ id: service.id });
      setSystemdMessage(`已删除部署服务：${service.name}`);
      setSystemdMessageIsError(false);
      await refreshSystemdList();
    } catch (invokeError) {
      setSystemdMessage(`删除失败：${formatInvokeError(invokeError)}`);
      setSystemdMessageIsError(true);
    } finally {
      setSystemdBusy(false);
    }
  };

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
                        <article key={service.id} className="host-card systemd-service-card">
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
                            <button type="button" onClick={() => onOpenSystemdDetail(service)} disabled={systemdBusy}>
                              详情
                            </button>
                            <button type="button" onClick={() => onEditSystemd(service)} disabled={systemdBusy}>
                              编辑
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => void onDeleteSystemd(service)}
                              disabled={systemdBusy}
                            >
                              删除
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
                    disabled={detailStatusActionDisabled}
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
                          onClick={onDeleteSystemdInDetail}
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
                              disabled={systemdDetailLogsBusy}
                            >
                              {systemdDetailLogsBusy ? '读取中...' : '查看日志'}
                            </button>
                            <button type="button" onClick={onToggleSystemdRealtimeLogs}>
                              {systemdDetailLogsRealtime ? '停止实时日志' : '开启实时日志'}
                            </button>
                          </div>
                        </header>
                        {systemdDetailLogs.length > 0 ? (
                          <pre className="systemd-log">{systemdDetailLogs.join('\n')}</pre>
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
                    <button type="button" onClick={onSubmitSystemdForm} disabled={systemdBusy || Boolean(systemdValidation)}>
                      {systemdBusy ? '处理中...' : '保存并部署'}
                    </button>
                  </div>
                </div>

                <div className="systemd-form-scroll">
                  <p className="status-line">保存后会自动执行部署（生成/更新 unit + daemon-reload + enable(可选) + restart）。</p>
                  {systemdMessage && (
                    <p className={systemdMessageIsError ? 'status-line error' : 'status-line'}>{systemdMessage}</p>
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
                      onChange={(event) => setSystemdForm((prev) => ({ ...prev, serviceName: event.target.value }))}
                      placeholder="my-app"
                      disabled={systemdBusy}
                      {...textInputProps}
                    />
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
                        value={systemdForm.execStart}
                        onChange={(event) => setSystemdForm((prev) => ({ ...prev, execStart: event.target.value }))}
                        placeholder="/usr/bin/node /opt/my-app/server.js"
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
    </div>
  );
}
