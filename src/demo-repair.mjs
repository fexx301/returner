#!/usr/bin/env node
// npm run demo:repair: the tested repair loop (src/repair.mjs) on the bundled Fieldnotes fixture, so the demo gets
// marker redaction and fresh-rehearsal confirmation. Agent: codex by default, RETURNER_AGENT=claude for Claude Code.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const result = spawnSync(process.execPath, [
  at("./repair.mjs"),
  "--old", at("../examples/draft/v1"),
  "--source", at("../examples/draft/v2-broken"),
  "--promise", "My draft survives the release",
  "--agent", process.env.RETURNER_AGENT || "codex",
  "--attempts", "3",
  "--reference", at("../examples/draft/v1/draft.js"),
  "--note", "This is a static draft editor (index.html and draft.js). The previous release's draft.js is the reference file.",
], { stdio: "inherit" });
process.exitCode = result.status ?? 2;
