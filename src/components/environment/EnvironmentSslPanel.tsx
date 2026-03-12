import { useState } from 'react';
import type { ConnectionProfile } from '../../types';
import type { SslCertificate } from '../../types';
import { useSslCertificates } from '../../app/hooks/environment/useSslCertificates';

function buildFailureHints(stepKey?: string, challengeType?: 'http' | 'dns'): string[] {
  if (stepKey === 'client_ready') {
    return [
      '检查服务器是否可访问公网，并可下载 acme.sh（curl/wget）。',
      '确认当前登录用户有执行安装脚本的权限。',
      '若服务器受限网络，先手动安装 acme.sh 再重试。'
    ];
  }

  if (stepKey === 'request_done') {
    if (challengeType === 'dns') {
      return [
        '核对 DNS 提供商标识是否正确（如 dns_cf / dns_ali）。',
        '确认 DNS 环境变量键名和值完整，API 权限包含解析记录管理。',
        '检查域名 DNS 生效情况，必要时等待传播后重试。'
      ];
    }
    return [
      '确认域名 A/AAAA 记录已指向当前服务器。',
      '确认 80 端口可被公网访问，且 WebRoot 路径正确。',
      '在服务器上检查挑战文件目录是否可写并可被访问。'
    ];
  }

  if (stepKey === 'deploy_done') {
    return [
      '确认 key/fullchain 输出目录存在且当前用户可写。',
      '若配置了后置命令，确认命令可执行且权限足够（如 reload）。',
      '建议先排查部署目录权限与服务重载命令，再重试当前操作。'
    ];
  }

  if (stepKey === 'renew_plan_done') {
    return [
      '确认服务器已安装 crontab，且当前用户可写入计划任务。',
      '检查 crond/cron 服务是否正常运行。',
      '修复后点击“重试当前操作”即可重新写入续期计划。'
    ];
  }

  if (stepKey === 'metadata_done') {
    return [
      '确认 fullchain 文件路径正确且证书文件已落盘。',
      '确认服务器可执行 openssl 命令读取证书元信息。',
      '先执行“同步证书状态”，再决定是否重试操作。'
    ];
  }

  return ['查看下方 STDERR 关键报错信息，修复后点击“重试当前操作”。'];
}

export function EnvironmentSslPanel({ profiles }: { profiles: ConnectionProfile[] }) {
  const vm = useSslCertificates(profiles);
  const [pageMode, setPageMode] = useState<'list' | 'form'>('list');
  const [deleteTarget, setDeleteTarget] = useState<SslCertificate | null>(null);
  const lastOperationLog = vm.lastOperationLog;
  const noAssistTextInputProps = {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'none',
    spellCheck: false
  } as const;
  const operationLabel = !lastOperationLog
    ? ''
    : lastOperationLog.mode === 'issue_only'
      ? '仅申请'
      : lastOperationLog.mode === 'issue_deploy'
        ? '申请并部署'
        : '续期并部署';
  const failedStep = lastOperationLog?.steps.find((step) => step.status === 'failed');
  const currentCertificate = lastOperationLog?.certificateId
    ? vm.certificates.find((item) => item.id === lastOperationLog.certificateId) ?? null
    : null;
  const lastCertificateId = lastOperationLog?.certificateId ?? undefined;
  const failureHints = buildFailureHints(failedStep?.key, currentCertificate?.challenge_type);
  const openCreatePage = () => {
    vm.onResetDraft();
    setPageMode('form');
  };
  const openEditPage = (item: SslCertificate) => {
    vm.onPickCertificate(item);
    setPageMode('form');
  };
  const backToList = () => setPageMode('list');
  const onConfirmDeleteCertificate = async () => {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    setDeleteTarget(null);
    await vm.onDeleteCertificate(target.id);
  };

  return (
    <section className="environment-ssl-page">
      {profiles.length === 0 ? (
        <div className="empty-state">暂无服务器配置，请先新增服务器。</div>
      ) : (
        <>
          <div className="environment-profile-bar">
            <label className="field-label">
              目标服务器
              <select
                className="sftp-profile-select"
                value={vm.selectedProfileId}
                onChange={(event) => vm.setSelectedProfileId(event.target.value)}
                disabled={vm.actionBusy || vm.listBusy}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.username}@{profile.host}:{profile.port})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="environment-ssl-page-body">
            <div className="section-header environment-ssl-header">
              <h2>{pageMode === 'list' ? 'SSL证书列表' : vm.editingCertificateId ? '编辑证书配置' : '新增证书配置'}</h2>
              <div className="section-actions">
                {pageMode === 'list' ? (
                  <>
                    <button type="button" onClick={() => void vm.onLoadCertificates()} disabled={vm.actionBusy || vm.listBusy}>
                      {vm.listBusy ? '刷新中...' : '刷新列表'}
                    </button>
                    <button type="button" onClick={openCreatePage} disabled={vm.actionBusy}>
                      新增证书配置
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={backToList} disabled={vm.actionBusy}>
                    返回列表
                  </button>
                )}
              </div>
            </div>

            {vm.message && <p className={vm.messageIsError ? 'status-line error' : 'status-line'}>{vm.message}</p>}

            {pageMode === 'form' && (
              <section className="host-card environment-ssl-card">
              <header className="host-card-header">
                <div>
                  <h3>{vm.editingCertificateId ? '编辑证书配置' : '新建证书配置'}</h3>
                  <p>配置 Let&apos;s Encrypt 申请参数、证书落盘路径与自动续期策略。</p>
                </div>
                <span className="chip">ACME</span>
              </header>

              <div className="environment-ssl-form-grid">
                <label className="field-label">
                  域名（必填）
                  <input
                    {...noAssistTextInputProps}
                    type="text"
                    placeholder="example.com 或 *.example.com"
                    value={vm.draft.domain}
                    onChange={(event) => vm.onPatchDraft({ domain: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label">
                  通知邮箱（可选）
                  <input
                    {...noAssistTextInputProps}
                    type="email"
                    placeholder="ops@example.com"
                    value={vm.draft.email}
                    onChange={(event) => vm.onPatchDraft({ email: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label">
                  挑战方式（必填）
                  <select
                    value={vm.draft.challengeType}
                    onChange={(event) => vm.onPatchDraft({ challengeType: event.target.value as 'http' | 'dns' })}
                    disabled={vm.actionBusy}
                  >
                    <option value="http">HTTP-01（WebRoot）</option>
                    <option value="dns">DNS-01（DNS API）</option>
                  </select>
                </label>

                {vm.draft.challengeType === 'http' ? (
                  <label className="field-label">
                    WebRoot 路径（HTTP 必填）
                    <input
                      {...noAssistTextInputProps}
                      type="text"
                      value={vm.draft.webrootPath}
                      onChange={(event) => vm.onPatchDraft({ webrootPath: event.target.value })}
                      disabled={vm.actionBusy}
                    />
                  </label>
                ) : (
                  <label className="field-label">
                    DNS 提供商标识（DNS 必填）
                    <input
                      {...noAssistTextInputProps}
                      type="text"
                      placeholder="dns_cf / dns_ali / dns_dp"
                      value={vm.draft.dnsProvider}
                      onChange={(event) => vm.onPatchDraft({ dnsProvider: event.target.value })}
                      disabled={vm.actionBusy}
                    />
                  </label>
                )}

                {vm.draft.challengeType === 'dns' && (
                  <label className="field-label environment-ssl-field-wide">
                    DNS 环境变量（DNS 按需，每行 KEY=VALUE）
                    <textarea
                      {...noAssistTextInputProps}
                      rows={4}
                      placeholder={'CF_Token=xxx\nCF_Account_ID=xxx'}
                      value={vm.draft.dnsEnvText}
                      onChange={(event) => vm.onPatchDraft({ dnsEnvText: event.target.value })}
                      disabled={vm.actionBusy}
                    />
                  </label>
                )}

                <label className="field-label">
                  证书私钥路径（必填）
                  <input
                    {...noAssistTextInputProps}
                    type="text"
                    placeholder={vm.pathExamples.keyFile}
                    value={vm.draft.keyFile}
                    onChange={(event) => vm.onPatchDraft({ keyFile: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label">
                  证书链路径（fullchain，必填）
                  <input
                    {...noAssistTextInputProps}
                    type="text"
                    placeholder={vm.pathExamples.fullchainFile}
                    value={vm.draft.fullchainFile}
                    onChange={(event) => vm.onPatchDraft({ fullchainFile: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label environment-ssl-field-wide">
                  申请/续期后执行命令（可选）
                  <input
                    {...noAssistTextInputProps}
                    type="text"
                    placeholder="例如：systemctl reload my-service"
                    value={vm.draft.reloadCommand}
                    onChange={(event) => vm.onPatchDraft({ reloadCommand: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="environment-ssl-option">
                  <input
                    type="checkbox"
                    checked={vm.draft.autoRenewEnabled}
                    onChange={(event) => vm.onPatchDraft({ autoRenewEnabled: event.target.checked })}
                    disabled={vm.actionBusy}
                  />
                  启用自动续期（写入远端 crontab）
                </label>

                <label className="field-label">
                  续期阈值（天，必填）
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={vm.draft.renewBeforeDays}
                    onChange={(event) => vm.onPatchDraft({ renewBeforeDays: Number(event.target.value) || 1 })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label">
                  续期执行时间（必填）
                  <input
                    type="time"
                    value={vm.draft.renewAt}
                    onChange={(event) => vm.onPatchDraft({ renewAt: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>
              </div>

              <div className="card-actions">
                <button type="button" onClick={() => void vm.onSaveDraft()} disabled={vm.actionBusy}>
                  {vm.actionBusy ? '处理中...' : vm.editingCertificateId ? '保存配置' : '创建配置'}
                </button>
                <button type="button" onClick={vm.onResetDraft} disabled={vm.actionBusy}>
                  重置表单
                </button>
              </div>

              <div className="environment-ssl-guide">
                <p className="environment-ssl-guide-title">流程说明（简洁版）</p>
                <p className="environment-ssl-guide-subtitle">前置要求</p>
                <ul className="environment-ssl-guide-prereq">
                  <li>目标域名已解析到当前服务器（HTTP-01）或已准备可用的 DNS API 凭据（DNS-01）。</li>
                  <li>服务器可访问公网，并可连接 Let&apos;s Encrypt / acme.sh 所需地址。</li>
                  <li>远程账号对证书输出目录有写权限，必要时可执行 `sudo`/服务重载命令。</li>
                  <li>HTTP-01 场景需确保 80 端口可访问，且 `WebRoot` 指向站点实际根目录。</li>
                  <li>DNS-01 场景需填写正确的 DNS 提供商标识及对应环境变量（按提供商文档）。</li>
                </ul>
                <ol className="environment-ssl-guide-list">
                  <li>准备 ACME 客户端：检查并安装 `acme.sh`。</li>
                  <li>域名验证并签发：执行 HTTP-01 / DNS-01 挑战。</li>
                  <li>可选部署：写入 key/fullchain 并执行后置命令（仅“申请并部署/续期”执行）。</li>
                  <li>自动续期计划：按配置写入远端 crontab（部署模式）。</li>
                  <li>同步元信息：回填签发方、有效期、状态。</li>
                </ol>
                <p className="environment-ssl-guide-tip">执行时会在下方“最近一次执行日志”实时显示每一步状态，便于定位卡点。</p>
              </div>
            </section>
            )}

            {pageMode === 'list' && (
              <>
                <section className="host-card environment-ssl-card">
              <header className="host-card-header">
                <div>
                  <h3>已管理证书</h3>
                  <p>支持证书申请、续期、状态同步与配置编辑。</p>
                </div>
                <span className="chip">{vm.certificates.length} 条</span>
              </header>

              {vm.certificates.length === 0 ? (
                <div className="empty-state">暂无证书配置。</div>
              ) : (
                <div className="environment-ssl-table-wrap">
                  <table className="environment-ssl-table">
                    <thead>
                      <tr>
                        <th>域名</th>
                        <th>状态</th>
                        <th>挑战方式</th>
                        <th>到期时间</th>
                        <th>签发方</th>
                        <th>自动续期</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vm.certificates.map((item) => (
                        <tr key={item.id} className={vm.editingCertificateId === item.id ? 'environment-ssl-row-active' : ''}>
                          <td>{item.domain}</td>
                          <td>
                            <span className={`environment-ssl-status ${item.status}`}>{vm.formatStatusLabel(item.status)}</span>
                          </td>
                          <td>{item.challenge_type === 'http' ? 'HTTP-01' : 'DNS-01'}</td>
                          <td>{item.not_after ?? '-'}</td>
                          <td>{item.issuer ?? '-'}</td>
                          <td>{item.auto_renew_enabled ? '已启用' : '未启用'}</td>
                          <td>
                            <div className="environment-ssl-row-actions">
                              <button type="button" onClick={() => openEditPage(item)} disabled={vm.actionBusy}>
                                编辑
                              </button>
                              <button type="button" onClick={() => void vm.onApplyCertificate(item.id)} disabled={vm.actionBusy}>
                                申请并部署
                              </button>
                              <button type="button" onClick={() => void vm.onRenewCertificate(item.id)} disabled={vm.actionBusy}>
                                续期
                              </button>
                              <button type="button" onClick={() => void vm.onSyncCertificate(item.id)} disabled={vm.actionBusy}>
                                同步
                              </button>
                              <button
                                type="button"
                                onClick={() => void vm.onDownloadCertificateFile(item.id, 'fullchain')}
                                disabled={vm.actionBusy}
                              >
                                下载链
                              </button>
                              <button
                                type="button"
                                onClick={() => void vm.onDownloadCertificateFile(item.id, 'key')}
                                disabled={vm.actionBusy}
                              >
                                下载Key
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => setDeleteTarget(item)}
                                disabled={vm.actionBusy}
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {lastOperationLog && (
              <section className="host-card environment-ssl-card">
                <header className="host-card-header">
                  <div>
                    <h3>最近一次执行日志</h3>
                    <p>
                      {operationLabel} · {lastOperationLog.domain} ·{' '}
                      {lastOperationLog.success ? '成功' : '失败'} · exit {lastOperationLog.exitStatus}
                    </p>
                  </div>
                  <div className="section-actions">
                    <span className={lastOperationLog.success ? 'chip environment-chip found' : 'chip'}>
                      {lastOperationLog.success ? '成功' : '失败'}
                    </span>
                    <button type="button" onClick={vm.onClearLastOperationLog} disabled={vm.actionBusy}>
                      清空日志
                    </button>
                  </div>
                </header>

                <p className="status-line">{lastOperationLog.message}</p>
                <p className="status-line">记录时间：{new Date(lastOperationLog.timestamp).toLocaleString()}</p>
                {!lastOperationLog.success && (
                  <div className="environment-ssl-failure">
                    <p className="environment-ssl-failure-title">
                      失败处理建议
                      {failedStep ? ` · 当前卡点：${failedStep.title}` : ''}
                    </p>
                    <ul className="environment-ssl-failure-list">
                      {failureHints.map((hint, index) => (
                        <li key={`${lastOperationLog.timestamp}-hint-${index}`}>{hint}</li>
                      ))}
                    </ul>
                    <div className="environment-ssl-failure-actions">
                      <button type="button" onClick={() => void vm.onRetryLastOperation()} disabled={vm.actionBusy}>
                        {vm.actionBusy ? '处理中...' : '重试当前操作'}
                      </button>
                      {lastCertificateId && (
                        <button
                          type="button"
                          onClick={() => void vm.onSyncCertificate(lastCertificateId)}
                          disabled={vm.actionBusy}
                        >
                          同步证书状态
                        </button>
                      )}
                      {currentCertificate && (
                        <button type="button" onClick={() => openEditPage(currentCertificate)} disabled={vm.actionBusy}>
                          打开证书配置
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="environment-ssl-flow">
                  <p className="environment-ssl-flow-title">申请流程步骤</p>
                  <ol className="environment-ssl-flow-steps">
                    {lastOperationLog.steps.map((step) => (
                      <li key={`${lastOperationLog.timestamp}-${step.key}`} className={`environment-ssl-flow-step ${step.status}`}>
                        <div className="environment-ssl-flow-step-head">
                          <span className="environment-ssl-flow-step-name">{step.title}</span>
                          <span className={`environment-ssl-flow-step-tag ${step.status}`}>
                            {step.status === 'completed'
                              ? '已完成'
                              : step.status === 'active'
                                ? '进行中'
                                : step.status === 'failed'
                                  ? '失败'
                                  : step.status === 'skipped'
                                    ? '跳过'
                                    : '待处理'}
                          </span>
                        </div>
                        <p className="environment-ssl-flow-step-desc">{step.description}</p>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="environment-ssl-log-grid">
                  <div className="environment-ssl-log-card">
                    <p className="environment-ssl-log-title">STDOUT</p>
                    <pre className="environment-ssl-log">{lastOperationLog.stdout || '(empty)'}</pre>
                  </div>
                  <div className="environment-ssl-log-card">
                    <p className="environment-ssl-log-title">STDERR</p>
                    <pre className="environment-ssl-log stderr">{lastOperationLog.stderr || '(empty)'}</pre>
                  </div>
                </div>
              </section>
            )}
              </>
            )}
          </div>

          {deleteTarget && (
            <div className="systemd-confirm-overlay" role="dialog" aria-modal="true" aria-label="确认删除 SSL 证书配置">
              <div className="systemd-confirm-modal">
                <h3>确认删除</h3>
                <p>将仅删除本地 SSL 管理配置，不会删除远程服务器已落盘的证书文件。</p>
                <div className="card-actions systemd-confirm-actions">
                  <button type="button" onClick={() => setDeleteTarget(null)} disabled={vm.actionBusy}>
                    取消
                  </button>
                  <button type="button" className="danger" onClick={() => void onConfirmDeleteCertificate()} disabled={vm.actionBusy}>
                    {vm.actionBusy ? '删除中...' : '确认删除'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
