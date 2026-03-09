import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';

export function useWindowTitlebarOverlay() {
  useEffect(() => {
    const isMacOs = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    document.body.classList.toggle('window-titlebar-overlay', isMacOs);
    if (!isMacOs) {
      return () => {
        document.body.classList.remove('window-titlebar-overlay');
        document.body.classList.remove('window-fullscreen');
      };
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenResize: (() => void) | null = null;

    const syncFullscreenState = async () => {
      try {
        const isFullscreen = await appWindow.isFullscreen();
        if (!disposed) {
          document.body.classList.toggle('window-fullscreen', isFullscreen);
        }
      } catch {
        if (!disposed) {
          document.body.classList.remove('window-fullscreen');
        }
      }
    };

    void syncFullscreenState();
    void appWindow
      .onResized(() => {
        void syncFullscreenState();
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenResize = unlisten;
      });

    return () => {
      disposed = true;
      if (unlistenResize) {
        unlistenResize();
      }
      document.body.classList.remove('window-titlebar-overlay');
      document.body.classList.remove('window-fullscreen');
    };
  }, []);
}
