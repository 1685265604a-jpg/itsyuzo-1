// Native Node.js 22+ server. No package installation or build is required.
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, passwordMatches } from './core.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(root, 'site');
const statePath = resolve(process.env.ARCHIVE_STATE_PATH || resolve(root, 'data/published.json'));
const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
const manifest = JSON.parse(await readFile(resolve(site, 'photo-manifest.json'), 'utf8'));
const configText = await readFile(resolve(site, 'site-config.js'), 'utf8');
const initial = JSON.parse(configText.replace(/^window\.ARCHIVE_CONFIG\s*=\s*/, '').replace(/;\s*$/, ''));
let current = { config: initial, revision: 0 };
try { const stored = JSON.parse(await readFile(statePath, 'utf8')); validateConfig(stored.config, manifest); if (!Number.isInteger(stored.revision) || stored.revision < 0) throw new Error('Invalid revision'); current = stored; }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Published state could not be loaded. Restore the state file before restarting.', { cause: error }); }
let writeQueue = Promise.resolve();
const failures = new Map();
const mime = { '.html': 'text/html;charset=utf-8', '.css': 'text/css;charset=utf-8', '.js': 'application/javascript;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function body(req) { let result = ''; for await (const chunk of req) { result += chunk; if (Buffer.byteLength(result) > 200000) throw new Error('配置文件过大'); } return JSON.parse(result); }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/config') {
      if (req.method === 'GET') return json(res, 200, { service: 'my-archive', editable: Boolean(process.env.ADMIN_PASSWORD), ...current });
      if (req.method !== 'PUT') return json(res, 405, { error: '不支持此方法' });
      if (!process.env.ADMIN_PASSWORD) return json(res, 503, { error: '尚未配置管理密码' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: '来源不受信任' });
      const ip = req.socket.remoteAddress, attempt = failures.get(ip);
      if (attempt && attempt.until > Date.now() && attempt.count >= 8) return json(res, 429, { error: '密码尝试过多，请 5 分钟后重试' });
      if (!await passwordMatches(req.headers.authorization, process.env.ADMIN_PASSWORD)) {
        failures.set(ip, { count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1, until: Date.now() + 300000 });
        return json(res, 401, { error: '管理密码不正确' });
      }
      failures.delete(ip);
      let input, config;
      try { input = await body(req); config = validateConfig(input.config, manifest); }
      catch (error) { return json(res, 400, { error: error.message }); }
      const write = async () => {
        if (input.revision !== current.revision) return json(res, 409, { error: '版本冲突，请刷新后重新编辑' });
        const next = { config, revision: current.revision + 1 };
        await mkdir(dirname(statePath), { recursive: true });
        await writeFile(statePath + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 }); await rename(statePath + '.tmp', statePath);
        current = next; json(res, 200, { revision: current.revision });
      };
      const operation = writeQueue.then(write); writeQueue = operation.catch(() => {}); await operation; return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    if (pathname === '/') pathname = '/index.html';
    const path = resolve(site, '.' + pathname);
    if (!path.startsWith(site + sep) || pathname.split('/').some((part) => part.startsWith('.'))) { res.writeHead(403); res.end(); return; }
    let info; try { info = await stat(path); } catch { res.writeHead(404); res.end('Not found'); return; }
    if (!info.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const headers = { 'Content-Type': mime[extname(path).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Accept-Ranges': 'bytes', 'Cache-Control': pathname.startsWith('/assets/') ? 'public,max-age=3600' : 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`; headers['Content-Length'] = end - start + 1;
    }
    res.writeHead(status, headers); if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(path, { start, end }); stream.on('error', () => res.destroy()); stream.pipe(res);
  } catch (error) { if (!res.headersSent) json(res, 500, { error: '服务暂时不可用，请稍后重试' }); else res.destroy(); console.error(error.message); }
});
server.listen(port, host, () => console.log(`MY ARCHIVE: http://${host}:${port} (${process.env.ADMIN_PASSWORD ? 'online editing enabled' : 'preview / read-only API'})`));
