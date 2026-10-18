"""Builds Assets/icon.icns (one PNG-compressed 256px ic08 entry) from Assets/icon.png."""

import struct
import sys
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "dotnet" / "CodeChroma.Shell.App" / "Assets"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
ICON_SIZE = 256  # the 'ic08' icns type holds a 256x256 PNG


def build_icns(png: bytes) -> bytes:
    """Wraps one 256x256 PNG in an icns container."""
    if not png.startswith(PNG_MAGIC):
        raise ValueError("source is not a PNG")
    width, height = struct.unpack(">II", png[16:24])
    if (width, height) != (ICON_SIZE, ICON_SIZE):
        raise ValueError(f"source must be {ICON_SIZE}x{ICON_SIZE}, got {width}x{height}")
    chunk = b"ic08" + struct.pack(">I", len(png) + 8) + png
    return b"icns" + struct.pack(">I", len(chunk) + 8) + chunk


def main(argv: list[str]) -> int:
    source = Path(argv[1]) if len(argv) > 1 else ASSETS / "icon.png"
    output = Path(argv[2]) if len(argv) > 2 else ASSETS / "icon.icns"
    output.write_bytes(build_icns(source.read_bytes()))
    print(f"wrote {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
