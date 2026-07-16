#!/usr/bin/env python3
"""Decode EAS build logFiles payload and print error lines."""
from __future__ import annotations

import bz2
import gzip
import lzma
import pathlib
import sys
import zlib

path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/eas-build.log.bin")
raw = path.read_bytes()

text = None
for name, fn in [
    ("raw-utf8", lambda b: b.decode("utf-8")),
    ("gzip", gzip.decompress),
    ("zlib", zlib.decompress),
    ("bz2", bz2.decompress),
    ("lzma", lzma.decompress),
]:
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

out_path = path.with_suffix(".txt")
out_path.write_text(text)

for i, line in enumerate(text.splitlines(), 1):
    if any(k in line for k in ("error", "Error", "ERROR", "failed", "FAILED", "exit code", "CommandError")):
        print(f"{i}:{line}")
