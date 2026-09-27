import { DurableObject } from 'cloudflare:workers';
import { validateConfig, passwordMatches, apiJSON } from './core.mjs';
import manifest from '../site/photo-manifest.json';
import defaults from './default-config.json';

export class GalleryState extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx = ctx; this.env = env; this.failures = new Map(); }
  async fetch(request) {
    const current = (await this.ctx.storage.get('published')) || { config: defaults, revision: 0 };
    if (request.method === 'GET') return apiJSON({ service: 'my-archive', editable: Boolean(this.env.ADMIN_PASSWORD), ...current });
    if (request.method !== 'PUT') return apiJSON({ error: '不支持此方法' }, 405);
    if (!this.env.ADMIN_PASSWORD) return apiJSON({ error: '尚未配置管理密码' }, 503);
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return apiJSON({ error: '来源不受信任' }, 403);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown', now = Date.now();
    if (this.failures.size > 1000) for (const [key, value] of this.failures) if (value.until <= now) this.failures.delete(key);
    const attempt = this.failures.get(ip);
    if (attempt && attempt.until > now && attempt.count >= 8) return apiJSON({ error: '密码尝试过多，请 5 分钟后重试' }, 429);
    if (!await passwordMatches(request.headers.get('Authorization'), this.env.ADMIN_PASSWORD)) {
      this.failures.set(ip, { count: attempt && attempt.until > now ? attempt.count + 1 : 1, until: now + 300000 });
      return apiJSON({ error: '管理密码不正确' }, 401);
    }
    this.failures.delete(ip);
    let input, config;
    try {
      const reader = request.body?.getReader(); if (!reader) throw new Error('缺少配置');
      const chunks = []; let length = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 200000) { await reader.cancel(); throw new Error('配置文件过大'); } chunks.push(value); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      input = JSON.parse(new TextDecoder().decode(bytes)); config = validateConfig(input.config, manifest);
    } catch (error) { return apiJSON({ error: error.message }, 400); }
    const result = await this.ctx.storage.transaction(async (tx) => {
      const previous = (await tx.get('published')) || { config: defaults, revision: 0 };
      if (input.revision !== previous.revision) return null;
      const next = { config, revision: previous.revision + 1 }; await tx.put('published', next); return next.revision;
    });
    return result === null ? apiJSON({ error: '版本冲突，请刷新后重新编辑' }, 409) : apiJSON({ revision: result });
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/config') {
      try {
        // Buffer the bounded payload before forwarding it to the Durable Object.
        // Early auth responses must not leave the incoming upload stream active.
        let forwarded = request;
        if (request.method === 'PUT') {
          const reader = request.body?.getReader();
          if (!reader) return apiJSON({ error: '缺少配置' }, 400);
          const chunks = []; let length = 0;
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            length += value.length;
            if (length > 200000) { await reader.cancel(); return apiJSON({ error: '配置文件过大' }, 413); }
            chunks.push(value);
          }
          const bytes = new Uint8Array(length); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          forwarded = new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
        }
        return await env.GALLERY_STATE.get(env.GALLERY_STATE.idFromName('gallery')).fetch(forwarded);
      }
      catch { return apiJSON({ error: '在线保存暂时不可用' }, 503); }
    }
    if (url.pathname === '/assets/photos/IMG_6093.JPG') {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      const object = await env.ORIGINALS.get('assets/photos/IMG_6093.JPG', { range: request.headers });
      if (!object) return new Response('Original photo is not uploaded', { status: 404 });
      const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('Content-Type', 'image/jpeg'); headers.set('ETag', object.httpEtag); headers.set('Cache-Control', 'public,max-age=3600'); headers.set('Accept-Ranges', 'bytes');
      const range = object.range;
      if (range) {
        const offset = range.offset ?? Math.max(0, object.size - range.suffix);
        const length = range.length ?? object.size - offset;
        headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`); headers.set('Content-Length', String(length));
      } else headers.set('Content-Length', String(object.size));
      return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers });
    }
    return env.ASSETS.fetch(request);
  }
};
