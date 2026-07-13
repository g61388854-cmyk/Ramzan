import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useBoardStore } from '../store/useBoardStore';
import { filesToEvidence } from '../upload/uploadManager';

/** Full-window drag-and-drop target for images and PDFs. */
export function UploadDropzone() {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      depth++;
      if (e.dataTransfer?.types.includes('Files')) setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      depth--;
      if (depth <= 0) setOver(false);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (!e.dataTransfer?.files?.length) return;
      const results = await filesToEvidence(e.dataTransfer.files);
      const s = useBoardStore.getState();
      results.forEach((r, i) =>
        s.addEvidence(
          r.kind,
          { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 4 - i * 0.15 },
          r.patch
        )
      );
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <AnimatePresence>
      {over && (
        <motion.div
          className="dropzone"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="dropzone-inner"
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
          >
            <div className="dropzone-glyph">⬆</div>
            <div className="dropzone-text">Drop evidence to pin it to the board</div>
            <div className="dropzone-sub">PNG · JPEG · WEBP · GIF · PDF</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
