# Cat Schemer — Three.js grey-box prototype

A small playable vertical slice for a slapstick stealth game about an extremely innocent cat.

## Included

- Camera-relative cat movement
- Three authored semi-fixed camera zones with dead zones, soft follow, blending and doorway hysteresis
- Custom TypeScript circle-vs-AABB collision (no physics dependency)
- Contextual paw action and swipeable props
- Pounce and synthesized meow
- One human NPC with routine, investigation, pursuit and catch/reset states
- Five-step objective loop
- Desktop keyboard and landscape mobile touch controls
- Procedural primitive art; no external assets
- Relative Vite base path, suitable for GitHub Pages builds

## Run

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Production build

```bash
npm run build
npm run preview
```

The built static site is written to `dist/`.

## Controls

| Desktop | Action |
|---|---|
| WASD / arrows | Move |
| Shift | Scamper |
| E | Contextual paw / swipe / steal / act innocent |
| Q | Meow and create a sound stimulus |
| Space | Pounce |

On touch devices, use the virtual stick and three action buttons. Moving the stick near its edge automatically scampers.

## Prototype notes

This deliberately uses a tiny hand-rolled collision layer rather than Rapier. It is appropriate for this controlled grey-box: static axis-aligned walls and furniture, planar cat movement, and a few scripted dynamic props. A production level with arbitrary meshes, stairs, moving platforms, and many interacting rigid bodies is where a dedicated physics/query layer becomes more attractive.

The camera is authored by zone. Each zone provides a fixed composition, a target dead zone, soft follow factors and transition thresholds. Movement is calculated from the camera's current projected forward/right basis, so it remains continuous during camera blends.
