import * as THREE from "three";

/**
 * Central art-direction palette. Every model builder pulls colours from here so
 * the cat, the homeowner, the props, and the house read as one illustrated set.
 */
export const PALETTE = {
  sky: 0xd8e2e6,
  grass: 0x7f9a5c,
  grassDark: 0x6b8850,
  soil: 0x6a5340,
  hedge: 0x4f6b41,
  patio: 0xbdb3a2,
  wall: 0xe8dcc8,
  wallShade: 0xd6c7ae,
  skirting: 0xf3ece0,
  woodFloor: 0xb98d5f,
  woodFloorDark: 0xa2764c,
  tile: 0xe4e0d4,
  tileGrout: 0xc4bdad,
  rug: 0xa8556a,
  rugTrim: 0xe3d3b8,
  counter: 0xdcd6c6,
  counterWood: 0x8d6a4a,
  cabinet: 0xcfd9d2,
  cabinetTrim: 0xb7c4bb,
  fridge: 0xdfe4e4,
  steel: 0xa9b0b3,
  brass: 0xc8a24a,
  furWarm: 0x8f6044,
  furDark: 0x50372e,
  furCream: 0xe2d3b5,
  nose: 0xc98c92,
  eye: 0xb8ad52,
  skin: 0xc98f6a,
  hair: 0x40342b,
  shirt: 0x5d7f7c,
  trousers: 0x4a4a55,
  ceramicRed: 0xc94f3d,
  ceramicBlue: 0x4f7f95,
  ceramicCream: 0xefe6d2,
  fruit: 0xd9a13c,
  cardboard: 0xb08453,
  cardboardDark: 0x8e6941,
  plantPot: 0xb0674c,
  leaf: 0x54734d,
  water: 0x6fb4cd,
  flour: 0xf6f0e2,
} as const;

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export interface SurfaceOptions {
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  vertexColors?: boolean;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  /** Transparent overlays default to false to avoid sorting against their own depth. */
  depthWrite?: boolean;
  map?: THREE.Texture | null;
  side?: THREE.Side;
}

/**
 * Shared, cached standard material. Reusing instances keeps draw-call batching
 * predictable and lets the debug overlay count unique surfaces meaningfully.
 */
export function surface(color: number, options: SurfaceOptions = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${JSON.stringify(options)}|${options.map?.uuid ?? ""}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const transparent = options.transparent ?? false;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.85,
    metalness: options.metalness ?? 0,
    flatShading: options.flatShading ?? false,
    vertexColors: options.vertexColors ?? false,
    transparent,
    opacity: options.opacity ?? 1,
    // Depth-writing translucent planes are especially prone to flicker where
    // puddle blobs, window glass, and the light shaft overlap. Keep depth
    // testing, but let opaque geometry own the depth buffer.
    depthWrite: options.depthWrite ?? !transparent,
    side: options.side ?? THREE.FrontSide,
  });
  if (options.map) material.map = options.map;
  if (options.emissive !== undefined) {
    material.emissive = new THREE.Color(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  materialCache.set(key, material);
  return material;
}

/** True when procedural canvas textures can be generated (browser only). */
export function canGenerateTextures(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

const textureCache = new Map<string, THREE.Texture | null>();

function makeTexture(
  key: string,
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
  repeat: readonly [number, number],
): THREE.Texture | null {
  if (textureCache.has(key)) return textureCache.get(key) ?? null;
  if (!canGenerateTextures()) {
    textureCache.set(key, null);
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    textureCache.set(key, null);
    return null;
  }
  draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Explicit trilinear mip filtering keeps high-frequency floor and plaster
  // patterns from shimmering as the diorama camera moves. WebGLRenderer clamps
  // anisotropy to the GPU's supported maximum.
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  textureCache.set(key, texture);
  return texture;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Warm floorboards with visible plank seams and grain streaks. */
export function woodFloorTexture(repeat: readonly [number, number] = [6, 12]): THREE.Texture | null {
  return makeTexture("wood-floor", 256, (context, size) => {
    context.fillStyle = hex(PALETTE.woodFloor);
    context.fillRect(0, 0, size, size);
    const plankHeight = size / 8;
    for (let row = 0; row < 8; row += 1) {
      const shade = 0.86 + ((row * 37) % 11) / 40;
      context.fillStyle = `rgba(120, 84, 50, ${0.1 + ((row * 13) % 7) / 40})`;
      context.fillRect(0, row * plankHeight, size, plankHeight);
      context.globalAlpha = 0.5 * shade;
      for (let grain = 0; grain < 14; grain += 1) {
        const y = row * plankHeight + ((grain * 61) % plankHeight);
        context.strokeStyle = `rgba(93, 63, 38, ${0.06 + ((grain * 17) % 5) / 60})`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, y);
        context.bezierCurveTo(size * 0.3, y + 2, size * 0.7, y - 2, size, y);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.strokeStyle = "rgba(70, 46, 27, 0.42)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, row * plankHeight);
      context.lineTo(size, row * plankHeight);
      context.stroke();
      const seam = ((row * 97) % size);
      context.beginPath();
      context.moveTo(seam, row * plankHeight);
      context.lineTo(seam, (row + 1) * plankHeight);
      context.stroke();
    }
  }, repeat);
}

/** Square kitchen tiles with grout lines and a faint speckle. */
export function tileTexture(repeat: readonly [number, number] = [8, 12]): THREE.Texture | null {
  return makeTexture("tile", 256, (context, size) => {
    context.fillStyle = hex(PALETTE.tileGrout);
    context.fillRect(0, 0, size, size);
    const cell = size / 4;
    for (let x = 0; x < 4; x += 1) {
      for (let y = 0; y < 4; y += 1) {
        const tint = 226 + ((x * 5 + y * 3) % 9);
        context.fillStyle = `rgb(${tint}, ${tint - 4}, ${tint - 16})`;
        context.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
      }
    }
    for (let speckle = 0; speckle < 900; speckle += 1) {
      const x = (speckle * 71) % size;
      const y = (speckle * 137) % size;
      context.fillStyle = `rgba(150, 143, 128, ${((speckle * 7) % 9) / 90})`;
      context.fillRect(x, y, 1, 1);
    }
  }, repeat);
}

/** Mown lawn: base green plus lighter and darker clumps. */
export function grassTexture(repeat: readonly [number, number] = [7, 10]): THREE.Texture | null {
  return makeTexture("grass", 256, (context, size) => {
    context.fillStyle = hex(PALETTE.grass);
    context.fillRect(0, 0, size, size);
    for (let blade = 0; blade < 2600; blade += 1) {
      const x = (blade * 53) % size;
      const y = (blade * 173) % size;
      const dark = (blade % 3) === 0;
      context.strokeStyle = dark ? "rgba(84, 108, 62, 0.5)" : "rgba(158, 178, 112, 0.45)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + ((blade % 5) - 2), y - 3 - (blade % 3));
      context.stroke();
    }
  }, repeat);
}

/** Painted plaster with a soft roller mottle. */
export function plasterTexture(repeat: readonly [number, number] = [3, 2]): THREE.Texture | null {
  return makeTexture("plaster", 128, (context, size) => {
    context.fillStyle = hex(PALETTE.wall);
    context.fillRect(0, 0, size, size);
    for (let blot = 0; blot < 700; blot += 1) {
      const x = (blot * 41) % size;
      const y = (blot * 91) % size;
      const radius = 1 + (blot % 3);
      context.fillStyle = `rgba(198, 182, 155, ${0.03 + ((blot * 3) % 6) / 120})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }, repeat);
}

/** Disposes every cached material and texture. Used by the model viewer. */
export function disposeSharedResources(): void {
  for (const material of materialCache.values()) material.dispose();
  materialCache.clear();
  for (const texture of textureCache.values()) texture?.dispose();
  textureCache.clear();
}
