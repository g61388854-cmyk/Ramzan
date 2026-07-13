import * as THREE from 'three';

/**
 * RopeTube — builds and live-updates a smooth, variable-thickness tube mesh
 * from a set of simulated rope particles.
 *
 * We do NOT use TubeGeometry(Curve) rebuilds (they allocate every frame).
 * Instead we allocate once for a fixed topology and rewrite the position &
 * normal buffers in place each frame using parallel-transport frames — this
 * keeps the tube from twisting unnaturally as the rope swings.
 *
 * The centreline is a Catmull-Rom resample of the physics particles, so a
 * cheap 24-particle rope still renders as a silky ~120-sample tube.
 */
export class RopeTube {
  readonly geometry: THREE.BufferGeometry;
  private readonly tubular: number;
  private readonly radial: number;
  private readonly baseRadius: number;

  private samples: THREE.Vector3[] = [];
  private positions: Float32Array;
  private normals: Float32Array;
  private uvs: Float32Array;

  private _curve = new THREE.CatmullRomCurve3([], false, 'catmullrom', 0.4);
  private _T = new THREE.Vector3();
  private _N = new THREE.Vector3();
  private _B = new THREE.Vector3();
  private _prevN = new THREE.Vector3();
  private _tmp = new THREE.Vector3();
  private _p = new THREE.Vector3();

  constructor(tubularSegments: number, radialSegments: number, baseRadius: number) {
    this.tubular = tubularSegments;
    this.radial = radialSegments;
    this.baseRadius = baseRadius;

    const rows = tubularSegments + 1;
    const cols = radialSegments + 1;
    const vertCount = rows * cols;

    this.positions = new Float32Array(vertCount * 3);
    this.normals = new Float32Array(vertCount * 3);
    this.uvs = new Float32Array(vertCount * 2);

    for (let i = 0; i < rows; i++) this.samples.push(new THREE.Vector3());

    const indices: number[] = [];
    for (let i = 0; i < tubularSegments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * cols + j;
        const b = (i + 1) * cols + j;
        const c = (i + 1) * cols + (j + 1);
        const d = i * cols + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }

    // static UVs (v runs along tube for fibre shading)
    for (let i = 0; i < rows; i++) {
      const v = i / tubularSegments;
      for (let j = 0; j < cols; j++) {
        const u = j / radialSegments;
        const idx = (i * cols + j) * 2;
        this.uvs[idx] = u;
        this.uvs[idx + 1] = v;
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    g.setIndex(indices);
    this.geometry = g;
  }

  /**
   * Update the tube from raw particle positions.
   * @param particles flat xyz array, length = (segments+1)*3
   * @param particleCount number of particles
   * @param radiusScale overall thickness multiplier (e.g. hover tension)
   */
  update(particles: Float32Array, particleCount: number, radiusScale = 1) {
    // Build the smoothing curve from particles.
    const pts = this._curve.points;
    pts.length = 0;
    for (let i = 0; i < particleCount; i++) {
      pts.push(new THREE.Vector3(particles[i * 3], particles[i * 3 + 1], particles[i * 3 + 2]));
    }
    this._curve.updateArcLengths();

    const rows = this.tubular + 1;
    const cols = this.radial + 1;

    // Resample centreline.
    for (let i = 0; i < rows; i++) {
      this._curve.getPoint(i / this.tubular, this.samples[i]);
    }

    // Parallel-transport frame to avoid twist popping.
    this._prevN.set(0, 0, 0);
    for (let i = 0; i < rows; i++) {
      const cur = this.samples[i];
      const next = this.samples[Math.min(i + 1, rows - 1)];
      const prev = this.samples[Math.max(i - 1, 0)];
      this._T.subVectors(next, prev).normalize();
      if (this._T.lengthSq() < 1e-8) this._T.set(0, 0, 1);

      if (i === 0) {
        // seed an initial normal perpendicular to tangent
        this._N.set(-this._T.y, this._T.x, 0);
        if (this._N.lengthSq() < 1e-6) this._N.set(0, 1, 0);
        this._N.normalize();
      } else {
        // rotate previous normal to be perpendicular to new tangent
        this._N.copy(this._prevN);
        this._tmp.copy(this._T).multiplyScalar(this._N.dot(this._T));
        this._N.sub(this._tmp).normalize();
        if (this._N.lengthSq() < 1e-6) {
          this._N.set(-this._T.y, this._T.x, 0).normalize();
        }
      }
      this._B.crossVectors(this._T, this._N).normalize();
      this._prevN.copy(this._N);

      // variable radius: taper at the ends, gentle bulge from micro noise
      const t = i / this.tubular;
      const taper = Math.pow(Math.sin(t * Math.PI), 0.35);
      const noise = 0.88 + 0.12 * Math.sin(t * 40 + cur.x * 3.0);
      const r = this.baseRadius * radiusScale * (0.35 + 0.65 * taper) * noise;

      for (let j = 0; j < cols; j++) {
        const ang = (j / this.radial) * Math.PI * 2;
        const cx = Math.cos(ang);
        const sy = Math.sin(ang);
        this._p.set(
          cur.x + (this._N.x * cx + this._B.x * sy) * r,
          cur.y + (this._N.y * cx + this._B.y * sy) * r,
          cur.z + (this._N.z * cx + this._B.z * sy) * r
        );
        const vi = (i * cols + j) * 3;
        this.positions[vi] = this._p.x;
        this.positions[vi + 1] = this._p.y;
        this.positions[vi + 2] = this._p.z;
        // normal points outward from centreline
        this.normals[vi] = this._N.x * cx + this._B.x * sy;
        this.normals[vi + 1] = this._N.y * cx + this._B.y * sy;
        this.normals[vi + 2] = this._N.z * cx + this._B.z * sy;
      }
    }

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.geometry.dispose();
  }
}
