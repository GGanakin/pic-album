"""Create an independent, portable album ZIP using only Python's standard library."""

from pathlib import Path
import json
import zipfile


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "deployment"
OUT.mkdir(parents=True, exist_ok=True)
DESTINATION = OUT / "wedding-album-portable.zip"
PREFIX = "wedding-album"
SITE_FILES = [ROOT / name for name in ("index.html", "styles.css", "app.js", "photos.js")]
for directory in ("assets", "all_pic"):
    SITE_FILES.extend(sorted(path for path in (ROOT / directory).rglob("*") if path.is_file()))

manifest_source = (ROOT / "photos.js").read_text(encoding="utf-8")
album = json.loads(manifest_source.split("window.WEDDING_ALBUM = ", 1)[1].strip().removesuffix(";"))
site_paths = {path.relative_to(ROOT).as_posix() for path in SITE_FILES}
for photo in album["photos"]:
    for key in ("thumb", "src", "original"):
        if photo[key] not in site_paths:
            raise FileNotFoundError(f"Missing {key} for {photo['id']}: {photo[key]}")

portable_package = {
    "name": "our-little-forever-portable",
    "version": "1.0.0",
    "private": True,
    "description": "予你余生 · 独立婚纱相册部署包",
    "type": "module",
    "scripts": {
        "start": "node scripts/serve.mjs --dir site",
        "dev": "node scripts/serve.mjs --dir site",
    },
    "engines": {"node": ">=18"},
}

quick_start = """# 予你余生 · 便携婚纱相册

## 在电脑上打开

安装 Node.js 当前 LTS 版本，在本文件所在的 wedding-album 文件夹打开终端，运行：

```bash
npm start
```

打开 http://localhost:5173 。无需 npm install。换端口：npm start -- --port 8080 。

也可直接在浏览器中打开 site/index.html 离线查看。

## 上传到服务器

使用宝塔面板、Nginx 或其他静态网站服务时，把 **site/ 里面的内容**上传到网站根目录。
确保 index.html、assets/、all_pic/ 同级。服务器无需安装 Node.js 或数据库。

Nginx 配置模板在 deploy/nginx.conf，完整步骤见 DEPLOYMENT.md 第 2、3、4 节。

## 文件说明

- site/：完整网站，包括 60 张照片的缩略图、高清预览和原图。
- scripts/serve.mjs、package.json：跨平台 Node 本地服务。
- deploy/nginx.conf：Nginx 配置模板。
- DEPLOYMENT.md：电脑、局域网和服务器部署说明。

收藏保存在当前浏览器中，不会跨设备或域名自动同步。
"""

print(f"Packaging {len(album['photos'])} photos and {len(SITE_FILES)} static files...", flush=True)
with zipfile.ZipFile(DESTINATION, "w", allowZip64=True) as bundle:
    for path in SITE_FILES:
        relative = path.relative_to(ROOT).as_posix()
        # JPEG and WebP are already compressed. Store them directly for fast packaging.
        compressed = path.suffix.lower() not in {".jpg", ".jpeg", ".webp", ".png", ".mp3"}
        bundle.write(path, f"{PREFIX}/site/{relative}", compress_type=zipfile.ZIP_DEFLATED if compressed else zipfile.ZIP_STORED)
    bundle.write(ROOT / "scripts" / "serve.mjs", f"{PREFIX}/scripts/serve.mjs", compress_type=zipfile.ZIP_DEFLATED)
    bundle.write(ROOT / "deploy" / "nginx.conf", f"{PREFIX}/deploy/nginx.conf", compress_type=zipfile.ZIP_DEFLATED)
    bundle.write(ROOT / "DEPLOYMENT.md", f"{PREFIX}/DEPLOYMENT.md", compress_type=zipfile.ZIP_DEFLATED)
    bundle.writestr(f"{PREFIX}/package.json", json.dumps(portable_package, ensure_ascii=False, indent=2) + "\n", compress_type=zipfile.ZIP_DEFLATED)
    bundle.writestr(f"{PREFIX}/README.md", quick_start, compress_type=zipfile.ZIP_DEFLATED)

with zipfile.ZipFile(DESTINATION) as bundle:
    failure = bundle.testzip()
    if failure:
        raise ValueError(f"ZIP integrity check failed: {failure}")
    packaged = set(bundle.namelist())
    for relative in site_paths:
        assert f"{PREFIX}/site/{relative}" in packaged

print(f"Created and verified: {DESTINATION}", flush=True)
print(f"Size: {DESTINATION.stat().st_size / 1024**2:.1f} MiB", flush=True)
print("Portable startup: unzip, open wedding-album, run npm start.", flush=True)
