import * as THREE from "three";
import "../styles.css";
import "./viewer.css";
import { MODEL_REGISTRY, findModel, type ModelDriver, type ModelEntry } from "../models/registry";
import { inspectModel } from "../models/inspect";

/**
 * Standalone model viewer.
 *
 * Loads any registered model on its own, in a neutral studio, with a real
 * ground plane and a metric grid so scale mistakes are obvious. It exposes a
 * deterministic `window.catscapadesViewer` API so the capture script can drive
 * exactly the same code path headlessly — screenshots and manual review always
 * show the same thing.
 */

export interface ViewerApi {
  readonly models: readonly string[];
  setModel(id: string): void;
  clips(): readonly string[];
  setClip(clip: string): void;
  setView(view: ViewName): void;
  setOption(option: ViewerOption, value: boolean): void;
  /** Steps animation by a fixed amount and renders. Never uses wall time. */
  advance(seconds: number, step?: number): void;
  renderOnce(): void;
  report(): ReturnType<typeof inspectModel>;
  ready: Promise<void>;
}

export type ViewName = "hero" | "front" | "side" | "back" | "top" | "turntable";
export type ViewerOption = "grid" | "bounds" | "joints" | "wireframe" | "dark" | "paused" | "ui";

const VIEW_ANGLES: Readonly<Record<ViewName, { azimuth: number; elevation: number }>> = {
  hero: { azimuth: 0.86, elevation: 0.34 },
  front: { azimuth: 0, elevation: 0.12 },
  side: { azimuth: Math.PI / 2, elevation: 0.12 },
  back: { azimuth: Math.PI, elevation: 0.16 },
  top: { azimuth: 0.86, elevation: 1.32 },
  turntable: { azimuth: 0.86, elevation: 0.3 },
};

const canvas = requireElement<HTMLCanvasElement>("#viewer-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 200);

const studio = new THREE.Group();
scene.add(studio);

const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.6);
keyLight.position.set(2.6, 4.2, 3.1);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -4;
keyLight.shadow.bias = -0.0012;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xcfe0ef, 0.9);
fillLight.position.set(-3.2, 2.1, -2.4);
scene.add(fillLight);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6f6a60, 1.15));

const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xdad3c6, roughness: 0.96 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(24, 48), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
studio.add(ground);

/** Grid at 0.25 unit minor / 1 unit major, so scale is readable at a glance. */
const gridFine = new THREE.GridHelper(16, 64, 0xc3bcae, 0xc9c2b5);
gridFine.position.y = 0.001;
const gridCoarse = new THREE.GridHelper(16, 16, 0x8a8377, 0x9d9689);
gridCoarse.position.y = 0.002;
studio.add(gridFine, gridCoarse);

const boundsHelper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x3fa9d6));
boundsHelper.visible = false;
scene.add(boundsHelper);

const jointGroup = new THREE.Group();
jointGroup.visible = false;
scene.add(jointGroup);

let current: { entry: ModelEntry; object: THREE.Object3D; driver?: ModelDriver } | null = null;
let view: ViewName = "hero";
let azimuth = VIEW_ANGLES.hero.azimuth;
let elevation = VIEW_ANGLES.hero.elevation;
let distanceScale = 1;
let paused = false;
let turntableAngle = 0;
const focus = new THREE.Vector3();
let frameRadius = 1;

const options: Record<ViewerOption, boolean> = {
  grid: true, bounds: false, joints: false, wireframe: false, dark: false, paused: false, ui: true,
};

// -- model loading -----------------------------------------------------------

function loadModel(id: string): void {
  const entry = findModel(id);
  if (!entry) throw new Error(`Unknown model "${id}"`);

  if (current) {
    scene.remove(current.object);
    disposeTree(current.object);
  }
  jointGroup.clear();

  const instance = entry.instantiate();
  instance.object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  scene.add(instance.object);
  current = { entry, object: instance.object, driver: instance.driver };

  instance.object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(instance.object);
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  box.getCenter(focus);
  frameRadius = Math.max(0.25, box.getSize(new THREE.Vector3()).length() * 0.5);

  buildJointMarkers(instance.object);
  applyWireframe();
  refreshUi();
  renderOnce();
}

function buildJointMarkers(object: THREE.Object3D): void {
  const markerGeometry = new THREE.SphereGeometry(0.012, 6, 5);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xe8574a, depthTest: false });
  object.traverse((node) => {
    if (!node.name || node === object) return;
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.renderOrder = 10;
    marker.userData.follows = node;
    jointGroup.add(marker);
    const axes = new THREE.AxesHelper(0.05);
    axes.userData.follows = node;
    (axes.material as THREE.Material).depthTest = false;
    axes.renderOrder = 10;
    jointGroup.add(axes);
  });
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) node.geometry.dispose();
  });
}

function applyWireframe(): void {
  current?.object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if ("wireframe" in material) (material as THREE.MeshStandardMaterial).wireframe = options.wireframe;
      }
    }
  });
}

// -- camera ------------------------------------------------------------------

function updateCamera(): void {
  const angles = VIEW_ANGLES[view];
  const effectiveAzimuth = view === "turntable" ? turntableAngle : azimuth;
  const distance = frameRadius * 3.1 * distanceScale;
  camera.position.set(
    focus.x + Math.sin(effectiveAzimuth) * Math.cos(elevation) * distance,
    focus.y + Math.sin(elevation) * distance,
    focus.z + Math.cos(effectiveAzimuth) * Math.cos(elevation) * distance,
  );
  camera.lookAt(focus);
  void angles;
}

function setView(next: ViewName): void {
  view = next;
  const angles = VIEW_ANGLES[next];
  azimuth = angles.azimuth;
  elevation = angles.elevation;
  if (next === "turntable") turntableAngle = angles.azimuth;
  renderOnce();
}

// -- render ------------------------------------------------------------------

function resize(): void {
  const width = Math.max(1, canvas.clientWidth || window.innerWidth);
  const height = Math.max(1, canvas.clientHeight || window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
}

function renderOnce(): void {
  resize();
  studio.visible = true;
  gridFine.visible = options.grid;
  gridCoarse.visible = options.grid;
  scene.background = new THREE.Color(options.dark ? 0x21201d : 0xe9e4d8);
  groundMaterial.color.set(options.dark ? 0x35332e : 0xdad3c6);

  if (current) {
    current.object.updateMatrixWorld(true);
    boundsHelper.visible = options.bounds;
    if (options.bounds) {
      boundsHelper.box.setFromObject(current.object);
      boundsHelper.updateMatrixWorld(true);
    }
    jointGroup.visible = options.joints;
    if (options.joints) {
      for (const marker of jointGroup.children) {
        const follows = marker.userData.follows as THREE.Object3D | undefined;
        follows?.getWorldPosition(marker.position);
        follows?.getWorldQuaternion(marker.quaternion);
      }
    }
  }

  updateCamera();
  renderer.render(scene, camera);
}

/** Deterministic stepping: identical inputs always produce identical frames. */
function advance(seconds: number, step = 1 / 60): void {
  const steps = Math.max(1, Math.round(seconds / step));
  for (let index = 0; index < steps; index += 1) {
    current?.driver?.update(step);
    if (view === "turntable") turntableAngle += step * 0.6;
  }
  renderOnce();
}

let lastTime = performance.now();
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (!paused && !options.paused) {
    current?.driver?.update(dt);
    if (view === "turntable") turntableAngle += dt * 0.6;
    renderOnce();
  }
  requestAnimationFrame(loop);
}

// -- ui ----------------------------------------------------------------------

const listElement = requireElement("#viewer-list");
const searchElement = requireElement<HTMLInputElement>("#viewer-search");
const titleElement = requireElement("#viewer-title");
const descriptionElement = requireElement("#viewer-description");
const clipElement = requireElement<HTMLSelectElement>("#viewer-clip");
const viewElement = requireElement<HTMLSelectElement>("#viewer-view");
const reportElement = requireElement("#viewer-report");

function renderList(filter = ""): void {
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, ModelEntry[]>();
  for (const entry of MODEL_REGISTRY) {
    if (needle && !`${entry.id} ${entry.label} ${entry.description}`.toLowerCase().includes(needle)) continue;
    const bucket = groups.get(entry.category) ?? [];
    bucket.push(entry);
    groups.set(entry.category, bucket);
  }
  listElement.innerHTML = [...groups.entries()].map(([category, entries]) => `
    <div class="viewer-group">
      <h3>${category}</h3>
      ${entries.map((entry) => `
        <button type="button" data-model="${entry.id}" class="${current?.entry.id === entry.id ? "active" : ""}">
          ${entry.label}
        </button>`).join("")}
    </div>`).join("");
  for (const button of listElement.querySelectorAll<HTMLButtonElement>("button[data-model]")) {
    button.addEventListener("click", () => {
      const id = button.dataset.model;
      if (id) {
        loadModel(id);
        renderList(searchElement.value);
      }
    });
  }
}

function refreshUi(): void {
  if (!current) return;
  titleElement.textContent = `${current.entry.label}  ·  ${current.entry.id}`;
  descriptionElement.textContent = current.entry.description;

  const clips = current.driver?.clips ?? [];
  clipElement.innerHTML = clips.length > 0
    ? clips.map((clip) => `<option value="${clip}">${clip}</option>`).join("")
    : `<option value="">no clips</option>`;
  clipElement.disabled = clips.length === 0;

  const report = inspectModel(current.entry.id);
  const [sx, sy, sz] = report.bounds.size;
  reportElement.textContent = [
    `size        ${sx} × ${sy} × ${sz}`,
    `bounds y    ${report.bounds.min[1]} … ${report.bounds.max[1]}`,
    `geometry    ${report.meshCount} meshes · ${report.triangles} tris · ${report.vertices} verts`,
    `materials   ${report.materials.length}`,
    `named nodes ${report.namedNodes.length}`,
    ...report.warnings.map((warning) => `WARNING     ${warning}`),
  ].join("\n");
}

searchElement.addEventListener("input", () => renderList(searchElement.value));
clipElement.addEventListener("change", () => {
  if (clipElement.value) current?.driver?.setClip(clipElement.value);
  renderOnce();
});
viewElement.addEventListener("change", () => setView(viewElement.value as ViewName));

for (const option of ["grid", "bounds", "joints", "wireframe", "dark", "paused"] as const) {
  const input = document.querySelector<HTMLInputElement>(`#viewer-${option}`);
  input?.addEventListener("change", () => {
    options[option] = input.checked;
    if (option === "wireframe") applyWireframe();
    renderOnce();
  });
}

// -- orbit -------------------------------------------------------------------

let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", (event) => {
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  azimuth -= (event.clientX - lastX) * 0.008;
  elevation = Math.max(-1.4, Math.min(1.45, elevation + (event.clientY - lastY) * 0.006));
  lastX = event.clientX;
  lastY = event.clientY;
  if (view === "turntable") {
    view = "hero";
    viewElement.value = "hero";
  }
  renderOnce();
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  distanceScale = Math.max(0.2, Math.min(4, distanceScale * (1 + Math.sign(event.deltaY) * 0.12)));
  renderOnce();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (event.code === "ArrowRight") advance(1 / 30);
  if (event.code === "ArrowLeft") advance(1 / 30);
  if (event.code === "Space") {
    event.preventDefault();
    paused = !paused;
    renderOnce();
  }
});
window.addEventListener("resize", () => renderOnce());

// -- boot --------------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const requested = params.get("model") ?? MODEL_REGISTRY[0]?.id ?? "cat";
for (const option of ["grid", "bounds", "joints", "wireframe", "dark", "paused", "ui"] as const) {
  const value = params.get(option);
  if (value !== null) {
    options[option] = value !== "0" && value !== "false";
    const input = document.querySelector<HTMLInputElement>(`#viewer-${option}`);
    if (input) input.checked = options[option];
  }
}
if (!options.ui) document.body.classList.add("viewer-chrome-hidden");

renderList();
loadModel(requested);
const activeDriver = (current as { driver?: ModelDriver } | null)?.driver;
const requestedClip = params.get("clip");
if (requestedClip && activeDriver?.clips.includes(requestedClip)) {
  activeDriver.setClip(requestedClip);
  clipElement.value = requestedClip;
}
const requestedView = params.get("view");
if (requestedView && requestedView in VIEW_ANGLES) {
  setView(requestedView as ViewName);
  viewElement.value = requestedView;
}
const requestedTime = Number(params.get("t") ?? 0);
if (Number.isFinite(requestedTime) && requestedTime > 0) advance(requestedTime);

const api: ViewerApi = {
  models: MODEL_REGISTRY.map((entry) => entry.id),
  setModel: (id) => { loadModel(id); renderList(searchElement.value); },
  clips: () => current?.driver?.clips ?? [],
  setClip: (clip) => { current?.driver?.setClip(clip); clipElement.value = clip; renderOnce(); },
  setView,
  setOption: (option, value) => {
    options[option] = value;
    if (option === "wireframe") applyWireframe();
    if (option === "ui") document.body.classList.toggle("viewer-chrome-hidden", !value);
    renderOnce();
  },
  advance,
  renderOnce,
  report: () => inspectModel(current?.entry.id ?? requested),
  ready: Promise.resolve(),
};

declare global {
  interface Window {
    catscapadesViewer: ViewerApi;
  }
}
window.catscapadesViewer = api;

requestAnimationFrame(loop);

function requireElement<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
