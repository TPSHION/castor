import { TerminalView } from './TerminalView';
import type { ContentView, SessionTab } from '../app/types';

type WorkspaceViewProps = {
  activeTab: SessionTab | null;
  activeTabId: string | null;
  contentView: ContentView;
  sessionTabs: SessionTab[];
  onDisconnectActiveTab: () => void;
  onRetryActiveTab: () => void;
};

export function WorkspaceView({
  activeTab,
  activeTabId,
  contentView,
  sessionTabs,
  onDisconnectActiveTab,
  onRetryActiveTab
}: WorkspaceViewProps) {
  if (!activeTab) {
    return <div className="workspace-empty">暂无会话，请从服务器页发起连接。</div>;
  }

  if (activeTab.status !== 'connected') {
    const title =
      activeTab.status === 'connecting' ? '正在连接...' : activeTab.status === 'error' ? '连接失败' : '连接已关闭';

    return (
      <div className="connect-page">
        <div className="connect-card">
          <div className="connect-target">
            <h3>{title}</h3>
            <p>{activeTab.name}</p>
          </div>

          <div className={`connect-line ${activeTab.status}`}>
            <div className="connect-node left" />
            <div className="connect-track" />
            <div className="connect-node right" />
          </div>

          <p className={activeTab.status === 'error' ? 'status-line error' : 'status-line'}>{activeTab.statusMessage}</p>

          <div className="section-actions center">
            <button type="button" onClick={onDisconnectActiveTab}>
              关闭
            </button>
            {activeTab.status === 'error' && (
              <button type="button" onClick={onRetryActiveTab}>
                重试
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-terminal-view">
      <div className="terminal-stack">
        {sessionTabs
          .filter((tab) => tab.sessionId)
          .map((tab) => (
            <div key={tab.id} className={activeTabId === tab.id ? 'terminal-pane active' : 'terminal-pane hidden'}>
              <TerminalView sessionId={tab.sessionId!} active={contentView === 'workspace' && activeTabId === tab.id} />
            </div>
          ))}
      </div>
    </div>
  );
}
