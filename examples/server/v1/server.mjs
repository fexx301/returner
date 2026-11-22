// Quillpad v1: a server-rendered draft editor. The draft lives in a cookie, so it is browser state.
import { createServer } from "node:http";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const read = (req) => Object.fromEntries((req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]));
const body = (req) => new Promise((done) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => done(new URLSearchParams(s))); });

createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/save") {
    const form = await body(req);
    const draft = encodeURIComponent(JSON.stringify({ title: form.get("title") || "", body: form.get("body") || "" }));
    res.writeHead(303, { "Set-Cookie": `draft=${draft}; Path=/; Max-Age=31536000; SameSite=Lax`, Location: `http://${req.headers.host}/` });
    return res.end();
  }
  const draft = read(req).draft ? JSON.parse(decodeURIComponent(read(req).draft)) : { title: "", body: "" };
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>Quillpad</title>
<style>body{font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px}input,textarea{display:block;width:100%;margin:6px 0 14px;font:inherit;padding:8px}textarea{height:140px}</style>
<h1>Quillpad</h1>
<form method="post" action="/save">
<label>Title<input name="title" value="${esc(draft.title)}"></label>
<label>Body<textarea name="body">${esc(draft.body)}</textarea></label>
<button>Save draft</button>
</form>`);
}).listen(Number(process.env.PORT || 4001), "127.0.0.1");
