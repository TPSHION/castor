import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyRuntimeDeploy,
  cancelRuntimeDeploy,
  listRuntimeDeployVersions,
  planRuntimeDeploy,
  preflightServerRuntimeProbe
} from '../../api/runtime';
import { formatInvokeError } from '../../helpers';
import type {
  RuntimeDeployApplyResult,
  RuntimeDeployLanguage,
  RuntimeDeployLogPayload,
  RuntimeDeployPlanResult,
  RuntimeDeployVersionItem
} from '../../../types';
import { readRuntimeVersionCache, writeRuntimeVersionCache } from './runtimeVersionCache';

function createDeployId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `runtime-deploy-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function isCanceledMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('canceled') || normalized.includes('cancelled') || normalized.includes('取消');
}

type UseEnvironmentDeployOptions = {
  selectedProfileId: string;
  onDeploySuccess?: () => Promise<void> | void;
};

type PlanSnapshot = {
  profileId: string;
  language: RuntimeDeployLanguage;
  version: string;
  setAsDefault: boolean;
};

export function useEnvironmentDeploy({ selectedProfileId, onDeploySuccess }: UseEnvironmentDeployOptions) {
  const activeDeployIdRef = useRef<string | null>(null);
  const activeVersionRequestIdRef = useRef<string | null>(null);
  const [language, setLanguageState] = useState<RuntimeDeployLanguage>('node');
  const [version, setVersion] = useState<string>('');
  const [versions, setVersions] = useState<RuntimeDeployVersionItem[]>([]);
  const [versionsManager, setVersionsManager] = useState<string | null>(null);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(true);
  const [planBusy, setPlanBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [planResult, setPlanResult] = useState<RuntimeDeployPlanResult | null>(null);
  const [planSnapshot, setPlanSnapshot] = useState<PlanSnapshot | null>(null);
  const [applyResult, setApplyResult] = useState<RuntimeDeployApplyResult | null>(null);

  const resetDeployState = useCallback(() => {
    setPlanResult(null);
    setPlanSnapshot(null);
    setApplyResult(null);
    setDeployLogs([]);
    setMessage(null);
    setMessageIsError(false);
  }, []);

  const setLanguage = useCallback(
    (nextLanguage: RuntimeDeployLanguage) => {
      if (nextLanguage === language) {
        return;
      }
      setLanguageState(nextLanguage);
      setVersions([]);
      setVersion('');
      setVersionsManager(null);
      resetDeployState();
    },
    [language, resetDeployState]
  );

  const onLoadVersions = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!selectedProfileId) {
      setVersions([]);
      setVersion('');
      setVersionsManager(null);
      return;
    }

    if (!options?.forceRefresh) {
      const cached = readRuntimeVersionCache(selectedProfileId, language);
      if (cached) {
        setVersions(cached.versions);
        setVersionsManager(cached.manager);
        setVersion((current) =>
          current && cached.versions.some((item) => item.version === current) ? current : (cached.versions[0]?.version ?? '')
        );
        setMessage(`已从缓存加载 ${cached.versions.length} 个可用版本（${cached.manager}）。`);
        setMessageIsError(false);
        return;
      }
    }

    const requestId = createDeployId();
    activeVersionRequestIdRef.current = requestId;
    setVersionsBusy(true);
    setVersions([]);
    setVersion('');
    setVersionsManager(null);
    setMessage(options?.forceRefresh ? '正在刷新版本列表...' : '正在实时加载可用版本列表...');
    setMessageIsError(false);

    try {
      const result = await listRuntimeDeployVersions({
        profile_id: selectedProfileId,
        language,
        limit: 20
      });
      if (activeVersionRequestIdRef.current !== requestId) {
        return;
      }

      setVersions(result.versions);
      setVersionsManager(result.manager);
      setVersion((current) =>
        current && result.versions.some((item) => item.version === current) ? current : (result.versions[0]?.version ?? '')
      );
      writeRuntimeVersionCache(selectedProfileId, result);
      setMessage(`已加载 ${result.versions.length} 个可用版本（${result.manager}）。`);
      setMessageIsError(false);
    } catch (error) {
      if (activeVersionRequestIdRef.current !== requestId) {
        return;
      }
      setMessage(`加载版本列表失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      if (activeVersionRequestIdRef.current === requestId) {
        activeVersionRequestIdRef.current = null;
        setVersionsBusy(false);
      }
    }
  }, [language, selectedProfileId]);

  useEffect(() => {
    void onLoadVersions();
  }, [onLoadVersions]);

  useEffect(() => {
    let mounted = true;
    const unsubscribePromise = listen<RuntimeDeployLogPayload>('runtime-deploy-log', (event) => {
      if (!mounted) {
        return;
      }
      const currentDeployId = activeDeployIdRef.current;
      if (!currentDeployId || event.payload.deploy_id !== currentDeployId) {
        return;
      }
      setDeployLogs((previous) => [...previous, event.payload.line]);
    });

    return () => {
      mounted = false;
      void unsubscribePromise.then((unlisten) => unlisten());
    };
  }, []);

  const onPlanDeploy = useCallback(async () => {
    const normalizedVersion = version.trim();
    if (!selectedProfileId) {
      setMessage('请选择目标服务器。');
      setMessageIsError(true);
      return;
    }
    if (!normalizedVersion) {
      setMessage('请选择版本号。');
      setMessageIsError(true);
      return;
    }

    setPlanBusy(true);
    setMessage('正在生成部署计划...');
    setMessageIsError(false);

    try {
      const result = await planRuntimeDeploy({
        profile_id: selectedProfileId,
        language,
        version: normalizedVersion,
        set_as_default: setAsDefault
      });
      setPlanResult(result);
      setPlanSnapshot({
        profileId: selectedProfileId,
        language,
        version: normalizedVersion,
        setAsDefault
      });
      setMessage(`部署计划已生成：共 ${result.steps.length} 个步骤。`);
      setMessageIsError(false);
    } catch (error) {
      setMessage(`生成部署计划失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      setPlanBusy(false);
    }
  }, [language, selectedProfileId, setAsDefault, version]);

  const onApplyDeploy = useCallback(async () => {
    const normalizedVersion = version.trim();
    if (!selectedProfileId) {
      setMessage('请选择目标服务器。');
      setMessageIsError(true);
      return;
    }
    if (!normalizedVersion) {
      setMessage('请选择版本号。');
      setMessageIsError(true);
      return;
    }
    const hasValidPlan =
      !!planSnapshot &&
      planSnapshot.profileId === selectedProfileId &&
      planSnapshot.language === language &&
      planSnapshot.version === normalizedVersion &&
      planSnapshot.setAsDefault === setAsDefault;
    if (!hasValidPlan) {
      setMessage('请先生成部署计划，再开始部署。');
      setMessageIsError(true);
      return;
    }

    setMessage('正在检查服务器连通性...');
    setMessageIsError(false);
    try {
      await preflightServerRuntimeProbe({ profile_id: selectedProfileId });
    } catch (error) {
      setMessage(`连接检查失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
      return;
    }

    const deployId = createDeployId();
    activeDeployIdRef.current = deployId;
    setApplyBusy(true);
    setApplyResult(null);
    setDeployLogs([]);
    setMessage('正在执行环境部署...');
    setMessageIsError(false);

    try {
      const result = await applyRuntimeDeploy({
        profile_id: selectedProfileId,
        language,
        version: normalizedVersion,
        set_as_default: setAsDefault,
        deploy_id: deployId
      });
      if (activeDeployIdRef.current !== deployId) {
        return;
      }

      setApplyResult(result);
      setDeployLogs(result.logs);
      setMessage(result.success ? '环境部署完成。' : '环境部署失败，请查看部署日志。');
      setMessageIsError(!result.success);

      if (result.success) {
        await onDeploySuccess?.();
      }
    } catch (error) {
      if (activeDeployIdRef.current !== deployId) {
        return;
      }

      const rawMessage = formatInvokeError(error);
      if (isCanceledMessage(rawMessage)) {
        setMessage('已取消部署。');
        setMessageIsError(false);
      } else {
        setMessage(`环境部署失败：${rawMessage}`);
        setMessageIsError(true);
      }
    } finally {
      if (activeDeployIdRef.current === deployId) {
        activeDeployIdRef.current = null;
        setApplyBusy(false);
      }
    }
  }, [language, onDeploySuccess, planSnapshot, selectedProfileId, setAsDefault, version]);

  const onCancelDeploy = useCallback(async () => {
    const deployId = activeDeployIdRef.current;
    if (!deployId) {
      return;
    }

    try {
      await cancelRuntimeDeploy({ deploy_id: deployId });
      setDeployLogs((previous) => [...previous, '已发送取消请求，等待远端任务停止...']);
      setMessage('已取消部署。');
      setMessageIsError(false);
    } catch (error) {
      setMessage(`取消部署失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      activeDeployIdRef.current = null;
      setApplyBusy(false);
    }
  }, []);

  const canApply =
    !!planSnapshot &&
    planSnapshot.profileId === selectedProfileId &&
    planSnapshot.language === language &&
    planSnapshot.version === version.trim() &&
    planSnapshot.setAsDefault === setAsDefault;

  return {
    language,
    setLanguage,
    version,
    setVersion,
    versions,
    versionsManager,
    versionsBusy,
    setAsDefault,
    setSetAsDefault,
    planBusy,
    applyBusy,
    deployLogs,
    message,
    messageIsError,
    planResult,
    planSnapshot,
    canApply,
    applyResult,
    onLoadVersions,
    onPlanDeploy,
    onApplyDeploy,
    onCancelDeploy
  };
}
