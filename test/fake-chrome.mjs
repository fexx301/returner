#!/usr/bin/env node
// Stand-in Chrome for the contract tests: opens a DevTools-like port and reports its profile folder,
// which the stand-in kane-cli scripts read to keep their state in the profile.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
const userDataDir = process.argv.find((a) => a.startsWith("--user-data-dir=")).slice(16);
mkdirSync(userDataDir, { recursive: true });
const server = createServer((req, res) => res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/browser/fake`, userDataDir })));
server.listen(0, "127.0.0.1", () => writeFileSync(`${userDataDir}/DevToolsActivePort`, `${server.address().port}\n/devtools/browser/fake\n`));
