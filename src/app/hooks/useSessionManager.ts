import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConnectionProfile, OutputPayload, SessionSummary } from '../../types';
import type { SessionTab } from '../types';
import { buildAuthFromProfile, createClientTabId, formatInvokeError } from '../helpers';

type UseSessionManagerOptions = {
  profiles: ConnectionProfile[];
  onShowWorkspace: () => void;
  onShowServers: () => void;
  onProfileMessage?: (message: string) => void;
};

export function useSessionManager({
  profiles,
  onShowWorkspace,
  onShowServers,
  onProfileMessage
}: UseSessionManagerOptions) {
  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activeTab = useMemo(
    () => sessionTabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, sessionTabs]
  );

  const connectedCount = useMemo(
    () => sessionTabs.filter((item) => item.status === 'connected').length,
    [sessionTabs]
  );

  useEffect(() => {
    let mounted = true;

    const unsubscribePromise = listen<OutputPayload>('ssh-output', (event) => {
      if (!mounted || event.payload.stream !== 'status') {
        return;
      }

      setSessionTabs((previous) =>
        previous.map((tab) => {
          if (!tab.sessionId || tab.sessionId !== event.payload.session_id) {
            return tab;
          }

          if (
            event.payload.data.includes('disconnected') ||
            event.payload.data.includes('remote session closed')
          ) {
            return {
              ...tab,
              status: 'closed',
              statusMessage: '连接已关闭'
            };
          }

          if (event.payload.data.includes('connected to')) {
            return {
              ...tab,
              statusMessage: '连接成功'
            };
          }

          return tab;
        })
      );
    });

    return () => {
      mounted = false;
      void unsubscribePromise.then((unlisten) => unlisten());
    };
  }, []);

  const connectProfile = useCallback(
    async (profile: ConnectionProfile) => {
      const auth = buildAuthFromProfile(profile);
      if (!auth) {
        onProfileMessage?.(`服务器 ${profile.name} 缺少可用凭据，请先编辑并保存。`);
        return;
      }

      const tabId = createClientTabId();
      const newTab: SessionTab = {
        id: tabId,
        kind: 'ssh',
        profileId: profile.id,
        name: profile.name,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        status: 'connecting',
        statusMessage: '正在建立 SSH 连接...'
      };

      setSessionTabs((previous) => [...previous, newTab]);
      setActiveTabId(tabId);
      onShowWorkspace();

      const request = {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        auth
      };

      try {
        const session = await invoke<SessionSummary>('connect_ssh', { request });
        setSessionTabs((previous) =>
          previous.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  sessionId: session.session_id,
                  status: 'connected',
                  statusMessage: '连接成功'
                }
              : tab
          )
        );
      } catch {
        setSessionTabs((previous) =>
          previous.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  status: 'error',
                  statusMessage: '连接失败'
                }
              : tab
          )
        );
      }
    },
    [onProfileMessage, onShowWorkspace]
  );

  const connectLocalTerminal = useCallback(async () => {
    const tabId = createClientTabId();
    const newTab: SessionTab = {
      id: tabId,
      kind: 'local',
      name: '本地终端',
      host: 'localhost',
      port: 0,
      username: 'local',
      status: 'connecting',
      statusMessage: '正在启动本地终端...'
    };

    setSessionTabs((previous) => [...previous, newTab]);
    setActiveTabId(tabId);
    onShowWorkspace();

    const request = {};
    try {
      const session = await invoke<SessionSummary>('connect_local_terminal', { request });
      setSessionTabs((previous) =>
        previous.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                sessionId: session.session_id,
                status: 'connected',
                statusMessage: '本地终端已启动',
                host: session.host,
                username: session.username
              }
            : tab
        )
      );
    } catch (invokeError) {
      setSessionTabs((previous) =>
        previous.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                status: 'error',
                statusMessage: formatInvokeError(invokeError)
              }
            : tab
        )
      );
    }
  }, [onShowWorkspace]);

  const closeTab = useCallback(
    async (tabId: string) => {
      const target = sessionTabs.find((tab) => tab.id === tabId);
      if (!target) {
        return;
      }

      if (target.sessionId) {
        try {
          await invoke('disconnect_ssh', {
            request: {
              session_id: target.sessionId
            }
          });
        } catch {
          // Ignore close errors.
        }
      }

      const nextTabs = sessionTabs.filter((tab) => tab.id !== tabId);
      setSessionTabs(nextTabs);

      if (nextTabs.length === 0) {
        setActiveTabId(null);
        onShowServers();
        return;
      }

      if (activeTabId === tabId) {
        setActiveTabId(nextTabs[nextTabs.length - 1].id);
      }
    },
    [activeTabId, onShowServers, sessionTabs]
  );

  const disconnectActiveTab = useCallback(async () => {
    if (!activeTab) {
      return;
    }
    await closeTab(activeTab.id);
  }, [activeTab, closeTab]);

  const retryActiveTab = useCallback(async () => {
    if (!activeTab) {
      return;
    }

    if (activeTab.kind === 'local') {
      await closeTab(activeTab.id);
      await connectLocalTerminal();
      return;
    }

    const profile = profiles.find((item) => item.id === activeTab.profileId);
    if (!profile) {
      return;
    }

    await closeTab(activeTab.id);
    await connectProfile(profile);
  }, [activeTab, closeTab, connectLocalTerminal, connectProfile, profiles]);

  const openTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      onShowWorkspace();
    },
    [onShowWorkspace]
  );

  return {
    sessionTabs,
    activeTabId,
    activeTab,
    connectedCount,
    connectProfile,
    connectLocalTerminal,
    closeTab,
    disconnectActiveTab,
    retryActiveTab,
    openTab
  };
}
