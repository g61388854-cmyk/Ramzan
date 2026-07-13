import { motion } from 'framer-motion';
import { useBoardStore } from '../store/useBoardStore';

export function HistoryControls() {
  const canUndo = useBoardStore((s) => s.history.past.length > 0);
  const canRedo = useBoardStore((s) => s.history.future.length > 0);
  const undo = useBoardStore((s) => s.undo);
  const redo = useBoardStore((s) => s.redo);
  const reset = useBoardStore((s) => s.resetBoard);

  return (
    <motion.div
      className="history glass"
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.6, type: 'spring', stiffness: 140, damping: 18 }}
    >
      <button disabled={!canUndo} onClick={undo} title="Undo (⌘Z)">
        ↺
      </button>
      <button disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)">
        ↻
      </button>
      <div className="history-sep" />
      <button onClick={reset} title="Reset board" className="reset">
        ⟲ reset
      </button>
    </motion.div>
  );
}
