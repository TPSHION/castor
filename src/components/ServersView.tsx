import { useState } from 'react';
import type { ConnectionProfile } from '../types';
import { SystemdDeployPanel } from './SystemdDeployPanel';
import { NginxServicePanel } from './NginxServicePanel';
import { EnvironmentConfigPanel } from './environment/EnvironmentConfigPanel';
import { EnvironmentDeployPanel } from './environment/EnvironmentDeployPanel';

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

type ActiveMenu = 'servers' | 'settings' | 'systemd' | 'nginx' | 'environment_probe' | 'environment_deploy';
type MenuIconName = 'servers' | 'settings' | 'systemd' | 'nginx' | 'environment_probe' | 'environment_deploy';

function MenuIcon({ name }: { name: MenuIconName }) {
  if (name === 'servers') {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4.5" width="17" height="6" rx="1.5" />
        <rect x="3.5" y="13.5" width="17" height="6" rx="1.5" />
        <path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h6M11 16.5h6" />
      </svg>
    );
  }
  if (name === 'systemd') {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3.8l1.8 2.7 3.3.4-2.2 2.3.6 3.2-3-1.4-3 1.4.6-3.2-2.2-2.3 3.3-.4L12 3.8z" />
        <rect x="4.5" y="13.5" width="15" height="6.2" rx="1.5" />
        <path d="M8 16.6h8" />
      </svg>
    );
  }
  if (name === 'nginx') {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3.5l6.2 3.6v9.8L12 20.5l-6.2-3.6V7.1L12 3.5z" />
        <path d="M12 3.5v17M5.8 7.1l12.4 9.8M18.2 7.1L5.8 16.9" />
      </svg>
    );
  }
  if (name === 'environment_probe') {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.5 4.5h3l6 6-6 6h-3l6-6-6-6z" />
        <path d="M6.5 4.5h3l6 6-6 6h-3l6-6-6-6z" />
      </svg>
    );
  }
  if (name === 'environment_deploy') {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4.5" y="4.5" width="15" height="10" rx="1.8" />
        <path d="M9 9.5h6M12 14.5v5" />
        <path d="M9.5 18l2.5 2.5L14.5 18" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5l1.8 1.4 2.3-.2.7 2.2 2 1.2-1 2.1 1 2.1-2 1.2-.7 2.2-2.3-.2L12 19.5l-1.8-1.4-2.3.2-.7-2.2-2-1.2 1-2.1-1-2.1 2-1.2.7-2.2 2.3.2L12 4.5z" />
      <path d="M12 9.5v5M9.5 12h5" />
    </svg>
  );
}

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
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>('servers');
  const menuItems: Array<{ id: ActiveMenu; label: string; icon: MenuIconName; badge?: number }> = [
    { id: 'servers', label: '服务器', icon: 'servers', badge: profiles.length },
    { id: 'systemd', label: 'systemd部署', icon: 'systemd' },
    { id: 'nginx', label: 'nginx服务管理', icon: 'nginx' },
    { id: 'environment_probe', label: '环境探测', icon: 'environment_probe' },
    { id: 'environment_deploy', label: '环境部署', icon: 'environment_deploy' },
    { id: 'settings', label: '设置', icon: 'settings' }
  ];

  return (
    <div className="servers-page">
      <aside className="servers-sidebar">
        <div className="servers-sidebar-brand" aria-label="Castor">
          <span className="servers-brand-mark" aria-hidden="true">
            C
          </span>
          <h2 className="servers-brand-name">Castor</h2>
        </div>

        <div className="servers-sidebar-menu">
          {menuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeMenu === item.id ? 'servers-nav-btn active' : 'servers-nav-btn'}
              onClick={() => setActiveMenu(item.id)}
            >
              <span className="servers-nav-main">
                <span className="servers-nav-icon" aria-hidden="true">
                  <MenuIcon name={item.icon} />
                </span>
                <span className="servers-nav-text">{item.label}</span>
              </span>
              {typeof item.badge === 'number' ? <span className="servers-nav-badge">{item.badge}</span> : null}
            </button>
          ))}
        </div>
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
        ) : activeMenu === 'nginx' ? (
          <NginxServicePanel profiles={profiles} />
        ) : activeMenu === 'environment_probe' ? (
          <EnvironmentConfigPanel profiles={profiles} />
        ) : activeMenu === 'environment_deploy' ? (
          <EnvironmentDeployPanel profiles={profiles} />
        ) : (
          <div className="empty-state">设置内容将在这里展示。</div>
        )}
      </section>
    </div>
  );
}
