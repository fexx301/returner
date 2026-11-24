import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/config.mjs";

const fakeChrome = fileURLToPath(new URL("./fake-chrome.mjs", import.meta.url));
const returnerCli = fileURLToPath(new URL("../src/returner.mjs", import.meta.url));
const repairCli = fileURLToPath(new URL("../src/repair.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("included example returner.json configs load cleanly and resolve relative paths", () => {
  const draft = loadConfig(join(repoRoot, "examples/draft/returner.json"));
  assert.equal(draft.old, resolve(repoRoot, "examples/draft/v1"));
  assert.equal(draft.new, resolve(repoRoot, "examples/draft/v2"));
  assert.deepEqual(draft.policy, [resolve(repoRoot, "policies/release-gate.yaml")]);

  const pkimm = loadConfig(join(repoRoot, "examples/pkimm/returner.json"));
  assert.equal(pkimm.old, resolve(repoRoot, "examples/pkimm/.upstream/v1"));
  assert.equal(pkimm.source, resolve(repoRoot, "examples/pkimm/.upstream/candidate-source"));
  assert.equal(pkimm.serve, "site");
  assert.equal(pkimm.agent, "codex");
  assert.equal(pkimm.attempts, "3");
  assert.ok(pkimm["holdout-seed"].includes("5 - Optimized"));
  assert.ok(pkimm["holdout-check"].includes("1 - Initial"));
  assert.deepEqual(pkimm["holdout-secret"], ["5 - Optimized", "1 - Initial", "4 - Managed"]);
  assert.deepEqual(pkimm.reference, [resolve(repoRoot, "examples/pkimm/.upstream/data-1.0.0.yaml")]);
});

test("--config works for returner.mjs and repair.mjs from another cwd, CLI flags override config, and bad configs exit 2", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-cfg-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const cfgDir = join(root, "nested", "app");
  const runCwd = join(root, "elsewhere");
  await mkdir(join(cfgDir, "v1"), { recursive: true });
  await mkdir(join(cfgDir, "v2-broken"), { recursive: true });
  await mkdir(join(cfgDir, "v2-fixed"), { recursive: true });
  await mkdir(runCwd, { recursive: true });
  await writeFile(join(cfgDir, "v1", "index.html"), "old");
  await writeFile(join(cfgDir, "v2-broken", "index.html"), "broken");
  await writeFile(join(cfgDir, "v2-fixed", "index.html"), "fixed");
  await writeFile(join(cfgDir, "ref.txt"), "v1 reference");

  const configPath = join(cfgDir, "returner.json");
  await writeFile(configPath, JSON.stringify({
    old: "./v1",
    new: "./v2-broken",
    source: "./v2-broken",
    promise: "Saved work survives",
    seed: 'Save "{title}" and "{body}"',
    check: 'Check "{title}" and "{body}"',
    holdout: {
      seed: 'Save "{title}" and "{body}" with HOLDOUT_ONLY',
      check: 'Check "{title}" and "{body}" with HOLDOUT_ONLY',
      secrets: ["HOLDOUT_ONLY"],
      fields: ["Holdout Field"],
    },
    agent: "codex",
    attempts: 2,
    reference: ["./ref.txt"],
    note: "Config note",
  }, null, 2));

  // Stand-in kane-cli: passes v1 and v2-fixed, fails v2-broken on returning user.
  await writeFile(join(root, "kane-cli"), `#!/usr/bin/env node
(async () => {
  const field = (f) => process.argv[process.argv.indexOf(f) + 1];
  const task = process.argv.at(-1);
  const page = await (await fetch(field('--url'), { headers: { 'sec-fetch-dest': 'document' } })).text();
  const failed = task.startsWith('Check ') && page !== 'fixed';
  console.log(JSON.stringify({
    type: 'run_end',
    status: failed ? 'failed' : 'passed',
    reason: failed ? 'missing saved work' : 'ok',
    summary: failed ? 'returning user lost work' : 'all good',
    reason_code: failed ? 'assertion_error.final_verification' : 'success.complete',
  }));
  process.exitCode = failed ? 1 : 0;
})();
`, { mode: 0o755 });
  await writeFile(join(root, "claude"), `#!/bin/sh
cat > /dev/null
printf fixed > index.html
`, { mode: 0o755 });

  const env = { ...process.env, PATH: root + ":" + process.env.PATH, CHROME_PATH: fakeChrome };

  // 1. Bad/missing/unknown-key configs exit 2 before any Kane run.
  const missing = spawnSync(process.execPath, [returnerCli, "--config", join(root, "nope.json")], { cwd: runCwd, env, encoding: "utf8" });
  assert.equal(missing.status, 2);
  const badKeyFile = join(root, "bad-key.json");
  await writeFile(badKeyFile, JSON.stringify({ old: "./v1", bogus: true }));
  const badKey = spawnSync(process.execPath, [repairCli, "--config", badKeyFile], { cwd: runCwd, env, encoding: "utf8" });
  assert.equal(badKey.status, 2);
  assert.match(badKey.stderr, /Unknown config key "bogus"/);

  // 2. returner.mjs --config resolves paths relative to config file and reproduces fail (exit 1).
  const failRun = spawnSync(process.execPath, [returnerCli, "--config", configPath], { cwd: runCwd, env, encoding: "utf8", timeout: 30000 });
  assert.equal(failRun.status, 1, failRun.stdout + failRun.stderr);

  // 3. Explicit CLI --new overrides config's "new" (v2-broken -> v2-fixed) and passes (exit 0).
  const overrideRun = spawnSync(process.execPath, [returnerCli, "--config", configPath, "--new", join(cfgDir, "v2-fixed")], { cwd: runCwd, env, encoding: "utf8", timeout: 30000 });
  assert.equal(overrideRun.status, 0, overrideRun.stdout + overrideRun.stderr);

  // 4. repair.mjs --config with --agent claude override (config says codex) runs holdout + reference + fresh and passes.
  const repairRun = spawnSync(process.execPath, [repairCli, "--config", configPath, "--agent", "claude", "--attempts", "1"], { cwd: runCwd, env, encoding: "utf8", timeout: 60000 });
  assert.equal(repairRun.status, 0, repairRun.stdout + repairRun.stderr);
  assert.match(repairRun.stdout, /both returning users \(Profile A and holdout Profile B\) after attempt 1/);
  const work = repairRun.stdout.match(/^Repair workspace: (.+)$/m)[1];
  const prompt1 = await readFile(join(work, "prompt-1.txt"), "utf8");
  assert.match(prompt1, /Config note/);
  assert.match(prompt1, /ref\.txt/);
  assert.ok(!prompt1.includes("HOLDOUT_ONLY"), "holdout secret from config never leaks into prompt");
});
