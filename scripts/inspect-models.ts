/**
 * Headless model inspector.
 *
 * Usage:
 *   npm run models                     list every registered model
 *   npm run models -- cat              full report for one model
 *   npm run models -- cat --clips      report plus every animation clip
 *   npm run models -- --all            report every model (audit mode)
 *   npm run models -- cat --json       machine-readable output
 */
import { inspectAll, inspectClip, inspectModel, type ClipReport, type ModelReport } from "../src/models/inspect";
import { MODEL_REGISTRY, findModel } from "../src/models/registry";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((value) => value.startsWith("--")));
const targets = argv.filter((value) => !value.startsWith("--"));
const asJson = flags.has("--json");
const withClips = flags.has("--clips");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (targets.length === 0 && !flags.has("--all")) {
  if (asJson) {
    console.log(JSON.stringify(MODEL_REGISTRY.map(({ id, label, category, description }) => ({
      id, label, category, description,
    })), null, 2));
  } else {
    console.log("Registered models\n");
    let currentCategory = "";
    for (const entry of MODEL_REGISTRY) {
      if (entry.category !== currentCategory) {
        currentCategory = entry.category;
        console.log(`  ${currentCategory.toUpperCase()}`);
      }
      console.log(`    ${entry.id.padEnd(18)} ${entry.description}`);
    }
    console.log("\nInspect one with:  npm run models -- <id> --clips");
  }
  process.exit(0);
}

const ids = flags.has("--all") ? MODEL_REGISTRY.map((entry) => entry.id) : targets;
for (const id of ids) {
  if (!findModel(id)) fail(`Unknown model "${id}". Run "npm run models" to list them.`);
}

const reports = ids.map((id) => {
  const report = inspectModel(id);
  const clips = withClips
    ? report.clips.map((clip) => inspectClip(id, clip))
    : [];
  return { report, clips };
});

if (asJson) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const { report, clips } of reports) {
    printReport(report);
    for (const clip of clips) printClip(clip);
  }
}

const warningCount = reports.reduce(
  (total, entry) => total + entry.report.warnings.length + entry.clips.reduce((sum, clip) => sum + clip.warnings.length, 0),
  0,
);
if (warningCount > 0) {
  console.error(`\n${warningCount} warning(s) reported.`);
  process.exitCode = 1;
}

function printReport(report: ModelReport): void {
  const [sx, sy, sz] = report.bounds.size;
  console.log(`\n=== ${report.label}  (${report.id}, ${report.category}, ${report.mount}-mounted) ===`);
  console.log(report.description);
  console.log(`  size        ${sx} x ${sy} x ${sz}  (w x h x d)`);
  console.log(`  bounds min  ${report.bounds.min.join(", ")}`);
  console.log(`  bounds max  ${report.bounds.max.join(", ")}`);
  console.log(`  ground gap  ${report.groundOffset}`);
  console.log(`  geometry    ${report.meshCount} meshes, ${report.triangles} tris, ${report.vertices} verts, ${report.uniqueGeometries} unique geometries`);
  console.log(`  objects     ${report.objectCount} nodes, ${report.namedNodes.length} named`);
  console.log(`  materials   ${report.materials.length}`);
  for (const material of report.materials.slice(0, 8)) {
    console.log(`    ${material.color}  rough ${material.roughness}  metal ${material.metalness}  x${material.usedBy}${material.transparent ? "  transparent" : ""}`);
  }
  if (report.namedNodes.length > 0) {
    console.log("  named nodes");
    for (const node of report.namedNodes) {
      const indent = "  ".repeat(node.depth);
      console.log(`    ${indent}${node.name}  @ ${node.position.join(", ")}  (${node.children} children, ${node.triangles} tris)`);
    }
  }
  if (report.clips.length > 0) console.log(`  clips       ${report.clips.join(", ")}`);
  for (const warning of report.warnings) console.log(`  WARNING     ${warning}`);
}

function printClip(clip: ClipReport): void {
  console.log(`  -- clip "${clip.clip}" over ${clip.frames} frames`);
  console.log(`     motion range   ${clip.motionRange.join(" x ")}`);
  console.log(`     peak frame Δ   ${clip.peakFrameDelta}`);
  console.log(`     joints moving  ${clip.movingJoints}`);
  if (clip.staticJoints.length > 0) {
    console.log(`     joints static  ${clip.staticJoints.slice(0, 12).join(", ")}${clip.staticJoints.length > 12 ? ` (+${clip.staticJoints.length - 12} more)` : ""}`);
  }
  for (const warning of clip.warnings) console.log(`     WARNING        ${warning}`);
}
