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

export async function openChrome(profile) {
  rmSync(join(profile, "DevToolsActivePort"), { force: true });
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "about:blank"];
  // shortcut: Ubuntu 24.04 runners block Chrome's sandbox; the page under test is the user's own localhost build.
  if (process.platform === "linux") args.unshift("--no-sandbox");
  const chrome = spawn(chromePath(), args, { stdio: "ignore" });
  const exited = new Promise((done) => chrome.on("exit", done));
  chrome.on("error", () => {});
  let version;
  for (let i = 0; i < 150 && !version; i++) {
    if (chrome.exitCode !== null) break;
    const port = existsSync(join(profile, "DevToolsActivePort")) && readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
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
    async close() {
      if (chrome.exitCode === null) {
        const ws = new WebSocket(version.webSocketDebuggerUrl);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
        ws.onerror = () => chrome.kill("SIGKILL"); // no DevTools left to ask
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000).unref())]);
      }
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    },
  };
}
