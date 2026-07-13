import { create } from 'zustand';

/**
 * Ephemeral, high-frequency interaction state kept out of the main board store
 * so pointer churn never triggers board re-renders.
 */
interface InteractionState {
  draggingId: string | null;
  cameraLocked: boolean; // true while dragging an item or lassoing
  lassoing: boolean;
  /** world-space point the connect-tool rubber band should reach toward */
  setDragging: (id: string | null) => void;
  setLassoing: (v: boolean) => void;
}

export const useInteraction = create<InteractionState>((set) => ({
  draggingId: null,
  cameraLocked: false,
  lassoing: false,
  setDragging: (id) => set({ draggingId: id, cameraLocked: id !== null }),
  setLassoing: (v) => set({ lassoing: v, cameraLocked: v }),
}));
