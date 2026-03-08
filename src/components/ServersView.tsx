import type { ConnectionProfile } from '../types';

type ServersViewProps = {
  profiles: ConnectionProfile[];
  profilesBusy: boolean;
  profileMessage: string | null;
  connectedCount: number;
  onOpenCreateEditor: () => void;
  onRefreshProfiles: () => void;
  onConnectLocalTerminal: () => void;
  onConnectProfile: (profile: ConnectionProfile) => void;
  onOpenEditEditor: (profile: ConnectionProfile) => void;
  onDeleteProfile: (profile: ConnectionProfile) => void;
};

export function ServersView({
  profiles,
  profilesBusy,
  profileMessage,
  connectedCount,
  onOpenCreateEditor,
  onRefreshProfiles,
  onConnectLocalTerminal,
  onConnectProfile,
  onOpenEditEditor,
  onDeleteProfile
}: ServersViewProps) {
  return (
    <div className="servers-page">
      <aside className="servers-sidebar content-section">
        <h3 className="servers-sidebar-title">服务器</h3>
        <button type="button" className="servers-nav-btn active">
          全部服务器
          <span>{profiles.length}</span>
        </button>
        <button type="button" className="servers-nav-btn" onClick={onOpenCreateEditor} disabled={profilesBusy}>
          新增服务器
        </button>
        <button type="button" className="servers-nav-btn" onClick={onRefreshProfiles} disabled={profilesBusy}>
          刷新列表
        </button>
        <p className="servers-sidebar-meta">活动会话：{connectedCount}</p>
      </aside>

      <section className="servers-content content-section">
        <div className="section-header">
          <h2>服务器列表</h2>
          <div className="section-actions">
            <button type="button" onClick={onOpenCreateEditor} disabled={profilesBusy}>
              新增服务器
            </button>
          </div>
        </div>

        {profileMessage && <p className="status-line">{profileMessage}</p>}

        <div className="host-grid">
          <article className="host-card local-terminal-card">
            <header className="host-card-header">
              <div>
                <h3>本地终端</h3>
                <p className="local-terminal-meta">在当前设备打开本地 shell，会话支持多开</p>
              </div>
              <span className="chip">Local</span>
            </header>

            <div className="card-actions">
              <button type="button" onClick={onConnectLocalTerminal}>
                打开终端
              </button>
            </div>
          </article>

          {profiles.length === 0 && <div className="empty-state host-empty">暂无服务器配置，点击“新增服务器”创建。</div>}

          {profiles.map((profile) => (
            <article key={profile.id} className="host-card">
              <header className="host-card-header">
                <div>
                  <h3>{profile.name}</h3>
                  <p>
                    {profile.username}@{profile.host}:{profile.port}
                  </p>
                </div>
                <span className="chip">{profile.auth_kind === 'password' ? '密码' : '私钥'}</span>
              </header>

              <div className="card-actions">
                <button type="button" onClick={() => onConnectProfile(profile)}>
                  连接
                </button>
                <button type="button" onClick={() => onOpenEditEditor(profile)} disabled={profilesBusy}>
                  编辑
                </button>
                <button type="button" className="danger" onClick={() => onDeleteProfile(profile)} disabled={profilesBusy}>
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
