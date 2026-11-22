import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const fakeChrome = fileURLToPath(new URL("./fake-chrome.mjs", import.meta.url));
const repairCli = fileURLToPath(new URL("../src/repair.mjs", import.meta.url));

// Stand-in Kane for two-profile PKIMM-like assessment contract:
// - Seeding saves { name, answers } into the Chrome profile.
// - On the candidate page:
//   * "broken"   -> crashes for any returning user (v1 profile), works for new users.
//   * "cheat342" -> DELIBERATE INCOMPLETE PATCH: restores fixed 3/4/2 for every returning user.
//   * "honest"   -> restores each returning user's own saved answers.
const kane = `#!/usr/bin/env node
(async () => {
  const fs = require('node:fs');
  const field = (f) => process.argv[process.argv.indexOf(f) + 1];
  const task = process.argv.at(-1);
  const profile = (await (await fetch(field('--cdp-endpoint') + '/json/version')).json()).userDataDir;
  const url = field('--url');
  const page = await (await fetch(url, { headers: { 'sec-fetch-dest': 'document' } })).text();
  const stateFile = profile + '/answers.json';
  const levels = (s) => {
    const sv = s.match(/level "([^"]+)" for "Strategy and Vision"/)?.[1] || s.match(/"Strategy and Vision" is "([^"]+)"/)?.[1];
    const im = s.match(/level "([^"]+)" for "Infrastructure management"/)?.[1] || s.match(/"Infrastructure management" is "([^"]+)"/)?.[1];
    const so = s.match(/level "([^"]+)" for "Sourcing"/)?.[1] || s.match(/"Sourcing" is "([^"]+)"/)?.[1];
    return { sv, im, so };
  };
  if (task.startsWith('SEED:')) {
    const title = task.match(/name="([^"]+)"/)[1];
    fs.writeFileSync(stateFile, JSON.stringify({ title, ...levels(task) }));
    console.log(JSON.stringify({ type: 'run_end', status: 'passed', reason_code: 'success.complete', summary: 'Seeded ' + title }));
    process.exit(0);
  }
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const want = levels(task);
  if (process.env.HOLDOUT_INCONCLUSIVE === '1' && want.sv === '5 - Optimized') {
    process.exit(2);
  }
  let actual;
  if (page === 'broken') {
    console.log(JSON.stringify({ type: 'run_end', status: 'failed', reason_code: 'assertion_error.confirmed_product_bug', reason: 'blank page crash', summary: 'TypeError reading result' }));
    process.exit(1);
  } else if (page === 'cheat342') {
    actual = { sv: '3 - Advanced', im: '4 - Managed', so: '2 - Basic' };
  } else if (page === 'honest') {
    actual = { sv: saved.sv, im: saved.im, so: saved.so };
  } else {
    actual = { sv: 'unknown', im: 'unknown', so: 'unknown' };
  }
  const mismatches = [];
  if (actual.sv !== want.sv) mismatches.push('Strategy and Vision is "' + actual.sv + '" instead of "' + want.sv + '"');
  if (actual.im !== want.im) mismatches.push('Infrastructure management is "' + actual.im + '" instead of "' + want.im + '"');
  if (actual.so !== want.so) mismatches.push('Sourcing is "' + actual.so + '" instead of "' + want.so + '"');
  const failed = mismatches.length > 0;
  console.log(JSON.stringify({
    type: 'run_end',
    status: failed ? 'failed' : 'passed',
    reason_code: failed ? 'assertion_error.final_verification' : 'success.complete',
    reason: failed ? mismatches.join('; ') : 'ok',
    summary: failed ? 'Mismatched answers: ' + mismatches.join('; ') : 'All saved answers match',
  }));
  process.exit(failed ? 1 : 0);
})();
`;

const SEED_A = 'SEED: name="{title}" level "3 - Advanced" for "Strategy and Vision" level "4 - Managed" for "Infrastructure management" level "2 - Basic" for "Sourcing"';
const CHECK_A = 'CHECK: name="{title}" verify "Strategy and Vision" is "3 - Advanced", "Infrastructure management" is "4 - Managed", "Sourcing" is "2 - Basic"';
const SEED_B = 'SEED: name="{title}" level "5 - Optimized" for "Strategy and Vision" level "1 - Initial" for "Infrastructure management" level "4 - Managed" for "Sourcing"';
const CHECK_B = 'CHECK: name="{title}" verify "Strategy and Vision" is "5 - Optimized", "Infrastructure management" is "1 - Initial", "Sourcing" is "4 - Managed"';

async function runTwoProfile(t, agentScript, { attempts = "2", env = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), "returner-two-profile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "old"));
  await writeFile(join(root, "old", "index.html"), "old");
  await mkdir(join(root, "source"));
  await writeFile(join(root, "source", "index.html"), "broken");
  await writeFile(join(root, "kane-cli"), kane, { mode: 0o755 });
  await writeFile(join(root, "codex"), agentScript(root), { mode: 0o755 });
  const r = spawnSync(process.execPath, [
    repairCli,
    "--old", "old",
    "--source", "source",
    "--promise", "Both returning users keep their own answers",
    "--seed", SEED_A,
    "--check", CHECK_A,
    "--holdout-seed", SEED_B,
    "--holdout-check", CHECK_B,
    "--holdout-secret", "5 - Optimized",
    "--holdout-secret", "1 - Initial",
    "--holdout-secret", "4 - Managed",
    "--holdout-field", "Strategy and Vision",
    "--holdout-field", "Infrastructure management",
    "--holdout-field", "Sourcing",
    "--agent", "codex",
    "--attempts", attempts,
  ], {
    cwd: root,
    env: { ...process.env, PATH: root + ":" + process.env.PATH, CHROME_PATH: fakeChrome, ...env },
    encoding: "utf8",
    timeout: 120000,
  });
  const work = r.stdout.match(/^Repair workspace: (.+)$/m)?.[1];
  const holdoutWork = r.stdout.match(/^Holdout workspace: (.+)$/m)?.[1];
  if (holdoutWork) t.after(() => rm(holdoutWork, { recursive: true, force: true }));
  return { root, r, work, holdoutWork };
}

test("DELIBERATE TEST CASE: an incomplete 3/4/2 patch passes Profile A, fails Profile B, is rejected, and never leaks Profile B answers", async (t) => {
  // Attempt 1 writes cheat342 (hardcodes 3/4/2 for everybody); attempt 2 fixes it honestly after learning which fields broke.
  const { root, r, work, holdoutWork } = await runTwoProfile(t, (root) => `#!/bin/sh
cat >> "${root}/prompts.log"; echo "=====" >> "${root}/prompts.log"
if [ "$(grep -c "=====" "${root}/prompts.log")" -eq 1 ]; then
  printf cheat342 > index.html
else
  printf honest > index.html
fi
`, { attempts: "2" });

  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(holdoutWork && !holdoutWork.startsWith(work), "Profile B snapshot lives strictly outside the repair workspace");
  assert.match(r.stdout, /Attempt 1 passed Profile A, but failed the holdout user \(Profile B\); rejecting it/);
  assert.match(r.stdout, /both returning users \(Profile A and holdout Profile B\) after attempt 2/);

  const [p1, p2] = (await readFile(join(root, "prompts.log"), "utf8")).split("=====");
  // Profile B expected values never leak into any prompt.
  for (const p of [p1, p2]) {
    assert.ok(!p.includes("5 - Optimized"), "Profile B level 5 never leaks into prompt");
    assert.ok(!p.includes("1 - Initial"), "Profile B default level 1 never leaks into prompt");
    assert.ok(!p.includes(holdoutWork), "Profile B workspace path never leaks into prompt");
  }
  // Profile A's own expected levels remain intact in prompt 1.
  assert.match(p1, /3 - Advanced/);
  assert.match(p1, /4 - Managed/);
  // Attempt 2 learns WHICH fields were corrupted on Profile B without receiving B's expected values.
  assert.match(p2, /Corrupted or failing field\(s\) mentioned:.*Strategy and Vision.*Infrastructure management.*Sourcing/);
  assert.match(p2, /<holdout saved value>/);

  // work/attempt-1.json records Profile A pass + Profile B fail without leaking Profile B's path or expected values.
  const a1 = JSON.parse(await readFile(join(work, "attempt-1.json"), "utf8"));
  assert.equal(a1.code, 0, "Profile A replay passed on the incomplete 3/4/2 patch");
  assert.equal(a1.holdout.code, 1, "Profile B replay failed on the incomplete 3/4/2 patch");
  assert.ok(!JSON.stringify(a1).includes("5 - Optimized"));
  assert.ok(!JSON.stringify(a1).includes(holdoutWork));

  // repair-report.html records holdout confirmation.
  const html = await readFile(join(work, "repair-report.html"), "utf8");
  assert.match(html, /Holdout user \(Profile B\): pass/);
});

test("DELIBERATE TEST CASE: 1-attempt incomplete 3/4/2 patch is rejected overall (exit 1); inconclusive holdout exits 2", async (t) => {
  const rejected = await runTwoProfile(t, () => `#!/bin/sh\ncat > /dev/null\nprintf cheat342 > index.html\n`, { attempts: "1" });
  assert.equal(rejected.r.status, 1, rejected.r.stdout + rejected.r.stderr);
  assert.match(rejected.r.stdout, /Attempt 1 passed Profile A, but failed the holdout user \(Profile B\); rejecting it/);

  const inc = await runTwoProfile(t, () => `#!/bin/sh\ncat > /dev/null\nprintf honest > index.html\n`, {
    attempts: "1",
    env: { HOLDOUT_INCONCLUSIVE: "1" },
  });
  assert.equal(inc.r.status, 2, inc.r.stdout + inc.r.stderr);
  assert.match(inc.r.stderr, /Holdout replay \(Profile B\) was inconclusive/);
});

test("mismatched --holdout-seed / --holdout-check flags exit 2 before any Kane run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-holdout-flags-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [repairCli, "--old", ".", "--source", ".", "--promise", "p", "--holdout-seed", "s"], {
    cwd: root, encoding: "utf8",
  });
  assert.equal(r.status, 2);
});
