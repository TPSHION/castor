import { type MouseEvent as ReactMouseEvent } from 'react';
import type { ContentView, SessionTab } from '../../app/types';

type AppHeaderProps = {
  contentView: ContentView;
  sessionTabs: SessionTab[];
  activeTabId: string | null;
  activeTab: SessionTab | null;
  onShowServers: () => void;
  onShowSftp: () => void;
  onOpenTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRetryActiveTab: () => void;
  onDisconnectActiveTab: () => void;
  onOpenQuickConnect: () => void;
  onHeaderMouseDownCapture: (event: ReactMouseEvent<HTMLElement>) => void;
};

export function AppHeader({
  contentView,
  sessionTabs,
  activeTabId,
  activeTab,
  onShowServers,
  onShowSftp,
  onOpenTab,
  onCloseTab,
  onRetryActiveTab,
  onDisconnectActiveTab,
  onOpenQuickConnect,
  onHeaderMouseDownCapture
}: AppHeaderProps) {
  return (
    <header className="window-header" data-tauri-drag-region onMouseDownCapture={onHeaderMouseDownCapture}>
      <div className="header-functions">
        <button
          type="button"
          className={contentView === 'servers' ? 'header-pill active' : 'header-pill'}
          onClick={onShowServers}
        >
          服务器
        </button>
        <button
          type="button"
          className={contentView === 'sftp' ? 'header-pill active' : 'header-pill'}
          onClick={onShowSftp}
        >
          SFTP
        </button>
      </div>

      <div className="header-tabs">
        {sessionTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTabId === tab.id ? 'session-tab active' : 'session-tab'}
            onClick={() => onOpenTab(tab.id)}
          >
            <span className={`dot ${tab.status}`} />
            <span className="tab-title">{tab.name}</span>
            <span
              className="tab-close"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }
              }}
            >
              ×
            </span>
          </button>
        ))}
      </div>

      <div
        className="header-drag-handle"
        data-tauri-drag-region
        aria-hidden="true"
        onMouseDown={onHeaderMouseDownCapture}
      />

      <div className="header-actions">
        {contentView === 'workspace' && activeTab && (
          <>
            {activeTab.status === 'error' && (
              <button type="button" className="header-action" onClick={onRetryActiveTab}>
                重试
              </button>
            )}
            <button type="button" className="header-action" onClick={onDisconnectActiveTab}>
              断开
            </button>
          </>
        )}
        <button type="button" className="header-plus" onClick={onOpenQuickConnect}>
          +
        </button>
      </div>
    </header>
  );
}
