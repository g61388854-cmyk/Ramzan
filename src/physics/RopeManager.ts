import * as THREE from 'three';
import gsap from 'gsap';
import { RopeSolver } from './RopeSolver';
import { RopeTube } from './RopeTube';
import { createRopeMaterial } from './ropeShader';
import { ROPE_MATERIALS } from '../constants';
import type { Connection, EvidenceItem } from '../types';
import { getAnchor, computePinPosition } from '../three/anchors';

interface RopeInstance {
  conn: Connection;
  solver: RopeSolver;
  tube: RopeTube;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  segments: number;
  /** 0..1 animated: how far the thread has been "pulled" from A to B */
  grow: number;
  opacity: number;
  radiusScale: number;
  slackBase: number;
  dying: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _bAnim = new THREE.Vector3();

/**
 * Owns every rope's simulation + mesh. Decoupled from React: the component
 * layer only tells it which connections exist and who is selected/hovered.
 *
 * - Creating a connection grows the thread from pin A toward pin B (GSAP).
 * - Removing one relaxes + fades it before disposal.
 * - Fixed-timestep Verlet stepping with per-rope sleeping keeps hundreds of
 *   ropes cheap; sleeping ropes skip integration entirely.
 */
export class RopeManager {
  readonly group = new THREE.Group();
  private ropes = new Map<string, RopeInstance>();
  private getItem: (id: string) => EvidenceItem | undefined;
  private accumulator = 0;
  private readonly fixedDt = 1 / 90;

  private selected = new Set<string>();
  private hovered: string | null = null;

  constructor(getItem: (id: string) => EvidenceItem | undefined) {
    this.getItem = getItem;
    this.group.name = 'RopeSystem';
  }

  setInteractionSets(selected: Set<string>, hovered: string | null) {
    this.selected = selected;
    this.hovered = hovered;
  }

  private lodFor(total: number): { tubular: number; radial: number } {
    if (total < 30) return { tubular: 52, radial: 9 };
    if (total < 90) return { tubular: 38, radial: 7 };
    if (total < 200) return { tubular: 28, radial: 6 };
    return { tubular: 20, radial: 5 };
  }

  /** Reconcile the live rope set with the store's connections. */
  sync(connections: Connection[]) {
    const alive = new Set(connections.map((c) => c.id));

    // remove ropes whose connection is gone
    for (const [id, inst] of this.ropes) {
      if (!alive.has(id) && !inst.dying) this.beginRemoval(id, inst);
    }

    const total = connections.length;
    for (const conn of connections) {
      const existing = this.ropes.get(conn.id);
      if (existing) {
        existing.conn = conn;
        this.applyMaterial(existing, conn);
      } else {
        this.create(conn, total);
      }
    }
  }

  private endpoints(conn: Connection): [THREE.Vector3, THREE.Vector3] | null {
    const a = getAnchor(conn.from) ?? this.fallback(conn.from);
    const b = getAnchor(conn.to) ?? this.fallback(conn.to);
    if (!a || !b) return null;
    return [a, b];
  }

  private fallback(id: string): THREE.Vector3 | null {
    const item = this.getItem(id);
    if (!item) return null;
    return computePinPosition(item);
  }

  private create(conn: Connection, total: number) {
    const ends = this.endpoints(conn);
    if (!ends) return;
    _a.copy(ends[0]);
    _b.copy(ends[1]);

    const def = ROPE_MATERIALS[conn.material];
    const straight = _a.distanceTo(_b);
    const restLength = straight * (1 + def.slack);
    const { tubular, radial } = this.lodFor(total);
    const segments = Math.max(14, Math.min(48, Math.round(straight * 3)));

    const solver = new RopeSolver(_a, _b, {
      segments,
      restLength,
      iterations: 6,
      damping: 0.94,
      gravity: 1,
    });
    const tube = new RopeTube(tubular, radial, def.radius);
    const material = createRopeMaterial({
      color: def.color,
      twist: def.twist,
      fuzz: def.fuzz,
      roughness: def.roughness,
    });
    material.uniforms.uOpacity.value = 0;

    const mesh = new THREE.Mesh(tube.geometry, material);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    const inst: RopeInstance = {
      conn,
      solver,
      tube,
      material,
      mesh,
      segments,
      grow: 0,
      opacity: 0,
      radiusScale: 0.6 + conn.strength * 0.8,
      slackBase: def.slack,
      dying: false,
    };
    this.ropes.set(conn.id, inst);

    // grow the thread from A toward B, then fade in as it lands
    gsap.to(inst, {
      grow: 1,
      duration: 0.65,
      ease: 'power3.out',
    });
    gsap.to(inst, { opacity: 1, duration: 0.4, ease: 'power2.out' });
  }

  private applyMaterial(inst: RopeInstance, conn: Connection) {
    const def = ROPE_MATERIALS[conn.material];
    (inst.material.uniforms.uColor.value as THREE.Color).set(def.color);
    inst.material.uniforms.uTwist.value = def.twist;
    inst.material.uniforms.uFuzz.value = def.fuzz;
    inst.material.uniforms.uRoughness.value = def.roughness;
    inst.radiusScale = 0.6 + conn.strength * 0.8;
    inst.slackBase = def.slack;
  }

  private beginRemoval(id: string, inst: RopeInstance) {
    inst.dying = true;
    // relax: add slack so it droops, then fade + shrink
    gsap.to(inst, { slackBase: inst.slackBase + 0.25, duration: 0.5, ease: 'power1.in' });
    gsap.to(inst, {
      opacity: 0,
      grow: 0.85,
      duration: 0.55,
      ease: 'power2.in',
      onComplete: () => this.dispose(id),
    });
  }

  private dispose(id: string) {
    const inst = this.ropes.get(id);
    if (!inst) return;
    this.group.remove(inst.mesh);
    inst.tube.dispose();
    inst.material.dispose();
    this.ropes.delete(id);
  }

  /** Advance all ropes. Called once per frame with the real frame delta. */
  update(dt: number, elapsed: number) {
    // fixed timestep with clamped substeps to stay stable under load
    this.accumulator += Math.min(dt, 0.05);
    let steps = 0;
    const doStep = this.accumulator >= this.fixedDt;
    while (this.accumulator >= this.fixedDt && steps < 4) {
      this.accumulator -= this.fixedDt;
      steps++;
      for (const inst of this.ropes.values()) {
        const ends = this.endpoints(inst.conn);
        if (!ends) continue;
        _a.copy(ends[0]);
        _b.copy(ends[1]);
        // animate anchor B out from A as the thread grows
        _bAnim.copy(_a).lerp(_b, inst.grow);
        inst.solver.setAnchors(_a, _bAnim);
        const straight = _a.distanceTo(_bAnim);
        inst.solver.setRestLength(Math.max(0.1, straight * (1 + inst.slackBase)));
        inst.solver.step(this.fixedDt, elapsed);
      }
    }

    // update geometry + uniforms every frame regardless (cheap when asleep)
    for (const inst of this.ropes.values()) {
      const sel =
        this.selected.has(inst.conn.from) || this.selected.has(inst.conn.to) ? 1 : 0;
      const hov =
        this.hovered === inst.conn.from || this.hovered === inst.conn.to ? 1 : 0;
      const tension = 1 + hov * 0.15 + sel * 0.1;

      inst.material.uniforms.uOpacity.value = inst.opacity;
      inst.material.uniforms.uSelected.value = Math.max(sel, hov * 0.5);
      inst.material.uniforms.uTime.value = elapsed;

      if (doStep || inst.grow < 1 || sel || hov) {
        inst.tube.update(inst.solver.pos, inst.solver.count, inst.radiusScale * tension);
      }
    }
  }

  dispose_all() {
    for (const id of Array.from(this.ropes.keys())) this.dispose(id);
  }
}
