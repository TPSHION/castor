import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnixTime } from '../../app/helpers';
import { useEnvironmentMihomo } from '../../app/hooks/environment/useEnvironmentMihomo';
import type { ConnectionProfile, ProxyApplyMode, ProxyNode, ServerProxyConfig } from '../../types';

type StatusTone = 'pending' | 'active' | 'failed' | 'unknown';
type StepState = 'pending' | 'active' | 'completed' | 'failed';

const MIHOMO_APPLY_STEPS = [
  '准备权限与执行环境',
  '检查并安装 Mihomo',
  '写入 Mihomo 配置与服务文件',
  '重载并重启 Mihomo 服务',
  '校验 Mihomo 服务状态',
  '部署后自动验通与关键诊断'
];

function getConnectivityStatusTone(node: ProxyNode): StatusTone {
  if (node.reachability_status === 'ok') {
    return 'active';
  }
  if (node.reachability_status === 'failed') {
    return 'failed';
  }
  return 'unknown';
}

function getConnectivityStatusLabel(node: ProxyNode): string {
  if (node.reachability_status === 'ok') {
    return '可达';
  }
  if (node.reachability_status === 'failed') {
    return '失败';
  }
  return '未测试';
}

function getLatencyLabel(node: ProxyNode): string {
  if (typeof node.latency_ms === 'number' && Number.isFinite(node.latency_ms)) {
    return `${node.latency_ms} ms`;
  }
  return '-';
}

function parseCurrentApplyStepIndex(logs: string[]): number {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const line = logs[index];
    const match = line.match(/^\[(\d+)\/(\d+)\]/);
    if (match) {
      return Number.parseInt(match[1], 10) - 1;
    }
  }
  return -1;
}

export function EnvironmentMihomoPanel({ profiles }: { profiles: ConnectionProfile[] }) {
  const vm = useEnvironmentMihomo(profiles);
  const [activePage, setActivePage] = useState<'nodes' | 'deploy'>('nodes');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSubscriptionUrl, setAddSubscriptionUrl] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ServerProxyConfig | null>(null);
  const [applyProfileId, setApplyProfileId] = useState(profiles[0]?.id ?? '');
  const [applyUseSudo, setApplyUseSudo] = useState(true);
  const [applyMixedPort, setApplyMixedPort] = useState(7890);
  const [applyMode, setApplyMode] = useState<ProxyApplyMode>('application');
  const [deployNodeId, setDeployNodeId] = useState('');
  const realtimeLogRef = useRef<HTMLPreElement | null>(null);

  const selectedConfig = vm.selectedConfig;
  const selectedNodes = useMemo(() => selectedConfig?.nodes ?? [], [selectedConfig?.nodes]);
  const supportedNodes = useMemo(() => selectedNodes.filter((item) => item.supported), [selectedNodes]);
  const selectedDeployNode = useMemo(
    () => supportedNodes.find((item) => item.id === deployNodeId) ?? supportedNodes[0] ?? null,
    [deployNodeId, supportedNodes]
  );
  const applicationHttpProxy = `http://127.0.0.1:${applyMixedPort}`;
  const applicationSocksProxy = `socks5://127.0.0.1:${applyMixedPort}`;

  const noAssistTextInputProps = {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'none',
    spellCheck: false
  } as const;

  useEffect(() => {
    if (profiles.length === 0) {
      setApplyProfileId('');
      return;
    }
    if (!applyProfileId || !profiles.some((item) => item.id === applyProfileId)) {
      setApplyProfileId(profiles[0].id);
    }
  }, [applyProfileId, profiles]);

  useEffect(() => {
    if (supportedNodes.length === 0) {
      setDeployNodeId('');
      return;
    }
    if (!deployNodeId || !supportedNodes.some((item) => item.id === deployNodeId)) {
      setDeployNodeId(supportedNodes[0].id);
    }
  }, [deployNodeId, supportedNodes]);

  useEffect(() => {
    if (!vm.applyBusy || !realtimeLogRef.current) {
      return;
    }
    realtimeLogRef.current.scrollTop = realtimeLogRef.current.scrollHeight;
  }, [vm.applyBusy, vm.applyRealtimeLogs]);

  const onOpenAddDialog = () => {
    setAddSubscriptionUrl(selectedConfig?.subscription_url ?? '');
    setAddDialogOpen(true);
  };

  const onConfirmAddSubscription = async () => {
    const success = await vm.onSyncSubscription(addSubscriptionUrl);
    if (success) {
      setAddDialogOpen(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    await vm.onDeleteConfig(deleteTarget.id);
    setDeleteTarget(null);
  };

  const onConfirmApply = async () => {
    if (!selectedConfig || !selectedDeployNode) {
      return;
    }
    await vm.onApplyNode(
      selectedConfig,
      selectedDeployNode,
      applyProfileId,
      applyUseSudo,
      applyMixedPort,
      applyMode
    );
  };

  const currentApplyStepIndex = useMemo(
    () => parseCurrentApplyStepIndex(vm.applyRealtimeLogs),
    [vm.applyRealtimeLogs]
  );

  const getStepState = (index: number): StepState => {
    if (vm.applyBusy) {
      if (currentApplyStepIndex < 0) {
        return index === 0 ? 'active' : 'pending';
      }
      if (index < currentApplyStepIndex) {
        return 'completed';
      }
      if (index === currentApplyStepIndex) {
        return 'active';
      }
      return 'pending';
    }

    if (vm.lastApplyLog?.result.success) {
      return 'completed';
    }

    if (vm.lastApplyLog && !vm.lastApplyLog.result.success) {
      if (currentApplyStepIndex >= 0) {
        if (index < currentApplyStepIndex) {
          return 'completed';
        }
        if (index === currentApplyStepIndex) {
          return 'failed';
        }
      }
      return 'pending';
    }

    return 'pending';
  };

  return (
    <section className="environment-proxy-page">
      <div className="environment-proxy-page-body">
        <div className="section-header environment-proxy-header">
          <h2>{activePage === 'nodes' ? '远程代理管理' : '部署代理'}</h2>
          <div className="section-actions">
            {activePage === 'nodes' ? (
              <>
                <button type="button" onClick={() => void vm.onLoadConfigs()} disabled={vm.listBusy || vm.actionBusy}>
                  {vm.listBusy ? '刷新中...' : '刷新配置'}
                </button>
                <button type="button" onClick={onOpenAddDialog} disabled={vm.actionBusy}>
                  添加订阅
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setActivePage('nodes')} disabled={vm.actionBusy}>
                返回订阅节点
              </button>
            )}
          </div>
        </div>

        {vm.message && <p className={vm.messageIsError ? 'status-line error' : 'status-line'}>{vm.message}</p>}

        {activePage === 'deploy' ? (
          <>
            <section className="host-card environment-proxy-card">
              <header className="host-card-header">
                <div>
                  <h3>部署代理</h3>
                  <p>选择订阅节点后，部署到目标服务器，并可查看远程状态。</p>
                </div>
                <span className="chip">Mihomo</span>
              </header>

              {vm.configs.length > 1 && (
                <label className="field-label">
                  订阅记录
                  <select value={selectedConfig?.id ?? ''} onChange={(event) => vm.setSelectedConfigId(event.target.value)}>
                    {vm.configs.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.subscription_url}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selectedConfig ? (
                <p className="status-line">当前订阅：{selectedConfig.subscription_url}</p>
              ) : (
                <p className="status-line">暂无订阅，请先返回添加订阅。</p>
              )}

              <div className="environment-proxy-form-grid">
                <label className="field-label">
                  目标服务器（必填）
                  <select value={applyProfileId} onChange={(event) => setApplyProfileId(event.target.value)} disabled={vm.actionBusy}>
                    <option value="">请选择服务器</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.username}@{profile.host}:{profile.port})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-label">
                  代理节点（必填）
                  <select
                    value={selectedDeployNode?.id ?? ''}
                    onChange={(event) => setDeployNodeId(event.target.value)}
                    disabled={vm.actionBusy || supportedNodes.length === 0}
                  >
                    {supportedNodes.length === 0 ? (
                      <option value="">当前无可部署节点</option>
                    ) : (
                      supportedNodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.name} ({node.server}:{node.port})
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="field-label">
                  部署模式（必选）
                  <div className="environment-proxy-mode-switch">
                    <label>
                      <input
                        type="radio"
                        name="mihomo-apply-mode"
                        value="application"
                        checked={applyMode === 'application'}
                        onChange={() => setApplyMode('application')}
                        disabled={vm.actionBusy}
                      />
                      应用层代理版
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="mihomo-apply-mode"
                        value="tun_global"
                        checked={applyMode === 'tun_global'}
                        onChange={() => setApplyMode('tun_global')}
                        disabled={vm.actionBusy}
                      />
                      tun 全局版
                    </label>
                  </div>
                </label>

                <label className="field-label">
                  本地代理端口（可选）
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={applyMixedPort}
                    onChange={(event) => setApplyMixedPort(Number(event.target.value) || 7890)}
                    disabled={vm.actionBusy || applyMode === 'tun_global'}
                  />
                </label>
              </div>

              <label className="environment-proxy-option">
                <input
                  type="checkbox"
                  checked={applyUseSudo}
                  onChange={(event) => setApplyUseSudo(event.target.checked)}
                  disabled={vm.actionBusy}
                />
                使用 sudo 权限（可选）
              </label>

              <section className="environment-proxy-guide">
                <p className="environment-proxy-guide-title">模式使用说明</p>
                <ol className="environment-proxy-guide-list">
                  <li>应用层代理版：仅“显式设置代理”的请求会走代理，不会接管整机流量。</li>
                  <li>
                    应用层代理地址：HTTP `{applicationHttpProxy}`，SOCKS5 `{applicationSocksProxy}`。
                  </li>
                  <li>应用层命令示例：`curl --proxy {applicationHttpProxy} https://google.com`。</li>
                  <li>
                    应用层环境变量示例：`http_proxy={applicationHttpProxy}`、
                    `https_proxy={applicationHttpProxy}`、`all_proxy={applicationSocksProxy}`。
                  </li>
                  <li>tun 全局版：由 tun 网卡接管系统流量，通常不需要给每个程序单独配置代理。</li>
                  <li>如果你只想让某些程序走代理，优先使用应用层代理版。</li>
                </ol>
              </section>

              <div className="card-actions">
                <button
                  type="button"
                  onClick={() => void vm.onCheckRuntimeStatus(applyProfileId, applyUseSudo)}
                  disabled={vm.actionBusy || vm.runtimeStatusBusy || !applyProfileId}
                >
                  {vm.runtimeStatusBusy ? '查询中...' : '查询远程状态'}
                </button>
                <button
                  type="button"
                  onClick={() => void onConfirmApply()}
                  disabled={vm.actionBusy || !selectedConfig || !selectedDeployNode || !applyProfileId}
                >
                  {vm.actionBusy ? '部署中...' : '应用到服务器'}
                </button>
                {vm.applyBusy && (
                  <button type="button" className="danger" onClick={() => void vm.onCancelApply()}>
                    取消部署
                  </button>
                )}
              </div>

              {vm.runtimeStatus && (
                <div className="environment-proxy-state-grid">
                  <p className="status-line">{vm.runtimeStatus.message}</p>
                  <p className="status-line">服务：{vm.runtimeStatus.service_name}</p>
                  <p className="status-line">配置路径：{vm.runtimeStatus.config_path}</p>
                  <p className="status-line">已安装 Mihomo：{vm.runtimeStatus.installed ? '是' : '否'}</p>
                  <p className="status-line">配置文件存在：{vm.runtimeStatus.config_exists ? '是' : '否'}</p>
                  <p className="status-line">服务运行中：{vm.runtimeStatus.active ? '是' : '否'}</p>
                  <p className="status-line">开机自启：{vm.runtimeStatus.enabled ? '是' : '否'}</p>
                  <p className="status-line">运行模式：{vm.runtimeStatus.mode || '-'}</p>
                  <p className="status-line">查询时间：{formatUnixTime(vm.runtimeStatus.checked_at)}</p>
                </div>
              )}
            </section>

            {vm.lastApplyLog && (
              <section className="host-card environment-proxy-card">
                <header className="host-card-header">
                  <div>
                    <h3>最近一次部署日志</h3>
                    <p>
                      节点：{vm.lastApplyLog.nodeName} · {vm.lastApplyLog.result.success ? '成功' : '失败'} · exit{' '}
                      {vm.lastApplyLog.result.exit_status}
                    </p>
                  </div>
                  <span className={vm.lastApplyLog.result.success ? 'chip environment-chip found' : 'chip'}>
                    {vm.lastApplyLog.result.success ? '成功' : '失败'}
                  </span>
                </header>

                <p className={vm.lastApplyLog.result.success ? 'status-line' : 'status-line error'}>
                  {vm.lastApplyLog.result.message}
                </p>
                <p className="status-line">记录时间：{new Date(vm.lastApplyLog.timestamp).toLocaleString()}</p>

                <div className="environment-proxy-log-grid">
                  <div className="environment-proxy-log-card">
                    <p className="environment-proxy-log-title">STDOUT</p>
                    <pre className="environment-proxy-log">{vm.lastApplyLog.result.stdout || '(empty)'}</pre>
                  </div>
                  <div className="environment-proxy-log-card">
                    <p className="environment-proxy-log-title">STDERR</p>
                    <pre className="environment-proxy-log stderr">{vm.lastApplyLog.result.stderr || '(empty)'}</pre>
                  </div>
                </div>
              </section>
            )}

            {(vm.applyBusy || vm.applyRealtimeLogs.length > 0) && (
              <section className="host-card environment-proxy-card">
                <header className="host-card-header">
                  <div>
                    <h3>Mihomo 部署实时进度</h3>
                    <p>{vm.applyBusy ? '正在执行部署，请留意步骤与日志输出。' : '最近一次部署实时日志回放。'}</p>
                  </div>
                  <span className={vm.applyBusy ? 'chip' : 'chip environment-chip found'}>{vm.applyBusy ? '进行中' : '已结束'}</span>
                </header>

                <ol className="environment-deploy-steps">
                  {MIHOMO_APPLY_STEPS.map((title, index) => (
                    <li key={`${title}-${index}`} className={`environment-deploy-step ${getStepState(index)}`}>
                      <p>
                        <span className="environment-deploy-step-order">{index + 1}</span>
                        <span className="environment-deploy-step-indicator" />
                        {title}
                      </p>
                    </li>
                  ))}
                </ol>

                <pre ref={realtimeLogRef} className="environment-proxy-log">
                  {vm.applyRealtimeLogs.join('\n') || '暂无实时日志'}
                </pre>
              </section>
            )}
          </>
        ) : vm.configs.length === 0 ? (
          <section className="host-card environment-proxy-card">
            <div className="empty-state">
              <p>还没有任何订阅解析结果。</p>
              <p>点击“添加订阅”输入订阅链接后即可解析节点。</p>
              <div className="card-actions">
                <button type="button" onClick={onOpenAddDialog} disabled={vm.actionBusy}>
                  添加订阅
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="host-card environment-proxy-card">
              <header className="host-card-header">
                <div>
                  <h3>订阅节点</h3>
                  <p>本页用于管理订阅与查看节点详情。</p>
                </div>
                <span className="chip">{selectedConfig ? `${selectedNodes.length} 个节点` : '未选择'}</span>
              </header>

              {vm.configs.length > 1 && (
                <label className="field-label">
                  订阅记录
                  <select value={selectedConfig?.id ?? ''} onChange={(event) => vm.setSelectedConfigId(event.target.value)}>
                    {vm.configs.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.subscription_url}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selectedConfig && (
                <>
                  <p className="status-line">订阅链接：{selectedConfig.subscription_url}</p>
                  <p className="status-line">最后更新：{formatUnixTime(selectedConfig.updated_at)}</p>
                </>
              )}

              <div className="card-actions">
                <button type="button" onClick={onOpenAddDialog} disabled={vm.actionBusy}>
                  更新订阅
                </button>
                {selectedConfig && (
                  <button
                    type="button"
                    onClick={() => void vm.onTestConnectivity(selectedConfig.id)}
                    disabled={vm.actionBusy}
                  >
                    {vm.actionBusy ? '测试中...' : '连通性测试'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActivePage('deploy')}
                  disabled={vm.actionBusy || !selectedConfig || supportedNodes.length === 0}
                >
                  部署代理
                </button>
                {selectedConfig && (
                  <button type="button" className="danger" onClick={() => setDeleteTarget(selectedConfig)} disabled={vm.actionBusy}>
                    删除当前订阅
                  </button>
                )}
              </div>
            </section>

            <section className="host-card environment-proxy-card">
              <header className="host-card-header">
                <div>
                  <h3>节点列表</h3>
                  <p>仅展示节点信息；部署请进入“部署代理”页面。</p>
                </div>
              </header>

              {selectedNodes.length === 0 ? (
                <div className="empty-state">当前订阅未解析到可展示节点。</div>
              ) : (
                <div className="environment-proxy-table-wrap">
                  <table className="environment-proxy-table">
                    <thead>
                      <tr>
                        <th>节点名称</th>
                        <th>协议</th>
                        <th>服务器</th>
                        <th>加密方式</th>
                        <th>插件</th>
                        <th>连通状态</th>
                        <th>耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedNodes.map((node) => {
                        const active = selectedConfig?.status === 'active' && selectedConfig.active_node_id === node.id;
                        return (
                          <tr key={node.id} className={active ? 'environment-proxy-row-active' : ''}>
                            <td title={node.raw_uri}>{node.name}</td>
                            <td>{node.protocol}</td>
                            <td>
                              {node.server}:{node.port}
                            </td>
                            <td>{node.method}</td>
                            <td>{node.plugin || '-'}</td>
                            <td>
                              <span className={`environment-proxy-status ${getConnectivityStatusTone(node)}`}>
                                {getConnectivityStatusLabel(node)}
                              </span>
                            </td>
                            <td>{getLatencyLabel(node)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {addDialogOpen && (
        <div className="systemd-confirm-overlay" role="dialog" aria-modal="true" aria-label="添加订阅">
          <div className="systemd-confirm-modal">
            <h3>添加订阅</h3>
            <label className="field-label">
              订阅链接（必填）
              <input
                {...noAssistTextInputProps}
                type="text"
                placeholder="https://example.com/api/v1/client/subscribe?token=..."
                value={addSubscriptionUrl}
                onChange={(event) => setAddSubscriptionUrl(event.target.value)}
                disabled={vm.actionBusy}
              />
            </label>
            <div className="card-actions systemd-confirm-actions">
              <button type="button" onClick={() => setAddDialogOpen(false)} disabled={vm.actionBusy}>
                取消
              </button>
              <button type="button" onClick={() => void onConfirmAddSubscription()} disabled={vm.actionBusy}>
                {vm.actionBusy ? '解析中...' : '解析订阅'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="systemd-confirm-overlay" role="dialog" aria-modal="true" aria-label="确认删除订阅配置">
          <div className="systemd-confirm-modal">
            <h3>确认删除</h3>
            <p>将删除当前订阅解析结果，不会删除远程服务器已存在的 Mihomo 服务。</p>
            <div className="card-actions systemd-confirm-actions">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={vm.actionBusy}>
                取消
              </button>
              <button type="button" className="danger" onClick={() => void onConfirmDelete()} disabled={vm.actionBusy}>
                {vm.actionBusy ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
