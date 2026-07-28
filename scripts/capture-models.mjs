#!/usr/bin/env node
/**
 * Visual model capture.
 *
 * Boots the Vite dev server, opens the model viewer in headless Chromium, and
 * screenshots registered models through the *same* deterministic API the manual
 * viewer uses. Animation is stepped by fixed increments, never wall time, so a
 * capture of the same model and clip is byte-comparable between runs.
 *
 * Usage:
 *   node scripts/capture-models.mjs                    hero shot of every model
 *   node scripts/capture-models.mjs cat                every view of one model
 *   node scripts/capture-models.mjs cat --clips        every clip, sampled
 *   node scripts/capture-models.mjs cat --views side,front --time 0.8
 *   node scripts/capture-models.mjs --out .capture --width 900 --height 700
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const CHROMIUM_PATH = process.env.CATSCAPADES_CHROMIUM
  ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const argv = process.argv.slice(2);
const flags = new Map();
const targets = [];
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index];
  if (!value.startsWith("--")) {
    targets.push(value);
    continue;
  }
  const name = value.slice(2);
  const next = argv[index + 1];
  if (next && !next.startsWith("--")) {
    flags.set(name, next);
    index += 1;
  } else {
    flags.set(name, "true");
  }
}

const outputDir = path.resolve(flags.get("out") ?? ".model-captures");
const width = Number(flags.get("width") ?? 800);
const height = Number(flags.get("height") ?? 640);
const captureTime = Number(flags.get("time") ?? 0.9);
const withClips = flags.has("clips");
const requestedViews = (flags.get("views") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const clean = flags.has("clean");

async function main() {
  if (clean && existsSync(outputDir)) await rm(outputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const server = await createServer({
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "error",
    optimizeDeps: { force: false },
  });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;

  const browser = await chromium.launch({
    ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(`${base}/viewer.html?ui=0&paused=1`, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.catscapadesViewer), null, { timeout: 60_000 });

  const allModels = await page.evaluate(() => window.catscapadesViewer.models);
  const models = targets.length > 0 ? targets : allModels;
  for (const model of models) {
    if (!allModels.includes(model)) {
      throw new Error(`Unknown model "${model}". Known: ${allModels.join(", ")}`);
    }
  }

  const singleModel = targets.length === 1;
  const views = requestedViews.length > 0
    ? requestedViews
    : singleModel ? ["hero", "front", "side", "top"] : ["hero"];

  const written = [];
  for (const model of models) {
    await page.evaluate((id) => window.catscapadesViewer.setModel(id), model);
    const clips = await page.evaluate(() => window.catscapadesViewer.clips());
    const clipList = withClips && clips.length > 0 ? clips : [null];

    for (const clip of clipList) {
      if (clip) await page.evaluate((value) => window.catscapadesViewer.setClip(value), clip);
      for (const view of views) {
        await page.evaluate(([viewName, seconds]) => {
          window.catscapadesViewer.setView(viewName);
          window.catscapadesViewer.advance(seconds);
        }, [view, captureTime]);

        const name = [model, clip, view].filter(Boolean).join("__");
        const file = path.join(outputDir, `${name}.png`);
        await page.screenshot({ path: file });
        written.push(path.relative(process.cwd(), file));
      }
    }

    const report = await page.evaluate(() => window.catscapadesViewer.report());
    if (report.warnings.length > 0) {
      console.log(`  ${model}: ${report.warnings.length} warning(s)`);
      for (const warning of report.warnings) console.log(`    ${warning}`);
    }
  }

  await browser.close();
  await server.close();

  console.log(`\nCaptured ${written.length} image(s) into ${path.relative(process.cwd(), outputDir) || "."}`);
  for (const file of written) console.log(`  ${file}`);

  if (consoleErrors.length > 0) {
    console.error(`\n${consoleErrors.length} browser console error(s):`);
    for (const error of [...new Set(consoleErrors)]) console.error(`  ${error}`);
    process.exitCode = 1;
  }

  const files = await readdir(outputDir);
  if (files.length === 0) {
    console.error("No screenshots were produced.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
