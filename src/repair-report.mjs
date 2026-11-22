#!/usr/bin/env node
// Self-contained HTML report for a closed repair loop:
//   1. Returning user fails → 2. Kane's finding goes to the agent → 3. Agent's patch → 4. Replay & fresh confirmation pass.
// Can also backfill an archived evidence folder: node src/repair-report.mjs <dir>
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeStorage } from "./report.mjs";

const esc = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function formatDiff(diff) {
  if (!diff) return "";
  return diff
    .split("\n")
    .map((line) => {
      const cls = line.startsWith("+++") || line.startsWith("---") ? "hdr"
        : line.startsWith("+") ? "add"
        : line.startsWith("-") ? "del"
        : line.startsWith("@@") || line.startsWith("diff --git") ? "hunk"
        : "";
      return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line);
    })
    .join("\n");
}

const changedFiles = (diff) => [...String(diff || "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
const pick = (report, name) => report?.results?.find((r) => r.name === name);
const relLink = (fromDir, targetPath) => {
  if (!targetPath) return null;
  const rel = relative(fromDir, targetPath).replaceAll("\\", "/");
  return rel && !rel.startsWith("..") ? rel : null;
};

export async function writeRepairReport(workDir, data) {
  const {
    verdict = "inconclusive", // "pass" | "fail" | "inconclusive"
    promise = "",
    agent = "",
    beforeDir,
    beforeReport,
    afterDir,
    afterReport,
    holdoutBaselineDir,
    holdoutDir,
    holdoutReport,
    freshDir,
    freshReport,
    diff = "",
    prompt = "",
    serverLog = "",
    attempts = [],
  } = data;

  const failCheck = pick(beforeReport, "returning user") || pick(beforeReport, "saved edit");
  const passCheck = pick(afterReport, "returning user");
  const holdoutCheck = pick(holdoutReport, "returning user");
  const freshCheck = pick(freshReport, "returning user");
  const beforeRel = relLink(workDir, beforeDir);
  const afterRel = relLink(workDir, afterDir);
  const holdoutBaseRel = relLink(workDir, holdoutBaselineDir);
  const holdoutRel = relLink(workDir, holdoutDir);
  const freshRel = relLink(workDir, freshDir);
  const beforeShot = failCheck?.shot && beforeRel ? `${beforeRel}/${failCheck.shot}` : null;
  const afterShot = passCheck?.shot && afterRel ? `${afterRel}/${passCheck.shot}` : null;
  const holdoutShot = holdoutCheck?.shot && holdoutRel ? `${holdoutRel}/${holdoutCheck.shot}` : null;
  const files = changedFiles(diff);
  const storage = describeStorage(beforeReport?.results || []);

  const headline = verdict === "pass"
    ? "Repaired and confirmed"
    : verdict === "fail"
      ? "Repair did not satisfy Kane"
      : "Repair stopped without a verdict";

  const badges = [
    verdict === "pass" && `<span class="badge pass">Untouched replay passed</span>`,
    holdoutCheck && `<span class="badge ${holdoutCheck.status === "pass" ? "pass" : holdoutCheck.status === "fail" ? "fail" : ""}">Holdout user (Profile B): ${esc(holdoutCheck.status)}</span>`,
    freshReport && freshCheck?.status === "pass" && `<span class="badge pass">Fresh rehearsal confirmed</span>`,
    agent && `<span class="badge">Agent: ${esc(agent)}</span>`,
    attempts.length && `<span class="badge">${attempts.length} attempt${attempts.length === 1 ? "" : "s"}</span>`,
  ].filter(Boolean).join("");

  const crashLines = [
    ...(failCheck?.consoleErrors || []).map((e) => `Console: ${e}`),
    ...(serverLog ? [serverLog.trim().split("\n").slice(0, 3).join("\n")] : []),
  ];

  const attemptRows = attempts.map((a) => `<tr>
    <td>#${esc(a.attempt)}</td>
    <td><span class="pill ${esc(a.status)}">${esc(a.status)}</span></td>
    <td>${esc(a.note || "")}</td>
  </tr>`).join("");

  const links = [
    beforeRel && `<a href="${esc(beforeRel)}/report.html">Before report</a>`,
    afterRel && `<a href="${esc(afterRel)}/report.html">After replay report</a>`,
    holdoutBaseRel && `<a href="${esc(holdoutBaseRel)}/report.html">Profile B baseline</a>`,
    holdoutRel && `<a href="${esc(holdoutRel)}/report.html">Profile B replay report</a>`,
    freshRel && `<a href="${esc(freshRel)}/report.html">Fresh confirmation report</a>`,
    existsSync(join(workDir, "repair.diff")) && `<a href="repair.diff">repair.diff</a>`,
    existsSync(join(workDir, "incomplete-342.patch")) && `<a href="incomplete-342.patch">incomplete-342.patch</a>`,
    existsSync(join(workDir, "prompt-1.txt")) && `<a href="prompt-1.txt">prompt-1.txt</a>`,
  ].filter(Boolean).join("");

  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%23141517%27/%3E%3Cpath d=%27M9 17l5 5 9-12%27 stroke=%27%233fbf75%27 stroke-width=%274%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E">
<title>Returner repair report · ${esc(headline)}</title>
<style>
:root{--ground:#eceae4;--card:#fff;--ink:#141517;--muted:#5e5c57;--line:#d9d6ce;--pass:#1e8a4c;--fail:#c83f1a;--warn:#9a6a08;--code:#17181b;--codeink:#e9e6df}
@media (prefers-color-scheme:dark){:root{--ground:#121315;--card:#1c1e21;--ink:#f1efe8;--muted:#a9a69e;--line:#2d3034;--pass:#3fbf75;--fail:#ff7a52;--warn:#e0b04a;--code:#0d0e10}}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}.wrap{max-width:1240px;margin:0 auto;padding:32px 20px 64px}
.site{position:sticky;top:0;z-index:20;background:var(--ground);border-bottom:1px solid var(--line)}
.siteinner{max-width:1240px;margin:0 auto;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:-.02em;text-decoration:none}
.mk{width:28px;height:28px;border-radius:8px;background:#141517;border:1px solid rgba(255,255,255,.14);display:grid;place-items:center;flex:none}
.sitenav{display:flex;gap:18px;font-size:14px;align-items:center}.sitenav a{color:var(--muted);text-decoration:none}.sitenav a:hover{color:var(--ink)}
.kicker{font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
.verdict{display:flex;gap:16px;align-items:center;margin:12px 0 6px}.verdict .dot{width:18px;height:18px;border-radius:50%;flex:none}
.verdict.pass .dot{background:var(--pass)}.verdict.fail .dot{background:var(--fail)}.verdict.inconclusive .dot{background:var(--warn)}
h1{font-size:clamp(28px,4.4vw,46px);line-height:1.06;letter-spacing:-.025em;margin:0}
.promise{font-size:19px;color:var(--muted);margin:8px 0 0}
.badges{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0}
.badge{font:600 12px ui-monospace,Menlo,monospace;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted)}
.badge.pass{border-color:var(--pass);color:var(--pass)}
.badge.fail{border-color:var(--fail);color:var(--fail)}
.links{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0 0;font-size:14px}.links a{color:var(--muted)}.links a:hover{color:var(--ink)}
.steps{list-style:none;padding:0;margin:28px 0 0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.step{position:relative;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.step.fail{border-color:var(--fail);border-width:2px}.step.pass{border-color:var(--pass);border-width:2px}
.n{font:700 12px ui-monospace,Menlo,monospace;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--ground);color:var(--muted)}
.fail .n{background:var(--fail);color:#fff}.pass .n{background:var(--pass);color:#fff}
h2{font-size:16px;margin:0;line-height:1.3}.step p{margin:0;font-size:14px;overflow-wrap:anywhere}
.img{display:block;border-radius:8px;overflow:hidden;border:1px solid var(--line);aspect-ratio:16/10;background:var(--ground)}
.img img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
.crash{padding:8px 10px;border-radius:8px;border:1px solid color-mix(in srgb,var(--fail) 35%,var(--line));background:color-mix(in srgb,var(--fail) 7%,transparent);font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
blockquote{margin:0;padding:10px 12px;border-left:3px solid var(--fail);background:var(--ground);border-radius:6px;font-size:14px;white-space:pre-line;overflow-wrap:anywhere}
.files{font:12px ui-monospace,Menlo,monospace;color:var(--muted)}
pre.diff{margin:0;background:var(--code);color:var(--codeink);border-radius:10px;padding:12px 14px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto}
pre.diff .add{color:#9fd5b0}pre.diff .del{color:#ff9c7e}pre.diff .hunk{color:#8ab4f8}pre.diff .hdr{color:#a9a69e}
details{border-top:1px solid var(--line);padding-top:8px;font-size:13px}summary{cursor:pointer;color:var(--muted)}
details pre{margin:8px 0 0;background:var(--code);color:var(--codeink);border-radius:8px;padding:10px 12px;font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto}
.panel{margin-top:24px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.panel h3{margin:0 0 12px;font-size:16px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
.pill{font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px;color:#fff}
.pill.pass{background:var(--pass)}.pill.fail{background:var(--fail)}.pill.inconclusive{background:var(--warn)}
.fine{color:var(--muted);font-size:13px!important}
footer{margin-top:32px;color:var(--muted);font-size:13px}
@media (max-width:980px){.steps{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:620px){.steps{grid-template-columns:1fr}.wrap{padding:24px 16px 48px}}
</style></head><body>
<header class="site"><div class="siteinner"><a class="logo" href="https://fexx301.github.io/returner/"><span class="mk"><svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 17l6 6 12-15" stroke="#3fbf75" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Returner</a><nav class="sitenav" aria-label="Site"><a href="https://fexx301.github.io/returner/">All results</a><a href="https://fexx301.github.io/returner/try/">Try it live</a></nav></div></header>
<main class="wrap">
<p class="kicker">Returner · closed repair loop</p>
<div class="verdict ${esc(verdict)}"><span class="dot" aria-hidden="true"></span><h1>${esc(headline)}</h1></div>
${promise ? `<p class="promise">Promise: “${esc(promise)}”</p>` : ""}
${badges ? `<div class="badges">${badges}</div>` : ""}
${links ? `<nav class="links" aria-label="Artifacts">${links}</nav>` : ""}

<ol class="steps">
  <li class="step fail">
    <span class="n">1</span>
    <h2>Returning user fails</h2>
    ${beforeShot ? `<a class="img" href="${esc(beforeShot)}"><img src="${esc(beforeShot)}" alt="Kane's returning-user failure screenshot"></a>` : ""}
    ${crashLines.length ? `<div class="crash">${esc(crashLines.join("\n"))}</div>` : ""}
    <p>${esc(failCheck?.reason || failCheck?.summary || "Returning user failed on the candidate release.")}</p>
    ${storage?.headline ? `<p class="fine">${esc(storage.headline)}</p>` : ""}
  </li>
  <li class="step">
    <span class="n">2</span>
    <h2>Kane's finding goes to ${esc(agent || "the agent")}</h2>
    <blockquote>${esc(failCheck?.summary || failCheck?.reason || "See prompt below.")}</blockquote>
    <p class="fine">The run's random marker is redacted before the prompt reaches the agent. Edits stay inside a disposable copy.</p>
    ${prompt ? `<details><summary>Exact redacted prompt</summary><pre>${esc(prompt)}</pre></details>` : ""}
  </li>
  <li class="step">
    <span class="n">3</span>
    <h2>${esc(agent ? `${agent}'s patch` : "Candidate patch")}</h2>
    ${files.length ? `<p class="files">${files.map(esc).join("<br>")}</p>` : ""}
    ${diff ? `<pre class="diff">${formatDiff(diff)}</pre>` : `<p class="fine">No patch was accepted.</p>`}
  </li>
  <li class="step ${verdict === "pass" ? "pass" : ""}">
    <span class="n">4</span>
    <h2>${verdict === "pass" ? "Replay & fresh rehearsal pass" : "Replay verdict"}</h2>
    ${afterShot ? `<a class="img" href="${esc(afterShot)}"><img src="${esc(afterShot)}" alt="Kane's replay screenshot"></a>` : ""}
    <p>${esc(passCheck?.summary || passCheck?.reason || "Replay did not pass.")}</p>
    ${holdoutCheck ? `<p class="fine">Holdout user (Profile B): <strong>${esc(holdoutCheck.status)}</strong>${holdoutCheck.status !== "pass" && holdoutCheck.reason ? ` — ${esc(holdoutCheck.reason)}` : ""}</p>` : ""}
    ${holdoutShot ? `<a class="img" href="${esc(holdoutShot)}"><img src="${esc(holdoutShot)}" alt="Kane's Profile B holdout replay screenshot"></a>` : ""}
    ${freshCheck ? `<p class="fine">Fresh rehearsal (brand-new marker): <strong>${esc(freshCheck.status)}</strong></p>` : ""}
  </li>
</ol>

${diff ? `<section class="panel"><h3>Full patch (repair.diff)</h3><pre class="diff">${formatDiff(diff)}</pre></section>` : ""}
${attemptRows ? `<section class="panel"><h3>Attempts</h3><table><thead><tr><th>Attempt</th><th>Status</th><th>Outcome</th></tr></thead><tbody>${attemptRows}</tbody></table></section>` : ""}

<footer>Every verdict and screenshot comes from Kane CLI. The agent never grades its own fix.</footer>
</main></body></html>`;

  await writeFile(join(workDir, "repair-report.html"), page);
}

// CLI backfill for an archived repair evidence folder (e.g., evidence/quillpad-server-v1-to-v2).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] || ".");
  const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const readText = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
  const beforeDir = join(dir, "before");
  const afterDir = join(dir, "after");
  const freshDir = join(dir, "fresh");
  const beforeReport = readJson(join(beforeDir, "report.json"));
  const afterReport = readJson(join(afterDir, "report.json"));
  const freshReport = readJson(join(freshDir, "report.json"));
  const attempt1 = readJson(join(dir, "attempt-1.json"));
  const attempts = attempt1
    ? [{
        attempt: attempt1.attempt ?? 1,
        status: attempt1.fresh?.code === 0 ? "pass" : attempt1.code === 0 ? "pass" : "fail",
        note: attempt1.fresh?.code === 0 ? "Untouched replay passed and fresh rehearsal with a new marker confirmed it." : "Replay finished.",
      }]
    : [];
  const verdict = (freshReport ? pick(freshReport, "returning user")?.status === "pass" : pick(afterReport, "returning user")?.status === "pass")
    ? "pass" : "fail";
  await writeRepairReport(dir, {
    verdict,
    promise: beforeReport?.promise || "",
    agent: process.argv[3] || "Codex",
    beforeDir: existsSync(beforeDir) ? beforeDir : null,
    beforeReport,
    afterDir: existsSync(afterDir) ? afterDir : null,
    afterReport,
    freshDir: existsSync(freshDir) ? freshDir : null,
    freshReport,
    diff: readText(join(dir, "repair.diff")),
    prompt: readText(join(dir, "prompt-1.txt")),
    serverLog: readText(join(dir, "server.log")),
    attempts,
  });
  console.log("wrote", join(dir, "repair-report.html"));
}
