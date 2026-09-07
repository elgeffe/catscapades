import * as THREE from "three";

/**
 * Homeowner surfaces.
 *
 * The homeowner used to be assembled from capsules: a rounded pelvis, a barrel
 * chest, a separate collar ring, and four limbs stuck on as free-floating
 * capsules with balls for hands. Every one of those joins is a visible
 * intersection, and together they are exactly what makes a figure read as a
 * shop mannequin rather than a person.
 *
 * These builders replace them with continuous lofted surfaces along the limb
 * or torso axis, skinned to the joints that already exist. Clothing then spans
 * its joins instead of meeting at one: a shirt runs from hem to collar over a
 * real shoulder yoke, a sleeve runs from that yoke to the wrist, and a trouser
 * leg runs from the seat to the ankle. The silhouette is authored in the
 * section profiles, so proportions are changed by editing numbers rather than
 * by rescaling intersecting primitives.
 *
 * Lofts here run along **Y**, unlike the cat's, which run along Z. A biped and
 * a quadruped disagree about which way a body points, and forcing one builder
 * to serve both would obscure both profiles.
 */

export interface OwnerSection {
  /** Position along the loft axis, in the mesh's own space. */
  readonly at: number;
  /** Half-extent across the body. */
  readonly halfWidth: number;
  /** Half-extent front to back. */
  readonly halfDepth: number;
  /** Lateral offset of this section's centre. */
  readonly offsetX?: number;
  /** Front-to-back offset of this section's centre, for a chest or a seat. */
  readonly offsetZ?: number;
  /**
   * Flattens the back of the section, 0..1. A clothed human back is nearly
   * planar; a fully elliptical torso reads as a barrel.
   */
  readonly flatBack?: number;
}

/** Which bones a section's vertices follow, and how strongly. */
export type OwnerSkinSampler = (at: number) => {
  readonly indices: readonly [number, number, number, number];
  readonly weights: readonly [number, number, number, number];
};

interface LoftOptions {
  readonly radialSegments?: number;
  /** Skin binding. Omit for a rigid mesh. */
  readonly skinAt?: OwnerSkinSampler;
  /** Close the low end with a cap. Open ends are for surfaces that meet another. */
  readonly capStart?: boolean;
  readonly capEnd?: boolean;
  /** Insert a smoothed midsection between every authored pair. */
  readonly soften?: boolean;
}

/**
 * Lofts an elliptical tube through `sections` along +Y.
 *
 * Sections must ascend. The surface is closed radially and optionally capped,
 * and vertex skinning is sampled per section so one mesh can span several
 * joints — which is the whole point: a limb that is one surface cannot show a
 * seam where its bones meet.
 */
export function buildOwnerLoft(
  sections: readonly OwnerSection[],
  options: LoftOptions = {},
): THREE.BufferGeometry {
  if (sections.length < 2) throw new Error("A loft needs at least two sections.");
  const radialSegments = options.radialSegments ?? 12;
  const rows = options.soften === false ? sections : softenSections(sections);

  const positions: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  for (const section of rows) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = (radial / radialSegments) * Math.PI * 2;
      // +z is forward. Flattening applies behind the body, never in front of
      // it, so a shirt back can be planar while the chest stays rounded.
      const back = Math.max(0, -Math.cos(angle));
      const depth = section.halfDepth * (1 - (section.flatBack ?? 0) * Math.pow(back, 0.7));
      positions.push(
        (section.offsetX ?? 0) + Math.sin(angle) * section.halfWidth,
        section.at,
        (section.offsetZ ?? 0) + Math.cos(angle) * depth,
      );
      appendSkin(section.at, options.skinAt, skinIndices, skinWeights);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < rows.length - 1; row += 1) {
    const base = row * radialSegments;
    const next = (row + 1) * radialSegments;
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const step = (radial + 1) % radialSegments;
      // Wound so the side faces point *outwards*. Reversing these does not
      // fail loudly: back-face culling then shows the far side's interior
      // through the near surface, which reads as the whole figure being
      // faintly transparent, and `computeVertexNormals` lights it inside out.
      // `owner.test.ts` asserts the direction rather than trusting the order.
      indices.push(
        base + radial, base + step, next + radial,
        base + step, next + step, next + radial,
      );
    }
  }

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  if (options.capStart !== false) {
    const centre = positions.length / 3;
    positions.push(first.offsetX ?? 0, first.at, first.offsetZ ?? 0);
    appendSkin(first.at, options.skinAt, skinIndices, skinWeights);
    for (let radial = 0; radial < radialSegments; radial += 1) {
      indices.push(centre, (radial + 1) % radialSegments, radial);
    }
  }
  if (options.capEnd !== false) {
    const centre = positions.length / 3;
    positions.push(last.offsetX ?? 0, last.at, last.offsetZ ?? 0);
    appendSkin(last.at, options.skinAt, skinIndices, skinWeights);
    const base = (rows.length - 1) * radialSegments;
    for (let radial = 0; radial < radialSegments; radial += 1) {
      indices.push(centre, base + radial, base + ((radial + 1) % radialSegments));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (options.skinAt) {
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Blends the bones either side of `at`, given each bone's position along the
 * loft axis. Two bones at most, which keeps a joint's fold local: a knee
 * should not move a shirt hem.
 */
export function skinAlong(
  bones: readonly { readonly at: number; readonly index: number }[],
): OwnerSkinSampler {
  const sorted = [...bones].sort((a, b) => a.at - b.at);
  const lowest = sorted[0]!;
  const highest = sorted[sorted.length - 1]!;
  return (at) => {
    const upper = sorted.findIndex((bone) => bone.at > at);
    // Past the ends, follow the nearest bone. Getting this backwards weights
    // the *top* of a surface to the *lowest* bone, which sends the seat of the
    // trousers wherever the foot goes and the shirt collar wherever the hips
    // go — a spike of cloth flying off the model with no obvious cause.
    if (upper < 0) return { indices: [highest.index, 0, 0, 0], weights: [1, 0, 0, 0] };
    if (upper === 0) return { indices: [lowest.index, 0, 0, 0], weights: [1, 0, 0, 0] };
    const low = sorted[upper - 1]!;
    const high = sorted[upper]!;
    const span = high.at - low.at;
    // Ease the crossover so the fold sits at the joint rather than smearing
    // evenly across the whole segment.
    const raw = span > 1e-6 ? (at - low.at) / span : 0;
    const blend = raw * raw * (3 - 2 * raw);
    return {
      indices: [low.index, high.index, 0, 0],
      weights: [1 - blend, blend, 0, 0],
    };
  };
}

function appendSkin(
  at: number,
  skinAt: OwnerSkinSampler | undefined,
  indices: number[],
  weights: number[],
): void {
  if (!skinAt) return;
  const sample = skinAt(at);
  indices.push(...sample.indices);
  weights.push(...sample.weights);
}

/**
 * Adds a smoothed midsection between each authored pair, so a waist or a
 * shoulder curves instead of creasing. Midpoints are clamped between their
 * neighbours: a cubic through a narrow waist would otherwise overshoot into a
 * pinch that looks like a fold in the wrong place.
 */
function softenSections(sections: readonly OwnerSection[]): readonly OwnerSection[] {
  const result: OwnerSection[] = [];
  for (let index = 0; index < sections.length - 1; index += 1) {
    const a = sections[index]!;
    const b = sections[index + 1]!;
    const before = sections[index - 1] ?? a;
    const after = sections[index + 2] ?? b;
    result.push(a);
    result.push({
      at: (a.at + b.at) / 2,
      halfWidth: clampBetween(catmull(before.halfWidth, a.halfWidth, b.halfWidth, after.halfWidth), a.halfWidth, b.halfWidth),
      halfDepth: clampBetween(catmull(before.halfDepth, a.halfDepth, b.halfDepth, after.halfDepth), a.halfDepth, b.halfDepth),
      offsetX: ((a.offsetX ?? 0) + (b.offsetX ?? 0)) / 2,
      offsetZ: ((a.offsetZ ?? 0) + (b.offsetZ ?? 0)) / 2,
      flatBack: ((a.flatBack ?? 0) + (b.flatBack ?? 0)) / 2,
    });
  }
  result.push(sections[sections.length - 1]!);
  return result;
}

/** Catmull-Rom value at the midpoint of the p1..p2 span. */
function catmull(p0: number, p1: number, p2: number, p3: number): number {
  return (-p0 + 9 * p1 + 9 * p2 - p3) / 16;
}

function clampBetween(value: number, a: number, b: number): number {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return value < low ? low : value > high ? high : value;
}

/**
 * A shoe: sole, upper, and a rounded toe, built as a swept box rather than the
 * single cube it replaces. Authored so its sole sits on y=0 of its own space,
 * which is what lets the ankle roll heel-to-toe without the toe sinking.
 */
export function buildOwnerShoeGeometry(): THREE.BufferGeometry {
  // Cross-sections along the length of the foot, heel at -z.
  const sections: readonly { z: number; halfWidth: number; bottom: number; top: number }[] = [
    { z: -0.085, halfWidth: 0.044, bottom: 0.014, top: 0.126 },
    { z: -0.05, halfWidth: 0.062, bottom: 0.003, top: 0.132 },
    { z: 0.005, halfWidth: 0.069, bottom: 0, top: 0.108 },
    { z: 0.075, halfWidth: 0.068, bottom: 0, top: 0.076 },
    { z: 0.14, halfWidth: 0.059, bottom: 0.001, top: 0.05 },
    { z: 0.182, halfWidth: 0.034, bottom: 0.01, top: 0.034 },
  ];
  // An explicit closed profile rather than an ellipse: a shoe needs a genuinely
  // flat sole, and the bottom of an ellipse is a curve however much it is
  // squashed. The last edge closes across the sole, so it stays planar and the
  // model still sits exactly on its own origin.
  const profile: readonly { readonly across: number; readonly up: number }[] = [
    { across: -0.86, up: 0 },
    { across: -1, up: 0.3 },
    { across: -0.9, up: 0.78 },
    { across: -0.44, up: 1 },
    { across: 0.44, up: 1 },
    { across: 0.9, up: 0.78 },
    { across: 1, up: 0.3 },
    { across: 0.86, up: 0 },
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const ring = profile.length;

  for (const section of sections) {
    for (const point of profile) {
      positions.push(
        point.across * section.halfWidth,
        section.bottom + point.up * (section.top - section.bottom),
        section.z,
      );
    }
  }
  // Outward-facing, like the lofts above. The profile is traversed clockwise
  // in XY, so the sides wind the opposite way round from a counter-clockwise
  // ring would.
  for (let row = 0; row < sections.length - 1; row += 1) {
    const base = row * ring;
    const next = (row + 1) * ring;
    for (let radial = 0; radial < ring; radial += 1) {
      const step = (radial + 1) % ring;
      indices.push(base + radial, next + radial, base + step);
      indices.push(base + step, next + radial, next + step);
    }
  }
  const heel = sections[0]!;
  const toe = sections[sections.length - 1]!;
  const heelCentre = positions.length / 3;
  positions.push(0, heel.bottom + (heel.top - heel.bottom) * 0.45, heel.z);
  const toeCentre = positions.length / 3;
  positions.push(0, toe.bottom + (toe.top - toe.bottom) * 0.45, toe.z);
  // The heel cap faces -Z and the toe cap +Z.
  for (let radial = 0; radial < ring; radial += 1) {
    const step = (radial + 1) % ring;
    indices.push(heelCentre, radial, step);
    const base = (sections.length - 1) * ring;
    indices.push(toeCentre, base + step, base + radial);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A head with a brow, cheeks, a jaw, and a chin, lofted from the neck up.
 *
 * The sphere it replaces gave the homeowner a featureless ball, which is why
 * the eyes and nose had to be stuck onto it as separate lumps. Lofting the
 * cranium and jaw as one surface gives the features somewhere to sit.
 */
export function buildOwnerHeadGeometry(): THREE.BufferGeometry {
  return buildOwnerLoft([
    { at: -0.09, halfWidth: 0.075, halfDepth: 0.082, offsetZ: -0.008 },
    { at: -0.055, halfWidth: 0.093, halfDepth: 0.098, offsetZ: 0.002 },
    // Jaw and chin: narrow, and set forward of the throat.
    { at: -0.02, halfWidth: 0.104, halfDepth: 0.112, offsetZ: 0.014 },
    { at: 0.035, halfWidth: 0.118, halfDepth: 0.126, offsetZ: 0.012 },
    // Cheekbones, the widest point of a face.
    { at: 0.095, halfWidth: 0.128, halfDepth: 0.132, offsetZ: 0.004 },
    // Brow: pushed forward so the eyes sit under it rather than in front of a
    // separate ridge bolted onto the forehead.
    { at: 0.15, halfWidth: 0.128, halfDepth: 0.134, offsetZ: 0.006 },
    { at: 0.185, halfWidth: 0.126, halfDepth: 0.126, offsetZ: -0.006 },
    // Cranium, kept full so the head does not taper to a point.
    { at: 0.235, halfWidth: 0.121, halfDepth: 0.119, offsetZ: -0.016 },
    { at: 0.285, halfWidth: 0.099, halfDepth: 0.096, offsetZ: -0.022 },
    { at: 0.325, halfWidth: 0.05, halfDepth: 0.049, offsetZ: -0.024 },
  ], { radialSegments: 16 });
}

/** A hand: a palm that tapers into fingers, plus a thumb ridge. */
export function buildOwnerHandGeometry(): THREE.BufferGeometry {
  return buildOwnerLoft([
    { at: -0.12, halfWidth: 0.017, halfDepth: 0.026 },
    { at: -0.088, halfWidth: 0.022, halfDepth: 0.037 },
    { at: -0.04, halfWidth: 0.026, halfDepth: 0.046 },
    { at: 0, halfWidth: 0.026, halfDepth: 0.043 },
    { at: 0.032, halfWidth: 0.021, halfDepth: 0.034 },
  ], { radialSegments: 10 });
}
