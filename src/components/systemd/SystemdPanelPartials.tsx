import type { ReactNode, RefObject } from 'react';
import type { ConnectionProfile, SystemdDeployService, SystemdServiceStatus } from '../../types';
import type { SystemdDeleteDialogState } from './types';
import { systemdLogOutputModeLabel, systemdLogOutputPathLabel } from './helpers';

type TextInputProps = {
  autoComplete: string;
  autoCorrect: string;
  autoCapitalize: 'none';
  spellCheck: boolean;
};

type SystemdListPanelProps = {
  profilesCount: number;
  systemdBusy: boolean;
  systemdMessage: string | null;
  systemdMessageIsError: boolean;
  systemdServices: SystemdDeployService[];
  profileNameMap: Map<string, string>;
  systemdDeletingServiceId: string | null;
  onRefreshSystemdList: () => Promise<void>;
  onStartCreateSystemd: () => void;
  onOpenSystemdDetail: (service: SystemdDeployService) => void;
  onEditSystemd: (service: SystemdDeployService) => void;
  requestDeleteSystemdFromList: (service: SystemdDeployService) => void;
};

export function SystemdListPanel({
  profilesCount,
  systemdBusy,
  systemdMessage,
  systemdMessageIsError,
  systemdServices,
  profileNameMap,
  systemdDeletingServiceId,
  onRefreshSystemdList,
  onStartCreateSystemd,
  onOpenSystemdDetail,
  onEditSystemd,
  requestDeleteSystemdFromList
}: SystemdListPanelProps) {
  return (
    <>
      <div className="section-header">
        <h2>systemd 部署服务</h2>
        <div className="section-actions">
          <button type="button" onClick={() => void onRefreshSystemdList()} disabled={systemdBusy}>
            刷新
          </button>
          <button type="button" onClick={onStartCreateSystemd} disabled={profilesCount === 0 || systemdBusy}>
            新增部署服务
          </button>
        </div>
      </div>

      {systemdMessage && <p className={systemdMessageIsError ? 'status-line error' : 'status-line'}>{systemdMessage}</p>}

      {systemdServices.length === 0 ? (
        <div className="empty-state">暂无部署服务，点击“新增部署服务”创建。</div>
      ) : (
        <div className="systemd-service-grid">
          {systemdServices.map((service) => {
            return (
              <article
                key={service.id}
                className={systemdBusy ? 'host-card systemd-service-card' : 'host-card systemd-service-card clickable'}
                role="button"
                tabIndex={systemdBusy ? -1 : 0}
                onClick={() => {
                  if (!systemdBusy) {
                    onOpenSystemdDetail(service);
                  }
                }}
                onKeyDown={(event) => {
                  if (systemdBusy) {
                    return;
                  }
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenSystemdDetail(service);
                  }
                }}
              >
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
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSystemdDetail(service);
                    }}
                    disabled={systemdBusy}
                  >
                    详情
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditSystemd(service);
                    }}
                    disabled={systemdBusy}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDeleteSystemdFromList(service);
                    }}
                    disabled={systemdBusy}
                  >
                    {systemdDeletingServiceId === service.id ? '删除中...' : '删除'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

type SystemdDetailPanelProps = {
  selectedSystemdDetailService: SystemdDeployService | null;
  detailBackDisabled: boolean;
  detailStatusActionDisabled: boolean;
  canDetailStart: boolean;
  canDetailStop: boolean;
  systemdDetailAction: 'start' | 'stop' | 'restart' | 'delete' | null;
  systemdDetailStatusBusy: boolean;
  systemdDetailStatus: SystemdServiceStatus | null;
  systemdMessage: string | null;
  systemdMessageIsError: boolean;
  profileNameMap: Map<string, string>;
  canReadSystemdLogs: boolean;
  systemdDetailLogsBusy: boolean;
  systemdDetailLogsRealtime: boolean;
  filteredSystemdDetailLogs: string[];
  highlightedSystemdLogNodes: ReactNode[];
  hasAppliedSystemdLogFilter: boolean;
  isSystemdLogFilterDirty: boolean;
  systemdLogFilterKeywordDraft: string;
  systemdLogFilterCaseSensitiveDraft: boolean;
  textInputProps: TextInputProps;
  systemdLogPanelRef: RefObject<HTMLPreElement>;
  onBackSystemdList: () => void;
  onEditSystemd: (service: SystemdDeployService) => void;
  onDetailControlSystemd: (action: 'start' | 'stop' | 'restart') => Promise<void>;
  refreshSystemdDetailStatus: (serviceId: string) => Promise<void>;
  requestDeleteSystemdFromDetail: () => void;
  loadSystemdDetailLogs: (serviceId: string, incremental: boolean, silent?: boolean) => Promise<void>;
  onToggleSystemdRealtimeLogs: () => void;
  clearLoadedSystemdLogs: () => void;
  setSystemdLogFullscreen: (open: boolean) => void;
  setSystemdLogFilterKeywordDraft: (value: string) => void;
  setSystemdLogFilterCaseSensitiveDraft: (value: boolean) => void;
  applySystemdLogFilter: () => void;
  clearSystemdLogFilter: () => void;
};

export function SystemdDetailPanel({
  selectedSystemdDetailService,
  detailBackDisabled,
  detailStatusActionDisabled,
  canDetailStart,
  canDetailStop,
  systemdDetailAction,
  systemdDetailStatusBusy,
  systemdDetailStatus,
  systemdMessage,
  systemdMessageIsError,
  profileNameMap,
  canReadSystemdLogs,
  systemdDetailLogsBusy,
  systemdDetailLogsRealtime,
  filteredSystemdDetailLogs,
  highlightedSystemdLogNodes,
  hasAppliedSystemdLogFilter,
  isSystemdLogFilterDirty,
  systemdLogFilterKeywordDraft,
  systemdLogFilterCaseSensitiveDraft,
  textInputProps,
  systemdLogPanelRef,
  onBackSystemdList,
  onEditSystemd,
  onDetailControlSystemd,
  refreshSystemdDetailStatus,
  requestDeleteSystemdFromDetail,
  loadSystemdDetailLogs,
  onToggleSystemdRealtimeLogs,
  clearLoadedSystemdLogs,
  setSystemdLogFullscreen,
  setSystemdLogFilterKeywordDraft,
  setSystemdLogFilterCaseSensitiveDraft,
  applySystemdLogFilter,
  clearSystemdLogFilter
}: SystemdDetailPanelProps) {
  return (
    <>
      <div className="systemd-form-header">
        <button
          type="button"
          className="systemd-back-icon-btn"
          onClick={onBackSystemdList}
          disabled={detailBackDisabled}
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
                onClick={() => onEditSystemd(selectedSystemdDetailService)}
                disabled={detailStatusActionDisabled}
              >
                编辑
              </button>
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
                onClick={requestDeleteSystemdFromDetail}
                disabled={detailStatusActionDisabled}
              >
                {systemdDetailAction === 'delete' ? '删除中...' : '删除'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="systemd-form-scroll">
        {systemdMessage && <p className={systemdMessageIsError ? 'status-line error' : 'status-line'}>{systemdMessage}</p>}

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
              <p className="systemd-service-meta">开机自启：{selectedSystemdDetailService.enable_on_boot ? '是' : '否'}</p>
              <p className="systemd-service-meta">
                日志输出：{systemdLogOutputModeLabel(selectedSystemdDetailService.log_output_mode)}
              </p>
              <p className="systemd-service-meta">日志地址：{systemdLogOutputPathLabel(selectedSystemdDetailService)}</p>
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
                    disabled={systemdDetailLogsBusy || !canReadSystemdLogs}
                  >
                    {systemdDetailLogsBusy ? '读取中...' : '查看日志'}
                  </button>
                  <button type="button" onClick={onToggleSystemdRealtimeLogs} disabled={!canReadSystemdLogs}>
                    {systemdDetailLogsRealtime ? '停止实时日志' : '开启实时日志'}
                  </button>
                  <button type="button" onClick={clearLoadedSystemdLogs} disabled={!canReadSystemdLogs}>
                    清空当前日志
                  </button>
                  <button type="button" onClick={() => setSystemdLogFullscreen(true)} disabled={!canReadSystemdLogs}>
                    全屏查看
                  </button>
                </div>
              </header>
              <div className="systemd-log-filter">
                <input
                  className="systemd-log-filter-input"
                  value={systemdLogFilterKeywordDraft}
                  onChange={(event) => setSystemdLogFilterKeywordDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      applySystemdLogFilter();
                    }
                  }}
                  placeholder="关键字过滤当前已加载日志"
                  {...textInputProps}
                />
                <button type="button" onClick={applySystemdLogFilter} disabled={!isSystemdLogFilterDirty}>
                  过滤
                </button>
                <button
                  type="button"
                  onClick={clearSystemdLogFilter}
                  disabled={!systemdLogFilterKeywordDraft && !hasAppliedSystemdLogFilter}
                >
                  清空
                </button>
                <label className="systemd-log-filter-toggle">
                  <input
                    type="checkbox"
                    checked={systemdLogFilterCaseSensitiveDraft}
                    onChange={(event) => setSystemdLogFilterCaseSensitiveDraft(event.target.checked)}
                  />
                  区分大小写
                </label>
              </div>
              {filteredSystemdDetailLogs.length > 0 ? (
                <pre ref={systemdLogPanelRef} className="systemd-log">
                  {highlightedSystemdLogNodes}
                </pre>
              ) : !canReadSystemdLogs ? (
                <p className="systemd-service-meta">当前服务已配置为不输出日志。</p>
              ) : hasAppliedSystemdLogFilter ? (
                <p className="systemd-service-meta">未匹配到过滤结果，可清空关键字后重试。</p>
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
  );
}

type SystemdLogFullscreenModalProps = {
  open: boolean;
  selectedSystemdDetailService: SystemdDeployService | null;
  canReadSystemdLogs: boolean;
  systemdDetailLogsBusy: boolean;
  systemdDetailLogsRealtime: boolean;
  systemdLogFilterKeywordDraft: string;
  systemdLogFilterCaseSensitiveDraft: boolean;
  isSystemdLogFilterDirty: boolean;
  hasAppliedSystemdLogFilter: boolean;
  filteredSystemdDetailLogs: string[];
  highlightedSystemdLogNodes: ReactNode[];
  textInputProps: TextInputProps;
  systemdLogFullscreenRef: RefObject<HTMLPreElement>;
  loadSystemdDetailLogs: (serviceId: string, incremental: boolean, silent?: boolean) => Promise<void>;
  onToggleSystemdRealtimeLogs: () => void;
  clearLoadedSystemdLogs: () => void;
  setSystemdLogFullscreen: (open: boolean) => void;
  setSystemdLogFilterKeywordDraft: (value: string) => void;
  setSystemdLogFilterCaseSensitiveDraft: (value: boolean) => void;
  applySystemdLogFilter: () => void;
  clearSystemdLogFilter: () => void;
};

export function SystemdLogFullscreenModal({
  open,
  selectedSystemdDetailService,
  canReadSystemdLogs,
  systemdDetailLogsBusy,
  systemdDetailLogsRealtime,
  systemdLogFilterKeywordDraft,
  systemdLogFilterCaseSensitiveDraft,
  isSystemdLogFilterDirty,
  hasAppliedSystemdLogFilter,
  filteredSystemdDetailLogs,
  highlightedSystemdLogNodes,
  textInputProps,
  systemdLogFullscreenRef,
  loadSystemdDetailLogs,
  onToggleSystemdRealtimeLogs,
  clearLoadedSystemdLogs,
  setSystemdLogFullscreen,
  setSystemdLogFilterKeywordDraft,
  setSystemdLogFilterCaseSensitiveDraft,
  applySystemdLogFilter,
  clearSystemdLogFilter
}: SystemdLogFullscreenModalProps) {
  if (!open || !selectedSystemdDetailService) {
    return null;
  }

  return (
    <div className="systemd-log-fullscreen-overlay" role="dialog" aria-modal="true" aria-label="全屏查看日志">
      <div className="systemd-log-fullscreen-modal">
        <div className="systemd-log-fullscreen-header">
          <div>
            <h3>{selectedSystemdDetailService.service_name}.service</h3>
            <p>按 Esc 可退出全屏</p>
          </div>
          <div className="card-actions">
            <button
              type="button"
              onClick={() => void loadSystemdDetailLogs(selectedSystemdDetailService.id, false)}
              disabled={systemdDetailLogsBusy || !canReadSystemdLogs}
            >
              {systemdDetailLogsBusy ? '读取中...' : '查看日志'}
            </button>
            <button type="button" onClick={onToggleSystemdRealtimeLogs} disabled={!canReadSystemdLogs}>
              {systemdDetailLogsRealtime ? '停止实时日志' : '开启实时日志'}
            </button>
            <button type="button" onClick={clearLoadedSystemdLogs} disabled={!canReadSystemdLogs}>
              清空当前日志
            </button>
            <button type="button" onClick={() => setSystemdLogFullscreen(false)}>
              关闭全屏
            </button>
          </div>
        </div>

        <div className="systemd-log-filter systemd-log-filter-fullscreen">
          <input
            className="systemd-log-filter-input"
            value={systemdLogFilterKeywordDraft}
            onChange={(event) => setSystemdLogFilterKeywordDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                applySystemdLogFilter();
              }
            }}
            placeholder="关键字过滤当前已加载日志"
            {...textInputProps}
          />
          <button type="button" onClick={applySystemdLogFilter} disabled={!isSystemdLogFilterDirty}>
            过滤
          </button>
          <button
            type="button"
            onClick={clearSystemdLogFilter}
            disabled={!systemdLogFilterKeywordDraft && !hasAppliedSystemdLogFilter}
          >
            清空
          </button>
          <label className="systemd-log-filter-toggle">
            <input
              type="checkbox"
              checked={systemdLogFilterCaseSensitiveDraft}
              onChange={(event) => setSystemdLogFilterCaseSensitiveDraft(event.target.checked)}
            />
            区分大小写
          </label>
        </div>

        {filteredSystemdDetailLogs.length > 0 ? (
          <pre ref={systemdLogFullscreenRef} className="systemd-log systemd-log-fullscreen">
            {highlightedSystemdLogNodes}
          </pre>
        ) : !canReadSystemdLogs ? (
          <p className="systemd-service-meta systemd-log-fullscreen-empty">当前服务已配置为不输出日志。</p>
        ) : hasAppliedSystemdLogFilter ? (
          <p className="systemd-service-meta systemd-log-fullscreen-empty">未匹配到过滤结果，可清空关键字后重试。</p>
        ) : (
          <p className="systemd-service-meta systemd-log-fullscreen-empty">
            {systemdDetailLogsBusy ? '正在读取日志...' : '暂无日志输出，可点击“查看日志”加载。'}
          </p>
        )}
      </div>
    </div>
  );
}

type SystemdDeleteConfirmDialogProps = {
  systemdDeleteDialog: SystemdDeleteDialogState | null;
  isDeleteConfirmBusy: boolean;
  setSystemdDeleteDialog: (next: SystemdDeleteDialogState | null) => void;
  onConfirmDeleteSystemd: () => Promise<void>;
};

export function SystemdDeleteConfirmDialog({
  systemdDeleteDialog,
  isDeleteConfirmBusy,
  setSystemdDeleteDialog,
  onConfirmDeleteSystemd
}: SystemdDeleteConfirmDialogProps) {
  if (!systemdDeleteDialog) {
    return null;
  }

  return (
    <div className="systemd-confirm-overlay" role="dialog" aria-modal="true" aria-label="确认删除部署服务">
      <div className="systemd-confirm-modal">
        <h3>确认删除</h3>
        <p>
          {systemdDeleteDialog.localOnly
            ? `将仅删除本地部署配置“${systemdDeleteDialog.name}”，不会删除远端 systemd 服务。`
            : `将删除部署服务“${systemdDeleteDialog.name}”，并尝试卸载远端 systemd unit。该操作不可撤销。`}
        </p>
        <label className="systemd-confirm-checkbox">
          <input
            type="checkbox"
            checked={systemdDeleteDialog.localOnly}
            onChange={(event) =>
              setSystemdDeleteDialog({
                ...systemdDeleteDialog,
                localOnly: event.target.checked
              })
            }
            disabled={isDeleteConfirmBusy}
          />
          仅删除本地配置（不删除远程服务）
        </label>
        <div className="card-actions systemd-confirm-actions">
          <button type="button" onClick={() => setSystemdDeleteDialog(null)} disabled={isDeleteConfirmBusy}>
            取消
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void onConfirmDeleteSystemd()}
            disabled={isDeleteConfirmBusy}
          >
            {isDeleteConfirmBusy ? '删除中...' : systemdDeleteDialog.localOnly ? '确认仅删本地' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

type SystemdFormHeaderProps = {
  mode: 'create' | 'edit';
  systemdBusy: boolean;
  systemdValidation: string | null;
  systemdSubmitAction: 'save' | 'save-and-deploy' | null;
  systemdRemoteServicesBusy: boolean;
  systemdImportBusy: boolean;
  profiles: ConnectionProfile[];
  onBackSystemdList: () => void;
  onOpenSystemdImportPanel: () => void;
  onSubmitSystemdForm: (mode: 'save' | 'save-and-deploy') => Promise<void>;
};

export function SystemdFormHeader({
  mode,
  systemdBusy,
  systemdValidation,
  systemdSubmitAction,
  systemdRemoteServicesBusy,
  systemdImportBusy,
  profiles,
  onBackSystemdList,
  onOpenSystemdImportPanel,
  onSubmitSystemdForm
}: SystemdFormHeaderProps) {
  return (
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
      <h2>{mode === 'create' ? '新增部署服务' : '编辑部署服务'}</h2>
      <div className="section-actions">
        {mode === 'create' && (
          <button
            type="button"
            onClick={onOpenSystemdImportPanel}
            disabled={systemdBusy || systemdRemoteServicesBusy || systemdImportBusy || profiles.length === 0}
          >
            从已有服务导入
          </button>
        )}
        <button type="button" onClick={() => void onSubmitSystemdForm('save')} disabled={systemdBusy || Boolean(systemdValidation)}>
          {systemdSubmitAction === 'save' ? '保存中...' : '仅保存'}
        </button>
        <button
          type="button"
          onClick={() => void onSubmitSystemdForm('save-and-deploy')}
          disabled={systemdBusy || Boolean(systemdValidation)}
        >
          {systemdSubmitAction === 'save-and-deploy' ? '部署中...' : '保存并部署'}
        </button>
      </div>
    </div>
  );
}
