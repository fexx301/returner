#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdtemp, mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { isUrl, serve } from "./server.mjs";
import { openChrome } from "./chrome.mjs";
import { writeReport } from "./report.mjs";
import { attachShot, consoleErrors } from "./shots.mjs";

const usage =
  'returner --old ./v1 --new ./v2 --promise "my draft survives"\nreturner --replay <run-directory> --new ./fixed-v2\n--old and --new take a static build folder or the URL of a running app (http://127.0.0.1:4001).';
let args;
try {
  ({ values: args } = parseArgs({
    options: Object.fromEntries(
      ["old", "new", "promise", "seed", "check", "replay", "help"].map((key) => [
        key,
        { type: key === "help" ? "boolean" : "string" },
      ]),
    ),
  }));
} catch (error) {
  // A usage mistake is never a regression verdict: exit 2, not 1.
  console.error(error.message + "\n" + usage);
  process.exit(2);
}
if (args.help) {
  console.log(usage);
  process.exit(0);
}
if (!args.new || (!args.replay && (!args.old || !args.promise))) {
  console.error(usage);
  process.exit(2);
}

async function main() {
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
  let activeChild;
  let activeChrome;
  const stop = (signal) => {
    activeChild?.kill(signal);
    activeChrome?.kill();
    server.close();
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  function objective(template, title, body) {
    return template.replaceAll("{title}", title).replaceAll("{body}", body);
  }

  async function probe(name, profile, task) {
    console.log("Running " + name);
    const before = server.documents();
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const chrome = (activeChrome = await openChrome(profile));
    const child = spawn(
      "kane-cli",
      [
        "run",
        "--agent",
        "--timeout",
        "300",
        "--max-steps",
        "35",
        "--cdp-endpoint",
        chrome.endpoint,
        "--url",
        url,
        task,
      ],
      {
        stdio: ["ignore", "pipe", "inherit"],
        env: { KANE_CLI_USER_AGENT: "returner", ...process.env },
      },
    );
    activeChild = child;
    const completion = new Promise((ok, fail) => {
      child.on("error", (err) => {
        activeChild = null;
        fail(err);
      });
      child.on("close", (code) => {
        activeChild = null;
        ok(code);
      });
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
    const code = await completion.finally(() => chrome.close());
    activeChrome = null;
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
      session: end?.session_dir?.split(/[\\/]/).pop(),
      status,
      code,
      loaded,
      reason: end?.reason,
      reasonCode: end?.reason_code,
      summary: end?.summary,
      credits: end?.credits_consumed,
      duration: end?.duration,
      testUrl: end?.test_url,
      runId: end?.run_id,
      objective: task,
      steps,
    };
    if (result.session) {
      result.shot = attachShot(result.session, run, name);
      result.consoleErrors = consoleErrors(result.session);
    }
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
      await writeFile(
        join(run, "baseline.json"),
        JSON.stringify(state, null, 2),
      );
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
        ].includes(basename(p)),
    });
    const returning = await probe(
      "returning user",
      working,
      objective(state.check, state.title, state.body) +
        " Release promise: " +
        state.promise,
    );
    // For the built-in draft contract, independently read back the edited
    // value from disk in a new Chrome process. A green action trace alone
    // can disagree with the final field value.
    // Skipped when the control was inconclusive: the run already exits 2, so the extra Kane run would only spend credits.
    if (returning === "pass" && fresh !== "inconclusive" && state.check === findDraft) {
      const persisted = await probe(
        "saved edit",
        working,
        objective('Read the existing draft without typing or saving. Verify that its title equals "{title}" and that the body field exactly equals "{body} EDITED". Fail if either value differs.', state.title, state.body),
      );
      if (persisted === "inconclusive") return 2;
      if (persisted === "fail") return 1;
    }
    if ([fresh, returning].includes("inconclusive")) return 2;
    return fresh === "pass" && returning === "pass" ? 0 : 1;
  }
  try {
    process.exitCode = await rehearse();
    // The report's verdict is the CLI's verdict; reports written mid-run are marked in progress.
    const verdict = { 0: "pass", 1: "fail", 2: "inconclusive" }[process.exitCode] ?? "inconclusive";
    let replay;
    if (process.exitCode === 1) {
      const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
      const command = [process.execPath, resolve(process.argv[1]), "--replay", baseline, "--new", isUrl(args.new) ? args.new : resolve(args.new)].map(quote).join(" ");
      console.log("After repairing the candidate, replay this baseline:\n" + command);
      // Shared reports carry a portable command: relative paths, no local Node or home directory.
      const rel = (p) => relative(process.cwd(), p) || ".";
      replay = ["node", rel(resolve(process.argv[1])), "--replay", rel(baseline), "--new", isUrl(args.new) ? args.new : rel(resolve(args.new))].map(quote).join(" ");
    }
    await writeReport(run, { promise: state.promise, url, results, verdict, replay });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    server.close();
  }
}
main().catch((error) => {
  console.error("Returner could not complete the rehearsal:", error.message);
  process.exitCode = 2;
});
