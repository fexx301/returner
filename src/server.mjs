import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.wasm':'application/wasm', '.woff2':'font/woff2' };

export async function serve(port) {
  let root;
  let documents = 0;
  const server = createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) throw Error();
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + pathname);
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      file = await realpath(file);
      if (!file.startsWith(root + sep) || pathname.split('/').some(p => p.startsWith('.'))) throw Error();
      const data = await readFile(file);
      const ext = extname(file);
      if (ext === '.html' && req.method === 'GET' && req.headers['sec-fetch-dest'] === 'document') documents++;
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control':'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  return {
    port: server.address().port,
    async use(dir) { root = await realpath(dir); await stat(resolve(root, 'index.html')); documents = 0; },
    documents: () => documents,
    close: () => server.close()
  };
}
