"""Лист сравнения «игра | эталон» для одного опыта.

    python tools/realism_compare.py exp3 tmp/visual/31/baso4/HIGH [--crop x,y,w,h]

Верхний ряд — игровые кадры стадий из docs/realism/stages.json, нижний — кадры
реального опыта на тех же стадиях (tmp/reference/frames). Пишет
tmp/visual/compare/<опыт>.jpg. --crop вырезает пробирку из полных игровых кадров.
"""
import argparse
import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEIGHT = 360
try:
    FONT = ImageFont.truetype("arial.ttf", 13)
except OSError:
    FONT = ImageFont.load_default()


def game_frame(folder, name, crop):
    for candidate in (f"{name}-tube.png", f"{name}.png"):
        path = os.path.join(folder, candidate)
        if os.path.exists(path):
            image = Image.open(path).convert("RGB")
            if crop and not candidate.endswith("-tube.png"):
                x, y, w, h = crop
                image = image.crop((x, y, x + w, y + h))
            return image
    return None


def reference_frame(video, seconds, fps):
    index = int(round(seconds * fps)) + 1
    path = os.path.join(ROOT, "tmp", "reference", "frames", video, f"f{index:03d}.jpg")
    return Image.open(path).convert("RGB") if os.path.exists(path) else None


def fit(image):
    if image is None:
        placeholder = Image.new("RGB", (160, HEIGHT), (230, 230, 230))
        ImageDraw.Draw(placeholder).text((8, HEIGHT // 2), "нет кадра", fill="black", font=FONT)
        return placeholder
    return image.resize((max(1, image.width * HEIGHT // image.height), HEIGHT))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("experiment")
    parser.add_argument("game_folder")
    parser.add_argument("--crop", help="x,y,w,h для полных игровых кадров")
    args = parser.parse_args()
    crop = tuple(int(v) for v in args.crop.split(",")) if args.crop else None
    with open(os.path.join(ROOT, "docs", "realism", "stages.json"), encoding="utf-8") as file:
        config = json.load(file)
    columns = []
    for stage in config[args.experiment]:
        video, seconds = stage["ref"]
        top = fit(game_frame(args.game_folder, stage["game"], crop))
        bottom = fit(reference_frame(video, seconds, config["fps"][video]))
        width = max(top.width, bottom.width)
        column = Image.new("RGB", (width, HEIGHT * 2 + 44), "white")
        draw = ImageDraw.Draw(column)
        draw.text((4, 2), f"{stage['label']}", fill="black", font=FONT)
        draw.text((4, 16), f"игра: {stage['game']}", fill=(60, 60, 160), font=FONT)
        column.paste(top, (0, 30))
        draw.text((4, HEIGHT + 31), f"эталон: {video} @ {seconds} с", fill=(160, 60, 60), font=FONT)
        column.paste(bottom, (0, HEIGHT + 44))
        columns.append(column)
    sheet = Image.new("RGB", (sum(c.width + 8 for c in columns), columns[0].height), "white")
    x = 0
    for column in columns:
        sheet.paste(column, (x, 0))
        x += column.width + 8
    out_dir = os.path.join(ROOT, "tmp", "visual", "compare")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{args.experiment}.jpg")
    sheet.save(out, quality=85)
    print(out)


if __name__ == "__main__":
    main()
