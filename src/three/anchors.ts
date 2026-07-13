import * as THREE from 'three';
import { KIND_SIZES } from '../constants';
import type { EvidenceItem } from '../types';

/**
 * Live anchor registry.
 *
 * Evidence objects have inertia — their rendered position lags the data model
 * during a drag. Ropes must attach to where the pin *actually is on screen*,
 * not where the store says it will settle. So each evidence object writes its
 * current pin world-position here every frame, and the rope system reads it.
 * This keeps physics perfectly in sync with visual inertia without routing
 * high-frequency updates through React/Zustand.
 */
const registry = new Map<string, THREE.Vector3>();

export function setAnchor(id: string, v: THREE.Vector3) {
  let cur = registry.get(id);
  if (!cur) {
    cur = new THREE.Vector3();
    registry.set(id, cur);
  }
  cur.copy(v);
}

export function getAnchor(id: string): THREE.Vector3 | undefined {
  return registry.get(id);
}

export function removeAnchor(id: string) {
  registry.delete(id);
}

/** Pin world-position for an item at a *settled* data position (fallback). */
export function computePinPosition(item: EvidenceItem, out = new THREE.Vector3()): THREE.Vector3 {
  const size = KIND_SIZES[item.kind] ?? KIND_SIZES.note;
  const h = size.h * item.scale;
  // pin sits near the top-centre of the card
  const localX = 0;
  const localY = h * 0.42;
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  out.set(
    item.position.x + localX * cos - localY * sin,
    item.position.y + localX * sin + localY * cos,
    item.z + size.thickness + 0.16
  );
  return out;
}

/** Local pin offset (relative to card centre) for rendering the pin mesh. */
export function pinLocalOffset(item: EvidenceItem): [number, number, number] {
  const size = KIND_SIZES[item.kind] ?? KIND_SIZES.note;
  const h = size.h * item.scale;
  return [0, h * 0.42, size.thickness + 0.02];
}
