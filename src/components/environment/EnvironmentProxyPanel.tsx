import { useEffect, useMemo, useState } from 'react';
import { formatUnixTime } from '../../app/helpers';
import { useEnvironmentProxy } from '../../app/hooks/environment/useEnvironmentProxy';
import type { ConnectionProfile, ProxyNode, ServerProxyConfig } from '../../types';

type StatusTone = 'pending' | 'active' | 'failed' | 'unknown';

function getConfigStatusTone(status: string): StatusTone {
  if (status === 'active') {
    return 'active';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'pending') {
    return 'pending';
  }
  return 'unknown';
}

function getNodeStatusLabel(node: ProxyNode, activeNodeId?: string) {
  if (!node.supported) {
    return '不支持';
  }
  if (activeNodeId === node.id) {
    return '当前生效';
  }
  return '可用';
}

function getNodeStatusTone(node: ProxyNode, activeNodeId?: string): StatusTone {
  if (!node.supported) {
    return 'failed';
  }
  if (activeNodeId === node.id) {
    return 'active';
  }
  return 'pending';
}

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

export function EnvironmentProxyPanel({ profiles }: { profiles: ConnectionProfile[] }) {
  const vm = useEnvironmentProxy(profiles);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSubscriptionUrl, setAddSubscriptionUrl] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ServerProxyConfig | null>(null);
  const [applyTarget, setApplyTarget] = useState<{ config: ServerProxyConfig; node: ProxyNode } | null>(null);
  const [applyProfileId, setApplyProfileId] = useState(profiles[0]?.id ?? '');
  const [applyUseSudo, setApplyUseSudo] = useState(true);
  const [applyMixedPort, setApplyMixedPort] = useState(7890);
  const selectedConfig = vm.selectedConfig;
  const selectedNodes = useMemo(() => selectedConfig?.nodes ?? [], [selectedConfig?.nodes]);
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
      applyMixedPort
    );
    if (success) {
      setApplyTarget(null);
    }
  };

  return (
    <section className="environment-proxy-page">
      <div className="environment-proxy-page-body">
        <div className="section-header environment-proxy-header">
          <h2>远程代理管理</h2>
          <div className="section-actions">
            <button type="button" onClick={() => void vm.onLoadConfigs()} disabled={vm.listBusy || vm.actionBusy}>
              {vm.listBusy ? '刷新中...' : '刷新配置'}
            </button>
            <button type="button" onClick={onOpenAddDialog} disabled={vm.actionBusy}>
              添加订阅
            </button>
          </div>
        </div>

        {vm.message && <p className={vm.messageIsError ? 'status-line error' : 'status-line'}>{vm.message}</p>}

        {vm.configs.length === 0 ? (
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
                  <p className="status-line">
                    当前状态：
                    <span className={`environment-proxy-status ${getConfigStatusTone(selectedConfig.status)}`}>
                      {selectedConfig.status}
                    </span>
                  </p>
                  <p className="status-line">最后更新：{formatUnixTime(selectedConfig.updated_at)}</p>
                  {selectedConfig.last_error && <p className="status-line error">最近错误：{selectedConfig.last_error}</p>}
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
                        <th>测试时间</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedNodes.map((node) => {
                        const statusTone = getNodeStatusTone(node, selectedConfig?.active_node_id);
                        const statusLabel = getNodeStatusLabel(node, selectedConfig?.active_node_id);
                        const active = selectedConfig?.active_node_id === node.id;
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
                            <td>{node.tested_at ? formatUnixTime(node.tested_at) : '-'}</td>
                            <td>
                              <span className={`environment-proxy-status ${statusTone}`}>{statusLabel}</span>
                            </td>
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
                disabled={vm.actionBusy}
              />
            </label>

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
