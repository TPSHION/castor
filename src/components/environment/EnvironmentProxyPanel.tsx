import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnixTime } from '../../app/helpers';
import { useEnvironmentProxy } from '../../app/hooks/environment/useEnvironmentProxy';
import type {
  ConnectionProfile,
  ProxyApplyMode,
  ProxyNode,
  ServerProxyConfig,
  ServerProxyRuntimeConfigSummary,
  ServerProxyRuntimeOutboundSummary
} from '../../types';

type StatusTone = 'pending' | 'active' | 'failed' | 'unknown';
type StepState = 'pending' | 'active' | 'completed' | 'failed';

const PROXY_APPLY_STEPS = [
  '准备权限与执行环境',
  '检查并安装 sing-box',
  '写入代理配置与服务文件',
  '重载并重启代理服务',
  '校验代理服务状态',
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

function shouldShowSubscriptionError(lastError?: string): boolean {
  const normalized = (lastError ?? '').trim();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith('apply proxy failed')) {
    return false;
  }
  if (normalized.includes('当前节点暂不支持自动部署')) {
    return false;
  }
  return true;
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

function normalizeHost(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeMethod(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeProtocol(value?: string): string {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'ss') {
    return 'shadowsocks';
  }
  return normalized;
}

function findRuntimeProxyOutbound(
  summary?: ServerProxyRuntimeConfigSummary
): ServerProxyRuntimeOutboundSummary | null {
  if (!summary || summary.outbounds.length === 0) {
    return null;
  }
  const candidates = summary.outbounds.filter(
    (item) => !!item.server && typeof item.server_port === 'number'
  );
  if (candidates.length === 0) {
    return null;
  }
  const finalTag = (summary.route_final ?? '').trim();
  if (finalTag) {
    const byFinalTag = candidates.find((item) => (item.tag ?? '').trim() === finalTag);
    if (byFinalTag) {
      return byFinalTag;
    }
  }
  return candidates.find((item) => item.tag === 'proxy') ?? candidates[0];
}

function nodeMatchesRuntimeOutbound(node: ProxyNode, outbound: ServerProxyRuntimeOutboundSummary): boolean {
  const outboundType = normalizeProtocol(outbound.type);
  if (outboundType && normalizeProtocol(node.protocol) !== outboundType) {
    return false;
  }
  if (normalizeHost(node.server) !== normalizeHost(outbound.server)) {
    return false;
  }
  if (node.port !== outbound.server_port) {
    return false;
  }
  const remoteMethod = normalizeMethod(outbound.method);
  if (!remoteMethod) {
    return true;
  }
  return normalizeMethod(node.method) === remoteMethod;
}

function detectApplyModeFromSummary(summary?: ServerProxyRuntimeConfigSummary): ProxyApplyMode {
  if (!summary) {
    return 'application';
  }
  const hasTunInbound = summary.inbounds.some((item) => normalizeProtocol(item.type) === 'tun');
  return hasTunInbound ? 'tun_global' : 'application';
}

export function EnvironmentProxyPanel({ profiles }: { profiles: ConnectionProfile[] }) {
  const vm = useEnvironmentProxy(profiles);
  const [activePage, setActivePage] = useState<'nodes' | 'remote_config'>('nodes');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSubscriptionUrl, setAddSubscriptionUrl] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ServerProxyConfig | null>(null);
  const [applyTarget, setApplyTarget] = useState<{ config: ServerProxyConfig; node: ProxyNode } | null>(null);
  const [applyProfileId, setApplyProfileId] = useState(profiles[0]?.id ?? '');
  const [applyUseSudo, setApplyUseSudo] = useState(true);
  const [applyMixedPort, setApplyMixedPort] = useState(7890);
  const [applyMode, setApplyMode] = useState<ProxyApplyMode>('application');
  const [remoteConfigNodeId, setRemoteConfigNodeId] = useState('');
  const realtimeLogRef = useRef<HTMLPreElement | null>(null);
  const selectedConfig = vm.selectedConfig;
  const selectedNodes = useMemo(() => selectedConfig?.nodes ?? [], [selectedConfig?.nodes]);
  const supportedNodes = useMemo(() => selectedNodes.filter((item) => item.supported), [selectedNodes]);
  const currentRuntimeStatus = useMemo(() => {
    if (!vm.runtimeStatus || !applyProfileId) {
      return null;
    }
    return vm.runtimeStatus.profile_id === applyProfileId ? vm.runtimeStatus : null;
  }, [applyProfileId, vm.runtimeStatus]);
  const currentRuntimeConfig = useMemo(() => {
    if (!vm.runtimeConfig || !applyProfileId) {
      return null;
    }
    return vm.runtimeConfig.profile_id === applyProfileId ? vm.runtimeConfig : null;
  }, [applyProfileId, vm.runtimeConfig]);
  const runtimeMatchedNode = useMemo(() => {
    const outbound = findRuntimeProxyOutbound(currentRuntimeConfig?.summary);
    if (!outbound) {
      return null;
    }
    for (const config of vm.configs) {
      for (const node of config.nodes) {
        if (!node.supported) {
          continue;
        }
        if (nodeMatchesRuntimeOutbound(node, outbound)) {
          return { config, node };
        }
      }
    }
    return null;
  }, [currentRuntimeConfig?.summary, vm.configs]);
  const remoteConfigSource = useMemo(() => {
    if (runtimeMatchedNode) {
      return runtimeMatchedNode.config;
    }
    if (applyProfileId) {
      const scopedConfigs = vm.configs.filter((item) => item.profile_id === applyProfileId);
      if (scopedConfigs.length > 0) {
        return scopedConfigs.find((item) => item.status === 'active' && !!item.active_node_id) ?? scopedConfigs[0];
      }
    }
    return selectedConfig ?? null;
  }, [applyProfileId, runtimeMatchedNode, selectedConfig, vm.configs]);
  const remoteConfigNodes = useMemo(() => remoteConfigSource?.nodes ?? [], [remoteConfigSource]);
  const remoteSupportedNodes = useMemo(
    () => remoteConfigNodes.filter((item) => item.supported),
    [remoteConfigNodes]
  );
  const selectedRemoteConfigNode = useMemo(
    () =>
      remoteSupportedNodes.find((item) => item.id === remoteConfigNodeId) ??
      remoteSupportedNodes[0] ??
      null,
    [remoteConfigNodeId, remoteSupportedNodes]
  );
  const currentApplyStepIndex = useMemo(
    () => parseCurrentApplyStepIndex(vm.applyRealtimeLogs),
    [vm.applyRealtimeLogs]
  );
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
    if (!applyTarget) {
      return;
    }
    const preferredProfileId = applyTarget.config.profile_id;
    if (preferredProfileId && profiles.some((item) => item.id === preferredProfileId)) {
      setApplyProfileId(preferredProfileId);
    }
  }, [applyTarget, profiles]);

  const onCheckRuntimeStatus = vm.onCheckRuntimeStatus;
  const onLoadRuntimeConfig = vm.onLoadRuntimeConfig;

  useEffect(() => {
    if (activePage !== 'remote_config' || !applyProfileId) {
      return;
    }
    void onCheckRuntimeStatus(applyProfileId, applyUseSudo);
    void onLoadRuntimeConfig(applyProfileId, applyUseSudo);
  }, [activePage, applyProfileId, applyUseSudo, onCheckRuntimeStatus, onLoadRuntimeConfig]);

  useEffect(() => {
    if (activePage !== 'remote_config') {
      return;
    }
    if (!currentRuntimeConfig?.summary) {
      return;
    }
    const detectedMode = detectApplyModeFromSummary(currentRuntimeConfig.summary);
    setApplyMode((previous) => (previous === detectedMode ? previous : detectedMode));
  }, [activePage, currentRuntimeConfig?.summary, currentRuntimeConfig?.checked_at]);

  useEffect(() => {
    if (remoteSupportedNodes.length === 0) {
      setRemoteConfigNodeId('');
      return;
    }
    if (
      !remoteConfigNodeId ||
      !remoteSupportedNodes.some((item) => item.id === remoteConfigNodeId)
    ) {
      setRemoteConfigNodeId(remoteSupportedNodes[0].id);
    }
  }, [remoteConfigNodeId, remoteSupportedNodes]);

  useEffect(() => {
    if (!runtimeMatchedNode) {
      return;
    }
    if (remoteConfigSource?.id !== runtimeMatchedNode.config.id) {
      return;
    }
    if (remoteConfigNodeId && remoteConfigNodeId === runtimeMatchedNode.node.id) {
      return;
    }
    if (!remoteConfigNodeId) {
      setRemoteConfigNodeId(runtimeMatchedNode.node.id);
      return;
    }
    if (!remoteSupportedNodes.some((item) => item.id === remoteConfigNodeId)) {
      setRemoteConfigNodeId(runtimeMatchedNode.node.id);
    }
  }, [remoteConfigNodeId, remoteConfigSource?.id, remoteSupportedNodes, runtimeMatchedNode]);

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
    const target = deleteTarget;
    setDeleteTarget(null);
    await vm.onDeleteConfig(target.id);
  };

  const onConfirmApply = async () => {
    if (!applyTarget) {
      return;
    }
    const success = await vm.onApplyNode(
      applyTarget.config,
      applyTarget.node,
      applyProfileId,
      applyUseSudo,
      applyMixedPort,
      applyMode
    );
    if (success) {
      setApplyTarget(null);
    }
  };

  const onDeployFromRemoteConfig = async () => {
    if (!remoteConfigSource || !selectedRemoteConfigNode) {
      return;
    }
    await vm.onApplyNode(
      remoteConfigSource,
      selectedRemoteConfigNode,
      applyProfileId,
      applyUseSudo,
      applyMixedPort,
      applyMode
    );
  };

  const getStepState = (index: number): StepState => {
    if (vm.applyBusy) {
      if (currentApplyStepIndex < 0) {
        return 'pending';
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
          <h2>{activePage === 'nodes' ? '远程代理管理' : '远程代理配置管理'}</h2>
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

        {activePage === 'remote_config' ? (
          <section className="host-card environment-proxy-card">
            <header className="host-card-header">
              <div>
                <h3>远程代理配置</h3>
                <p>管理“应用到服务器”时默认使用的远程代理参数。</p>
              </div>
              <span className="chip">配置中心</span>
            </header>

            <div className="environment-proxy-form-grid">
              <label className="field-label environment-proxy-field-wide">
                默认部署模式
                <div className="environment-proxy-mode-switch">
                  <label>
                    <input
                      type="radio"
                      name="proxy-apply-mode-default"
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
                      name="proxy-apply-mode-default"
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
                默认目标服务器
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
                默认代理端口
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

            <p className="status-line">
              当前模式：{applyMode === 'application' ? '应用层代理版（仅对显式使用代理的程序生效）' : 'tun 全局版（系统流量由 tun 接管）'}
            </p>
            <label className="environment-proxy-option">
              <input
                type="checkbox"
                checked={applyUseSudo}
                onChange={(event) => setApplyUseSudo(event.target.checked)}
                disabled={vm.actionBusy}
              />
              默认使用 sudo 权限
            </label>

            <p className="status-line">
              这些配置会作为“应用到服务器”弹窗与本页部署操作的默认值。
            </p>
            {remoteConfigSource ? (
              <p className="status-line">节点来源订阅：{remoteConfigSource.subscription_url}</p>
            ) : (
              <p className="status-line">当前无可用订阅节点，请先在“远程代理管理”解析订阅。</p>
            )}
            {currentRuntimeConfig?.config_exists && (
              <p className="status-line">
                {runtimeMatchedNode
                  ? `已匹配远程当前节点：${runtimeMatchedNode.node.name} (${runtimeMatchedNode.node.server}:${runtimeMatchedNode.node.port})`
                  : '未在本地订阅中匹配到远程当前节点，请更新订阅后重试。'}
              </p>
            )}

            <div className="card-actions">
              <button
                type="button"
                onClick={() => void vm.onCheckRuntimeStatus(applyProfileId, applyUseSudo)}
                disabled={vm.actionBusy || vm.runtimeStatusBusy || !applyProfileId}
              >
                {vm.runtimeStatusBusy ? '查询中...' : '查询远程代理状态'}
              </button>
              <button
                type="button"
                onClick={() => void vm.onLoadRuntimeConfig(applyProfileId, applyUseSudo)}
                disabled={vm.actionBusy || vm.runtimeConfigBusy || !applyProfileId}
              >
                {vm.runtimeConfigBusy ? '读取中...' : '获取远程配置'}
              </button>
            </div>

            {currentRuntimeStatus && (
              <div className="environment-proxy-state-grid">
                <p className="status-line">{currentRuntimeStatus.message}</p>
                <p className="status-line">服务：{currentRuntimeStatus.service_name}</p>
                <p className="status-line">已安装 sing-box：{currentRuntimeStatus.installed ? '是' : '否'}</p>
                <p className="status-line">配置文件存在：{currentRuntimeStatus.config_exists ? '是' : '否'}</p>
                <p className="status-line">服务运行中：{currentRuntimeStatus.active ? '是' : '否'}</p>
                <p className="status-line">开机自启：{currentRuntimeStatus.enabled ? '是' : '否'}</p>
                <p className="status-line">查询时间：{formatUnixTime(currentRuntimeStatus.checked_at)}</p>
              </div>
            )}

            {currentRuntimeConfig && (
              <div className="environment-proxy-state-grid">
                <p className="status-line">{currentRuntimeConfig.message}</p>
                <p className="status-line">配置路径：{currentRuntimeConfig.config_path}</p>
                <p className="status-line">读取时间：{formatUnixTime(currentRuntimeConfig.checked_at)}</p>
                {currentRuntimeConfig.parse_error && (
                  <p className="status-line error">配置解析提示：{currentRuntimeConfig.parse_error}</p>
                )}

                {currentRuntimeConfig.summary && (
                  <>
                    <div className="environment-proxy-summary-grid">
                      <article className="environment-proxy-summary-card">
                        <p className="environment-proxy-summary-label">入站数量</p>
                        <p className="environment-proxy-summary-value">
                          {currentRuntimeConfig.summary.inbound_count}
                        </p>
                      </article>
                      <article className="environment-proxy-summary-card">
                        <p className="environment-proxy-summary-label">出站数量</p>
                        <p className="environment-proxy-summary-value">
                          {currentRuntimeConfig.summary.outbound_count}
                        </p>
                      </article>
                      <article className="environment-proxy-summary-card">
                        <p className="environment-proxy-summary-label">路由默认出口</p>
                        <p className="environment-proxy-summary-value">
                          {currentRuntimeConfig.summary.route_final || '(未设置)'}
                        </p>
                      </article>
                      <article className="environment-proxy-summary-card">
                        <p className="environment-proxy-summary-label">路由规则数</p>
                        <p className="environment-proxy-summary-value">
                          {currentRuntimeConfig.summary.route_rule_count}
                        </p>
                      </article>
                    </div>

                    <div className="environment-proxy-log-grid">
                      <div className="environment-proxy-log-card">
                        <p className="environment-proxy-log-title">入站明细</p>
                        <div className="environment-proxy-table-wrap">
                          <table className="environment-proxy-table environment-proxy-table-compact">
                            <thead>
                              <tr>
                                <th>tag</th>
                                <th>type</th>
                                <th>listen</th>
                                <th>port</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentRuntimeConfig.summary.inbounds.length === 0 ? (
                                <tr>
                                  <td colSpan={4}>暂无入站配置</td>
                                </tr>
                              ) : (
                                currentRuntimeConfig.summary.inbounds.map((inbound, index) => (
                                  <tr key={`${inbound.tag ?? inbound.type}-${index}`}>
                                    <td>{inbound.tag || '-'}</td>
                                    <td>{inbound.type}</td>
                                    <td>{inbound.listen || '-'}</td>
                                    <td>{typeof inbound.listen_port === 'number' ? inbound.listen_port : '-'}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="environment-proxy-log-card">
                        <p className="environment-proxy-log-title">出站明细</p>
                        <div className="environment-proxy-table-wrap">
                          <table className="environment-proxy-table environment-proxy-table-compact">
                            <thead>
                              <tr>
                                <th>tag</th>
                                <th>type</th>
                                <th>server</th>
                                <th>port</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentRuntimeConfig.summary.outbounds.length === 0 ? (
                                <tr>
                                  <td colSpan={4}>暂无出站配置</td>
                                </tr>
                              ) : (
                                currentRuntimeConfig.summary.outbounds.map((outbound, index) => (
                                  <tr key={`${outbound.tag ?? outbound.type}-${index}`}>
                                    <td>{outbound.tag || '-'}</td>
                                    <td>{outbound.type}</td>
                                    <td>{outbound.server || '-'}</td>
                                    <td>{typeof outbound.server_port === 'number' ? outbound.server_port : '-'}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {currentRuntimeConfig.raw_config && (
                  <details className="environment-proxy-raw-json">
                    <summary>查看原始 sing-box 配置 JSON</summary>
                    <pre className="environment-proxy-log">{currentRuntimeConfig.raw_config}</pre>
                  </details>
                )}
              </div>
            )}

            {remoteConfigSource && (
              <div className="environment-proxy-form-grid">
                <label className="field-label environment-proxy-field-wide">
                  代理节点
                  <select
                    value={selectedRemoteConfigNode?.id ?? ''}
                    onChange={(event) => setRemoteConfigNodeId(event.target.value)}
                    disabled={vm.actionBusy || remoteSupportedNodes.length === 0}
                  >
                    {remoteSupportedNodes.length === 0 ? (
                      <option value="">当前无可部署节点</option>
                    ) : (
                      remoteSupportedNodes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.server}:{item.port}){' '}
                          {typeof item.latency_ms === 'number' ? `· ${item.latency_ms}ms` : ''}
                          {runtimeMatchedNode?.node.id === item.id ? ' · 远程当前生效' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
            )}

            <div className="card-actions">
              <button
                type="button"
                onClick={() => void onDeployFromRemoteConfig()}
                disabled={vm.actionBusy || !remoteConfigSource || !selectedRemoteConfigNode || !applyProfileId}
              >
                {vm.actionBusy ? '应用中...' : currentRuntimeStatus?.active ? '应用/切换节点' : '部署代理配置'}
              </button>
              {vm.applyBusy && (
                <button type="button" className="danger" onClick={() => void vm.onCancelApply()}>
                  取消部署
                </button>
              )}
            </div>
          </section>
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
                  <p>当前页面仅展示订阅解析得到的节点；应用时再选择目标服务器。</p>
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
                  {shouldShowSubscriptionError(selectedConfig.last_error) && (
                    <p className="status-line error">最近错误：{selectedConfig.last_error}</p>
                  )}
                </>
              )}

              <div className="card-actions">
                <button type="button" onClick={onOpenAddDialog} disabled={vm.actionBusy}>
                  更新订阅
                </button>
                <button type="button" onClick={() => setActivePage('remote_config')} disabled={vm.actionBusy}>
                  远程代理配置
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
                  <p>点击“应用到服务器”时会弹出服务器选择。</p>
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
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedNodes.map((node) => {
                        const active = selectedConfig?.status === 'active' && selectedConfig?.active_node_id === node.id;
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
                              <span
                                className={`environment-proxy-status ${getConnectivityStatusTone(node)}`}
                                title={node.reachability_error || ''}
                              >
                                {getConnectivityStatusLabel(node)}
                              </span>
                            </td>
                            <td>{getLatencyLabel(node)}</td>
                            <td>
                              <div className="environment-proxy-row-actions">
                                <button
                                  type="button"
                                  onClick={() => selectedConfig && setApplyTarget({ config: selectedConfig, node })}
                                  disabled={vm.actionBusy || !node.supported || profiles.length === 0}
                                  title={
                                    !node.supported
                                      ? node.unsupported_reason ?? '该节点当前不支持自动部署'
                                      : profiles.length === 0
                                        ? '暂无可用服务器，请先新增服务器'
                                        : ''
                                  }
                                >
                                  {active ? '重新应用' : '应用到服务器'}
                                </button>
                              </div>
                            </td>
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

        {vm.lastApplyLog && (
          <section className="host-card environment-proxy-card">
            <header className="host-card-header">
              <div>
                <h3>最近一次应用日志</h3>
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
                <h3>代理部署实时进度</h3>
                <p>{vm.applyBusy ? '正在执行代理部署，请留意步骤与日志输出。' : '最近一次部署实时日志回放。'}</p>
              </div>
              <span className={vm.applyBusy ? 'chip' : 'chip environment-chip found'}>{vm.applyBusy ? '进行中' : '已结束'}</span>
            </header>

            <ol className="environment-deploy-steps">
              {PROXY_APPLY_STEPS.map((title, index) => (
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

      {applyTarget && (
        <div className="systemd-confirm-overlay" role="dialog" aria-modal="true" aria-label="应用代理配置">
          <div className="systemd-confirm-modal">
            <h3>应用代理配置</h3>
            <p>
              节点：{applyTarget.node.name}（{applyTarget.node.server}:{applyTarget.node.port}）
            </p>

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

            <label className="field-label">
              部署模式（必选）
              <div className="environment-proxy-mode-switch">
                <label>
                  <input
                    type="radio"
                    name="proxy-apply-mode-modal"
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
                    name="proxy-apply-mode-modal"
                    value="tun_global"
                    checked={applyMode === 'tun_global'}
                    onChange={() => setApplyMode('tun_global')}
                    disabled={vm.actionBusy}
                  />
                  tun 全局版
                </label>
              </div>
            </label>

            <p className="status-line">
              {applyMode === 'application'
                ? '应用层代理版：需要应用显式使用 http/socks 代理地址。'
                : 'tun 全局版：由 sing-box 创建 tun 接口接管系统流量。'}
            </p>

            <label className="environment-proxy-option">
              <input
                type="checkbox"
                checked={applyUseSudo}
                onChange={(event) => setApplyUseSudo(event.target.checked)}
                disabled={vm.actionBusy}
              />
              使用 sudo 权限
            </label>

            <div className="card-actions systemd-confirm-actions">
              <button type="button" onClick={() => setApplyTarget(null)} disabled={vm.actionBusy}>
                取消
              </button>
              <button type="button" onClick={() => void onConfirmApply()} disabled={vm.actionBusy || profiles.length === 0}>
                {vm.actionBusy ? '应用中...' : '确认应用'}
              </button>
              {vm.applyBusy && (
                <button type="button" className="danger" onClick={() => void vm.onCancelApply()}>
                  取消部署
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="systemd-confirm-overlay" role="dialog" aria-modal="true" aria-label="确认删除代理订阅配置">
          <div className="systemd-confirm-modal">
            <h3>确认删除</h3>
            <p>将删除当前订阅解析结果，不会删除远程服务器已存在的代理服务。</p>
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
