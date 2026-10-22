# 予你余生 · 婚纱相册

一份可以离线使用的婚纱照网页，收录 `all_pic/` 下的 60 张照片。

## 打开相册

可以直接双击 `index.html`。也可以在本目录启动本地服务：

```bash
npm run dev
```

然后打开 **http://localhost:5173**。无需安装 Node 依赖。可通过 `npm run dev -- --port 8080` 更换端口。

## 迁移到其他电脑或服务器

完整步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。可生成包含网页、预览图、原图和启动脚本的独立部署包：

```bash
python3 scripts/package_site.py
```

输出为 `output/deployment/wedding-album-portable.zip`。部署包解压后，在 `wedding-album` 文件夹运行 `npm start`；使用 Nginx 或静态网站面板时，上传包内 `site/` 的内容即可。

## 浏览与操作

- 按「森野来信、纯白誓言、复古光影、花间私语」筛选照片，支持错落和整齐两种布局。
- 点击照片进入沉浸式预览，支持方向键、缩略图、手机左右滑动切换。
- 双击、滚轮、缩放按钮或手机双指缩放，可以放大到 300%；放大后可拖动查看细节。
- 点击爱心收藏照片；收藏与排列偏好保存在当前浏览器中。
- 「播放回忆」每 4.5 秒切换一张；手动切换、缩放、关闭页面预览或切至后台会停止自动播放。
- 预览中的「原图」下载按钮对应 `all_pic/` 内的原始照片。
- `Esc` 退出预览，`+` / `-` 缩放，`0` 恢复原始大小。
- 左下角「听一段浪漫」开启背景音乐，点击曲名展开四首纯音乐与音量设置；默认音量 25%，曲目结束后顺序循环。浏览器需要点击后才开始播放。
- 音乐在翻页、筛选和放大照片时持续播放；放大预览时播放器移至照片下方。记住曲目和音量，刷新后保持暂停。手机若不支持网页调音量，使用设备音量键。

网页、字体回退与交互均无需外部服务；照片在本地读取。

背景音乐也保存在本地，由 Kevin MacLeod 创作，以 CC BY 4.0 授权使用。曲目为《There is Romance》《Morning》《Meditation Impromptu 01》《Canon in D for Two Harps》，来源和署名见 [音乐授权](assets/music/credits.html)。发布或迁移时请保留音乐署名与授权页。

## 项目文件

- `index.html`：页面文字、相册封面与情书。
- `styles.css`：响应式布局、奶油白与玫瑰粉配色、交互动效。
- `app.js`：照片筛选、收藏、预览、缩放与播放逻辑。
- `photos.js`：照片清单、场景分组与标题。
- `assets/photos/`：优化后的 WebP 缩略图与高清预览，保留原始照片比例。
- `assets/music/`、`assets/music-player.js`：本地纯音乐、授权说明与独立的背景音乐播放器，构建和便携部署时自动包含。
- `all_pic/`：原始婚纱照，生成预览时不会修改。

## 生成静态站点

```bash
npm run build
```

`dist/` 可作为静态网站目录使用。为保证「下载原图」可用，构建产物同时包含 `all_pic/`；原图约 602 MB。此命令只在本地生成文件。

## 更新照片预览

新增照片后，需要重新生成清单与预览。安装 Pillow 后运行：

```bash
python3 -m pip install Pillow
python3 scripts/prepare_photos.py
```

生成脚本针对现有照片编号配置了场景分组。添加其他命名的照片时，可先调整脚本中的编号解析、`collection_for` 分组规则与 `TITLES` 标题。

## 基础检查

```bash
npm run check
```

支持现代 Chrome、Edge、Firefox 和 Safari。已对减少动态效果的系统偏好、键盘焦点和手机安全区域做适配。
