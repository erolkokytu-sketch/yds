#!/usr/bin/env python3
"""Generate deterministic PWA PNG icons from simple vector-like primitives."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUTPUT = Path(__file__).resolve().parents[1] / "public" / "icons"


def font(size: int):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


def render(size: int, maskable: bool = False) -> Image.Image:
    scale = size / 512
    image = Image.new("RGBA", (size, size), (32, 92, 74, 255) if maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    s = lambda value: round(value * scale)
    if not maskable:
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=s(112), fill="#205c4a")
    draw.polygon([(s(92), s(137)), (s(150), s(128)), (s(208), s(141)), (s(256), s(168)), (s(256), s(392)), (s(208), s(366)), (s(150), s(355)), (s(92), s(364))], fill="#fffdfa")
    draw.polygon([(s(420), s(137)), (s(362), s(128)), (s(304), s(141)), (s(256), s(168)), (s(256), s(392)), (s(304), s(366)), (s(362), s(355)), (s(420), s(364))], fill="#f4f2ec")
    draw.line((s(256), s(168), s(256), s(392)), fill="#cbd8d2", width=max(2, s(12)))
    text_font = font(s(72))
    box = draw.textbbox((0, 0), "YDS", font=text_font)
    draw.text(((size - (box[2] - box[0])) / 2, s(215)), "YDS", font=text_font, fill="#205c4a")
    draw.line([(s(330), s(315)), (s(357), s(342)), (s(415), s(276))], fill="#a6632f", width=max(3, s(20)), joint="curve")
    return image


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        render(size).save(OUTPUT / f"icon-{size}.png", optimize=True)
        render(size, maskable=True).save(OUTPUT / f"icon-maskable-{size}.png", optimize=True)
    render(180).convert("RGB").save(OUTPUT / "apple-touch-icon.png", optimize=True)


if __name__ == "__main__":
    main()
