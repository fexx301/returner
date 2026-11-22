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
  const root = await mkdtemp(join(tmpdir(), "returner's contract-"));
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
  const failedReport = JSON.parse(await readFile(join(baseline, "report.json"), "utf8"));
  assert.match(first.stdout, /--replay/, "the terminal prints the exact replay command");
  assert.ok(!failedReport.replay.includes(process.execPath) && !failedReport.replay.includes(root), "the shared report carries no absolute local paths");
  assert.match(failedReport.replay, /--replay/);
  const original = await readFile(
    join(baseline, "old-profile", "draft"),
    "utf8",
  );
  await writeFile(join(root, "broken", "index.html"), "fixed");
  const second = spawnSync("/bin/sh", ["-c", failedReport.replay], {
    cwd: root, env: {...process.env, PATH: root + ":" + process.env.PATH},
    encoding: "utf8", timeout: 30000,
  });
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

// A usage mistake must never read as the regression verdict (1), and must not spend Kane credits.
test("bad flags and attempt counts exit 2 before any Kane run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-usage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "kane-cli"), `#!/bin/sh\ntouch "${root}/kane-ran"\nexit 1\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: root + ":" + process.env.PATH };
  const node = (file, args) => spawnSync(process.execPath, [fileURLToPath(new URL(`../src/${file}`, import.meta.url)), ...args], { cwd: root, env, encoding: "utf8", timeout: 30000 });
  assert.equal(node("returner.mjs", ["--unknown-flag"]).status, 2);
  assert.equal(node("repair.mjs", ["--unknown-flag"]).status, 2);
  for (const attempts of ["0", "-1", "abc"])
    assert.equal(node("repair.mjs", ["--old", ".", "--source", ".", "--promise", "p", "--attempts", attempts]).status, 2, attempts);
  await assert.rejects(readFile(join(root, "kane-ran")), "no Kane run was started");
});

// Kane's sealed evidence pack is a zip; its console log's errors and screenshots (.jpg or .png) are extracted.
test("console errors and png screenshots are read from Kane's evidence pack", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "returner-pack-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, ".testmuai", "kaneai", "sessions", "s1", "evidence");
  await mkdir(join(dir, "tests", "t", "logs"), { recursive: true });
  await mkdir(join(dir, "tests", "t", "steps", "2-0-a"), { recursive: true });
  const line = (level, text) => JSON.stringify({ level, text });
  await writeFile(join(dir, "tests", "t", "logs", "0-console.ndjson"),
    [JSON.stringify({ marker: "step" }), line("error", "boom"), line("warning", "meh"), line("error", "boom"), "not json"].join("\n"));
  await writeFile(join(dir, "tests", "t", "steps", "2-0-a", "screenshot.png"), "PNGDATA");
  assert.equal(spawnSync("zip", ["-qr", "p.evidence", "tests"], { cwd: dir }).status, 0);
  const shots = new URL("../src/shots.mjs", import.meta.url).href;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { attachShot, consoleErrors } from ${JSON.stringify(shots)}; console.log(JSON.stringify({ errors: consoleErrors("s1"), missing: consoleErrors("missing"), shot: attachShot("s1", ${JSON.stringify(home)}, "returning user") }))`],
    { env: { ...process.env, HOME: home }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout.trim()), { errors: ["boom"], missing: [], shot: "shots/returning-user.png" }, r.stderr);
  assert.equal(await readFile(join(home, "shots", "returning-user.png"), "utf8"), "PNGDATA");
});

// Client-side routed SPAs must survive reloads while missing assets and dotfiles stay 404.
test("server falls back to index.html for extensionless HTML routes, not missing assets or dotfiles", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-spa-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "index.html"), "<main>spa</main>");
  await writeFile(join(root, ".env"), "SECRET=1");
  const { serve } = await import("../src/server.mjs");
  const server = await serve(0);
  t.after(() => server.close());
  await server.use(root);
  const base = "http://127.0.0.1:" + server.port;
  const nav = await fetch(base + "/notes/123", { headers: { "sec-fetch-dest": "document" } });
  assert.equal(nav.status, 200);
  assert.equal(await nav.text(), "<main>spa</main>");
  assert.equal(server.documents(), 1);
  assert.equal((await fetch(base + "/missing.js", { headers: { accept: "text/html" } })).status, 404);
  assert.equal((await fetch(base + "/notes/123", { headers: { accept: "application/json" } })).status, 404);
  assert.equal((await fetch(base + "/.env", { headers: { "sec-fetch-dest": "document" } })).status, 404);
});
