import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cancelServerRuntimeProbe, preflightServerRuntimeProbe, probeServerRuntimes } from '../../api/runtime';
import { formatInvokeError } from '../../helpers';
import type { ConnectionProfile, RuntimeLanguage, RuntimeProbeResult } from '../../../types';

const RUNTIME_LANGUAGE_ORDER: RuntimeLanguage[] = ['node', 'java', 'go', 'python'];

function sortProbeResults(results: RuntimeProbeResult[]): RuntimeProbeResult[] {
  const resultMap = new Map<RuntimeLanguage, RuntimeProbeResult>();
  for (const item of results) {
    resultMap.set(item.language, item);
  }

  const normalized: RuntimeProbeResult[] = [];
  for (const language of RUNTIME_LANGUAGE_ORDER) {
    const current = resultMap.get(language);
    if (current) {
      normalized.push(current);
      continue;
    }
    normalized.push({
      language,
      found: false,
      checked_at: 0,
      matches: []
    });
  }
  return normalized;
}

function createProbeId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `runtime-probe-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function isCanceledMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('canceled') || normalized.includes('cancelled') || normalized.includes('取消');
}

export function useRuntimeProbe(profiles: ConnectionProfile[]) {
  const activeProbeIdRef = useRef<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(profiles[0]?.id ?? '');
  const [runtimeProbeBusy, setRuntimeProbeBusy] = useState(false);
  const [runtimeProbeChecking, setRuntimeProbeChecking] = useState(false);
  const [runtimeProbeMessage, setRuntimeProbeMessage] = useState<string | null>(null);
  const [runtimeProbeMessageIsError, setRuntimeProbeMessageIsError] = useState(false);
  const [runtimeProbeResults, setRuntimeProbeResults] = useState<RuntimeProbeResult[]>([]);

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedProfileId('');
      setRuntimeProbeResults([]);
      setRuntimeProbeMessage('暂无服务器配置，请先新增服务器。');
      setRuntimeProbeMessageIsError(false);
      return;
    }

    if (!selectedProfileId || !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0].id);
    }

    if (runtimeProbeMessage === '暂无服务器配置，请先新增服务器。') {
      setRuntimeProbeMessage(null);
    }
  }, [profiles, runtimeProbeMessage, selectedProfileId]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  const onProbeServerRuntimes = useCallback(async () => {
    if (!selectedProfileId) {
      setRuntimeProbeMessage('请选择目标服务器。');
      setRuntimeProbeMessageIsError(true);
      return;
    }

    setRuntimeProbeMessage('正在检查服务器连通性...');
    setRuntimeProbeMessageIsError(false);
    setRuntimeProbeChecking(true);

    try {
      await preflightServerRuntimeProbe({ profile_id: selectedProfileId });
    } catch (error) {
      setRuntimeProbeMessage(`连接检查失败：${formatInvokeError(error)}`);
      setRuntimeProbeMessageIsError(true);
      return;
    } finally {
      setRuntimeProbeChecking(false);
    }

    const probeId = createProbeId();
    activeProbeIdRef.current = probeId;
    setRuntimeProbeBusy(true);
    setRuntimeProbeMessage('正在探测远程运行环境...');
    setRuntimeProbeMessageIsError(false);

    try {
      const results = await probeServerRuntimes({ profile_id: selectedProfileId, probe_id: probeId });
      if (activeProbeIdRef.current !== probeId) {
        return;
      }

      const normalized = sortProbeResults(results);
      setRuntimeProbeResults(normalized);
      const foundCount = normalized.filter((item) => item.found).length;
      setRuntimeProbeMessage(`探测完成：已检测到 ${foundCount}/${normalized.length} 个运行环境。`);
      setRuntimeProbeMessageIsError(false);
    } catch (error) {
      if (activeProbeIdRef.current !== probeId) {
        return;
      }

      const message = formatInvokeError(error);
      if (isCanceledMessage(message)) {
        setRuntimeProbeMessage('已取消探测。');
        setRuntimeProbeMessageIsError(false);
      } else {
        setRuntimeProbeMessage(`探测失败：${message}`);
        setRuntimeProbeMessageIsError(true);
      }
    } finally {
      if (activeProbeIdRef.current === probeId) {
        activeProbeIdRef.current = null;
        setRuntimeProbeBusy(false);
      }
    }
  }, [selectedProfileId]);

  const onCancelRuntimeProbe = useCallback(async () => {
    const probeId = activeProbeIdRef.current;
    if (!probeId) {
      return;
    }

    try {
      await cancelServerRuntimeProbe({ probe_id: probeId });
      setRuntimeProbeMessage('已取消探测。');
      setRuntimeProbeMessageIsError(false);
    } catch (error) {
      setRuntimeProbeMessage(`取消探测失败：${formatInvokeError(error)}`);
      setRuntimeProbeMessageIsError(true);
    } finally {
      activeProbeIdRef.current = null;
      setRuntimeProbeBusy(false);
    }
  }, []);

  const latestCheckedAt = useMemo(() => {
    if (runtimeProbeResults.length === 0) {
      return 0;
    }
    return runtimeProbeResults.reduce((max, current) => Math.max(max, current.checked_at), 0);
  }, [runtimeProbeResults]);

  return {
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    runtimeProbeBusy,
    runtimeProbeChecking,
    runtimeProbeMessage,
    runtimeProbeMessageIsError,
    runtimeProbeResults,
    latestCheckedAt,
    onProbeServerRuntimes,
    onCancelRuntimeProbe
  };
}
