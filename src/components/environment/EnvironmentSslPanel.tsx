import type { ConnectionProfile } from '../../types';
import { useSslCertificates } from '../../app/hooks/environment/useSslCertificates';

export function EnvironmentSslPanel({ profiles }: { profiles: ConnectionProfile[] }) {
  const vm = useSslCertificates(profiles);

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
              <h2>SSL证书管理</h2>
              <div className="section-actions">
                <button type="button" onClick={() => void vm.onLoadCertificates()} disabled={vm.actionBusy || vm.listBusy}>
                  {vm.listBusy ? '刷新中...' : '刷新列表'}
                </button>
              </div>
            </div>

            {vm.message && <p className={vm.messageIsError ? 'status-line error' : 'status-line'}>{vm.message}</p>}

            <section className="host-card environment-ssl-card">
              <header className="host-card-header">
                <div>
                  <h3>{vm.editingCertificateId ? '编辑证书配置' : '新建证书配置'}</h3>
                  <p>配置 Let&apos;s Encrypt 申请参数、部署路径与自动续期策略。</p>
                </div>
                <span className="chip">ACME</span>
              </header>

              <div className="environment-ssl-form-grid">
                <label className="field-label">
                  域名
                  <input
                    type="text"
                    placeholder="example.com 或 *.example.com"
                    value={vm.draft.domain}
                    onChange={(event) => vm.onPatchDraft({ domain: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label">
                  通知邮箱
                  <input
                    type="email"
                    placeholder="ops@example.com"
                    value={vm.draft.email}
                    onChange={(event) => vm.onPatchDraft({ email: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label">
                  挑战方式
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
                    WebRoot 路径
                    <input
                      type="text"
                      value={vm.draft.webrootPath}
                      onChange={(event) => vm.onPatchDraft({ webrootPath: event.target.value })}
                      disabled={vm.actionBusy}
                    />
                  </label>
                ) : (
                  <label className="field-label">
                    DNS 提供商标识
                    <input
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
                    DNS 环境变量（每行 KEY=VALUE）
                    <textarea
                      rows={4}
                      placeholder={'CF_Token=xxx\nCF_Account_ID=xxx'}
                      value={vm.draft.dnsEnvText}
                      onChange={(event) => vm.onPatchDraft({ dnsEnvText: event.target.value })}
                      disabled={vm.actionBusy}
                    />
                  </label>
                )}

                <label className="field-label">
                  证书私钥路径
                  <input
                    type="text"
                    placeholder="/etc/nginx/ssl/example.com.key"
                    value={vm.draft.keyFile}
                    onChange={(event) => vm.onPatchDraft({ keyFile: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label">
                  证书链路径（fullchain）
                  <input
                    type="text"
                    placeholder="/etc/nginx/ssl/example.com.fullchain.pem"
                    value={vm.draft.fullchainFile}
                    onChange={(event) => vm.onPatchDraft({ fullchainFile: event.target.value })}
                    disabled={vm.actionBusy}
                  />
                </label>

                <label className="field-label environment-ssl-field-wide">
                  续期后重载命令
                  <input
                    type="text"
                    placeholder="systemctl reload nginx"
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
                  续期阈值（天）
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
                  续期执行时间
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
                <button type="button" onClick={() => void vm.onSaveAndApply()} disabled={vm.actionBusy}>
                  {vm.actionBusy ? '处理中...' : '申请并部署证书'}
                </button>
                <button type="button" onClick={vm.onResetDraft} disabled={vm.actionBusy}>
                  重置表单
                </button>
              </div>
            </section>

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
                              <button type="button" onClick={() => vm.onPickCertificate(item)} disabled={vm.actionBusy}>
                                编辑
                              </button>
                              <button type="button" onClick={() => void vm.onApplyCertificate(item.id)} disabled={vm.actionBusy}>
                                申请
                              </button>
                              <button type="button" onClick={() => void vm.onRenewCertificate(item.id)} disabled={vm.actionBusy}>
                                续期
                              </button>
                              <button type="button" onClick={() => void vm.onSyncCertificate(item.id)} disabled={vm.actionBusy}>
                                同步
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => {
                                  if (window.confirm(`确认删除证书配置 ${item.domain} 吗？`)) {
                                    void vm.onDeleteCertificate(item.id);
                                  }
                                }}
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
          </div>
        </>
      )}
    </section>
  );
}
