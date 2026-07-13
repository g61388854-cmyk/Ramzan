import { Suspense } from 'react';
import { Environment, Lightformer } from '@react-three/drei';
import { Corkboard } from './Corkboard';
import { Lighting } from './Lighting';
import { CameraRig } from './CameraRig';
import { RopeSystem } from './RopeSystem';
import { Dust } from './Dust';
import { Effects } from './Effects';
import { EvidenceLayer } from './EvidenceLayer';

export function Scene() {
  return (
    <>
      <color attach="background" args={['#0b0806']} />
      <fog attach="fog" args={['#0b0806', 42, 120]} />

      <CameraRig />
      <Lighting />

      {/* Local, network-free reflection environment for the metallic pins.
          Lightformers stand in for an HDRI — soft warm keys + a cool strip. */}
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={2.4} color="#ffd9a0" position={[6, 6, 8]} scale={[10, 10, 1]} />
        <Lightformer intensity={0.9} color="#6b7fa8" position={[-8, 2, 6]} scale={[8, 8, 1]} />
        <Lightformer intensity={0.5} color="#ffffff" position={[0, -6, 6]} scale={[12, 4, 1]} />
      </Environment>

      <Suspense fallback={null}>
        <Corkboard />
        <EvidenceLayer />
        <RopeSystem />
      </Suspense>

      <Dust />
      <Effects />
    </>
  );
}
