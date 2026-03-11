import { ServersView } from '../ServersView';
import { SftpView } from '../SftpView';
import { WorkspaceView } from '../WorkspaceView';
import type { ContentView, ConnectionProfile, SessionTab } from '../../app/types';
import type { SftpViewProps } from '../sftp/types';

type ServersContentProps = {
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

type WorkspaceContentProps = {
  activeTab: SessionTab | null;
  activeTabId: string | null;
  sessionTabs: SessionTab[];
  onDisconnectActiveTab: () => void;
  onRetryActiveTab: () => void;
};

type AppContentProps = {
  contentView: ContentView;
  servers: ServersContentProps;
  sftp: Omit<SftpViewProps, 'isActive'>;
  workspace: WorkspaceContentProps;
};

export function AppContent({ contentView, servers, sftp, workspace }: AppContentProps) {
  return (
    <>
      <div className={contentView === 'servers' ? 'view-page' : 'view-page hidden'}>
        <ServersView
          profiles={servers.profiles}
          profilesBusy={servers.profilesBusy}
          profileMessage={servers.profileMessage}
          connectedCount={servers.connectedCount}
          onOpenCreateEditor={servers.onOpenCreateEditor}
          onRefreshProfiles={servers.onRefreshProfiles}
          onConnectLocalTerminal={servers.onConnectLocalTerminal}
          onConnectProfile={servers.onConnectProfile}
          onOpenEditEditor={servers.onOpenEditEditor}
          onDeleteProfile={servers.onDeleteProfile}
        />
      </div>
      <div className={contentView === 'sftp' ? 'view-page' : 'view-page hidden'}>
        <SftpView {...sftp} isActive={contentView === 'sftp'} />
      </div>
      <div className={contentView === 'workspace' ? 'view-page workspace-page' : 'view-page workspace-page hidden'}>
        <WorkspaceView
          activeTab={workspace.activeTab}
          activeTabId={workspace.activeTabId}
          contentView={contentView}
          sessionTabs={workspace.sessionTabs}
          onDisconnectActiveTab={workspace.onDisconnectActiveTab}
          onRetryActiveTab={workspace.onRetryActiveTab}
        />
      </div>
    </>
  );
}
