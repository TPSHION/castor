import { useState } from 'react';
import type { ConnectionProfile } from '../types';
import { SystemdDeployPanel } from './SystemdDeployPanel';

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
  const [activeMenu, setActiveMenu] = useState<'servers' | 'settings' | 'systemd'>('servers');

  return (
    <div className="servers-page">
      <aside className="servers-sidebar">
        <button
          type="button"
          className={activeMenu === 'servers' ? 'servers-nav-btn active' : 'servers-nav-btn'}
          onClick={() => setActiveMenu('servers')}
        >
          服务器
          <span>{profiles.length}</span>
        </button>
        <button
          type="button"
          className={activeMenu === 'settings' ? 'servers-nav-btn active' : 'servers-nav-btn'}
          onClick={() => setActiveMenu('settings')}
        >
          设置
        </button>
        <button
          type="button"
          className={activeMenu === 'systemd' ? 'servers-nav-btn active' : 'servers-nav-btn'}
          onClick={() => setActiveMenu('systemd')}
        >
          systemd部署
        </button>
      </aside>

      <section className="servers-content">
        {activeMenu === 'servers' ? (
          <>
            <div className="section-header">
              <h2>服务器列表</h2>
              <div className="section-actions">
                <button type="button" onClick={onRefreshProfiles} disabled={profilesBusy}>
                  刷新列表
                </button>
                <button type="button" onClick={onOpenCreateEditor} disabled={profilesBusy}>
                  新增服务器
                </button>
              </div>
            </div>

            <p className="status-line">活动会话：{connectedCount}</p>
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
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onDeleteProfile(profile)}
                      disabled={profilesBusy}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : activeMenu === 'systemd' ? (
          <SystemdDeployPanel profiles={profiles} />
        ) : (
          <div className="empty-state">设置内容将在这里展示。</div>
        )}
      </section>
    </div>
  );
}
