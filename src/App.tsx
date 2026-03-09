import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LocalActionDialog } from './components/LocalActionDialog';
import { LocalContextMenu } from './components/LocalContextMenu';
import { LocalUploadConflictDialog } from './components/LocalUploadConflictDialog';
import { QuickConnectModal } from './components/QuickConnectModal';
import { ServerEditorModal } from './components/ServerEditorModal';
import { ServersView } from './components/ServersView';
import { SftpActionDialog } from './components/SftpActionDialog';
import { SftpContextMenu } from './components/SftpContextMenu';
import { SftpView } from './components/SftpView';
import { WorkspaceView } from './components/WorkspaceView';
import type {
  LocalFsEntry,
  SftpEntry
} from './types';
import type { ContentView, ConnectionProfile } from './app/types';
import {
  defaultPermissionInput,
  formatBytes,
  formatInvokeError,
  formatPermissionMode,
  formatUnixTime
} from './app/helpers';
import { useContextMenuDismiss } from './app/hooks/useContextMenuDismiss';
import { useProfilesManager } from './app/hooks/useProfilesManager';
import { useScrollbarWidthVariable } from './app/hooks/useScrollbarWidthVariable';
import { useLocalFilePane } from './app/hooks/useLocalFilePane';
import { useSessionManager } from './app/hooks/useSessionManager';
import { useSftpPane } from './app/hooks/useSftpPane';
import { useTransferOrchestrator } from './app/hooks/useTransferOrchestrator';
import { useTransferProgressManager } from './app/hooks/useTransferProgressManager';
import { useWindowTitlebarOverlay } from './app/hooks/useWindowTitlebarOverlay';

export function App() {
  const MIN_TRANSFER_PROGRESS_VISIBLE_MS = 600;
  const localTransferManager = useTransferProgressManager({ minVisibleMs: MIN_TRANSFER_PROGRESS_VISIBLE_MS });
  const sftpTransferManager = useTransferProgressManager({ minVisibleMs: MIN_TRANSFER_PROGRESS_VISIBLE_MS });
  const [contentView, setContentView] = useState<ContentView>('servers');
  const {
    profiles,
    profilesBusy,
    profileMessage,
    setProfileMessage,
    refreshProfiles,
    isEditorOpen,
    editorMode,
    editor,
    setEditor,
    editorBusy,
    testState,
    editorValidation,
    isQuickConnectOpen,
    openCreateEditor,
    openEditEditor,
    closeEditor,
    openQuickConnect,
    closeQuickConnect,
    onSaveEditor,
    onTestConnection,
    onDeleteProfile
  } = useProfilesManager();

  const {
    localPath,
    localPathInput,
    setLocalPathInput,
    localParentPath,
    localEntries,
    localBusy,
    localMessage,
    setLocalMessage,
    localSelectedPath,
    setLocalSelectedPath,
    localContextMenu,
    setLocalContextMenu,
    closeLocalContextMenu,
    localActionDialog,
    setLocalActionDialog,
    localActionError,
    setLocalActionError,
    loadLocalDir,
    onLocalOpenPath,
    onLocalGoParent,
    onLocalEnterDir,
    closeLocalActionDialog,
    updateLocalActionValue,
    openLocalContextMenuAt: openLocalContextMenuAtCore,
    submitLocalActionDialog
  } = useLocalFilePane();
  const localTransferProgresses = localTransferManager.progresses;
  const localCompletedTransferProgresses = localTransferManager.completed;
  const localContextMenuRef = useRef<HTMLDivElement>(null);

  const {
    selectedSftpProfileId,
    setSelectedSftpProfileId,
    connectedSftpProfileId,
    setConnectedSftpProfileId,
    selectedSftpProfile,
    connectedSftpProfile,
    sftpPath,
    setSftpPath,
    sftpPathInput,
    setSftpPathInput,
    sftpEntries,
    setSftpEntries,
    sftpBusy,
    sftpMessage,
    setSftpMessage,
    sftpSelectedPath,
    setSftpSelectedPath,
    sftpContextMenu,
    setSftpContextMenu,
    closeSftpContextMenu,
    sftpActionDialog,
    setSftpActionDialog,
    sftpActionError,
    setSftpActionError,
    loadSftpDir,
    onSelectSftpProfile: onSelectSftpProfileCore,
    onConnectSftpHost,
    disconnectSftpHostSession,
    onOpenSftpPath,
    onSftpGoParent,
    onSftpEnterDir,
    closeSftpActionDialog,
    updateSftpActionValue,
    openSftpContextMenuAt: openSftpContextMenuAtCore,
    submitSftpActionDialog
  } = useSftpPane(profiles);
  const sftpTransferProgresses = sftpTransferManager.progresses;
  const sftpCompletedTransferProgresses = sftpTransferManager.completed;
  const sftpContextMenuRef = useRef<HTMLDivElement>(null);

  const {
    sessionTabs,
    activeTabId,
    activeTab,
    connectedCount,
    connectProfile: onConnectProfile,
    connectLocalTerminal: onConnectLocalTerminal,
    closeTab,
    disconnectActiveTab: onDisconnectActiveTab,
    retryActiveTab,
    openTab
  } = useSessionManager({
    profiles,
    onShowWorkspace: () => setContentView('workspace'),
    onShowServers: () => setContentView('servers'),
    onProfileMessage: setProfileMessage
  });

  const {
    localUploadConflictDialog,
    localUploadConflictRenameValue,
    setLocalUploadConflictRenameValue,
    localUploadConflictError,
    setLocalUploadConflictError,
    clearLocalUploadConflictState,
    closeLocalUploadConflictDialog,
    onUploadSystemPathsToRemote,
    onLocalCopyToTarget,
    onSubmitLocalUploadConflict,
    onSubmitLocalUploadManualRename,
    onSftpDownload,
    onSftpCopyToTarget,
    onCancelSftpDownload,
    onCancelLocalUpload,
    resetSystemDropQueue,
    resetTransferOrchestratorState
  } = useTransferOrchestrator({
    connectedSftpProfile,
    sftpEntries,
    sftpPath,
    loadSftpDir,
    localPath,
    loadLocalDir,
    localBusy,
    closeLocalContextMenu,
    closeSftpContextMenu,
    setLocalMessage,
    setLocalSelectedPath,
    setSftpMessage,
    setSftpSelectedPath,
    localTransferManager,
    sftpTransferManager
  });

  useScrollbarWidthVariable('--sftp-body-scrollbar-width');
  useWindowTitlebarOverlay();
  useContextMenuDismiss(Boolean(localContextMenu), localContextMenuRef, closeLocalContextMenu);
  useContextMenuDismiss(Boolean(sftpContextMenu), sftpContextMenuRef, closeSftpContextMenu);

  const onSelectSftpProfile = useCallback(
    (profileId: string) => {
      if (connectedSftpProfile && connectedSftpProfile.id !== profileId) {
        const confirmed = window.confirm(
          `当前已连接服务器“${connectedSftpProfile.name}”。切换到其他服务器前需要关闭旧会话，是否继续？`
        );
        if (!confirmed) {
          return;
        }

        void (async () => {
          try {
            await disconnectSftpHostSession(connectedSftpProfile);
          } catch (invokeError) {
            setSftpMessage(`关闭旧会话失败：${formatInvokeError(invokeError)}`);
            return;
          }

          onSelectSftpProfileCore(profileId, {
            onSwitchedConnectedProfile: resetSystemDropQueue
          });
        })();
        return;
      }

      onSelectSftpProfileCore(profileId, {
        onSwitchedConnectedProfile: resetSystemDropQueue
      });
    },
    [
      connectedSftpProfile,
      disconnectSftpHostSession,
      onSelectSftpProfileCore,
      resetSystemDropQueue,
      setSftpMessage
    ]
  );

  function openLocalContextMenuAt(x: number, y: number, entry: LocalFsEntry | null) {
    setSftpContextMenu(null);
    setLocalActionDialog(null);
    clearLocalUploadConflictState();
    setLocalActionError(null);
    openLocalContextMenuAtCore(x, y, entry);
  }

  function openSftpContextMenuAt(x: number, y: number, entry: SftpEntry | null) {
    setLocalContextMenu(null);
    setSftpActionDialog(null);
    setSftpActionError(null);
    openSftpContextMenuAtCore(x, y, entry);
  }

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedSftpProfileId('');
      setConnectedSftpProfileId('');
      setSftpEntries([]);
      setSftpMessage(null);
      setSftpSelectedPath(null);
      setSftpContextMenu(null);
      setSftpActionDialog(null);
      setSftpActionError(null);
      resetTransferOrchestratorState();
      return;
    }

    if (!profiles.some((profile) => profile.id === selectedSftpProfileId)) {
      setSelectedSftpProfileId(profiles[0].id);
    }

    if (connectedSftpProfileId && !profiles.some((profile) => profile.id === connectedSftpProfileId)) {
      setConnectedSftpProfileId('');
      setSftpEntries([]);
      setSftpSelectedPath(null);
      setSftpContextMenu(null);
      setSftpActionDialog(null);
      setSftpActionError(null);
      clearLocalUploadConflictState();
      resetSystemDropQueue();
      sftpTransferManager.reset();
      setSftpMessage('当前远程连接服务器已不存在，请重新选择。');
    }
  }, [
    clearLocalUploadConflictState,
    connectedSftpProfileId,
    profiles,
    resetSystemDropQueue,
    resetTransferOrchestratorState,
    selectedSftpProfileId,
    sftpTransferManager.reset
  ]);

  useEffect(() => {
    setLocalContextMenu(null);
    setSftpContextMenu(null);
    clearLocalUploadConflictState();
  }, [clearLocalUploadConflictState, contentView]);

  async function openSftpView() {
    setContentView('sftp');
    if (!localPath) {
      await loadLocalDir();
    }

    if (profiles.length === 0) {
      setSftpEntries([]);
      setSftpMessage('暂无服务器配置，请先新增服务器。');
      return;
    }

    if (!selectedSftpProfileId) {
      onSelectSftpProfile(profiles[0].id);
    }
  }

  async function onDisconnectSftpHost() {
    if (!connectedSftpProfile) {
      return;
    }
    try {
      await disconnectSftpHostSession(connectedSftpProfile);
    } catch (invokeError) {
      setSftpMessage(`关闭连接失败：${formatInvokeError(invokeError)}`);
      return;
    }
    resetSystemDropQueue();
    const name = connectedSftpProfile.name;
    setConnectedSftpProfileId('');
    setSftpEntries([]);
    setSftpPath('/root');
    setSftpPathInput('/root');
    setSftpSelectedPath(null);
    setSftpContextMenu(null);
    setSftpActionDialog(null);
    setSftpActionError(null);
    clearLocalUploadConflictState();
    sftpTransferManager.reset();
    setSftpMessage(`已关闭与 ${name} 的 SFTP 连接`);
  }

  function clearLocalCompletedTransfers() {
    localTransferManager.clearCompleted();
  }

  function clearSftpCompletedTransfers() {
    sftpTransferManager.clearCompleted();
  }

  async function onQuickConnectProfile(profile: ConnectionProfile) {
    closeQuickConnect();
    await onConnectProfile(profile);
  }

  async function onQuickConnectLocal() {
    closeQuickConnect();
    await onConnectLocalTerminal();
  }

  const onHeaderMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (target.closest('button, input, select, textarea, a, [role="button"], [data-no-window-drag="true"]')) {
      return;
    }
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
    void getCurrentWindow().startDragging().catch(() => {});
  }, []);

  function renderBody() {
    return (
      <>
        <div className={contentView === 'servers' ? 'view-page' : 'view-page hidden'}>
          <ServersView
            profiles={profiles}
            profilesBusy={profilesBusy}
            profileMessage={profileMessage}
            connectedCount={connectedCount}
            onOpenCreateEditor={openCreateEditor}
            onRefreshProfiles={() => void refreshProfiles()}
            onConnectLocalTerminal={() => void onConnectLocalTerminal()}
            onConnectProfile={(profile) => void onConnectProfile(profile)}
            onOpenEditEditor={openEditEditor}
            onDeleteProfile={(profile) => void onDeleteProfile(profile)}
          />
        </div>
        <div className={contentView === 'sftp' ? 'view-page' : 'view-page hidden'}>
          <SftpView
            isActive={contentView === 'sftp'}
            profiles={profiles}
            selectedSftpProfileId={selectedSftpProfileId}
            selectedSftpProfile={selectedSftpProfile}
            connectedSftpProfile={connectedSftpProfile}
            sftpBusy={sftpBusy}
            sftpMessage={sftpMessage}
            sftpPath={sftpPath}
            sftpPathInput={sftpPathInput}
            sftpEntries={sftpEntries}
            sftpSelectedPath={sftpSelectedPath}
            localPath={localPath}
            localPathInput={localPathInput}
            localParentPath={localParentPath}
            localEntries={localEntries}
            localBusy={localBusy}
            localMessage={localMessage}
            localSelectedPath={localSelectedPath}
            localTransferProgresses={localTransferProgresses}
            localCompletedTransferProgresses={localCompletedTransferProgresses}
            sftpTransferProgresses={sftpTransferProgresses}
            sftpCompletedTransferProgresses={sftpCompletedTransferProgresses}
            formatBytes={formatBytes}
            formatUnixTime={formatUnixTime}
            onSelectSftpProfile={onSelectSftpProfile}
            onConnectSftpHost={() => void onConnectSftpHost()}
            onRefreshConnectedSftpHost={() => {
              if (connectedSftpProfile) {
                void loadSftpDir(connectedSftpProfile, sftpPath, {
                  silent: true,
                  background: true
                });
              }
            }}
            onDisconnectSftpHost={onDisconnectSftpHost}
            onSftpPathInputChange={setSftpPathInput}
            onOpenSftpPath={() => void onOpenSftpPath()}
            onSftpGoParent={() => void onSftpGoParent()}
            onSftpEnterDir={(entry) => void onSftpEnterDir(entry)}
            onSftpDownload={(entry) => void onSftpDownload(entry)}
            onSftpSelectPath={setSftpSelectedPath}
            onOpenSftpContextMenu={(x, y, entry) => openSftpContextMenuAt(x, y, entry)}
            onLocalPathInputChange={setLocalPathInput}
            onLocalOpenPath={() => void onLocalOpenPath()}
            onLocalGoParent={() => void onLocalGoParent()}
            onRefreshLocalDir={() =>
              void loadLocalDir(localPath, {
                silent: true,
                background: true
              })
            }
            onLocalEnterDir={(entry) => void onLocalEnterDir(entry)}
            onLocalSelectPath={setLocalSelectedPath}
            onOpenLocalContextMenu={(x, y, entry) => openLocalContextMenuAt(x, y, entry)}
            onOpenCreateEditor={openCreateEditor}
            onCancelUpload={(transferId) => void onCancelLocalUpload(transferId)}
            onCancelDownload={(transferId) => void onCancelSftpDownload(transferId)}
            onClearLocalCompletedTransfers={clearLocalCompletedTransfers}
            onClearSftpCompletedTransfers={clearSftpCompletedTransfers}
            onUploadLocalEntryToRemote={(entry) => void onLocalCopyToTarget(entry)}
            onDownloadRemoteEntryToLocal={(entry) => void onSftpCopyToTarget(entry)}
            onUploadSystemPathsToRemote={onUploadSystemPathsToRemote}
          />
        </div>
        <div className={contentView === 'workspace' ? 'view-page workspace-page' : 'view-page workspace-page hidden'}>
          <WorkspaceView
            activeTab={activeTab}
            activeTabId={activeTabId}
            contentView={contentView}
            sessionTabs={sessionTabs}
            onDisconnectActiveTab={() => void onDisconnectActiveTab()}
            onRetryActiveTab={() => void retryActiveTab()}
          />
        </div>
      </>
    );
  }

  return (
    <main className="window-shell">
      <header className="window-header" data-tauri-drag-region onMouseDownCapture={onHeaderMouseDownCapture}>
        <div className="header-functions">
          <button
            type="button"
            className={contentView === 'servers' ? 'header-pill active' : 'header-pill'}
            onClick={() => setContentView('servers')}
          >
            服务器
          </button>
          <button
            type="button"
            className={contentView === 'sftp' ? 'header-pill active' : 'header-pill'}
            onClick={() => void openSftpView()}
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
              onClick={() => openTab(tab.id)}
            >
              <span className={`dot ${tab.status}`} />
              <span className="tab-title">{tab.name}</span>
              <span
                className="tab-close"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    void closeTab(tab.id);
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
                <button type="button" className="header-action" onClick={() => void retryActiveTab()}>
                  重试
                </button>
              )}
              <button type="button" className="header-action" onClick={() => void onDisconnectActiveTab()}>
                断开
              </button>
            </>
          )}
          <button type="button" className="header-plus" onClick={openQuickConnect}>
            +
          </button>
        </div>
      </header>

      <section
        className={
          contentView === 'workspace'
            ? 'window-body workspace-body'
            : contentView === 'sftp'
              ? 'window-body sftp-body'
              : 'window-body'
        }
      >
        {renderBody()}
      </section>

      <ServerEditorModal
        isOpen={isEditorOpen}
        editorMode={editorMode}
        editor={editor}
        editorBusy={editorBusy}
        testState={testState}
        editorValidation={editorValidation}
        onClose={closeEditor}
        onTestConnection={() => void onTestConnection()}
        onSave={() => void onSaveEditor()}
        setEditor={setEditor}
      />
      <QuickConnectModal
        isOpen={isQuickConnectOpen}
        profiles={profiles}
        onClose={closeQuickConnect}
        onQuickConnectLocal={() => void onQuickConnectLocal()}
        onQuickConnectProfile={(profile) => void onQuickConnectProfile(profile)}
        onGoAddServer={() => {
          closeQuickConnect();
          openCreateEditor();
          setContentView('servers');
        }}
      />
      <LocalUploadConflictDialog
        dialog={localUploadConflictDialog}
        busy={localBusy}
        manualName={localUploadConflictRenameValue}
        manualError={localUploadConflictError}
        onClose={closeLocalUploadConflictDialog}
        onChangeManualName={(value) => {
          setLocalUploadConflictRenameValue(value);
          if (localUploadConflictError) {
            setLocalUploadConflictError(null);
          }
        }}
        onSubmitManualRename={() => void onSubmitLocalUploadManualRename()}
        onSelectStrategy={(strategy) => void onSubmitLocalUploadConflict(strategy)}
      />
      <LocalActionDialog
        dialog={localActionDialog}
        busy={localBusy}
        error={localActionError}
        onClose={closeLocalActionDialog}
        onChangeValue={updateLocalActionValue}
        onSubmit={() => void submitLocalActionDialog()}
      />
      <LocalContextMenu
        contentView={contentView}
        contextMenu={localContextMenu}
        menuRef={localContextMenuRef}
        hasLocalPath={Boolean(localPath)}
        canCopyToTarget={Boolean(connectedSftpProfile)}
        onClose={() => setLocalContextMenu(null)}
        onOpenDir={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            void onLocalEnterDir(entry);
          }
        }}
        onCopyToTarget={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            void onLocalCopyToTarget(entry);
          }
        }}
        onOpenRename={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            setLocalContextMenu(null);
            setLocalActionError(null);
            setLocalActionDialog({ kind: 'rename', entry, value: entry.name });
          }
        }}
        onOpenDelete={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            setLocalContextMenu(null);
            setLocalActionError(null);
            setLocalActionDialog({ kind: 'delete', entry });
          }
        }}
        onRefresh={() =>
          void loadLocalDir(localPath, {
            silent: true,
            background: true
          })
        }
        onOpenCreateDir={() => {
          setLocalContextMenu(null);
          setLocalActionError(null);
          setLocalActionDialog({ kind: 'create_dir', parentPath: localPath, value: '' });
        }}
      />
      <SftpActionDialog
        dialog={sftpActionDialog}
        busy={sftpBusy}
        error={sftpActionError}
        formatPermissionMode={formatPermissionMode}
        onClose={closeSftpActionDialog}
        onChangeValue={updateSftpActionValue}
        onSubmit={() => void submitSftpActionDialog()}
      />
      <SftpContextMenu
        contentView={contentView}
        contextMenu={sftpContextMenu}
        menuRef={sftpContextMenuRef}
        hasConnectedProfile={Boolean(connectedSftpProfile)}
        currentPath={sftpPath}
        formatPermissionMode={formatPermissionMode}
        onClose={() => setSftpContextMenu(null)}
        onOpenDir={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            void onSftpEnterDir(entry);
          }
        }}
        onCopyToTarget={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            void onSftpCopyToTarget(entry);
          }
        }}
        onOpenRename={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            setSftpContextMenu(null);
            setSftpActionError(null);
            setSftpActionDialog({ kind: 'rename', entry, value: entry.name });
          }
        }}
        onOpenDelete={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            setSftpContextMenu(null);
            setSftpActionError(null);
            setSftpActionDialog({ kind: 'delete', entry });
          }
        }}
        onRefresh={() => {
          if (connectedSftpProfile) {
            void loadSftpDir(connectedSftpProfile, sftpPath, {
              silent: true,
              background: true
            });
          }
        }}
        onOpenCreateDir={(parentPath) => {
          setSftpContextMenu(null);
          setSftpActionError(null);
          setSftpActionDialog({ kind: 'create_dir', parentPath, value: '' });
        }}
        onOpenPermissions={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            setSftpContextMenu(null);
            setSftpActionError(null);
            setSftpActionDialog({
              kind: 'permissions',
              entry,
              value: defaultPermissionInput(entry.permissions, entry.is_dir)
            });
          }
        }}
      />
    </main>
  );
}
