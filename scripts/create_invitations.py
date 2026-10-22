"""Render four photo-based wedding invitations as print-resolution PNG and PDF.

Uses only the original photographs in post/. No image API or uploads are involved.
Run: python3 scripts/create_invitations.py  (requires Pillow)
"""

from datetime import date
from functools import lru_cache
from io import BytesIO
from pathlib import Path
import argparse
import json
import math
import random
import zipfile

from PIL import Image, ImageChops, ImageCms, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "wedding_invitations"
OUT.mkdir(parents=True, exist_ok=True)
PREVIEWS = OUT / "previews"
PREVIEWS.mkdir(exist_ok=True)
DETAILS = json.loads((ROOT / "invitation_details.json").read_text(encoding="utf-8"))
S = 2
W, H = 1240, 1754
SIZE = (W * S, H * S)
DPI = 300
DATE = date.fromisoformat(DETAILS["date"])
WEEKDAY = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"][DATE.weekday()]
DATE_DOTS = DATE.strftime("%Y . %m . %d")
DATE_CN = f"{DATE.year} 年 {DATE.month} 月 {DATE.day} 日"
DATE_EN = DATE.strftime("%B %d, %Y").upper()
SRGB_PROFILE = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()

FONT_PATHS = {
    "serif": ("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc", 2),
    "serif_bold": ("/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc", 2),
    "sans": ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 2),
    "bold": ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 2),
    "roman": ("/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf", 0),
    "italic": ("/usr/share/fonts/truetype/liberation2/LiberationSerif-Italic.ttf", 0),
    "roman_bold": ("/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf", 0),
    "latin": ("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", 0),
    "latin_bold": ("/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf", 0),
    "mono": ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 0),
}


def box(values):
    return tuple(round(value * S) for value in values)


@lru_cache(maxsize=128)
def font(kind, size):
    path, index = FONT_PATHS[kind]
    return ImageFont.truetype(path, round(size * S), index=index)


@lru_cache(maxsize=8)
def source(photo_id):
    paths = list((ROOT / "post").glob(f"{photo_id}_*.jpg"))
    if len(paths) != 1:
        raise ValueError(f"Expected exactly one source for {photo_id}, found {len(paths)}")
    with Image.open(paths[0]) as original:
        im = ImageOps.exif_transpose(original)
        profile = im.info.get("icc_profile")
        if profile:
            im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(BytesIO(profile)), ImageCms.createProfile("sRGB"), outputMode="RGB")
        else:
            im = im.convert("RGB")
        im.thumbnail((3200, 4200), Image.Resampling.LANCZOS)
        return im.copy()


class Canvas:
    def __init__(self, color):
        base = Image.new("RGB", SIZE, color)
        noise = Image.effect_noise(SIZE, 1.0).convert("RGB")
        self.im = ImageChops.add(base, noise, offset=-128).convert("RGBA")
        self.draw = ImageDraw.Draw(self.im)

    def refresh(self):
        self.draw = ImageDraw.Draw(self.im)

    def text(self, value, x, y, size, kind="sans", fill="#333333", align="center", tracking=0, max_width=None, stroke=0, stroke_fill=None):
        face = font(kind, size)
        natural_width = self.draw.textlength(value, font=face)
        if tracking:
            natural_width = sum(self.draw.textlength(char, font=face) for char in value) + max(0, len(value) - 1) * tracking * S
        if max_width and natural_width > max_width * S:
            size *= max_width * S / natural_width
            face = font(kind, size)
            natural_width = self.draw.textlength(value, font=face) if not tracking else sum(self.draw.textlength(char, font=face) for char in value) + (len(value) - 1) * tracking * S
        left = x * S - (natural_width / 2 if align == "center" else natural_width if align == "right" else 0)
        if tracking:
            for char in value:
                self.draw.text((round(left), round(y * S)), char, font=face, fill=fill, anchor="lt", stroke_width=round(stroke * S), stroke_fill=stroke_fill)
                left += self.draw.textlength(char, font=face) + tracking * S
        else:
            self.draw.text((round(left), round(y * S)), value, font=face, fill=fill, anchor="lt", stroke_width=round(stroke * S), stroke_fill=stroke_fill)

    def line(self, coords, fill, width=1):
        self.draw.line(box(coords), fill=fill, width=max(1, round(width * S)))

    def rectangle(self, coords, fill=None, outline=None, width=1, radius=0):
        if radius:
            self.draw.rounded_rectangle(box(coords), radius=round(radius * S), fill=fill, outline=outline, width=max(1, round(width * S)))
        else:
            self.draw.rectangle(box(coords), fill=fill, outline=outline, width=max(1, round(width * S)))

    def polygon(self, points, fill, outline=None, width=1):
        scaled = [box(point) for point in points]
        self.draw.polygon(scaled, fill=fill)
        if outline:
            self.draw.line(scaled + [scaled[0]], fill=outline, width=max(1, round(width * S)), joint="curve")

    def ellipse(self, coords, fill=None, outline=None, width=1):
        self.draw.ellipse(box(coords), fill=fill, outline=outline, width=max(1, round(width * S)))

    def image(self, im, bounds, focus=(.5, .5), mask=None):
        x, y, width, height = bounds
        fitted = ImageOps.fit(im, (round(width * S), round(height * S)), Image.Resampling.LANCZOS, centering=focus)
        if mask is None:
            self.im.paste(fitted, (round(x * S), round(y * S)))
        else:
            self.im.paste(fitted, (round(x * S), round(y * S)), mask)
        self.refresh()

    def vertical(self, value, x, y, size, kind="latin", fill="#756c61", tracking=2, angle=90):
        temp = Image.new("RGBA", (1400 * S, 70 * S))
        painter = ImageDraw.Draw(temp)
        face = font(kind, size)
        cursor = 0
        for char in value:
            painter.text((cursor, 10 * S), char, font=face, fill=fill, anchor="lt")
            cursor += painter.textlength(char, font=face) + tracking * S
        temp = temp.crop((0, 0, round(cursor + S), round((size + 24) * S)))
        temp = temp.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
        self.im.alpha_composite(temp, (round(x * S - temp.width / 2), round(y * S - temp.height / 2)))
        self.refresh()

    def heart(self, x, y, size, fill, outline=None, width=1, angle=0):
        points = []
        theta = math.radians(angle)
        for i in range(181):
            t = i / 180 * math.tau
            px = 16 * math.sin(t) ** 3 / 32 * size
            py = -(13 * math.cos(t) - 5 * math.cos(2*t) - 2 * math.cos(3*t) - math.cos(4*t)) / 32 * size
            points.append((x + px * math.cos(theta) - py * math.sin(theta), y + px * math.sin(theta) + py * math.cos(theta)))
        self.polygon(points, fill, outline, width)

    def sparkle(self, x, y, size, fill, outline=None):
        self.polygon([(x, y-size), (x+size*.24, y-size*.24), (x+size, y), (x+size*.24, y+size*.24), (x, y+size), (x-size*.24, y+size*.24), (x-size, y), (x-size*.24, y-size*.24)], fill, outline)


def soft_photo(photo_id):
    im = source(photo_id).copy()
    im = ImageEnhance.Color(im).enhance(.85)
    im = ImageEnhance.Contrast(im).enhance(.98)
    return Image.blend(im, Image.new("RGB", im.size, "#f7eadb"), .015)


def comic_photo(photo_id):
    """A raster ink-and-flat-color treatment; preserves the actual people and pose."""
    im = source(photo_id).copy()
    im.thumbnail((1600, 2100), Image.Resampling.LANCZOS)
    smooth = im.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.SMOOTH_MORE)
    smooth = ImageEnhance.Color(smooth).enhance(1.10)
    smooth = ImageEnhance.Contrast(smooth).enhance(1.04)
    # Per-channel steps retain facial colors that a single global palette can discard.
    flat = ImageOps.posterize(smooth, bits=5)
    flat = Image.blend(flat, smooth, .22)
    ink_mask = smooth.convert("L").filter(ImageFilter.FIND_EDGES).point(lambda value: max(0, min(170, (value-30)*4)))
    ink_mask = ink_mask.filter(ImageFilter.GaussianBlur(.35))
    ink = Image.new("RGB", im.size, "#302b34")
    art = Image.composite(ink, flat, ink_mask)
    # Remove the synthetic edge filter's outline at the canvas boundary.
    return art.crop((3, 3, art.width-3, art.height-3))


def korean():
    c = Canvas("#f6f3ed")
    ink, muted = "#4a473f", "#8b8070"
    c.text("WE ARE GETTING MARRIED", W/2, 74, 15, "latin", muted, tracking=4.2)
    c.text(f'{DETAILS["groom_english"]} & {DETAILS["bride_english"]}', W/2, 143, 99, "italic", ink, max_width=1050)
    c.text("我 们 结 婚 啦", W/2, 262, 21, "serif", muted, tracking=2.5)
    c.line((566, 307, 603, 307), "#c4b9a8", .8)
    c.ellipse((617, 304, 623, 310), fill="#bca48d")
    c.line((637, 307, 674, 307), "#c4b9a8", .8)
    c.rectangle((204, 345, 1036, 1399), outline="#d9d0c2", width=.7)
    c.image(soft_photo("GK6A5963"), (210, 351, 820, 1042), focus=(.5, .30))
    c.vertical("A LITTLE MOMENT, A LIFETIME OF LOVE", 161, 880, 11, fill="#a59a89", tracking=2.1)
    c.vertical("TWO HEARTS / ONE FOREVER", 1080, 880, 11, fill="#a59a89", tracking=2.7, angle=-90)
    c.text("新郎", 485, 1440, 12, "sans", muted, tracking=3)
    c.text("新娘", 755, 1440, 12, "sans", muted, tracking=3)
    c.text(DETAILS["groom"], 485, 1470, 36, "serif", ink, tracking=3)
    c.text("&", W/2, 1475, 29, "italic", "#b8a38d")
    c.text(DETAILS["bride"], 755, 1470, 36, "serif", ink, tracking=3)
    c.text(DATE_DOTS, W/2, 1546, 42, "roman", ink, tracking=2.2)
    c.line((422, 1620, 818, 1620), "#d7cebf", .8)
    c.text(DETAILS["venue"], W/2, 1644, 23, "sans", "#655e53", tracking=1.3)
    c.text(f'{WEEKDAY} · {DETAILS["invitation"]}', W/2, 1703, 14, "sans", muted, tracking=1)
    return c.im.convert("RGB")


def comic():
    c = Canvas("#fff3d5")
    ink, red, blue, mint = "#303039", "#ba4b4a", "#607e96", "#b9c9ba"
    c.rectangle((38, 39, 1202, 1715), outline=ink, width=3, radius=18)
    # Printed halftone corners, drawn around the content instead of across faces.
    for y in range(57, 340, 17):
        for x in range(65, 1190, 17):
            if x < 152 or x > 1100:
                c.ellipse((x-1.2, y-1.2, x+1.2, y+1.2), fill="#d4c2a0")
    c.text("THE LOVE STORY OF US", W/2, 83, 17, "mono", ink, tracking=3.7)
    c.text("我们结婚啦！", W/2, 145, 97, "bold", red, max_width=1020, stroke=1.5, stroke_fill=ink)
    c.text("第 01 话 · 把余生画进同一格", W/2, 278, 20, "sans", ink, tracking=1.5)
    c.sparkle(176, 246, 24, "#e8b95b", ink)
    c.heart(1095, 141, 58, "#d78679", ink, 2, 15)
    c.line((1101, 204, 1120, 226), ink, 2)
    c.line((1130, 184, 1150, 190), ink, 2)

    panels = [
        ("GK6A5966", (81, 361, 655, 988), (.5, .5)),
        ("GK6A6065", (770, 361, 389, 471), (.50, .0)),
        ("GK6A5899", (770, 868, 389, 481), (.50, .22)),
    ]
    for photo_id, (x,y,w,h), focus in panels:
        c.rectangle((x+7, y+8, x+w+7, y+h+8), fill=ink)
        c.rectangle((x-3, y-3, x+w+3, y+h+3), fill="#fffaf0", outline=ink, width=3)
        c.image(comic_photo(photo_id), (x+4, y+4, w-8, h-8), focus=focus)
    # The caption bubbles are intentionally confined to background / clothing.
    c.ellipse((113, 391, 587, 510), fill="#fffef7", outline=ink, width=2.3)
    c.polygon([(364, 499), (386, 547), (414, 501)], "#fffef7", ink, 2.3)
    c.line((369, 500, 408, 502), "#fffef7", 4)
    c.text("余生，请多指教！", 351, 432, 31, "bold", ink)
    c.rectangle((783, 779, 1146, 820), fill=mint, outline=ink, width=1.5)
    c.text("男主角，心动上线", 964, 790, 19, "bold", ink)
    c.rectangle((783, 1296, 1146, 1337), fill="#f4cf77", outline=ink, width=1.5)
    c.text("这一站，是我们", 964, 1306, 20, "bold", ink)
    c.polygon([(135,1170),(167,1154),(173,1127),(203,1144),(237,1127),(245,1152),(279,1157),(263,1184),(280,1216),(242,1215),(215,1241),(198,1216),(164,1225),(159,1200),(131,1194)], "#f4c85f", ink, 2)
    c.text("YES!", 205, 1170, 34, "latin_bold", ink)
    c.heart(659, 1280, 67, red, ink, 2, -13)
    c.text(DETAILS["groom"], 470, 1410, 44, "bold", ink, tracking=2)
    c.text("×", 620, 1414, 41, "roman", red)
    c.text(DETAILS["bride"], 770, 1410, 44, "bold", ink, tracking=2)
    c.text(DATE_DOTS, W/2, 1493, 57, "roman_bold", ink, tracking=1.5)
    c.text(f'{WEEKDAY} · {DETAILS["venue"]}', W/2, 1579, 24, "sans", ink, tracking=.4)
    c.line((240, 1638, 1000, 1638), "#c3ab83", 1)
    c.text("诚邀你，成为我们这一话的见证人", W/2, 1660, 19, "serif", "#745f47", tracking=1)
    return c.im.convert("RGB")


def bezier(c, points, fill, width=1):
    a,b,d,e = points
    line = []
    for i in range(61):
        t = i/60
        line.append(((1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*d[0]+t**3*e[0], (1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*d[1]+t**3*e[1]))
    c.draw.line([box(p) for p in line], fill=fill, width=max(1, round(width*S)), joint="curve")


def leaf(c, x, y, length, width, angle, color, vein="#8d9c75"):
    theta = math.radians(angle)
    points = []
    for side in [1, -1]:
        values = range(31) if side == 1 else range(30, -1, -1)
        for i in values:
            t = i/30
            px = t * length
            py = side * math.sin(t * math.pi) * width/2
            points.append((x+px*math.cos(theta)-py*math.sin(theta), y+px*math.sin(theta)+py*math.cos(theta)))
    c.polygon(points, color)
    c.line((x, y, x+length*math.cos(theta), y+length*math.sin(theta)), vein, .7)


def blossom(c, x, y, radius, color="#ead0cf", angle=0):
    rng = random.Random(round(x+y))
    for petal in range(5):
        a = math.radians(angle) + petal*math.tau/5
        points = []
        for i in range(61):
            t = i/60 * math.tau
            px = radius*.38 + math.cos(t)*radius*.58
            py = math.sin(t)*radius*.35
            points.append((x+px*math.cos(a)-py*math.sin(a), y+px*math.sin(a)+py*math.cos(a)))
        c.polygon(points, color, "#cfb7af", .55)
        c.line((x+radius*.17*math.cos(a), y+radius*.17*math.sin(a), x+radius*.57*math.cos(a), y+radius*.57*math.sin(a)), "#d3bcb3", .5)
    c.ellipse((x-radius*.16,y-radius*.16,x+radius*.16,y+radius*.16), fill="#cab477")
    for i in range(10):
        a = rng.random()*math.tau
        d = rng.random()*radius*.12
        c.ellipse((x+math.cos(a)*d-1,y+math.sin(a)*d-1,x+math.cos(a)*d+1,y+math.sin(a)*d+1), fill="#8d824f")


def arch_mask(width, height):
    mask = Image.new("L", (round(width*S), round(height*S)))
    d = ImageDraw.Draw(mask)
    d.ellipse((0, 0, width*S-1, width*S-1), fill=255)
    d.rectangle((0, width*S/2, width*S, height*S), fill=255)
    return mask


def fresh():
    c = Canvas("#f2f4e9")
    olive, muted = "#4e6249", "#7b8a6b"
    c.rectangle((47, 47, 1193, 1707), outline="#c5ceb7", width=1)
    c.rectangle((60, 60, 1180, 1694), outline="#dbe0cb", width=.6)
    c.text("LOVE IN BLOOM", W/2, 97, 16, "latin", olive, tracking=5)
    c.text("有你，岁岁皆春", W/2, 173, 79, "serif", olive, tracking=2, max_width=980)
    c.text("我们要结婚啦，邀你一起分享这份欢喜。", W/2, 300, 20, "serif", muted, tracking=1)

    outer_mask = arch_mask(872, 982)
    outer = Image.new("RGB", outer_mask.size, "#a9b796")
    c.im.paste(outer, (184*S, 376*S), outer_mask)
    paper_mask = arch_mask(860, 971)
    c.im.paste(Image.new("RGB", paper_mask.size, "#f4f4e9"), (190*S, 382*S), paper_mask)
    c.image(source("GK6A5753"), (204,396,832,948), focus=(.48,.38), mask=arch_mask(832,948))
    c.line((192, 1358, 1048, 1358), "#bdc7a9", 1)
    # Botanical stems remain outside the portrait and away from the couple's faces.
    bezier(c, [(118,1397),(57,1108),(137,794),(181,604)], "#83936e", 2)
    for i in range(9):
        y = 1318-i*71
        x = 100 + math.sin(i*.5)*22
        leaf(c,x,y,67+(i%3)*10,20,-144+(i%2)*10,"#cad4b6")
        leaf(c,x+1,y-24,62,18,-41+(i%3)*8,"#b9c8a3")
    bezier(c, [(1116,1256),(1204,974),(1110,697),(1091,557)], "#98a781", 1.8)
    for i in range(8):
        y = 1202-i*72
        x = 1136+math.sin(i*.6)*17
        leaf(c,x,y,56+(i%2)*13,18,-33,"#c9d2b6")
        leaf(c,x,y-31,60,19,-140,"#bfcba9")
    blossom(c,177,548,56,"#e9d7d0",-14)
    blossom(c,113,661,27,"#f0e8d3",7)
    blossom(c,1100,1173,66,"#e5c7c4",25)
    blossom(c,1129,1279,30,"#eee4cf",9)
    blossom(c,160,1394,25,"#ead3cd",4)
    c.sparkle(184,262,13,"#bdc2a0")
    c.sparkle(1060,264,11,"#bdc2a0")
    c.text("新郎", 471, 1405, 13, "sans", muted, tracking=2)
    c.text("新娘", 769, 1405, 13, "sans", muted, tracking=2)
    c.text(DETAILS["groom"], 471, 1440, 42, "serif", olive, tracking=3)
    c.heart(W/2,1464,24,"#ba8d7d")
    c.text(DETAILS["bride"], 769, 1440, 42, "serif", olive, tracking=3)
    c.text(DATE_DOTS, W/2, 1529, 48, "roman", olive, tracking=2.2)
    c.text(f'{WEEKDAY} · {DETAILS["venue"]}', W/2, 1610, 24, "sans", "#627154", tracking=.7)
    c.text(DETAILS["invitation"], W/2, 1668, 16, "serif", muted, tracking=3)
    return c.im.convert("RGB")


def vintage():
    c = Canvas("#502e24")
    ivory, gold, pale = "#f6e7cb", "#bc9870", "#d4ba96"
    c.rectangle((42, 43, 1198, 1711), outline="#a1815c", width=1)
    c.rectangle((51, 52, 1189, 1702), outline="#745640", width=.55)
    c.text("THE WEDDING EDITION", W/2, 92, 15, "latin", pale, tracking=5.8)
    c.text("FOREVER", W/2, 154, 137, "roman", ivory, tracking=5, max_width=1094)
    c.text("a beautiful beginning, with you", W/2, 303, 29, "italic", pale)
    c.line((83, 365, 1157, 365), gold, 1)
    c.image(source("GK6A6083"), (84,386,1072,975), focus=(.5,0))
    c.rectangle((83,385,1157,1362), outline="#c19b73", width=1)
    c.text("新 郎", 454, 1404, 13, "sans", pale, tracking=1.6)
    c.text("新 娘", 786, 1404, 13, "sans", pale, tracking=1.6)
    c.text(DETAILS["groom"], 454, 1440, 49, "serif", ivory, tracking=3)
    c.text("&", W/2, 1444, 41, "italic", gold)
    c.text(DETAILS["bride"], 786, 1440, 49, "serif", ivory, tracking=3)
    c.line((95, 1530, 445, 1530), "#9d7a56", .7)
    c.text("TOGETHER, ALWAYS", W/2, 1522, 12, "latin", pale, tracking=3)
    c.line((795, 1530, 1145, 1530), "#9d7a56", .7)
    c.text(DATE_DOTS, W/2, 1570, 44, "roman", ivory, tracking=2.8)
    c.text(DETAILS["venue"], W/2, 1643, 25, "serif", pale, tracking=2)
    return c.im.convert("RGB")


STYLES = [
    ("01_korean_minimal", "韩系 · 奶油留白", korean, ["GK6A5963"]),
    ("02_comic_love_story", "漫画 · 心动连载", comic, ["GK6A5966", "GK6A6065", "GK6A5899"]),
    ("03_fresh_romance", "清新 · 花园誓言", fresh, ["GK6A5753"]),
    ("04_vintage_editorial", "复古 · 爱的刊物", vintage, ["GK6A6083"]),
]


def preview_grid(images):
    grid = Image.new("RGB", (1800, 845), "#e9e5dc")
    d = ImageDraw.Draw(grid)
    face_title = ImageFont.truetype(FONT_PATHS["serif"][0], 32, index=2)
    face_small = ImageFont.truetype(FONT_PATHS["sans"][0], 17, index=2)
    face_label = ImageFont.truetype(FONT_PATHS["serif"][0], 23, index=2)
    d.text((900,30), f'{DETAILS["groom"]} & {DETAILS["bride"]} · 婚礼请柬', font=face_title, fill="#504539", anchor="mt")
    d.text((900,83), f'{DATE_CN}  /  {DETAILS["venue"]}', font=face_small, fill="#867560", anchor="mt")
    for i,(im,style) in enumerate(zip(images, STYLES)):
        thumb = ImageOps.contain(im, (400,566), Image.Resampling.LANCZOS)
        x = 55 + i*430
        y = 144
        d.rectangle((x+6,y+8,x+406,y+574), fill="#cec7bb")
        grid.paste(thumb,(x,y))
        d.text((x+200,744), style[1], font=face_label, fill="#564737", anchor="mt")
    d.text((900,802), 'A4 竖版 · 2480 × 3508 px · 300 dpi', font=face_small, fill="#8b7a64", anchor="mt")
    grid.save(OUT / "00_all_styles_preview.png", optimize=True)


def main(selected=None):
    images = []
    for filename,label,render,sources in STYLES:
        if selected and filename not in selected and (OUT / f"{filename}.png").exists():
            with Image.open(OUT / f"{filename}.png") as saved:
                images.append(saved.convert("RGB"))
            continue
        im = render()
        images.append(im)
        im.save(OUT / f"{filename}.png", dpi=(DPI,DPI), icc_profile=SRGB_PROFILE, optimize=True)
        im.save(OUT / f"{filename}.pdf", "PDF", resolution=DPI, quality=96, subsampling=0,
                title=f'{DETAILS["groom"]}与{DETAILS["bride"]}的婚礼请柬 · {label}', author=f'{DETAILS["groom"]} & {DETAILS["bride"]}')
        preview = ImageOps.contain(im, (700,990), Image.Resampling.LANCZOS)
        preview.save(PREVIEWS / f"{filename}.jpg", quality=94, subsampling=0)
        print(f"Rendered {filename}: {SIZE[0]} × {SIZE[1]} px", flush=True)
    images[0].save(OUT / "all_four_invitations.pdf", "PDF", save_all=True, append_images=images[1:],
                   resolution=DPI, quality=96, subsampling=0, title="阿澈 & 小满 · 四款婚礼请柬", author="阿澈 & 小满")
    preview_grid(images)
    notes = f"""婚礼请柬海报 / WEDDING INVITATIONS

新郎：{DETAILS['groom']}
新娘：{DETAILS['bride']}
日期：{DATE_CN}（{WEEKDAY}）
地点：{DETAILS['venue']}

四款成品：
01 韩系 · 奶油留白 —— 简约宋体与英文衬线、白纱原片、大面积奶油色留白。
02 漫画 · 心动连载 —— 原片的平涂与描边处理、三格分镜、对白气泡与网点装饰。
03 清新 · 花园誓言 —— 鼠尾草绿、拱形照片、轻盈植物与花朵装饰。
04 复古 · 爱的刊物 —— 暖棕与香槟金、杂志式标题、复古肖像。

每款同时提供 PNG 和单页 PDF；all_four_invitations.pdf 是四页合集。
PNG：2480×3508 像素，300 dpi，sRGB。PDF：约 A4 竖版，图片嵌入，字体不依赖接收设备。
打印时使用“实际大小”或 A4 纸张设置；也可直接分享 PNG。

仅使用 post/ 内选定的六张原始照片，未修改原文件。未添加未提供的婚礼时刻。
漫画款采用本地照片风格化处理与漫画排版，未使用 AI 重绘人像。
所有布局与照片处理均通过本地 Pillow 完成，未使用内置 image_gen 或图片生成 CLI/API。

可在 invitation_details.json 修改信息，再运行 scripts/create_invitations.py 重新输出。
"""
    (OUT / "使用说明.txt").write_text(notes, encoding="utf-8")
    manifest = {"details": DETAILS, "size": SIZE, "dpi": DPI, "mode": "local-photo-compositing",
                "styles": [{"file": name, "label": label, "sources": ids} for name,label,_,ids in STYLES]}
    (OUT / "design_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    with zipfile.ZipFile(OUT / "wedding_invitations_all.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in sorted(OUT.iterdir()):
            if path.suffix in {".png", ".pdf", ".txt"}:
                bundle.write(path, path.name)
    print(f"Saved four PNGs, four single-page PDFs, a PDF collection, preview, and ZIP to {OUT}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="+", choices=[style[0] for style in STYLES], help="Update selected styles and rebuild the combined outputs")
    main(parser.parse_args().only)
