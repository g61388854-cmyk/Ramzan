/**
 * Core domain types for the investigation board.
 *
 * The board is a graph: EvidenceItems are nodes, Connections are edges.
 * Every edge is backed by a physically-simulated rope. The data model is
 * deliberately serializable (no THREE objects) so the whole board can be
 * saved, restored, undone/redone, and — in future — reasoned over by AI
 * agents that read `metadata` and `annotations`.
 */

export type EvidenceKind =
  | 'photo'
  | 'document'
  | 'sticky'
  | 'suspect'
  | 'location'
  | 'newspaper'
  | 'fingerprint'
  | 'note';

/** A 2D position on the board plane, in world units. Z is derived per-kind. */
export interface Vec2 {
  x: number;
  y: number;
}

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  /** Position of the item's center on the board plane. */
  position: Vec2;
  /** In-plane rotation (radians). Small random tilt makes the board feel real. */
  rotation: number;
  /** Base scale multiplier. */
  scale: number;
  /** Stacking order — higher draws in front / lifts off the board. */
  z: number;
  /** Pin colour, chosen from the PIN_COLORS palette. */
  pinColor: string;
  /** Rich text / title content depending on kind. */
  title: string;
  body: string;
  /** For photo/document/newspaper: an object URL or data URL to the image. */
  imageUrl?: string;
  /** Intrinsic aspect ratio (w/h) once an image has loaded. */
  aspect?: number;
  /** Freeform, AI-friendly metadata bag. */
  metadata: Record<string, string | number | boolean>;
  createdAt: number;
}

/** Rope material presets — each maps to shader/geometry parameters. */
export type RopeMaterial = 'redYarn' | 'cotton' | 'nylon' | 'twine' | 'evidence';

export interface Connection {
  id: string;
  from: string; // evidence id
  to: string; // evidence id
  material: RopeMaterial;
  /** Semantic label shown on hover / used by future reasoning. */
  label: string;
  /** 0..1 confidence, drives thickness + colour intensity. */
  strength: number;
  /** Freeform annotations for AI reasoning. */
  annotations: string[];
  metadata: Record<string, string | number | boolean>;
  createdAt: number;
}

/** A full serializable snapshot of the board. */
export interface BoardSnapshot {
  evidence: EvidenceItem[];
  connections: Connection[];
}
