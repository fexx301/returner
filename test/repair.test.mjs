import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Stand-in Kane: seeding saves the objective's quoted marker in the profile; a returning user passes only
// when the page is honestly fixed or literally contains the marker this profile saved.
const kane = `#!/usr/bin/env node
(async () => {
  const fs=require('node:fs');
  const field=flag=>process.argv[process.argv.indexOf(flag)+1];
  const task=process.argv.at(-1), path=field('--chrome-profile')+'/marker';
  const page=await (await fetch(field('--url'),{headers:{'sec-fetch-dest':'document'}})).text();
  let failed=false;
  if (task.startsWith('Create a draft')) fs.writeFileSync(path, task.match(/"([^"]+)"/)[1]);
  else { const saved=fs.existsSync(path)?fs.readFileSync(path,'utf8'):''; failed=!(page==='fixed'||(saved&&page.includes(saved))); }
  console.log(JSON.stringify({type:'run_end',status:failed?'failed':'passed',reason:failed?'saved draft missing':'ok',reason_code:failed?'assertion_error.final_verification':'success.complete'}));
  process.exitCode=failed?1:0;
})();
`;

async function setup(agentScript) {
  const root = await mkdtemp(join(tmpdir(), "returner-repair-"));
  await mkdir(join(root, "old"));
  await writeFile(join(root, "old", "index.html"), "old");
  await mkdir(join(root, "source", "site"), { recursive: true });
  await writeFile(join(root, "source", "site", "index.html"), "broken");
  await writeFile(join(root, "kane-cli"), kane, { mode: 0o755 });
  await writeFile(join(root, "claude"), agentScript(root), { mode: 0o755 });
  const repair = fileURLToPath(new URL("../src/repair.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [repair, "--old", "old", "--source", "source", "--serve", "site", "--promise", "draft survives", "--agent", "claude", "--attempts", "2"], {
    cwd: root, env: { ...process.env, PATH: root + ":" + process.env.PATH }, encoding: "utf8", timeout: 120000,
  });
  const work = r.stdout.match(/^Repair workspace: (.+)$/m)[1];
  const runs = await readdir(join(work, ".returner"));
  let marker;
  for (const run of runs) {
    try { marker = JSON.parse(await readFile(join(work, ".returner", run, "baseline.json"), "utf8")).title; break; } catch {}
  }
  return { root, r, work, marker, prompts: await readFile(join(root, "prompts.log"), "utf8") };
}

test("an honest repair passes the replay and a fresh rehearsal; the agent never sees the marker", async (t) => {
  const { root, r, work, marker, prompts } = await setup((root) => `#!/bin/sh
cat >> "${root}/prompts.log"; echo "=====" >> "${root}/prompts.log"
[ "$(grep -c "=====" "${root}/prompts.log")" -ge 2 ] && printf fixed > site/index.html && printf added > site/new-helper.js
exit 0
`);
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /after attempt 2, and a fresh rehearsal with a new marker confirmed it/);
  assert.match(prompts, /saved draft missing/, "the agent sees Kane's reason");
  assert.match(prompts.split("=====")[1], /earlier attempts did not satisfy Kane/, "attempt 2 sees attempt 1's replay");
  assert.ok(marker && !prompts.includes(marker), "the run's marker is redacted from every prompt");
  assert.match(prompts, /<saved title>/);
  assert.equal(await readFile(join(root, "source", "site", "index.html"), "utf8"), "broken", "the original source is untouched");
  assert.match(await readFile(join(work, "repair.diff"), "utf8"), /new-helper\.js/, "files the agent creates are part of the patch");
  const saved = await readFile(join(work, "prompt-1.txt"), "utf8");
  assert.match(saved, /saved draft missing/, "each prompt is saved with the run");
  assert.ok(!saved.includes(marker));
});

test("a fix that hardcodes the saved marker passes the replay but is rejected by the fresh rehearsal", async (t) => {
  // This agent cheats: it reads the hidden baseline from disk and writes its marker into the page.
  const { root, r, prompts } = await setup((root) => `#!/bin/sh
cat >> "${root}/prompts.log"; echo "=====" >> "${root}/prompts.log"
for f in ../.returner/run-*/baseline.json; do node -e "process.stdout.write(require('$PWD/'+process.argv[1]).title)" "$f" > site/index.html && break; done
exit 0
`);
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /passed the replay but failed the fresh rehearsal; rejecting it/);
  assert.match(r.stderr, /did not pass the returning user within the attempt limit/);
  assert.match(prompts.split("=====")[1], /fresh rehearsal with new saved work failed/, "the rejection is fed back to the agent");
});

// The advertised front door, npm run demo:repair, must go through the same safeguards.
async function demoRepair(codexScript) {
  const root = await mkdtemp(join(tmpdir(), "returner-demo-repair-"));
  await writeFile(join(root, "kane-cli"), kane, { mode: 0o755 });
  await writeFile(join(root, "codex"), codexScript(root), { mode: 0o755 });
  const entry = fileURLToPath(new URL("../src/demo-repair.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [entry], { cwd: root, env: { ...process.env, PATH: root + ":" + process.env.PATH }, encoding: "utf8", timeout: 120000 });
  return { root, r };
}

test("npm run demo:repair rejects a hardcoded fix and accepts an honest one only after a fresh rehearsal", async (t) => {
  const cheat = await demoRepair((root) => `#!/bin/sh
cat > /dev/null
for f in ../.returner/run-*/baseline.json; do node -e "process.stdout.write(require('$PWD/'+process.argv[1]).title)" "$f" > index.html && break; done
exit 0
`);
  t.after(() => rm(cheat.root, { recursive: true, force: true }));
  assert.equal(cheat.r.status, 1, cheat.r.stdout + cheat.r.stderr);
  assert.match(cheat.r.stdout, /passed the replay but failed the fresh rehearsal; rejecting it/);

  const honest = await demoRepair(() => `#!/bin/sh
cat > /dev/null
printf fixed > index.html
exit 0
`);
  t.after(() => rm(honest.root, { recursive: true, force: true }));
  assert.equal(honest.r.status, 0, honest.r.stdout + honest.r.stderr);
  assert.match(honest.r.stdout, /a fresh rehearsal with a new marker confirmed it/);
});
