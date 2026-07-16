#!/usr/bin/env python3
"""Decode EAS build logFiles payload and print error lines."""
from __future__ import annotations

import bz2
import gzip
import lzma
import pathlib
import sys
import zlib

try:
    import zstandard as zstd
except ImportError:  # pragma: no cover
    zstd = None

try:
    import brotli
except ImportError:  # pragma: no cover
    brotli = None

path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/eas-build.log.bin")
raw = path.read_bytes()

text = None
decoders = [
    ("brotli", brotli.decompress if brotli else None),
    ("raw-utf8", lambda b: b.decode("utf-8")),
    ("gzip", gzip.decompress),
    ("zlib", zlib.decompress),
    ("bz2", bz2.decompress),
    ("lzma", lzma.decompress),
]
if zstd is not None:
    decoders.append(("zstd", lambda b: zstd.ZstdDecompressor().decompress(b)))

for name, fn in decoders:
    if fn is None:
        continue
    try:
        out = fn(raw)
        if isinstance(out, bytes):
            out = out.decode("utf-8", errors="replace")
        text = out
        print(f"decoded via {name}, {len(text)} chars", file=sys.stderr)
        break
    except Exception:
        pass

if text is None:
    print("could not decode log file", file=sys.stderr)
    sys.exit(1)

out_path = pathlib.Path(str(path) + ".txt")
out_path.write_text(text)

for i, line in enumerate(text.splitlines(), 1):
    if any(k in line for k in ("error", "Error", "ERROR", "failed", "FAILED", "exit code", "CommandError")):
        print(f"{i}:{line}")
