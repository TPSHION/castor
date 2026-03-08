import { useEffect } from 'react';

export function useScrollbarWidthVariable(variableName: string) {
  useEffect(() => {
    const updateScrollbarWidth = () => {
      const probe = document.createElement('div');
      probe.style.width = '120px';
      probe.style.height = '120px';
      probe.style.overflow = 'scroll';
      probe.style.position = 'absolute';
      probe.style.top = '-9999px';
      probe.style.left = '-9999px';
      probe.style.visibility = 'hidden';
      document.body.appendChild(probe);
      const scrollbarWidth = probe.offsetWidth - probe.clientWidth;
      document.body.removeChild(probe);
      document.documentElement.style.setProperty(variableName, `${Math.max(0, scrollbarWidth)}px`);
    };

    updateScrollbarWidth();
    window.addEventListener('resize', updateScrollbarWidth);
    return () => {
      window.removeEventListener('resize', updateScrollbarWidth);
    };
  }, [variableName]);
}
