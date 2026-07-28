import * as THREE from "three";
import { findModel, MODEL_REGISTRY, type ModelEntry } from "./registry";

/**
 * Rendering-independent model analysis.
 *
 * This runs in Node with no WebGL context: it walks the object graph, measures
 * bounds, counts geometry, and reports named joints. It answers "is this model
 * built correctly" — the right size, the right pivot, the right hierarchy —
 * which is most of what goes wrong with procedural models, and none of which
 * needs a picture.
 */

export interface NodeReport {
  readonly name: string;
  readonly type: string;
  readonly depth: number;
  readonly position: readonly [number, number, number];
  readonly triangles: number;
  readonly children: number;
}

export interface MaterialReport {
  readonly name: string;
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly transparent: boolean;
  readonly usedBy: number;
}

export interface ModelReport {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly mount: string;
  readonly description: string;
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly size: readonly [number, number, number];
    readonly center: readonly [number, number, number];
  };
  /** Distance from the model origin to its lowest point. 0 means floor-aligned. */
  readonly groundOffset: number;
  readonly objectCount: number;
  readonly meshCount: number;
  readonly triangles: number;
  readonly vertices: number;
  readonly uniqueGeometries: number;
  readonly materials: readonly MaterialReport[];
  readonly namedNodes: readonly NodeReport[];
  readonly clips: readonly string[];
  readonly warnings: readonly string[];
}

/** Per-clip motion envelope, used to prove animation actually moves things. */
export interface ClipReport {
  readonly clip: string;
  readonly frames: number;
  /** Bounding box growth across the clip, per axis. */
  readonly motionRange: readonly [number, number, number];
  /** Largest single-frame movement of the bounds centre. */
  readonly peakFrameDelta: number;
  /** Named joints that never changed rotation during the clip. */
  readonly staticJoints: readonly string[];
  readonly movingJoints: number;
  readonly warnings: readonly string[];
}

export function inspectModel(id: string): ModelReport {
  const entry = findModel(id);
  if (!entry) {
    throw new Error(`Unknown model "${id}". Known models: ${MODEL_REGISTRY.map((item) => item.id).join(", ")}`);
  }
  return inspectEntry(entry);
}

export function inspectEntry(entry: ModelEntry): ModelReport {
  const instance = entry.instantiate();
  const object = instance.object;
  object.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  if (bounds.isEmpty()) {
    bounds.set(new THREE.Vector3(), new THREE.Vector3());
  }
  bounds.getSize(size);
  bounds.getCenter(center);

  let objectCount = 0;
  let meshCount = 0;
  let triangles = 0;
  let vertices = 0;
  const geometries = new Set<string>();
  const materialUse = new Map<THREE.Material, number>();
  const namedNodes: NodeReport[] = [];
  const warnings: string[] = [];

  const depths = new Map<THREE.Object3D, number>([[object, 0]]);
  object.traverse((node) => {
    objectCount += 1;
    const depth = depths.get(node) ?? 0;
    for (const child of node.children) depths.set(child, depth + 1);

    let nodeTriangles = 0;
    if (node instanceof THREE.Mesh) {
      meshCount += 1;
      const geometry = node.geometry as THREE.BufferGeometry;
      geometries.add(geometry.uuid);
      const positionAttribute = geometry.getAttribute("position");
      const count = positionAttribute ? positionAttribute.count : 0;
      vertices += count;
      nodeTriangles = geometry.index ? geometry.index.count / 3 : count / 3;
      triangles += nodeTriangles;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materialUse.set(material, (materialUse.get(material) ?? 0) + 1);
      }
    }

    // Nodes with explicit names are the rig contract other systems depend on.
    if (node.name && node !== object) {
      namedNodes.push({
        name: node.name,
        type: node.type,
        depth,
        position: [round(node.position.x), round(node.position.y), round(node.position.z)],
        triangles: Math.round(nodeTriangles),
        children: node.children.length,
      });
    }
  });

  const materials: MaterialReport[] = [...materialUse.entries()]
    .map(([material, usedBy]) => ({
      name: material.name || material.type,
      color: material instanceof THREE.MeshStandardMaterial ? `#${material.color.getHexString()}` : "n/a",
      roughness: material instanceof THREE.MeshStandardMaterial ? round(material.roughness) : 0,
      metalness: material instanceof THREE.MeshStandardMaterial ? round(material.metalness) : 0,
      transparent: material.transparent,
      usedBy,
    }))
    .sort((a, b) => b.usedBy - a.usedBy);

  const groundOffset = round(bounds.min.y);
  if ((entry.mount ?? "floor") === "floor" && Math.abs(groundOffset) > 0.03) {
    warnings.push(
      `Lowest point is ${groundOffset} rather than 0; floor-mounted models must sit on their origin.`,
    );
  }
  // A hero character carries far more articulation than set dressing, so the
  // budget is per category rather than one global number.
  const triangleBudget = entry.category === "character" ? 6500 : 1600;
  if (triangles > triangleBudget) {
    warnings.push(`${Math.round(triangles)} triangles exceeds the ${triangleBudget} budget for a ${entry.category}.`);
  }
  if (materials.length > 10) warnings.push(`${materials.length} unique materials will cost draw calls.`);
  if (meshCount === 0) warnings.push("Model contains no meshes.");
  if (size.x > 12 || size.y > 12 || size.z > 12) warnings.push("Model is larger than a room; check units.");

  return {
    id: entry.id,
    label: entry.label,
    category: entry.category,
    mount: entry.mount ?? "floor",
    description: entry.description,
    bounds: {
      min: [round(bounds.min.x), round(bounds.min.y), round(bounds.min.z)],
      max: [round(bounds.max.x), round(bounds.max.y), round(bounds.max.z)],
      size: [round(size.x), round(size.y), round(size.z)],
      center: [round(center.x), round(center.y), round(center.z)],
    },
    groundOffset,
    objectCount,
    meshCount,
    triangles: Math.round(triangles),
    vertices,
    uniqueGeometries: geometries.size,
    materials,
    // Kept in traversal order so the printed indentation is a real tree.
    namedNodes,
    clips: instance.driver?.clips ?? [],
    warnings,
  };
}

/**
 * Steps a clip at a fixed rate and measures what actually moved. Catches the
 * failure mode screenshots miss: a clip that plays but drives nothing.
 */
export function inspectClip(id: string, clip: string, seconds = 2, fps = 30): ClipReport {
  const entry = findModel(id);
  if (!entry) throw new Error(`Unknown model "${id}".`);
  const instance = entry.instantiate();
  if (!instance.driver) throw new Error(`Model "${id}" has no animation driver.`);
  if (!instance.driver.clips.includes(clip)) {
    throw new Error(`Model "${id}" has no clip "${clip}". Clips: ${instance.driver.clips.join(", ")}`);
  }
  instance.driver.setClip(clip);

  const dt = 1 / fps;
  const frames = Math.max(2, Math.round(seconds * fps));
  const object = instance.object;

  const jointRotations = new Map<string, THREE.Euler[]>();
  const joints: THREE.Object3D[] = [];
  object.traverse((node) => {
    if (node.name && node.children.length > 0) joints.push(node);
  });

  const minBound = new THREE.Vector3(Infinity, Infinity, Infinity);
  const maxBound = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const frameBox = new THREE.Box3();
  const frameCenter = new THREE.Vector3();
  const previousCenter = new THREE.Vector3();
  let peakFrameDelta = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    instance.driver.update(dt);
    object.updateMatrixWorld(true);
    frameBox.setFromObject(object);
    if (frameBox.isEmpty()) continue;
    minBound.min(frameBox.min);
    maxBound.max(frameBox.max);
    frameBox.getCenter(frameCenter);
    if (frame > 0) peakFrameDelta = Math.max(peakFrameDelta, frameCenter.distanceTo(previousCenter));
    previousCenter.copy(frameCenter);

    for (const joint of joints) {
      const samples = jointRotations.get(joint.name) ?? [];
      samples.push(joint.rotation.clone());
      jointRotations.set(joint.name, samples);
    }
  }

  const staticJoints: string[] = [];
  let movingJoints = 0;
  for (const [name, samples] of jointRotations) {
    const first = samples[0];
    if (!first) continue;
    const moved = samples.some((sample) =>
      Math.abs(sample.x - first.x) > 1e-4
      || Math.abs(sample.y - first.y) > 1e-4
      || Math.abs(sample.z - first.z) > 1e-4);
    if (moved) movingJoints += 1;
    else staticJoints.push(name);
  }

  const warnings: string[] = [];
  if (movingJoints === 0) warnings.push(`Clip "${clip}" moved no named joint at all.`);
  if (peakFrameDelta > 0.35) {
    warnings.push(`Peak per-frame movement of ${round(peakFrameDelta)} suggests a pop or an unstable solve.`);
  }

  return {
    clip,
    frames,
    motionRange: [
      round(maxBound.x - minBound.x),
      round(maxBound.y - minBound.y),
      round(maxBound.z - minBound.z),
    ],
    peakFrameDelta: round(peakFrameDelta),
    staticJoints: staticJoints.sort(),
    movingJoints,
    warnings,
  };
}

export function inspectAll(): readonly ModelReport[] {
  return MODEL_REGISTRY.map((entry) => inspectEntry(entry));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
