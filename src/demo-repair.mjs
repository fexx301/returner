import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./returner.mjs", import.meta.url));
const fixtures = fileURLToPath(new URL("../examples/draft/", import.meta.url));

function execute(program, args, cwd, prompt) {
  return new Promise((done, reject) => {
    const child = spawn(program, args, {
      cwd,
      stdio: [prompt ? "pipe" : "ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => done(code ?? 2));
    if (prompt) {
      child.stdin.on("error", (err) => {
        if (err.code !== "EPIPE") reject(err);
      });
      child.stdin.end(prompt);
    }
  });
}

async function demo() {
  const data = resolve(".returner");
  await mkdir(data, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(data, "demo-"));
  const candidate = join(work, "candidate");
  await cp(join(fixtures, "v2-broken"), candidate, { recursive: true });
  console.log("Repair demo workspace:", work);
  const before = await execute(
    process.execPath,
    [
      cli,
      "--old",
      join(fixtures, "v1"),
      "--new",
      candidate,
      "--promise",
      "My draft survives the release",
    ],
    work,
  );
  if (before !== 1) {
    console.error("Repair requires a reproduced upgrade regression.");
    return 2;
  }

  // This private workspace contains exactly one rehearsal at this point.
  const evidence = join(work, ".returner");
  const [firstRun] = await readdir(evidence);
  const baseline = join(evidence, firstRun);
  const { results } = JSON.parse(
    await readFile(join(baseline, "report.json"), "utf8"),
  );
  const failure = results.find(
    (r) => r.name === "returning user" && r.status === "fail",
  );
  if (
    !failure ||
    !results.some((r) => r.name === "new user" && r.status === "pass")
  ) {
    console.error(
      "The observed verdict differs from the demo's fresh-pass / returning-fail condition.",
    );
    return 2;
  }

  const oldCode = await readFile(join(fixtures, "v1", "draft.js"), "utf8");
  const prompt = [
    "Fix the draft editor in this directory so its current and returning users can save and reopen their existing work.",
    "Kane passed the fresh-user check and failed the returning-user check. Support arbitrary saved drafts.",
    "Edit only the candidate application. Returner will evaluate it from the original browser state after you exit.",
    "Earlier release implementation:",
    oldCode,
    "Kane's objective:",
    failure.objective,
    "Observed result:",
    failure.reason,
    failure.summary,
  ].join("\n\n");
  console.log("Passing the observed Kane failure to Codex…");
  const repaired = await execute(
    "codex",
    [
      "exec",
      "--sandbox",
      "workspace-write",
      "--ephemeral",
      "--skip-git-repo-check",
      "-",
    ],
    candidate,
    prompt,
  );
  if (repaired !== 0) {
    console.error(
      "Codex exited before finishing the repair. Original evidence:",
      baseline,
    );
    return 2;
  }

  console.log("Replaying independently from the original baseline…");
  return execute(
    process.execPath,
    [cli, "--replay", baseline, "--new", candidate],
    work,
  );
}

demo()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("Repair demo could not finish:", error.message);
    process.exitCode = 2;
  });
