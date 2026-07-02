# Music Analysis Dashboard

这是一个面向独立音乐人的个人音乐分析仪表盘。它可以直接展示示例数据，也支持上传你自己的 CSV 文件。

## 支持的 CSV 字段

当前页面会自动兼容两类结构：

- 通用音乐分析格式：date, song, platform, country, revenue, genre
- SoundCloud 月报格式：Reporting Period, Accounting Period, Track, Partner, Country, Revenue (USD), Type

如果你的 CSV 使用的是 SoundCloud 的列名，页面会自动映射为仪表盘所需字段。

## 运行方式

在当前目录下启动一个本地静态服务器：

```bash
python3 -m http.server 8000
```

然后在浏览器中打开：

```text
http://localhost:8000
```

## GitHub Pages 部署

这个项目是纯静态网页，直接部署到 GitHub Pages 即可。

1. 把仓库推送到 GitHub
2. 打开仓库的 Settings → Pages
3. 选择 Deploy from a branch
4. 选择 main 分支、根目录 /
5. 保存后即可访问 Pages 地址

仓库里已经包含自动部署配置，推送到 main 分支时会自动发布。

## 现有功能

- 总收入、最佳歌曲、最佳平台、增长趋势摘要
- 歌曲收益柱状图
- 平台收益占比条形图
- 地区听众分布列表
- 收益随时间的趋势线图
- 基于数据的创作建议
- 支持上传自定义 CSV
