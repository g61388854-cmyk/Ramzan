import { useEffect } from 'react';
import { useBoardStore } from '../store/useBoardStore';

/** Global keyboard shortcuts. Ignored while typing in an input/textarea. */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      const s = useBoardStore.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        s.duplicateSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.setSelected(s.order);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        s.cancelConnect();
        s.clearSelection();
        s.setTool('select');
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'v':
          s.setTool('select');
          break;
        case 'c':
          s.setTool('connect');
          break;
        case 'h':
          s.setTool('pan');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
