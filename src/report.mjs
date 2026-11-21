import { writeFile } from "node:fs/promises";
import { join } from "node:path";

function escape(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

const LABELS = {
  "old baseline": "Before upgrade",
  "new user": "New user",
  "returning user": "Returning user",
  "saved edit": "Reopened after editing",
};
const ROLES = {
  "old baseline": "Saves work on the previous build",
  "new user": "Empty profile on the new build",
  "returning user": "Yesterday's profile on the new build",
  "saved edit": "Read-only check in a new Chrome process",
};
// The returning user decides the release, so it leads; the supporting checks follow in run order.
const ORDER = ["returning user", "old baseline", "new user", "saved edit"];

export async function writeReport(directory, report) {
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  const results = ORDER.map((name) => report.results.find((r) => r.name === name)).filter(Boolean);
  const returning = report.results.find((r) => r.name === "returning user");
  // Live runs pass the CLI's final verdict. Older reports without one are judged only when the returning user ran.
  const failed = report.results.filter((r) => r.status === "fail");
  const overall = report.verdict
    || (!returning ? "running"
      : report.results.some((r) => r.status === "inconclusive") ? "inconclusive"
      : failed.length ? "fail" : "pass");
  const headline = overall === "running" ? "Rehearsal in progress"
    : overall === "pass" ? "Returning users keep their work"
    : overall === "inconclusive" ? "Not enough evidence for a verdict"
    : returning?.status === "fail" ? "Returning users lose their work"
    : `Release check failed: ${failed.map((r) => LABELS[r.name] || r.name).join(", ") || "see the checks below"}`;
  const supporting = results.filter((r) => r.name !== "returning user");
  const cards = results.map((r) => {
    const wide = r !== returning && supporting.length % 2 === 1 && r === supporting.at(-1);
    const steps = (r.steps || []).filter((s) => s.status !== "running").map((s) => `<li>${escape(s.remark)}</li>`).join("");
    const shot = r.shot
      ? `<figure><a class="shot" href="${escape(r.shot)}"><img src="${escape(r.shot)}" alt="Kane's final screenshot for the ${escape(LABELS[r.name] || r.name)} check"></a><figcaption>Kane's final screen · click to enlarge</figcaption></figure>`
      : `<figure><div class="shot none">No screenshot recorded</div></figure>`;
    return `<section class="card ${r.name === "returning user" ? "hero" : ""} ${wide ? "wide" : ""} ${escape(r.status)}">
  <header><div><h2>${escape(LABELS[r.name] || r.name)}</h2><p class="role">${escape(ROLES[r.name] || "")}</p></div><span class="pill ${escape(r.status)}">${escape(r.status)}</span></header>
  <div class="body">${shot}<div class="text">
  <p class="summary"><span class="who">Kane's summary</span>${escape(r.summary || r.reason || "Kane did not return a complete result.")}</p>
  <details><summary>Kane objective and steps</summary><p class="objective">${escape(r.objective)}</p><ol>${steps}</ol>${r.credits ? `<p class="meta">${Number(r.credits).toFixed(1)} Kane credits</p>` : ""}</details>
  </div></div>
</section>`;
  }).join("\n");
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%23141517%27/%3E%3Cpath d=%27M9 17l5 5 9-12%27 stroke=%27%233fbf75%27 stroke-width=%274%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E">
<title>Returner report · ${escape(headline)}</title>
<style>
:root{--ground:#eceae4;--card:#fff;--ink:#141517;--muted:#5e5c57;--line:#d9d6ce;--pass:#1e8a4c;--fail:#c83f1a;--warn:#9a6a08}
@media (prefers-color-scheme:dark){:root{--ground:#141517;--card:#1d1f22;--ink:#f1efe8;--muted:#a9a69e;--line:#2e3034;--pass:#3fbf75;--fail:#ff7a52;--warn:#e0b04a}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:40px 20px 64px}
.kicker{font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
.verdict{display:flex;gap:20px;align-items:center;margin:14px 0 6px}
.verdict .dot{flex:none;width:18px;height:18px;border-radius:50%}
.verdict.pass .dot{background:var(--pass)}.verdict.fail .dot{background:var(--fail)}.verdict.inconclusive .dot{background:var(--warn)}.verdict.running .dot{background:var(--muted)}
.who{display:block;font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
h1{font-size:clamp(28px,4.4vw,46px);line-height:1.08;letter-spacing:-.025em;margin:0}
.promise{font-size:19px;color:var(--muted);margin:8px 0 0}
.meta{font:13px ui-monospace,Menlo,monospace;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:32px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:14px;min-width:0}
.card.hero{grid-column:1/-1;border-width:2px}.card.hero.fail{border-color:var(--fail)}.card.hero.pass{border-color:var(--pass)}
.body{display:flex;flex-direction:column;gap:14px;min-width:0}.text{display:flex;flex-direction:column;gap:14px;min-width:0}
figure{margin:0;min-width:0}figcaption{font-size:12px;color:var(--muted);margin-top:6px}
.card.wide{grid-column:1/-1}
.card.hero .body,.card.wide .body{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);align-items:start;gap:22px}
.card header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
h2{font-size:20px;margin:0;letter-spacing:-.01em}
.role{margin:2px 0 0;color:var(--muted);font-size:14px}
.pill{flex:none;font:700 13px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;padding:6px 12px;border-radius:999px;color:#fff}
.pill.pass{background:var(--pass)}.pill.fail{background:var(--fail)}.pill.inconclusive{background:var(--warn)}
.shot{display:block;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:var(--ground);aspect-ratio:16/9}
.shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top left}
.shot.none{display:grid;place-items:center;color:var(--muted);font-size:14px}
.summary{margin:0;white-space:pre-line;overflow-wrap:anywhere}
details{border-top:1px solid var(--line);padding-top:10px}
summary{cursor:pointer;color:var(--muted);font-size:14px}
.objective{font-size:14px;overflow-wrap:anywhere}
ol{margin:8px 0 0;padding-left:20px;font-size:14px;color:var(--muted)}li{overflow-wrap:anywhere;margin:2px 0}
.replay{margin-top:28px;background:var(--card);border:1px dashed var(--line);border-radius:14px;padding:18px 20px}
.replay code{display:block;font:13px/1.5 ui-monospace,Menlo,monospace;overflow-wrap:anywhere;color:var(--muted);margin-top:6px}
footer{margin-top:36px;color:var(--muted);font-size:13px}
@media (max-width:760px){.grid{grid-template-columns:1fr}.wrap{padding:28px 16px 48px}.card.hero .body,.card.wide .body{grid-template-columns:1fr}}
</style></head>
<body><main class="wrap">
<p class="kicker">Returner · upgrade rehearsal with Kane CLI</p>
<div class="verdict ${overall}"><span class="dot" aria-hidden="true"></span><h1>${escape(headline)}</h1></div>
<p class="promise">Promise: “${escape(report.promise)}”</p>
${report.url ? `<p class="meta">Both builds served at ${escape(report.url)}</p>` : ""}
<div class="grid">
${cards}
</div>
${report.replay ? `<section class="replay"><strong>Replay after repair</strong><code>${escape(report.replay)}</code></section>` : ""}
<footer>Every screenshot and verdict comes from Kane CLI's own run evidence. Screenshots show Kane's final step for each check.</footer>
</main></body></html>`;
  await writeFile(join(directory, "report.html"), page);
}
