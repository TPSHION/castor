import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import type {
  ConnectionProfile,
  RemoteSystemdServiceItem,
  SystemdDeployService,
  SystemdLogOutputMode,
  SystemdScope,
  SystemdServiceStatus
} from '../../types';
import { SYSTEMD_EXECSTART_EXAMPLES, SYSTEMD_LOG_OUTPUT_MODE_OPTIONS, SYSTEMD_SERVICE_TYPES } from './constants';
import {
  defaultSystemdLogOutputPath,
  firstExecStartExample,
  normalizeComparableServiceName,
  systemdLogOutputModeLabel,
  systemdLogOutputPathLabel
} from './helpers';
import type { SystemdDeleteDialogState, SystemdFormState } from './types';

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

type SystemdFormPanelProps = {
  profiles: ConnectionProfile[];
  textInputProps: TextInputProps;
  systemdBusy: boolean;
  systemdMessage: string | null;
  systemdMessageIsError: boolean;
  systemdImportPanelOpen: boolean;
  systemdRemoteServicesBusy: boolean;
  systemdImportBusy: boolean;
  systemdRemoteServices: RemoteSystemdServiceItem[];
  systemdRemoteServiceKeyword: string;
  filteredSystemdRemoteServices: RemoteSystemdServiceItem[];
  systemdSelectedRemoteServiceName: string;
  existingSystemdServiceNameSet: Set<string>;
  selectedRemoteServiceAlreadyAdded: boolean;
  systemdForm: SystemdFormState;
  setSystemdForm: Dispatch<SetStateAction<SystemdFormState>>;
  setSystemdImportPanelOpen: (open: boolean) => void;
  setSystemdRemoteServiceKeyword: (value: string) => void;
  setSystemdSelectedRemoteServiceName: (value: string) => void;
  onImportRemoteSystemdService: () => Promise<void>;
  loadRemoteSystemdServiceList: () => Promise<void>;
  selectedSystemdProfile: ConnectionProfile | null;
  selectedServiceTypeExamples: { label: string; examples: string[] };
  systemdServiceNameValidationMessage: string | null;
};

export function SystemdFormPanel({
  profiles,
  textInputProps,
  systemdBusy,
  systemdMessage,
  systemdMessageIsError,
  systemdImportPanelOpen,
  systemdRemoteServicesBusy,
  systemdImportBusy,
  systemdRemoteServices,
  systemdRemoteServiceKeyword,
  filteredSystemdRemoteServices,
  systemdSelectedRemoteServiceName,
  existingSystemdServiceNameSet,
  selectedRemoteServiceAlreadyAdded,
  systemdForm,
  setSystemdForm,
  setSystemdImportPanelOpen,
  setSystemdRemoteServiceKeyword,
  setSystemdSelectedRemoteServiceName,
  onImportRemoteSystemdService,
  loadRemoteSystemdServiceList,
  selectedSystemdProfile,
  selectedServiceTypeExamples,
  systemdServiceNameValidationMessage
}: SystemdFormPanelProps) {
  return (
    <div className="systemd-form-scroll">
      <p className="status-line">可选择“仅保存”或“保存并部署”（生成/更新 unit + daemon-reload + enable(可选) + restart）。</p>
      {systemdMessage && <p className={systemdMessageIsError ? 'status-line error' : 'status-line'}>{systemdMessage}</p>}
      {systemdImportPanelOpen && (
        <article className="host-card systemd-import-panel">
          <header className="host-card-header">
            <div>
              <h3>从现有 systemd 服务导入</h3>
              <p>将读取目标服务器当前 scope 下已存在的服务配置并填充表单</p>
            </div>
            <div className="card-actions">
              <button
                type="button"
                onClick={() => void loadRemoteSystemdServiceList()}
                disabled={systemdRemoteServicesBusy || systemdImportBusy}
              >
                {systemdRemoteServicesBusy ? '加载中...' : '刷新列表'}
              </button>
              <button type="button" onClick={() => setSystemdImportPanelOpen(false)} disabled={systemdImportBusy}>
                关闭
              </button>
            </div>
          </header>

          {systemdRemoteServices.length === 0 ? (
            <p className="systemd-service-meta">未发现可导入的自建服务（仅展示常见用户自建目录下的服务）。</p>
          ) : (
            <>
              <label className="field-label">
                搜索服务
                <input
                  value={systemdRemoteServiceKeyword}
                  onChange={(event) => setSystemdRemoteServiceKeyword(event.target.value)}
                  placeholder="输入服务名或状态关键字"
                  disabled={systemdRemoteServicesBusy || systemdImportBusy}
                  {...textInputProps}
                />
              </label>
              {filteredSystemdRemoteServices.length === 0 ? (
                <p className="systemd-service-meta">未匹配到服务，请调整搜索关键字。</p>
              ) : (
                <label className="field-label">
                  选择已有服务
                  <select
                    value={systemdSelectedRemoteServiceName}
                    onChange={(event) => setSystemdSelectedRemoteServiceName(event.target.value)}
                    disabled={systemdRemoteServicesBusy || systemdImportBusy}
                  >
                    {filteredSystemdRemoteServices.map((item) => {
                      const alreadyAdded = existingSystemdServiceNameSet.has(
                        normalizeComparableServiceName(item.service_name)
                      );
                      return (
                        <option key={item.service_name} value={item.service_name}>
                          {item.service_name}.service ({item.unit_file_state})
                          {alreadyAdded ? ' · 已添加' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {selectedRemoteServiceAlreadyAdded && (
                    <span className="systemd-import-hint">该服务已在本地部署列表中（已添加）。</span>
                  )}
                </label>
              )}
            </>
          )}

          <div className="card-actions">
            <button
              type="button"
              onClick={() => void onImportRemoteSystemdService()}
              disabled={!systemdSelectedRemoteServiceName || systemdRemoteServicesBusy || systemdImportBusy}
            >
              {systemdImportBusy ? '导入中...' : '导入配置到表单'}
            </button>
          </div>
        </article>
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
            onChange={(event) => {
              const nextServiceName = event.target.value;
              setSystemdForm((prev) => {
                const prevDefaultPath = defaultSystemdLogOutputPath(prev.serviceName);
                const shouldSyncPath = !prev.logOutputPath.trim() || prev.logOutputPath === prevDefaultPath;
                return {
                  ...prev,
                  serviceName: nextServiceName,
                  logOutputPath: shouldSyncPath ? defaultSystemdLogOutputPath(nextServiceName) : prev.logOutputPath
                };
              });
            }}
            placeholder="my-app"
            disabled={systemdBusy}
            aria-invalid={Boolean(systemdServiceNameValidationMessage)}
            {...textInputProps}
          />
          {systemdServiceNameValidationMessage && (
            <span className="field-error-text">{systemdServiceNameValidationMessage}</span>
          )}
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

        <label className="field-label">
          日志输出
          <select
            value={systemdForm.logOutputMode}
            onChange={(event) => {
              const mode = event.target.value as SystemdLogOutputMode;
              setSystemdForm((prev) => ({
                ...prev,
                logOutputMode: mode,
                logOutputPath:
                  mode === 'file' ? prev.logOutputPath.trim() || defaultSystemdLogOutputPath(prev.serviceName) : prev.logOutputPath
              }));
            }}
            disabled={systemdBusy}
          >
            {SYSTEMD_LOG_OUTPUT_MODE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          日志文件路径
          <input
            value={systemdForm.logOutputPath}
            onChange={(event) => setSystemdForm((prev) => ({ ...prev, logOutputPath: event.target.value }))}
            placeholder={defaultSystemdLogOutputPath(systemdForm.serviceName)}
            disabled={systemdBusy || systemdForm.logOutputMode !== 'file'}
            {...textInputProps}
          />
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
            className="systemd-execstart-input"
            value={systemdForm.execStart}
            onChange={(event) => setSystemdForm((prev) => ({ ...prev, execStart: event.target.value }))}
            placeholder={firstExecStartExample(systemdForm.serviceType) || '/usr/bin/node /opt/my-app/server.js'}
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
  );
}
