import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSystemdDeployServiceLogs } from '../../api/profiles';
import { formatInvokeError } from '../../helpers';
import { SYSTEMD_LOG_FETCH_LINES, SYSTEMD_LOG_FLUSH_INTERVAL_MS, SYSTEMD_LOG_MAX_LINES } from '../../../components/systemd/constants';
import { buildHighlightedLogSegments } from '../../../components/systemd/helpers';
import type { SystemdDeployService } from '../../../types';

type UseSystemdLogsParams = {
  systemdMode: 'list' | 'detail' | 'create' | 'edit';
  selectedSystemdDetailService: SystemdDeployService | null;
  setSystemdMessage: (message: string | null) => void;
  setSystemdMessageIsError: (isError: boolean) => void;
};

export function useSystemdLogs({
  systemdMode,
  selectedSystemdDetailService,
  setSystemdMessage,
  setSystemdMessageIsError
}: UseSystemdLogsParams) {
  const [systemdDetailLogsBusy, setSystemdDetailLogsBusy] = useState(false);
  const [systemdDetailLogsRealtime, setSystemdDetailLogsRealtime] = useState(false);
  const [systemdDetailLogs, setSystemdDetailLogs] = useState<string[]>([]);
  const [systemdDetailLogsCursor, setSystemdDetailLogsCursor] = useState<string | null>(null);
  const [systemdLogFilterKeywordDraft, setSystemdLogFilterKeywordDraft] = useState('');
  const [systemdLogFilterCaseSensitiveDraft, setSystemdLogFilterCaseSensitiveDraft] = useState(false);
  const [systemdLogFilterKeywordApplied, setSystemdLogFilterKeywordApplied] = useState('');
  const [systemdLogFilterCaseSensitiveApplied, setSystemdLogFilterCaseSensitiveApplied] = useState(false);
  const [systemdLogFullscreen, setSystemdLogFullscreen] = useState(false);

  const systemdDetailLogsCursorRef = useRef<string | null>(null);
  const systemdDetailLogsRealtimeRef = useRef(false);
  const pendingSystemdLogLinesRef = useRef<string[]>([]);
  const systemdLogFlushTimerRef = useRef<number | null>(null);
  const systemdLogPanelRef = useRef<HTMLPreElement | null>(null);
  const systemdLogFullscreenRef = useRef<HTMLPreElement | null>(null);

  const canReadSystemdLogs = Boolean(
    selectedSystemdDetailService && selectedSystemdDetailService.log_output_mode !== 'none'
  );

  const isSystemdLogFilterDirty = useMemo(() => {
    return (
      systemdLogFilterKeywordDraft.trim() !== systemdLogFilterKeywordApplied.trim() ||
      systemdLogFilterCaseSensitiveDraft !== systemdLogFilterCaseSensitiveApplied
    );
  }, [
    systemdLogFilterCaseSensitiveApplied,
    systemdLogFilterCaseSensitiveDraft,
    systemdLogFilterKeywordApplied,
    systemdLogFilterKeywordDraft
  ]);

  const hasAppliedSystemdLogFilter = useMemo(
    () => Boolean(systemdLogFilterKeywordApplied.trim()),
    [systemdLogFilterKeywordApplied]
  );

  const filteredSystemdDetailLogs = useMemo(() => {
    const keyword = systemdLogFilterKeywordApplied.trim();
    if (!keyword) {
      return systemdDetailLogs;
    }
    if (systemdLogFilterCaseSensitiveApplied) {
      return systemdDetailLogs.filter((line) => line.includes(keyword));
    }
    const needle = keyword.toLowerCase();
    return systemdDetailLogs.filter((line) => line.toLowerCase().includes(needle));
  }, [systemdDetailLogs, systemdLogFilterCaseSensitiveApplied, systemdLogFilterKeywordApplied]);

  const highlightedSystemdLogNodes = useMemo(() => {
    const keyword = systemdLogFilterKeywordApplied.trim();
    return filteredSystemdDetailLogs.map((line, index) => (
      <Fragment key={`systemd-log-line-${index}`}>
        {buildHighlightedLogSegments(line, keyword, systemdLogFilterCaseSensitiveApplied)}
        {index < filteredSystemdDetailLogs.length - 1 ? '\n' : null}
      </Fragment>
    ));
  }, [filteredSystemdDetailLogs, systemdLogFilterCaseSensitiveApplied, systemdLogFilterKeywordApplied]);

  const appendSystemdLogs = useCallback((lines: string[]) => {
    setSystemdDetailLogs((previous) => {
      const merged = [...previous, ...lines];
      if (merged.length <= SYSTEMD_LOG_MAX_LINES) {
        return merged;
      }
      return merged.slice(merged.length - SYSTEMD_LOG_MAX_LINES);
    });
  }, []);

  const flushPendingSystemdLogs = useCallback(() => {
    const queued = pendingSystemdLogLinesRef.current;
    if (queued.length === 0) {
      return;
    }
    pendingSystemdLogLinesRef.current = [];
    appendSystemdLogs(queued);
  }, [appendSystemdLogs]);

  const scheduleSystemdLogFlush = useCallback(() => {
    if (systemdLogFlushTimerRef.current !== null) {
      return;
    }
    systemdLogFlushTimerRef.current = window.setTimeout(() => {
      systemdLogFlushTimerRef.current = null;
      flushPendingSystemdLogs();
    }, SYSTEMD_LOG_FLUSH_INTERVAL_MS);
  }, [flushPendingSystemdLogs]);

  const flushSystemdLogBufferNow = useCallback(() => {
    if (systemdLogFlushTimerRef.current !== null) {
      window.clearTimeout(systemdLogFlushTimerRef.current);
      systemdLogFlushTimerRef.current = null;
    }
    flushPendingSystemdLogs();
  }, [flushPendingSystemdLogs]);

  const resetSystemdLogBuffer = useCallback(() => {
    pendingSystemdLogLinesRef.current = [];
    if (systemdLogFlushTimerRef.current !== null) {
      window.clearTimeout(systemdLogFlushTimerRef.current);
      systemdLogFlushTimerRef.current = null;
    }
  }, []);

  const loadSystemdDetailLogs = useCallback(
    async (serviceId: string, incremental: boolean, silent = false) => {
      if (!silent) {
        setSystemdDetailLogsBusy(true);
      }
      try {
        const result = await getSystemdDeployServiceLogs({
          id: serviceId,
          lines: SYSTEMD_LOG_FETCH_LINES,
          cursor: incremental ? systemdDetailLogsCursorRef.current ?? undefined : undefined
        });
        setSystemdDetailLogsCursor(result.cursor ?? null);
        if (incremental) {
          if (result.lines.length > 0) {
            if (silent && systemdDetailLogsRealtimeRef.current) {
              pendingSystemdLogLinesRef.current.push(...result.lines);
              scheduleSystemdLogFlush();
            } else {
              appendSystemdLogs(result.lines);
            }
          }
        } else {
          resetSystemdLogBuffer();
          const next =
            result.lines.length <= SYSTEMD_LOG_MAX_LINES
              ? result.lines
              : result.lines.slice(result.lines.length - SYSTEMD_LOG_MAX_LINES);
          setSystemdDetailLogs(next);
        }
      } catch (invokeError) {
        setSystemdMessage(`读取服务日志失败：${formatInvokeError(invokeError)}`);
        setSystemdMessageIsError(true);
      } finally {
        if (!silent) {
          setSystemdDetailLogsBusy(false);
        }
      }
    },
    [appendSystemdLogs, resetSystemdLogBuffer, scheduleSystemdLogFlush, setSystemdMessage, setSystemdMessageIsError]
  );

  const resetSystemdLogStateForDetail = useCallback(() => {
    resetSystemdLogBuffer();
    setSystemdDetailLogs([]);
    setSystemdDetailLogsCursor(null);
    setSystemdDetailLogsRealtime(false);
    setSystemdLogFilterKeywordDraft('');
    setSystemdLogFilterCaseSensitiveDraft(false);
    setSystemdLogFilterKeywordApplied('');
    setSystemdLogFilterCaseSensitiveApplied(false);
    setSystemdLogFullscreen(false);
  }, [resetSystemdLogBuffer]);

  const resetSystemdLogStateForList = useCallback(() => {
    resetSystemdLogStateForDetail();
    setSystemdDetailLogsBusy(false);
  }, [resetSystemdLogStateForDetail]);

  const onToggleSystemdRealtimeLogs = useCallback(() => {
    if (!selectedSystemdDetailService || !canReadSystemdLogs) {
      return;
    }
    if (systemdDetailLogsRealtime) {
      flushSystemdLogBufferNow();
      setSystemdDetailLogsRealtime(false);
      return;
    }
    setSystemdDetailLogsRealtime(true);
    const shouldLoadSnapshot = systemdDetailLogs.length === 0 && !systemdDetailLogsCursorRef.current;
    void loadSystemdDetailLogs(selectedSystemdDetailService.id, !shouldLoadSnapshot, true);
  }, [
    canReadSystemdLogs,
    flushSystemdLogBufferNow,
    loadSystemdDetailLogs,
    selectedSystemdDetailService,
    systemdDetailLogs.length,
    systemdDetailLogsRealtime
  ]);

  const applySystemdLogFilter = useCallback(() => {
    setSystemdLogFilterKeywordApplied(systemdLogFilterKeywordDraft);
    setSystemdLogFilterCaseSensitiveApplied(systemdLogFilterCaseSensitiveDraft);
  }, [systemdLogFilterCaseSensitiveDraft, systemdLogFilterKeywordDraft]);

  const clearSystemdLogFilter = useCallback(() => {
    setSystemdLogFilterKeywordDraft('');
    setSystemdLogFilterCaseSensitiveDraft(false);
    setSystemdLogFilterKeywordApplied('');
    setSystemdLogFilterCaseSensitiveApplied(false);
  }, []);

  const clearLoadedSystemdLogs = useCallback(() => {
    resetSystemdLogBuffer();
    setSystemdDetailLogs([]);
  }, [resetSystemdLogBuffer]);

  useEffect(() => {
    systemdDetailLogsCursorRef.current = systemdDetailLogsCursor;
  }, [systemdDetailLogsCursor]);

  useEffect(() => {
    systemdDetailLogsRealtimeRef.current = systemdDetailLogsRealtime;
  }, [systemdDetailLogsRealtime]);

  useEffect(() => {
    if (!systemdDetailLogsRealtime) {
      return;
    }
    const timer = window.requestAnimationFrame(() => {
      if (systemdLogPanelRef.current) {
        systemdLogPanelRef.current.scrollTop = systemdLogPanelRef.current.scrollHeight;
      }
      if (systemdLogFullscreenRef.current) {
        systemdLogFullscreenRef.current.scrollTop = systemdLogFullscreenRef.current.scrollHeight;
      }
    });
    return () => {
      window.cancelAnimationFrame(timer);
    };
  }, [systemdDetailLogs, systemdDetailLogsRealtime, systemdLogFullscreen]);

  useEffect(() => {
    if (!systemdLogFullscreen) {
      return;
    }
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSystemdLogFullscreen(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('keydown', onEsc);
    };
  }, [systemdLogFullscreen]);

  useEffect(() => {
    return () => {
      if (systemdLogFlushTimerRef.current !== null) {
        window.clearTimeout(systemdLogFlushTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (systemdMode !== 'detail' || !selectedSystemdDetailService || !systemdDetailLogsRealtime) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void loadSystemdDetailLogs(selectedSystemdDetailService.id, true, true);
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadSystemdDetailLogs, selectedSystemdDetailService, systemdDetailLogsRealtime, systemdMode]);

  return {
    canReadSystemdLogs,
    systemdDetailLogsBusy,
    systemdDetailLogsRealtime,
    systemdLogFilterKeywordDraft,
    systemdLogFilterCaseSensitiveDraft,
    systemdLogFullscreen,
    isSystemdLogFilterDirty,
    hasAppliedSystemdLogFilter,
    filteredSystemdDetailLogs,
    highlightedSystemdLogNodes,
    systemdLogPanelRef,
    systemdLogFullscreenRef,
    loadSystemdDetailLogs,
    resetSystemdLogStateForDetail,
    resetSystemdLogStateForList,
    onToggleSystemdRealtimeLogs,
    applySystemdLogFilter,
    clearSystemdLogFilter,
    clearLoadedSystemdLogs,
    setSystemdLogFullscreen,
    setSystemdLogFilterKeywordDraft,
    setSystemdLogFilterCaseSensitiveDraft
  };
}
