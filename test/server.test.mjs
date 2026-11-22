import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, cp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

// Proxy mode with the Quillpad fixture: a server-rendered app whose draft lives in a cookie.
// Stand-in Kane: a cookie jar in the profile, real form posts, and redirects it must see on Returner's origin.
const kane = `#!/usr/bin/env node
(async () => {
  const fs=require('node:fs');
  const field=flag=>process.argv[process.argv.indexOf(flag)+1];
  const url=field('--url'), task=process.argv.at(-1), jarFile=field('--chrome-profile')+'/cookies';
  const [title, body] = [...task.matchAll(/"([^"]+)"/g)].map(m=>m[1]);
  let jar=fs.existsSync(jarFile)?fs.readFileSync(jarFile,'utf8'):'';
  const get=async()=>{const r=await fetch(url+'/',{headers:{cookie:jar,'sec-fetch-dest':'document'}});return {status:r.status,text:await r.text()};};
  const save=async(t,b)=>{const r=await fetch(url+'/save',{method:'POST',redirect:'manual',headers:{cookie:jar,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({title:t,body:b})});
    if(r.headers.get('location')!=='/') throw Error('redirect left Returner origin: '+r.headers.get('location'));
    jar=r.headers.get('set-cookie').split(';')[0]; fs.writeFileSync(jarFile,jar);};
  let ok;
  if (task.startsWith('Create a draft')) { await save(title, body); const p=await get(); ok=p.text.includes(title); }
  else if (task.startsWith('Read the existing draft')) ok=(await get()).text.includes(body); // the read-back objective quotes the edited body
  else { const p=await get(); ok=p.status===200&&p.text.includes(title)&&p.text.includes(body); if(ok) await save(title, body+' EDITED'); }
  console.log(JSON.stringify({type:'run_end',status:ok?'passed':'failed',reason:ok?'ok':'draft missing',reason_code:ok?'success.complete':'assertion_error.final_verification'}));
  process.exitCode=ok?0:1;
})();
`;
const fixture = (v) => fileURLToPath(new URL(`../examples/server/${v}`, import.meta.url));
const freePort = () => new Promise((done) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => done(port)); }); });
async function app(t, dir, port) {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  t.after(() => child.kill());
  for (let i = 0; i < 50 && !(await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)); i++) await new Promise((r) => setTimeout(r, 100));
  return `http://127.0.0.1:${port}`;
}
async function root(t) {
  const dir = await mkdtemp(join(tmpdir(), "returner-proxy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "kane-cli"), kane, { mode: 0o755 });
  return dir;
}
const run = (dir, script, args) => spawnSync(process.execPath, [fileURLToPath(new URL(`../src/${script}`, import.meta.url)), ...args],
  { cwd: dir, env: { ...process.env, PATH: dir + ":" + process.env.PATH }, encoding: "utf8", timeout: 120000 });

test("proxy mode: a running app's cookies cross the release at one origin, and a URL replays", async (t) => {
  const dir = await root(t);
  const v1 = await app(t, fixture("v1"), await freePort());
  const v2 = await app(t, fixture("v2-broken"), await freePort());
  const first = run(dir, "returner.mjs", ["--old", v1, "--new", v2, "--promise", "draft survives"]);
  assert.equal(first.status, 1, first.stdout + first.stderr);
  const baseline = first.stdout.match(/^Evidence: (.+)$/m)[1];
  const report = JSON.parse(await readFile(join(baseline, "report.json"), "utf8"));
  assert.deepEqual(report.results.map((r) => [r.name, r.status]), [["old baseline", "pass"], ["new user", "pass"], ["returning user", "fail"]]);
  assert.ok(report.results.every((r) => r.loaded), "proxied documents count as loaded");
  assert.ok(report.replay.endsWith(`'--new' '${v2}'`), "the replay command keeps the URL: " + report.replay);
  const replay = run(dir, "returner.mjs", ["--replay", baseline, "--new", v1]); // v1 reads its own cookie: stands in for a fix
  assert.equal(replay.status, 0, replay.stdout + replay.stderr);
  assert.equal(run(dir, "returner.mjs", ["--old", "http://127.0.0.1:9", "--new", v2, "--promise", "p"]).status, 2, "an app that is not running is inconclusive");
});

test("repair --start: the agent sees the server's crash, and its fix is started, replayed and confirmed", async (t) => {
  const dir = await root(t);
  await cp(fixture("v2-broken"), join(dir, "source"), { recursive: true });
  const v1 = await app(t, fixture("v1"), await freePort());
  const port = await freePort();
  // Honest repair: read either cookie format (here, by going back to v1's reader).
  await writeFile(join(dir, "claude"), `#!/bin/sh\ncat >> "${dir}/prompts.log"\ncp "${fixture("v1")}/server.mjs" server.mjs\n`, { mode: 0o755 });
  const r = run(dir, "repair.mjs", ["--old", v1, "--source", "source", "--start", `PORT=${port} node server.mjs`, "--serve", `http://127.0.0.1:${port}`,
    "--promise", "draft survives", "--agent", "claude", "--attempts", "1"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const prompts = await readFile(join(dir, "prompts.log"), "utf8");
  assert.match(prompts, /app server's output[\s\S]*SyntaxError/, "the server's stack trace reaches the agent");
  assert.equal(await fetch(`http://127.0.0.1:${port}/`).then(() => "up", () => "down"), "down", "the candidate is stopped afterwards");
  assert.equal(run(dir, "repair.mjs", ["--old", v1, "--source", "source", "--start", "true", "--serve", "dist", "--promise", "p"]).status, 2, "--start needs a URL to serve");
});
