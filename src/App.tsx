import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppContent } from './components/app/AppContent';
import { AppHeader } from './components/app/AppHeader';
import { AppOverlays } from './components/app/AppOverlays';
import type {
  LocalFsEntry,
  SftpEntry
} from './types';
import type { ContentView, ConnectionProfile } from './app/types';
import {
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

  const serversContentProps = {
    profiles,
    profilesBusy,
    profileMessage,
    connectedCount,
    onOpenCreateEditor: openCreateEditor,
    onRefreshProfiles: () => void refreshProfiles(),
    onConnectLocalTerminal: () => void onConnectLocalTerminal(),
    onConnectProfile: (profile: ConnectionProfile) => void onConnectProfile(profile),
    onOpenEditEditor: openEditEditor,
    onDeleteProfile: (profile: ConnectionProfile) => void onDeleteProfile(profile)
  };

  const sftpViewProps = {
    profiles,
    selectedSftpProfileId,
    selectedSftpProfile,
    connectedSftpProfile,
    sftpBusy,
    sftpMessage,
    sftpPath,
    sftpPathInput,
    sftpEntries,
    sftpSelectedPath,
    localPath,
    localPathInput,
    localParentPath,
    localEntries,
    localBusy,
    localMessage,
    localSelectedPath,
    localTransferProgresses,
    localCompletedTransferProgresses,
    sftpTransferProgresses,
    sftpCompletedTransferProgresses,
    formatBytes,
    formatUnixTime,
    onSelectSftpProfile,
    onConnectSftpHost: () => void onConnectSftpHost(),
    onRefreshConnectedSftpHost: () => {
      if (connectedSftpProfile) {
        void loadSftpDir(connectedSftpProfile, sftpPath, {
          silent: true,
          background: true
        });
      }
    },
    onDisconnectSftpHost,
    onSftpPathInputChange: setSftpPathInput,
    onOpenSftpPath: () => void onOpenSftpPath(),
    onSftpGoParent: () => void onSftpGoParent(),
    onSftpEnterDir: (entry: SftpEntry) => void onSftpEnterDir(entry),
    onSftpDownload: (entry: SftpEntry) => void onSftpDownload(entry),
    onSftpSelectPath: setSftpSelectedPath,
    onOpenSftpContextMenu: (x: number, y: number, entry: SftpEntry | null) => openSftpContextMenuAt(x, y, entry),
    onLocalPathInputChange: setLocalPathInput,
    onLocalOpenPath: () => void onLocalOpenPath(),
    onLocalGoParent: () => void onLocalGoParent(),
    onRefreshLocalDir: () =>
      void loadLocalDir(localPath, {
        silent: true,
        background: true
      }),
    onLocalEnterDir: (entry: LocalFsEntry) => void onLocalEnterDir(entry),
    onLocalSelectPath: setLocalSelectedPath,
    onOpenLocalContextMenu: (x: number, y: number, entry: LocalFsEntry | null) => openLocalContextMenuAt(x, y, entry),
    onOpenCreateEditor: openCreateEditor,
    onCancelUpload: (transferId: string) => void onCancelLocalUpload(transferId),
    onCancelDownload: (transferId: string) => void onCancelSftpDownload(transferId),
    onClearLocalCompletedTransfers: clearLocalCompletedTransfers,
    onClearSftpCompletedTransfers: clearSftpCompletedTransfers,
    onUploadLocalEntryToRemote: (entry: LocalFsEntry) => void onLocalCopyToTarget(entry),
    onDownloadRemoteEntryToLocal: (entry: SftpEntry) => void onSftpCopyToTarget(entry),
    onUploadSystemPathsToRemote
  };

  const workspaceContentProps = {
    activeTab,
    activeTabId,
    sessionTabs,
    onDisconnectActiveTab: () => void onDisconnectActiveTab(),
    onRetryActiveTab: () => void retryActiveTab()
  };

  return (
    <main className="window-shell">
      <AppHeader
        contentView={contentView}
        sessionTabs={sessionTabs}
        activeTabId={activeTabId}
        activeTab={activeTab}
        onShowServers={() => setContentView('servers')}
        onShowSftp={() => void openSftpView()}
        onOpenTab={openTab}
        onCloseTab={(tabId) => void closeTab(tabId)}
        onRetryActiveTab={() => void retryActiveTab()}
        onDisconnectActiveTab={() => void onDisconnectActiveTab()}
        onOpenQuickConnect={openQuickConnect}
        onHeaderMouseDownCapture={onHeaderMouseDownCapture}
      />

      <section
        className={
          contentView === 'workspace'
            ? 'window-body workspace-body'
            : contentView === 'sftp'
              ? 'window-body sftp-body'
              : 'window-body servers-body'
        }
      >
        <AppContent
          contentView={contentView}
          servers={serversContentProps}
          sftp={sftpViewProps}
          workspace={workspaceContentProps}
        />
      </section>

      <AppOverlays
        contentView={contentView}
        profiles={profiles}
        connectedSftpProfile={connectedSftpProfile}
        localPath={localPath}
        localEntries={localEntries}
        localBusy={localBusy}
        localContextMenu={localContextMenu}
        localContextMenuRef={localContextMenuRef}
        localActionDialog={localActionDialog}
        localActionError={localActionError}
        sftpPath={sftpPath}
        sftpEntries={sftpEntries}
        sftpBusy={sftpBusy}
        sftpContextMenu={sftpContextMenu}
        sftpContextMenuRef={sftpContextMenuRef}
        sftpActionDialog={sftpActionDialog}
        sftpActionError={sftpActionError}
        isEditorOpen={isEditorOpen}
        editorMode={editorMode}
        editor={editor}
        editorBusy={editorBusy}
        testState={testState}
        editorValidation={editorValidation}
        isQuickConnectOpen={isQuickConnectOpen}
        localUploadConflictDialog={localUploadConflictDialog}
        localUploadConflictRenameValue={localUploadConflictRenameValue}
        localUploadConflictError={localUploadConflictError}
        onCloseEditor={closeEditor}
        onTestConnection={() => void onTestConnection()}
        onSaveEditor={() => void onSaveEditor()}
        onSetEditor={setEditor}
        onCloseQuickConnect={closeQuickConnect}
        onQuickConnectLocal={() => void onQuickConnectLocal()}
        onQuickConnectProfile={(profile) => void onQuickConnectProfile(profile)}
        onGoAddServer={() => {
          closeQuickConnect();
          openCreateEditor();
          setContentView('servers');
        }}
        onCloseLocalUploadConflictDialog={closeLocalUploadConflictDialog}
        onSetLocalUploadConflictRenameValue={setLocalUploadConflictRenameValue}
        onClearLocalUploadConflictError={() => {
          if (localUploadConflictError) {
            setLocalUploadConflictError(null);
          }
        }}
        onSubmitLocalUploadManualRename={() => void onSubmitLocalUploadManualRename()}
        onSubmitLocalUploadConflict={(strategy) => void onSubmitLocalUploadConflict(strategy)}
        onCloseLocalActionDialog={closeLocalActionDialog}
        onUpdateLocalActionValue={updateLocalActionValue}
        onSubmitLocalActionDialog={() => void submitLocalActionDialog()}
        onSetLocalContextMenu={setLocalContextMenu}
        onSetLocalActionError={setLocalActionError}
        onSetLocalActionDialog={setLocalActionDialog}
        onLoadLocalDir={loadLocalDir}
        onLocalEnterDir={onLocalEnterDir}
        onLocalCopyToTarget={onLocalCopyToTarget}
        onCloseSftpActionDialog={closeSftpActionDialog}
        onUpdateSftpActionValue={updateSftpActionValue}
        onSubmitSftpActionDialog={() => void submitSftpActionDialog()}
        onSetSftpContextMenu={setSftpContextMenu}
        onSetSftpActionError={setSftpActionError}
        onSetSftpActionDialog={setSftpActionDialog}
        onLoadSftpDir={loadSftpDir}
        onSftpEnterDir={onSftpEnterDir}
        onSftpCopyToTarget={onSftpCopyToTarget}
        formatPermissionMode={formatPermissionMode}
      />
    </main>
  );
}
