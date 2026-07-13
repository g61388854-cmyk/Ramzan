import { memo } from 'react';
import { useBoardStore } from '../store/useBoardStore';
import { EvidenceObject } from './EvidenceObject';

/**
 * Renders every evidence item. Each id is wrapped in its own subscriber so a
 * change to one card never re-renders the rest — important with thousands of
 * items on the board.
 */
export function EvidenceLayer() {
  const order = useBoardStore((s) => s.order);
  return (
    <>
      {order.map((id) => (
        <EvidenceConnector key={id} id={id} />
      ))}
    </>
  );
}

const EvidenceConnector = memo(function EvidenceConnector({ id }: { id: string }) {
  const item = useBoardStore((s) => s.evidence[id]);
  if (!item) return null;
  return <EvidenceObject item={item} />;
});
