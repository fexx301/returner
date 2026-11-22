#!/usr/bin/env node
// Markdown verdict table for a GitHub job summary: node src/summary.mjs <report.json> <verdict>
import { readFileSync } from "node:fs";
import { describeStorage } from "./report.mjs";

const [file, verdict = "inconclusive"] = process.argv.slice(2);
let report = { results: [] };
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch {}
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 300);
const icon = { pass: "✅", fail: "❌", inconclusive: "⚠️", errored: "⚠️" };
const observed = (r) => {
  const parts = [];
  if (r.consoleErrors?.length) parts.push(`Console: \`${cell(r.consoleErrors[0]).slice(0, 140)}\``);
  const text = cell(r.summary || r.reason);
  if (text) parts.push(text);
  if (/^https:\/\//.test(r.testUrl || "")) parts.push(`[Test Manager](${r.testUrl})`);
  return parts.join(" · ");
};
const lines = [
  `## Returner: ${icon[verdict] || "⚠️"} ${verdict}`,
  report.promise ? `> ${cell(report.promise)}` : "",
  "",
  "| Check | Verdict | Kane observed |",
  "| --- | --- | --- |",
  ...report.results.map((r) => `| ${cell(r.name)} | ${icon[r.status] || ""} ${cell(r.status)} | ${observed(r)} |`),
];
if (!report.results.length) lines.push("| — | ⚠️ inconclusive | Returner did not produce a report. |");
const storage = describeStorage(report.results);
if (storage?.headline) lines.push("", `**Browser state X-ray:** ${cell(storage.headline)}`);
if (report.policyVerdict) {
  const details = (report.policyVerdict.policies || [])
    .map((p) => `${p.id}: ${p.result}${p.failedGates?.length ? ` (${p.failedGates.join(", ")})` : ""}`)
    .join(", ");
  lines.push("", `**Kane CLI policy:** ${icon[report.policyVerdict.result] || "⚠️"} ${report.policyVerdict.result}${details ? ` — ${cell(details)}` : ""}`);
}
if (report.evidencePack) lines.push("", `Sealed Kane CLI pack: \`${cell(report.evidencePack)}\` (view with \`kane-cli evidence serve\`).`);
if (report.replay) lines.push("", "Replay after repair:", "```sh", report.replay, "```");
console.log(lines.join("\n"));
