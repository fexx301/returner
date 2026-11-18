import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Stand-ins: Kane fails a returning profile while the app says "broken"; the agent fixes it only on its
// second attempt, so the loop must feed the first replay's failure back and try again.
test("the repair loop feeds each Kane verdict back to the agent until the replay passes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-repair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "old"));
  await writeFile(join(root, "old", "index.html"), "old");
  await mkdir(join(root, "source", "site"), { recursive: true });
  await writeFile(join(root, "source", "site", "index.html"), "broken");
  await writeFile(join(root, "kane-cli"), `#!/usr/bin/env node
(async () => {
  const fs=require('node:fs');
  const field=flag=>process.argv[process.argv.indexOf(flag)+1];
  const path=field('--chrome-profile')+'/draft';
  const build=await (await fetch(field('--url'),{headers:{'sec-fetch-dest':'document'}})).text();
  const previous=fs.existsSync(path);
  fs.writeFileSync(path,'saved');
  const failed=previous && build==='broken';
  console.log(JSON.stringify({type:'run_end',status:failed?'failed':'passed',reason:failed?'saved draft missing':'ok',reason_code:failed?'assertion_error.final_verification':'success.complete'}));
  process.exitCode=failed?1:0;
})();
`, { mode: 0o755 });
  await writeFile(join(root, "claude"), `#!/bin/sh
prompt=$(cat)
echo "$prompt" >> "${root}/prompts.log"
echo "=====" >> "${root}/prompts.log"
n=$(grep -c "=====" "${root}/prompts.log")
[ "$n" -ge 2 ] && printf fixed > site/index.html && printf added > site/new-helper.js
exit 0
`, { mode: 0o755 });
  const repair = fileURLToPath(new URL("../src/repair.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [repair, "--old", "old", "--source", "source", "--serve", "site", "--promise", "draft survives", "--agent", "claude", "--attempts", "3"], {
    cwd: root, env: { ...process.env, PATH: root + ":" + process.env.PATH }, encoding: "utf8", timeout: 60000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /passed the returning user after attempt 2/);
  const prompts = await readFile(join(root, "prompts.log"), "utf8");
  assert.match(prompts, /saved draft missing/, "the agent sees Kane's reason");
  assert.match(prompts.split("=====")[1], /earlier attempts did not satisfy Kane/, "attempt 2 sees attempt 1's replay");
  assert.equal(await readFile(join(root, "source", "site", "index.html"), "utf8"), "broken", "the original source is untouched");
  const work = r.stdout.match(/^Repair workspace: (.+)$/m)[1];
  const diff = await readFile(join(work, "repair.diff"), "utf8");
  assert.match(diff, /new-helper\.js/, "files the agent creates are part of the patch");
});
