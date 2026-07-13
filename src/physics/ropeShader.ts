import * as THREE from 'three';

/**
 * Custom rope/yarn material.
 *
 * Rather than a plastic MeshStandardMaterial cylinder, this shader treats the
 * tube surface as twisted fibre:
 *  - twisted fibre noise modulates albedo + normal for a spun-thread look
 *  - an anisotropic specular term runs *along* the rope (Kajiya-Kay style),
 *    giving the sharp streak highlight real string has
 *  - a fuzz/rim term fakes the tiny stray fibres catching light
 *  - a cheap wrapped-diffuse subsurface term keeps shadowed sides from going
 *    dead black, like light bleeding through cotton
 *
 * Lighting is evaluated against explicit uniforms that mirror the scene's
 * warm key lamp + cool fill, so ropes read consistently under the cinematic
 * grade without paying for full three.js light integration.
 */

export const ropeVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vTangent;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    // approximate tangent along tube (v direction) via screen-space derivative later;
    // pass a stable axis proxy here.
    vTangent = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const ropeFragment = /* glsl */ `
  precision highp float;

  uniform vec3 uColor;
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uFillDir;
  uniform vec3 uFillColor;
  uniform vec3 uAmbient;
  uniform float uTwist;
  uniform float uFuzz;
  uniform float uRoughness;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSelected;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vTangent;
  varying vec3 vWorldPos;

  // hash / value noise
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.,0.));
    float c = hash(i + vec2(0.,1.)), d = hash(i + vec2(1.,1.));
    vec2 u = f*f*(3.-2.*f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }

  // Kajiya-Kay anisotropic strand specular along tangent t
  float strandSpec(vec3 t, vec3 l, vec3 v, float exponent){
    float tl = dot(t, l);
    float tv = dot(t, v);
    float a = sqrt(max(0.0, 1.0 - tl*tl));
    float b = sqrt(max(0.0, 1.0 - tv*tv));
    float d = tl*tv + a*b; // cos of half angle proxy
    return pow(max(0.0, d), exponent);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewDir);

    // reconstruct a per-pixel tangent along the rope from screen derivatives
    vec3 dp = normalize(dFdx(vWorldPos) + dFdy(vWorldPos) * 0.0001);
    vec3 T = normalize(mix(vTangent, dp, 0.85));

    // twisted fibre bands: high-freq along v (uv.y runs along tube)
    float fibre = vnoise(vec2(vUv.x * uTwist, vUv.y * 220.0));
    float strands = 0.6 + 0.4 * sin(vUv.x * uTwist * 6.2831 + fibre * 6.0);

    // perturb normal slightly by fibre so highlights shimmer
    N = normalize(N + T * (fibre - 0.5) * 0.25);

    vec3 albedo = uColor * (0.72 + 0.28 * strands);
    albedo *= (0.9 + 0.1 * fibre);

    // --- key light ---
    vec3 L = normalize(uKeyDir);
    float ndl = max(0.0, dot(N, L));
    // wrapped diffuse (subsurface bleed)
    float wrap = pow(clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0), 1.4);
    vec3 diff = uKeyColor * mix(ndl, wrap, 0.5);

    float shininess = mix(60.0, 8.0, uRoughness);
    float spec = strandSpec(T, L, V, shininess) * (0.6 + 0.4 * strands);

    // --- fill light ---
    vec3 Lf = normalize(uFillDir);
    float ndlf = max(0.0, dot(N, Lf));
    vec3 fill = uFillColor * ndlf * 0.5;

    // fuzz / rim: stray fibres catch grazing light
    float rim = pow(1.0 - max(0.0, dot(N, V)), 2.5);
    float fuzz = rim * uFuzz * (0.4 + 0.6 * fibre);

    vec3 color = albedo * (uAmbient + diff + fill);
    color += uKeyColor * spec * (1.0 - uRoughness * 0.4);
    color += (uKeyColor * 0.5 + uAmbient) * fuzz;

    // selection accent glow
    color += vec3(1.0, 0.25, 0.4) * uSelected * (0.35 + 0.65 * rim);

    // subtle micro-AO in the crevices between strands
    float ao = 0.82 + 0.18 * strands;
    color *= ao;

    gl_FragColor = vec4(color, uOpacity);
    #include <colorspace_fragment>
  }
`;

export interface RopeUniforms {
  color: string;
  twist: number;
  fuzz: number;
  roughness: number;
}

export function createRopeMaterial(u: RopeUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(u.color) },
      uKeyDir: { value: new THREE.Vector3(0.4, 0.8, 0.6).normalize() },
      uKeyColor: { value: new THREE.Color('#ffd9a0') },
      uFillDir: { value: new THREE.Vector3(-0.6, 0.2, 0.5).normalize() },
      uFillColor: { value: new THREE.Color('#6b7fa8') },
      uAmbient: { value: new THREE.Color('#2a2622') },
      uTwist: { value: u.twist },
      uFuzz: { value: u.fuzz },
      uRoughness: { value: u.roughness },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uSelected: { value: 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
  });
}
