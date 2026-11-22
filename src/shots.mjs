#!/usr/bin/env node
// Kane's final screenshot for each check, pulled from its local evidence pack so reports can show what Kane saw.
// Backfill an existing evidence folder: node src/shots.mjs <dir-with-report.json>
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReport } from "./report.mjs";

const SESSIONS = join(homedir(), ".testmuai", "kaneai", "sessions");
const slug = (name) => name.replace(/\s+/g, "-");

// A Kane session's sealed evidence pack (a zip) and the paths inside it.
function pack(session) {
  const evidence = join(SESSIONS, session, "evidence");
  const file = join(evidence, readdirSync(evidence).find((f) => f.endsWith(".evidence")));
  return { file, entries: spawnSync("unzip", ["-Z1", file], { encoding: "utf8" }).stdout.split("\n") };
}

// The browser console errors Kane recorded during a check: often the exact crash behind a failure,
// even when Kane's prose summary guesses another cause. Unique, at most 5, each trimmed.
export function consoleErrors(session) {
  try {
    const { file, entries } = pack(session);
    const texts = entries.filter((p) => /logs\/\d+-console\.ndjson$/.test(p))
      .flatMap((p) => spawnSync("unzip", ["-p", file, p], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout.split("\n"))
      .map((line) => { try { return JSON.parse(line); } catch {} })
      .filter((e) => e?.level === "error" && e.text).map((e) => String(e.text).slice(0, 400));
    return [...new Set(texts)].slice(0, 5);
  } catch {
    return []; // console logs are a convenience, like screenshots
  }
}

// Copies the last step screenshot of a Kane session into dir/shots; returns its relative path or undefined.
export function attachShot(session, dir, name) {
  try {
    const { file, entries } = pack(session);
    const step = (p) => parseInt(p.match(/steps\/(\d+)/)?.[1] ?? "0", 10); // folders look like 9-0-5 or 4-0-e1169d09-1
    const shots = entries.filter((p) => /\/screenshot\.(jpg|jpeg|png)$/i.test(p))
      .sort((a, b) => step(a) - step(b) || a.localeCompare(b));
    if (!shots.length) return;
    const pick = shots.at(-1);
    const ext = pick.slice(pick.lastIndexOf(".")).toLowerCase();
    const image = spawnSync("unzip", ["-p", file, pick], { maxBuffer: 64 << 20 }).stdout;
    if (!image?.length) return;
    mkdirSync(join(dir, "shots"), { recursive: true });
    writeFileSync(join(dir, "shots", `${slug(name)}${ext}`), image);
    return `shots/${slug(name)}${ext}`;
  } catch {
    return undefined; // screenshots are a convenience; a missing pack never fails a run
  }
}

// Older reports did not record the session: match the objective's opening words, its exact quoted marker and the verdict.
function findSession(result, taken) {
  if (!existsSync(SESSIONS)) return;
  const want = result.status === "pass" ? "passed" : "failed";
  const marker = result.objective.match(/"([^"]+)"/)?.[1];
  const opening = result.objective.slice(0, 24);
  for (const s of readdirSync(SESSIONS)) {
    if (taken.has(s)) continue;
    let events;
    try { events = readFileSync(join(SESSIONS, s, "events.ndjson"), "utf8"); } catch { continue; }
    if (events.includes(opening) && marker && events.includes(`\\"${marker}\\"`) && events.includes(`"type":"run_end","status":"${want}"`)) return s;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Backfill: node src/shots.mjs <dir> [<dir> …]. Sessions claimed by any listed report are never reused.
  const dirs = process.argv.slice(2).map((d) => resolve(d));
  const reports = dirs.map((dir) => [dir, JSON.parse(readFileSync(join(dir, "report.json"), "utf8"))]);
  const taken = new Set(reports.flatMap(([, r]) => r.results.map((x) => x.session).filter(Boolean)));
  for (const [dir, report] of reports) {
    console.log(`## ${dir}`);
    for (const result of report.results) {
      const session = result.session || findSession(result, taken);
      if (!session) { console.log(`${result.name}: no matching Kane session`); continue; }
      taken.add(session);
      result.shot = attachShot(session, dir, result.name);
      result.consoleErrors = consoleErrors(session);
      console.log(`${result.name}: ${result.shot || "no screenshot"}, ${result.consoleErrors.length} console errors (${session.slice(0, 8)})`);
    }
    await writeReport(dir, report);
  }
}
