#!/usr/bin/env node
// Builds index.html (the GitHub Pages landing page) from the evidence folders: one strip per closed loop,
// fail → Kane's finding → the agent's patch → passing replay. Run: node scripts/build-results.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const report = (dir) => JSON.parse(readFileSync(join(root, dir, "report.json"), "utf8"));
const check = (dir, name) => report(dir).results.find((r) => r.name === name);
// What the failure looked like: Kane's captured console error when present, else its verdict reason.
const failLine = (r) => { const e = String(r?.summary || "").match(/console_error: ([^\n]+?)(?:\s+evidence:|$)/); return e ? `Console: ${e[1]}` : r?.reason; };
const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// Lead with the file that holds the repair (migration/restore/storage logic), not import and state wiring.
function patchExcerpt(diff) {
  const files = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
  const byFile = diff.split(/^diff --git /m).slice(1).map((chunk) => ({ file: chunk.match(/^\+\+\+ b\/(.+)$/m)?.[1] || "", lines: chunk.split("\n") }));
  const key = (f) => (/test/i.test(f) ? 2 : /migrat|restore|storage|draft/i.test(f) ? 0 : 1);
  byFile.sort((a, b) => key(a.file) - key(b.file));
  const added = byFile.flatMap((c) => c.lines).filter((l) => l.startsWith("+") && !l.startsWith("+++") && l.slice(1).trim() && !/^\s*(\/\/|\*|import )/.test(l.slice(1)));
  return { files, lines: added.slice(0, 9).map((l) => l.slice(1).replace(/^\s{2,}/, (s) => s.slice(0, 4))), more: Math.max(0, added.length - 9) };
}

const loops = [
  { id: "pkimm", title: "PKI Consortium self-assessment", tag: "Real regression · shipped in a release", issue: ["pkic/self-assessment#148", "https://github.com/pkic/self-assessment/issues/148"],
    change: "Assessment model 1.0.0 → 1.1.0", agent: "Claude Code",
    note: "The loop's own replay of this patch came back inconclusive: Kane read the instruction \"fail immediately without typing\" as an order to stop. The check was reworded as a plain read-only rule with the same requirements, and the patch was replayed by hand from the same saved profile. The patch also treats every unversioned save as a 1.0.0 save, so users who first saved on the shipped 1.1.0 release could lose an answer. For a loop with no human step, see the uninterrupted Codex run below.",
    before: "evidence/pkimm-1.0.0-to-1.1.0/before", after: "evidence/pkimm-1.0.0-to-1.1.0/after", diff: "evidence/pkimm-1.0.0-to-1.1.0/repair.diff" },
  { id: "recorded-run", title: "The same regression, one uninterrupted run", tag: "Recorded run · 20 min 6 s · fixed on attempt 1", issue: ["pkic/self-assessment#148", "https://github.com/pkic/self-assessment/issues/148"],
    change: "Assessment model 1.0.0 → 1.1.0", agent: "Codex", before: "evidence/pkimm-1.0.0-to-1.1.0/codex-recorded-run/before", after: "evidence/pkimm-1.0.0-to-1.1.0/codex-recorded-run/after", diff: "evidence/pkimm-1.0.0-to-1.1.0/codex-recorded-run/repair.diff" },
  { id: "rackula", title: "Rackula rack designer", tag: "Real regression · caught by its maintainers before release", issue: ["RackulaLives/Rackula#935", "https://github.com/RackulaLives/Rackula/issues/935"],
    change: "v0.6.16 → v0.7.0 development build", agent: "Codex", before: "evidence/rackula-0.6.16-to-0.7.0-dev/before", after: "evidence/rackula-0.6.16-to-0.7.0-dev/after", diff: "evidence/rackula-0.6.16-to-0.7.0-dev/repair.diff" },
  { id: "fieldnotes", title: "Fieldnotes", tag: "Our fixture · storage key deliberately renamed", change: "v1 → v2", agent: "Codex", before: "evidence/fieldnotes-before", after: "evidence/fieldnotes-after",
    fixture: ["examples/draft/v2-broken/draft.js", "examples/draft/v2/draft.js"] },
];

function strip(l) {
  const fail = check(l.before, "returning user"), pass = check(l.after, "returning user");
  const diff = l.diff ? readFileSync(join(root, l.diff), "utf8")
    : spawnSync("git", ["diff", "--no-index", "--", ...l.fixture], { cwd: root, encoding: "utf8" }).stdout.replace(/b\/examples\/draft\/v2\//g, "b/");
  const p = patchExcerpt(diff);
  // Kane's own console capture, when the evidence folder carries one, is the clearest failure line.
  const consoleFile = join(root, l.before, "console-errors.ndjson");
  const consoleLine = existsSync(consoleFile) ? JSON.parse(readFileSync(consoleFile, "utf8").split("\n")[0]).text : null;
  const shot = (dir, r) => r?.shot ? `<a class="img" href="${dir}/${r.shot}"><img src="${dir}/${r.shot}" alt="Kane's final screenshot"><span class="chip">Kane's screenshot</span></a>` : "";
  return `<section class="loop" id="${l.id}">
  <header class="lh"><div><p class="tag">${esc(l.tag)}</p><h2>${esc(l.title)}</h2>
  <p class="sub">${esc(l.change)}${l.issue ? ` · <a href="${l.issue[1]}">${esc(l.issue[0])}</a>` : ""} · repaired by ${esc(l.agent)}</p></div>
  <p class="links"><a href="${l.before}/report.html">Before report</a><a href="${l.after}/report.html">After report</a>${l.diff ? `<a href="https://github.com/fexx301/returner/blob/main/${l.diff}">Full patch</a>` : `<a href="https://github.com/fexx301/returner/tree/main/examples/draft">Fixture source</a>`}</p></header>
  ${l.note ? `<p class="note">${esc(l.note)}</p>` : ""}
  <ol class="steps">
    <li class="step fail"><span class="n">1</span><h3>Returning user fails</h3>${shot(l.before, fail)}<p>${esc(clip(consoleLine ? `Console: ${consoleLine}` : failLine(fail), 150))}</p></li>
    <li class="step"><span class="n">2</span><h3>Kane's finding goes to the agent</h3><blockquote>${esc(clip(fail?.summary || fail?.reason, 170))}</blockquote>${String(fail?.summary || "").length > 170 ? `<details class="more"><summary>Kane's full finding</summary><p>${esc(fail?.summary)}</p></details>` : ""}<p class="fine">Plus the unchanged objective and the release promise. The agent edits a disposable copy only.</p></li>
    <li class="step"><span class="n">3</span><h3>${l.diff ? `${esc(l.agent)}'s patch` : "The fix (as committed in the fixture)"}</h3><p class="files">${p.files.map(esc).join("<br>")}</p><pre>${p.lines.map(esc).join("\n")}${p.more ? `\n… ${p.more} more added lines` : ""}</pre></li>
    <li class="step pass"><span class="n">4</span><h3>Replay from the same saved profile passes</h3>${shot(l.after, pass)}<p>${esc(clip(pass?.summary, 170))}</p></li>
  </ol>
</section>`;
}

const deck = check("evidence/deckmark-2.5.3-to-2.5.4", "returning user");
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%23141517%27/%3E%3Cpath d=%27M9 17l5 5 9-12%27 stroke=%27%233fbf75%27 stroke-width=%274%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E">
<title>Returner · results</title>
<meta property="og:type" content="website">
<meta property="og:title" content="Returner · release checks for the people who come back">
<meta property="og:description" content="Real regressions caught with Kane CLI, repaired by a coding agent and verified by replaying the same saved browser profile.">
<meta property="og:url" content="https://fexx301.github.io/returner/">
<meta property="og:image" content="https://fexx301.github.io/returner/docs/social-preview.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://fexx301.github.io/returner/docs/social-preview.png">
<meta name="description" content="Release checks for the people who come back: real regressions caught with Kane CLI, repaired by a coding agent, verified by replay.">
<style>
:root{--ground:#eceae4;--card:#fff;--ink:#141517;--muted:#5e5c57;--line:#d9d6ce;--pass:#1e8a4c;--fail:#c83f1a;--code:#17181b;--codeink:#e9e6df}
@media (prefers-color-scheme:dark){:root{--ground:#121315;--card:#1c1e21;--ink:#f1efe8;--muted:#a9a69e;--line:#2d3034;--pass:#3fbf75;--fail:#ff7a52;--code:#0d0e10}}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}.wrap{max-width:1240px;margin:0 auto;padding:40px 20px 56px}
a:focus-visible,summary:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--pass) 45%,transparent);border-radius:6px}
.site{position:sticky;top:0;z-index:20;background:var(--ground);background:color-mix(in srgb,var(--ground) 86%,transparent);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.siteinner{max-width:1240px;margin:0 auto;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:-.02em;text-decoration:none}
.mk{width:28px;height:28px;border-radius:8px;background:#141517;border:1px solid rgba(255,255,255,.14);display:grid;place-items:center;flex:none}
.sitenav{display:flex;gap:20px;font-size:14px;align-items:center}.sitenav a{color:var(--muted);text-decoration:none}.sitenav a:hover{color:var(--ink)}
.sitenav a.go{color:var(--ground);background:var(--ink);padding:7px 12px;border-radius:8px;font-weight:600}
.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:40px;align-items:center}
.frame{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 30px 60px -34px rgba(0,0,0,.45)}
.fbar{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line);background:var(--ground);font:12px ui-monospace,Menlo,monospace;color:var(--muted)}
.fbar i{width:9px;height:9px;border-radius:50%;background:var(--line)}.fbar span{margin-left:6px}
.frame img{display:block;width:100%;height:auto}
.figcap{font-size:13px;color:var(--muted);margin:10px 2px 0}
.jump{display:flex;flex-wrap:wrap;gap:8px;margin:26px 0 0}.jump a{font-size:13px;text-decoration:none;padding:6px 11px;border:1px solid var(--line);border-radius:999px;color:var(--muted);background:var(--card)}.jump a:hover{color:var(--ink);border-color:var(--ink)}
.loop{scroll-margin-top:72px}
.img{position:relative}.chip{position:absolute;left:8px;top:8px;font:600 10.5px ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:3px 7px;border-radius:6px;background:rgba(20,21,23,.78);color:#f1efe8}
.more{font-size:13px}.more summary{cursor:pointer;color:var(--muted)}.more p{margin:8px 0 0!important;font-size:13px!important;color:var(--muted)}
.sitefoot{border-top:1px solid var(--line);margin-top:48px}.footinner{max-width:1240px;margin:0 auto;padding:24px 20px 40px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted)}.footinner a{color:var(--muted)}.footinner nav{display:flex;gap:16px}
.kicker,.tag{font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0}
h1{font-size:clamp(34px,5.2vw,62px);line-height:1.02;letter-spacing:-.035em;margin:12px 0 14px;max-width:16ch;text-wrap:balance}
.lede{font-size:19px;max-width:62ch;color:var(--muted);margin:0;text-wrap:pretty}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 8px}.cta a{text-decoration:none;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--card);font-weight:600}
.cta a.primary{background:var(--ink);color:var(--ground);border-color:var(--ink)}
.stats{display:flex;flex-wrap:wrap;gap:28px;margin:34px 0 10px;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.stats b{display:block;font-size:30px;letter-spacing:-.02em}.stats span{color:var(--muted);font-size:14px}
.loop{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;margin-top:26px}
.lh{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end}
h2{font-size:26px;letter-spacing:-.02em;margin:4px 0 2px}.sub{margin:0;color:var(--muted);font-size:14px}
.links{display:flex;gap:14px;flex-wrap:wrap;margin:0;font-size:14px}.links a{color:var(--muted)}
.steps{list-style:none;padding:0;margin:20px 0 0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;counter-reset:s}
.step{position:relative;border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.step:not(:last-child)::after{content:"→";position:absolute;right:-13px;top:44%;font-size:18px;color:var(--muted);background:var(--card);line-height:1;padding:2px 0}
.step.fail{border-color:var(--fail)}.step.pass{border-color:var(--pass)}
.n{font:700 12px ui-monospace,Menlo,monospace;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--ground);color:var(--muted)}
.fail .n{background:var(--fail);color:#fff}.pass .n{background:var(--pass);color:#fff}
h3{font-size:15px;margin:0;line-height:1.3}
.img{display:block;border-radius:8px;overflow:hidden;border:1px solid var(--line);aspect-ratio:16/10;background:var(--ground)}
.img img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
.step p{margin:0;font-size:14px;overflow-wrap:anywhere}
blockquote{margin:0;padding:10px 12px;border-left:3px solid var(--fail);background:var(--ground);border-radius:6px;font-size:14px;overflow-wrap:anywhere}
.fine{color:var(--muted);font-size:13px!important}.files{font:12px ui-monospace,Menlo,monospace;color:var(--muted)}
pre{margin:0;background:var(--code);color:var(--codeink);border-radius:8px;padding:10px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}
.note{margin:14px 0 0;padding:10px 14px;border:1px dashed var(--line);border-radius:10px;font-size:14px;color:var(--muted)}
.clean{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:20px;align-items:center}
.notes{margin-top:34px;color:var(--muted);font-size:14px;max-width:80ch}.notes li{margin:4px 0}
@media (max-width:980px){.hero{grid-template-columns:1fr;gap:28px}}
@media (max-width:980px) and (min-width:621px){.steps{grid-template-columns:repeat(2,minmax(0,1fr))}.step:nth-child(2)::after{display:none}}
@media (max-width:620px){.stats{display:grid;grid-template-columns:1fr 1fr;gap:18px}.cta a{flex:1 1 auto;text-align:center}.sitenav a:not(.go):not(.keep){display:none}.siteinner{padding:10px 16px}.steps{grid-template-columns:1fr;gap:22px}.step:not(:last-child)::after{content:"↓";display:block;right:auto;left:50%;top:auto;bottom:-20px;transform:translateX(-50%);padding:0 6px}.clean{grid-template-columns:1fr}.wrap{padding:32px 16px 56px}}
</style></head><body>
<header class="site"><div class="siteinner"><a class="logo" href="./"><span class="mk"><svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 17l6 6 12-15" stroke="#3fbf75" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Returner</a>
<nav class="sitenav" aria-label="Site"><a href="#loops" class="keep">Results</a><a href="https://youtu.be/iPpaQIgh1KI">Video</a><a href="https://github.com/fexx301/returner">GitHub</a><a class="go" href="try/">Try it live</a></nav></div></header>
<main class="wrap">
<div class="hero"><div>
<p class="kicker">Built with Kane CLI · Kane CLI Online Hackathon</p>
<h1>Release checks for the people who come back.</h1>
<p class="lede">Browser tests start with an empty profile, so they only meet new users. Returner rehearses each release as a new user and as a returning user with yesterday's saved work, in real Chrome via Kane CLI. When the returning user breaks, a coding agent repairs it, and Kane replays the exact same saved profile to decide.</p>
<p class="cta"><a class="primary" href="try/">Try it live in your browser →</a><a href="https://github.com/fexx301/returner">Repository</a><a href="https://youtu.be/iPpaQIgh1KI">Watch the video (4 min)</a></p>
</div>
<figure style="margin:0"><div class="frame"><div class="fbar"><i></i><i></i><i></i><span>examples/pkimm/run.sh codex · recorded</span></div><a href="https://youtu.be/iPpaQIgh1KI?t=173"><img src="docs/loop.gif" alt="A recorded 20-minute run, condensed: the returning user fails on a blank page, Codex patches it, and Kane's replay from the same saved profile passes"></a></div>
<figcaption class="figcap">One real, uninterrupted 20-minute repair, condensed to 15 seconds. Kane fails the returning user, Codex patches, Kane's replay passes.</figcaption></figure>
</div>
<div class="stats"><div><b>2</b><span>real regressions reproduced</span></div><div><b>4</b><span>closed loops: fail → patch → pass</span></div><div><b>1</b><span>clean real upgrade confirmed</span></div><div><b>0</b><span>agent self-grading: Kane's replay decides</span></div></div>
<nav class="jump" aria-label="Jump to a loop" id="loops"><a href="#pkimm">PKI Consortium #148</a><a href="#recorded-run">Recorded Codex run</a><a href="#rackula">Rackula #935</a><a href="#fieldnotes">Fieldnotes fixture</a><a href="#deckmark">DeckMark clean upgrade</a></nav>
${loops.map(strip).join("\n")}
<section class="loop" id="deckmark"><header class="lh"><div><p class="tag">Clean upgrade · unmodified upstream builds</p><h2>DeckMark v2.5.3 → v2.5.4</h2><p class="sub">An open-source Markdown editor: the returning user's note survives</p></div><p class="links"><a href="evidence/deckmark-2.5.3-to-2.5.4/report.html">Report</a></p></header>
<div class="clean" style="margin-top:18px"><a class="img" href="evidence/deckmark-2.5.3-to-2.5.4/${deck?.shot}"><img src="evidence/deckmark-2.5.3-to-2.5.4/${deck?.shot}" alt="Kane's final screenshot"></a><p>${esc(clip(deck?.summary, 260))}</p></div></section>
<ul class="notes">
<li>Every screenshot, verdict and finding comes from Kane CLI's own run evidence; patches are the agents' exact diffs (Fieldnotes shows the fixture's committed fix).</li>
<li>Rackula's regression was caught by its maintainers before release and never shipped; Returner reproduces it on the commit before their fix. The PKI Consortium regression shipped.</li>
<li>Repairs map these specific data changes; upstream projects later shipped general migrations. Method and disclosures are in each evidence folder.</li>
</ul>
</main>
<footer class="sitefoot"><div class="footinner"><span>Returner · built for the Kane CLI Online Hackathon by TestMu AI · MIT licensed</span><nav aria-label="Footer"><a href="try/">Try it live</a><a href="https://youtu.be/iPpaQIgh1KI">Video</a><a href="https://github.com/fexx301/returner">GitHub</a></nav></div></footer>
</body></html>`;
writeFileSync(join(root, "index.html"), page);
console.log("wrote index.html");
