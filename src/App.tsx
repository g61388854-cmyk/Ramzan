import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Scene } from './three/Scene';
import { Toolbar } from './ui/Toolbar';
import { Inspector } from './ui/Inspector';
import { HistoryControls } from './ui/HistoryControls';
import { UploadDropzone } from './ui/UploadDropzone';
import { HudHints } from './ui/HudHints';
import { Intro } from './ui/Intro';
import { PlannerPanel } from './ui/PlannerPanel';
import { useKeyboard } from './hooks/useKeyboard';

export function App() {
  useKeyboard();

  return (
    <div className="app">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        camera={{ position: [4, 3, 34], fov: 28 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Scene />
      </Canvas>

      {/* DOM overlays */}
      <UploadDropzone />
      <Toolbar />
      <HistoryControls />
      <Inspector />
      <HudHints />
      <PlannerPanel />
      <Intro />

      <div className="grain-overlay" aria-hidden />
    </div>
  );
}
