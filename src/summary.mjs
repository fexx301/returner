#!/usr/bin/env node
// Markdown verdict table for a GitHub job summary: node src/summary.mjs <report.json> <verdict>
import { readFileSync } from "node:fs";

const [file, verdict = "inconclusive"] = process.argv.slice(2);
let report = { results: [] };
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch {}
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 300);
const icon = { pass: "✅", fail: "❌", inconclusive: "⚠️" };
const lines = [
  `## Returner: ${icon[verdict] || "⚠️"} ${verdict}`,
  report.promise ? `> ${cell(report.promise)}` : "",
  "",
  "| Check | Verdict | Kane observed |",
  "| --- | --- | --- |",
  ...report.results.map((r) => `| ${cell(r.name)} | ${icon[r.status] || ""} ${cell(r.status)} | ${cell(r.summary || r.reason)} |`),
];
if (!report.results.length) lines.push("| — | ⚠️ inconclusive | Returner did not produce a report. |");
if (report.replay) lines.push("", "Replay after repair:", "```sh", report.replay, "```");
console.log(lines.join("\n"));
