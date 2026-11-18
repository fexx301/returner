import { writeFile } from "node:fs/promises";
import { join } from "node:path";

function escape(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

export async function writeReport(directory, report) {
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  const labels = {
    "old baseline": "Before upgrade",
    "saved edit": "Reopened after editing",
    "new user": "New user",
    "returning user": "Returning user",
  };
  const cards = ["new user", "returning user", "saved edit", "old baseline"].map((name) => {
    const result = report.results.find((r) => r.name === name);
    if (!result) return "";
    return `<section><h2>${labels[name]}</h2><strong class="${escape(result.status)}">${escape(result.status)}</strong><p>${escape(result.summary || result.reason || "Kane did not return a complete result.")}</p><details><summary>Objective and observed steps</summary><p>${escape(result.objective)}</p><ol>${result.steps
      .filter((s) => s.status !== "running")
      .map((s) => `<li>${escape(s.remark)}</li>`)
      .join("")}</ol></details></section>`;
  });
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Returner · Upgrade rehearsal</title>
  <style>*{box-sizing:border-box}body{margin:6vh auto;padding:0 24px;max-width:950px;font:17px/1.5 system-ui;color:#20302c;background:#f7f7f1}header{border-bottom:1px solid #c9cfca}h1{font:3rem Georgia,serif;margin:0}main{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));margin-top:24px}section{background:white;border:1px solid #c9cfca;padding:22px}h2{font-size:1.1rem;margin-top:0}strong{text-transform:uppercase;letter-spacing:.06em}.pass{color:#13582c}.fail{color:#99290f}.inconclusive{color:#754d05}summary{cursor:pointer}p,li{overflow-wrap:anywhere}</style>
  <header><h1>Returner</h1><p>${escape(report.promise)}</p></header><main>${cards.join("")}</main></html>`;
  await writeFile(join(directory, "report.html"), page);
}
