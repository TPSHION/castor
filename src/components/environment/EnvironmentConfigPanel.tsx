import { formatUnixTime } from '../../app/helpers';
import { useRuntimeProbe } from '../../app/hooks/environment/useRuntimeProbe';
import type { ConnectionProfile, RuntimeLanguage, RuntimeProbeResult } from '../../types';

const RUNTIME_LANGUAGE_LABELS: Record<RuntimeLanguage, string> = {
  node: 'Node.js',
  java: 'Java',
  go: 'Go',
  python: 'Python'
};
const RUNTIME_LANGUAGE_ORDER: RuntimeLanguage[] = ['node', 'java', 'go', 'python'];

function renderRuntimeStatus(result: RuntimeProbeResult | undefined) {
  if (!result || result.checked_at === 0) {
    return '尚未探测';
  }
  return result.found ? '已安装' : '未安装';
}

export function EnvironmentConfigPanel({ profiles }: { profiles: ConnectionProfile[] }) {
  const vm = useRuntimeProbe(profiles);
  const resultMap = new Map<RuntimeLanguage, RuntimeProbeResult>(
    vm.runtimeProbeResults.map((item) => [item.language, item])
  );
  const sortedLanguages = [...RUNTIME_LANGUAGE_ORDER].sort((left, right) => {
    const leftFound = resultMap.get(left)?.found ? 1 : 0;
    const rightFound = resultMap.get(right)?.found ? 1 : 0;
    if (leftFound !== rightFound) {
      return rightFound - leftFound;
    }
    return RUNTIME_LANGUAGE_ORDER.indexOf(left) - RUNTIME_LANGUAGE_ORDER.indexOf(right);
  });

  return (
    <section className="environment-panel">
      <div className="section-header">
        <h2>环境探测</h2>
        <div className="section-actions">
          <button
            type="button"
            onClick={vm.onProbeServerRuntimes}
            disabled={vm.runtimeProbeBusy || vm.runtimeProbeChecking || !vm.selectedProfile}
          >
            {vm.runtimeProbeBusy ? '探测中...' : vm.runtimeProbeChecking ? '检查中...' : '开始探测'}
          </button>
          {vm.runtimeProbeBusy && (
            <button type="button" className="danger" onClick={vm.onCancelRuntimeProbe}>
              取消探测
            </button>
          )}
        </div>
      </div>

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
                disabled={vm.runtimeProbeBusy || vm.runtimeProbeChecking}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.username}@{profile.host}:{profile.port})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className={vm.runtimeProbeMessageIsError ? 'status-line error' : 'status-line'}>
            {vm.runtimeProbeMessage ?? '点击“开始探测”检查远程服务器运行环境。'}
          </p>
          {vm.latestCheckedAt > 0 && <p className="status-line">最近探测时间：{formatUnixTime(vm.latestCheckedAt)}</p>}

          <div className="environment-runtime-list-scroll">
            <div className="environment-runtime-grid">
              {sortedLanguages.map((language) => {
              const result = resultMap.get(language);
              const activeMatch = result?.matches?.find((item) => item.active);
              const status = renderRuntimeStatus(result);
              const found = result?.found ?? false;
              return (
                <article key={language} className="host-card environment-runtime-card">
                  <header className="host-card-header">
                    <div>
                      <h3>{RUNTIME_LANGUAGE_LABELS[language]}</h3>
                      <p>{status}</p>
                    </div>
                    <span className={found ? 'chip environment-chip found' : 'chip environment-chip'}>
                      {status}
                    </span>
                  </header>

                  <div className="environment-runtime-meta">
                    <div className="environment-runtime-summary">
                      <div className="environment-runtime-row">
                        <p className="environment-runtime-row-label">当前使用</p>
                        <code className="environment-runtime-row-value code">
                          {activeMatch?.binary_path?.trim() || result?.binary_path?.trim() || '-'}
                        </code>
                      </div>
                      <div className="environment-runtime-row">
                        <p className="environment-runtime-row-label">版本</p>
                        <p className="environment-runtime-row-value text">
                          {activeMatch?.version?.trim() || result?.version?.trim() || '-'}
                        </p>
                      </div>
                    </div>
                    {result?.matches?.length ? (
                      <div className="environment-runtime-matches">
                        <p className="environment-runtime-matches-title">检测到 {result.matches.length} 个环境：</p>
                        <ul>
                          {result.matches.map((item, index) => (
                            <li key={`${language}-${item.binary_path}-${index}`}>
                              <code className="environment-runtime-match-path">{item.binary_path}</code>
                              <div className="environment-runtime-match-meta">
                                {item.active && <span className="environment-runtime-active-badge">当前使用</span>}
                                <p className="environment-runtime-match-version">{item.version?.trim() || '版本未知'}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {result?.message?.trim() && <p className="status-line">{result.message}</p>}
                  </div>
                </article>
              );
            })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
