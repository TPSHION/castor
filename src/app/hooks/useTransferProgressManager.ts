import { useCallback, useEffect, useRef, useState } from 'react';
import type { SftpTransferProgressPayload } from '../../types';

type UseTransferProgressManagerOptions = {
  minVisibleMs: number;
};

function upsertTransferProgress(
  list: SftpTransferProgressPayload[],
  payload: SftpTransferProgressPayload
): SftpTransferProgressPayload[] {
  const index = list.findIndex((item) => item.transfer_id === payload.transfer_id);
  if (index === -1) {
    return [payload, ...list];
  }
  const next = [...list];
  next[index] = payload;
  return next;
}

function upsertCompletedTransferProgress(
  list: SftpTransferProgressPayload[],
  payload: SftpTransferProgressPayload
): SftpTransferProgressPayload[] {
  const filtered = list.filter((item) => item.transfer_id !== payload.transfer_id);
  return [payload, ...filtered].slice(0, 100);
}

function withTransferMetrics(
  payload: SftpTransferProgressPayload,
  startedAt: number | null
): SftpTransferProgressPayload {
  if (payload.status === 'done') {
    return { ...payload, eta_seconds: 0, speed_bps: null };
  }

  if (payload.status !== 'running' || startedAt === null || payload.transferred_bytes <= 0) {
    return { ...payload, eta_seconds: null, speed_bps: null };
  }

  const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
  const speedBps = payload.transferred_bytes / elapsedSeconds;
  if (!Number.isFinite(speedBps) || speedBps <= 0) {
    return { ...payload, eta_seconds: null, speed_bps: null };
  }

  if (payload.total_bytes > 0 && payload.total_bytes > payload.transferred_bytes) {
    const remainingBytes = payload.total_bytes - payload.transferred_bytes;
    return {
      ...payload,
      eta_seconds: Math.ceil(remainingBytes / speedBps),
      speed_bps: speedBps
    };
  }

  return { ...payload, eta_seconds: null, speed_bps: speedBps };
}

export function useTransferProgressManager({ minVisibleMs }: UseTransferProgressManagerOptions) {
  const [progresses, setProgresses] = useState<SftpTransferProgressPayload[]>([]);
  const [completed, setCompleted] = useState<SftpTransferProgressPayload[]>([]);

  const progressesRef = useRef<SftpTransferProgressPayload[]>([]);
  const completedRef = useRef<SftpTransferProgressPayload[]>([]);
  const startedAtRef = useRef<Record<string, number>>({});
  const clearTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dismissedCompletedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    progressesRef.current = progresses;
  }, [progresses]);

  useEffect(() => {
    completedRef.current = completed;
  }, [completed]);

  const clearTimer = useCallback((transferId?: string) => {
    if (transferId) {
      const timer = clearTimersRef.current[transferId];
      if (timer) {
        clearTimeout(timer);
        delete clearTimersRef.current[transferId];
      }
      return;
    }
    Object.values(clearTimersRef.current).forEach((timer) => clearTimeout(timer));
    clearTimersRef.current = {};
  }, []);

  const markStarted = useCallback(
    (transferId: string) => {
      dismissedCompletedIdsRef.current.delete(transferId);
      clearTimer(transferId);
      startedAtRef.current[transferId] = Date.now();
    },
    [clearTimer]
  );

  const applyProgress = useCallback(
    (payload: SftpTransferProgressPayload) => {
      const transferId = payload.transfer_id;

      if (payload.status === 'running') {
        dismissedCompletedIdsRef.current.delete(transferId);
        clearTimer(transferId);
        if (!startedAtRef.current[transferId]) {
          startedAtRef.current[transferId] = Date.now();
        }
        const nextPayload = withTransferMetrics(payload, startedAtRef.current[transferId]);
        setProgresses((previous) => upsertTransferProgress(previous, nextPayload));
        setCompleted((previous) => previous.filter((item) => item.transfer_id !== transferId));
        return;
      }

      if (dismissedCompletedIdsRef.current.has(transferId)) {
        setProgresses((previous) => previous.filter((item) => item.transfer_id !== transferId));
        return;
      }

      const startedAt = startedAtRef.current[transferId] ?? Date.now();
      const nextPayload = withTransferMetrics(payload, startedAt);
      setProgresses((previous) => upsertTransferProgress(previous, nextPayload));
      setCompleted((previous) => upsertCompletedTransferProgress(previous, nextPayload));

      const elapsed = Date.now() - startedAt;
      const delay = Math.max(0, minVisibleMs - elapsed);
      clearTimer(transferId);
      clearTimersRef.current[transferId] = setTimeout(() => {
        setProgresses((previous) => previous.filter((item) => item.transfer_id !== transferId));
        delete startedAtRef.current[transferId];
        delete clearTimersRef.current[transferId];
      }, delay);
    },
    [clearTimer, minVisibleMs]
  );

  const clearCompleted = useCallback(() => {
    const completedIds = completedRef.current.map((task) => task.transfer_id);
    completedIds.forEach((id) => {
      dismissedCompletedIdsRef.current.add(id);
      clearTimer(id);
      delete startedAtRef.current[id];
    });
    if (completedIds.length > 0) {
      setProgresses((previous) => previous.filter((item) => !completedIds.includes(item.transfer_id)));
    }
    setCompleted([]);
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    startedAtRef.current = {};
    dismissedCompletedIdsRef.current = new Set();
    setProgresses([]);
    setCompleted([]);
  }, [clearTimer]);

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer]
  );

  return {
    progresses,
    completed,
    markStarted,
    applyProgress,
    clearCompleted,
    reset
  };
}
