import { useMemo, useRef } from 'react';
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { EvidenceItem } from '../types';
import { KIND_SIZES } from '../constants';
import { roundedCardGeometry } from './geometry';
import { useEvidenceTexture } from './useEvidenceTexture';
import { Pin } from './Pin';
import { setAnchor, pinLocalOffset } from './anchors';
import { useBoardStore } from '../store/useBoardStore';
import { useInteraction } from '../store/useInteraction';
import { screenToBoard } from '../interaction/raycast';

interface Props {
  item: EvidenceItem;
}

export function EvidenceObject({ item }: Props) {
  const group = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const texture = useEvidenceTexture(item);

  const { camera, gl } = useThree();

  const size = KIND_SIZES[item.kind] ?? KIND_SIZES.note;
  const aspect = item.imageUrl && item.aspect ? item.aspect : size.w / size.h;
  const [w, h] = useMemo(() => fitToBox(size.w, size.h, aspect), [size.w, size.h, aspect]);

  const geo = useMemo(
    () => roundedCardGeometry(w, h, size.thickness, Math.min(0.14, w * 0.06), 0.06),
    [w, h, size.thickness]
  );

  const frontMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture ?? undefined,
        roughness: item.kind === 'photo' ? 0.35 : 0.82,
        metalness: 0.0,
        color: '#ffffff',
      }),
    [texture, item.kind]
  );

  const sideMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.9 }),
    []
  );

  // Selectors (scoped so unrelated store changes don't re-render this card)
  const selected = useBoardStore((s) => s.selected.has(item.id));
  const hovered = useBoardStore((s) => s.hovered === item.id);
  const tool = useBoardStore((s) => s.tool);
  const connectFrom = useBoardStore((s) => s.connectFrom);

  // Live-updated transform (inertia); starts at data position.
  const render = useRef({
    x: item.position.x,
    y: item.position.y,
    vx: 0,
    vy: 0,
    lift: 0,
    tiltX: 0,
    tiltY: 0,
  });

  // Drag bookkeeping
  const drag = useRef({
    active: false,
    moved: false,
    committed: false,
    offX: 0,
    offY: 0,
    downX: 0,
    downY: 0,
  });

  const store = useBoardStore;
  const interaction = useInteraction;

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return; // left only; middle/right → camera
    e.stopPropagation();
    const s = store.getState();

    if (tool === 'connect') {
      // handled on click/up
      drag.current.downX = e.clientX;
      drag.current.downY = e.clientY;
      return;
    }

    s.bringToFront(item.id);
    const rect = gl.domElement.getBoundingClientRect();
    const p = screenToBoard(e.clientX, e.clientY, rect, camera, item.z);
    if (!p) return;
    drag.current.active = true;
    drag.current.moved = false;
    drag.current.committed = false;
    drag.current.offX = p.x - item.position.x;
    drag.current.offY = p.y - item.position.y;
    drag.current.downX = e.clientX;
    drag.current.downY = e.clientY;

    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
  };

  const onWindowMove = (e: PointerEvent) => {
    if (!drag.current.active) return;
    const rect = gl.domElement.getBoundingClientRect();
    const p = screenToBoard(e.clientX, e.clientY, rect, camera, item.z);
    if (!p) return;
    const dx = e.clientX - drag.current.downX;
    const dy = e.clientY - drag.current.downY;
    if (!drag.current.moved && Math.hypot(dx, dy) > 3) {
      drag.current.moved = true;
      interaction.getState().setDragging(item.id);
    }
    if (drag.current.moved) {
      if (!drag.current.committed) {
        store.getState().commit(); // capture pre-drag state once
        drag.current.committed = true;
      }
      store.getState().moveEvidenceLive(item.id, {
        x: p.x - drag.current.offX,
        y: p.y - drag.current.offY,
      });
    }
  };

  const onWindowUp = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    const wasMoved = drag.current.moved;
    drag.current.active = false;
    interaction.getState().setDragging(null);

    if (!wasMoved) {
      // treat as a click → selection
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const s = store.getState();
      if (additive) s.toggleSelected(item.id);
      else s.setSelected([item.id]);
    }
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const s = store.getState();
    if (tool === 'connect') {
      if (!connectFrom) s.startConnect(item.id);
      else s.completeConnect(item.id);
    }
  };

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    store.getState().setHovered(item.id);
    gl.domElement.style.cursor = tool === 'connect' ? 'crosshair' : 'grab';
  };
  const onPointerOut = () => {
    if (store.getState().hovered === item.id) store.getState().setHovered(null);
    gl.domElement.style.cursor = 'auto';
  };

  const _pinWorld = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    const r = render.current;
    const target = item.position;
    // critically-damped-ish inertia toward the data position
    const k = drag.current.active ? 26 : 14;
    const damp = 2 * Math.sqrt(k);
    const ax = (target.x - r.x) * k - r.vx * damp;
    const ay = (target.y - r.y) * k - r.vy * damp;
    r.vx += ax * dt;
    r.vy += ay * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;

    // velocity-driven tilt (paper leans into motion) + hover lift
    const targetTiltY = THREE.MathUtils.clamp(r.vx * 0.05, -0.28, 0.28);
    const targetTiltX = THREE.MathUtils.clamp(-r.vy * 0.05, -0.28, 0.28);
    const wantLift = (hovered || selected ? 0.55 : 0) + (drag.current.active ? 0.5 : 0);
    r.tiltX += (targetTiltX - r.tiltX) * Math.min(1, dt * 10);
    r.tiltY += (targetTiltY - r.tiltY) * Math.min(1, dt * 10);
    r.lift += (wantLift - r.lift) * Math.min(1, dt * 8);

    if (group.current) {
      group.current.position.set(r.x, r.y, item.z + r.lift);
      group.current.rotation.z = item.rotation;
      group.current.updateMatrixWorld();
    }
    if (tilt.current) {
      tilt.current.rotation.x = r.tiltX;
      tilt.current.rotation.y = r.tiltY;
      // hover scale pop
      const sc = 1 + (hovered || selected ? 0.02 : 0) + r.lift * 0.02;
      tilt.current.scale.setScalar(sc);
    }

    // write live pin anchor for the rope system
    const off = pinLocalOffset(item);
    _pinWorld.current.set(off[0], off[1], off[2]);
    if (group.current) group.current.localToWorld(_pinWorld.current);
    setAnchor(item.id, _pinWorld.current);
  });

  const highlight = selected ? 1 : hovered ? 0.4 : 0;
  const isConnectSource = connectFrom === item.id;

  return (
    <group ref={group}>
      <group ref={tilt}>
        {/* the card body */}
        <mesh
          geometry={geo}
          material={[frontMat, sideMat]}
          castShadow
          receiveShadow
          onPointerDown={onPointerDown}
          onClick={onClick}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        />

        {/* selection / hover outline via a slightly larger additive frame */}
        {highlight > 0 && (
          <mesh geometry={geo} scale={1.02} position={[0, 0, -0.01]}>
            <meshBasicMaterial
              color={selected ? '#ff2d55' : '#ffd9a0'}
              transparent
              opacity={0.28 * highlight + (isConnectSource ? 0.4 : 0)}
              side={THREE.BackSide}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>

      {/* pin sits above the (tilting) card, in card space */}
      <Pin
        color={item.pinColor}
        position={pinLocalOffset(item)}
        gleam={hovered || selected ? 0.6 : 0}
      />
    </group>
  );
}

/** Fit content into the kind's box while respecting the image aspect ratio. */
function fitToBox(boxW: number, boxH: number, aspect: number): [number, number] {
  const boxAspect = boxW / boxH;
  if (aspect > boxAspect) {
    return [boxW, boxW / aspect];
  }
  return [boxH * aspect, boxH];
}
