import * as THREE from "three";
import "./styles.css";
import { InputController } from "./input";
import { CatscapadesGame } from "./game";
import { loadSettings, saveSettings, type GameSettings } from "./settings";

const canvas = requireElement<HTMLCanvasElement>("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

let settings = loadSettings();
const input = new InputController((method) => document.body.dataset.input = method);
const game = await CatscapadesGame.create(
  renderer,
  requireElement("#objectives"),
  requireElement("#prompt"),
  requireElement("#toast"),
  requireElement("#camera-label"),
  requireElement("#success-screen"),
);
game.applySettings(settings);

const pauseScreen = requireElement("#pause-screen");
let paused = false;
const setPaused = (value: boolean): void => {
  paused = value;
  game.setPaused(value);
  pauseScreen.classList.toggle("visible", value);
};
requireElement<HTMLButtonElement>("#resume-button").addEventListener("click", () => setPaused(false));
requireElement<HTMLButtonElement>("#pause-restart-button").addEventListener("click", () => game.restart());

const bindSettings = (): void => {
  const master = requireElement<HTMLInputElement>("#master-volume");
  const effects = requireElement<HTMLInputElement>("#effects-volume");
  const music = requireElement<HTMLInputElement>("#music-volume");
  const graphics = requireElement<HTMLSelectElement>("#graphics-quality");
  const reducedMotion = requireElement<HTMLInputElement>("#reduced-motion");
  const highContrast = requireElement<HTMLInputElement>("#high-contrast");
  master.value = String(settings.masterVolume);
  effects.value = String(settings.effectsVolume);
  music.value = String(settings.musicVolume);
  graphics.value = settings.graphics;
  reducedMotion.checked = settings.reducedMotion;
  highContrast.checked = settings.highContrast;
  const update = (): void => {
    settings = {
      masterVolume: Number(master.value),
      effectsVolume: Number(effects.value),
      musicVolume: Number(music.value),
      graphics: graphics.value as GameSettings["graphics"],
      reducedMotion: reducedMotion.checked,
      highContrast: highContrast.checked,
    };
    saveSettings(settings);
    game.applySettings(settings);
  };
  [master, effects, music, graphics, reducedMotion, highContrast]
    .forEach((element) => element.addEventListener("change", update));
  master.addEventListener("input", update);
  effects.addEventListener("input", update);
  music.addEventListener("input", update);
};
bindSettings();

// Development-only handle used by the capture tooling in `scripts/`.
if (import.meta.env.DEV) {
  (window as unknown as { __catscapades?: unknown }).__catscapades = game;
}

const startScreen = requireElement("#start-screen");
requireElement<HTMLButtonElement>("#start-button").addEventListener("click", () => {
  startScreen.classList.remove("visible");
  game.start();
});
requireElement<HTMLButtonElement>("#restart-button").addEventListener("click", () => game.restart());

function frame(): void {
  const frameInput = input.read();
  if (frameInput.pausePressed && game.hasStarted()) setPaused(!paused);
  if (frameInput.debugPressed) game.toggleDebug();
  game.update(frameInput);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.hasStarted()) setPaused(true);
});

function requireElement<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
