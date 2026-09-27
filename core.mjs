export function validateConfig(value, manifest) {
  const bad = (message) => { throw new Error(message); };
  if (!value || value.version !== 1) bad('配置版本无效');
  const gallery = new Set(manifest.filter((p) => p.folder === 'photos').map((p) => p.id));
  const all = new Set(manifest.map((p) => p.id));
  if (!Array.isArray(value.order) || value.order.length !== gallery.size || new Set(value.order).size !== gallery.size || value.order.some((id) => !gallery.has(id))) bad('照片顺序必须完整包含每张画廊照片，且不能重复');
  if (!Array.isArray(value.featured) || value.featured.length !== 3 || new Set(value.featured).size !== 3 || value.featured.some((id) => !all.has(id))) bad('请选择 3 张不同的有效精选照片');
  if (!['masonry', 'grid', 'list'].includes(value.layout)) bad('无效的排版');
  if (!Number.isInteger(value.columns) || value.columns < 2 || value.columns > 6) bad('列数应为 2—6');
  if (!Number.isInteger(value.gap) || value.gap < 8 || value.gap > 40) bad('间距应为 8—40');
  if (typeof value.captions !== 'boolean') bad('文件名显示配置无效');
  for (const [key, max] of Object.entries({ title: 40, subtitle: 40, description: 300, about: 600 })) {
    if (typeof value[key] !== 'string' || value[key].length > max) bad('文字长度超限或格式错误');
  }
  return Object.fromEntries(['version', 'order', 'featured', 'layout', 'columns', 'gap', 'captions', 'title', 'subtitle', 'description', 'about'].map((key) => [key, value[key]]));
}
export async function passwordMatches(header, secret) {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const encode = new TextEncoder();
  const hashes = await Promise.all([header.slice(7), secret].map((s) => crypto.subtle.digest('SHA-256', encode.encode(s))));
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]); let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}
export function apiJSON(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
