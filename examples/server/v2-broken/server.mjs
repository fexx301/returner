// Quillpad v2: drafts now carry a "last saved" time, stored as base64url JSON. The bug only returning users
// hit: v1's cookie is URL-encoded JSON, so decoding it as base64url throws and the page answers 500.
import { createServer } from "node:http";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const read = (req) => Object.fromEntries((req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]));
const body = (req) => new Promise((done) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => done(new URLSearchParams(s))); });
const decode = (cookie) => JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"));
const encode = (draft) => Buffer.from(JSON.stringify(draft)).toString("base64url");

createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/save") {
      const form = await body(req);
      const draft = encode({ v: 2, title: form.get("title") || "", body: form.get("body") || "", saved: new Date().toISOString() });
      res.writeHead(303, { "Set-Cookie": `draft=${draft}; Path=/; Max-Age=31536000; SameSite=Lax`, Location: `http://${req.headers.host}/` });
      return res.end();
    }
    const cookie = read(req).draft;
    const draft = cookie ? decode(cookie) : { title: "", body: "" };
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>Quillpad</title>
<style>body{font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px}input,textarea{display:block;width:100%;margin:6px 0 14px;font:inherit;padding:8px}textarea{height:140px}small{color:#666}</style>
<h1>Quillpad</h1>
${draft.saved ? `<p><small>Last saved ${esc(new Date(draft.saved).toUTCString())}</small></p>` : ""}
<form method="post" action="/save">
<label>Title<input name="title" value="${esc(draft.title)}"></label>
<label>Body<textarea name="body">${esc(draft.body)}</textarea></label>
<button>Save draft</button>
</form>`);
  } catch (error) {
    console.error(req.method, req.url, error.stack);
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal Server Error");
  }
}).listen(Number(process.env.PORT || 4002), "127.0.0.1");
