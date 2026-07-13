import {
  EffectComposer,
  Bloom,
  Vignette,
  DepthOfField,
  SMAA,
  BrightnessContrast,
  HueSaturation,
} from '@react-three/postprocessing';
import { useInteraction } from '../store/useInteraction';

/**
 * Cinematic grade: subtle bloom on the metallic pins + accents, a filmic
 * vignette, a touch of depth-of-field that deepens while the board is in
 * motion (drag / lasso), and a gentle contrast/saturation lift.
 */
export function Effects() {
  const locked = useInteraction((s) => s.cameraLocked);
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <DepthOfField
        focusDistance={0.015}
        focalLength={locked ? 0.05 : 0.02}
        bokehScale={locked ? 3.2 : 1.4}
        height={480}
      />
      <Bloom
        intensity={0.62}
        luminanceThreshold={0.62}
        luminanceSmoothing={0.28}
        mipmapBlur
        radius={0.7}
      />
      <BrightnessContrast brightness={-0.02} contrast={0.12} />
      <HueSaturation saturation={0.08} hue={0} />
      <Vignette offset={0.28} darkness={0.72} eskil={false} />
      <SMAA />
    </EffectComposer>
  );
}
