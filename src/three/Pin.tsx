import { useMemo } from 'react';
import * as THREE from 'three';

interface PinProps {
  color: string;
  position: [number, number, number];
  /** gleam boost on hover/selection */
  gleam?: number;
  scale?: number;
}

/**
 * A real 3D push-pin: glossy enamel head with a metallic collar and a steel
 * shaft sunk into the board. PBR so it catches the warm lamp with a tight
 * specular highlight — never a flat PNG icon.
 */
export function Pin({ color, position, gleam = 0, scale = 1 }: PinProps) {
  const headMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.18,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        reflectivity: 0.6,
        sheen: 0.3,
      }),
    [color]
  );

  const steelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c8ccd2',
        roughness: 0.28,
        metalness: 0.95,
      }),
    []
  );

  return (
    <group position={position} scale={scale}>
      {/* enamel head */}
      <mesh castShadow position={[0, 0, 0.16]}>
        <sphereGeometry args={[0.16, 28, 20]} />
        <primitive object={headMat} attach="material" />
      </mesh>
      {/* under-head dome */}
      <mesh position={[0, 0, 0.05]}>
        <cylinderGeometry args={[0.16, 0.09, 0.12, 24]} />
        <primitive object={headMat} attach="material" />
      </mesh>
      {/* metallic collar */}
      <mesh position={[0, 0, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.14, 16]} />
        <primitive object={steelMat} attach="material" />
      </mesh>
      {/* shaft into board */}
      <mesh position={[0, 0, -0.18]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.008, 0.4, 12]} />
        <primitive object={steelMat} attach="material" />
      </mesh>
      {/* gleam point that brightens on hover */}
      {gleam > 0 && (
        <pointLight position={[0, 0, 0.4]} intensity={gleam * 2} distance={2} color={color} />
      )}
    </group>
  );
}
