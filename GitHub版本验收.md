# GitHub 版本验收

- 代码按仓库结构整理，包含 `.github/workflows/pages.yml`，从 `main` 自动发布 `site`。
- 原图未加入代码包；645 个文件在独立图片包中，SHA-256 与原交付清单一致。
- 构建脚本拒绝缺失地址、文档示例域名和 HTTP 地址；支持 HTTPS 图片域名及路径前缀。
- Chromium 实测仓库子路径、外部图片地址、637 张照片目录、排序与排版、刷新后草稿恢复、大图原文件链接。
- GitHub Pages 模式不请求写入 API，编辑器显示静态配置导出流程。
- 本次未创建 GitHub 远程仓库、未执行真实 GitHub Actions，也未公开上传原图。正式发布需按 README 配置图片域名与 Pages。

原版完整功能验收记录另见 `验收记录.md`。
