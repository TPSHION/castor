import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyServerProxyNode,
  deleteServerProxyConfig,
  getServerProxyRuntimeStatus,
  listServerProxyConfigs,
  syncServerProxySubscription,
  testServerProxyConnectivity
} from '../../api/proxy';
import { formatInvokeError } from '../../helpers';
import type {
  ConnectionProfile,
  ProxyNode,
  ServerProxyApplyResult,
  ServerProxyConfig,
  ServerProxyRuntimeStatusResult
} from '../../../types';

type ProxyApplyLog = {
  timestamp: number;
  configId: string;
  nodeId: string;
  nodeName: string;
  result: ServerProxyApplyResult;
};

function clampMixedPort(value: number) {
  if (!Number.isFinite(value)) {
    return 7890;
  }
  return Math.min(65535, Math.max(1024, Math.round(value)));
}

export function useEnvironmentProxy(profiles: ConnectionProfile[]) {
  const loadRequestIdRef = useRef<string | null>(null);

  const [configs, setConfigs] = useState<ServerProxyConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [listBusy, setListBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [lastApplyLog, setLastApplyLog] = useState<ProxyApplyLog | null>(null);
  const [runtimeStatusBusy, setRuntimeStatusBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<ServerProxyRuntimeStatusResult | null>(null);

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
        setMessage(`已加载 ${result.length} 条代理配置，共 ${result.reduce((sum, item) => sum + item.nodes.length, 0)} 个节点。`);
      }
      setMessageIsError(false);
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setMessage(`加载代理配置失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      if (loadRequestIdRef.current === requestId) {
        loadRequestIdRef.current = null;
        setListBusy(false);
      }
    }
  }, [selectedConfigId]);

  useEffect(() => {
    setMessage('正在加载代理配置...');
    setMessageIsError(false);
    void onLoadConfigs();
  }, [onLoadConfigs]);

  useEffect(() => {
    if (profiles.length > 0) {
      return;
    }
    if (configs.length > 0) {
      setMessage('已解析节点，但当前无可用服务器，无法执行应用。');
      setMessageIsError(false);
    }
  }, [configs.length, profiles.length]);

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
        setMessage(`同步代理订阅失败：${formatInvokeError(error)}`);
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
        setMessage('代理配置已删除。');
        setMessageIsError(false);
        await onLoadConfigs();
      } catch (error) {
        setMessage(`删除代理配置失败：${formatInvokeError(error)}`);
        setMessageIsError(true);
      } finally {
        setActionBusy(false);
      }
    },
    [lastApplyLog?.configId, onLoadConfigs]
  );

  const onTestConnectivity = useCallback(
    async (configId: string, timeoutMs?: number) => {
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
    },
    []
  );

  const onCheckRuntimeStatus = useCallback(async (profileId: string, useSudo = true) => {
    const targetProfileId = profileId.trim();
    if (!targetProfileId) {
      setMessage('请先选择需要查询的服务器。');
      setMessageIsError(true);
      return null;
    }

    setRuntimeStatusBusy(true);
    try {
      const result = await getServerProxyRuntimeStatus({
        profile_id: targetProfileId,
        use_sudo: useSudo
      });
      setRuntimeStatus(result);
      setMessage(result.message);
      setMessageIsError(false);
      return result;
    } catch (error) {
      setRuntimeStatus(null);
      setMessage(`查询远程代理状态失败：${formatInvokeError(error)}`);
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
      localMixedPort: number
    ) => {
      const targetProfileId = profileId.trim();
      if (!targetProfileId) {
        setMessage('请选择需要应用代理的目标服务器。');
        setMessageIsError(true);
        return false;
      }

      setActionBusy(true);
      try {
        const result = await applyServerProxyNode({
          id: config.id,
          node_id: node.id,
          profile_id: targetProfileId,
          use_sudo: useSudo,
          local_mixed_port: clampMixedPort(localMixedPort)
        });
        setConfigs((prev) => prev.map((item) => (item.id === result.config.id ? result.config : item)));
        setLastApplyLog({
          timestamp: Date.now(),
          configId: config.id,
          nodeId: node.id,
          nodeName: node.name,
          result
        });
        setMessage(result.message);
        setMessageIsError(!result.success);
        if (result.success) {
          void onCheckRuntimeStatus(targetProfileId, useSudo);
        }
        return result.success;
      } catch (error) {
        setMessage(`应用代理节点失败：${formatInvokeError(error)}`);
        setMessageIsError(true);
        return false;
      } finally {
        setActionBusy(false);
      }
    },
    [onCheckRuntimeStatus]
  );

  return {
    profiles,
    configs,
    selectedConfig,
    selectedConfigId,
    setSelectedConfigId,
    listBusy,
    actionBusy,
    message,
    messageIsError,
    lastApplyLog,
    runtimeStatusBusy,
    runtimeStatus,
    onLoadConfigs,
    onSyncSubscription,
    onDeleteConfig,
    onTestConnectivity,
    onCheckRuntimeStatus,
    onApplyNode
  };
}
