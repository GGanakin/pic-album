# 婚纱相册：继续运行与迁移部署

这个相册是纯静态网站，没有数据库和后端业务服务。60 张照片的分组、放大、收藏和播放都在浏览器里完成。Node.js 仅用于提供本地 HTTP 服务；使用 Nginx 时不需要 Node.js。

## 1. 继续使用当前项目

在当前项目文件夹打开终端，运行：

```bash
npm run dev
```

在运行服务的电脑上访问 **http://localhost:5173**。

如果提示 `EADDRINUSE`，说明 5173 端口已被占用；原来的相册可能仍在运行，可以先直接访问。需要换端口时使用：

```bash
npm run dev -- --port 8080
```

关闭终端或停止进程会结束这个 Node 服务。服务器长期运行建议使用下面的 Nginx 方式。

## 2. 把现成部署包搬到另一台电脑

下载或复制 `output/deployment/wedding-album-portable.zip`，解压后得到：

```text
wedding-album/
  package.json
  README.md
  scripts/
    serve.mjs
  deploy/
    nginx.conf
  site/
    index.html
    styles.css
    app.js
    photos.js
    assets/
    all_pic/
```

### Windows、macOS、Linux：同样的启动步骤

1. 安装 Node.js 当前的 LTS 版本。
2. 在解压得到的 `wedding-album` 文件夹里打开终端。
3. 执行：

```bash
npm start
```

4. 打开 **http://localhost:5173**。

没有第三方 Node 依赖，不需要执行 `npm install`，也不需要重新处理照片。

换端口的写法是：

```bash
npm start -- --port 8080
```

只想离线查看，也可以直接用浏览器打开 `site/index.html`；建议日常使用上面的 HTTP 启动方式。

### 同一 Wi-Fi 下用手机查看

电脑启动服务后，手机访问：

```text
http://电脑的局域网IP:5173
```

例如电脑 IP 为 `192.168.1.100`，地址就是 `http://192.168.1.100:5173`。电脑和手机需要在同一局域网，电脑防火墙应允许该端口的入站访问。

`localhost` 指的是打开浏览器的那台设备；在手机上填写 `localhost` 无法访问电脑上的服务。

## 3. 部署到宝塔面板或其他静态网站服务

1. 新建一个静态网站，绑定你的域名。
2. 把部署包中 **`site/` 里面的内容**上传到网站根目录。
3. 确保根目录直接包含 `index.html`，以及同级的 `assets/`、`all_pic/`。
4. 默认首页设置为 `index.html`。
5. 将域名解析到服务器，按服务商或面板的说明配置 HTTPS。

此方式无需安装 Node.js、Python、Pillow 或数据库。请保留文件名和目录层级，尤其是带中文的原图文件名。

## 4. Ubuntu / Debian 服务器：使用 Nginx

以下命令在**目标服务器**上执行，不是在本项目中替你执行。

安装 Nginx：

```bash
sudo apt update
sudo apt install nginx
```

进入解压后的 `wedding-album` 文件夹，复制静态网站：

```bash
sudo mkdir -p /var/www/wedding-album
sudo cp -R site/. /var/www/wedding-album/
```

编辑包内的 `deploy/nginx.conf`，把其中的 `album.example.com` 改成你的实际域名；没有域名时，也可以先填写服务器的公网 IP。

安装并启用这个站点配置：

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/wedding-album.conf
sudo ln -s /etc/nginx/sites-available/wedding-album.conf /etc/nginx/sites-enabled/wedding-album.conf
sudo nginx -t
```

看到配置检查成功后，再执行：

```bash
sudo systemctl reload nginx
```

访问 `http://你的域名` 或 `http://服务器IP`。云服务器的安全组和系统防火墙需要允许 80 端口；配置 HTTPS 后还需要允许 443 端口。

如果看到 Nginx 默认欢迎页，请检查域名/IP 是否与 `server_name` 一致，以及当前请求是否进入了这个站点配置。

## 5. 直接从当前源码构建静态文件

不使用现成部署包时，在当前项目执行：

```bash
npm run build
```

把生成的 **`dist/` 里面的内容**上传到目标网站根目录即可。

`dist/` 与部署包里的 `site/` 都是可独立使用的静态网站目录。两种方式选一种即可。

## 6. 文件大小、收藏与后续更新

- 完整网站约 619 MiB，主要是 `all_pic/` 中约 602 MiB 的 60 张原图；浏览用的 WebP 预览图总计约 16 MiB。
- 相册默认使用压缩预览图，原图供「下载原图」使用。迁移时请一起保留 `all_pic/`，以便该按钮继续工作。
- 收藏记录保存在当前浏览器中，不会自动同步到其他电脑、浏览器或新的域名。
- 修改文字或样式后，重新打包/构建，再覆盖服务器上的对应文件。
- 新增照片时，需要在制作电脑上重新生成 `photos.js` 和预览图，具体步骤见当前源码项目的 `README.md`；部署服务器无需安装图片处理工具。
- 请柬海报的 `post/`、`output/wedding_invitations/`，以及原来的大压缩包 `总精修.zip` 不属于相册运行所需文件，不用迁移到网站。

## 7. 重新生成便携部署包

在当前源码项目执行：

```bash
python3 scripts/package_site.py
```

这里只使用 Python 标准库，不需要额外安装 Python 包。生成的 ZIP 可直接供第 2、3、4 节使用。
