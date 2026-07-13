import { useBoardStore } from '../store/useBoardStore';
import { motion } from 'framer-motion';

/** Contextual footer hints — changes with the active tool. */
export function HudHints() {
  const tool = useBoardStore((s) => s.tool);
  const connectFrom = useBoardStore((s) => s.connectFrom);
  const count = useBoardStore((s) => s.order.length);
  const conns = useBoardStore((s) => Object.keys(s.connections).length);

  let hint = 'Drag to move · Scroll to zoom · ⇧-drag empty space to lasso';
  if (tool === 'connect')
    hint = connectFrom ? 'Click a second item to run the thread' : 'Click an item to start a thread';
  if (tool === 'pan') hint = 'Drag anywhere to pan · Scroll to zoom';

  return (
    <motion.div
      className="hud glass"
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.7, type: 'spring', stiffness: 140, damping: 18 }}
    >
      <span className="hud-hint">{hint}</span>
      <span className="hud-stats">
        {count} items · {conns} threads
      </span>
    </motion.div>
  );
}
