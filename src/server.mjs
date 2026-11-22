import { createServer, request } from "node:http";
import { request as requestTls } from "node:https";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

export const isUrl = (target) => /^https?:\/\//i.test(target);

export async function serve(port) {
  let root;
  let upstream; // a running app (URL) instead of a static folder
  let documents = 0;
  let origin;
  // Proxy mode: Chrome only ever sees Returner's origin, so cookies and storage saved on the old app reach the new one.
  function proxy(req, res) {
    const target = new URL(req.url, upstream.origin);
    const headers = { ...req.headers, host: target.host };
    for (const h of ["origin", "referer"]) if (headers[h]) headers[h] = headers[h].replace(origin, upstream.origin);
    const out = (target.protocol === "https:" ? requestTls : request)(target, { method: req.method, headers }, (up) => {
      // Any document response from the app counts, a 500 too: the browser reached the new build.
      if (req.method === "GET" && req.headers["sec-fetch-dest"] === "document") documents++;
      const back = { ...up.headers };
      if (back.location?.startsWith(upstream.origin)) back.location = back.location.slice(upstream.origin.length) || "/";
      if (back["set-cookie"]) back["set-cookie"] = back["set-cookie"].map((c) => c.replace(/;\s*domain=[^;]*/gi, ""));
      res.writeHead(up.statusCode, back);
      up.pipe(res);
    });
    out.on("error", () => res.headersSent ? res.destroy() : res.writeHead(502).end("Returner could not reach " + upstream.origin));
    req.pipe(out);
  }
  const server = createServer(async (req, res) => {
    if (upstream) return proxy(req, res);
    try {
      if (!["GET", "HEAD"].includes(req.method)) throw Error();
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (pathname.split("/").some((p) => p.startsWith("."))) throw Error();
      let file = resolve(root, "." + pathname);
      try {
        if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      } catch (error) {
        // Client-side routed SPAs need index.html on reload of extensionless routes.
        const htmlNav =
          !extname(pathname) &&
          (req.headers["sec-fetch-dest"] === "document" ||
            req.headers.accept?.includes("text/html"));
        if (error.code === "ENOENT" && htmlNav) file = resolve(root, "index.html");
        else throw error;
      }
      file = await realpath(file);
      if (!file.startsWith(root + sep)) throw Error();
      const data = await readFile(file);
      const ext = extname(file);
      if (
        ext === ".html" &&
        req.method === "GET" &&
        req.headers["sec-fetch-dest"] === "document"
      )
        documents++;
      res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  origin = "http://127.0.0.1:" + server.address().port;
  return {
    port: server.address().port,
    async use(target) {
      documents = 0;
      if (isUrl(target)) {
        const parsed = new URL(target);
        if (parsed.pathname !== "/" || parsed.search || parsed.hash)
          throw Error(`Proxy targets must be an origin URL without a path (got ${target}; use ${parsed.origin}).`);
        upstream = parsed;
        // Fails the run (exit 2) when the app isn't up; any HTTP answer, even an error page, means it is.
        await fetch(upstream.origin, { redirect: "manual" }).catch(() => { throw Error(`Nothing is answering at ${upstream.origin}. Start the app first.`); });
        return;
      }
      upstream = undefined;
      root = await realpath(target);
      await stat(resolve(root, "index.html"));
    },
    documents: () => documents,
    close: () => {
      server.closeAllConnections?.();
      server.close();
    },
  };
}
