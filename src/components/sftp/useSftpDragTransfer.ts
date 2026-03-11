import { listen, TauriEvent } from '@tauri-apps/api/event';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import type { ConnectionProfile, LocalFsEntry, SftpEntry } from '../../types';

type DragPayload = {
  source: 'local' | 'remote';
  path: string;
  name: string;
};

type UseSftpDragTransferOptions = {
  isActive: boolean;
  connectedSftpProfile: ConnectionProfile | null;
  localEntries: LocalFsEntry[];
  sftpEntries: SftpEntry[];
  onUploadSystemPathsToRemote: (paths: string[]) => void;
  onUploadLocalEntryToRemote: (entry: LocalFsEntry) => void;
  onDownloadRemoteEntryToLocal: (entry: SftpEntry) => void;
};

function hasDraggedFiles(event: ReactDragEvent<HTMLDivElement>) {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function extractDroppedPaths(event: ReactDragEvent<HTMLDivElement>): string[] {
  const files = Array.from(event.dataTransfer.files ?? []);
  return files
    .map((file) => (file as File & { path?: string }).path ?? '')
    .filter((value) => value.length > 0);
}

export function useSftpDragTransfer({
  isActive,
  connectedSftpProfile,
  localEntries,
  sftpEntries,
  onUploadSystemPathsToRemote,
  onUploadLocalEntryToRemote,
  onDownloadRemoteEntryToLocal
}: UseSftpDragTransferOptions) {
  const [isLocalDropActive, setLocalDropActive] = useState(false);
  const [isRemoteDropActive, setRemoteDropActive] = useState(false);
  const [isSystemRemoteDropActive, setSystemRemoteDropActive] = useState(false);
  const [isDragInteractionActive, setDragInteractionActive] = useState(false);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);

  const systemRemoteDropActiveRef = useRef(false);
  const uploadSystemPathsToRemoteRef = useRef(onUploadSystemPathsToRemote);
  const dragStartRef = useRef<{
    source: 'local' | 'remote';
    path: string;
    name: string;
    startX: number;
    startY: number;
  } | null>(null);

  const localDropZoneRef = useRef<HTMLDivElement>(null);
  const remoteDropZoneRef = useRef<HTMLDivElement>(null);

  const isPointInElement = useCallback((element: HTMLDivElement | null, x: number, y: number) => {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, []);

  const setSystemRemoteDropState = useCallback((active: boolean) => {
    systemRemoteDropActiveRef.current = active;
    setSystemRemoteDropActive(active);
  }, []);

  const isPointInRemoteDropZone = useCallback(
    (x: number, y: number) => {
      const scale = window.devicePixelRatio || 1;
      return (
        isPointInElement(remoteDropZoneRef.current, x, y) ||
        isPointInElement(remoteDropZoneRef.current, x / scale, y / scale) ||
        isPointInElement(remoteDropZoneRef.current, x * scale, y * scale)
      );
    },
    [isPointInElement]
  );

  const uploadSystemPaths = useCallback((paths: string[]) => {
    const validPaths = Array.from(
      new Set(
        paths
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );
    if (validPaths.length === 0) {
      return;
    }
    uploadSystemPathsToRemoteRef.current(validPaths);
  }, []);

  const updateDropState = useCallback(
    (source: 'local' | 'remote', x: number, y: number) => {
      if (source === 'local') {
        setLocalDropActive(false);
        setRemoteDropActive(isPointInElement(remoteDropZoneRef.current, x, y));
        return;
      }
      setRemoteDropActive(false);
      setLocalDropActive(isPointInElement(localDropZoneRef.current, x, y));
    },
    [isPointInElement]
  );

  const clearDragState = useCallback(() => {
    dragStartRef.current = null;
    setDragInteractionActive(false);
    setDragPayload(null);
    setDragPointer(null);
    setLocalDropActive(false);
    setRemoteDropActive(false);
  }, []);

  const startDragCandidate = useCallback((event: ReactMouseEvent, payload: DragPayload) => {
    if (event.button !== 0) {
      return;
    }
    dragStartRef.current = {
      ...payload,
      startX: event.clientX,
      startY: event.clientY
    };
    setDragInteractionActive(true);
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragPayload) {
        const candidate = dragStartRef.current;
        if (!candidate) {
          return;
        }
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 6) {
          return;
        }
        const nextPayload = {
          source: candidate.source,
          path: candidate.path,
          name: candidate.name
        };
        setDragPayload(nextPayload);
        setDragPointer({ x: event.clientX, y: event.clientY });
        updateDropState(nextPayload.source, event.clientX, event.clientY);
        return;
      }

      setDragPointer({ x: event.clientX, y: event.clientY });
      updateDropState(dragPayload.source, event.clientX, event.clientY);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!dragPayload) {
        dragStartRef.current = null;
        setDragInteractionActive(false);
        return;
      }

      if (
        dragPayload.source === 'local' &&
        isPointInElement(remoteDropZoneRef.current, event.clientX, event.clientY)
      ) {
        const entry = localEntries.find((item) => item.path === dragPayload.path);
        if (entry) {
          onUploadLocalEntryToRemote(entry);
        }
      } else if (
        dragPayload.source === 'remote' &&
        isPointInElement(localDropZoneRef.current, event.clientX, event.clientY)
      ) {
        const entry = sftpEntries.find((item) => item.path === dragPayload.path);
        if (entry) {
          onDownloadRemoteEntryToLocal(entry);
        }
      }

      clearDragState();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [
    clearDragState,
    dragPayload,
    isPointInElement,
    localEntries,
    onDownloadRemoteEntryToLocal,
    onUploadLocalEntryToRemote,
    sftpEntries,
    updateDropState
  ]);

  useEffect(() => {
    uploadSystemPathsToRemoteRef.current = onUploadSystemPathsToRemote;
  }, [onUploadSystemPathsToRemote]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const bindDragDrop = async () => {
      const unlistenEnter = await listen<{ position?: { x: number; y: number } }>(TauriEvent.DRAG_ENTER, (event) => {
        if (!isActive || !connectedSftpProfile) {
          setSystemRemoteDropState(false);
          return;
        }
        const position = event.payload?.position;
        if (!position) {
          return;
        }
        setSystemRemoteDropState(isPointInRemoteDropZone(position.x, position.y));
      });
      const unlistenOver = await listen<{ position?: { x: number; y: number } }>(TauriEvent.DRAG_OVER, (event) => {
        if (!isActive || !connectedSftpProfile) {
          setSystemRemoteDropState(false);
          return;
        }
        const position = event.payload?.position;
        if (!position) {
          return;
        }
        setSystemRemoteDropState(isPointInRemoteDropZone(position.x, position.y));
      });
      const unlistenLeave = await listen(TauriEvent.DRAG_LEAVE, () => {
        setSystemRemoteDropState(false);
      });
      const unlistenDrop = await listen<{ position?: { x: number; y: number }; paths?: string[] }>(
        TauriEvent.DRAG_DROP,
        (event) => {
          if (!isActive || !connectedSftpProfile) {
            setSystemRemoteDropState(false);
            return;
          }
          const paths = Array.isArray(event.payload?.paths) ? event.payload.paths : [];
          const position = event.payload?.position;
          const isOverRemote = position
            ? isPointInRemoteDropZone(position.x, position.y)
            : systemRemoteDropActiveRef.current;
          setSystemRemoteDropState(false);
          if (isOverRemote) {
            uploadSystemPaths(paths);
          }
        }
      );

      if (disposed) {
        unlistenEnter();
        unlistenOver();
        unlistenLeave();
        unlistenDrop();
        return;
      }

      unlisteners.push(unlistenEnter, unlistenOver, unlistenLeave, unlistenDrop);
    };

    void bindDragDrop();

    return () => {
      disposed = true;
      setSystemRemoteDropState(false);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [connectedSftpProfile, isActive, isPointInRemoteDropZone, setSystemRemoteDropState, uploadSystemPaths]);

  useEffect(() => {
    if (!isDragInteractionActive) {
      document.body.classList.remove('sftp-transfer-dragging');
      return;
    }
    document.body.classList.add('sftp-transfer-dragging');
    return () => {
      document.body.classList.remove('sftp-transfer-dragging');
    };
  }, [isDragInteractionActive]);

  const remoteDropHandlers = useMemo(
    () => ({
      onDragEnter: (event: ReactDragEvent<HTMLDivElement>) => {
        if (!connectedSftpProfile || !hasDraggedFiles(event)) {
          return;
        }
        event.preventDefault();
        setSystemRemoteDropState(true);
      },
      onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
        if (!connectedSftpProfile || !hasDraggedFiles(event)) {
          return;
        }
        event.preventDefault();
        setSystemRemoteDropState(true);
      },
      onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
        if (!connectedSftpProfile) {
          return;
        }
        event.preventDefault();
        const relatedTarget = event.relatedTarget as Node | null;
        if (!relatedTarget || !remoteDropZoneRef.current?.contains(relatedTarget)) {
          setSystemRemoteDropState(false);
        }
      },
      onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
        if (!connectedSftpProfile) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setSystemRemoteDropState(false);
        const droppedPaths = extractDroppedPaths(event);
        if (droppedPaths.length > 0) {
          uploadSystemPaths(droppedPaths);
        }
      }
    }),
    [connectedSftpProfile, setSystemRemoteDropState, uploadSystemPaths]
  );

  return {
    localDropZoneRef,
    remoteDropZoneRef,
    isLocalDropActive,
    isRemoteDropActive,
    isSystemRemoteDropActive,
    dragPayload,
    dragPointer,
    startDragCandidate,
    remoteDropHandlers
  };
}
