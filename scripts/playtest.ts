import { runCriticalPath } from "../src/core/level-model";

const result = runCriticalPath();
for (const event of result.events) console.log(`[${event.type}] ${event.message}`);
console.log(`\nProgrammatic playthrough: ${result.snapshot.complete ? "PASS" : "FAIL"} in ${result.decisions} decisions.`);
console.log(`Engagement heuristic: ${result.report.meaningfulEventTypes} event types; up to ${result.report.maximumChoices} valid choices.`);
for (const note of result.report.notes) console.log(`- ${note}`);
if (!result.snapshot.complete || result.events.some((event) => event.type === "rejected")) process.exitCode = 1;
