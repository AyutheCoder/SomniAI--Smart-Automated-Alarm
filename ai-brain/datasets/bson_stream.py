"""A minimal streaming BSON reader.

LifeSnaps ships its Fitbit data as a 9.7 GB `mongodump` BSON file, and the
sleep timing the planner needs exists nowhere else in the release - the curated
CSVs omit it entirely. `pymongo` is not a dependency of this service and pulling
it in for one read would be disproportionate, so this parses the subset of BSON
that `mongodump` actually emits.

Streaming matters: the file does not fit in memory, and only ~4,141 of its
documents are sleep records, so callers filter as they go.

Spec: https://bsonspec.org/spec.html
"""

from __future__ import annotations

import datetime as _dt
import struct
from typing import Any, BinaryIO, Callable, Iterator


class BSONError(ValueError):
    """Malformed BSON, or a type this reader does not implement."""


def _cstring(buf: bytes, pos: int) -> tuple[str, int]:
    end = buf.index(b"\x00", pos)
    return buf[pos:end].decode("utf-8", "replace"), end + 1


def _string(buf: bytes, pos: int) -> tuple[str, int]:
    (size,) = struct.unpack_from("<i", buf, pos)
    start = pos + 4
    # size counts the trailing NUL, which is not part of the value.
    return buf[start:start + size - 1].decode("utf-8", "replace"), start + size


def _element(buf: bytes, pos: int) -> tuple[str, Any, int]:
    type_byte = buf[pos]
    name, pos = _cstring(buf, pos + 1)

    if type_byte == 0x01:                                  # double
        (v,) = struct.unpack_from("<d", buf, pos); return name, v, pos + 8
    if type_byte == 0x02:                                  # UTF-8 string
        v, pos = _string(buf, pos); return name, v, pos
    if type_byte in (0x03, 0x04):                          # document / array
        (size,) = struct.unpack_from("<i", buf, pos)
        sub = _document(buf[pos:pos + size])
        if type_byte == 0x04:
            sub = [sub[k] for k in sorted(sub, key=lambda k: int(k) if k.isdigit() else 0)]
        return name, sub, pos + size
    if type_byte == 0x05:                                  # binary
        (size,) = struct.unpack_from("<i", buf, pos)
        start = pos + 5                                    # skip length + subtype
        return name, buf[start:start + size], start + size
    if type_byte == 0x06:                                  # undefined (deprecated)
        return name, None, pos
    if type_byte == 0x07:                                  # ObjectId
        return name, buf[pos:pos + 12].hex(), pos + 12
    if type_byte == 0x08:                                  # boolean
        return name, buf[pos] != 0, pos + 1
    if type_byte == 0x09:                                  # UTC datetime (ms)
        (ms,) = struct.unpack_from("<q", buf, pos)
        return name, _dt.datetime.fromtimestamp(ms / 1000.0, _dt.timezone.utc), pos + 8
    if type_byte == 0x0A:                                  # null
        return name, None, pos
    if type_byte == 0x0B:                                  # regex: two cstrings
        _, pos = _cstring(buf, pos); _, pos = _cstring(buf, pos)
        return name, None, pos
    if type_byte == 0x0D:                                  # javascript
        v, pos = _string(buf, pos); return name, v, pos
    if type_byte == 0x10:                                  # int32
        (v,) = struct.unpack_from("<i", buf, pos); return name, v, pos + 4
    if type_byte in (0x11, 0x12):                          # timestamp / int64
        (v,) = struct.unpack_from("<q", buf, pos); return name, v, pos + 8
    if type_byte == 0x13:                                  # decimal128
        return name, buf[pos:pos + 16], pos + 16
    if type_byte in (0x7F, 0xFF):                          # min / max key
        return name, None, pos
    raise BSONError(f"unsupported BSON type 0x{type_byte:02x} for field {name!r}")


def _document(buf: bytes) -> dict[str, Any]:
    (size,) = struct.unpack_from("<i", buf, 0)
    if size != len(buf):
        raise BSONError(f"document says {size} bytes, got {len(buf)}")
    out: dict[str, Any] = {}
    pos = 4
    while pos < size - 1:
        name, value, pos = _element(buf, pos)
        out[name] = value
    return out


def iter_documents(
    stream: BinaryIO,
    where: Callable[[bytes], bool] | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield documents from a mongodump BSON stream.

    `where` receives each document's raw bytes and decides whether it is worth
    decoding. Screening on raw bytes is what makes a 9.7 GB scan tractable -
    decoding every document to discard 99% of them is the slow path.
    """
    while True:
        header = stream.read(4)
        if len(header) < 4:
            return                                  # clean end of stream
        (size,) = struct.unpack("<i", header)
        if size < 5:
            raise BSONError(f"implausible document size {size}")
        body = stream.read(size - 4)
        if len(body) < size - 4:
            return                                  # truncated tail
        raw = header + body
        if where is None or where(raw):
            yield _document(raw)


def decode(raw: bytes) -> dict[str, Any]:
    """Decode a single complete BSON document."""
    return _document(raw)
