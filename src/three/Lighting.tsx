import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { THEME } from '../constants';

/**
 * Cinematic lighting for a detective's office:
 *  warm desk lamp (key, casts soft shadows) → cool ambient fill → rim.
 * The lamp breathes almost imperceptibly so the scene never feels frozen.
 */
export function Lighting() {
  const key = useRef<THREE.SpotLight>(null);
  const flickerSeed = useRef(Math.random() * 100);

  useFrame((state) => {
    if (!key.current) return;
    const t = state.clock.elapsedTime;
    // subtle warm flicker, like a slightly loose bulb
    const f =
      1 +
      Math.sin(t * 2.1 + flickerSeed.current) * 0.015 +
      Math.sin(t * 7.3) * 0.008;
    key.current.intensity = 42 * f;
  });

  return (
    <>
      <ambientLight intensity={0.28} color={THEME.fill} />

      {/* warm key: the desk lamp, up and to the right */}
      <spotLight
        ref={key}
        position={[9, 9, 14]}
        angle={0.7}
        penumbra={0.9}
        distance={60}
        decay={1.4}
        intensity={42}
        color={THEME.lampWarm}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />

      {/* cool fill from the left to lift the shadows */}
      <directionalLight position={[-12, 4, 10]} intensity={0.5} color={THEME.fill} />

      {/* soft rim from behind for separation */}
      <directionalLight position={[0, -6, -8]} intensity={0.25} color="#8899bb" />

      {/* a faint amber bounce from below (desk surface) */}
      <pointLight position={[0, -10, 6]} intensity={6} distance={30} decay={2} color="#5a3a1a" />
    </>
  );
}
