import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMihomoProxyNode,
  cancelServerProxyApply,
  deleteServerProxyConfig,
  getMihomoRuntimeStatus,
  listServerProxyConfigs,
  syncServerProxySubscription,
  testServerProxyConnectivity
} from '../../api/proxy';
import { formatInvokeError } from '../../helpers';
import type {
  ConnectionProfile,
  MihomoProxyApplyResult,
  MihomoRuntimeStatusResult,
  ProxyApplyLogPayload,
  ProxyApplyMode,
  ProxyNode,
  ServerProxyConfig
} from '../../../types';

type MihomoApplyLog = {
  timestamp: number;
  configId: string;
  nodeId: string;
  nodeName: string;
  result: MihomoProxyApplyResult;
};

function clampMixedPort(value: number) {
  if (!Number.isFinite(value)) {
    return 7890;
  }
  return Math.min(65535, Math.max(1024, Math.round(value)));
}

export function useEnvironmentMihomo(profiles: ConnectionProfile[]) {
  const loadRequestIdRef = useRef<string | null>(null);
  const activeApplyIdRef = useRef<string | null>(null);
  const activeApplyProfileIdRef = useRef<string | null>(null);

  const [configs, setConfigs] = useState<ServerProxyConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [listBusy, setListBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [applyRealtimeLogs, setApplyRealtimeLogs] = useState<string[]>([]);
  const [lastApplyLog, setLastApplyLog] = useState<MihomoApplyLog | null>(null);
  const [runtimeStatusBusy, setRuntimeStatusBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<MihomoRuntimeStatusResult | null>(null);

  const selectedConfig = useMemo(() => {
    if (!selectedConfigId) {
      return configs[0] ?? null;
    }
    return configs.find((item) => item.id === selectedConfigId) ?? configs[0] ?? null;
  }, [configs, selectedConfigId]);

  const onLoadConfigs = useCallback(async () => {
    const requestId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    loadRequestIdRef.current = requestId;
    setListBusy(true);

    try {
      const result = await listServerProxyConfigs({});
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setConfigs(result);
      const nextSelectedConfig = result.find((item) => item.id === selectedConfigId) ?? result[0] ?? null;
      setSelectedConfigId(nextSelectedConfig?.id ?? '');

      if (result.length === 0) {
        setMessage('暂无订阅节点，点击“添加订阅”开始解析。');
      } else {
        const nodeCount = result.reduce((sum, item) => sum + item.nodes.length, 0);
        setMessage(`已加载 ${result.length} 条订阅，共 ${nodeCount} 个节点。`);
      }
      setMessageIsError(false);
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setMessage(`加载订阅配置失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      if (loadRequestIdRef.current === requestId) {
        loadRequestIdRef.current = null;
        setListBusy(false);
      }
    }
  }, [selectedConfigId]);

  useEffect(() => {
    setMessage('正在加载订阅配置...');
    setMessageIsError(false);
    void onLoadConfigs();
  }, [onLoadConfigs]);

  useEffect(() => {
    if (profiles.length > 0) {
      return;
    }
    if (configs.length > 0) {
      setMessage('已解析节点，但当前无可用服务器，无法执行部署。');
      setMessageIsError(false);
    }
  }, [configs.length, profiles.length]);

  useEffect(() => {
    let mounted = true;
    const unsubscribePromise = listen<ProxyApplyLogPayload>('mihomo-apply-log', (event) => {
      if (!mounted) {
        return;
      }
      const currentApplyId = activeApplyIdRef.current;
      if (!currentApplyId || event.payload.apply_id !== currentApplyId) {
        return;
      }
      setApplyRealtimeLogs((previous) => [...previous, event.payload.line].slice(-500));
    });

    return () => {
      mounted = false;
      void unsubscribePromise.then((unlisten) => unlisten());
    };
  }, []);

  const onSyncSubscription = useCallback(
    async (subscriptionUrl: string) => {
      const nextSubscriptionUrl = subscriptionUrl.trim();
      if (!nextSubscriptionUrl) {
        setMessage('请填写订阅链接。');
        setMessageIsError(true);
        return false;
      }

      setActionBusy(true);
      try {
        const config = await syncServerProxySubscription({
          subscription_url: nextSubscriptionUrl
        });
        setSelectedConfigId(config.id);
        setMessage(`订阅同步完成，解析到 ${config.nodes.length} 个节点。`);
        setMessageIsError(false);
        await onLoadConfigs();
        return true;
      } catch (error) {
        setMessage(`同步订阅失败：${formatInvokeError(error)}`);
        setMessageIsError(true);
        return false;
      } finally {
        setActionBusy(false);
      }
    },
    [onLoadConfigs]
  );

  const onDeleteConfig = useCallback(
    async (id: string) => {
      const targetId = id.trim();
      if (!targetId) {
        return;
      }
      setActionBusy(true);
      try {
        await deleteServerProxyConfig({ id: targetId });
        if (lastApplyLog?.configId === targetId) {
          setLastApplyLog(null);
        }
        setMessage('订阅配置已删除。');
        setMessageIsError(false);
        await onLoadConfigs();
      } catch (error) {
        setMessage(`删除订阅配置失败：${formatInvokeError(error)}`);
        setMessageIsError(true);
      } finally {
        setActionBusy(false);
      }
    },
    [lastApplyLog?.configId, onLoadConfigs]
  );

  const onTestConnectivity = useCallback(async (configId: string, timeoutMs?: number) => {
    const targetId = configId.trim();
    if (!targetId) {
      setMessage('请选择需要测试的订阅配置。');
      setMessageIsError(true);
      return false;
    }

    setActionBusy(true);
    try {
      const result = await testServerProxyConnectivity({
        id: targetId,
        timeout_ms: timeoutMs
      });
      setConfigs((prev) => prev.map((item) => (item.id === result.config.id ? result.config : item)));
      setMessage(result.message);
      setMessageIsError(false);
      return true;
    } catch (error) {
      setMessage(`连通性测试失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
      return false;
    } finally {
      setActionBusy(false);
    }
  }, []);

  const onCheckRuntimeStatus = useCallback(async (profileId: string, useSudo = true) => {
    const targetProfileId = profileId.trim();
    if (!targetProfileId) {
      setMessage('请先选择服务器。');
      setMessageIsError(true);
      return null;
    }

    setRuntimeStatusBusy(true);
    try {
      const result = await getMihomoRuntimeStatus({
        profile_id: targetProfileId,
        use_sudo: useSudo
      });
      setRuntimeStatus(result);
      setMessage(result.message);
      setMessageIsError(false);
      return result;
    } catch (error) {
      setRuntimeStatus(null);
      setMessage(`查询 Mihomo 状态失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
      return null;
    } finally {
      setRuntimeStatusBusy(false);
    }
  }, []);

  const onApplyNode = useCallback(
    async (
      config: ServerProxyConfig,
      node: ProxyNode,
      profileId: string,
      useSudo: boolean,
      localMixedPort: number,
      applyMode: ProxyApplyMode
    ) => {
      const targetProfileId = profileId.trim();
      if (!targetProfileId) {
        setMessage('请选择目标服务器。');
        setMessageIsError(true);
        return false;
      }

      const applyId = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `mihomo-apply-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      activeApplyIdRef.current = applyId;
      activeApplyProfileIdRef.current = targetProfileId;
      setActionBusy(true);
      setApplyBusy(true);
      setApplyRealtimeLogs([]);
      try {
        const result = await applyMihomoProxyNode({
          id: config.id,
          node_id: node.id,
          apply_id: applyId,
          profile_id: targetProfileId,
          use_sudo: useSudo,
          local_mixed_port: clampMixedPort(localMixedPort),
          apply_mode: applyMode
        });
        setLastApplyLog({
          timestamp: Date.now(),
          configId: config.id,
          nodeId: node.id,
          nodeName: node.name,
          result
        });
        setMessage(result.message);
        setMessageIsError(!result.success);
        setApplyRealtimeLogs((previous) => {
          if (previous.length > 0) {
            return previous;
          }
          return result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        });
        if (result.success) {
          setConfigs((previous) =>
            previous.map((item) => {
              if (item.id !== config.id) {
                return item;
              }
              return {
                ...item,
                active_node_id: node.id,
                status: 'active',
                local_http_proxy: result.local_http_proxy,
                local_socks_proxy: result.local_socks_proxy,
                updated_at: Math.floor(Date.now() / 1000)
              };
            })
          );
          void onCheckRuntimeStatus(targetProfileId, useSudo);
        }
        return result.success;
      } catch (error) {
        setMessage(`应用 Mihomo 代理节点失败：${formatInvokeError(error)}`);
        setMessageIsError(true);
        return false;
      } finally {
        if (activeApplyIdRef.current === applyId) {
          activeApplyIdRef.current = null;
        }
        if (activeApplyProfileIdRef.current === targetProfileId) {
          activeApplyProfileIdRef.current = null;
        }
        setApplyBusy(false);
        setActionBusy(false);
      }
    },
    [onCheckRuntimeStatus]
  );

  const onCancelApply = useCallback(async () => {
    const applyId = activeApplyIdRef.current;
    if (!applyId) {
      return false;
    }
    const profileId = activeApplyProfileIdRef.current ?? undefined;
    try {
      const result = await cancelServerProxyApply({
        apply_id: applyId,
        profile_id: profileId
      });
      setApplyRealtimeLogs((previous) => [
        ...previous,
        `[cancel] ${result.message}`,
        ...(result.stdout
          ? result.stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
          : [])
      ]);
      setMessage(result.message);
      setMessageIsError(!result.success);
      return result.success;
    } catch (error) {
      setMessage(`取消 Mihomo 部署失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
      return false;
    }
  }, []);

  return {
    profiles,
    configs,
    selectedConfig,
    selectedConfigId,
    setSelectedConfigId,
    listBusy,
    actionBusy,
    applyBusy,
    message,
    messageIsError,
    applyRealtimeLogs,
    lastApplyLog,
    runtimeStatusBusy,
    runtimeStatus,
    onLoadConfigs,
    onSyncSubscription,
    onDeleteConfig,
    onTestConnectivity,
    onCheckRuntimeStatus,
    onApplyNode,
    onCancelApply
  };
}
