import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { OutputPayload, ResizeRequest, SendInputRequest } from '../types';

type TerminalViewProps = {
  sessionId: string;
  active: boolean;
};

export function TerminalView({ sessionId, active }: TerminalViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!rootRef.current || termRef.current) {
      return;
    }
    const rootElement = rootRef.current;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#000000',
        foreground: '#2be18e'
      }
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(rootElement);
    fitAddon.fit();
    terminal.writeln(`Castor SSH session ${sessionId} ready.`);

    const viewportElement = rootElement.querySelector<HTMLElement>('.xterm-viewport');
    let hideScrollbarTimer: number | null = null;
    const onViewportScroll = () => {
      rootElement.classList.add('terminal-scrolling');
      if (hideScrollbarTimer !== null) {
        window.clearTimeout(hideScrollbarTimer);
      }
      hideScrollbarTimer = window.setTimeout(() => {
        rootElement.classList.remove('terminal-scrolling');
        hideScrollbarTimer = null;
      }, 450);
    };
    if (viewportElement) {
      viewportElement.addEventListener('scroll', onViewportScroll, { passive: true });
    }

    const unlistenData = terminal.onData((data) => {
      const payload: SendInputRequest = {
        session_id: sessionId,
        data
      };
      void invoke('send_ssh_input', { request: payload });
    });

    const onWindowResize = () => {
      if (!fitRef.current || !termRef.current) {
        return;
      }

      fitRef.current.fit();
      const cols = termRef.current.cols;
      const rows = termRef.current.rows;
      const payload: ResizeRequest = {
        session_id: sessionId,
        cols,
        rows
      };
      void invoke('resize_ssh', { request: payload });
    };

    window.addEventListener('resize', onWindowResize);

    termRef.current = terminal;
    fitRef.current = fitAddon;

    return () => {
      unlistenData.dispose();
      window.removeEventListener('resize', onWindowResize);
      if (viewportElement) {
        viewportElement.removeEventListener('scroll', onViewportScroll);
      }
      if (hideScrollbarTimer !== null) {
        window.clearTimeout(hideScrollbarTimer);
      }
      rootElement.classList.remove('terminal-scrolling');
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!active || !termRef.current || !fitRef.current) {
      return;
    }

    fitRef.current.fit();
    termRef.current.focus();

    const payload: ResizeRequest = {
      session_id: sessionId,
      cols: termRef.current.cols,
      rows: termRef.current.rows
    };
    void invoke('resize_ssh', { request: payload });
  }, [active, sessionId]);

  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal) {
      return;
    }

    let mounted = true;
    const unsubscribePromise = listen<OutputPayload>('ssh-output', (event) => {
      if (!mounted || event.payload.session_id !== sessionId) {
        return;
      }

      if (event.payload.stream === 'status') {
        terminal.writeln(`\r\n[status] ${event.payload.data}`);
        return;
      }

      terminal.write(event.payload.data);
    });

    return () => {
      mounted = false;
      void unsubscribePromise.then((unlisten) => unlisten());
    };
  }, [sessionId]);

  return <div className="terminal-root" ref={rootRef} />;
}
