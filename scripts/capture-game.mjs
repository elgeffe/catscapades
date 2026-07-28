#!/usr/bin/env node
/**
 * Live-game screenshots.
 *
 * The model viewer proves a model is built correctly; this proves the level
 * reads correctly with real lighting, real cameras, and the cat actually in it.
 * It boots the game, dismisses the start screen, optionally drives input for a
 * while, and screenshots — including any console error the page produced.
 *
 * Usage:
 *   node scripts/capture-game.mjs
 *   node scripts/capture-game.mjs --walk "w:2,d:1.5, :0.3" --shots 3
 *   node scripts/capture-game.mjs --at 5.3,-5.2 --walk " :0.2" --name counter-jump
 *   node scripts/capture-game.mjs --debug --out .game-captures --name kitchen
 *
 * --at drops the cat at a world x,z (development builds only) so a specific
 * room or ledge can be photographed without scripting the walk to reach it.
 *
 * --drive uses the same step syntax as --walk but advances the simulation with
 * fixed steps instead of real key presses. Prefer it for anything where timing
 * matters: headless rendering is slow enough that --walk runs in slow motion.
 *
 * --walk takes a comma-separated script of `key:seconds` steps, holding each
 * key for that long and screenshotting afterwards. Keys: w/a/s/d, shift, ctrl,
 * `jump`, `act` (E), `meow` (Q). Chord them with `+`, e.g. `w+d:1.5`.
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const CHROMIUM_PATH = process.env.CATSCAPADES_CHROMIUM
  ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const KEY_NAMES = {
  w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD",
  " ": "Space", jump: "Space", space: "Space", e: "KeyE", act: "KeyE", q: "KeyQ", meow: "KeyQ",
  shift: "ShiftLeft", ctrl: "ControlLeft",
};

const argv = process.argv.slice(2);
const flags = new Map();
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index];
  if (!value.startsWith("--")) continue;
  const next = argv[index + 1];
  flags.set(value.slice(2), next && !next.startsWith("--") ? (index += 1, next) : "true");
}

const outputDir = path.resolve(flags.get("out") ?? ".game-captures");
const width = Number(flags.get("width") ?? 1280);
const quality = flags.get("quality") ?? "low";
const height = Number(flags.get("height") ?? 800);
const name = flags.get("name") ?? "game";
const debug = flags.has("debug");
const walkScript = flags.get("walk") ?? "";
const teleport = flags.get("at");
const driveScript = flags.get("drive") ?? "";

async function main() {
  await mkdir(outputDir, { recursive: true });

  const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;

  const browser = await chromium.launch({
    ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width, height } });

  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(base, { waitUntil: "load" });
  await page.waitForSelector("#start-button", { timeout: 60_000 });

  // Headless Chromium renders through SwiftShader. At high quality the frame
  // rate drops far enough that the clamped fixed-step loop runs the simulation
  // in slow motion, which makes scripted walks meaningless. Low quality keeps
  // capture wall-time proportional to in-game time.
  await page.selectOption("#graphics-quality", quality);
  await page.click("#start-button");
  await page.waitForTimeout(1200);
  if (debug) await page.keyboard.press("Backquote");

  const written = [];
  const shot = async (label) => {
    const file = path.join(outputDir, `${name}__${label}.png`);
    await page.screenshot({ path: file });
    written.push(path.relative(process.cwd(), file));
  };

  if (teleport) {
    const [x, z, y] = teleport.split(",").map(Number);
    await page.evaluate(([px, pz, py]) => window.__catscapades.debugTeleport(px, pz, py), [x, z, y ?? 1.2]);
    await page.waitForTimeout(900);
  }

  await shot("start");

  if (driveScript) {
    const driveSteps = driveScript.split(",").map((step) => step.trim()).filter(Boolean);
    for (const [index, step] of driveSteps.entries()) {
      const separator = step.lastIndexOf(":");
      const rawKeys = step.slice(0, separator);
      const seconds = Number(step.slice(separator + 1));
      const held = rawKeys.split("+").map((raw) => raw.trim().toLowerCase()).filter(Boolean);
      const frame = {
        moveX: (held.includes("d") ? 1 : 0) - (held.includes("a") ? 1 : 0),
        moveY: (held.includes("w") ? 1 : 0) - (held.includes("s") ? 1 : 0),
        run: held.includes("shift"),
        stalk: held.includes("ctrl"),
        pouncePressed: held.includes("jump") || held.includes("space"),
        actionPressed: held.includes("act") || held.includes("e"),
        meowPressed: held.includes("meow") || held.includes("q"),
      };
      await page.evaluate(
        ([duration, input]) => window.__catscapades.debugStep(duration, input),
        [seconds, frame],
      );
      await page.waitForTimeout(120);
      await shot(`drive${index + 1}-${rawKeys.trim() || "idle"}`);
      // Per-step state makes a failed traversal debuggable without guessing
      // which screenshot to stare at.
      const stepState = await page.evaluate(() => window.__catscapades.debugSnapshot());
      const [px, py, pz] = stepState.position ?? [0, 0, 0];
      console.log(`  drive ${index + 1} (${rawKeys || "idle"} ${seconds}s): `
        + `pos ${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)} `
        + `grounded=${stepState.grounded} target=${stepState.jumpTarget ?? "-"}`);
    }
  }

  const steps = walkScript.split(",").map((step) => step.trim()).filter(Boolean);
  for (const [index, step] of steps.entries()) {
    const separator = step.lastIndexOf(":");
    const rawKeys = step.slice(0, separator);
    const seconds = Number(step.slice(separator + 1));
    // "w+d" holds both keys, so diagonal camera-relative routes are scriptable.
    const keys = rawKeys.split("+").map((raw) => {
      const key = KEY_NAMES[raw.toLowerCase()] ?? KEY_NAMES[raw];
      if (!key) throw new Error(`Unknown key "${raw}" in --walk script.`);
      return key;
    });

    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(seconds * 1000);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(220);
    await shot(`step${index + 1}-${rawKeys.trim() || "jump"}`);
  }

  const state = await page.evaluate(() => ({
    prompt: document.querySelector("#prompt")?.textContent ?? "",
    toast: document.querySelector("#toast")?.textContent ?? "",
    debug: document.querySelector("#debug-panel")?.textContent ?? "",
    snapshot: window.__catscapades?.debugSnapshot?.() ?? null,
  }));

  await browser.close();
  await server.close();

  console.log(`Captured ${written.length} screenshot(s) into ${path.relative(process.cwd(), outputDir) || "."}`);
  for (const file of written) console.log(`  ${file}`);
  if (state.prompt) console.log(`\nPrompt: ${state.prompt}`);
  if (state.toast) console.log(`Toast:  ${state.toast}`);
  if (state.debug) console.log(`\n${state.debug}`);
  if (state.snapshot) console.log(`\nSnapshot: ${JSON.stringify(state.snapshot, null, 2)}`);

  if (consoleErrors.length > 0) {
    console.error(`\n${consoleErrors.length} console error(s):`);
    for (const error of [...new Set(consoleErrors)]) console.error(`  ${error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
