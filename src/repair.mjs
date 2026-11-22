#!/usr/bin/env node
// Closed repair loop for any app: rehearse the release, hand Kane's returning-user verdict to a coding
// agent, rebuild, and replay from the untouched baseline profile until Kane passes or attempts run out.
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isUrl } from "./server.mjs";
import { describeStorage } from "./report.mjs";
import { writeRepairReport } from "./repair-report.mjs";

const cli = fileURLToPath(new URL("./returner.mjs", import.meta.url));
let a;
try {
  ({ values: a } = parseArgs({
    options: {
      old: { type: "string" },
      source: { type: "string" },
      serve: { type: "string", default: "." },
      build: { type: "string" },
      start: { type: "string" },
      promise: { type: "string" },
      seed: { type: "string" },
      check: { type: "string" },
      "holdout-seed": { type: "string" },
      "holdout-check": { type: "string" },
      "holdout-secret": { type: "string", multiple: true, default: [] },
      "holdout-field": { type: "string", multiple: true, default: [] },
      agent: { type: "string", default: "codex" },
      attempts: { type: "string", default: "3" },
      note: { type: "string", default: "" },
      reference: { type: "string", multiple: true, default: [] },
    },
  }));
} catch (error) {
  a = { error: error.message }; // reported with the usage by main(), exit 2
}
// The agent may only read and edit the disposable candidate; Returner owns builds and verdicts.
const AGENTS = {
  codex: ["codex", ["exec", "--sandbox", "workspace-write", "--ephemeral", "--skip-git-repo-check", "-"]],
  claude: ["claude", ["-p", "--permission-mode", "acceptEdits", "--allowedTools", "Read,Edit,Write,Glob,Grep,Bash(npm run build:*),Bash(npm test:*),Bash(npx jest:*),Bash(npx tsc:*)"]],
};
const usage =
  'returner-repair --old ./v1-build --source ./v2-source [--build "npm run build"] [--serve dist] --promise "…" [--seed …] [--check …] [--agent codex|claude] [--attempts 3]\n' +
  'Running apps: --old http://127.0.0.1:4001 --start "PORT=4002 node server.mjs" --serve http://127.0.0.1:4002 (the candidate is started for every check)';

const cleanups = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const fn of cleanups) try { fn(signal); } catch {}
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  });
}

function execute(program, args, cwd, { prompt, capture, shell } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(program, args, { cwd, shell, stdio: [prompt ? "pipe" : "ignore", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"] });
    const stop = (signal) => child.kill(signal);
    cleanups.add(stop);
    let out = "";
    for (const s of capture ? [child.stdout, child.stderr] : [])
      s.on("data", (d) => { out += d; (s === child.stdout ? process.stdout : process.stderr).write(d); });
    child.on("error", (e) => { cleanups.delete(stop); reject(e); });
    child.on("close", (code) => { cleanups.delete(stop); done({ code: code ?? 2, out }); });
    if (prompt) {
      child.stdin.on("error", (e) => { if (e.code !== "EPIPE") reject(e); });
      child.stdin.end(prompt);
    }
  });
}

async function rehearse(args, cwd) {
  const { code, out } = await execute(process.execPath, [cli, ...args], cwd, { capture: true });
  const run = out.match(/^Evidence: (.+)$/m)?.[1];
  const report = run ? JSON.parse(await readFile(join(run, "report.json"), "utf8").catch(() => "{}")) : {};
  return { code, run, results: report.results || [], report };
}

// Every check that did not pass, so a failed control or read-only reopen reaches the agent too.
const failing = (results) => results.filter((r) => r.status !== "pass");
const describe = (r) =>
  [`Kane objective: ${r?.objective}`, `Kane verdict: ${r?.status} — ${r?.reason || "no reason"}`, `Kane summary: ${r?.summary || ""}`,
   "Kane steps:", ...(r?.steps || []).filter((s) => s.status !== "running").map((s) => `- ${s.status}: ${s.remark}`),
   ...(r?.consoleErrors?.length ? ["Browser console errors Kane recorded:", ...r.consoleErrors.map((e) => `- ${e}`)] : [])].join("\n");

async function main() {
  // Checked before any Kane run, so a typo never spends the baseline's credits.
  const hasHoldout = Boolean(a["holdout-seed"] || a["holdout-check"]);
  if (
    a.error || !a.old || !a.source || !a.promise || !AGENTS[a.agent] ||
    !/^[1-9]\d*$/.test(a.attempts) || Boolean(a.start) !== isUrl(a.serve) ||
    Boolean(a["holdout-seed"]) !== Boolean(a["holdout-check"])
  ) {
    console.error([a.error, usage].filter(Boolean).join("\n"));
    return 2;
  }
  await mkdir(resolve(".returner"), { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(resolve(".returner"), "repair-"));
  const candidate = join(work, "candidate");
  const skip = new Set(["node_modules", ".git", ".returner"]);
  const source = resolve(a.source);
  await cp(source, candidate, { recursive: true, filter: (p) => !relative(source, p).split(sep).some((part) => skip.has(part)) });
  // Read-only material from the previous release (old code or data) that the agent may consult.
  for (const file of a.reference) await cp(resolve(file), join(candidate, ".returner-reference", basename(file)));
  // A throwaway git baseline gives an exact patch that respects the project's .gitignore.
  // Signing and global hooks are switched off: a failed baseline commit would turn repair.diff into the whole repository.
  const git = (...args) => execute("git", ["-c", "user.name=returner", "-c", "user.email=returner@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], candidate, { capture: true });
  await git("init", "-q");
  await git("add", "-A");
  if ((await git("commit", "-qm", "candidate before repair", "--allow-empty")).code) return console.error("Could not record the candidate's git baseline."), 2;
  const site = a.start ? a.serve : join(candidate, a.serve);
  const old = isUrl(a.old) ? a.old : resolve(a.old);
  const build = () => (a.build ? execute(a.build, [], candidate, { capture: true, shell: true }) : { code: 0, out: "" });
  // Running apps: start the candidate for one rehearsal, keep its output for the agent, then stop it.
  const log = join(work, "server.log");
  const live = async (rehearsal) => {
    if (!a.start) return rehearsal();
    if (await fetch(a.serve, { redirect: "manual" }).then(() => true, () => false))
      return { startFailed: true, server: `${a.serve} is already answering before --start ran. Stop whatever is using it first.`, results: [] };
    const from = (await stat(log).catch(() => ({ size: 0 }))).size;
    const fd = openSync(log, "a");
    const app = spawn(a.start, { cwd: candidate, shell: true, detached: true, stdio: ["ignore", fd, fd] });
    closeSync(fd);
    const stopApp = (signal) => process.kill(-app.pid, signal);
    cleanups.add(stopApp);
    const exited = new Promise((done) => app.on("exit", done));
    const tail = async () => (await readFile(log)).subarray(from).toString("utf8").slice(-3000);
    try {
      for (let t = 0; !(await fetch(a.serve, { redirect: "manual" }).then(() => true, () => false)); t++) {
        if (t === 120 || app.exitCode !== null) return { startFailed: true, server: await tail(), results: [] };
        await new Promise((r) => setTimeout(r, 500));
      }
      return { ...(await rehearsal()), server: await tail() };
    } finally {
      cleanups.delete(stopApp);
      try { process.kill(-app.pid); } catch {}
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000).unref())]);
      if (app.exitCode === null) try { process.kill(-app.pid, "SIGKILL"); } catch {}
    }
  };
  console.log("Repair workspace:", work);
  if ((await build()).code) return console.error("The candidate does not build before repair."), 2;

  const options = [...(a.seed ? ["--seed", a.seed] : []), ...(a.check ? ["--check", a.check] : [])];
  let last = await live(() => rehearse(["--old", old, "--new", site, "--promise", a.promise, ...options], work));
  if (last.startFailed) return console.error("The candidate app did not start:\n" + last.server), 2;
  const baseline = last.run;
  const beforeReport = last.report;
  const beforeResults = last.results;
  const beforeServer = last.server || "";
  const verdict = (name) => last.results.find((r) => r.name === name)?.status;
  if (last.code !== 1 || verdict("new user") !== "pass" || ![verdict("returning user"), verdict("saved edit")].includes("fail")) {
    console.error("Repair needs a reproduced regression: new user pass, returning user (or its saved edit) fail.");
    return last.code === 0 ? 0 : 2;
  }

  // Optional holdout user (Profile B): seeded on --old in a separate directory OUTSIDE the repair workspace,
  // so its snapshot and expected values never sit beside the agent's candidate copy.
  let holdoutWork;
  let holdoutBaseline;
  const holdoutSecrets = [];
  const holdoutOnlySecrets = [];
  if (hasHoldout) {
    holdoutWork = await mkdtemp(join(tmpdir(), "returner-holdout-"));
    console.log("Holdout workspace:", holdoutWork);
    const seedB = await rehearse(
      ["--old", old, "--seed-only", "--promise", a.promise, "--seed", a["holdout-seed"], "--check", a["holdout-check"]],
      holdoutWork,
    );
    if (seedB.code !== 0 || !seedB.run) {
      console.error("Could not seed the holdout profile (Profile B); stopping without a verdict.");
      return 2;
    }
    holdoutBaseline = seedB.run;
    const stateB = JSON.parse(await readFile(join(holdoutBaseline, "baseline.json"), "utf8").catch(() => "{}"));
    const profileAText = `${a.seed || ""}\n${a.check || ""}`;
    for (const v of [stateB.title, stateB.body]) if (v) { holdoutSecrets.push(v); holdoutOnlySecrets.push(v); }
    for (const v of a["holdout-secret"] || []) if (v) {
      holdoutSecrets.push(v);
      if (!profileAText.includes(v)) holdoutOnlySecrets.push(v);
    }
    holdoutSecrets.sort((x, y) => y.length - x.length);
    holdoutOnlySecrets.sort((x, y) => y.length - x.length);
  }

  // The agent never sees a run's random marker, so it cannot hardcode the saved title or body to fake a pass.
  const secrets = [];
  const learn = async (run) => {
    const state = JSON.parse(await readFile(join(run, "baseline.json"), "utf8").catch(() => "{}"));
    for (const [value, label] of [[state.title, "<saved title>"], [state.body, "<saved body>"]]) if (value) secrets.push([value, label]);
  };
  const redact = (text) => {
    let out = secrets.reduce((t, [value, label]) => t.split(value).join(label), String(text));
    if (holdoutWork) out = out.split(holdoutWork).join("<holdout>");
    for (const v of holdoutOnlySecrets) out = out.replaceAll(v, "<holdout saved value>");
    return out;
  };
  // Sanitize a holdout (Profile B) failure so the agent learns which field was corrupted without receiving
  // Profile B's expected values or objective to hard-code.
  const redactHoldout = (text) =>
    holdoutSecrets.reduce((t, v) => t.replaceAll(v, "<holdout saved value>"), String(text || ""));
  const describeHoldoutFailure = (results) => {
    const bad = failing(results);
    const raw = bad.map((r) => [r.reason, r.summary, ...(r.steps || []).map((s) => s.remark)].filter(Boolean).join(" ")).join(" ");
    const fields = (a["holdout-field"] || []).filter((f) => raw.toLowerCase().includes(f.toLowerCase()));
    const lines = [
      "A second returning user (Profile B, whose saved answers are withheld) failed on the candidate release.",
      ...(fields.length ? [`Corrupted or failing field(s) mentioned: ${fields.join(", ")}`] : []),
      ...bad.map((r) =>
        [
          `Check "${r.name}" (holdout user): ${r.status} — ${redactHoldout(r.reason || "no reason")}`,
          r.summary ? `Summary (expected values withheld): ${redactHoldout(r.summary)}` : "",
          ...(r.consoleErrors?.length ? ["Browser console errors:", ...r.consoleErrors.map((e) => `- ${redactHoldout(e)}`)] : []),
        ].filter(Boolean).join("\n"),
      ),
    ];
    return lines.join("\n");
  };
  await learn(baseline);
  const fullRehearsal = () => live(() => rehearse(["--old", old, "--new", site, "--promise", a.promise, ...options], work));
  const attempts = [];
  const attemptLog = [];
  const holdoutAudit = [];
  let lastPrompt = "";
  let afterRun;
  let afterReport;
  let holdoutAfterRun;
  let holdoutAfterReport;
  let freshRun;
  let freshReport;
  const finish = async (code, diff = "") => {
    const repairVerdict = code === 0 ? "pass" : code === 1 ? "fail" : "inconclusive";
    if (holdoutWork && holdoutAudit.length) {
      await writeFile(join(holdoutWork, "holdout-attempts.json"), JSON.stringify({ baseline: holdoutBaseline, attempts: holdoutAudit }, null, 2));
    }
    await writeRepairReport(work, {
      verdict: repairVerdict,
      promise: a.promise,
      agent: a.agent,
      beforeDir: baseline,
      beforeReport,
      afterDir: afterRun,
      afterReport,
      holdoutReport: holdoutAfterReport,
      freshDir: freshRun,
      freshReport,
      diff,
      prompt: lastPrompt,
      serverLog: beforeServer,
      attempts: attemptLog,
    });
    console.log(`Repair report: ${join(work, "repair-report.html")}`);
    return code;
  };
  const [program, args] = AGENTS[a.agent];
  for (let i = 1; i <= Number(a.attempts); i++) {
    const storage = describeStorage(last.results);
    const storageSection = storage
      ? [
          "Browser state keys observed via Chrome DevTools (names only, no values):",
          ...(storage.headline ? [storage.headline] : []),
          ...storage.rows.map((r) => `- ${r.label}: ${r.items.length ? r.items.join(", ") : "(none)"}`),
        ].join("\n")
      : "";
    let prompt = [
      "Repair the web application in the current directory.",
      `Returner rehearsed this release with Kane CLI in real Chrome at one localhost origin. A new user (empty browser profile) passed. A returning user, whose browser profile was saved on the previous release, failed. Release promise: ${a.promise}`,
      failing(last.results).map((r) => `Check "${r.name}":\n${describe(r)}`).join("\n\n"),
      storageSection,
      last.server ? `The app server's output during that run (the end of it):\n${last.server}` : "",
      a.note,
      a.reference.length ? `Reference material from the previous release is in .returner-reference/: ${a.reference.map((f) => basename(f)).join(", ")}. Read it; do not edit it.` : "",
      attempts.length ? "Your earlier attempts did not satisfy Kane:\n" + attempts.join("\n\n") : "",
      `Fix the application source so returning users keep their saved work and also get this release's behaviour. Edit source only; do not edit build output, data files or tests to fake a pass. After you exit, Returner ${a.build ? `rebuilds with \`${a.build}\` and ` : ""}replays the returning user from the untouched browser state with the same Kane objective.`,
    ].filter(Boolean).join("\n\n");
    prompt = redact(prompt); // covers Kane's findings, earlier attempts, build output, and holdout-only values alike
    lastPrompt = prompt;
    await writeFile(join(work, `prompt-${i}.txt`), prompt); // exactly what the agent received, marker already redacted
    console.log(`Attempt ${i}/${a.attempts}: passing Kane's returning-user result to ${a.agent}…`);
    if ((await execute(program, args, candidate, { prompt })).code) {
      attemptLog.push({ attempt: i, status: "inconclusive", note: `${a.agent} exited before finishing.` });
      console.error(`${a.agent} exited before finishing.`);
      return finish(2);
    }
    const built = await build();
    if (built.code) {
      attemptLog.push({ attempt: i, status: "fail", note: "Build failed." });
      attempts.push(`Attempt ${i}: the build failed:\n${built.out.slice(-1500)}`);
      continue;
    }
    console.log("Replaying independently from the original baseline…");
    const replay = await live(() => rehearse(["--replay", baseline, "--new", site], work));
    if (replay.startFailed) {
      attemptLog.push({ attempt: i, status: "fail", note: "Candidate app did not start." });
      attempts.push(`Attempt ${i}: the app did not start:\n${replay.server}`);
      continue;
    }
    last = replay;
    afterRun = replay.run;
    afterReport = replay.report;
    const outcome = { attempt: i, code: last.code, evidence: last.run, results: last.results.map(({ name, status, reason }) => ({ name, status, reason })) };
    await writeFile(join(work, `attempt-${i}.json`), JSON.stringify(outcome, null, 2));
    if (last.code === 2) {
      attemptLog.push({ attempt: i, status: "inconclusive", note: "Replay was inconclusive." });
      console.error("Replay was inconclusive; stopping without a verdict.");
      return finish(2);
    }
    if (last.code !== 0) {
      attemptLog.push({ attempt: i, status: "fail", note: "Kane replay failed." });
      attempts.push(`Attempt ${i}: Kane still failed.\n${failing(last.results).map(describe).join("\n\n")}`);
      continue;
    }
    // Two-profile verification: replay a second untouched user (Profile B) whose answers were withheld from the agent.
    if (holdoutBaseline) {
      console.log("Profile A replay passed. Verifying against the holdout user (Profile B)…");
      const holdout = await live(() => rehearse(["--replay", holdoutBaseline, "--new", site], holdoutWork));
      if (holdout.startFailed) {
        attemptLog.push({ attempt: i, status: "inconclusive", note: "Candidate app did not start for holdout verification." });
        console.error("The candidate app did not start for holdout verification:\n" + holdout.server);
        return finish(2);
      }
      holdoutAfterRun = holdout.run;
      holdoutAfterReport = holdout.report;
      holdoutAudit.push({ attempt: i, code: holdout.code, evidence: holdout.run, results: holdout.results.map(({ name, status, reason }) => ({ name, status, reason })) });
      // Keep Profile B's path and expected values out of work/attempt-N.json (which sits beside the agent's candidate).
      outcome.holdout = { code: holdout.code, results: holdout.results.map(({ name, status }) => ({ name, status })) };
      await writeFile(join(work, `attempt-${i}.json`), JSON.stringify(outcome, null, 2));
      if (holdout.code === 2) {
        attemptLog.push({ attempt: i, status: "inconclusive", note: "Holdout user (Profile B) replay was inconclusive." });
        console.error("Holdout replay (Profile B) was inconclusive; stopping without a verdict.");
        return finish(2);
      }
      if (holdout.code !== 0) {
        last = { code: 1, run: baseline, results: beforeResults, server: beforeServer };
        attemptLog.push({ attempt: i, status: "fail", note: "Profile A passed, but holdout user (Profile B) failed; patch rejected." });
        console.log(`Attempt ${i} passed Profile A, but failed the holdout user (Profile B); rejecting it.`);
        attempts.push(`Attempt ${i}: Profile A passed, but the candidate corrupted or lost another returning user's saved answers.\n${describeHoldoutFailure(holdout.results)}`);
        continue;
      }
    }
    // A passing replay must also hold for saved work the agent has never seen: rehearse again with a new marker.
    console.log(`${holdoutBaseline ? "Both profiles passed." : "Replay passed."} Confirming with a fresh rehearsal and a new marker…`);
    const fresh = await fullRehearsal();
    if (fresh.startFailed) {
      attemptLog.push({ attempt: i, status: "inconclusive", note: "Candidate app did not start for fresh confirmation." });
      console.error("The candidate app did not start for fresh confirmation:\n" + fresh.server);
      return finish(2);
    }
    freshRun = fresh.run;
    freshReport = fresh.report;
    outcome.fresh = { code: fresh.code, evidence: fresh.run, results: fresh.results.map(({ name, status, reason }) => ({ name, status, reason })) };
    await writeFile(join(work, `attempt-${i}.json`), JSON.stringify(outcome, null, 2));
    if (fresh.code === 0) {
      await git("add", "-A");
      const diff = (await git("diff", "--cached")).out;
      await writeFile(join(work, "repair.diff"), diff);
      attemptLog.push({ attempt: i, status: "pass", note: holdoutBaseline ? "Profile A replay, holdout user (Profile B) replay, and fresh rehearsal all passed." : "Untouched replay passed and fresh rehearsal with a new marker confirmed it." });
      console.log(`Kane passed ${holdoutBaseline ? "both returning users (Profile A and holdout Profile B)" : "the returning user"} after attempt ${i}, and a fresh rehearsal with a new marker confirmed it. Patch: ${join(work, "repair.diff")}`);
      return finish(0, diff);
    }
    if (fresh.code === 2) {
      attemptLog.push({ attempt: i, status: "inconclusive", note: "Fresh rehearsal was inconclusive." });
      console.error("The fresh confirmation was inconclusive; stopping without a verdict.");
      return finish(2);
    }
    if (fresh.run) await learn(fresh.run);
    last = fresh;
    attemptLog.push({ attempt: i, status: "fail", note: "Passed replay, rejected by fresh rehearsal with a new marker." });
    console.log(`Attempt ${i} passed the replay but failed the fresh rehearsal; rejecting it.`);
    attempts.push(`Attempt ${i}: the replay passed, but a fresh rehearsal with new saved work failed, so the fix does not hold for other users' data.\n${failing(fresh.results).map(describe).join("\n\n")}`);
  }
  console.error("Kane did not pass the returning user within the attempt limit.");
  return finish(1);
}

main().then((code) => (process.exitCode = code)).catch((e) => {
  console.error("Repair could not finish:", e.message);
  process.exitCode = 2;
});
