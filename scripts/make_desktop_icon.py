"""Generates desktop/build/icon.png, the source art electron-builder turns into the .app icon."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZE = 1024
OUTPUT = Path(__file__).resolve().parent.parent / "desktop" / "build" / "icon.png"

BACKGROUND_TOP = (28, 34, 50)
BACKGROUND_BOTTOM = (13, 16, 23)
SQUIRCLE = (0.04, 0.04, 0.92, 0.92)
SQUIRCLE_RADIUS = 0.205

# Indented pills echo the canvas's tree render strategy, and stay legible down to 16px.
BARS = (
    (0.150, 0.235, 0.700, 0.105, (120, 150, 255)),
    (0.275, 0.410, 0.505, 0.105, (99, 210, 197)),
    (0.400, 0.585, 0.310, 0.105, (150, 170, 255)),
    (0.400, 0.760, 0.235, 0.105, (86, 99, 138)),
)


def _distance(x: float, y: float, box: tuple[float, float, float, float], radius: float) -> float:
    """Signed distance to a rounded rect: negative inside, positive outside, 0 on the edge."""
    left, top, width, height = box
    radius = min(radius, width / 2, height / 2)
    center_x, center_y = left + width / 2, top + height / 2
    half_x, half_y = width / 2 - radius, height / 2 - radius
    dx, dy = abs(x - center_x) - half_x, abs(y - center_y) - half_y
    outside = (max(dx, 0.0) ** 2 + max(dy, 0.0) ** 2) ** 0.5
    return outside + min(max(dx, dy), 0.0) - radius


def _coverage(x: float, y: float, box: tuple[float, float, float, float], radius: float) -> float:
    """Turns the signed distance into a 0..1 alpha across one pixel, so edges are anti-aliased."""
    feather = 1.4 / SIZE
    return max(0.0, min(1.0, 0.5 - _distance(x, y, box, radius) / feather))


def _blend(base: tuple[int, ...], layer: tuple[int, ...], alpha: float) -> tuple[int, ...]:
    return tuple(round(b + (top - b) * alpha) for b, top in zip(base, layer, strict=True))


def _sample(x: float, y: float) -> tuple[int, ...]:
    """The rounded-square backdrop, then each pill composited over it in order."""
    alpha = _coverage(x, y, SQUIRCLE, SQUIRCLE_RADIUS)
    if alpha <= 0.0:
        return (0, 0, 0, 0)
    color = _blend(BACKGROUND_TOP, BACKGROUND_BOTTOM, y)
    for left, top, width, height, bar_color in BARS:
        bar_alpha = _coverage(x, y, (left, top, width, height), height / 2)
        if bar_alpha > 0.0:
            color = _blend(color, bar_color, bar_alpha)
    return (*color, round(alpha * 255))


def _render() -> bytes:
    rows = bytearray()
    for row in range(SIZE):
        rows.append(0)
        y = (row + 0.5) / SIZE
        for column in range(SIZE):
            rows.extend(_sample((column + 0.5) / SIZE, y))
    return bytes(rows)


def _chunk(tag: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", crc)


def main() -> None:
    header = struct.pack(">2I5B", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(_render(), 9))
        + _chunk(b"IEND", b"")
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(png)
    print(f"wrote {OUTPUT} ({len(png) // 1024}KB, {SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
