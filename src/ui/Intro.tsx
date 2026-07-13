import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/** A brief cinematic title card that dissolves on first interaction. */
export function Intro() {
  const [gone, setGone] = useState(false);

  return (
    <AnimatePresence>
      {!gone && (
        <motion.div
          className="intro"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          onAnimationComplete={() => setTimeout(() => setGone(true), 2600)}
          onClick={() => setGone(true)}
        >
          <motion.div
            className="intro-card"
            initial={{ y: 20, opacity: 0, filter: 'blur(8px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.3, duration: 1 }}
          >
            <div className="intro-tag">CASE FILE · OPEN</div>
            <h1 className="intro-title">THE EVIDENCE BOARD</h1>
            <p className="intro-sub">
              A living investigation wall. Pin evidence, run physical threads, follow the connections.
            </p>
            <div className="intro-hint">click to begin</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
