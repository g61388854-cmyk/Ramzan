import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RopeManager } from '../physics/RopeManager';
import { RopeSolver } from '../physics/RopeSolver';
import { RopeTube } from '../physics/RopeTube';
import { createRopeMaterial } from '../physics/ropeShader';
import { ROPE_MATERIALS } from '../constants';
import { useBoardStore } from '../store/useBoardStore';
import { getAnchor, computePinPosition } from './anchors';
import { screenToBoard } from '../interaction/raycast';

/** Drives the physics rope system and the live connect-tool preview thread. */
export function RopeSystem() {
  const getItem = (id: string) => useBoardStore.getState().evidence[id];
  const manager = useMemo(() => new RopeManager(getItem), []);

  useEffect(() => {
    // initial sync + subscribe to connection changes only
    const sync = () => manager.sync(Object.values(useBoardStore.getState().connections));
    sync();
    const unsub = useBoardStore.subscribe((s, prev) => {
      if (s.connections !== prev.connections) sync();
    });
    return () => {
      unsub();
      manager.dispose_all();
    };
  }, [manager]);

  useFrame((state, dt) => {
    const s = useBoardStore.getState();
    manager.setInteractionSets(s.selected, s.hovered);
    manager.update(dt, state.clock.elapsedTime);
  });

  return (
    <>
      <primitive object={manager.group} />
      <ConnectPreview />
    </>
  );
}

/** A glowing thread that grows from the connect source pin toward the cursor. */
function ConnectPreview() {
  const { camera, gl } = useThree();
  const connectFrom = useBoardStore((s) => s.connectFrom);
  const tool = useBoardStore((s) => s.tool);
  const material = useBoardStore((s) => s.ropeMaterial);

  const rig = useMemo(() => {
    const def = ROPE_MATERIALS.evidence;
    const solver = new RopeSolver(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), {
      segments: 24,
      restLength: 1,
      iterations: 5,
      damping: 0.92,
      gravity: 1,
    });
    const tube = new RopeTube(36, 6, def.radius * 1.1);
    const mat = createRopeMaterial({
      color: def.color,
      twist: def.twist,
      fuzz: def.fuzz,
      roughness: def.roughness,
    });
    mat.uniforms.uSelected.value = 0.8;
    const mesh = new THREE.Mesh(tube.geometry, mat);
    mesh.frustumCulled = false;
    return { solver, tube, mat, mesh };
  }, []);

  const cursor = useRef(new THREE.Vector3());
  const active = tool === 'connect' && !!connectFrom;

  useEffect(() => {
    if (!active) return;
    const move = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const p = screenToBoard(e.clientX, e.clientY, rect, camera, 0.4);
      if (p) cursor.current.copy(p);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [active, camera, gl]);

  useFrame((state) => {
    rig.mesh.visible = active;
    if (!active || !connectFrom) return;
    const a = getAnchor(connectFrom) ?? computePinPosition(useBoardStore.getState().evidence[connectFrom]);
    if (!a) return;
    const def = ROPE_MATERIALS[material];
    (rig.mat.uniforms.uColor.value as THREE.Color).set(def.color);
    rig.solver.setAnchors(a, cursor.current);
    rig.solver.setRestLength(Math.max(0.2, a.distanceTo(cursor.current) * (1 + def.slack)));
    rig.solver.wake();
    rig.solver.step(1 / 90, state.clock.elapsedTime);
    rig.tube.update(rig.solver.pos, rig.solver.count, 1);
    rig.mat.uniforms.uOpacity.value = 0.85 + Math.sin(state.clock.elapsedTime * 6) * 0.1;
  });

  return <primitive object={rig.mesh} />;
}
