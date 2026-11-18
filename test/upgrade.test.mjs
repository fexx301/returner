import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// A local stand-in exercises the CLI's origin, snapshot and exit-code contract.
// Live Kane evidence is recorded separately in evidence/.
test("a replay uses the same origin and an untouched profile; partial runs are inconclusive", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const build of ["old", "broken", "fixed"]) {
    await mkdir(join(root, build));
    await writeFile(join(root, build, "index.html"), build);
  }
  await writeFile(
    join(root, "kane-cli"),
    `#!/usr/bin/env node
(async () => {
  const fs=require('node:fs');
  const field=flag=>process.argv[process.argv.indexOf(flag)+1];
  const url=field('--url'), path=field('--chrome-profile')+'/draft';
  const build=await (await fetch(url,{headers:{'sec-fetch-dest':'document'}})).text();
  if(process.env.RETURNER_TEST_INTERRUPT) process.exit(2);
  const previous=fs.existsSync(path)?fs.readFileSync(path,'utf8'):null;
  const readback=process.argv.at(-1).startsWith('Read the existing draft without typing');
  const failed=readback ? previous!=='edited during check' : previous!==null && (previous!==url || build==='broken');
  fs.writeFileSync(path, previous===null ? url : 'edited during check');
  console.log(JSON.stringify({type:'run_end',status:failed?'failed':'passed',reason_code:failed?'assertion_error.final_verification':'success.complete'}));
  process.exitCode=failed?1:0;
})();
`,
    { mode: 0o755 },
  );
  const cli = fileURLToPath(new URL("../src/returner.mjs", import.meta.url));
  function run(args, env = {}) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, PATH: root + ":" + process.env.PATH, ...env },
      encoding: "utf8",
      timeout: 30000,
    });
  }
  const first = run([
    "--old",
    "old",
    "--new",
    "broken",
    "--promise",
    "draft survives",
  ]);
  assert.equal(first.status, 1, first.stderr);
  const baseline = first.stdout.match(/^Evidence: (.+)$/m)[1];
  const original = await readFile(
    join(baseline, "old-profile", "draft"),
    "utf8",
  );
  const second = run(["--replay", baseline, "--new", "fixed"]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(
    await readFile(join(baseline, "old-profile", "draft"), "utf8"),
    original,
  );
  const interrupted = run(["--replay", baseline, "--new", "fixed"], {
    RETURNER_TEST_INTERRUPT: "1",
  });
  assert.equal(interrupted.status, 2, interrupted.stderr);
});
