// Returner opens Chrome itself and Kane attaches over DevTools. Chrome writes new cookies to disk in batches
// (about every 30 s) and on a clean shutdown; Kane's own shutdown skips that, so cookies saved in a check were lost.
// Closing with Browser.close keeps them. Same flags on every launch, so cookies stay decryptable across checks.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "darwin" && existsSync(mac)) return mac;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"])
    if (spawnSync("which", [name]).status === 0) return name;
  throw Error("Chrome not found. Install Google Chrome or set CHROME_PATH.");
}

// One short CDP JSON-RPC call over a WebSocket; resolves to result or null on timeout/error.
function cdpCall(wsUrl, method, params = {}, timeoutMs = 2500) {
  return new Promise((done) => {
    let settled = false;
    let ws;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      done(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    try { ws = new WebSocket(wsUrl); } catch { return finish(null); }
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id === 1) finish(msg.result ?? null);
      } catch {}
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}

export async function openChrome(profile) {
  rmSync(join(profile, "DevToolsActivePort"), { force: true });
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "about:blank"];
  // shortcut: Ubuntu 24.04 runners block Chrome's sandbox; the page under test is the user's own localhost build.
  if (process.platform === "linux") args.unshift("--no-sandbox");
  const chrome = spawn(chromePath(), args, { stdio: "ignore" });
  const exited = new Promise((done) => chrome.on("exit", done));
  let spawnError;
  chrome.on("error", (err) => { spawnError = err; });
  let version;
  for (let i = 0; i < 150 && !version; i++) {
    if (spawnError) throw spawnError;
    if (chrome.exitCode !== null) break;
    const port = existsSync(join(profile, "DevToolsActivePort")) && readFileSync(join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0].trim();
    if (port) version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json(), () => null);
    if (version) version.endpoint = `http://127.0.0.1:${port}`;
    else await new Promise((r) => setTimeout(r, 200));
  }
  if (!version) {
    chrome.kill("SIGKILL");
    throw Error("Chrome did not open a DevTools port.");
  }
  return {
    endpoint: version.endpoint,
    kill: () => chrome.kill("SIGKILL"),
    // Reads structural browser-state names (localStorage keys, cookie names, IndexedDB names) via CDP
    // right before shutdown. Names only — never values — so markers and secrets never leak.
    async inspect(origin) {
      if (chrome.exitCode !== null || !origin) return undefined;
      try {
        const host = new URL(origin).hostname;
        const state = { localStorage: [], sessionStorage: [], cookies: [], indexedDB: [] };
        let observed = false;
        const cookieRes = await cdpCall(version.webSocketDebuggerUrl, "Storage.getCookies");
        if (cookieRes?.cookies) {
          observed = true;
          state.cookies = [...new Set(
            cookieRes.cookies
              .filter((c) => !c.domain || c.domain.replace(/^\./, "") === host || c.domain === "localhost")
              .map((c) => c.name)
              .filter(Boolean),
          )].sort();
        }
        const targets = await fetch(`${version.endpoint}/json/list`).then((r) => r.json(), () => []);
        const sameOrigin = (u) => { try { return new URL(u).origin === origin; } catch { return false; } };
        const page = Array.isArray(targets) && targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl && sameOrigin(t.url));
        if (page) {
          const evalRes = await cdpCall(page.webSocketDebuggerUrl, "Runtime.evaluate", {
            expression: `(async () => {
              const idb = typeof indexedDB !== "undefined" && indexedDB.databases
                ? (await indexedDB.databases()).map((d) => d && d.name).filter(Boolean).sort()
                : [];
              return {
                localStorage: Object.keys(localStorage).sort(),
                sessionStorage: Object.keys(sessionStorage).sort(),
                indexedDB: [...new Set(idb)],
              };
            })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          const val = evalRes?.result?.value;
          if (val && typeof val === "object") {
            observed = true;
            if (Array.isArray(val.localStorage)) state.localStorage = val.localStorage;
            if (Array.isArray(val.sessionStorage)) state.sessionStorage = val.sessionStorage;
            if (Array.isArray(val.indexedDB)) state.indexedDB = val.indexedDB;
          }
        }
        return observed ? state : undefined;
      } catch {
        return undefined;
      }
    },
    async close() {
      if (chrome.exitCode === null) {
        let ws;
        try {
          ws = new WebSocket(version.webSocketDebuggerUrl);
          ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
          ws.onerror = () => chrome.kill("SIGKILL"); // no DevTools left to ask
        } catch {
          chrome.kill("SIGKILL");
        }
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000).unref())]);
        try { ws?.close(); } catch {}
      }
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    },
  };
}
