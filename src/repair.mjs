#!/usr/bin/env node
// Closed repair loop for any app: rehearse the release, hand Kane's returning-user verdict to a coding
// agent, rebuild, and replay from the untouched baseline profile until Kane passes or attempts run out.
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./returner.mjs", import.meta.url));
const { values: a } = parseArgs({
  options: {
    old: { type: "string" },
    source: { type: "string" },
    serve: { type: "string", default: "." },
    build: { type: "string" },
    promise: { type: "string" },
    seed: { type: "string" },
    check: { type: "string" },
    agent: { type: "string", default: "codex" },
    attempts: { type: "string", default: "3" },
    note: { type: "string", default: "" },
    reference: { type: "string", multiple: true, default: [] },
  },
});
// The agent may only read and edit the disposable candidate; Returner owns builds and verdicts.
const AGENTS = {
  codex: ["codex", ["exec", "--sandbox", "workspace-write", "--ephemeral", "--skip-git-repo-check", "-"]],
  claude: ["claude", ["-p", "--permission-mode", "acceptEdits", "--allowedTools", "Read,Edit,Write,Glob,Grep,Bash(npm run build:*),Bash(npm test:*),Bash(npx jest:*),Bash(npx tsc:*)"]],
};
const usage =
  'returner-repair --old ./v1-build --source ./v2-source [--build "npm run build"] [--serve dist] --promise "…" [--seed …] [--check …] [--agent codex|claude] [--attempts 3]';

function execute(program, args, cwd, { prompt, capture, shell } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(program, args, { cwd, shell, stdio: [prompt ? "pipe" : "ignore", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"] });
    let out = "";
    for (const s of capture ? [child.stdout, child.stderr] : [])
      s.on("data", (d) => { out += d; (s === child.stdout ? process.stdout : process.stderr).write(d); });
    child.on("error", reject);
    child.on("close", (code) => done({ code: code ?? 2, out }));
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
  return { code, run, results: report.results || [] };
}

const describe = (r) =>
  [`Kane objective: ${r?.objective}`, `Kane verdict: ${r?.status} — ${r?.reason || "no reason"}`, `Kane summary: ${r?.summary || ""}`,
   "Kane steps:", ...(r?.steps || []).filter((s) => s.status !== "running").map((s) => `- ${s.status}: ${s.remark}`)].join("\n");

async function main() {
  if (!a.old || !a.source || !a.promise || !AGENTS[a.agent]) {
    console.error(usage);
    return 2;
  }
  await mkdir(resolve(".returner"), { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(resolve(".returner"), "repair-"));
  const candidate = join(work, "candidate");
  const skip = new Set(["node_modules", ".git", ".returner"]);
  await cp(resolve(a.source), candidate, { recursive: true, filter: (p) => !p.split("/").some((part) => skip.has(part)) });
  // Read-only material from the previous release (old code or data) that the agent may consult.
  for (const file of a.reference) await cp(resolve(file), join(candidate, ".returner-reference", file.split("/").pop()));
  // A throwaway git baseline gives an exact patch that respects the project's .gitignore.
  const git = (...args) => execute("git", ["-c", "user.name=returner", "-c", "user.email=returner@localhost", ...args], candidate, { capture: true });
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "candidate before repair");
  const site = join(candidate, a.serve);
  const build = () => (a.build ? execute(a.build, [], candidate, { capture: true, shell: true }) : { code: 0, out: "" });
  console.log("Repair workspace:", work);
  if ((await build()).code) return console.error("The candidate does not build before repair."), 2;

  const options = [...(a.seed ? ["--seed", a.seed] : []), ...(a.check ? ["--check", a.check] : [])];
  let last = await rehearse(["--old", resolve(a.old), "--new", site, "--promise", a.promise, ...options], work);
  const baseline = last.run;
  const verdict = (name) => last.results.find((r) => r.name === name)?.status;
  if (last.code !== 1 || verdict("new user") !== "pass" || verdict("returning user") !== "fail") {
    console.error("Repair needs a reproduced regression: new user pass, returning user fail.");
    return last.code === 0 ? 0 : 2;
  }

  // The agent never sees a run's random marker, so it cannot hardcode the saved title or body to fake a pass.
  const secrets = [];
  const learn = async (run) => {
    const state = JSON.parse(await readFile(join(run, "baseline.json"), "utf8").catch(() => "{}"));
    for (const [value, label] of [[state.title, "<saved title>"], [state.body, "<saved body>"]]) if (value) secrets.push([value, label]);
  };
  const redact = (text) => secrets.reduce((t, [value, label]) => t.split(value).join(label), String(text));
  await learn(baseline);
  const fullRehearsal = () => rehearse(["--old", resolve(a.old), "--new", site, "--promise", a.promise, ...options], work);
  const attempts = [];
  const [program, args] = AGENTS[a.agent];
  for (let i = 1; i <= Number(a.attempts); i++) {
    const prompt = [
      "Repair the web application in the current directory.",
      `Returner rehearsed this release with Kane CLI in real Chrome at one localhost origin. A new user (empty browser profile) passed. A returning user, whose browser profile was saved on the previous release, failed. Release promise: ${a.promise}`,
      redact(describe(last.results.find((r) => r.name === "returning user"))),
      a.note,
      a.reference.length ? `Reference material from the previous release is in .returner-reference/: ${a.reference.map((f) => f.split("/").pop()).join(", ")}. Read it; do not edit it.` : "",
      attempts.length ? "Your earlier attempts did not satisfy Kane:\n" + attempts.join("\n\n") : "",
      `Fix the application source so returning users keep their saved work and also get this release's behaviour. Edit source only; do not edit build output, data files or tests to fake a pass. After you exit, Returner ${a.build ? `rebuilds with \`${a.build}\` and ` : ""}replays the returning user from the untouched browser state with the same Kane objective.`,
    ].filter(Boolean).join("\n\n");
    console.log(`Attempt ${i}/${a.attempts}: passing Kane's returning-user result to ${a.agent}…`);
    if ((await execute(program, args, candidate, { prompt })).code) return console.error(`${a.agent} exited before finishing.`), 2;
    const built = await build();
    if (built.code) {
      attempts.push(`Attempt ${i}: the build failed:\n${built.out.slice(-1500)}`);
      continue;
    }
    console.log("Replaying independently from the original baseline…");
    last = await rehearse(["--replay", baseline, "--new", site], work);
    const outcome = { attempt: i, code: last.code, evidence: last.run, results: last.results.map(({ name, status, reason }) => ({ name, status, reason })) };
    await writeFile(join(work, `attempt-${i}.json`), JSON.stringify(outcome, null, 2));
    if (last.code === 2) return console.error("Replay was inconclusive; stopping without a verdict."), 2;
    if (last.code !== 0) {
      attempts.push(`Attempt ${i}: Kane still failed.\n${redact(describe(last.results.find((r) => r.name === "returning user")))}`);
      continue;
    }
    // A passing replay must also hold for saved work the agent has never seen: rehearse again with a new marker.
    console.log("Replay passed. Confirming with a fresh rehearsal and a new marker…");
    const fresh = await fullRehearsal();
    outcome.fresh = { code: fresh.code, evidence: fresh.run, results: fresh.results.map(({ name, status, reason }) => ({ name, status, reason })) };
    await writeFile(join(work, `attempt-${i}.json`), JSON.stringify(outcome, null, 2));
    if (fresh.code === 0) {
      await git("add", "-A");
      await writeFile(join(work, "repair.diff"), (await git("diff", "--cached")).out);
      console.log(`Kane passed the returning user after attempt ${i}, and a fresh rehearsal with a new marker confirmed it. Patch: ${join(work, "repair.diff")}`);
      return 0;
    }
    if (fresh.code === 2) return console.error("The fresh confirmation was inconclusive; stopping without a verdict."), 2;
    if (fresh.run) await learn(fresh.run);
    last = fresh;
    console.log(`Attempt ${i} passed the replay but failed the fresh rehearsal; rejecting it.`);
    attempts.push(`Attempt ${i}: the replay passed, but a fresh rehearsal with new saved work failed, so the fix does not hold for other users' data.\n${redact(describe(fresh.results.find((r) => r.name === "returning user")))}`);
  }
  console.error("Kane did not pass the returning user within the attempt limit.");
  return 1;
}

main().then((code) => (process.exitCode = code)).catch((e) => {
  console.error("Repair could not finish:", e.message);
  process.exitCode = 2;
});
