# The Evidence Board

An immersive, cinematic **3D investigation board** built with React Three Fiber,
WebGL and custom GLSL. Think Miro × an FBI cork-board × Unreal-grade interaction:
every object is a real 3D thing, and the red evidence strings are **physically
simulated ropes**, not SVG lines.

<p align="center"><em>Pin evidence · run physical threads · follow the connections.</em></p>

## Highlights

- **Physically-simulated evidence strings** — the centerpiece. Each connection is
  a Verlet rope of point masses + distance constraints that sags, stretches,
  swings, whips on a fast drag, and settles naturally. Endpoints are *soft-pinned*
  to the pins so ropes lag and overshoot instead of snapping. Rendered as smooth,
  variable-thickness procedural tube geometry with a custom yarn/fibre shader
  (anisotropic strand highlights, fuzz, wrapped-diffuse subsurface).
- **True 3D corkboard** — beveled wooden frame, recessed cork surface, procedural
  cork grain + roughness, baked-look contact shadows.
- **Evidence as 3D objects** — photos, documents, suspect cards, maps, newspaper
  clippings, fingerprints, sticky & field notes. Real thickness, rounded/beveled
  corners, paper curl, drop shadows. All textures are drawn procedurally on
  `<canvas>` (zero binary assets) or supplied by uploads.
- **PBR push-pins** — glossy enamel head, metallic collar + steel shaft,
  clearcoat, tight speculars, bloom.
- **Bespoke camera** — perspective at a gentle 3/4 angle with a low FOV; Figma-like
  pan, zoom-to-cursor, momentum, and idle "breathing".
- **Full interaction** — drag with inertia + velocity tilt, hover lift, selection
  glow, ⇧-drag lasso, duplicate, delete, connect tool with a live rubber-band
  thread that grows across the board.
- **Undo / redo** for everything (moves, connects, cuts, edits, pin changes).
- **Cinematic post** — bloom, filmic vignette, depth-of-field that deepens in
  motion, contrast/saturation grade, film grain, floating dust motes.
- **Upload** — drag & drop or pick PNG / JPEG / WEBP / GIF (first frame) / PDF.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build
npm run preview
```

## Controls

| Action | Input |
| --- | --- |
| Pan | drag empty space · middle/right drag |
| Zoom | scroll (toward cursor) |
| Move item | drag it |
| Select | click · ⇧-click to add · ⇧-drag empty space to lasso |
| Connect | `C`, click item A, click item B |
| Select / Pan / Connect tools | `V` / `H` / `C` |
| Undo · Redo | `⌘/Ctrl+Z` · `⌘/Ctrl+Shift+Z` |
| Duplicate · Select all · Delete | `⌘/Ctrl+D` · `⌘/Ctrl+A` · `Del` |

## Architecture

Decoupled, documented modules:

```
src/
  types.ts                 Serializable domain model (nodes + edges + metadata)
  constants.ts             Board dims, kind sizes, rope-material presets, theme
  store/
    useBoardStore.ts       Zustand: evidence, connections, selection, tools,
                           snapshot-based undo/redo
    useInteraction.ts      Ephemeral high-frequency pointer state (no re-renders)
    seed.ts                Opening case so the board loads "alive"
  physics/
    RopeSolver.ts          Verlet integration + constraint relaxation + sleeping
    RopeTube.ts            Live parallel-transport tube mesh (no per-frame allocs)
    ropeShader.ts          Custom GLSL yarn material
    RopeManager.ts         Owns every rope's sim + mesh; grow/relax animation, LOD
  three/
    Scene.tsx              Assembles the world + local lightformer reflections
    Corkboard.tsx          3D frame + cork surface
    Lighting.tsx           Warm key lamp / cool fill / rim, subtle flicker
    CameraRig.tsx          Custom pan/zoom/inertia/breathing + backdrop + lasso
    EvidenceObject.tsx     3D card: drag inertia, hover, selection, anchor write
    EvidenceLayer.tsx      Per-id subscribers so one card never re-renders others
    Pin.tsx                PBR push-pin
    anchors.ts             Live pin-position registry bridging cards ↔ ropes
    textures.ts            Procedural canvas textures per evidence kind
    geometry.ts            Rounded/beveled card geometry with paper curl
    useEvidenceTexture.ts  Async upload textures + procedural fallbacks
    Dust.tsx               GPU dust motes
    Effects.tsx            Post-processing stack
  interaction/raycast.ts   Screen → board-plane projection
  upload/uploadManager.ts  Files → evidence (image/GIF-first-frame/PDF)
  ui/                      Toolbar, Inspector, History, Dropzone, HUD, Intro
  hooks/useKeyboard.ts     Global shortcuts
```

### How the ropes stay in sync

Evidence objects render with inertia — the mesh lags the data position during a
drag. So instead of routing high-frequency positions through React/Zustand, each
card writes its **live pin world-position** into an anchor registry every frame,
and the rope system reads from it. Physics therefore tracks exactly what's on
screen, and the store only records committed moves (for undo).

### Performance

Fixed-timestep stepping with clamped substeps; per-rope **sleeping** (idle ropes
skip integration entirely); adaptive segment/tube LOD by rope count; geometry
buffers written in place; per-id React subscriptions. Targets a smooth 60–144 FPS
with hundreds of ropes.

### Built for future AI reasoning

The graph is fully serializable and every edge carries `label`, `strength`,
`annotations` and a freeform `metadata` bag — enough for a future agent to
auto-connect evidence, surface clusters, flag conflicts, or build a timeline.
