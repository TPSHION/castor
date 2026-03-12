import { Suspense, lazy, useCallback, useEffect } from 'react';
import type { ConnectionProfile, NginxService } from '../types';
import { useNginxServices } from '../app/hooks/useNginxServices';

const NginxConfigEditor = lazy(() => import('./nginx/NginxConfigEditor'));

type NginxServicePanelProps = {
  profiles: ConnectionProfile[];
};

export function NginxServicePanel({ profiles }: NginxServicePanelProps) {
  const vm = useNginxServices(profiles);

  const triggerConfigSave = useCallback(() => {
    if (vm.nginxConfigEditorBusy || !vm.nginxConfigDirty || !vm.selectedNginxConfigService) {
      return;
    }
    void vm.onSaveNginxConfigFile();
  }, [vm.nginxConfigDirty, vm.nginxConfigEditorBusy, vm.onSaveNginxConfigFile, vm.selectedNginxConfigService]);

  useEffect(() => {
    if (vm.nginxMode !== 'config') {
      return;
    }
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key.toLowerCase() !== 's') {
        return;
      }
      event.preventDefault();
      triggerConfigSave();
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
    };
  }, [triggerConfigSave, vm.nginxMode]);

  return (
    <section className={vm.nginxMode === 'list' ? 'systemd-panel' : 'systemd-panel systemd-panel-form'}>
      {vm.nginxMode === 'list' ? (
        <>
          <div className="section-header">
            <h2>nginx 服务管理</h2>
            <div className="section-actions">
              <button type="button" onClick={() => void vm.refreshNginxList()} disabled={vm.nginxBusy}>
                刷新
              </button>
              <button type="button" onClick={vm.onStartCreateNginx} disabled={profiles.length === 0 || vm.nginxBusy}>
                新增 / 导入 nginx
              </button>
              <button type="button" onClick={vm.onStartDeployNginx} disabled={profiles.length === 0 || vm.nginxBusy}>
                部署 nginx
              </button>
            </div>
          </div>

          {vm.nginxMessage && <p className={vm.nginxMessageIsError ? 'status-line error' : 'status-line'}>{vm.nginxMessage}</p>}

          {vm.nginxServices.length === 0 ? (
            <div className="empty-state">暂无 nginx 服务，点击“新增 / 导入 nginx”开始。</div>
          ) : (
            <div className="systemd-service-grid">
              {vm.nginxServices.map((service) => (
                <NginxServiceCard
                  key={service.id}
                  service={service}
                  profileLabel={vm.profileNameMap.get(service.profile_id) ?? '未知服务器'}
                  busy={vm.nginxBusy}
                  onOpenDetail={vm.onOpenNginxDetail}
                  onOpenConfig={(target) => vm.onOpenNginxConfig(target, 'list')}
                  onEdit={vm.onEditNginx}
                  onDelete={vm.requestDeleteNginx}
                />
              ))}
            </div>
          )}
        </>
      ) : vm.nginxMode === 'detail' ? (
        <>
          <div className="systemd-form-header">
            <button
              type="button"
              className="systemd-back-icon-btn"
              onClick={vm.onBackNginxList}
              disabled={vm.detailBackDisabled}
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
            <h2>nginx 服务详情</h2>
            <div className="section-actions">
              {vm.selectedNginxDetailService && (
                <>
                  <button
                    type="button"
                    onClick={() => vm.onEditNginx(vm.selectedNginxDetailService as NginxService)}
                    disabled={vm.detailActionDisabled}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => void vm.onControlNginx('start')}
                    disabled={!vm.canDetailStart}
                  >
                    {vm.nginxDetailAction === 'start' ? '启动中...' : '启动'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void vm.onControlNginx('stop')}
                    disabled={!vm.canDetailStop}
                  >
                    {vm.nginxDetailAction === 'stop' ? '停止中...' : '停止'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void vm.onControlNginx('reload')}
                    disabled={vm.detailActionDisabled}
                  >
                    {vm.nginxDetailAction === 'reload' ? '重载中...' : '重载'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void vm.onControlNginx('restart')}
                    disabled={vm.detailActionDisabled}
                  >
                    {vm.nginxDetailAction === 'restart' ? '重启中...' : '重启'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void vm.onTestNginxConfig()}
                    disabled={vm.detailActionDisabled}
                  >
                    {vm.nginxConfigTesting ? '检测中...' : '配置检测'}
                  </button>
                  <button
                    type="button"
                    onClick={() => vm.onOpenNginxConfig(vm.selectedNginxDetailService!, 'detail')}
                    disabled={vm.detailActionDisabled}
                  >
                    配置页面
                  </button>
                  <button
                    type="button"
                    onClick={() => void vm.refreshNginxDetailStatus(vm.selectedNginxDetailService!.id)}
                    disabled={vm.detailActionDisabled}
                  >
                    {vm.nginxDetailStatusBusy ? '刷新中...' : '刷新状态'}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => vm.requestDeleteNginx(vm.selectedNginxDetailService!)}
                    disabled={vm.detailActionDisabled}
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="systemd-form-scroll">
            {vm.nginxMessage && <p className={vm.nginxMessageIsError ? 'status-line error' : 'status-line'}>{vm.nginxMessage}</p>}

            {!vm.selectedNginxDetailService ? (
              <div className="empty-state">服务不存在或已删除，请返回列表刷新。</div>
            ) : (
              <div className="systemd-detail-grid nginx-detail-grid">
                <article className="host-card">
                  <header className="host-card-header">
                    <div>
                      <h3>nginx 服务信息</h3>
                      <p>{vm.profileNameMap.get(vm.selectedNginxDetailService.profile_id) ?? '未知服务器'}</p>
                    </div>
                  </header>
                  <p className="systemd-service-meta">nginx 命令：{vm.selectedNginxDetailService.nginx_bin}</p>
                  <p className="systemd-service-meta">配置文件：{vm.selectedNginxDetailService.conf_path || '-'}</p>
                  <p className="systemd-service-meta">PID 文件：{vm.selectedNginxDetailService.pid_path || '-'}</p>
                  <p className="systemd-service-meta">sudo：{vm.selectedNginxDetailService.use_sudo ? '是' : '否'}</p>
                </article>

                <article className="host-card">
                  <header className="host-card-header">
                    <div>
                      <h3>运行状态</h3>
                      <p>通过进程状态检测</p>
                    </div>
                  </header>
                  {vm.nginxDetailStatus ? (
                    <>
                      <p className="systemd-service-meta">Summary：{vm.nginxDetailStatus.summary}</p>
                      <p className="systemd-service-meta">Running：{vm.nginxDetailStatus.running ? '是' : '否'}</p>
                      <p className="systemd-service-meta">Master PID：{vm.nginxDetailStatus.master_pid ?? '-'}</p>
                      <p className="systemd-service-meta">
                        CheckedAt：{new Date(vm.nginxDetailStatus.checked_at * 1000).toLocaleString()}
                      </p>
                    </>
                  ) : (
                    <p className="systemd-service-meta">{vm.nginxDetailStatusBusy ? '正在查询状态...' : '暂无状态信息'}</p>
                  )}
                </article>

                <article className="host-card">
                  <header className="host-card-header">
                    <div>
                      <h3>最近一次配置检测</h3>
                    </div>
                  </header>
                  {vm.nginxLastConfigTestResult ? (
                    <>
                      <p className="systemd-service-meta">
                        结果：{vm.nginxLastConfigTestResult.success ? '通过' : '失败'}（exit={vm.nginxLastConfigTestResult.exit_status}）
                      </p>
                      <code className="systemd-example-code">
                        {(vm.nginxLastConfigTestResult.stderr || vm.nginxLastConfigTestResult.stdout || '无输出').trim()}
                      </code>
                    </>
                  ) : (
                    <p className="systemd-service-meta">暂无检测记录，点击“配置检测”执行。</p>
                  )}
                </article>

                <article className="host-card systemd-detail-code-card">
                  <header className="host-card-header">
                    <div>
                      <h3>操作日志</h3>
                      <p>展示启动/停止/重载/重启/配置检测输出</p>
                    </div>
                    <div className="card-actions">
                      <button type="button" onClick={vm.clearNginxOperationLogs} disabled={vm.nginxOperationLogs.length === 0}>
                        清空日志
                      </button>
                    </div>
                  </header>
                  {vm.nginxOperationLogs.length > 0 ? (
                    <pre className="systemd-log">{vm.nginxOperationLogs.join('\n\n')}</pre>
                  ) : (
                    <p className="systemd-service-meta">暂无操作日志，执行操作后会在这里显示输出。</p>
                  )}
                </article>
              </div>
            )}
          </div>
        </>
      ) : vm.nginxMode === 'deploy' ? (
        <>
          <div className="systemd-form-header">
            <button
              type="button"
              className="systemd-back-icon-btn"
              onClick={vm.onBackNginxList}
              disabled={vm.nginxBusy}
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
            <h2>部署 nginx 服务</h2>
            <div className="section-actions">
              <button
                type="button"
                onClick={() => void vm.onSubmitDeployNginx()}
                disabled={vm.nginxBusy || Boolean(vm.nginxValidation)}
              >
                {vm.nginxBusy ? '部署中...' : '开始部署'}
              </button>
            </div>
          </div>

          <div className="systemd-form-scroll">
            <p className="status-line">
              部署说明：自动识别包管理器安装 nginx，并尝试执行 <code>systemctl enable/start nginx</code>。
            </p>
            {vm.nginxMessage && <p className={vm.nginxMessageIsError ? 'status-line error' : 'status-line'}>{vm.nginxMessage}</p>}

            <div className="systemd-form-grid">
              <label className="field-label">
                目标服务器
                <select
                  value={vm.nginxForm.profileId}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, profileId: event.target.value }))}
                  disabled={profiles.length === 0 || vm.nginxBusy}
                >
                  {profiles.length === 0 && <option value="">暂无服务器</option>}
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.username}@{profile.host})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label systemd-form-span">
                nginx 命令路径
                <input
                  value={vm.nginxForm.nginxBin}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, nginxBin: event.target.value }))}
                  placeholder="/usr/sbin/nginx"
                  disabled={vm.nginxBusy}
                  {...vm.textInputProps}
                />
              </label>

              <label className="field-label systemd-form-span">
                配置文件路径
                <input
                  value={vm.nginxForm.confPath}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, confPath: event.target.value }))}
                  placeholder="/etc/nginx/nginx.conf"
                  disabled={vm.nginxBusy}
                  {...vm.textInputProps}
                />
              </label>

              <label className="field-label systemd-form-span">
                PID 文件路径（可选）
                <input
                  value={vm.nginxForm.pidPath}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, pidPath: event.target.value }))}
                  placeholder="/run/nginx.pid"
                  disabled={vm.nginxBusy}
                  {...vm.textInputProps}
                />
              </label>
            </div>

            <div className="systemd-options">
              <label className="systemd-option">
                <input
                  type="checkbox"
                  checked={vm.nginxForm.useSudo}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, useSudo: event.target.checked }))}
                  disabled={vm.nginxBusy}
                />
                使用 sudo 执行部署命令
              </label>
            </div>

            {vm.nginxValidation && <p className="status-line error">{vm.nginxValidation}</p>}
            <p className="status-line">当前服务器：{vm.selectedNginxProfile ? vm.profileNameMap.get(vm.selectedNginxProfile.id) : '-'}</p>

            <div className="systemd-detail-grid">
              <article className="host-card">
                <header className="host-card-header">
                  <div>
                    <h3>部署任务信息</h3>
                    <p>{vm.selectedNginxProfile ? vm.profileNameMap.get(vm.selectedNginxProfile.id) : '未选择服务器'}</p>
                  </div>
                </header>
                <p className="systemd-service-meta">部署状态：{vm.nginxDeployRunning ? '部署中' : '空闲'}</p>
                <p className="systemd-service-meta">部署 ID：{vm.nginxDeployActiveId ?? '-'}</p>
                <p className="systemd-service-meta">
                  nginx 命令：{vm.nginxForm.nginxBin.trim() || '/usr/sbin/nginx'}
                </p>
                <p className="systemd-service-meta">
                  配置文件：{vm.nginxForm.confPath.trim() || '/etc/nginx/nginx.conf'}
                </p>
              </article>

              <article className="host-card systemd-detail-code-card">
                <header className="host-card-header">
                  <div>
                    <h3>部署日志（实时）</h3>
                    <p>部署期间持续输出远程安装与启动信息</p>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      onClick={vm.clearNginxDeployLogs}
                      disabled={vm.nginxDeployRunning || vm.nginxDeployLogs.length === 0}
                    >
                      清空日志
                    </button>
                  </div>
                </header>
                {vm.nginxDeployLogs.length > 0 ? (
                  <pre className="systemd-log">{vm.nginxDeployLogs.join('\n')}</pre>
                ) : (
                  <p className="systemd-service-meta">
                    {vm.nginxDeployRunning ? '正在等待远程日志输出...' : '尚未开始部署，点击“开始部署”查看实时日志。'}
                  </p>
                )}
              </article>
            </div>
          </div>
        </>
      ) : vm.nginxMode === 'config' ? (
        <>
          <div className="systemd-form-header">
            <button
              type="button"
              className="systemd-back-icon-btn"
              onClick={vm.onBackNginxConfig}
              disabled={vm.nginxConfigEditorBusy}
              aria-label="返回"
              title="返回"
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
            <h2>nginx 配置展示</h2>
            <div className="section-actions">
              <button type="button" onClick={() => void vm.onReloadNginxConfigFile()} disabled={vm.nginxConfigEditorBusy}>
                {vm.nginxConfigLoading ? '加载中...' : '重新获取远程配置'}
              </button>
              <button
                type="button"
                onClick={vm.onResetNginxConfigContent}
                disabled={vm.nginxConfigEditorBusy || !vm.nginxConfigDirty}
              >
                还原修改
              </button>
              <button
                type="button"
                onClick={() => void vm.onSaveNginxConfigFile()}
                disabled={vm.nginxConfigEditorBusy || !vm.nginxConfigDirty || !vm.selectedNginxConfigService}
              >
                {vm.nginxConfigSaving ? '保存中...' : '保存配置'}
              </button>
              <button
                type="button"
                onClick={() => void vm.onApplyNginxConfig()}
                disabled={vm.nginxConfigEditorBusy || !vm.selectedNginxConfigService || vm.nginxConfigDirty}
                title={vm.nginxConfigDirty ? '请先保存配置后再应用' : undefined}
              >
                {vm.nginxConfigApplying ? '应用中...' : '应用配置'}
              </button>
            </div>
          </div>

          <div className="systemd-form-scroll">
            {vm.nginxMessage && <p className={vm.nginxMessageIsError ? 'status-line error' : 'status-line'}>{vm.nginxMessage}</p>}

            {!vm.selectedNginxConfigService ? (
              <div className="empty-state">服务不存在或已删除，请返回列表刷新。</div>
            ) : (
              <div className="systemd-detail-grid">
                <article className="host-card">
                  <header className="host-card-header">
                    <div>
                      <h3>nginx 服务信息</h3>
                      <p>{vm.profileNameMap.get(vm.selectedNginxConfigService.profile_id) ?? '未知服务器'}</p>
                    </div>
                  </header>
                  <p className="systemd-service-meta">nginx 命令：{vm.selectedNginxConfigService.nginx_bin}</p>
                  <p className="systemd-service-meta">配置文件：{vm.nginxConfigSourcePath || vm.selectedNginxConfigService.conf_path || '-'}</p>
                  <p className="systemd-service-meta">sudo：{vm.selectedNginxConfigService.use_sudo ? '是' : '否'}</p>
                  <p className="systemd-service-meta">
                    最近加载：{vm.nginxConfigLoadedAt ? new Date(vm.nginxConfigLoadedAt * 1000).toLocaleString() : '-'}
                  </p>
                  <p className="systemd-service-meta">状态：{vm.nginxConfigDirty ? '有未保存修改' : '已保存'}</p>
                </article>

                {vm.nginxConfigValidationErrorDetail && (
                  <article className="host-card">
                    <header className="host-card-header">
                      <div>
                        <h3>校验失败详情</h3>
                        <p>保存前 `nginx -t` 返回输出</p>
                      </div>
                    </header>
                    <pre className="nginx-config-validation-log">{vm.nginxConfigValidationErrorDetail}</pre>
                  </article>
                )}

                <article className="host-card systemd-detail-code-card">
                  <header className="host-card-header">
                    <div>
                      <h3>配置文件编辑器</h3>
                      <p>CodeMirror 编辑器，支持行号、Ctrl/Cmd+S 保存</p>
                    </div>
                  </header>
                  <Suspense fallback={<div className="nginx-config-editor-loading">编辑器加载中...</div>}>
                    <NginxConfigEditor
                      value={vm.nginxConfigContent}
                      busy={vm.nginxConfigEditorBusy}
                      loading={vm.nginxConfigLoading}
                      onChange={vm.setNginxConfigContent}
                    />
                  </Suspense>
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
              onClick={vm.onBackNginxList}
              disabled={vm.nginxBusy}
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
            <h2>{vm.nginxMode === 'create' ? '新增 / 导入 nginx 服务' : '编辑 nginx 服务'}</h2>
            <div className="section-actions">
              <button type="button" onClick={() => void vm.onDiscoverNginx()} disabled={vm.nginxBusy || vm.nginxDiscovering}>
                {vm.nginxDiscovering ? '自动发现中...' : '自动发现并填充'}
              </button>
              <button
                type="button"
                onClick={() => void vm.onAutoAddDiscoveredNginx()}
                disabled={vm.nginxBusy || vm.nginxDiscovering}
              >
                自动添加已有 nginx
              </button>
              <button
                type="button"
                onClick={() => void vm.onSubmitNginxImport()}
                disabled={vm.nginxBusy || Boolean(vm.nginxValidation)}
              >
                参数导入并保存
              </button>
              <button type="button" onClick={() => void vm.onSaveNginx()} disabled={vm.nginxBusy || Boolean(vm.nginxValidation)}>
                仅保存
              </button>
            </div>
          </div>

          <div className="systemd-form-scroll">
            <p className="status-line">
              自动添加逻辑：先执行 <code>which nginx</code> 发现 nginx，再自动补齐参数并保存。
            </p>
            {vm.nginxMessage && <p className={vm.nginxMessageIsError ? 'status-line error' : 'status-line'}>{vm.nginxMessage}</p>}

            <div className="systemd-form-grid">
              <label className="field-label">
                目标服务器
                <select
                  value={vm.nginxForm.profileId}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, profileId: event.target.value }))}
                  disabled={profiles.length === 0 || vm.nginxBusy}
                >
                  {profiles.length === 0 && <option value="">暂无服务器</option>}
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.username}@{profile.host})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label systemd-form-span">
                nginx 命令路径
                <input
                  value={vm.nginxForm.nginxBin}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, nginxBin: event.target.value }))}
                  placeholder="/usr/sbin/nginx"
                  disabled={vm.nginxBusy}
                  {...vm.textInputProps}
                />
              </label>

              <label className="field-label systemd-form-span">
                配置文件路径（可选）
                <input
                  value={vm.nginxForm.confPath}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, confPath: event.target.value }))}
                  placeholder="/etc/nginx/nginx.conf"
                  disabled={vm.nginxBusy}
                  {...vm.textInputProps}
                />
              </label>

              <label className="field-label systemd-form-span">
                PID 文件路径（可选）
                <input
                  value={vm.nginxForm.pidPath}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, pidPath: event.target.value }))}
                  placeholder="/run/nginx.pid"
                  disabled={vm.nginxBusy}
                  {...vm.textInputProps}
                />
              </label>
            </div>

            <div className="systemd-options">
              <label className="systemd-option">
                <input
                  type="checkbox"
                  checked={vm.nginxForm.useSudo}
                  onChange={(event) => vm.setNginxForm((prev) => ({ ...prev, useSudo: event.target.checked }))}
                  disabled={vm.nginxBusy}
                />
                使用 sudo 执行 nginx 命令
              </label>
            </div>

            {vm.nginxValidation && <p className="status-line error">{vm.nginxValidation}</p>}
            <p className="status-line">当前服务器：{vm.selectedNginxProfile ? vm.profileNameMap.get(vm.selectedNginxProfile.id) : '-'}</p>
          </div>
        </>
      )}

      {vm.nginxDeleteTarget && (
        <div className="systemd-confirm-overlay" role="dialog" aria-modal="true" aria-label="确认删除 nginx 服务">
          <div className="systemd-confirm-modal">
            <h3>确认删除</h3>
            <p>将仅删除本地 nginx 管理配置，不会影响远程 nginx 服务运行。</p>
            <div className="card-actions systemd-confirm-actions">
              <button type="button" onClick={() => vm.setNginxDeleteTarget(null)} disabled={vm.nginxBusy}>
                取消
              </button>
              <button type="button" className="danger" onClick={() => void vm.onConfirmDeleteNginx()} disabled={vm.nginxBusy}>
                {vm.nginxBusy ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {vm.nginxToast && (
        <div
          className={vm.nginxToast.kind === 'error' ? 'nginx-toast nginx-toast-error' : 'nginx-toast nginx-toast-success'}
          role={vm.nginxToast.kind === 'error' ? 'alert' : 'status'}
          aria-live={vm.nginxToast.kind === 'error' ? 'assertive' : 'polite'}
        >
          <div className="nginx-toast-body">
            <p className="nginx-toast-title">{vm.nginxToast.kind === 'error' ? '操作失败' : '操作成功'}</p>
            <p className="nginx-toast-message">{vm.nginxToast.message}</p>
          </div>
          <button type="button" className="nginx-toast-close" onClick={vm.dismissNginxToast} aria-label="关闭提示">
            关闭
          </button>
        </div>
      )}
    </section>
  );
}

type NginxServiceCardProps = {
  service: NginxService;
  profileLabel: string;
  busy: boolean;
  onOpenDetail: (service: NginxService) => void;
  onOpenConfig: (service: NginxService) => void;
  onEdit: (service: NginxService) => void;
  onDelete: (service: NginxService) => void;
};

function NginxServiceCard({
  service,
  profileLabel,
  busy,
  onOpenDetail,
  onOpenConfig,
  onEdit,
  onDelete
}: NginxServiceCardProps) {
  return (
    <article
      className={busy ? 'host-card systemd-service-card' : 'host-card systemd-service-card clickable'}
      role="button"
      tabIndex={busy ? -1 : 0}
      onClick={() => {
        if (!busy) {
          onOpenDetail(service);
        }
      }}
      onKeyDown={(event) => {
        if (busy) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetail(service);
        }
      }}
    >
      <header className="host-card-header">
        <div>
          <h3>nginx 服务</h3>
          <p>{profileLabel}</p>
        </div>
      </header>

      <p className="systemd-service-meta">命令：{service.nginx_bin}</p>
      <p className="systemd-service-meta">配置：{service.conf_path || '-'}</p>
      <p className="systemd-service-meta">sudo：{service.use_sudo ? '是' : '否'}</p>

      <div className="card-actions">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDetail(service);
          }}
          disabled={busy}
        >
          详情
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenConfig(service);
          }}
          disabled={busy}
        >
          配置
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(service);
          }}
          disabled={busy}
        >
          编辑
        </button>
        <button
          type="button"
          className="danger"
          onClick={(event) => {
            event.stopPropagation();
            void onDelete(service);
          }}
          disabled={busy}
        >
          删除
        </button>
      </div>
    </article>
  );
}
