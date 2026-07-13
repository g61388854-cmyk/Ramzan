import * as THREE from 'three';

const geoCache = new Map<string, THREE.BufferGeometry>();

/**
 * A rounded, beveled card with real thickness and a gentle paper curl.
 * Front face lives at +z so a texture maps cleanly; corners lift slightly and
 * the sheet bows so cards never read as flat sprites.
 */
export function roundedCardGeometry(
  w: number,
  h: number,
  thickness: number,
  radius = 0.12,
  curl = 0.05
): THREE.BufferGeometry {
  const key = `card_${w}_${h}_${thickness}_${radius}_${curl}`;
  if (geoCache.has(key)) return geoCache.get(key)!;

  const r = Math.min(radius, w / 2, h / 2);
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.4,
    bevelSize: thickness * 0.5,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.center();

  // UV mapping across the front face
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array((pos.count) * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    // CanvasTexture uses flipY (row 0 → v=1), so map card-top → v=1.
    uv[i * 2] = (px + w / 2) / w;
    uv[i * 2 + 1] = (py + h / 2) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  // paper curl: bow the sheet + lift corners for a hand-pinned look
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const nx = px / (w / 2);
    const ny = py / (h / 2);
    const bow = (1 - nx * nx) * curl * 0.6 + (1 - ny * ny) * curl * 0.4;
    const corner = Math.abs(nx) * Math.abs(ny) * curl * 1.4;
    pos.setZ(i, pos.getZ(i) + bow + corner);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  geoCache.set(key, geo);
  return geo;
}

/** A pin head + shaft, returned as merged-ish group parts. */
export function sphereGeometry(r: number): THREE.SphereGeometry {
  const key = `sph_${r}`;
  if (geoCache.has(key)) return geoCache.get(key) as THREE.SphereGeometry;
  const g = new THREE.SphereGeometry(r, 24, 18);
  geoCache.set(key, g);
  return g as THREE.SphereGeometry;
}
