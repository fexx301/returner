import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const fakeChrome = fileURLToPath(new URL("./fake-chrome.mjs", import.meta.url));
const returnerCli = fileURLToPath(new URL("../src/returner.mjs", import.meta.url));
const repairCli = fileURLToPath(new URL("../src/repair.mjs", import.meta.url));
const summaryCli = fileURLToPath(new URL("../src/summary.mjs", import.meta.url));

test("chrome.mjs inspects browser state names via real CDP WebSocket and fails fast on missing CHROME_PATH", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-cdp-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // 1. Bad CHROME_PATH must fail immediately (not wait 30 s for a DevTools port).
  const { openChrome } = await import("../src/chrome.mjs");
  const prev = process.env.CHROME_PATH;
  process.env.CHROME_PATH = join(root, "no-such-chrome");
  const started = Date.now();
  await assert.rejects(() => openChrome(join(root, "p1")), /ENOENT/);
  assert.ok(Date.now() - started < 5000, "invalid CHROME_PATH failed fast");
  if (prev === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = prev;

  // 2. Real WebSocket CDP server: serves /json/version, /json/list, Storage.getCookies, Runtime.evaluate, Browser.close.
  const cdpScript = join(root, "cdp-chrome.mjs");
  await writeFile(cdpScript, `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
const userDataDir = process.argv.find((a) => a.startsWith("--user-data-dir=")).slice(16);
mkdirSync(userDataDir, { recursive: true });
const server = createServer((req, res) => {
  const port = server.address().port;
  if (req.url === "/json/list") {
    return res.end(JSON.stringify([{ type: "page", url: "http://127.0.0.1:43210/", webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/page" }]));
  }
  res.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/browser", userDataDir }));
});
server.on("upgrade", (req, socket) => {
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n");
  socket.on("data", (buf) => {
    if ((buf[0] & 0x0f) !== 1) return;
    let len = buf[1] & 0x7f, offset = 2;
    if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
    const mask = buf.subarray(offset, offset + 4);
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = buf[offset + 4 + i] ^ mask[i % 4];
    const msg = JSON.parse(out.toString("utf8"));
    let result = {};
    if (msg.method === "Storage.getCookies") result = { cookies: [{ name: "draft", domain: "127.0.0.1", value: "SECRET_SHOULD_NOT_APPEAR" }, { name: "other", domain: "example.com" }] };
    if (msg.method === "Runtime.evaluate") result = { result: { value: { localStorage: ["fieldnotes.v1"], sessionStorage: [], indexedDB: ["notes-db"] } } };
    const payload = Buffer.from(JSON.stringify({ id: msg.id, result }));
    const hdr = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
    socket.write(Buffer.concat([hdr, payload]));
    if (msg.method === "Browser.close") process.exit(0);
  });
});
server.listen(0, "127.0.0.1", () => writeFileSync(userDataDir + "/DevToolsActivePort", server.address().port + "\\n/browser\\n"));
`, { mode: 0o755 });

  process.env.CHROME_PATH = cdpScript;
  try {
    const chrome = await openChrome(join(root, "p2"));
    const state = await chrome.inspect("http://127.0.0.1:43210");
    await chrome.close();
    assert.deepEqual(state, {
      localStorage: ["fieldnotes.v1"],
      sessionStorage: [],
      cookies: ["draft"],
      indexedDB: ["notes-db"],
    });
    assert.ok(!JSON.stringify(state).includes("SECRET_SHOULD_NOT_APPEAR"), "cookie values are never recorded");
  } finally {
    if (prev === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = prev;
  }
});

test("evidence merge, --policy preflight lint + verdict escalation, storage X-ray report, and summary rendering", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const build of ["old", "fixed"]) {
    await mkdir(join(root, build));
    await writeFile(join(root, build, "index.html"), build);
  }
  await writeFile(join(root, "good.yaml"), "policy: release-gate\n");
  await writeFile(join(root, "bad.yaml"), "invalid\n");

  // Stand-in kane-cli supporting run, evidence lint-policy, and evidence merge --policy.
  await writeFile(join(root, "kane-cli"), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'evidence' && args[1] === 'lint-policy') {
  const bad = args.some((a) => a.endsWith('bad.yaml'));
  if (bad) { console.error('invalid policy'); process.exit(1); }
  console.log(JSON.stringify({ valid: true }));
  process.exit(0);
}
if (args[0] === 'evidence' && args[1] === 'merge') {
  const out = args[args.indexOf('-o') + 1];
  fs.writeFileSync(out, 'MERGED_PACK');
  const failPolicy = process.env.FAIL_POLICY === '1';
  const result = failPolicy ? 'fail' : 'pass';
  console.log(JSON.stringify({
    merged: out,
    verdict: {
      result,
      exit_code: failPolicy ? 1 : 0,
      policies: [{ id: 'returner-release-gate', result, failed_gate_ids: failPolicy ? ['every-check-asserts'] : [], errored_gate_ids: [] }],
    },
  }));
  process.exit(failPolicy ? 1 : 0);
}
(async () => {
  const field = (f) => process.argv[process.argv.indexOf(f) + 1];
  const url = field('--url');
  await fetch(url, { headers: { 'sec-fetch-dest': 'document' } });
  const sid = 'sess-' + Math.random().toString(16).slice(2, 8);
  const sdir = path.join(process.env.HOME, '.testmuai', 'kaneai', 'sessions', sid);
  fs.mkdirSync(path.join(sdir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(sdir, 'evidence', sid + '.evidence'), 'ZIP');
  console.log(JSON.stringify({
    type: 'run_end',
    status: 'passed',
    reason_code: 'success.complete',
    summary: 'All checks passed',
    duration: 12.4,
    credits_consumed: 10.5,
    test_url: 'https://test-manager.lambdatest.com/projects/1/test-cases/2',
    session_dir: sdir,
  }));
})();
`, { mode: 0o755 });

  const env = { ...process.env, HOME: root, PATH: root + ":" + process.env.PATH, CHROME_PATH: fakeChrome };
  const runReturner = (extra, extraEnv = {}) => spawnSync(process.execPath, [returnerCli, ...extra], {
    cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 30000,
  });

  // 1. Bad policy fails lint immediately with exit 2 before creating a run.
  const bad = runReturner(["--old", "old", "--new", "fixed", "--promise", "p", "--policy", "bad.yaml"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Invalid Kane CLI policy/);

  // 2. Passing policy seals rehearsal.evidence and renders policy + evidence serve in report.html and summary.mjs.
  const pass = runReturner(["--old", "old", "--new", "fixed", "--promise", "draft survives", "--policy", "good.yaml"]);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  const runDir = pass.stdout.match(/^Evidence: (.+)$/m)[1];
  const report = JSON.parse(await readFile(join(runDir, "report.json"), "utf8"));
  assert.equal(report.evidencePack, "rehearsal.evidence");
  assert.equal(report.policyVerdict.result, "pass");
  assert.equal(await readFile(join(runDir, "rehearsal.evidence"), "utf8"), "MERGED_PACK");
  const html = await readFile(join(runDir, "report.html"), "utf8");
  assert.match(html, /kane-cli evidence serve 'rehearsal\.evidence'/);
  assert.match(html, /returner-release-gate/);

  // Summary includes Test Manager link, policy badge, and sealed pack note.
  const sum = spawnSync(process.execPath, [summaryCli, join(runDir, "report.json"), "pass"], { encoding: "utf8" });
  assert.equal(sum.status, 0);
  assert.match(sum.stdout, /\[Test Manager\]\(https:\/\/test-manager\.lambdatest\.com/);
  assert.match(sum.stdout, /Kane CLI policy:/);
  assert.match(sum.stdout, /rehearsal\.evidence/);

  // 3. Failing policy escalates a clean pass (0) to exit 1.
  const fail = runReturner(["--old", "old", "--new", "fixed", "--promise", "draft survives", "--policy", "good.yaml"], { FAIL_POLICY: "1" });
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  const failDir = fail.stdout.match(/^Evidence: (.+)$/m)[1];
  const failReport = JSON.parse(await readFile(join(failDir, "report.json"), "utf8"));
  assert.equal(failReport.verdict, "fail");
  assert.deepEqual(failReport.policyVerdict.policies[0].failedGates, ["every-check-asserts"]);
});

test("repair.mjs generates a self-contained repair-report.html with diff, attempts, and redacted prompt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returner-rephtml-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "old"));
  await writeFile(join(root, "old", "index.html"), "old");
  await mkdir(join(root, "source"));
  await writeFile(join(root, "source", "index.html"), "broken");
  await writeFile(join(root, "kane-cli"), `#!/usr/bin/env node
(async () => {
  const fs = require('node:fs');
  const field = (f) => process.argv[process.argv.indexOf(f) + 1];
  const task = process.argv.at(-1);
  const profile = (await (await fetch(field('--cdp-endpoint') + '/json/version')).json()).userDataDir;
  const page = await (await fetch(field('--url'), { headers: { 'sec-fetch-dest': 'document' } })).text();
  let failed = false;
  if (task.startsWith('Create a draft')) fs.writeFileSync(profile + '/marker', task.match(/"([^"]+)"/)[1]);
  else failed = page !== 'fixed';
  console.log(JSON.stringify({ type: 'run_end', status: failed ? 'failed' : 'passed', reason: failed ? 'draft missing' : 'ok', summary: failed ? 'Returning user lost draft' : 'Recovered draft', reason_code: failed ? 'assertion_error.final_verification' : 'success.complete' }));
  process.exitCode = failed ? 1 : 0;
})();
`, { mode: 0o755 });
  await writeFile(join(root, "claude"), `#!/bin/sh\ncat > /dev/null\nprintf fixed > index.html\n`, { mode: 0o755 });

  const r = spawnSync(process.execPath, [repairCli, "--old", "old", "--source", "source", "--promise", "draft survives", "--agent", "claude", "--attempts", "1"], {
    cwd: root,
    env: { ...process.env, PATH: root + ":" + process.env.PATH, CHROME_PATH: fakeChrome },
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Repair report: .+repair-report\.html$/m);
  const work = r.stdout.match(/^Repair workspace: (.+)$/m)[1];
  const html = await readFile(join(work, "repair-report.html"), "utf8");
  assert.match(html, /Repaired and confirmed/);
  assert.match(html, /Untouched replay passed/);
  assert.match(html, /Fresh rehearsal confirmed/);
  assert.match(html, /Full patch \(repair\.diff\)/);
  assert.match(html, /&lt;saved title&gt;/, "embedded prompt has marker redacted");
});
