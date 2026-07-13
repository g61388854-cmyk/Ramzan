import type { RopeMaterial } from './types';

/** Pin colours — metallic PBR heads. */
export const PIN_COLORS = [
  '#e4322b', // red
  '#2b6ce4', // blue
  '#f5c518', // yellow
  '#1a1a1a', // black
  '#f4f4f4', // white
] as const;

/** World-space dimensions of the corkboard face (x = width, y = height). */
export const BOARD = {
  width: 26,
  height: 16,
  depth: 0.7,
  frame: 0.9,
  /** Board surface sits at z = 0; items float slightly above. */
  surfaceZ: 0,
};

/** Per-kind default footprint (world units) and pin offset. */
export const KIND_SIZES: Record<
  string,
  { w: number; h: number; thickness: number; z: number }
> = {
  photo: { w: 2.4, h: 3.0, thickness: 0.05, z: 0.18 },
  document: { w: 2.6, h: 3.4, thickness: 0.045, z: 0.16 },
  sticky: { w: 1.9, h: 1.9, thickness: 0.04, z: 0.2 },
  suspect: { w: 2.6, h: 3.3, thickness: 0.07, z: 0.22 },
  location: { w: 3.2, h: 2.4, thickness: 0.06, z: 0.18 },
  newspaper: { w: 3.0, h: 3.6, thickness: 0.03, z: 0.14 },
  fingerprint: { w: 1.7, h: 2.2, thickness: 0.04, z: 0.16 },
  note: { w: 2.8, h: 2.0, thickness: 0.04, z: 0.16 },
};

export interface RopeMaterialDef {
  label: string;
  color: string;
  /** base tube radius in world units */
  radius: number;
  /** how much the rope sags: extra slack ratio over straight-line distance */
  slack: number;
  fuzz: number;
  roughness: number;
  twist: number;
}

export const ROPE_MATERIALS: Record<RopeMaterial, RopeMaterialDef> = {
  redYarn: { label: 'Red Yarn', color: '#c1121f', radius: 0.045, slack: 0.28, fuzz: 1.0, roughness: 0.95, twist: 22 },
  cotton: { label: 'Cotton', color: '#e8e2d4', radius: 0.04, slack: 0.24, fuzz: 0.7, roughness: 0.9, twist: 16 },
  nylon: { label: 'Nylon', color: '#3a86ff', radius: 0.032, slack: 0.14, fuzz: 0.2, roughness: 0.4, twist: 30 },
  twine: { label: 'Twine', color: '#a68a64', radius: 0.05, slack: 0.3, fuzz: 0.9, roughness: 1.0, twist: 12 },
  evidence: { label: 'Evidence', color: '#ff2d55', radius: 0.05, slack: 0.26, fuzz: 0.6, roughness: 0.75, twist: 20 },
};

/** Colour theme for UI + lighting. */
export const THEME = {
  lampWarm: '#ffd9a0',
  fill: '#6b7fa8',
  bg: '#120d0a',
  accent: '#ff2d55',
};
