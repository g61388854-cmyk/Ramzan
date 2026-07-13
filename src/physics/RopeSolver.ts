import * as THREE from 'three';

/**
 * RopeSolver — a production-grade Verlet rope simulation.
 *
 * Each rope is a chain of point masses connected by distance constraints.
 * We integrate with position-Verlet (implicit velocity via x - xPrev), then
 * relax the constraints over several iterations to keep the rope inextensible
 * while still allowing sag, swing, whip and settle.
 *
 * Design goals:
 *  - Endpoints are *soft-pinned* to their anchors (the two evidence pins) so a
 *    fast drag makes the rope lag, stretch, whip and overshoot rather than snap.
 *  - The rope sleeps when its kinetic energy stays below a threshold, so a board
 *    with hundreds of ropes costs almost nothing at rest (adaptive cost).
 *  - Deterministic, allocation-free stepping in the hot loop.
 */

const GRAVITY = new THREE.Vector3(0, -9.6, 0);

export interface RopeSolverOptions {
  segments: number;
  /** rest length of the whole rope (straight distance * (1 + slack)) */
  restLength: number;
  /** constraint stiffness iterations */
  iterations: number;
  /** velocity damping per step (0..1, closer to 1 = less damping) */
  damping: number;
  /** gravity scale */
  gravity: number;
}

export class RopeSolver {
  readonly count: number;
  readonly pos: Float32Array; // xyz per particle (current)
  readonly prev: Float32Array; // xyz per particle (previous)
  readonly segRest: number; // rest length per segment

  private opts: RopeSolverOptions;
  private anchorA = new THREE.Vector3();
  private anchorB = new THREE.Vector3();

  /** running estimate of kinetic energy for sleep logic */
  energy = 1;
  asleep = false;

  private _v = new THREE.Vector3();
  private _d = new THREE.Vector3();

  constructor(a: THREE.Vector3, b: THREE.Vector3, opts: RopeSolverOptions) {
    this.opts = opts;
    this.count = opts.segments + 1;
    this.pos = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);
    this.segRest = opts.restLength / opts.segments;
    this.anchorA.copy(a);
    this.anchorB.copy(b);
    this.reset(a, b);
  }

  /** Lay the rope out along a slack catenary-ish arc between the two anchors. */
  reset(a: THREE.Vector3, b: THREE.Vector3) {
    const n = this.count - 1;
    const sag = this.opts.restLength - a.distanceTo(b);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      // parabolic droop, strongest in the middle
      const droop = -Math.sin(t * Math.PI) * Math.max(0, sag) * 0.5;
      const j = i * 3;
      this.pos[j] = x;
      this.pos[j + 1] = y + droop;
      this.pos[j + 2] = z;
      this.prev[j] = this.pos[j];
      this.prev[j + 1] = this.pos[j + 1];
      this.prev[j + 2] = this.pos[j + 2];
    }
    this.energy = 1;
    this.asleep = false;
  }

  setRestLength(rest: number) {
    this.opts.restLength = rest;
  }

  /** Update anchor targets (called whenever an evidence item moves). */
  setAnchors(a: THREE.Vector3, b: THREE.Vector3) {
    // A meaningful anchor move wakes the rope.
    if (this.asleep) {
      if (
        this.anchorA.distanceToSquared(a) > 1e-6 ||
        this.anchorB.distanceToSquared(b) > 1e-6
      ) {
        this.wake();
      }
    }
    this.anchorA.copy(a);
    this.anchorB.copy(b);
  }

  wake() {
    this.asleep = false;
    this.energy = Math.max(this.energy, 0.2);
  }

  /**
   * Advance the simulation by one fixed step.
   * @param dt fixed timestep (seconds)
   * @param windPhase global time used for a tiny ambient sway
   */
  step(dt: number, windPhase: number) {
    if (this.asleep) {
      // Still keep endpoints glued so a woken neighbour reads correct anchors.
      this.pinEndpoints();
      return;
    }

    const { damping, iterations } = this.opts;
    const g = GRAVITY.y * this.opts.gravity;
    const n = this.count;
    const dt2 = dt * dt;

    // A faint ambient breeze so idle ropes have life (very small).
    const windX = Math.sin(windPhase * 0.7) * 0.06;
    const windZ = Math.cos(windPhase * 0.9) * 0.04;

    // Integrate (Verlet)
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const px = this.pos[j];
      const py = this.pos[j + 1];
      const pz = this.pos[j + 2];

      let vx = (px - this.prev[j]) * damping;
      let vy = (py - this.prev[j + 1]) * damping;
      let vz = (pz - this.prev[j + 2]) * damping;

      // per-particle mass-ish weighting: middle sways most
      const sway = Math.sin((i / (n - 1)) * Math.PI);
      vx += windX * sway * dt;
      vz += windZ * sway * dt;

      this.prev[j] = px;
      this.prev[j + 1] = py;
      this.prev[j + 2] = pz;

      this.pos[j] = px + vx + 0; // x accel from wind already in v
      this.pos[j + 1] = py + vy + g * dt2;
      this.pos[j + 2] = pz + vz;
    }

    // Satisfy constraints
    const rest = this.segRest;
    for (let k = 0; k < iterations; k++) {
      this.pinEndpoints();
      for (let i = 0; i < n - 1; i++) {
        const a = i * 3;
        const b = (i + 1) * 3;
        this._d.set(
          this.pos[b] - this.pos[a],
          this.pos[b + 1] - this.pos[a + 1],
          this.pos[b + 2] - this.pos[a + 2]
        );
        const dist = this._d.length() || 1e-5;
        // Allow slight stretch beyond rest for a springy feel, but resist a lot.
        const diff = (dist - rest) / dist;
        const sx = this._d.x * 0.5 * diff;
        const sy = this._d.y * 0.5 * diff;
        const sz = this._d.z * 0.5 * diff;
        // endpoints are heavier (soft-pinned), so weight interior more
        const wA = i === 0 ? 0.15 : 0.5;
        const wB = i === n - 2 ? 0.15 : 0.5;
        this.pos[a] += sx * (wA * 2);
        this.pos[a + 1] += sy * (wA * 2);
        this.pos[a + 2] += sz * (wA * 2);
        this.pos[b] -= sx * (wB * 2);
        this.pos[b + 1] -= sy * (wB * 2);
        this.pos[b + 2] -= sz * (wB * 2);
      }
    }
    this.pinEndpoints();

    // Kinetic-energy estimate for sleep logic.
    let e = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      this._v.set(
        this.pos[j] - this.prev[j],
        this.pos[j + 1] - this.prev[j + 1],
        this.pos[j + 2] - this.prev[j + 2]
      );
      e += this._v.lengthSq();
    }
    // Exponential moving average smooths flicker at the sleep boundary.
    this.energy = this.energy * 0.9 + e * 0.1;
    if (this.energy < 1e-5) {
      this.asleep = true;
    }
  }

  /** Soft-pin: pull endpoints toward anchors strongly but not infinitely,
   *  which produces the characteristic lag / whip on fast drags. */
  private pinEndpoints() {
    const last = (this.count - 1) * 3;
    // strong critically-damped-ish attraction toward the anchor
    const k = 0.6;
    this.pos[0] += (this.anchorA.x - this.pos[0]) * k;
    this.pos[1] += (this.anchorA.y - this.pos[1]) * k;
    this.pos[2] += (this.anchorA.z - this.pos[2]) * k;
    this.pos[last] += (this.anchorB.x - this.pos[last]) * k;
    this.pos[last + 1] += (this.anchorB.y - this.pos[last + 1]) * k;
    this.pos[last + 2] += (this.anchorB.z - this.pos[last + 2]) * k;
  }

  /** Write current particle positions into a flat target array (for geometry). */
  writePositions(target: Float32Array) {
    target.set(this.pos);
  }
}
