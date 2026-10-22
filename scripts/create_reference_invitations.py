"""Finish the two supplied templates and package all six wedding invitations.

Run: PYTHONPATH=/tmp/pic-tools python3 scripts/create_reference_invitations.py
Requires Pillow. Uses the original photographs and supplied template artwork.
The four existing portrait invitations are copied without changing their originals.
"""

from __future__ import annotations

import argparse
from datetime import date
from functools import lru_cache
import json
import math
from pathlib import Path
import shutil
import zipfile

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

import create_invitations as portraits


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "wedding_posters"
PREVIEWS = OUT / "previews"
DETAILS = portraits.DETAILS
DPI = 300
LANDSCAPE_SIZE = (3840, 2160)
IDS = sorted(path.name.split("_")[0] for path in (ROOT / "post").glob("*.jpg"))
REF_COMIC = ROOT / "post_ref" / "微信图片_20260914205255_7087_3.png"
REF_ROSES = ROOT / "post_ref" / "微信图片_20260914205315_7088_3.jpg"


@lru_cache(maxsize=120)
def font(kind, size):
    path, index = portraits.FONT_PATHS[kind]
    return ImageFont.truetype(path, round(size), index=index)


def solve(matrix, values):
    """Solve the small linear system for an inverse perspective transform."""
    rows = [list(row) + [value] for row, value in zip(matrix, values)]
    n = len(rows)
    for col in range(n):
        pivot = max(range(col, n), key=lambda i: abs(rows[i][col]))
        rows[col], rows[pivot] = rows[pivot], rows[col]
        divisor = rows[col][col]
        if abs(divisor) < 1e-12:
            raise ValueError("Degenerate photo-frame geometry")
        rows[col] = [value / divisor for value in rows[col]]
        for i in range(n):
            if i == col:
                continue
            factor = rows[i][col]
            rows[i] = [a - factor * b for a, b in zip(rows[i], rows[col])]
    return [row[-1] for row in rows]


class Artboard:
    def __init__(self, reference, scale):
        self.scale = scale
        self.reference = Image.open(reference).convert("RGB")
        self.im = self.reference.resize(
            (self.reference.width * scale, self.reference.height * scale),
            Image.Resampling.LANCZOS,
        )
        self.original = self.im.copy()
        self.text_log = []

    def coords(self, coords):
        return tuple(round(value * self.scale) for value in coords)

    def text(self, value, x, y, size, kind="sans", fill="#a45d4a",
             align="center", max_width=None, stroke=0, stroke_fill=None):
        painter = ImageDraw.Draw(self.im)
        face = font(kind, size * self.scale)
        width = painter.textlength(value, font=face)
        if max_width is not None and width > max_width * self.scale:
            face = font(kind, size * self.scale * max_width * self.scale / width)
            width = painter.textlength(value, font=face)
        px = x * self.scale
        if align == "center":
            px -= width / 2
        elif align == "right":
            px -= width
        py = y * self.scale
        box = painter.textbbox((px, py), value, font=face, anchor="lt",
                               stroke_width=round(stroke * self.scale))
        if box[0] < 0 or box[1] < 0 or box[2] > self.im.width or box[3] > self.im.height:
            raise ValueError(f"Text outside the canvas: {value}: {box}")
        painter.text((px, py), value, font=face, fill=fill, anchor="lt",
                     stroke_width=round(stroke * self.scale), stroke_fill=stroke_fill)
        self.text_log.append({"text": value, "bounds": [round(v / self.scale, 2) for v in box]})

    def erase(self, rect, color="#fffefa", feather=3):
        """Blend a clean paper patch over template sample text."""
        mask = Image.new("L", self.im.size)
        ImageDraw.Draw(mask).rectangle(self.coords(rect), fill=255)
        if feather:
            mask = mask.filter(ImageFilter.GaussianBlur(feather * self.scale))
        self.im.paste(Image.new("RGB", self.im.size, color), (0, 0), mask)

    def line(self, xy, fill, width=1):
        ImageDraw.Draw(self.im).line(self.coords(xy), fill=fill, width=max(1, round(width * self.scale)))

    def polygon(self, points, fill, outline=None, width=1):
        painter = ImageDraw.Draw(self.im)
        points = [self.coords(point) for point in points]
        painter.polygon(points, fill=fill)
        if outline:
            painter.line(points + [points[0]], fill=outline,
                         width=round(width * self.scale), joint="curve")

    def ellipse(self, rect, fill, outline=None, width=1):
        ImageDraw.Draw(self.im).ellipse(self.coords(rect), fill=fill, outline=outline,
                                        width=round(width * self.scale))

    def photo(self, pid, rect, focus=(.5, .1), radius=16):
        x0, y0, x1, y1 = self.coords(rect)
        size = (x1 - x0, y1 - y0)
        pic = ImageOps.fit(portraits.source(pid), size, Image.Resampling.LANCZOS, centering=focus)
        mask = Image.new("L", size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1),
                                               radius=round(radius * self.scale), fill=255)
        self.im.paste(pic, (x0, y0), mask)

    def warp(self, texture, quad):
        """Place a sharp raster photograph into a tilted template opening."""
        target = [self.coords(point) for point in quad]
        x0 = min(x for x, _ in target)
        y0 = min(y for _, y in target)
        x1 = max(x for x, _ in target)
        y1 = max(y for _, y in target)
        local = [(x - x0, y - y0) for x, y in target]
        source = [(0, 0), (texture.width, 0), (texture.width, texture.height), (0, texture.height)]
        matrix, values = [], []
        for (x, y), (u, v) in zip(local, source):
            matrix.extend([
                [x, y, 1, 0, 0, 0, -u * x, -u * y],
                [0, 0, 0, x, y, 1, -v * x, -v * y],
            ])
            values.extend([u, v])
        warped = texture.transform((x1 - x0, y1 - y0), Image.Transform.PERSPECTIVE,
                                   solve(matrix, values), Image.Resampling.BICUBIC)
        mask = Image.new("L", warped.size)
        ImageDraw.Draw(mask).polygon(local, fill=255)
        self.im.paste(warped, (x0, y0), mask)

    def photo_quad(self, pid, quad, focus=(.5, .1)):
        width = (math.dist(quad[0], quad[1]) + math.dist(quad[3], quad[2])) / 2
        height = (math.dist(quad[0], quad[3]) + math.dist(quad[1], quad[2])) / 2
        texture = ImageOps.fit(portraits.source(pid), self.coords((width, height)),
                               Image.Resampling.LANCZOS, centering=focus)
        self.warp(texture, quad)

    def restore_decoration(self, rect):
        """Restore colored stickers and their ink, excluding gray photo placeholders."""
        rect = self.coords(rect)
        patch = self.original.crop(rect)
        r, g, b = patch.split()
        bright = ImageChops.lighter(ImageChops.lighter(r, g), b)
        dark = ImageChops.darker(ImageChops.darker(r, g), b)
        chroma = ImageChops.subtract(bright, dark)
        colored = chroma.point(lambda v: max(0, min(255, (v - 9) * 28)))
        ink = bright.point(lambda v: max(0, min(255, (185 - v) * 16)))
        mask = ImageChops.lighter(colored, ink)
        self.im.paste(patch, (rect[0], rect[1]), mask)

    def restore_white(self, rect, seed):
        """Restore the enclosed white paper inside a sticker or speech bubble."""
        patch = self.reference.crop(rect)
        r, g, b = patch.split()
        bright = ImageChops.lighter(ImageChops.lighter(r, g), b)
        dark = ImageChops.darker(ImageChops.darker(r, g), b)
        light = dark.point(lambda v: 255 if v > 218 else 0)
        neutral = ImageChops.subtract(bright, dark).point(lambda v: 255 if v < 40 else 0)
        component = ImageChops.multiply(light, neutral)
        local_seed = (seed[0] - rect[0], seed[1] - rect[1])
        if component.getpixel(local_seed) != 255:
            raise ValueError(f"White-sticker seed is not white: {seed}")
        ImageDraw.floodfill(component, local_seed, 127, thresh=0)
        component = component.point(lambda v: 255 if v == 127 else 0)
        scaled = self.coords(rect)
        original = self.original.crop(scaled)
        component = component.resize(original.size, Image.Resampling.LANCZOS)
        self.im.paste(original, (scaled[0], scaled[1]), component)

    def finish(self, crop=None):
        im = self.im.crop(self.coords(crop)) if crop else self.im
        return im.resize(LANDSCAPE_SIZE, Image.Resampling.LANCZOS)


def reference_comic():
    a = Artboard(REF_COMIC, 4)

    # The first large opening contains a pair of portraits, using all six originals.
    pair = Image.new("RGB", (1016, 676), "#fff8e8")
    for pid, x, focus in [("GK6A6065", 0, (.50, .00)), ("GK6A6083", 520, (.50, .00))]:
        pic = ImageOps.fit(portraits.source(pid), (496, 676), Image.Resampling.LANCZOS, centering=focus)
        pair.paste(pic, (x, 0))
    a.warp(pair, [(48, 207), (299, 185), (318, 348), (65, 370)])
    a.photo_quad("GK6A5966", [(346, 161), (561, 151), (566, 327), (356, 339)], (.50, .14))
    a.photo_quad("GK6A5753", [(610, 34), (856, 34), (856, 141), (610, 141)], (.50, .12))
    a.photo_quad("GK6A5899", [(604, 166), (855, 166), (855, 276), (604, 276)], (.50, .23))
    a.photo_quad("GK6A5963", [(614, 302), (866, 302), (866, 404), (614, 404)], (.50, .12))

    for rect in [
        (50, 169, 114, 224), (34, 323, 111, 393), (267, 333, 307, 373),
        (530, 127, 567, 166), (521, 259, 589, 346), (812, 15, 912, 101),
        (565, 85, 631, 151), (843, 170, 912, 239), (582, 317, 640, 402),
        (813, 364, 890, 418), (840, 330, 925, 425),
    ]:
        a.restore_decoration(rect)
    for rect, seed in [
        ((812, 16, 916, 107), (879, 80)),
        ((843, 170, 912, 239), (881, 224)),
        ((582, 317, 640, 402), (607, 328)),
        ((582, 317, 640, 402), (622, 349)),
        ((582, 317, 640, 402), (612, 363)),
    ]:
        a.restore_white(rect, seed)

    # A fresh ribbon carries both names at print resolution.
    ribbon = Image.new("RGB", (788, 108), "#df7d99")
    painter = ImageDraw.Draw(ribbon)
    painter.rectangle((2, 2, 785, 105), outline="#9d4e62", width=5)
    names = f'{DETAILS["groom"]}  &  {DETAILS["bride"]}'
    painter.text((394, 54), names, font=font("bold", 63), fill="#fffdf5", anchor="mm")
    a.warp(ribbon, [(152, 175), (347, 156), (349, 183), (153, 199)])
    a.text_log.append({"text": names, "bounds": [152, 156, 349, 199]})

    # Cover the original small captions with clean, crisp Chinese speech bubbles.
    burst = []
    for i in range(36):
        t = i * math.tau / 36
        radius = 1 if i % 2 == 0 else .87
        burst.append((376 + 58 * radius * math.cos(t), 353 + 44 * radius * math.sin(t)))
    a.polygon(burst, "#fffdf4", "#765239", 1.5)
    a.text("WE DO!", 376, 332, 13, "latin_bold", "#563b2d")
    a.text("我们结婚啦", 376, 355, 15, "bold", "#d66483", max_width=93)

    a.polygon([(535, 374), (565, 395), (550, 368)], "#f8d56d", "#765239", 1.5)
    a.ellipse((438, 325, 566, 392), "#f8d56d", "#765239", 1.5)
    a.text("余生", 502, 337, 17, "bold", "#68472e")
    a.text("请多指教", 502, 362, 17, "bold", "#ce627f")

    a.erase((77, 427, 424, 489), "#fffefa", feather=1.3)
    a.erase((535, 438, 862, 493), "#fffefa", feather=1.5)
    a.text("2026年11月14日", 249, 438, 36, "bold", "#c94c6d", max_width=326,
           stroke=1.2, stroke_fill="#fffefa")
    a.text("星期六 · SATURDAY", 249, 479, 10, "sans", "#a27154")
    a.text(DETAILS["venue"], 700, 447, 31, "bold", "#c94c6d", max_width=302,
           stroke=1.2, stroke_fill="#fffefa")
    return a.finish((6, 6, 924, 520)), a.text_log


def reference_roses():
    a = Artboard(REF_ROSES, 3)
    slots = [
        ("GK6A5963", (673, 80, 930, 257), (.50, .08)),
        ("GK6A5966", (950, 80, 1191, 257), (.50, .14)),
        ("GK6A5753", (673, 282, 955, 474), (.50, .08)),
        ("GK6A5899", (976, 282, 1264, 474), (.50, .14)),
        ("GK6A6083", (673, 499, 930, 667), (.50, .00)),
        ("GK6A6065", (950, 499, 1251, 667), (.50, .10)),
    ]
    for pid, rect, focus in slots:
        a.photo(pid, rect, focus, radius=18)

    a.erase((148, 319, 580, 376), "#fffdf6", feather=4)
    a.text("新 郎", 279, 324, 11, "sans", "#bf8c79")
    a.text("新 娘", 479, 324, 11, "sans", "#bf8c79")
    a.text(DETAILS["groom"], 279, 344, 31, "serif_bold", "#a55743")
    a.text("&", 378, 344, 29, "italic", "#c08468")
    a.text(DETAILS["bride"], 479, 344, 31, "serif_bold", "#a55743")

    # The brief contains a date but no start time; the sample clocks and blanks go.
    a.erase((192, 430, 584, 657), "#fffdf6", feather=4)
    a.text("婚 礼 日 期  /  DATE", 267, 442, 13, "sans", "#c28b77", align="left")
    a.text("2026年11月14日", 267, 469, 28, "serif", "#a55743", align="left", max_width=302)
    a.text("星期六 · SATURDAY", 267, 510, 12, "sans", "#c28b77", align="left")
    a.line((267, 536, 565, 536), "#efd4c5", .7)
    a.text("婚 礼 地 点  /  VENUE", 267, 553, 13, "sans", "#c28b77", align="left")
    a.text(DETAILS["venue"], 267, 580, 26, "serif", "#a55743", align="left", max_width=308)
    a.text(DETAILS["invitation"], 384, 632, 18, "serif", "#b47d69")
    return a.finish(), a.text_log


NEW_STYLES = [
    ("05_reference_comic", "模板一 · 粉黄漫画拼贴", reference_comic, REF_COMIC),
    ("06_reference_roses", "模板二 · 粉色玫瑰请柬", reference_roses, REF_ROSES),
]


def save(im, filename, label):
    im.save(OUT / f"{filename}.png", dpi=(DPI, DPI), icc_profile=portraits.SRGB_PROFILE, optimize=True)
    im.save(OUT / f"{filename}.pdf", "PDF", resolution=DPI, quality=97, subsampling=0,
            title=f'{DETAILS["groom"]}与{DETAILS["bride"]}的婚礼请柬 · {label}',
            author=f'{DETAILS["groom"]} & {DETAILS["bride"]}')
    ImageOps.contain(im, (1600, 1000), Image.Resampling.LANCZOS).save(
        PREVIEWS / f"{filename}.jpg", quality=95, subsampling=0)


def overview(styles):
    sheet = Image.new("RGB", (2160, 1830), "#eeebe4")
    painter = ImageDraw.Draw(sheet)
    painter.text((1080, 47), f'{DETAILS["groom"]} & {DETAILS["bride"]} · 婚礼请柬',
                 font=font("serif", 42), fill="#514839", anchor="mt")
    painter.text((1080, 114), "2026年11月14日  ·  星期六  ·  拉弗尔艺术宴会中心",
                 font=font("sans", 22), fill="#8d7965", anchor="mt")
    for i, style in enumerate(styles[:4]):
        x, y = 73 + i * 523, 197
        im = Image.open(OUT / f'{style["file"]}.png').convert("RGB")
        thumb = ImageOps.contain(im, (448, 634), Image.Resampling.LANCZOS)
        painter.rectangle((x + 7, y + 9, x + 455, y + 643), fill="#d1cabf")
        sheet.paste(thumb, (x, y))
        painter.text((x + 224, 866), style["label"], font=font("serif", 29), fill="#65513e", anchor="mt")
    painter.text((1080, 965), "参 考 模 板 · 六 张 照 片 拼 贴", font=font("sans", 23),
                 fill="#8d7965", anchor="mt")
    for i, style in enumerate(styles[4:]):
        x, y = 63 + i * 1050, 1036
        im = Image.open(OUT / f'{style["file"]}.png').convert("RGB")
        thumb = ImageOps.contain(im, (996, 561), Image.Resampling.LANCZOS)
        painter.rectangle((x + 7, y + 9, x + 1003, y + 570), fill="#d1cabf")
        sheet.paste(thumb, (x, y))
        painter.text((x + 498, 1640), style["label"], font=font("serif", 31), fill="#65513e", anchor="mt")
    painter.text((1080, 1730), "每款均提供 PNG 与 PDF · 竖版 A4 / 横版 16:9 · 300 dpi",
                 font=font("sans", 23), fill="#8d7965", anchor="mt")
    sheet.save(OUT / "00_all_styles_preview.png", optimize=True)


def package(styles):
    images = []
    for style in styles:
        with Image.open(OUT / f'{style["file"]}.png') as im:
            images.append(im.convert("RGB"))
    images[0].save(OUT / "all_six_invitations.pdf", "PDF", save_all=True,
                   append_images=images[1:], resolution=DPI, quality=97, subsampling=0,
                   title="阿澈 & 小满 · 六款婚礼请柬", author="阿澈 & 小满")
    # Pillow propagates encoder options to appended images. Fresh copies prevent
    # the six-page append list from leaking into the two-page collection.
    reference_pages = [im.copy() for im in images[4:]]
    reference_pages[0].save(OUT / "two_reference_invitations.pdf", "PDF", save_all=True,
                   append_images=reference_pages[1:], resolution=DPI, quality=97, subsampling=0,
                   title="阿澈 & 小满 · 两款参考模板请柬", author="阿澈 & 小满")
    overview(styles)
    notes = """阿澈 & 小满 · 六款婚礼请柬

新郎：阿澈
新娘：小满
日期：2026年11月14日（星期六）
地点：拉弗尔艺术宴会中心

01 韩系 · 奶油留白
02 漫画 · 心动连载
03 清新 · 花园誓言
04 复古 · 爱的刊物
05 模板一 · 粉黄漫画拼贴（使用全部六张照片）
06 模板二 · 粉色玫瑰请柬（使用全部六张照片）

每款都有单独的 PNG 和 PDF。
00_all_styles_preview.png：六款总览。
all_six_invitations.pdf：六页完整合集，保留每款的原始方向。
two_reference_invitations.pdf：两款横版参考模板合集。
previews/：适合快速查看和发送的 JPG 缩略图。

01—04：2480 × 3508 px，300 dpi，约 A4 竖版。
05—06：3840 × 2160 px，300 dpi，16:9 横版。
横版 PDF 的页面约 32.51 × 18.29 cm；使用 A4 纸打印时选“适合页面”。
PNG 嵌入 sRGB 色彩配置。PDF 为图片式 PDF，中文字体不会因设备缺字而丢失。
参考图中的花卉与贴纸来自用户提供的位图模板；原始装饰分辨率有限，不建议巨幅放大。

post/ 中的六张照片全部使用，原始照片和参考模板均未改动。
01—04 为已存在的四款成品；05—06 为本次按 post_ref/ 新制作的横版。
02 采用原照的本地漫画化处理与分镜排版；05 采用原照与漫画贴纸拼贴。
未使用 AI 重绘、内置 image_gen 或图像 CLI/API。
未添加未提供的开席时刻；模板中的示例日期和占位文字已替换。

重新制作：
PYTHONPATH=/tmp/pic-tools python3 scripts/create_reference_invitations.py
需要 Pillow；已有 Pillow 的环境无需设置 PYTHONPATH。
"""
    (OUT / "使用说明.txt").write_text(notes, encoding="utf-8")
    manifest = {
        "details": DETAILS, "dpi": DPI, "styles": styles,
        "photo_files": [str(p.relative_to(ROOT)) for p in sorted((ROOT / "post").glob("*.jpg"))],
        "photo_coverage": {pid: [s["file"] for s in styles if pid in s["sources"]] for pid in IDS},
        "mode": "local-photo-and-user-template-compositing",
    }
    (OUT / "design_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    with zipfile.ZipFile(OUT / "wedding_posters_all.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in sorted(OUT.rglob("*")):
            if path.is_file() and path.suffix in {".png", ".pdf", ".txt", ".json", ".jpg"}:
                bundle.write(path, path.relative_to(OUT))
    print(f"Packaged six invitations in {OUT}", flush=True)


def main(render_only=False):
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(exist_ok=True)
    styles = []
    for filename, label, renderer, sources in portraits.STYLES:
        for suffix in (".png", ".pdf"):
            source_path = portraits.OUT / f"{filename}{suffix}"
            if not source_path.exists():
                raise FileNotFoundError(f"Existing portrait invitation is missing: {source_path}")
            if not render_only:
                shutil.copy2(source_path, OUT / source_path.name)
        old_preview = portraits.PREVIEWS / f"{filename}.jpg"
        if not render_only and old_preview.exists():
            shutil.copy2(old_preview, PREVIEWS / old_preview.name)
        styles.append({"file": filename, "label": label, "sources": sources,
                       "size": list(portraits.SIZE), "origin": "existing-portrait"})
    for filename, label, renderer, reference in NEW_STYLES:
        im, text_log = renderer()
        save(im, filename, label)
        styles.append({"file": filename, "label": label, "sources": IDS,
                       "size": list(LANDSCAPE_SIZE), "reference": str(reference.relative_to(ROOT)),
                       "rendered_text": text_log, "origin": "new-reference-template"})
        print(f"Rendered {filename}: {im.width} × {im.height} px", flush=True)
    if not render_only:
        package(styles)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-only", action="store_true", help="Render the two templates without packaging")
    main(parser.parse_args().render_only)
