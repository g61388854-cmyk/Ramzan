import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Motes of dust drifting through the lamp light. A single Points cloud with an
 * additive soft-disc shader; drift is done on the GPU from a per-point seed so
 * it costs almost nothing.
 */
export function Dust({ count = 380 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 34;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 22;
      positions[i * 3 + 2] = Math.random() * 9 + 0.5;
      seeds[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSize: { value: 26 } },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime;
        uniform float uSize;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.12 + seed) * 1.4;
          p.y += cos(uTime * 0.09 + seed * 1.7) * 1.1 + sin(uTime*0.05+seed)*0.4;
          p.z += sin(uTime * 0.16 + seed * 0.5) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (1.0 / -mv.z) * (0.5 + 0.5 * sin(seed + uTime));
          vA = 0.25 + 0.35 * (0.5 + 0.5 * sin(uTime * 0.5 + seed));
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d) * vA;
          gl_FragColor = vec4(vec3(1.0, 0.92, 0.78), a);
        }
      `,
    });
    return { geometry: geo, material: mat };
  }, [count]);

  useFrame((s) => {
    material.uniforms.uTime.value = s.clock.elapsedTime;
    if (ref.current) ref.current.rotation.z = Math.sin(s.clock.elapsedTime * 0.02) * 0.02;
  });

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}
