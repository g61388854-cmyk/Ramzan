import { create } from 'zustand';
import type {
  BoardSnapshot,
  Connection,
  EvidenceItem,
  EvidenceKind,
  RopeMaterial,
  Vec2,
} from '../types';
import { KIND_SIZES, PIN_COLORS } from '../constants';
import { seedBoard } from './seed';

let idCounter = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export type ToolMode = 'select' | 'connect' | 'pan';

interface HistoryState {
  past: BoardSnapshot[];
  future: BoardSnapshot[];
}

interface BoardState {
  evidence: Record<string, EvidenceItem>;
  connections: Record<string, Connection>;
  order: string[]; // z-order of evidence ids
  selected: Set<string>;
  hovered: string | null;
  tool: ToolMode;
  connectFrom: string | null; // pending connection source
  ropeMaterial: RopeMaterial;
  history: HistoryState;
  /** bumped whenever geometry-affecting positions change so systems can react */
  revision: number;

  // ---- selectors as plain helpers ----
  getSnapshot: () => BoardSnapshot;

  // ---- history ----
  commit: (label?: string) => void; // push current state to undo stack
  undo: () => void;
  redo: () => void;

  // ---- evidence ----
  addEvidence: (kind: EvidenceKind, at?: Vec2, patch?: Partial<EvidenceItem>) => string;
  updateEvidence: (id: string, patch: Partial<EvidenceItem>, record?: boolean) => void;
  moveEvidenceLive: (id: string, pos: Vec2) => void; // no history (drag)
  duplicateSelection: () => void;
  deleteSelection: () => void;
  bringToFront: (id: string) => void;

  // ---- selection ----
  setSelected: (ids: string[], additive?: boolean) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  setHovered: (id: string | null) => void;

  // ---- tools ----
  setTool: (t: ToolMode) => void;
  setRopeMaterial: (m: RopeMaterial) => void;

  // ---- connections ----
  startConnect: (id: string) => void;
  completeConnect: (id: string) => void;
  cancelConnect: () => void;
  addConnection: (from: string, to: string, patch?: Partial<Connection>) => string | null;
  updateConnection: (id: string, patch: Partial<Connection>, record?: boolean) => void;
  removeConnection: (id: string) => void;

  connectionsOf: (evidenceId: string) => Connection[];

  // ---- persistence ----
  loadSnapshot: (snap: BoardSnapshot) => void;
  resetBoard: () => void;
}

const HISTORY_LIMIT = 80;

function cloneSnapshot(s: BoardSnapshot): BoardSnapshot {
  return {
    evidence: s.evidence.map((e) => ({ ...e, position: { ...e.position }, metadata: { ...e.metadata } })),
    connections: s.connections.map((c) => ({ ...c, annotations: [...c.annotations], metadata: { ...c.metadata } })),
  };
}

export const useBoardStore = create<BoardState>((set, get) => {
  const takeSnapshot = (): BoardSnapshot => {
    const st = get();
    return {
      evidence: st.order.map((id) => st.evidence[id]).filter(Boolean),
      connections: Object.values(st.connections),
    };
  };

  const applySnapshot = (snap: BoardSnapshot) => {
    const evidence: Record<string, EvidenceItem> = {};
    const order: string[] = [];
    for (const e of snap.evidence) {
      evidence[e.id] = e;
      order.push(e.id);
    }
    const connections: Record<string, Connection> = {};
    for (const c of snap.connections) connections[c.id] = c;
    return { evidence, order, connections };
  };

  const seed = seedBoard(uid);

  return {
    ...applySnapshot(seed),
    selected: new Set<string>(),
    hovered: null,
    tool: 'select',
    connectFrom: null,
    ropeMaterial: 'redYarn',
    history: { past: [], future: [] },
    revision: 0,

    getSnapshot: () => takeSnapshot(),

    commit: () => {
      set((st) => {
        const snap = cloneSnapshot(takeSnapshot());
        const past = [...st.history.past, snap];
        if (past.length > HISTORY_LIMIT) past.shift();
        return { history: { past, future: [] } };
      });
    },

    undo: () => {
      const st = get();
      const past = st.history.past;
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      const current = cloneSnapshot(takeSnapshot());
      const restored = applySnapshot(cloneSnapshot(previous));
      set({
        ...restored,
        selected: new Set(),
        connectFrom: null,
        history: { past: past.slice(0, -1), future: [current, ...st.history.future] },
        revision: st.revision + 1,
      });
    },

    redo: () => {
      const st = get();
      const future = st.history.future;
      if (future.length === 0) return;
      const next = future[0];
      const current = cloneSnapshot(takeSnapshot());
      const restored = applySnapshot(cloneSnapshot(next));
      set({
        ...restored,
        selected: new Set(),
        connectFrom: null,
        history: { past: [...st.history.past, current], future: future.slice(1) },
        revision: st.revision + 1,
      });
    },

    addEvidence: (kind, at, patch) => {
      get().commit();
      const id = uid('ev');
      const size = KIND_SIZES[kind] ?? KIND_SIZES.note;
      const item: EvidenceItem = {
        id,
        kind,
        position: at ?? { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 5 },
        rotation: (Math.random() - 0.5) * 0.14,
        scale: 1,
        z: size.z,
        pinColor: PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)],
        title: defaultTitle(kind),
        body: defaultBody(kind),
        metadata: {},
        createdAt: Date.now(),
        ...patch,
      };
      set((st) => ({
        evidence: { ...st.evidence, [id]: item },
        order: [...st.order, id],
        revision: st.revision + 1,
      }));
      return id;
    },

    updateEvidence: (id, patch, record = true) => {
      if (record) get().commit();
      set((st) => {
        const cur = st.evidence[id];
        if (!cur) return {};
        return { evidence: { ...st.evidence, [id]: { ...cur, ...patch } }, revision: st.revision + 1 };
      });
    },

    moveEvidenceLive: (id, pos) => {
      set((st) => {
        const cur = st.evidence[id];
        if (!cur) return {};
        return {
          evidence: { ...st.evidence, [id]: { ...cur, position: pos } },
          revision: st.revision + 1,
        };
      });
    },

    duplicateSelection: () => {
      const st = get();
      if (st.selected.size === 0) return;
      st.commit();
      const newIds: string[] = [];
      const additions: Record<string, EvidenceItem> = {};
      for (const id of st.selected) {
        const src = st.evidence[id];
        if (!src) continue;
        const nid = uid('ev');
        additions[nid] = {
          ...src,
          id: nid,
          position: { x: src.position.x + 1.1, y: src.position.y - 1.1 },
          metadata: { ...src.metadata },
          createdAt: Date.now(),
        };
        newIds.push(nid);
      }
      set((s) => ({
        evidence: { ...s.evidence, ...additions },
        order: [...s.order, ...newIds],
        selected: new Set(newIds),
        revision: s.revision + 1,
      }));
    },

    deleteSelection: () => {
      const st = get();
      if (st.selected.size === 0) return;
      st.commit();
      const kill = st.selected;
      const evidence = { ...st.evidence };
      for (const id of kill) delete evidence[id];
      const connections: Record<string, Connection> = {};
      for (const [cid, c] of Object.entries(st.connections)) {
        if (!kill.has(c.from) && !kill.has(c.to)) connections[cid] = c;
      }
      set((s) => ({
        evidence,
        connections,
        order: s.order.filter((id) => !kill.has(id)),
        selected: new Set(),
        revision: s.revision + 1,
      }));
    },

    bringToFront: (id) => {
      set((st) => ({ order: [...st.order.filter((x) => x !== id), id] }));
    },

    setSelected: (ids, additive = false) => {
      set((st) => {
        const next = additive ? new Set(st.selected) : new Set<string>();
        ids.forEach((id) => next.add(id));
        return { selected: next };
      });
    },

    toggleSelected: (id) => {
      set((st) => {
        const next = new Set(st.selected);
        next.has(id) ? next.delete(id) : next.add(id);
        return { selected: next };
      });
    },

    clearSelection: () => set({ selected: new Set() }),
    setHovered: (id) => set({ hovered: id }),

    setTool: (t) => set({ tool: t, connectFrom: t === 'connect' ? get().connectFrom : null }),
    setRopeMaterial: (m) => set({ ropeMaterial: m }),

    startConnect: (id) => set({ connectFrom: id, tool: 'connect' }),
    completeConnect: (id) => {
      const from = get().connectFrom;
      if (from && from !== id) {
        get().addConnection(from, id);
      }
      set({ connectFrom: null });
    },
    cancelConnect: () => set({ connectFrom: null }),

    addConnection: (from, to, patch) => {
      const st = get();
      // avoid duplicate identical edges
      const dup = Object.values(st.connections).find(
        (c) => (c.from === from && c.to === to) || (c.from === to && c.to === from)
      );
      if (dup) return null;
      st.commit();
      const id = uid('conn');
      const conn: Connection = {
        id,
        from,
        to,
        material: st.ropeMaterial,
        label: '',
        strength: 0.7,
        annotations: [],
        metadata: {},
        createdAt: Date.now(),
        ...patch,
      };
      set((s) => ({ connections: { ...s.connections, [id]: conn }, revision: s.revision + 1 }));
      return id;
    },

    updateConnection: (id, patch, record = true) => {
      if (record) get().commit();
      set((st) => {
        const cur = st.connections[id];
        if (!cur) return {};
        return { connections: { ...st.connections, [id]: { ...cur, ...patch } } };
      });
    },

    removeConnection: (id) => {
      get().commit();
      set((st) => {
        const connections = { ...st.connections };
        delete connections[id];
        return { connections, revision: st.revision + 1 };
      });
    },

    connectionsOf: (evidenceId) =>
      Object.values(get().connections).filter((c) => c.from === evidenceId || c.to === evidenceId),

    loadSnapshot: (snap) => {
      get().commit();
      const restored = applySnapshot(cloneSnapshot(snap));
      set((st) => ({ ...restored, selected: new Set(), revision: st.revision + 1 }));
    },

    resetBoard: () => {
      get().commit();
      const restored = applySnapshot(seedBoard(uid));
      set((st) => ({ ...restored, selected: new Set(), revision: st.revision + 1 }));
    },
  };
});

function defaultTitle(kind: EvidenceKind): string {
  switch (kind) {
    case 'suspect': return 'UNKNOWN SUBJECT';
    case 'location': return 'SCENE 04';
    case 'sticky': return '';
    case 'newspaper': return 'THE DAILY LEDGER';
    case 'fingerprint': return 'LATENT #7';
    case 'document': return 'CASE FILE';
    case 'note': return 'FIELD NOTE';
    default: return 'EVIDENCE';
  }
}

function defaultBody(kind: EvidenceKind): string {
  switch (kind) {
    case 'sticky': return 'Follow up @ 9pm';
    case 'note': return 'Witness places subject near the pier after midnight. Cross-reference with transit logs.';
    case 'suspect': return 'H: 5\'11"  ·  last seen 11th St.';
    case 'location': return 'Warehouse district — pier 4';
    case 'newspaper': return 'CITY SHAKEN BY MIDNIGHT DISAPPEARANCE';
    case 'document': return 'CONFIDENTIAL — do not distribute';
    case 'fingerprint': return 'Partial · 12 pts match';
    default: return '';
  }
}
