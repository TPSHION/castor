import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ConnectRequest,
  ConnectionProfile,
  DeleteConnectionProfileRequest,
  UpsertConnectionProfileRequest
} from '../../types';
import type { EditorMode, ProfileEditor, TestState } from '../types';
import { buildAuthFromEditor, createEmptyEditor, formatInvokeError, validateEditor } from '../helpers';

export function useProfilesManager() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [profilesBusy, setProfilesBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('create');
  const [editor, setEditor] = useState<ProfileEditor>(createEmptyEditor());
  const [editorBusy, setEditorBusy] = useState(false);
  const [testState, setTestState] = useState<TestState>({ phase: 'idle', message: '' });
  const [isQuickConnectOpen, setIsQuickConnectOpen] = useState(false);

  const editorValidation = useMemo(() => validateEditor(editor), [editor]);

  const refreshProfiles = useCallback(async () => {
    setProfilesBusy(true);
    setProfileMessage(null);

    try {
      const nextProfiles = await invoke<ConnectionProfile[]>('list_connection_profiles');
      setProfiles(nextProfiles);
    } catch (invokeError) {
      setProfileMessage(formatInvokeError(invokeError));
    } finally {
      setProfilesBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  const openCreateEditor = useCallback(() => {
    setEditorMode('create');
    setEditor(createEmptyEditor());
    setTestState({ phase: 'idle', message: '' });
    setIsEditorOpen(true);
  }, []);

  const openEditEditor = useCallback((profile: ConnectionProfile) => {
    setEditorMode('edit');
    setEditor({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authKind: profile.auth_kind,
      password: profile.password ?? '',
      privateKey: profile.private_key ?? '',
      passphrase: profile.passphrase ?? ''
    });
    setTestState({ phase: 'idle', message: '' });
    setIsEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    if (editorBusy) {
      return;
    }
    setIsEditorOpen(false);
  }, [editorBusy]);

  const openQuickConnect = useCallback(() => {
    setIsQuickConnectOpen(true);
  }, []);

  const closeQuickConnect = useCallback(() => {
    setIsQuickConnectOpen(false);
  }, []);

  const onSaveEditor = useCallback(async () => {
    if (editorValidation) {
      setTestState({ phase: 'error', message: editorValidation });
      return;
    }

    setEditorBusy(true);

    const request: UpsertConnectionProfileRequest = {
      id: editor.id,
      name: editor.name.trim(),
      host: editor.host.trim(),
      port: editor.port,
      username: editor.username.trim(),
      auth_kind: editor.authKind,
      password: editor.authKind === 'password' ? editor.password : undefined,
      private_key: editor.authKind === 'private_key' ? editor.privateKey : undefined,
      passphrase: editor.authKind === 'private_key' && editor.passphrase ? editor.passphrase : undefined
    };

    try {
      const saved = await invoke<ConnectionProfile>('upsert_connection_profile', { request });
      setProfileMessage(`已保存：${saved.name}`);
      setIsEditorOpen(false);
      await refreshProfiles();
    } catch (invokeError) {
      setTestState({ phase: 'error', message: formatInvokeError(invokeError) });
    } finally {
      setEditorBusy(false);
    }
  }, [editor, editorValidation, refreshProfiles]);

  const onTestConnection = useCallback(async () => {
    if (editorValidation) {
      setTestState({ phase: 'error', message: editorValidation });
      return;
    }

    const auth = buildAuthFromEditor(editor);
    const request: ConnectRequest = {
      host: editor.host.trim(),
      port: editor.port,
      username: editor.username.trim(),
      auth
    };

    setTestState({ phase: 'testing', message: '正在测试连接...' });

    try {
      await invoke<string>('test_ssh_connection', { request });
      setTestState({ phase: 'success', message: '连接测试成功' });
    } catch (invokeError) {
      setTestState({ phase: 'error', message: formatInvokeError(invokeError) });
    }
  }, [editor, editorValidation]);

  const onDeleteProfile = useCallback(
    async (profile: ConnectionProfile) => {
      setProfilesBusy(true);
      setProfileMessage(null);

      const request: DeleteConnectionProfileRequest = { id: profile.id };
      try {
        await invoke('delete_connection_profile', { request });
        setProfileMessage(`已删除：${profile.name}`);
        await refreshProfiles();
      } catch (invokeError) {
        setProfileMessage(formatInvokeError(invokeError));
      } finally {
        setProfilesBusy(false);
      }
    },
    [refreshProfiles]
  );

  return {
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
  };
}
