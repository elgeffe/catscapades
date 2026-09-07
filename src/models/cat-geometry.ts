import * as THREE from "three";

export interface CatCoatColors {
  readonly fur: number;
  readonly shade: number;
  readonly belly: number;
}

export interface CatLimbShape {
  readonly length: number;
  /** Elliptical radius where the limb disappears into the body. */
  readonly root: readonly [x: number, z: number];
  /** Broadest muscle belly and its position down the segment. */
  readonly muscle: readonly [x: number, z: number];
  readonly muscleAt: number;
  /** Elliptical radius at the distal joint. */
  readonly joint: readonly [x: number, z: number];
  /** Ring positions down the segment, expressed in normalised length. */
  readonly stripes?: readonly number[];
}

export interface CatLegShape {
  readonly side: -1 | 1;
  /** Distance over which the proximal skin emerges from inside the torso. */
  readonly socketBlend: number;
  readonly upper: CatLimbShape;
  readonly lower: CatLimbShape;
  readonly foot: CatLimbShape;
  /** Leaves room for the terminal paw dome to cover the distal seam. */
  readonly footEndInset: number;
}

interface LoftSection {
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly centerY: number;
  /** Narrows the lower quadrants for a softer heart-shaped head silhouette. */
  readonly lowerTaper?: number;
}

type ColorSampler = (section: LoftSection, angle: number) => THREE.Color;
type SkinSampler = (z: number) => {
  readonly indices: readonly [number, number, number, number];
  readonly weights: readonly [number, number, number, number];
};

/**
 * One continuous, skinned hide spanning rump, waist, ribcage, and withers.
 *
 * The old cat assembled these masses from intersecting spheres and capsules.
 * This loft gives the player one readable feline silhouette while the four
 * existing spine joints still deform it.
 */
export function buildCatTorsoGeometry(colors: CatCoatColors): THREE.BufferGeometry {
  const sections: readonly LoftSection[] = [
    // Sacrum and compact pelvis: the upper hind-leg muscles provide the rest
    // of the hip silhouette instead of inflating the torso into a sphere.
    { z: -0.365, width: 0.06, height: 0.065, centerY: 0.05 },
    { z: -0.335, width: 0.105, height: 0.105, centerY: 0.04 },
    { z: -0.29, width: 0.128, height: 0.114, centerY: 0.037, lowerTaper: 0.12 },
    { z: -0.24, width: 0.13, height: 0.114, centerY: 0.034, lowerTaper: 0.16 },
    { z: -0.19, width: 0.122, height: 0.105, centerY: 0.032, lowerTaper: 0.2 },
    // Lumbar tuck: cats keep a smooth topline but a sharply rising abdomen.
    { z: -0.135, width: 0.114, height: 0.103, centerY: 0.039, lowerTaper: 0.22 },
    { z: -0.08, width: 0.106, height: 0.098, centerY: 0.047, lowerTaper: 0.24 },
    { z: -0.025, width: 0.104, height: 0.099, centerY: 0.046, lowerTaper: 0.24 },
    { z: 0.03, width: 0.106, height: 0.109, centerY: 0.038, lowerTaper: 0.22 },
    // Deep, laterally narrow ribcage and raised withers.
    { z: 0.085, width: 0.113, height: 0.118, centerY: 0.032, lowerTaper: 0.2 },
    { z: 0.14, width: 0.121, height: 0.126, centerY: 0.028, lowerTaper: 0.16 },
    { z: 0.19, width: 0.129, height: 0.134, centerY: 0.03, lowerTaper: 0.12 },
    { z: 0.235, width: 0.128, height: 0.135, centerY: 0.037, lowerTaper: 0.1 },
    { z: 0.275, width: 0.116, height: 0.128, centerY: 0.04 },
    { z: 0.31, width: 0.103, height: 0.11, centerY: 0.046 },
    { z: 0.34, width: 0.079, height: 0.086, centerY: 0.059 },
  ];
  const anchors = [-0.235, -0.08, 0.075, 0.21] as const;
  return buildLoft(
    softenLoft(sections),
    20,
    (section, angle) => sampleTorsoColor(colors, section.z, angle),
    (z) => weightsAlong(z, anchors),
  );
}

/**
 * A seam-free nape, throat, and skull surface driven by neck and head bones.
 *
 * Coordinates are local to the neck joint. The head pivot remains at
 * `(0, 0.06, 0.115)`, matching the facial-feature hierarchy in `buildCat`.
 * The rear rings stay with the neck while the crown and muzzle follow the head,
 * so looking around bends a soft ruff instead of opening an intersection seam.
 */
export function buildCatNeckHeadGeometry(colors: CatCoatColors): THREE.BufferGeometry {
  const sections: readonly LoftSection[] = [
    // Nape and throat, with the first ring buried inside the withers.
    { z: -0.055, width: 0.074, height: 0.072, centerY: -0.002 },
    { z: 0, width: 0.08, height: 0.075, centerY: 0.006 },
    { z: 0.02, width: 0.084, height: 0.078, centerY: 0.019 },
    // Occiput and crown rise above the throat without a detachable-head seam.
    { z: 0.04, width: 0.086, height: 0.079, centerY: 0.064, lowerTaper: 0.08 },
    { z: 0.08, width: 0.099, height: 0.085, centerY: 0.069, lowerTaper: 0.1 },
    { z: 0.125, width: 0.101, height: 0.079, centerY: 0.067, lowerTaper: 0.15 },
    // Full cheeks turn into a broad, short facial plane. The final rings stay
    // close together in depth, avoiding the fox-like wedge of a long muzzle.
    { z: 0.16, width: 0.098, height: 0.066, centerY: 0.061, lowerTaper: 0.2 },
    { z: 0.19, width: 0.083, height: 0.053, centerY: 0.053, lowerTaper: 0.23 },
    { z: 0.208, width: 0.058, height: 0.035, centerY: 0.04, lowerTaper: 0.16 },
    { z: 0.216, width: 0.047, height: 0.028, centerY: 0.035, lowerTaper: 0.08 },
  ];
  return buildLoft(
    sections,
    20,
    (section, angle) => sampleHeadColor(colors, section.z - 0.115, angle),
    (z) => {
      const headWeight = smoothstep(0.015, 0.075, z);
      return {
        indices: [0, 1, 0, 0],
        weights: [1 - headWeight, headWeight, 0, 0],
      };
    },
  );
}

/** One smooth tapered skin over the simulated tail bones. */
export function buildCatTailGeometry(
  jointCount: number,
  segmentLength: number,
  colors: CatCoatColors,
): THREE.BufferGeometry {
  const sections: LoftSection[] = [];
  // Extend one section beyond the final pivot. The last joint can then bend a
  // real rounded tip instead of merely rotating an end cap at its own origin.
  const halfSegments = Math.max(1, jointCount * 2);
  for (let index = 0; index <= halfSegments; index += 1) {
    const t = index / halfSegments;
    const radius = interpolateProfile(t, [
      [0, 0.045],
      [0.15, 0.04],
      [0.35, 0.035],
      [0.55, 0.029],
      [0.75, 0.021],
      [0.9, 0.016],
      [0.97, 0.012],
      [1, 0.009],
    ]);
    sections.push({
      z: -index * segmentLength * 0.5,
      width: radius,
      height: radius * (1 - t * 0.08),
      centerY: 0,
    });
  }
  const anchors = Array.from({ length: jointCount }, (_, index) => -index * segmentLength);
  return buildLoft(
    sections,
    10,
    (section) => {
      const t = Math.abs(section.z) / Math.max(segmentLength, jointCount * segmentLength);
      let ring = 0;
      for (const center of [0.28, 0.43, 0.58, 0.73, 0.86]) {
        const distance = (t - center) / 0.035;
        ring = Math.max(ring, Math.exp(-distance * distance));
      }
      const dark = Math.max(ring * 0.34, smoothstep(0.82, 1, t) * 0.62);
      return new THREE.Color(colors.fur).lerp(new THREE.Color(colors.shade), dark);
    },
    (z) => {
      const chain = weightsAlong(z, anchors);
      const distance = Math.max(0, -z);
      const socketWeight = 1 - smoothstep(0.008, 0.04, distance);
      const chainWeight = 1 - socketWeight;
      return {
        indices: [
          0,
          (chain.indices[0] ?? 0) + 1,
          (chain.indices[1] ?? 0) + 1,
          0,
        ],
        weights: [
          socketWeight,
          (chain.weights[0] ?? 0) * chainWeight,
          (chain.weights[1] ?? 0) * chainWeight,
          0,
        ],
      };
    },
  );
}

/** Broad, slightly cupped pinna with a softened tip and a buried root. */
export function buildCatEarGeometry(): THREE.BufferGeometry {
  const vertices = new Float32Array([
    // Front rim: broad root, gently shouldered taper, tiny bevel at the tip.
    -0.047, -0.019, 0.016,
    0.047, -0.019, 0.016,
    0.014, 0.07, 0.007,
    0.0015, 0.087, 0.003,
    -0.0015, 0.087, 0.003,
    -0.014, 0.07, 0.007,
    // Back rim gives the shell real thickness and a shallow cup.
    -0.041, -0.016, -0.017,
    0.041, -0.016, -0.017,
    0.012, 0.068, -0.006,
    0.001, 0.084, -0.008,
    -0.001, 0.084, -0.008,
    -0.012, 0.068, -0.006,
    // The bowl recedes behind its rolled rim instead of filling it with a
    // flat triangle. Its depth is shared by the inset skin surface below.
    0, 0.027, 0.0015,
  ]);
  const indices = [
    // Front and back faces.
    12, 0, 1, 12, 1, 2, 12, 2, 3, 12, 3, 4, 12, 4, 5, 12, 5, 0,
    6, 8, 7, 6, 11, 8, 11, 9, 8, 11, 10, 9,
    // Outer rolled edges and closed root.
    0, 6, 7, 0, 7, 1,
    1, 7, 8, 1, 8, 2,
    2, 8, 9, 2, 9, 3,
    3, 9, 10, 3, 10, 4,
    4, 10, 11, 4, 11, 5,
    5, 11, 6, 5, 6, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The inset bowl follows the pinna's cup and leaves a visible fur rim. */
export function buildCatEarInnerGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.031, -0.002, 0.014,
    0.031, -0.002, 0.014,
    0.009, 0.057, 0.008,
    0, 0.071, 0.006,
    -0.009, 0.057, 0.008,
    0, 0.027, 0.003,
  ], 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute([
    0.9, 0.9, 0.9,
    0.9, 0.9, 0.9,
    1, 1, 1,
    1, 1, 1,
    1, 1, 1,
    0.68, 0.68, 0.68,
  ], 3));
  geometry.setIndex([5, 0, 1, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 0]);
  geometry.computeVertexNormals();
  return geometry;
}

/** Small triangular nose with a real bridge edge instead of a pink ball. */
export function buildCatNoseGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.018, 0.008, 0,
    0.018, 0.008, 0,
    0, -0.012, 0.008,
    0, 0.002, -0.01,
  ], 3));
  geometry.setIndex([
    0, 1, 2,
    3, 1, 0,
    3, 2, 1,
    3, 0, 2,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One continuous skinned surface from shoulder/hip to wrist/hock.
 *
 * Narrow two-bone blend bands preserve volume through flexion while the broad
 * proximal rings disappear into the torso. The gameplay-facing IK hierarchy
 * stays unchanged; only its rendered skin becomes continuous.
 */
export function buildCatLegGeometry(
  shape: CatLegShape,
  colors: CatCoatColors,
): THREE.BufferGeometry {
  const radialSegments = 16;
  const upperEnd = shape.upper.length;
  const lowerEnd = upperEnd + shape.lower.length;
  const fullLength = lowerEnd + shape.foot.length;
  const blend = 0.025;
  const sections: Array<{ distance: number; width: number; depth: number; segment: 0 | 1 | 2; t: number }> = [];
  const add = (
    distance: number,
    width: number,
    depth: number,
    segment: 0 | 1 | 2,
    t: number,
  ): void => {
    sections.push({ distance, width, depth, segment, t });
  };

  // Bury the cap above the anatomical pivot so flexion never reveals a flat
  // cut at the shoulder or hip.
  add(-0.048, shape.upper.root[0] * 0.38, shape.upper.root[1] * 0.58, 0, 0);
  add(0, shape.upper.root[0] * 0.86, shape.upper.root[1], 0, 0);
  const earlyMuscleBlend = Math.min(1, 0.16 / Math.max(0.01, shape.upper.muscleAt));
  add(
    shape.upper.length * 0.16,
    THREE.MathUtils.lerp(shape.upper.root[0], shape.upper.muscle[0], earlyMuscleBlend),
    THREE.MathUtils.lerp(shape.upper.root[1], shape.upper.muscle[1], earlyMuscleBlend),
    0,
    0.16,
  );
  add(
    shape.upper.length * shape.upper.muscleAt,
    shape.upper.muscle[0],
    shape.upper.muscle[1],
    0,
    shape.upper.muscleAt,
  );
  add(
    shape.upper.length * 0.48,
    THREE.MathUtils.lerp(shape.upper.muscle[0], shape.upper.joint[0], 0.32),
    THREE.MathUtils.lerp(shape.upper.muscle[1], shape.upper.joint[1], 0.32),
    0,
    0.48,
  );
  add(
    shape.upper.length * 0.72,
    THREE.MathUtils.lerp(shape.upper.muscle[0], shape.upper.joint[0], 0.66),
    THREE.MathUtils.lerp(shape.upper.muscle[1], shape.upper.joint[1], 0.66),
    0,
    0.72,
  );
  add(upperEnd - blend, shape.upper.joint[0], shape.upper.joint[1], 0, 0.94);
  add(upperEnd - blend * 0.45, shape.upper.joint[0], shape.upper.joint[1] * 1.08, 0, 0.97);
  add(
    upperEnd,
    (shape.upper.joint[0] + shape.lower.root[0]) * 0.48,
    (shape.upper.joint[1] + shape.lower.root[1]) * 0.55,
    1,
    0,
  );
  add(upperEnd + blend * 0.45, shape.lower.root[0], shape.lower.root[1] * 1.08, 1, 0.04);
  add(upperEnd + blend, shape.lower.root[0], shape.lower.root[1], 1, 0.08);
  add(
    upperEnd + shape.lower.length * shape.lower.muscleAt,
    shape.lower.muscle[0],
    shape.lower.muscle[1],
    1,
    shape.lower.muscleAt,
  );
  add(
    upperEnd + shape.lower.length * 0.48,
    THREE.MathUtils.lerp(shape.lower.muscle[0], shape.lower.joint[0], 0.35),
    THREE.MathUtils.lerp(shape.lower.muscle[1], shape.lower.joint[1], 0.35),
    1,
    0.48,
  );
  add(
    upperEnd + shape.lower.length * 0.72,
    THREE.MathUtils.lerp(shape.lower.muscle[0], shape.lower.joint[0], 0.68),
    THREE.MathUtils.lerp(shape.lower.muscle[1], shape.lower.joint[1], 0.68),
    1,
    0.72,
  );
  add(lowerEnd - blend, shape.lower.joint[0], shape.lower.joint[1], 1, 0.94);
  add(
    lowerEnd,
    (shape.lower.joint[0] + shape.foot.root[0]) * 0.48,
    (shape.lower.joint[1] + shape.foot.root[1]) * 0.52,
    2,
    0,
  );
  add(lowerEnd + blend * 0.5, shape.foot.root[0], shape.foot.root[1], 2, 0.12);
  add(
    lowerEnd + shape.foot.length * shape.foot.muscleAt,
    shape.foot.muscle[0],
    shape.foot.muscle[1],
    2,
    shape.foot.muscleAt,
  );
  add(
    fullLength - shape.footEndInset,
    shape.foot.joint[0],
    shape.foot.joint[1],
    2,
    1,
  );

  const positions: number[] = [];
  const vertexColors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const fur = new THREE.Color(colors.fur);
  const shade = new THREE.Color(colors.shade);

  for (const section of sections) {
    let stripe = 0;
    const segmentShape = section.segment === 0
      ? shape.upper
      : section.segment === 1 ? shape.lower : shape.foot;
    for (const center of segmentShape.stripes ?? []) {
      const distance = (section.t - center) / 0.045;
      stripe = Math.max(stripe, Math.exp(-distance * distance));
    }
    const skin = legWeights(
      section.distance,
      upperEnd,
      lowerEnd,
      blend,
      shape.upper.length * 0.36,
    );
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = radial / radialSegments * Math.PI * 2;
      // Proximal rings turn inward into the ribcage rather than ending in an
      // exposed vertical cap on its outside. Both sides use the same profile,
      // mirrored toward the centreline, while the stationary socket owns it.
      const socketInset = (1 - smoothstep(-0.048, shape.socketBlend, section.distance)) * 0.064;
      positions.push(
        Math.cos(angle) * section.width - shape.side * socketInset,
        -section.distance,
        Math.sin(angle) * section.depth,
      );
      const color = fur.clone().lerp(shade, stripe * 0.28);
      vertexColors.push(color.r, color.g, color.b);
      skinIndices.push(...skin.indices);
      skinWeights.push(...skin.weights);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < sections.length - 1; row += 1) {
    const nextRow = row + 1;
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(
        row * radialSegments + radial,
        row * radialSegments + next,
        nextRow * radialSegments + radial,
        row * radialSegments + next,
        nextRow * radialSegments + next,
        nextRow * radialSegments + radial,
      );
    }
  }
  const topCenter = positions.length / 3;
  positions.push(-shape.side * 0.064, -(sections[0]?.distance ?? 0), 0);
  vertexColors.push(fur.r, fur.g, fur.b);
  skinIndices.push(0, 0, 0, 0);
  skinWeights.push(1, 0, 0, 0);
  const bottomCenter = positions.length / 3;
  positions.push(0, -(fullLength - shape.footEndInset), 0);
  vertexColors.push(fur.r, fur.g, fur.b);
  skinIndices.push(3, 0, 0, 0);
  skinWeights.push(1, 0, 0, 0);
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(topCenter, next, radial);
    const lastRow = (sections.length - 1) * radialSegments;
    indices.push(bottomCenter, lastRow + radial, lastRow + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Rounded terminal paw with three subtly modelled toe lobes and a level sole. */
export function buildCatPawGeometry(
  colors: CatCoatColors,
  isFront: boolean,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 16, 8);
  geometry.scale(isFront ? 0.035 : 0.036, isFront ? 0.026 : 0.027, isFront ? 0.044 : 0.047);
  geometry.translate(0, isFront ? 0.021 : 0.022, isFront ? 0.015 : 0.018);

  const position = geometry.getAttribute("position");
  const vertexColors: number[] = [];
  const fur = new THREE.Color(colors.fur);
  const shade = new THREE.Color(colors.shade);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const toe = smoothstep(isFront ? 0.022 : 0.026, isFront ? 0.057 : 0.064, z);
    const grooveX = isFront ? 0.0105 : 0.0115;
    const leftGroove = Math.exp(-Math.pow((x + grooveX) / 0.0036, 2));
    const rightGroove = Math.exp(-Math.pow((x - grooveX) / 0.0036, 2));
    // A broad pad bears the weight; the raised instep swallows the ankle end.
    // Toe clefts are shallow depressions in one skin, never separate beads.
    position.setY(index, Math.max(0.001, y - toe * (leftGroove + rightGroove) * 0.003));
    position.setZ(index, z - toe * (leftGroove + rightGroove) * 0.0025);
    const color = fur.clone().lerp(shade, toe * 0.1);
    vertexColors.push(color.r, color.g, color.b);
  }
  position.needsUpdate = true;
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A shallow tapered jaw/chin that can still articulate for meows. */
export function buildCatJawGeometry(): THREE.BufferGeometry {
  const sections: readonly LoftSection[] = [
    { z: -0.025, width: 0.042, height: 0.023, centerY: 0 },
    { z: 0.025, width: 0.046, height: 0.024, centerY: -0.002 },
    { z: 0.058, width: 0.031, height: 0.018, centerY: 0 },
  ];
  return buildLoft(sections, 10, () => new THREE.Color(0xffffff));
}

function buildLoft(
  sections: readonly LoftSection[],
  radialSegments: number,
  colorAt: ColorSampler,
  skinAt?: SkinSampler,
): THREE.BufferGeometry {
  if (sections.length < 2) throw new Error("A loft needs at least two sections.");

  const positions: number[] = [];
  const colors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  for (const section of sections) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = radial / radialSegments * Math.PI * 2;
      const lower = Math.max(0, -Math.sin(angle));
      const width = section.width * (1 - (section.lowerTaper ?? 0) * Math.pow(lower, 0.8));
      positions.push(
        Math.cos(angle) * width,
        section.centerY + Math.sin(angle) * section.height,
        section.z,
      );
      const color = colorAt(section, angle);
      colors.push(color.r, color.g, color.b);
      appendSkin(section.z, skinAt, skinIndices, skinWeights);
    }
  }

  const first = sections[0]!;
  const last = sections[sections.length - 1]!;
  const startCenter = positions.length / 3;
  positions.push(0, first.centerY, first.z);
  {
    const color = colorAt(first, 0);
    colors.push(color.r, color.g, color.b);
    appendSkin(first.z, skinAt, skinIndices, skinWeights);
  }
  const endCenter = positions.length / 3;
  positions.push(0, last.centerY, last.z);
  {
    const color = colorAt(last, 0);
    colors.push(color.r, color.g, color.b);
    appendSkin(last.z, skinAt, skinIndices, skinWeights);
  }

  const indices: number[] = [];
  for (let section = 0; section < sections.length - 1; section += 1) {
    const row = section * radialSegments;
    const nextRow = (section + 1) * radialSegments;
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(
        row + radial, row + next, nextRow + radial,
        row + next, nextRow + next, nextRow + radial,
      );
    }
  }
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(startCenter, next, radial);
    const lastRow = (sections.length - 1) * radialSegments;
    indices.push(endCenter, lastRow + radial, lastRow + next);
  }

  // The tail is authored from its socket backwards along -Z. Reverse its
  // winding so the coat faces outwards just like an ascending torso loft.
  if (last.z < first.z) {
    for (let index = 0; index < indices.length; index += 3) {
      const second = indices[index + 1]!;
      indices[index + 1] = indices[index + 2]!;
      indices[index + 2] = second;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  if (skinAt) {
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Add curved midsections where the torso changes volume. Spending vertices
 * along the silhouette avoids angular withers and belly corners in side view.
 * Clamp the cubic midpoint to its neighbours so a narrow neck or waist cannot
 * overshoot into a fold when the authored profile changes. */
function softenLoft(sections: readonly LoftSection[]): readonly LoftSection[] {
  const result: LoftSection[] = [];
  for (let index = 0; index < sections.length - 1; index += 1) {
    const start = sections[index]!;
    const end = sections[index + 1]!;
    const previous = sections[Math.max(0, index - 1)]!;
    const next = sections[Math.min(sections.length - 1, index + 2)]!;
    const midpoint = (key: "width" | "height" | "centerY" | "lowerTaper"): number => {
      const a = start[key] ?? 0;
      const b = end[key] ?? 0;
      return THREE.MathUtils.clamp(
        (-(previous[key] ?? 0) + 9 * a + 9 * b - (next[key] ?? 0)) / 16,
        Math.min(a, b), Math.max(a, b),
      );
    };
    result.push(start, {
      z: (start.z + end.z) / 2,
      width: midpoint("width"), height: midpoint("height"),
      centerY: midpoint("centerY"), lowerTaper: midpoint("lowerTaper"),
    });
  }
  result.push(sections[sections.length - 1]!);
  return result;
}

function appendSkin(
  z: number,
  sampler: SkinSampler | undefined,
  indices: number[],
  weights: number[],
): void {
  if (!sampler) return;
  const skin = sampler(z);
  indices.push(...skin.indices);
  weights.push(...skin.weights);
}

function weightsAlong(
  z: number,
  anchors: readonly number[],
): ReturnType<SkinSampler> {
  if (anchors.length === 0) return { indices: [0, 0, 0, 0], weights: [1, 0, 0, 0] };
  if (anchors.length === 1) {
    return { indices: [0, 0, 0, 0], weights: [1, 0, 0, 0] };
  }
  const lastIndex = anchors.length - 1;
  const first = anchors[0] ?? 0;
  const last = anchors[lastIndex] ?? first;
  const ascending = last >= first;
  if ((ascending && z <= first) || (!ascending && z >= first)) {
    return { indices: [0, 0, 0, 0], weights: [1, 0, 0, 0] };
  }
  if ((ascending && z >= last) || (!ascending && z <= last)) {
    return { indices: [lastIndex, 0, 0, 0], weights: [1, 0, 0, 0] };
  }
  for (let index = 0; index < lastIndex; index += 1) {
    const start = anchors[index] ?? 0;
    const end = anchors[index + 1] ?? start;
    const inside = ascending ? z >= start && z <= end : z <= start && z >= end;
    if (!inside) continue;
    const t = (z - start) / (end - start || 1);
    return {
      indices: [index, index + 1, 0, 0],
      weights: [1 - t, t, 0, 0],
    };
  }
  return { indices: [lastIndex, 0, 0, 0], weights: [1, 0, 0, 0] };
}

function sampleTorsoColor(colors: CatCoatColors, z: number, angle: number): THREE.Color {
  const aroundY = Math.sin(angle);
  const base = new THREE.Color(colors.fur);
  const shade = new THREE.Color(colors.shade);
  const belly = new THREE.Color(colors.belly);

  const underside = smoothstep(0.18, 0.9, -aroundY)
    * smoothstep(-0.35, -0.08, z)
    * (1 - smoothstep(0.22, 0.35, z));
  base.lerp(belly, underside * 0.92);

  const upperSide = smoothstep(-0.72, 0.05, aroundY);
  const stripeCenters = [-0.29, -0.205, -0.105, 0.015, 0.125, 0.22];
  let stripe = 0;
  for (const center of stripeCenters) {
    const curve = (1 - aroundY * aroundY) * 0.027 * Math.sin(center * 17 + 0.8);
    const distance = (z - center - curve) / 0.016;
    stripe = Math.max(stripe, Math.exp(-distance * distance));
  }
  const dorsal = smoothstep(0.8, 1, aroundY) * 0.2;
  base.lerp(shade, Math.max(dorsal, upperSide * stripe * 0.72));
  return base;
}

function sampleHeadColor(colors: CatCoatColors, z: number, angle: number): THREE.Color {
  const aroundX = Math.cos(angle);
  const aroundY = Math.sin(angle);
  const base = new THREE.Color(colors.fur);
  const shade = new THREE.Color(colors.shade);
  const belly = new THREE.Color(colors.belly);

  const muzzle = smoothstep(0.04, 0.11, z) * smoothstep(0.05, 0.9, -aroundY);
  base.lerp(belly, muzzle * 0.28);

  const forehead = smoothstep(-0.02, 0.075, z) * smoothstep(0.3, 0.95, aroundY);
  const centreMark = Math.exp(-Math.pow(aroundX / 0.25, 2));
  base.lerp(shade, forehead * (0.18 + centreMark * 0.42));
  return base;
}

function legWeights(
  distance: number,
  upperEnd: number,
  lowerEnd: number,
  blend: number,
  socketBlendEnd: number,
): ReturnType<SkinSampler> {
  if (distance <= 0) {
    return { indices: [0, 0, 0, 0], weights: [1, 0, 0, 0] };
  }
  if (distance < socketBlendEnd) {
    const t = smoothstep(0, socketBlendEnd, distance);
    return { indices: [0, 1, 0, 0], weights: [1 - t, t, 0, 0] };
  }
  if (distance < upperEnd - blend) {
    return { indices: [1, 0, 0, 0], weights: [1, 0, 0, 0] };
  }
  if (distance <= upperEnd + blend) {
    const t = smoothstep(upperEnd - blend, upperEnd + blend, distance);
    return { indices: [1, 2, 0, 0], weights: [1 - t, t, 0, 0] };
  }
  if (distance < lowerEnd - blend) {
    return { indices: [2, 0, 0, 0], weights: [1, 0, 0, 0] };
  }
  if (distance <= lowerEnd + blend) {
    const t = smoothstep(lowerEnd - blend, lowerEnd + blend, distance);
    return { indices: [2, 3, 0, 0], weights: [1 - t, t, 0, 0] };
  }
  return { indices: [3, 0, 0, 0], weights: [1, 0, 0, 0] };
}

function interpolateProfile(
  t: number,
  points: readonly (readonly [position: number, value: number])[],
): number {
  const first = points[0];
  if (!first) return 0;
  if (t <= first[0]) return first[1];
  for (let index = 1; index < points.length; index += 1) {
    const end = points[index];
    const start = points[index - 1];
    if (!start || !end || t > end[0]) continue;
    return THREE.MathUtils.lerp(start[1], end[1], (t - start[0]) / (end[0] - start[0]));
  }
  return points[points.length - 1]?.[1] ?? first[1];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
