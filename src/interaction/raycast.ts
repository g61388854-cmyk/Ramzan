import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _normal = new THREE.Vector3(0, 0, 1);
const _hit = new THREE.Vector3();

/**
 * Project a client-space pointer onto a board plane at a given z, using the
 * live camera. Returns world coords or null if the ray is parallel.
 */
export function screenToBoard(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  planeZ: number
): THREE.Vector3 | null {
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _ray.setFromCamera(_ndc, camera);
  _plane.setFromNormalAndCoplanarPoint(_normal, new THREE.Vector3(0, 0, planeZ));
  const res = _ray.ray.intersectPlane(_plane, _hit);
  return res ? _hit.clone() : null;
}
