#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdtemp, mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { serve } from "./server.mjs";
import { writeReport } from "./report.mjs";

const { values: args } = parseArgs({
  options: Object.fromEntries(
    ["old", "new", "promise", "seed", "check", "replay", "help"].map((key) => [
      key,
      { type: key === "help" ? "boolean" : "string" },
    ]),
  ),
});
const usage =
  'returner --old ./v1 --new ./v2 --promise "my draft survives"\nreturner --replay <run-directory> --new ./fixed-v2';
if (args.help) {
  console.log(usage);
  process.exit(0);
}
if (!args.new || (!args.replay && (!args.old || !args.promise))) {
  console.error(usage);
  process.exit(2);
}

const data = resolve(".returner");
await mkdir(data, { recursive: true, mode: 0o700 });
const run = await mkdtemp(join(data, "run-"));
console.log("Evidence: " + run);
const baseline = args.replay ? resolve(args.replay) : run;
const makeDraft =
  'Create a draft whose title is "{title}" and body is "{body}". Save it, reload and verify both exact strings remain visible.';
const findDraft =
  'Open the existing draft titled "{title}". Verify that exact title and body "{body}" are visible. If missing, fail immediately without creating or typing the missing contents. If present, append " EDITED" to the body, save, reload, and verify the full edited body "{body} EDITED".';
const state = args.replay
  ? JSON.parse(await readFile(join(baseline, "baseline.json"), "utf8"))
  : {
      title: "Returner-" + randomUUID().slice(0, 8),
      body: "Saved work " + randomUUID().slice(0, 12),
      promise: args.promise,
      seed: args.seed || makeDraft,
      check: args.check || findDraft,
    };
const server = await serve(state.port || 0);
const url = "http://127.0.0.1:" + server.port;
const results = [];
function objective(template, title, body) {
  return template.replaceAll("{title}", title).replaceAll("{body}", body);
}

async function probe(name, profile, task) {
  console.log("Running " + name);
  const before = server.documents();
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const child = spawn(
    "kane-cli",
    [
      "run",
      "--agent",
      "--headless",
      "--timeout",
      "300",
      "--max-steps",
      "35",
      "--chrome-profile",
      profile,
      "--url",
      url,
      task,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const completion = new Promise((ok, fail) => {
    child.on("error", fail);
    child.on("close", ok);
  });
  let end;
  const steps = [];
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (e.type === "run_end") end = e;
    if (e.remark && e.status)
      steps.push({ step: e.step, status: e.status, remark: e.remark });
  });
  const code = await completion;
  const loaded = server.documents() > before;
  let status = "inconclusive";
  if (loaded && code === 0 && end?.status === "passed") status = "pass";
  if (
    loaded &&
    code === 1 &&
    end?.status === "failed" &&
    end.reason_code?.startsWith("assertion_error")
  )
    status = "fail";
  const result = {
    name,
    status,
    code,
    loaded,
    reason: end?.reason,
    reasonCode: end?.reason_code,
    summary: end?.summary,
    credits: end?.credits_consumed,
    runId: end?.run_id,
    objective: task,
    steps,
  };
  results.push(result);
  await writeReport(run, { promise: state.promise, url, results });
  console.log(
    name +
      ": " +
      status +
      " — " +
      (end?.one_liner || end?.reason || "No completed verdict"),
  );
  return status;
}
async function rehearse() {
  if (!args.replay) {
    await server.use(args.old);
    const seed = await probe(
      "old baseline",
      join(run, "old-profile"),
      objective(state.seed, state.title, state.body),
    );
    if (seed !== "pass") return 2;
    state.port = server.port;
    await writeFile(join(run, "baseline.json"), JSON.stringify(state, null, 2));
  }
  await server.use(args.new);
  const fresh = await probe(
    "new user",
    join(run, "fresh-profile"),
    objective(state.seed, "New-" + state.title, "Fresh " + state.body),
  );
  const working = join(run, "returning-profile");
  await cp(join(baseline, "old-profile"), working, {
    recursive: true,
    filter: (p) =>
      ![
        "SingletonCookie",
        "SingletonSocket",
        "SingletonLock",
        "DevToolsActivePort",
      ].includes(p.split("/").pop()),
  });
  const returning = await probe(
    "returning user",
    working,
    objective(state.check, state.title, state.body) +
      " Release promise: " +
      state.promise,
  );
  if ([fresh, returning].includes("inconclusive")) return 2;
  return fresh === "pass" && returning === "pass" ? 0 : 1;
}
try {
  process.exitCode = await rehearse();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
} finally {
  server.close();
}
