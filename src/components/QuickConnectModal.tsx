import type { ConnectionProfile } from '../types';

type QuickConnectModalProps = {
  isOpen: boolean;
  profiles: ConnectionProfile[];
  onClose: () => void;
  onQuickConnectLocal: () => void;
  onQuickConnectProfile: (profile: ConnectionProfile) => void;
  onGoAddServer: () => void;
};

export function QuickConnectModal({
  isOpen,
  profiles,
  onClose,
  onQuickConnectLocal,
  onQuickConnectProfile,
  onGoAddServer
}: QuickConnectModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="quick-connect-overlay" onClick={onClose}>
      <section
        className="quick-connect-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick connect"
      >
        <header className="quick-connect-header">
          <h3>创建新的 SSH 连接</h3>
          <button type="button" className="header-action" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="quick-connect-body">
          <div className="quick-connect-shortcuts">
            <button type="button" className="quick-connect-local" onClick={onQuickConnectLocal}>
              打开本地终端
            </button>
          </div>

          {profiles.length === 0 ? (
            <div className="empty-state">
              还没有可用服务器，请先添加服务器配置。
              <div className="section-actions center">
                <button type="button" onClick={onGoAddServer}>
                  去添加服务器
                </button>
              </div>
            </div>
          ) : (
            <div className="quick-connect-list">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="quick-connect-item"
                  onClick={() => onQuickConnectProfile(profile)}
                >
                  <span className="quick-connect-name">{profile.name}</span>
                  <span className="quick-connect-meta">
                    {profile.username}@{profile.host}:{profile.port}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
