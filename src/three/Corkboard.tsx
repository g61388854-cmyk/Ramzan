import { useMemo } from 'react';
import * as THREE from 'three';
import { BOARD } from '../constants';
import { corkTexture, corkRoughness } from './textures';

/**
 * The corkboard as a true 3D object: a cork surface recessed inside a beveled
 * wooden frame, with baked-in imperfections. Not a flat rectangle.
 */
export function Corkboard() {
  const cork = useMemo(() => corkTexture(), []);
  const corkR = useMemo(() => corkRoughness(), []);

  const frameGeo = useMemo(() => buildFrame(), []);
  const lipGeo = useMemo(() => buildLip(), []);
  const woodMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#4a2f1c',
        roughness: 0.72,
        metalness: 0.05,
      }),
    []
  );

  const { width, height, depth } = BOARD;

  return (
    <group>
      {/* wooden frame */}
      <mesh geometry={frameGeo} material={woodMat} castShadow receiveShadow />

      {/* cork surface, recessed slightly */}
      <mesh position={[0, 0, -0.04]} receiveShadow>
        <boxGeometry args={[width, height, depth * 0.5]} />
        <meshStandardMaterial
          map={cork}
          roughnessMap={corkR}
          roughness={1}
          metalness={0}
          color="#d8b982"
        />
      </mesh>

      {/* dark inner lip → fakes ambient occlusion where cork meets frame */}
      <mesh geometry={lipGeo} position={[0, 0, 0.02]}>
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** A picture-frame shaped bar around the board perimeter with beveled top. */
function buildFrame(): THREE.BufferGeometry {
  const { width, height, depth, frame } = BOARD;
  const outerW = width + frame * 2;
  const outerH = height + frame * 2;

  const shape = new THREE.Shape();
  roundedRect(shape, -outerW / 2, -outerH / 2, outerW, outerH, 0.35);

  const hole = new THREE.Path();
  roundedRect(hole, -width / 2, -height / 2, width, height, 0.15);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.18,
    bevelSize: 0.16,
    bevelSegments: 3,
    curveSegments: 6,
  });
  geo.center();
  geo.translate(0, 0, depth * 0.2);
  geo.computeVertexNormals();
  return geo;
}

function buildLip(): THREE.BufferGeometry {
  const { width, height } = BOARD;
  const shape = new THREE.Shape();
  roundedRect(shape, -width / 2 - 0.2, -height / 2 - 0.2, width + 0.4, height + 0.4, 0.2);
  const hole = new THREE.Path();
  roundedRect(hole, -width / 2, -height / 2, width, height, 0.15);
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape);
}

function roundedRect(
  ctx: THREE.Shape | THREE.Path,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}
