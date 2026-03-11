import type { Dispatch, RefObject, SetStateAction } from 'react';
import { LocalActionDialog } from '../LocalActionDialog';
import { LocalContextMenu } from '../LocalContextMenu';
import { LocalUploadConflictDialog } from '../LocalUploadConflictDialog';
import { QuickConnectModal } from '../QuickConnectModal';
import { ServerEditorModal } from '../ServerEditorModal';
import { SftpActionDialog } from '../SftpActionDialog';
import { SftpContextMenu } from '../SftpContextMenu';
import type {
  ContentView,
  EditorMode,
  LocalActionDialogState,
  LocalContextMenuState,
  LocalUploadConflictDialogState,
  ProfileEditor,
  SftpActionDialogState,
  SftpContextMenuState,
  TestState
} from '../../app/types';
import { defaultPermissionInput } from '../../app/helpers';
import type { ConnectionProfile, LocalFsEntry, SftpEntry, SftpUploadConflictStrategy } from '../../types';

type AppOverlaysProps = {
  contentView: ContentView;
  profiles: ConnectionProfile[];
  connectedSftpProfile: ConnectionProfile | null;
  localPath: string;
  localEntries: LocalFsEntry[];
  localBusy: boolean;
  localContextMenu: LocalContextMenuState | null;
  localContextMenuRef: RefObject<HTMLDivElement>;
  localActionDialog: LocalActionDialogState;
  localActionError: string | null;
  sftpPath: string;
  sftpEntries: SftpEntry[];
  sftpBusy: boolean;
  sftpContextMenu: SftpContextMenuState | null;
  sftpContextMenuRef: RefObject<HTMLDivElement>;
  sftpActionDialog: SftpActionDialogState;
  sftpActionError: string | null;
  isEditorOpen: boolean;
  editorMode: EditorMode;
  editor: ProfileEditor;
  editorBusy: boolean;
  testState: TestState;
  editorValidation: string | null;
  isQuickConnectOpen: boolean;
  localUploadConflictDialog: LocalUploadConflictDialogState;
  localUploadConflictRenameValue: string;
  localUploadConflictError: string | null;
  onCloseEditor: () => void;
  onTestConnection: () => void;
  onSaveEditor: () => void;
  onSetEditor: Dispatch<SetStateAction<ProfileEditor>>;
  onCloseQuickConnect: () => void;
  onQuickConnectLocal: () => void;
  onQuickConnectProfile: (profile: ConnectionProfile) => void;
  onGoAddServer: () => void;
  onCloseLocalUploadConflictDialog: () => void;
  onSetLocalUploadConflictRenameValue: (value: string) => void;
  onClearLocalUploadConflictError: () => void;
  onSubmitLocalUploadManualRename: () => void;
  onSubmitLocalUploadConflict: (strategy: SftpUploadConflictStrategy) => void;
  onCloseLocalActionDialog: () => void;
  onUpdateLocalActionValue: (value: string) => void;
  onSubmitLocalActionDialog: () => void;
  onSetLocalContextMenu: (value: LocalContextMenuState | null) => void;
  onSetLocalActionError: (value: string | null) => void;
  onSetLocalActionDialog: (value: LocalActionDialogState) => void;
  onLoadLocalDir: (targetPath?: string, options?: { silent?: boolean; background?: boolean }) => Promise<void>;
  onLocalEnterDir: (entry: LocalFsEntry) => Promise<void>;
  onLocalCopyToTarget: (entry: LocalFsEntry) => Promise<void>;
  onCloseSftpActionDialog: () => void;
  onUpdateSftpActionValue: (value: string) => void;
  onSubmitSftpActionDialog: () => void;
  onSetSftpContextMenu: (value: SftpContextMenuState | null) => void;
  onSetSftpActionError: (value: string | null) => void;
  onSetSftpActionDialog: (value: SftpActionDialogState) => void;
  onLoadSftpDir: (
    profile: ConnectionProfile,
    targetPath: string,
    options?: { silent?: boolean; background?: boolean }
  ) => Promise<void>;
  onSftpEnterDir: (entry: SftpEntry) => Promise<void>;
  onSftpCopyToTarget: (entry: SftpEntry) => Promise<void>;
  formatPermissionMode: (value?: number) => string;
};

export function AppOverlays({
  contentView,
  profiles,
  connectedSftpProfile,
  localPath,
  localEntries,
  localBusy,
  localContextMenu,
  localContextMenuRef,
  localActionDialog,
  localActionError,
  sftpPath,
  sftpEntries,
  sftpBusy,
  sftpContextMenu,
  sftpContextMenuRef,
  sftpActionDialog,
  sftpActionError,
  isEditorOpen,
  editorMode,
  editor,
  editorBusy,
  testState,
  editorValidation,
  isQuickConnectOpen,
  localUploadConflictDialog,
  localUploadConflictRenameValue,
  localUploadConflictError,
  onCloseEditor,
  onTestConnection,
  onSaveEditor,
  onSetEditor,
  onCloseQuickConnect,
  onQuickConnectLocal,
  onQuickConnectProfile,
  onGoAddServer,
  onCloseLocalUploadConflictDialog,
  onSetLocalUploadConflictRenameValue,
  onClearLocalUploadConflictError,
  onSubmitLocalUploadManualRename,
  onSubmitLocalUploadConflict,
  onCloseLocalActionDialog,
  onUpdateLocalActionValue,
  onSubmitLocalActionDialog,
  onSetLocalContextMenu,
  onSetLocalActionError,
  onSetLocalActionDialog,
  onLoadLocalDir,
  onLocalEnterDir,
  onLocalCopyToTarget,
  onCloseSftpActionDialog,
  onUpdateSftpActionValue,
  onSubmitSftpActionDialog,
  onSetSftpContextMenu,
  onSetSftpActionError,
  onSetSftpActionDialog,
  onLoadSftpDir,
  onSftpEnterDir,
  onSftpCopyToTarget,
  formatPermissionMode
}: AppOverlaysProps) {
  return (
    <>
      <ServerEditorModal
        isOpen={isEditorOpen}
        editorMode={editorMode}
        editor={editor}
        editorBusy={editorBusy}
        testState={testState}
        editorValidation={editorValidation}
        onClose={onCloseEditor}
        onTestConnection={onTestConnection}
        onSave={onSaveEditor}
        setEditor={onSetEditor}
      />
      <QuickConnectModal
        isOpen={isQuickConnectOpen}
        profiles={profiles}
        onClose={onCloseQuickConnect}
        onQuickConnectLocal={onQuickConnectLocal}
        onQuickConnectProfile={onQuickConnectProfile}
        onGoAddServer={onGoAddServer}
      />
      <LocalUploadConflictDialog
        dialog={localUploadConflictDialog}
        busy={localBusy}
        manualName={localUploadConflictRenameValue}
        manualError={localUploadConflictError}
        onClose={onCloseLocalUploadConflictDialog}
        onChangeManualName={(value) => {
          onSetLocalUploadConflictRenameValue(value);
          onClearLocalUploadConflictError();
        }}
        onSubmitManualRename={onSubmitLocalUploadManualRename}
        onSelectStrategy={onSubmitLocalUploadConflict}
      />
      <LocalActionDialog
        dialog={localActionDialog}
        busy={localBusy}
        error={localActionError}
        onClose={onCloseLocalActionDialog}
        onChangeValue={onUpdateLocalActionValue}
        onSubmit={onSubmitLocalActionDialog}
      />
      <LocalContextMenu
        contentView={contentView}
        contextMenu={localContextMenu}
        menuRef={localContextMenuRef}
        hasLocalPath={Boolean(localPath)}
        canCopyToTarget={Boolean(connectedSftpProfile)}
        onClose={() => onSetLocalContextMenu(null)}
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
            onSetLocalContextMenu(null);
            onSetLocalActionError(null);
            onSetLocalActionDialog({ kind: 'rename', entry, value: entry.name });
          }
        }}
        onOpenDelete={(path) => {
          const entry = localEntries.find((item) => item.path === path);
          if (entry) {
            onSetLocalContextMenu(null);
            onSetLocalActionError(null);
            onSetLocalActionDialog({ kind: 'delete', entry });
          }
        }}
        onRefresh={() =>
          void onLoadLocalDir(localPath, {
            silent: true,
            background: true
          })
        }
        onOpenCreateDir={() => {
          onSetLocalContextMenu(null);
          onSetLocalActionError(null);
          onSetLocalActionDialog({ kind: 'create_dir', parentPath: localPath, value: '' });
        }}
      />
      <SftpActionDialog
        dialog={sftpActionDialog}
        busy={sftpBusy}
        error={sftpActionError}
        formatPermissionMode={formatPermissionMode}
        onClose={onCloseSftpActionDialog}
        onChangeValue={onUpdateSftpActionValue}
        onSubmit={onSubmitSftpActionDialog}
      />
      <SftpContextMenu
        contentView={contentView}
        contextMenu={sftpContextMenu}
        menuRef={sftpContextMenuRef}
        hasConnectedProfile={Boolean(connectedSftpProfile)}
        currentPath={sftpPath}
        formatPermissionMode={formatPermissionMode}
        onClose={() => onSetSftpContextMenu(null)}
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
            onSetSftpContextMenu(null);
            onSetSftpActionError(null);
            onSetSftpActionDialog({ kind: 'rename', entry, value: entry.name });
          }
        }}
        onOpenDelete={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            onSetSftpContextMenu(null);
            onSetSftpActionError(null);
            onSetSftpActionDialog({ kind: 'delete', entry });
          }
        }}
        onRefresh={() => {
          if (connectedSftpProfile) {
            void onLoadSftpDir(connectedSftpProfile, sftpPath, {
              silent: true,
              background: true
            });
          }
        }}
        onOpenCreateDir={(parentPath) => {
          onSetSftpContextMenu(null);
          onSetSftpActionError(null);
          onSetSftpActionDialog({ kind: 'create_dir', parentPath, value: '' });
        }}
        onOpenPermissions={(path) => {
          const entry = sftpEntries.find((item) => item.path === path);
          if (entry) {
            onSetSftpContextMenu(null);
            onSetSftpActionError(null);
            onSetSftpActionDialog({
              kind: 'permissions',
              entry,
              value: defaultPermissionInput(entry.permissions, entry.is_dir)
            });
          }
        }}
      />
    </>
  );
}
