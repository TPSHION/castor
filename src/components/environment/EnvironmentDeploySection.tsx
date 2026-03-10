import { useEffect, useMemo, useRef } from 'react';
import { formatUnixTime } from '../../app/helpers';
import { useEnvironmentDeploy } from '../../app/hooks/environment/useEnvironmentDeploy';
import type { ConnectionProfile, RuntimeDeployLanguage, RuntimeVersionChannel } from '../../types';

const RUNTIME_LANGUAGE_LABELS: Record<RuntimeDeployLanguage, string> = {
  node: 'Node.js',
  java: 'Java',
  go: 'Go',
  python: 'Python'
};

const LANGUAGE_ORDER: RuntimeDeployLanguage[] = ['node', 'java', 'go', 'python'];

function channelLabel(channel: RuntimeVersionChannel) {
  if (channel === 'stable') {
    return '稳定版';
  }
  if (channel === 'prerelease') {
    return '预览版';
  }
  return '未知';
}

type StepState = 'pending' | 'active' | 'completed' | 'failed';

function parseCurrentStepIndex(logs: string[]): number {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const line = logs[index];
    const match = line.match(/^\[(\d+)\/(\d+)\]/);
    if (match) {
      return Number.parseInt(match[1], 10) - 1;
    }
  }
  return -1;
}

function extractFailureDetails(logs: string[]): string {
  if (!logs.length) {
    return '未捕获到错误输出。';
  }

  const candidates = logs.filter((line) => {
    const normalized = line.toLowerCase();
    return normalized.includes('[stderr]') || normalized.includes('failed') || normalized.includes('error');
  });

  const picked = (candidates.length > 0 ? candidates : logs).slice(-8);
  return picked.join('\n');
}

type EnvironmentDeploySectionProps = {
  selectedProfileId: string;
  selectedProfile: ConnectionProfile | null;
  onDeploySuccess?: () => Promise<void> | void;
};

export function EnvironmentDeploySection({
  selectedProfileId,
  selectedProfile,
  onDeploySuccess
}: EnvironmentDeploySectionProps) {
  const vm = useEnvironmentDeploy({
    selectedProfileId,
    onDeploySuccess
  });
  const logRef = useRef<HTMLPreElement | null>(null);

  const disableActions = vm.planBusy || vm.applyBusy || !selectedProfileId;
  const disablePlan = disableActions || vm.versionsBusy || !vm.version;
  const disableApply = disableActions || vm.versionsBusy || !vm.version || !vm.canApply;
  const currentStepIndex = useMemo(() => parseCurrentStepIndex(vm.deployLogs), [vm.deployLogs]);
  const failureDetails = useMemo(() => {
    if (!vm.applyResult || vm.applyResult.success) {
      return '';
    }
    return extractFailureDetails(vm.applyResult.logs);
  }, [vm.applyResult]);

  useEffect(() => {
    if (!vm.applyBusy || !logRef.current) {
      return;
    }
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [vm.applyBusy, vm.deployLogs]);

  const getStepState = (index: number): StepState => {
    if (!vm.planResult) {
      return 'pending';
    }

    if (vm.applyBusy) {
      if (currentStepIndex < 0) {
        return 'pending';
      }
      if (index < currentStepIndex) {
        return 'completed';
      }
      if (index === currentStepIndex) {
        return 'active';
      }
      return 'pending';
    }

    if (vm.applyResult?.success) {
      return 'completed';
    }

    if (vm.applyResult && !vm.applyResult.success) {
      if (currentStepIndex >= 0) {
        if (index < currentStepIndex) {
          return 'completed';
        }
        if (index === currentStepIndex) {
          return 'failed';
        }
      }
      return 'pending';
    }

    return 'pending';
  };

  return (
    <section className="environment-deploy-panel host-card">
      <header className="host-card-header">
        <div>
          <h3>环境部署</h3>
          <p>按服务器维度安装并切换运行时版本。</p>
        </div>
      </header>

      <div className="environment-deploy-form-grid">
        <label className="field-label">
          语言
          <select
            value={vm.language}
            onChange={(event) => vm.setLanguage(event.target.value as RuntimeDeployLanguage)}
            disabled={disableActions}
          >
            {LANGUAGE_ORDER.map((item) => (
              <option key={item} value={item}>
                {RUNTIME_LANGUAGE_LABELS[item]}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          版本
          <select
            value={vm.version}
            onChange={(event) => vm.setVersion(event.target.value)}
            disabled={disableActions || vm.versionsBusy}
          >
            {vm.versions.length === 0 ? (
              <option value="">
                {vm.versionsBusy ? '正在加载版本...' : '暂无可用版本，请刷新'}
              </option>
            ) : (
              vm.versions.map((item) => (
                <option key={item.version} value={item.version}>
                  {item.version}（{channelLabel(item.channel)}）
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <label className="environment-deploy-option">
        <input
          type="checkbox"
          checked={vm.setAsDefault}
          onChange={(event) => vm.setSetAsDefault(event.target.checked)}
          disabled={disableActions}
        />
        部署后设置为默认版本
      </label>

      <div className="card-actions">
        <button
          type="button"
          onClick={() => vm.onLoadVersions({ forceRefresh: true })}
          disabled={disableActions || vm.versionsBusy}
        >
          {vm.versionsBusy ? '加载中...' : '刷新版本列表'}
        </button>
        <button type="button" onClick={vm.onPlanDeploy} disabled={disablePlan}>
          {vm.planBusy ? '生成中...' : '生成部署计划'}
        </button>
        <button
          type="button"
          onClick={vm.onApplyDeploy}
          disabled={disableApply}
          title={vm.canApply ? '' : '请先生成部署计划'}
        >
          {vm.applyBusy ? '部署中...' : '开始部署'}
        </button>
        {vm.applyBusy && (
          <button type="button" className="danger" onClick={vm.onCancelDeploy}>
            取消部署
          </button>
        )}
      </div>

      <p className="status-line">操作步骤：1. 生成部署计划 2. 开始部署</p>

      <p className={vm.messageIsError ? 'status-line error' : 'status-line'}>
        {vm.message ?? '支持 nvm / pyenv / sdkman / goenv。建议先生成部署计划。'}
      </p>
      {selectedProfile && (
        <p className="status-line">
          当前目标：{selectedProfile.name} ({selectedProfile.username}@{selectedProfile.host}:{selectedProfile.port})
        </p>
      )}
      {vm.versionsManager && (
        <p className="status-line">
          版本来源：<code>{vm.versionsManager}</code>，已加载 {vm.versions.length} 个版本（含稳定/预览标识）
        </p>
      )}
      {vm.planResult && !vm.canApply && !vm.applyBusy && (
        <p className="status-line">检测到参数已变化，请重新生成部署计划后再执行部署。</p>
      )}

      {vm.planResult && (
        <div className="environment-deploy-plan">
          <div className="environment-deploy-subheader">
            <p>
              部署管理器：<code>{vm.planResult.manager}</code>
            </p>
            <p>
              目标版本：<code>{vm.planResult.version}</code>
            </p>
          </div>
          <ol className="environment-deploy-steps">
            {vm.planResult.steps.map((step, index) => (
              <li key={`${step.title}-${index}`} className={`environment-deploy-step ${getStepState(index)}`}>
                <p>
                  <span className="environment-deploy-step-order">{index + 1}</span>
                  <span className="environment-deploy-step-indicator" />
                  {step.title}
                </p>
                <code>{step.command}</code>
              </li>
            ))}
          </ol>
        </div>
      )}

      {(vm.applyBusy || vm.deployLogs.length > 0 || vm.applyResult) && (
        <div className="environment-deploy-runtime-panels">
          <div className="environment-deploy-result">
            <div className="environment-deploy-subheader">
              <p>{vm.applyBusy ? '部署实时日志（进行中）' : '执行日志'}</p>
            </div>
            <pre ref={logRef} className="environment-deploy-log">{vm.deployLogs.join('\n') || '暂无日志输出'}</pre>
          </div>

          <div className="environment-deploy-result environment-deploy-runtime-result">
            <div className="environment-deploy-subheader">
              <p>执行结果</p>
            </div>
            <div className="environment-deploy-runtime-result-body">
              {vm.applyBusy ? (
                <p className="systemd-service-meta">部署进行中，请关注左侧实时日志。</p>
              ) : vm.applyResult ? (
                <>
                  <p className="systemd-service-meta">
                    状态：
                    <span className={vm.applyResult.success ? 'environment-deploy-tag success' : 'environment-deploy-tag fail'}>
                      {vm.applyResult.success ? '成功' : '失败'}
                    </span>
                  </p>
                  <p className="systemd-service-meta">完成时间：{formatUnixTime(vm.applyResult.completed_at)}</p>
                  {!vm.applyResult.success && (
                    <>
                      <p className="systemd-service-meta">失败详情：</p>
                      <pre className="environment-deploy-error">{failureDetails}</pre>
                    </>
                  )}
                </>
              ) : (
                <p className="systemd-service-meta">尚未开始执行。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
