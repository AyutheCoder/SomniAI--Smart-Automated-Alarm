"""A minimal BSON *encoder*, for tests only.

`datasets/bson_stream.py` only reads, because production never writes BSON. The
tests need to construct documents to read back, and hand-writing byte literals
would be unreadable and would not prove much. Deliberately independent of the
reader so a round-trip test is a real check rather than a tautology.
"""

from __future__ import annotations

import struct
from typing import Any


def encode_element(key: str, value: Any) -> bytes:
    kb = key.encode("utf-8") + b"\x00"
    # bool before int: bool is a subclass of int in Python.
    if isinstance(value, bool):
        return b"\x08" + kb + (b"\x01" if value else b"\x00")
    if isinstance(value, int):
        if -(2 ** 31) <= value < 2 ** 31:
            return b"\x10" + kb + struct.pack("<i", value)
        return b"\x12" + kb + struct.pack("<q", value)
    if isinstance(value, float):
        return b"\x01" + kb + struct.pack("<d", value)
    if isinstance(value, str):
        sb = value.encode("utf-8") + b"\x00"
        return b"\x02" + kb + struct.pack("<i", len(sb)) + sb
    if isinstance(value, dict):
        return b"\x03" + kb + encode_document(value)
    if isinstance(value, (list, tuple)):
        as_doc = {str(i): v for i, v in enumerate(value)}
        return b"\x04" + kb + encode_document(as_doc)
    if isinstance(value, bytes):
        return b"\x05" + kb + struct.pack("<i", len(value)) + b"\x00" + value
    if value is None:
        return b"\x0a" + kb
    raise TypeError(f"no test encoder for {type(value).__name__}")


def encode_document(doc: dict[str, Any]) -> bytes:
    body = b"".join(encode_element(k, v) for k, v in doc.items())
    return struct.pack("<i", 4 + len(body) + 1) + body + b"\x00"


def encode_stream(docs: list[dict[str, Any]]) -> bytes:
    """Concatenated documents, exactly as mongodump lays them out."""
    return b"".join(encode_document(d) for d in docs)


def sleep_document(participant: str, date: str, start: str, end: str,
                   minutes_asleep: int = 420, time_in_bed: int = 450,
                   main_sleep: bool = True, efficiency: int = 93) -> dict[str, Any]:
    """A LifeSnaps-shaped sleep record."""
    return {
        "_id": "62cc2021b41dcd4b1bfe9383",
        "id": participant,
        "type": "sleep",
        "data": {
            "logId": 32408388976,
            "dateOfSleep": date,
            "startTime": start,
            "endTime": end,
            "minutesToFallAsleep": 0,
            "minutesAsleep": minutes_asleep,
            "minutesAwake": time_in_bed - minutes_asleep,
            "timeInBed": time_in_bed,
            "efficiency": efficiency,
            "type": "stages",
            "mainSleep": main_sleep,
        },
    }
