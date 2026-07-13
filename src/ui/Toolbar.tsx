import { useRef } from 'react';
import { motion } from 'framer-motion';
import { useBoardStore } from '../store/useBoardStore';
import type { EvidenceKind, RopeMaterial } from '../types';
import { ROPE_MATERIALS } from '../constants';
import { filesToEvidence } from '../upload/uploadManager';

const ADD_ITEMS: { kind: EvidenceKind; label: string; glyph: string }[] = [
  { kind: 'photo', label: 'Photo', glyph: '🖼' },
  { kind: 'document', label: 'Document', glyph: '📄' },
  { kind: 'sticky', label: 'Sticky', glyph: '🗒' },
  { kind: 'note', label: 'Note', glyph: '✏️' },
  { kind: 'suspect', label: 'Suspect', glyph: '🕵' },
  { kind: 'location', label: 'Location', glyph: '🗺' },
  { kind: 'newspaper', label: 'Clipping', glyph: '📰' },
  { kind: 'fingerprint', label: 'Print', glyph: '🔎' },
];

export function Toolbar() {
  const tool = useBoardStore((s) => s.tool);
  const setTool = useBoardStore((s) => s.setTool);
  const addEvidence = useBoardStore((s) => s.addEvidence);
  const ropeMaterial = useBoardStore((s) => s.ropeMaterial);
  const setRopeMaterial = useBoardStore((s) => s.setRopeMaterial);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const results = await filesToEvidence(files);
    const s = useBoardStore.getState();
    results.forEach((r, i) =>
      s.addEvidence(r.kind, { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 4 - i * 0.2 }, r.patch)
    );
  };

  return (
    <motion.div
      className="toolbar glass"
      initial={{ x: -80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: 0.5, type: 'spring', stiffness: 120, damping: 18 }}
    >
      <div className="toolbar-section">
        <span className="toolbar-title">TOOLS</span>
        <div className="tool-row">
          <ToolBtn active={tool === 'select'} onClick={() => setTool('select')} title="Select (V)">
            ⬚
          </ToolBtn>
          <ToolBtn active={tool === 'pan'} onClick={() => setTool('pan')} title="Pan (H)">
            ✋
          </ToolBtn>
          <ToolBtn active={tool === 'connect'} onClick={() => setTool('connect')} title="Connect (C)">
            🧵
          </ToolBtn>
        </div>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <span className="toolbar-title">EVIDENCE</span>
        <div className="add-grid">
          {ADD_ITEMS.map((it) => (
            <motion.button
              key={it.kind}
              className="add-btn"
              whileHover={{ scale: 1.06, y: -2 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => addEvidence(it.kind)}
              title={`Add ${it.label}`}
            >
              <span className="add-glyph">{it.glyph}</span>
              <span className="add-label">{it.label}</span>
            </motion.button>
          ))}
          <motion.button
            className="add-btn upload"
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => fileRef.current?.click()}
            title="Upload image or PDF"
          >
            <span className="add-glyph">⬆</span>
            <span className="add-label">Upload</span>
          </motion.button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          multiple
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <span className="toolbar-title">THREAD</span>
        <div className="material-row">
          {(Object.keys(ROPE_MATERIALS) as RopeMaterial[]).map((m) => (
            <button
              key={m}
              className={`swatch ${ropeMaterial === m ? 'active' : ''}`}
              style={{ background: ROPE_MATERIALS[m].color }}
              onClick={() => setRopeMaterial(m)}
              title={ROPE_MATERIALS[m].label}
            />
          ))}
        </div>
        <span className="material-name">{ROPE_MATERIALS[ropeMaterial].label}</span>
      </div>
    </motion.div>
  );
}

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      className={`tool-btn ${active ? 'active' : ''}`}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      title={title}
    >
      {children}
    </motion.button>
  );
}
