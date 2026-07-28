import * as THREE from "three";
import "./styles.css";
import { InputController } from "./input";
import { CatSchemerGame } from "./game";

const canvas = requireElement<HTMLCanvasElement>("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const input = new InputController();
const game = new CatSchemerGame(
  renderer,
  requireElement("#objectives"),
  requireElement("#prompt"),
  requireElement("#toast"),
  requireElement("#camera-label"),
  requireElement("#success-screen"),
);

const startScreen = requireElement("#start-screen");
requireElement<HTMLButtonElement>("#start-button").addEventListener("click", () => {
  startScreen.classList.remove("visible");
  game.start();
});
requireElement<HTMLButtonElement>("#restart-button").addEventListener("click", () => game.restart());

function frame(): void {
  game.update(input.read());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function requireElement<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
