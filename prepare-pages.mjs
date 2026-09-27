import { readFile, writeFile, access, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.env.PHOTO_ASSET_BASE_URL?.trim();
if (!raw) throw new Error('请在仓库 Settings → Secrets and variables → Actions → Variables 中添加 PHOTO_ASSET_BASE_URL，填写已上传原图的公开 HTTPS 域名。详见 README.md。');
const url = new URL(raw);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('PHOTO_ASSET_BASE_URL 必须为不带密码、查询参数和锚点的公开 HTTPS 地址。');
if (/\.(example|invalid|test|localhost)$/.test(url.hostname) || /(^|\.)example\.(com|net|org)$/.test(url.hostname) || url.hostname === 'localhost') throw new Error('请填写你自己的实际图片地址，不要填写文档示例。');
const manifest = JSON.parse(await readFile(resolve(root, 'site/photo-manifest.json'), 'utf8'));
if (manifest.length !== 645) throw new Error('照片清单数量不符，请检查原始目录。');
for (const name of ['index.html', 'styles.css', 'script.js', 'gallery-data.js', 'site-config.js']) await access(resolve(root, 'site', name));
try { await stat(resolve(root, 'site/assets')); throw new Error('GitHub Pages 构建目录中不应包含原图，请保留 site/assets/ 的 gitignore 规则。'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const config = { assetBaseUrl: raw.replace(/\/+$/, ''), enableApi: false };
await writeFile(resolve(root, 'site/deployment-config.js'), 'window.ARCHIVE_DEPLOYMENT = ' + JSON.stringify(config, null, 2) + ';\n');
console.log('GitHub Pages 配置完成。照片保持原文件，通过外部地址加载；本次部署不包含写入接口。');
