// 图片地址应指向 assets 文件夹的上一级，不要包含 /assets。
// 例如 https://images.example.com 下应存在 assets/photos/IMG_6093.JPG。
// 留空时读取本地 site/assets；GitHub Pages 工作流会自动注入仓库变量。
window.ARCHIVE_DEPLOYMENT = {
  assetBaseUrl: "",
  enableApi: true
};
