import { AnimatePresence, motion } from 'framer-motion';
import { useBoardStore } from '../store/useBoardStore';
import { PIN_COLORS } from '../constants';
import { useMemo } from 'react';

/**
 * Context panel for the current selection: edit title/body, pin colour, and
 * see/rewire this item's connections. Rich text is kept simple (multiline +
 * lightweight markdown rendered on the card textures).
 */
export function Inspector() {
  const selected = useBoardStore((s) => s.selected);
  const evidence = useBoardStore((s) => s.evidence);
  const updateEvidence = useBoardStore((s) => s.updateEvidence);
  const connectionsOf = useBoardStore((s) => s.connectionsOf);
  const removeConnection = useBoardStore((s) => s.removeConnection);
  const updateConnection = useBoardStore((s) => s.updateConnection);

  const ids = useMemo(() => Array.from(selected), [selected]);
  const single = ids.length === 1 ? evidence[ids[0]] : null;
  const conns = single ? connectionsOf(single.id) : [];

  return (
    <AnimatePresence>
      {ids.length > 0 && (
        <motion.div
          className="inspector glass"
          initial={{ x: 90, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 90, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 160, damping: 20 }}
        >
          {single ? (
            <>
              <div className="insp-head">
                <span className="insp-kind">{single.kind}</span>
                <span className="insp-id">#{single.id.slice(-4)}</span>
              </div>

              <label className="insp-label">Title</label>
              <input
                className="insp-input"
                value={single.title}
                onChange={(e) => updateEvidence(single.id, { title: e.target.value }, false)}
                onBlur={() => useBoardStore.getState().commit()}
                placeholder="Untitled"
              />

              <label className="insp-label">Body</label>
              <textarea
                className="insp-textarea"
                value={single.body}
                rows={4}
                onChange={(e) => updateEvidence(single.id, { body: e.target.value }, false)}
                onBlur={() => useBoardStore.getState().commit()}
                placeholder="Notes, markdown-ish…"
              />

              <label className="insp-label">Pin</label>
              <div className="pin-row">
                {PIN_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`pin-dot ${single.pinColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => updateEvidence(single.id, { pinColor: c })}
                  />
                ))}
              </div>

              <label className="insp-label">Connections ({conns.length})</label>
              <div className="conn-list">
                {conns.length === 0 && <span className="conn-empty">No threads yet</span>}
                {conns.map((c) => {
                  const otherId = c.from === single.id ? c.to : c.from;
                  const other = evidence[otherId];
                  return (
                    <div key={c.id} className="conn-item">
                      <input
                        className="conn-label"
                        value={c.label}
                        placeholder="relation…"
                        onChange={(e) => updateConnection(c.id, { label: e.target.value }, false)}
                        onBlur={() => useBoardStore.getState().commit()}
                      />
                      <span className="conn-to">→ {other?.title || other?.kind || '—'}</span>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={c.strength}
                        title="Evidence strength"
                        onChange={(e) => updateConnection(c.id, { strength: parseFloat(e.target.value) }, false)}
                        onMouseUp={() => useBoardStore.getState().commit()}
                      />
                      <button className="conn-del" onClick={() => removeConnection(c.id)} title="Cut thread">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="insp-multi">
              <span className="insp-kind">{ids.length} items selected</span>
              <div className="insp-actions">
                <button onClick={() => useBoardStore.getState().duplicateSelection()}>Duplicate</button>
                <button className="danger" onClick={() => useBoardStore.getState().deleteSelection()}>
                  Delete
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
