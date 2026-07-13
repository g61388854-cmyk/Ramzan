import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOARD } from '../constants';
import { useBoardStore } from '../store/useBoardStore';
import { useInteraction } from '../store/useInteraction';
import { screenToBoard } from '../interaction/raycast';

/** A gentle 3/4 view direction — objects stay mostly flat but gain depth. */
const VIEW_DIR = new THREE.Vector3(0.16, 0.1, 1).normalize();

/**
 * Bespoke camera controller — pan, zoom-to-cursor, momentum and idle
 * "breathing", tuned to feel like Figma rather than an orbit toy. Also owns
 * the backdrop (empty-space) interactions: panning and lasso selection.
 */
export function CameraRig() {
  const { camera, gl } = useThree();

  const state = useRef({
    tx: 0,
    ty: 1,
    dist: 34,
    vtx: 0,
    vty: 0,
    activity: 1,
  });

  const pan = useRef<{ active: boolean; startWorld: THREE.Vector3 | null; last: THREE.Vector3 | null }>(
    { active: false, startWorld: null, last: null }
  );

  const lasso = useRef<{ active: boolean; start: THREE.Vector3; cur: THREE.Vector3; additive: boolean }>(
    { active: false, start: new THREE.Vector3(), cur: new THREE.Vector3(), additive: false }
  );
  const lassoMesh = useRef<THREE.Mesh>(null);

  // configure lens once
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 28;
    cam.near = 0.5;
    cam.far = 400;
    cam.updateProjectionMatrix();
  }, [camera]);

  const bump = () => (state.current.activity = 1);

  // wheel zoom (toward cursor)
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      bump();
      const s = state.current;
      const rect = el.getBoundingClientRect();
      const before = screenToBoard(e.clientX, e.clientY, rect, camera, 0);
      const factor = Math.exp(e.deltaY * 0.0016);
      s.dist = THREE.MathUtils.clamp(s.dist * factor, 8, 90);
      if (before) {
        // pull the target toward the cursor so we zoom into what's under it
        const k = 1 - 1 / factor;
        s.tx += (before.x - s.tx) * k * 0.6;
        s.ty += (before.y - s.ty) * k * 0.6;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [camera, gl]);

  const startPan = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const w = screenToBoard(clientX, clientY, rect, camera, 0);
    pan.current.active = true;
    pan.current.startWorld = w;
    pan.current.last = w;
    useInteraction.getState().setLassoing(false);
  };

  const onWindowMove = (e: PointerEvent) => {
    const rect = gl.domElement.getBoundingClientRect();
    if (pan.current.active) {
      const w = screenToBoard(e.clientX, e.clientY, rect, camera, 0);
      if (w && pan.current.last) {
        const s = state.current;
        s.tx -= w.x - pan.current.last.x;
        s.ty -= w.y - pan.current.last.y;
        // recompute last against the *new* camera next frame is overkill;
        // approximate velocity for inertia
        s.vtx = -(w.x - pan.current.last.x);
        s.vty = -(w.y - pan.current.last.y);
        pan.current.last = screenToBoard(e.clientX, e.clientY, rect, camera, 0);
      }
      bump();
    } else if (lasso.current.active) {
      const w = screenToBoard(e.clientX, e.clientY, rect, camera, 0.3);
      if (w) lasso.current.cur.copy(w);
    }
  };

  const onWindowUp = () => {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    pan.current.active = false;
    if (lasso.current.active) {
      finishLasso();
      lasso.current.active = false;
      useInteraction.getState().setLassoing(false);
    }
  };

  const finishLasso = () => {
    const { start, cur, additive } = lasso.current;
    const minX = Math.min(start.x, cur.x);
    const maxX = Math.max(start.x, cur.x);
    const minY = Math.min(start.y, cur.y);
    const maxY = Math.max(start.y, cur.y);
    const store = useBoardStore.getState();
    const picked: string[] = [];
    for (const id of store.order) {
      const it = store.evidence[id];
      if (!it) continue;
      if (it.position.x >= minX && it.position.x <= maxX && it.position.y >= minY && it.position.y <= maxY) {
        picked.push(id);
      }
    }
    if (picked.length) store.setSelected(picked, additive);
    else if (!additive) store.clearSelection();
  };

  // backdrop pointer entry point
  const onBackdropDown = (e: any) => {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const left = e.button === 0;
    const middleOrRight = e.button === 1 || e.button === 2;

    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);

    if (left && additive) {
      // lasso
      const rect = gl.domElement.getBoundingClientRect();
      const w = screenToBoard(e.clientX, e.clientY, rect, camera, 0.3);
      if (w) {
        lasso.current.active = true;
        lasso.current.additive = e.metaKey || e.ctrlKey;
        lasso.current.start.copy(w);
        lasso.current.cur.copy(w);
        useInteraction.getState().setLassoing(true);
      }
    } else if (left || middleOrRight) {
      startPan(e.clientX, e.clientY);
      // click-to-clear happens on up if no movement
      const downX = e.clientX;
      const downY = e.clientY;
      const clearIfClick = (ev: PointerEvent) => {
        window.removeEventListener('pointerup', clearIfClick);
        if (Math.hypot(ev.clientX - downX, ev.clientY - downY) < 3 && left) {
          const st = useBoardStore.getState();
          if (st.tool === 'connect') st.cancelConnect();
          else if (!additive) st.clearSelection();
        }
      };
      window.addEventListener('pointerup', clearIfClick);
    }
  };

  const _desired = useMemo(() => new THREE.Vector3(), []);
  const _target = useMemo(() => new THREE.Vector3(), []);

  useFrame((r, dt) => {
    const s = state.current;

    // pan inertia when released
    if (!pan.current.active) {
      s.tx += s.vtx;
      s.ty += s.vty;
      s.vtx *= 0.9;
      s.vty *= 0.9;
      if (Math.abs(s.vtx) < 1e-4) s.vtx = 0;
      if (Math.abs(s.vty) < 1e-4) s.vty = 0;
    }

    // clamp target to a soft boundary around the board
    const bx = BOARD.width * 0.9;
    const by = BOARD.height * 0.9;
    s.tx = THREE.MathUtils.clamp(s.tx, -bx, bx);
    s.ty = THREE.MathUtils.clamp(s.ty, -by, by);

    // activity decays → breathing fades back in
    s.activity = Math.max(0, s.activity - dt * 0.6);
    const idle = 1 - s.activity;
    const t = r.clock.elapsedTime;
    const breatheX = Math.sin(t * 0.28) * 0.12 * idle;
    const breatheY = Math.cos(t * 0.21) * 0.09 * idle;
    const breatheZ = Math.sin(t * 0.17) * 0.06 * idle;

    _target.set(s.tx, s.ty, 0);
    _desired
      .copy(VIEW_DIR)
      .multiplyScalar(s.dist)
      .add(_target)
      .add(new THREE.Vector3(breatheX, breatheY, breatheZ));

    // smoothed follow (adds a little weight/inertia to zoom + pan)
    camera.position.lerp(_desired, Math.min(1, dt * 9));
    camera.lookAt(_target.x + breatheX * 0.3, _target.y + breatheY * 0.3, 0);

    // update lasso rectangle mesh
    if (lassoMesh.current) {
      const on = lasso.current.active;
      lassoMesh.current.visible = on;
      if (on) {
        const { start, cur } = lasso.current;
        const cx = (start.x + cur.x) / 2;
        const cy = (start.y + cur.y) / 2;
        const wdt = Math.abs(cur.x - start.x) || 0.001;
        const hgt = Math.abs(cur.y - start.y) || 0.001;
        lassoMesh.current.position.set(cx, cy, 0.35);
        lassoMesh.current.scale.set(wdt, hgt, 1);
      }
    }
  });

  return (
    <>
      {/* backdrop: catches empty-space pointer for pan / lasso / clear */}
      <mesh position={[0, 0, -2]} onPointerDown={onBackdropDown}>
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* lasso rectangle */}
      <mesh ref={lassoMesh} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#ff2d55" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </>
  );
}
